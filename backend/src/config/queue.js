const amqp = require('amqplib');
const logger = require('../utils/logger');

let amqpChannel = null;

// Mock RabbitMQ Channel for in-memory queue fallback
class MockQueueChannel {
  constructor() {
    this.queues = new Map();
    logger.warn('--- RABBITMQ CONFIGURATION: Running with In-Memory Mock Queue ---');
  }

  async assertQueue(queueName, options = {}) {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, { messages: [], consumers: [] });
    }
    return Promise.resolve({ queue: queueName, messageCount: 0, consumerCount: 0 });
  }

  async sendToQueue(queueName, contentBuffer, options = {}) {
    await this.assertQueue(queueName);
    const queue = this.queues.get(queueName);
    const msg = {
      content: contentBuffer,
      fields: { deliveryTag: Date.now() },
      properties: options
    };

    if (queue.consumers.length > 0) {
      // Defer execution slightly to mock network delay & async nature
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

  async ack(message) {
    return Promise.resolve();
  }

  async nack(message, allUpTo = false, requeue = true) {
    return Promise.resolve();
  }
}

const connectQueue = async () => {
  const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
  try {
    logger.info(`Attempting connection to RabbitMQ at: ${url}`);
    const connection = await amqp.connect(url);
    
    connection.on('error', (err) => {
      logger.error(`RabbitMQ connection error: ${err.message}`);
    });
    
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed. Reverting to mock channel.');
      amqpChannel = new MockQueueChannel();
    });

    amqpChannel = await connection.createChannel();
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

module.exports = { connectQueue, getQueueChannel };
