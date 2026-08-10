require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');
const ApiKey = require('./models/ApiKey');
const ProviderKey = require('./models/ProviderKey');
const CacheRule = require('./models/CacheRule');
const RequestLog = require('./models/RequestLog');
const Recommendation = require('./models/Recommendation');
const { calculateCost } = require('./services/costCalculator');
const logger = require('./utils/logger');

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/optiapi';

const seedData = async () => {
  try {
    logger.info('Connecting to MongoDB for seeding...');
    await mongoose.connect(mongoUri);

    const forceSeed = process.argv.includes('--force');
    const existingUser = await User.findOne({ email: 'demo@optiapi.com' });
    if (existingUser && !forceSeed) {
      logger.info('Database already seeded (demo@optiapi.com exists). Skipping seeding. Use --force to re-seed.');
      await mongoose.disconnect();
      process.exit(0);
    }

    logger.info('Clearing old collections...');
    await Promise.all([
      User.deleteMany({}),
      ApiKey.deleteMany({}),
      ProviderKey.deleteMany({}),
      CacheRule.deleteMany({}),
      RequestLog.deleteMany({}),
      Recommendation.deleteMany({})
    ]);

    logger.info('Creating Demo User...');
    const demoUser = await User.create({
      email: 'demo@optiapi.com',
      password: 'password123',
      organization: 'Acme Corp',
      role: 'admin'
    });

    logger.info('Creating Gateway Client API Key...');
    const demoApiKey = await ApiKey.create({
      userId: demoUser._id,
      name: 'Acme Production Key',
      key: 'opti_live_demo_api_key_2026_xYz',
      rateLimitRps: 15,
      usageCount: 1250
    });

    logger.info('Creating External Credentials (Vault)...');
    await ProviderKey.insertMany([
      { userId: demoUser._id, provider: 'openai', name: 'OpenAI Prod Key', value: 'demo-openai-key-replace-with-real-key' },
      { userId: demoUser._id, provider: 'stripe', name: 'Stripe Live Key', value: 'demo-stripe-key-replace-with-real-key' },
      { userId: demoUser._id, provider: 'google_maps', name: 'Google Maps Client', value: 'demo-googlemaps-key-replace-with-real-key' },
      { userId: demoUser._id, provider: 'gemini', name: 'Gemini Dev Key', value: 'demo-gemini-key-replace-with-real-key' }
    ]);

    logger.info('Creating Default Caching Rules...');
    await CacheRule.insertMany([
      { userId: demoUser._id, provider: 'stripe', endpoint: '/v1/customers', ttlSeconds: 1800 },
      { userId: demoUser._id, provider: 'google_maps', endpoint: '/maps/api/place/autocomplete', ttlSeconds: 86400 },
      { userId: demoUser._id, provider: 'openai', endpoint: '/v1/embeddings', ttlSeconds: 604800 }
    ]);

    logger.info('Seeding 1000+ Request Logs across 15 days...');
    const logsToInsert = [];
    const providers = ['openai', 'gemini', 'stripe', 'google_maps', 'twilio', 'weather'];
    const endpoints = {
      openai: ['/v1/chat/completions', '/v1/embeddings', '/v1/models'],
      gemini: ['/v1beta/models/gemini-1.5-flash:generateContent', '/v1beta/models/gemini-1.5-pro:generateContent'],
      stripe: ['/v1/charges', '/v1/payment_intents', '/v1/customers'],
      google_maps: ['/maps/api/place/autocomplete', '/maps/api/geocode', '/maps/api/directions'],
      twilio: ['/2010-04-01/Accounts/SMS/Messages'],
      weather: ['/current.json']
    };

    const models = {
      openai: ['gpt-4o', 'gpt-3.5-turbo'],
      gemini: ['gemini-1.5-flash', 'gemini-1.5-pro'],
      stripe: ['payment-intent', 'charges-api'],
      google_maps: ['places-api', 'geocoding-api'],
      twilio: ['sms-api'],
      weather: ['weather-fetch']
    };

    const now = new Date();

    // Generate request log distribution
    for (let dayOffset = 15; dayOffset >= 0; dayOffset--) {
      const dayDate = new Date();
      dayDate.setDate(now.getDate() - dayOffset);
      
      // Random requests volume per day: between 60 and 120
      const dayVolume = Math.floor(Math.random() * 60) + 60;
      
      for (let i = 0; i < dayVolume; i++) {
        // Set random hour
        const logTime = new Date(dayDate);
        logTime.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60), Math.floor(Math.random() * 60));

        const provider = providers[Math.floor(Math.random() * providers.length)];
        const providerEndpoints = endpoints[provider];
        const endpoint = providerEndpoints[Math.floor(Math.random() * providerEndpoints.length)];
        const method = ['stripe', 'twilio'].includes(provider) && Math.random() > 0.4 ? 'POST' : 'GET';
        
        // Caching probability (simulate cache hits for autocomplete or common fetches)
        let cacheStatus = 'BYPASS';
        if (['/maps/api/place/autocomplete', '/v1/customers', '/v1/embeddings'].includes(endpoint)) {
          cacheStatus = Math.random() < 0.65 ? 'HIT' : 'MISS';
        } else if (['/v1/chat/completions', '/v1/charges'].includes(endpoint)) {
          cacheStatus = Math.random() < 0.12 ? 'HIT' : 'MISS'; // lower hit rate on chat completions
        }

        // Status code distributions
        let status = 200;
        const rand = Math.random();
        if (rand < 0.03) status = 429; // Rate violations
        else if (rand < 0.05) status = 502; // Server error
        else if (rand < 0.07) status = 400; // Bad requests

        // Latency
        let responseTimeMs = 0;
        if (cacheStatus === 'HIT') {
          responseTimeMs = Math.floor(Math.random() * 3) + 1; // 1-4ms
        } else {
          if (provider === 'openai' || provider === 'gemini') {
            responseTimeMs = Math.floor(Math.random() * 1200) + 350; // 350ms - 1550ms
          } else if (provider === 'stripe') {
            responseTimeMs = Math.floor(Math.random() * 300) + 150; // 150ms - 450ms
          } else {
            responseTimeMs = Math.floor(Math.random() * 200) + 80;
          }
        }

        // Token calculations (LLMs)
        let promptTokens = 0;
        let completionTokens = 0;
        const pModel = models[provider][Math.floor(Math.random() * models[provider].length)];

        if (status === 200 && ['openai', 'gemini'].includes(provider)) {
          promptTokens = Math.floor(Math.random() * 800) + 100;
          if (endpoint.includes('chat') || endpoint.includes('generateContent')) {
            completionTokens = Math.floor(Math.random() * 400) + 50;
          }
        }

        const costUsd = status === 200 && cacheStatus !== 'HIT'
          ? calculateCost(provider, endpoint, pModel, { promptTokens, completionTokens })
          : 0.0;

        logsToInsert.push({
          userId: demoUser._id,
          apiKeyId: demoApiKey._id,
          provider,
          endpoint,
          method,
          status,
          responseTimeMs,
          costUsd,
          tokensUsed: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
          cacheStatus,
          requestBody: JSON.stringify({ prompt: 'Simulated request prompt text content.', model: pModel }),
          responseBody: status === 200 ? JSON.stringify({ success: true, message: 'Seeded simulation response' }) : '',
          errorMessage: status !== 200 ? 'Simulated transaction exception' : null,
          timestamp: logTime
        });
      }
    }

    logger.info(`Bulk writing ${logsToInsert.length} Request Logs to database...`);
    // Insert in chunks of 500
    for (let offset = 0; offset < logsToInsert.length; offset += 500) {
      const chunk = logsToInsert.slice(offset, offset + 500);
      await RequestLog.insertMany(chunk);
    }

    logger.info('Creating Pre-configured Optimization Suggestions...');
    await Recommendation.insertMany([
      {
        userId: demoUser._id,
        type: 'cache_endpoint',
        message: 'High latency detected on openai /v1/chat/completions. Cache this endpoint to speed up response times and reduce API costs.',
        priority: 'high',
        savingsInr: 12400,
        impactLevel: 'high',
        targetEndpoint: '/v1/chat/completions',
        details: { avgLatency: 1450, count: 180, currentHitRatio: 0 }
      },
      {
        userId: demoUser._id,
        type: 'duplicate_requests',
        message: 'Duplicate requests detected for stripe /v1/charges with similar body parameters. Enable short-term caching or request deduplication.',
        priority: 'medium',
        savingsInr: 3200,
        impactLevel: 'medium',
        targetEndpoint: '/v1/charges',
        details: { duplicateCount: 42, estimatedCostWaste: 0.84 }
      },
      {
        userId: demoUser._id,
        type: 'switch_batch',
        message: 'Frequent transactional queries to google_maps detected. Switch to batch autocomplete requests to save operational fees.',
        priority: 'medium',
        savingsInr: 5600,
        impactLevel: 'medium',
        targetEndpoint: '/maps/api/place/autocomplete',
        details: { currentWeeklySpend: 8.42 }
      },
      {
        userId: demoUser._id,
        type: 'unused_keys',
        message: "Unused API credential detected for provider 'gemini'. Remove or deactivate the key to secure your systems.",
        priority: 'low',
        savingsInr: 0,
        impactLevel: 'low',
        targetEndpoint: 'gemini',
        details: { keyName: 'Gemini Dev Key' }
      }
    ]);

    logger.info('=== DATABASE SEEDING COMPLETED SUCCESSFULLY ===');
    logger.info(`Demo User:     demo@optiapi.com`);
    logger.info(`Password:      password123`);
    logger.info(`Gateway Key:   opti_live_demo_api_key_2026_xYz`);
    logger.info('===============================================');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error(`Seeding error occurred: ${error.message}`);
    process.exit(1);
  }
};

seedData();
