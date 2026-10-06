'use strict';

require('dotenv').config();
const app = require('./app');
const connectDB = require('./config/db');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { connectQueue, disconnectQueue } = require('./config/queue');
const { initQueueWorker } = require('./services/queueWorker');
const { initTelemetryWorker } = require('./services/telemetryWorker');
const logger = require('./utils/logger');
const { getEncryptionKey } = require('./utils/crypto');

const PORT = process.env.PORT || 5000;
let isShuttingDown = false;

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
    // Both connect functions automatically swap in-memory fallbacks if offline
    await connectRedis();
    await connectQueue();

    // 3. Fire up Background Consumer workers
    await initQueueWorker();
    await initTelemetryWorker();

    // 4. Start HTTP Express Server
    const server = app.listen(PORT, () => {
      logger.info(`=== OptiAPI AI Backend Server initialized ===`);
      logger.info(`Active Port: ${PORT}`);
      logger.info(`Run Mode:    ${process.env.NODE_ENV || 'development'}`);
      logger.info(`=============================================`);
    });

    // Graceful Shutdown Coordinator
    const handleShutdown = async (signal) => {
      if (isShuttingDown) return;
      isShuttingDown = true;
      logger.warn(`${signal} received. Initiating graceful shutdown sequence...`);

      // Force exit timeout safeguard (10 seconds)
      const forceExitTimer = setTimeout(() => {
        logger.error('Graceful shutdown timed out after 10s. Forcing process exit.');
        process.exit(1);
      }, 10000);
      if (forceExitTimer.unref) forceExitTimer.unref();

      // 1. Stop HTTP listener (stops accepting new connections, allows in-flight to drain)
      server.close(async () => {
        logger.info('HTTP server closed. Draining background connections...');
        try {
          // 2. Disconnect message queue channels & connections
          await disconnectQueue();

          // 3. Disconnect Redis cache connection
          await disconnectRedis();

          // 4. Disconnect MongoDB connection
          if (typeof connectDB.disconnectDB === 'function') {
            await connectDB.disconnectDB();
          }

          logger.info('OptiAPI graceful shutdown complete. Clean exit.');
          process.exit(0);
        } catch (err) {
          logger.error(`Error during graceful shutdown: ${err.message}`);
          process.exit(1);
        }
      });
    };

    // Attach signal listeners for Docker, Kubernetes, and local CLI Ctrl+C
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

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
