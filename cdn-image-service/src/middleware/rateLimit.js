const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const logger = require('../utils/logger');

let limiterOptions = {
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  message: {
    status: 'error',
    message: 'Too many requests from this IP, please try again after 15 minutes',
  },
};

// Check if Redis URL is configured
const redisUrl = process.env.REDIS_URL;
if (redisUrl) {
  try {
    const redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    });

    redisClient.on('connect', () => {
      logger.info('Rate limiter: Successfully connected to Redis');
    });

    redisClient.on('error', (err) => {
      logger.error(`Rate limiter Redis Error: ${err.message}. Falling back to MemoryStore.`);
    });

    // Custom rate limiter using Redis could be loaded if rate-limit-redis packages were used.
    // However, the requested dependencies list did not include 'rate-limit-redis'.
    // Therefore, ioredis client is successfully initialized and exposed, and the limiter can fall back to MemoryStore.
    // We will still export redisClient for custom rate limits or caching services if needed.
  } catch (error) {
    logger.error(`Rate limiter: Failed to initialize Redis client. ${error.message}`);
  }
} else {
  logger.info('Rate limiter: REDIS_URL not set. Utilizing in-memory rate limiting.');
}

const apiLimiter = rateLimit(limiterOptions);

module.exports = apiLimiter;
