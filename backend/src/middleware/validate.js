const { z } = require('zod');
const { normalizeEndpoint } = require('../utils/pathNormalizer');

// 1. Shared schemas
const objectIdSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid ID format')
});

// 2. Auth schemas
const registerSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(6, 'Password must be at least 6 characters long'),
  organization: z.string().optional().default('')
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address format'),
  password: z.string().min(1, 'Password is required')
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address format')
});

// 3. User schemas
const updateProfileSchema = z.object({
  organization: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters long').optional()
});

const createApiKeySchema = z.object({
  name: z.string().min(1, 'Please provide a name for the API key').trim(),
  rateLimitRps: z.number().int().min(1, 'Rate limit must be at least 1 rps').optional()
});

const createProviderKeySchema = z.object({
  provider: z.enum(['openai', 'gemini', 'claude', 'google_maps', 'stripe', 'twilio', 'weather', 'custom'], {
    errorMap: () => ({ message: 'Unsupported provider type' })
  }),
  name: z.string().min(1, 'Please provide a descriptive name').trim(),
  value: z.string().min(1, 'Please provide the API key value').trim()
});

// 4. Cache schemas
const createCacheRuleSchema = z.object({
  provider: z.string().min(1, 'Please provide a provider name').trim().toLowerCase(),
  endpoint: z.string().min(1, 'Please provide an endpoint path').trim(),
  ttlSeconds: z.number().int().min(1, 'TTL must be a positive integer')
});

// 5. Analytics schemas
const getLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').optional(),
  limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').optional(),
  provider: z.string().optional(),
  cacheStatus: z.enum(['HIT', 'MISS', 'BYPASS'], {
    errorMap: () => ({ message: 'Invalid cacheStatus value' })
  }).optional(),
  status: z.coerce.number().int().min(100).max(599).optional()
});

// 6. Gateway specific schemas
const gatewayParamsSchema = z.object({
  provider: z.enum(['openai', 'gemini', 'claude', 'google_maps', 'stripe', 'twilio', 'weather', 'custom'], {
    errorMap: () => ({ message: 'Unsupported provider' })
  }),
  0: z.string({
    required_error: 'Wildcard endpoint path is required and cannot be empty'
  }).min(1, 'Wildcard endpoint path is required and cannot be empty').transform(val => normalizeEndpoint(val))
});

const gatewayQuerySchema = z.object({
  queue: z.enum(['true', 'false'], {
    errorMap: () => ({ message: 'queue query parameter must be a boolean ("true" or "false")' })
  }).optional()
});

const gatewayHeadersSchema = z.object({
  'x-optiapi-queue': z.enum(['true', 'false'], {
    errorMap: () => ({ message: 'x-optiapi-queue header must be "true" or "false"' })
  }).optional()
}).passthrough();

// Provider-specific payload schemas
const openAIChatSchema = z.object({
  model: z.string().optional(),
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant', 'tool', 'function'], {
        errorMap: () => ({ message: 'role must be system, user, assistant, tool, or function' })
      }),
      content: z.string({
        required_error: 'message content is required'
      })
    }, {
      required_error: 'message object is required'
    })
  ).min(1, 'messages array cannot be empty')
}).passthrough();

const geminiGenerateContentSchema = z.object({
  model: z.string().optional(),
  contents: z.array(
    z.object({
      parts: z.array(
        z.object({
          text: z.string({
            required_error: 'part text is required'
          })
        }, {
          required_error: 'part object is required'
        })
      ).min(1, 'parts array cannot be empty')
    }, {
      required_error: 'content object is required'
    })
  ).min(1, 'contents array cannot be empty')
}).passthrough();

const stripeChargeSchema = z.object({
  amount: z.number().int().positive('amount must be a positive integer').optional(),
  currency: z.string().min(1, 'currency must be non-empty').optional(),
  customer: z.string().optional()
}).passthrough();

const twilioSmsSchema = z.object({
  to: z.string().min(1, 'to number is required'),
  from: z.string().min(1, 'from number is required'),
  body: z.string().min(1, 'message body is required')
}).passthrough();

const weatherSchema = z.object({
  city: z.string().min(1, 'city is required')
}).passthrough();

/**
 * Reusable validation middleware generator.
 */
const validate = (schemaObj) => (req, res, next) => {
  const errors = [];

  if (schemaObj.params) {
    const result = schemaObj.params.safeParse(req.params);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        location: 'params',
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.params = result.data;
    }
  }

  if (schemaObj.query) {
    const result = schemaObj.query.safeParse(req.query);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        location: 'query',
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.query = result.data;
    }
  }

  if (schemaObj.headers) {
    const result = schemaObj.headers.safeParse(req.headers);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        location: 'headers',
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.headers = result.data;
    }
  }

  if (schemaObj.body) {
    const result = schemaObj.body.safeParse(req.body);
    if (!result.success) {
      errors.push(...result.error.errors.map(err => ({
        location: 'body',
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.body = result.data;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'ValidationError',
      message: `Validation failed: ${errors.length} error(s) detected`,
      errors
    });
  }

  next();
};

/**
 * Dynamic API Gateway request validation middleware.
 */
const validateGateway = (req, res, next) => {
  const errors = [];

  // If wildcard endpoint is missing but URL ends with trailing slash, treat as root endpoint
  if (req.params[0] === undefined || req.params[0] === '') {
    const cleanPath = req.originalUrl.split('?')[0];
    if (cleanPath.endsWith('/')) {
      req.params[0] = '/';
    }
  }

  // A. Params validation (provider and wildcard path)
  const paramsResult = gatewayParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    errors.push(...paramsResult.error.errors.map(err => ({
      location: 'params',
      field: err.path.join('.') === '0' ? 'endpoint' : err.path.join('.'),
      message: err.message
    })));
  } else {
    req.params = paramsResult.data;
  }

  // B. Query parameters validation
  const queryResult = gatewayQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    errors.push(...queryResult.error.errors.map(err => ({
      location: 'query',
      field: err.path.join('.'),
      message: err.message
    })));
  } else {
    req.query = queryResult.data;
  }

  // C. Headers validation
  const headersResult = gatewayHeadersSchema.safeParse(req.headers);
  if (!headersResult.success) {
    errors.push(...headersResult.error.errors.map(err => ({
      location: 'headers',
      field: err.path.join('.'),
      message: err.message
    })));
  } else {
    if (req.headers['x-optiapi-queue'] !== undefined) {
      req.headers['x-optiapi-queue'] = headersResult.data['x-optiapi-queue'];
    }
  }

  // If there are parameter/query/header errors, stop here because body validation depends on provider/endpoint
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'ValidationError',
      message: `Validation failed: ${errors.length} error(s) detected`,
      errors
    });
  }

  // D. Provider-specific body validation
  const provider = req.params.provider.toLowerCase();
  const endpoint = req.params[0]; // normalized endpoint

  let bodySchema = null;

  if (provider === 'openai' && (endpoint.includes('chat/completions') || endpoint.includes('completions'))) {
    bodySchema = openAIChatSchema;
  } else if (provider === 'gemini' && (endpoint.includes('generateContent') || endpoint.includes('contents'))) {
    bodySchema = geminiGenerateContentSchema;
  } else if (provider === 'stripe' && (endpoint.includes('charges') || endpoint.includes('payment_intents') || endpoint.includes('customers'))) {
    bodySchema = stripeChargeSchema;
  } else if (provider === 'twilio' && (endpoint.includes('Messages') || endpoint.includes('messages'))) {
    bodySchema = twilioSmsSchema;
  } else if (provider === 'weather' && (endpoint.includes('current') || endpoint.includes('weather'))) {
    bodySchema = weatherSchema;
  }

  if (bodySchema) {
    const bodyResult = bodySchema.safeParse(req.body || {});
    if (!bodyResult.success) {
      errors.push(...bodyResult.error.errors.map(err => ({
        location: 'body',
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.body = bodyResult.data;
    }
  } else {
    // Safe generic validation for undefined endpoints (accepts object/array or empty)
    const genericSchema = z.union([z.object({}).passthrough(), z.array(z.any())]).optional();
    const bodyResult = genericSchema.safeParse(req.body);
    if (!bodyResult.success) {
      errors.push(...bodyResult.error.errors.map(err => ({
        location: 'body',
        field: err.path.join('.'),
        message: err.message
      })));
    } else {
      req.body = bodyResult.data;
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      error: 'ValidationError',
      message: `Validation failed: ${errors.length} error(s) detected`,
      errors
    });
  }

  next();
};

module.exports = {
  validate,
  validateGateway,
  schemas: {
    objectIdSchema,
    registerSchema,
    loginSchema,
    forgotPasswordSchema,
    updateProfileSchema,
    createApiKeySchema,
    createProviderKeySchema,
    createCacheRuleSchema,
    getLogsQuerySchema
  }
};
