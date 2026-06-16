const express = require('express');
const s3Service = require('../services/s3Service');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @route GET /api/v1/health
 * @desc Telemetry health check verifying core services status (S3 connection)
 * @access Public
 */
router.get('/', async (req, res) => {
  const timestamp = new Date().toISOString();
  try {
    // Call s3Service connection health check
    await s3Service.checkS3Connection();

    res.status(200).json({
      status: 'ok',
      timestamp,
      services: {
        s3: 'ok',
      },
    });
  } catch (error) {
    logger.error(`Health check failed: S3 is degraded. ${error.message}`);
    
    res.status(503).json({
      status: 'degraded',
      services: {
        s3: 'error',
      },
    });
  }
});

module.exports = router;
