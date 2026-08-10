const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const logger = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const gatewayRoutes = require('./routes/gatewayRoutes');
const cacheRoutes = require('./routes/cacheRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const optimizationRoutes = require('./routes/optimizationRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();

// Enable Cross-Origin Resource Sharing
app.use(cors({
  origin: '*', // For development, allow any origin to connect
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Morgan request logging mapped into Winston
const morganStream = {
  write: (message) => logger.info(message.trim())
};
app.use(morgan(process.env.NODE_ENV === 'development' ? 'dev' : 'combined', { stream: morganStream }));

// Mount API routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/gateway', gatewayRoutes);
app.use('/api/v1/cache', cacheRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/optimization', optimizationRoutes);
app.use('/api/v1/admin', adminRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  return res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Fallback 404 Route handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, error: 'Endpoint resource not found' });
});

// Global Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error(`Unhandle Exception caught: ${err.message}`, { stack: err.stack });
  
  res.status(err.status || 500).json({
    success: false,
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected server error occurred.'
  });
});

module.exports = app;
