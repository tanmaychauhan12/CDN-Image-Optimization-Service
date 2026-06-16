const logger = require('../utils/logger');

/**
 * Global Express error handling middleware.
 * Maps common errors to HTTP status codes and responds with consistent JSON formats.
 */
const errorHandler = (err, req, res, next) => {
  // Log every error with winston logger
  logger.error(`${err.name || 'Error'}: ${err.message} \nStack: ${err.stack}`);

  // Default error mappings
  let statusCode = 500;
  let errorType = err.name || 'InternalServerError';
  let message = err.message || 'Internal Server Error';

  // Map common errors to HTTP status codes
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorType = 'ValidationError';
  } else if (err.name === 'UnauthorizedError') {
    statusCode = 401;
    errorType = 'UnauthorizedError';
  } else if (err.name === 'NotFoundError' || err.status === 404) {
    statusCode = 404;
    errorType = 'NotFoundError';
  } else if (err.status) {
    statusCode = err.status;
  }

  // Response payload structure
  const responsePayload = {
    error: errorType,
    message: message,
  };

  // Show stack trace in non-production environments
  const env = process.env.NODE_ENV || 'development';
  if (env !== 'production') {
    responsePayload.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
};

module.exports = errorHandler;
