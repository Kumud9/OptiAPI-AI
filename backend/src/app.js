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
const metricsRoutes = require('./routes/metricsRoutes');

const helmet = require('helmet');

const app = express();

// Secure express app by setting various HTTP headers
app.use(helmet());

// Configure CORS origin policy using environment variables
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5000', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps, curl, or gateway requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    return callback(new Error('Blocked by CORS policy: Origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
}));

// Body parser with explicit payload size limits
const MAX_PAYLOAD_SIZE = process.env.MAX_REQUEST_SIZE || '2mb';
app.use(express.json({ limit: MAX_PAYLOAD_SIZE }));
app.use(express.urlencoded({ extended: true, limit: MAX_PAYLOAD_SIZE }));

// Morgan request logging mapped into Winston with sensitive header masking
const morganStream = {
  write: (message) => {
    const sanitized = message
      .trim()
      .replace(/(bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED]')
      .replace(/(x-api-key:\s*)[A-Za-z0-9\-_]+/gi, '$1[REDACTED]');
    logger.info(sanitized);
  }
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
app.use('/api/metrics', metricsRoutes);
app.use('/api/v1/metrics', metricsRoutes);

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
  if (err.type === 'entity.too.large') {
    logger.warn(`Request payload rejected: payload size exceeds maximum limit of ${MAX_PAYLOAD_SIZE}`);
    return res.status(413).json({
      success: false,
      error: 'PayloadTooLarge',
      message: `Request payload exceeds allowed limit of ${MAX_PAYLOAD_SIZE}`
    });
  }

  logger.error(`Unhandled Exception caught: ${err.message}`, { stack: err.stack });
  
  res.status(err.status || 500).json({
    success: false,
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected server error occurred.'
  });
});

module.exports = app;
