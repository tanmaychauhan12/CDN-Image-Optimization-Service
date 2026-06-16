const express = require('express');
const multer = require('multer');
const authMiddleware = require('../middleware/auth');
const sharpService = require('../services/sharpService');
const { validateImage } = require('../validators/imageValidator');
const logger = require('../utils/logger');

const router = express.Router();

// Configure Multer for memory storage with limits
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB limit
    files: 1, // Max 1 file
  },
});

const uploadSingle = upload.single('image');

/**
 * @route POST /api/v1/upload
 * @desc Uploads, validates, and processes a single image file
 * @access Private
 */
router.post('/', authMiddleware, (req, res, next) => {
  uploadSingle(req, res, async (err) => {
    // Handle Multer specific errors
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            error: 'MulterError',
            message: 'File size limit exceeded. Uploaded file is too large. Maximum allowed size is 50MB.',
          });
        }
        if (err.code === 'LIMIT_UNEXPECTED_FILE') {
          return res.status(400).json({
            error: 'MulterError',
            message: 'Unexpected file field. Field name must be "image".',
          });
        }
        return res.status(400).json({
          error: 'MulterError',
          message: err.message,
        });
      }
      return res.status(400).json({
        error: 'UploadError',
        message: err.message,
      });
    }

    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'BadRequest',
          message: 'Please upload a file in the "image" field.',
        });
      }

      logger.info(`Validating uploaded file: ${req.file.originalname}`);
      // Call imageValidator
      await validateImage(req.file);

      logger.info(`Processing image with sharpService: size ${req.file.buffer.length} bytes`);
      // Call sharpService
      const userId = req.user ? (req.user.userId || req.user.id || 'anonymous') : 'anonymous';
      const result = await sharpService.processImage(req.file, userId);

      // On success, return 201 JSON
      res.status(201).json({
        imageId: result.imageId,
        ownerId: result.ownerId,
        variants: result.variants || [],
        message: 'Upload successful',
      });
    } catch (error) {
      logger.error(`Error in upload route processing: ${error.message}`);
      next(error);
    }
  });
});

module.exports = router;
