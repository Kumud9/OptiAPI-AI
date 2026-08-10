// Trigger restart
require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { connectRedis } = require('./config/redis');
const { connectQueue } = require('./config/queue');
const { initQueueWorker } = require('./services/queueWorker');
const logger = require('./utils/logger');
const { getEncryptionKey } = require('./utils/crypto');

const PORT = process.env.PORT || 5000;

/**
 * OptiAPI AI Initialization Routine
 */
const startServer = async () => {
  try {
    // 0. Validate Vault Encryption Key Configuration
    getEncryptionKey();

    // 1. Establish Database Connection (MongoDB)
    await connectDB();

    // 2. Connect to Caching Layer (Redis) and Message Broker (RabbitMQ)
    // Both connect functions automatically swap in memory fallbacks if offline
    await connectRedis();
    await connectQueue();

    // 3. Fire up Background Consumer workers
    await initQueueWorker();

    // 4. Start HTTP Express Server
    const server = app.listen(PORT, () => {
      logger.info(`=== OptiAPI AI Backend Server initialized ===`);
      logger.info(`Active Port: ${PORT}`);
      logger.info(`Run Mode:    ${process.env.NODE_ENV || 'development'}`);
      logger.info(`=============================================`);
    });

    // Handle process signals for clean closures
    process.on('SIGTERM', () => {
      logger.warn('SIGTERM received. Initiating graceful shutdown sequence...');
      server.close(() => {
        logger.info('HTTP server closed. Exiting process.');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error(`Critical startup failure: ${error.message}`);
    process.exit(1);
  }
};

// Global unhandled exceptions listeners
process.on('unhandledRejection', (err) => {
  logger.error(`CRITICAL: Unhandled Promise Rejection: ${err.message}`, { stack: err.stack });
});

process.on('uncaughtException', (err) => {
  logger.error(`CRITICAL: Uncaught Exception thrown: ${err.message}`, { stack: err.stack });
});

startServer();
