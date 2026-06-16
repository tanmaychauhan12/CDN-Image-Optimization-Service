// Load environment variables if dotenv is available
try {
  require('dotenv').config();
} catch (error) {
  // dotenv is not installed or loaded, relying on container/shell environments
}

const app = require('./src/app');
const logger = require('./src/utils/logger');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info(`CDN Image Optimization Service running on port ${PORT}`);
});

// Handle graceful shutdowns
process.on('SIGTERM', () => {
  logger.warn('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated.');
  });
});

process.on('SIGINT', () => {
  logger.warn('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Process terminated.');
  });
});
