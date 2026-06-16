const express = require('express');
const authMiddleware = require('../middleware/auth');
const metadataService = require('../services/metadataService');
const s3Service = require('../services/s3Service');
const cloudFrontService = require('../services/cloudFrontService');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * @route GET /api/v1/images
 * @desc Paginated list of user's images
 * @access Private
 */
router.get('/', authMiddleware, async (req, res, next) => {
  const ownerId = req.user ? req.user.userId : null;
  if (!ownerId) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Missing user credentials',
    });
  }

  const { limit = '20', nextKey } = req.query;

  if (!/^\d+$/.test(limit)) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'limit must be a positive integer',
    });
  }
  const parsedLimit = parseInt(limit, 10);
  if (parsedLimit <= 0) {
    return res.status(400).json({
      error: 'ValidationError',
      message: 'limit must be a positive integer',
    });
  }

  try {
    let decodedNextKey = null;
    if (nextKey) {
      try {
        decodedNextKey = JSON.parse(Buffer.from(nextKey, 'base64').toString());
      } catch (err) {
        return res.status(400).json({
          error: 'ValidationError',
          message: 'Invalid nextKey cursor format',
        });
      }
    }

    const result = await metadataService.listUserImages(ownerId, parsedLimit, decodedNextKey);
    
    // Base64 encode nextKey for client-side pagination convenience
    let nextKeyBase64 = null;
    if (result.nextKey) {
      nextKeyBase64 = Buffer.from(JSON.stringify(result.nextKey)).toString('base64');
    }

    res.status(200).json({
      images: result.images,
      nextKey: nextKeyBase64,
      count: result.count,
    });
  } catch (error) {
    logger.error(`Error listing user images for owner ${ownerId}: ${error.message}`);
    next(error);
  }
});

/**
 * @route GET /api/v1/images/:imageId
 * @desc Get image metadata by ID
 * @access Private
 */
router.get('/:imageId', authMiddleware, async (req, res, next) => {
  const { imageId } = req.params;
  const ownerId = req.user ? req.user.userId : null;

  if (!ownerId) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Missing user credentials',
    });
  }

  try {
    const record = await metadataService.getImageRecord(imageId, ownerId);
    res.status(200).json(record);
  } catch (error) {
    logger.error(`Error fetching image metadata for ${imageId}: ${error.message}`);
    next(error);
  }
});

/**
 * @route GET /api/v1/images/:imageId/urls
 * @desc Get signed URLs for all variants of an image
 * @access Private
 */
router.get('/:imageId/urls', authMiddleware, async (req, res, next) => {
  const { imageId } = req.params;
  const ownerId = req.user ? req.user.userId : null;

  if (!ownerId) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Missing user credentials',
    });
  }

  // Optional query params validation
  let expiresIn = 3600;
  if (req.query.expiresIn) {
    if (!/^\d+$/.test(req.query.expiresIn)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'expiresIn must be an integer between 300 and 86400',
      });
    }
    const parsed = parseInt(req.query.expiresIn, 10);
    if (parsed < 300 || parsed > 86400) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'expiresIn must be an integer between 300 and 86400',
      });
    }
    expiresIn = parsed;
  }

  let ipAddress = null;
  if (req.query.ip) {
    const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipv4Regex.test(req.query.ip)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid IPv4 address format for IP restriction',
      });
    }
    ipAddress = req.query.ip;
  }

  try {
    // Call metadataService
    const record = await metadataService.getImageRecord(imageId, ownerId);

    // Call cloudFrontService to generate variant signed URLs
    const signedData = cloudFrontService.generateVariantSignedUrls(record, { expiresIn, ipAddress });

    res.status(200).json({
      imageId: record.imageId,
      ownerId,
      signedUrls: signedData.variants,
    });
  } catch (error) {
    logger.error(`Error generating signed variant URLs for image ${imageId}: ${error.message}`);
    next(error);
  }
});

/**
 * @route DELETE /api/v1/images/:imageId
 * @desc Delete image file from storage and database metadata records
 * @access Private
 */
router.delete('/:imageId', authMiddleware, async (req, res, next) => {
  const { imageId } = req.params;
  const ownerId = req.user ? req.user.userId : null;

  if (!ownerId) {
    return res.status(401).json({
      error: 'UnauthorizedError',
      message: 'Missing user credentials',
    });
  }

  try {
    // 1. Verify ownership (throws 404 via NotFoundError if not owner/not found)
    await metadataService.getImageRecord(imageId, ownerId);

    // 2. Delete all S3 variants
    await s3Service.deleteImage(imageId, ownerId);

    // 3. Create CloudFront invalidation for the image folder paths
    await cloudFrontService.invalidatePaths([`/${ownerId}/${imageId}/*`]);

    // 4. Delete record from DynamoDB database
    await metadataService.deleteImageRecord(imageId, ownerId);

    res.status(200).json({
      deleted: true,
      imageId,
      message: 'Image and all variants deleted',
    });
  } catch (error) {
    logger.error(`Error deleting image ${imageId}: ${error.message}`);
    next(error);
  }
});

module.exports = router;
