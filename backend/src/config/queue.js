const amqp = require('amqplib');
const logger = require('../utils/logger');

let amqpChannel = null;

// Mock RabbitMQ Channel for in-memory queue fallback
class MockQueueChannel {
  constructor() {
    this.queues = new Map();
    this.exchanges = new Map();
    logger.warn('--- RABBITMQ CONFIGURATION: Running with In-Memory Mock Queue ---');
  }

  async assertExchange(exchangeName, type = 'direct', options = {}) {
    if (!this.exchanges.has(exchangeName)) {
      this.exchanges.set(exchangeName, { type, options, bindings: [] });
    }
    return Promise.resolve({ exchange: exchangeName });
  }

  async assertQueue(queueName, options = {}) {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, { messages: [], consumers: [], options });
    } else {
      const q = this.queues.get(queueName);
      q.options = { ...q.options, ...options };
    }
    return Promise.resolve({ queue: queueName, messageCount: 0, consumerCount: 0 });
  }

  async bindQueue(queueName, exchangeName, routingKey = '') {
    await this.assertQueue(queueName);
    await this.assertExchange(exchangeName);
    const ex = this.exchanges.get(exchangeName);
    const exists = ex.bindings.some(b => b.queueName === queueName && b.routingKey === routingKey);
    if (!exists) {
      ex.bindings.push({ queueName, routingKey });
    }
    return Promise.resolve({});
  }

  async publish(exchangeName, routingKey, contentBuffer, options = {}) {
    await this.assertExchange(exchangeName);
    const ex = this.exchanges.get(exchangeName);
    const targetQueues = new Set();

    if (ex && ex.bindings.length > 0) {
      for (const b of ex.bindings) {
        if (!b.routingKey || b.routingKey === '#' || b.routingKey === routingKey || b.routingKey === '*') {
          targetQueues.add(b.queueName);
        }
      }
    }

    // Direct routing key fallback if no explicit binding match
    if (targetQueues.size === 0) {
      if (this.queues.has(routingKey)) {
        targetQueues.add(routingKey);
      }
    }

    if (targetQueues.size === 0) {
      // Create destination queue dynamically if bound to direct name
      targetQueues.add(routingKey || exchangeName);
    }

    for (const qName of targetQueues) {
      await this.sendToQueue(qName, contentBuffer, options);
    }
    return Promise.resolve(true);
  }

  async sendToQueue(queueName, contentBuffer, options = {}) {
    await this.assertQueue(queueName);
    const queue = this.queues.get(queueName);
    const msg = {
      content: contentBuffer,
      fields: { deliveryTag: Date.now(), routingKey: queueName, consumerQueue: queueName },
      properties: { ...options, headers: options.headers || {} }
    };

    if (queue.consumers.length > 0) {
      setImmediate(() => {
        const consumer = queue.consumers[Math.floor(Math.random() * queue.consumers.length)];
        consumer(msg);
      });
    } else {
      queue.messages.push(msg);
    }
    return Promise.resolve(true);
  }

  async consume(queueName, consumerCallback, options = {}) {
    await this.assertQueue(queueName);
    const queue = this.queues.get(queueName);
    queue.consumers.push(consumerCallback);

    // Drain queued messages
    const pending = [...queue.messages];
    queue.messages = [];
    pending.forEach((msg) => {
      setImmediate(() => consumerCallback(msg));
    });

    return Promise.resolve({ consumerTag: `mock-tag-${Date.now()}` });
  }

  async prefetch(count) {
    return Promise.resolve();
  }

  async ack(message) {
    return Promise.resolve();
  }

  async nack(message, allUpTo = false, requeue = true) {
    if (!requeue && message) {
      const qName = message.fields?.consumerQueue;
      const q = qName ? this.queues.get(qName) : null;
      const dlx = q?.options?.deadLetterExchange || q?.options?.arguments?.['x-dead-letter-exchange'];
      const dlRoutingKey = q?.options?.deadLetterRoutingKey || q?.options?.arguments?.['x-dead-letter-routing-key'] || 'dead';
      if (dlx) {
        await this.publish(dlx, dlRoutingKey, message.content, message.properties);
      }
    } else if (requeue && message && message.fields?.consumerQueue) {
      await this.sendToQueue(message.fields.consumerQueue, message.content, message.properties);
    }
    return Promise.resolve();
  }

  async reject(message, requeue = true) {
    return this.nack(message, false, requeue);
  }

  reset() {
    this.queues.clear();
    this.exchanges.clear();
  }
}

let amqpConnection = null;

const connectQueue = async () => {
  const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  try {
    logger.info(`Attempting connection to RabbitMQ at: ${url}`);
    amqpConnection = await amqp.connect(url);
    
    amqpConnection.on('error', (err) => {
      logger.error(`RabbitMQ connection error: ${err.message}`);
    });
    
    amqpConnection.on('close', () => {
      logger.warn('RabbitMQ connection closed. Reverting to mock channel.');
      amqpChannel = new MockQueueChannel();
    });

    amqpChannel = await amqpConnection.createChannel();
    logger.info('RabbitMQ Queue channel connected successfully.');
  } catch (error) {
    logger.warn(`Failed to connect to RabbitMQ (${error.message}). Swapping to in-memory fallback queue.`);
    amqpChannel = new MockQueueChannel();
  }
  return amqpChannel;
};

const getQueueChannel = () => {
  if (!amqpChannel) {
    amqpChannel = new MockQueueChannel();
  }
  return amqpChannel;
};

const disconnectQueue = async () => {
  try {
    if (amqpChannel && typeof amqpChannel.close === 'function') {
      await amqpChannel.close();
    }
    if (amqpConnection && typeof amqpConnection.close === 'function') {
      await amqpConnection.close();
      logger.info('RabbitMQ connection closed gracefully.');
    }
  } catch (err) {
    logger.warn(`Error closing RabbitMQ connection: ${err.message}`);
  }
};

module.exports = { connectQueue, getQueueChannel, disconnectQueue };
