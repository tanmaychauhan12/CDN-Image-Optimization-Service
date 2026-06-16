const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_local_development_only';

/**
 * Authentication middleware that verifies JWT token from Authorization header.
 */
const authMiddleware = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Authentication failed: No token present or invalid format');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No token provided',
    });
  }

  const token = authHeader.split(' ')[1];

  if (!token) {
    logger.warn('Authentication failed: Token is empty');
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    logger.error(`Authentication failed: ${error.name} - ${error.message}`);
    
    let message = error.message;
    if (error.name === 'TokenExpiredError') {
      message = 'Token has expired';
    } else if (error.name === 'JsonWebTokenError') {
      message = 'Invalid token';
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: message,
    });
  }
};

module.exports = authMiddleware;

