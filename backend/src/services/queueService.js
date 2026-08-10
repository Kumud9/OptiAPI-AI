const { getQueueChannel } = require('../config/queue');
const logger = require('../utils/logger');

/**
 * Publishes a task payload to a specified RabbitMQ queue
 * @param {string} queueName Name of the queue
 * @param {object} payload Task payload
 */
const publishToQueue = async (queueName, payload) => {
  try {
    const channel = getQueueChannel();
    await channel.assertQueue(queueName, { durable: true });
    
    const messageBuffer = Buffer.from(JSON.stringify(payload));
    await channel.sendToQueue(queueName, messageBuffer, { persistent: true });
    logger.info(`Message published to queue [${queueName}] successfully.`);
    return true;
  } catch (error) {
    logger.error(`Error publishing to queue [${queueName}]: ${error.message}`);
    return false;
  }
};

/**
 * Registers a worker consumer callback for a queue
 * @param {string} queueName Name of the queue to listen to
 * @param {function} handler Callback executing the message payload
 */
const startWorker = async (queueName, handler) => {
  try {
    const channel = getQueueChannel();
    await channel.assertQueue(queueName, { durable: true });
    
    logger.info(`Starting background queue consumer for queue: [${queueName}]`);
    await channel.consume(queueName, async (msg) => {
      if (msg !== null) {
        try {
          const payload = JSON.parse(msg.content.toString());
          logger.debug(`Queue worker received payload for queue [${queueName}]`);
          await handler(payload);
          await channel.ack(msg);
        } catch (err) {
          logger.error(`Error processing queued task: ${err.message}`);
          // Nack message, requeue if retryable
          await channel.nack(msg, false, true);
        }
      }
    });
  } catch (error) {
    logger.error(`Error starting queue consumer for queue [${queueName}]: ${error.message}`);
  }
};

module.exports = {
  publishToQueue,
  startWorker
};
