const winston = require('winston');

// Regex patterns to match and mask sensitive tokens and credentials
const SENSITIVE_KEY_REGEX = /(authorization|x-api-key|bearer|token|apikey|password|secret|encryption_key)/i;
const BEARER_TOKEN_REGEX = /(bearer\s+)([A-Za-z0-9\-._~+/]+=*)/gi;
const API_KEY_PREFIX_REGEX = /(sk-[A-Za-z0-9]{8})[A-Za-z0-9]+/gi;

/**
 * Recursively redacts sensitive keys and values from objects and strings
 */
function redactSensitiveData(obj) {
  if (!obj) return obj;
  if (typeof obj === 'string') {
    return obj
      .replace(BEARER_TOKEN_REGEX, '$1[REDACTED]')
      .replace(API_KEY_PREFIX_REGEX, '$1[REDACTED]');
  }
  if (Array.isArray(obj)) {
    return obj.map(item => redactSensitiveData(item));
  }
  if (typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(key)) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = redactSensitiveData(value);
      } else if (typeof value === 'string') {
        sanitized[key] = value
          .replace(BEARER_TOKEN_REGEX, '$1[REDACTED]')
          .replace(API_KEY_PREFIX_REGEX, '$1[REDACTED]');
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }
  return obj;
}

const sanitizeFormat = winston.format((info) => {
  if (typeof info.message === 'string') {
    info.message = redactSensitiveData(info.message);
  }
  for (const key of Object.keys(info)) {
    if (key === 'message') continue;
    if (SENSITIVE_KEY_REGEX.test(key)) {
      info[key] = '[REDACTED]';
    } else if (typeof info[key] === 'object' && info[key] !== null) {
      info[key] = redactSensitiveData(info[key]);
    } else if (typeof info[key] === 'string') {
      info[key] = redactSensitiveData(info[key]);
    }
  }
  return info;
});

const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    sanitizeFormat(),
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true })
  ),
  defaultMeta: { service: 'optiapi-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ level, message, timestamp, stack }) => {
          return `${timestamp} [${level}]: ${stack || (typeof message === 'object' ? JSON.stringify(message) : message)}`;
        })
      )
    })
  ]
});

module.exports = logger;
