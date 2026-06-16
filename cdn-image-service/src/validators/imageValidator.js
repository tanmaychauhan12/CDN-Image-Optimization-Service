const Joi = require('joi');
const sharp = require('sharp');

// Define ValidationError extending Error
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// Joi schema for validating image processing options
const imageProcessSchema = Joi.object({
  width: Joi.number().integer().min(1).max(8192).optional()
    .messages({
      'number.base': 'Width must be a number',
      'number.min': 'Width must be at least 1 pixel',
      'number.max': 'Width cannot exceed 8192 pixels',
    }),
  
  height: Joi.number().integer().min(1).max(8192).optional()
    .messages({
      'number.base': 'Height must be a number',
      'number.min': 'Height must be at least 1 pixel',
      'number.max': 'Height cannot exceed 8192 pixels',
    }),
  
  format: Joi.string().valid('jpeg', 'jpg', 'png', 'webp', 'avif').lowercase().optional()
    .messages({
      'any.only': 'Format must be one of: jpeg, png, webp, avif',
    }),
  
  quality: Joi.number().integer().min(1).max(100).optional()
    .messages({
      'number.min': 'Quality must be at least 1',
      'number.max': 'Quality cannot exceed 100',
    }),
});

/**
 * Validates request query parameters for image processing configurations.
 * @param {object} data Object to validate
 * @returns {object} Validation result
 */
const validateImageOptions = (data) => {
  return imageProcessSchema.validate(data, { abortEarly: false, stripUnknown: true });
};

/**
 * Validates the uploaded file buffer, dimensions, and types.
 * Throws a ValidationError with a descriptive message on failure.
 * @param {object} file Multer file object
 * @returns {Promise<object>} Returns validation metrics on success
 */
const validateImage = async (file) => {
  // 1. Existence check
  if (!file || !file.buffer) {
    throw new ValidationError('No file provided');
  }

  // 2. File size check
  const maxBytes = 52428800; // 50MB
  const fileSize = file.size || file.buffer.length;
  if (fileSize > maxBytes) {
    const sizeInMB = (fileSize / (1024 * 1024)).toFixed(2);
    throw new ValidationError(`File too large: ${sizeInMB}MB. Max 50MB`);
  }

  // 3. Magic byte detection (read up to 12 bytes)
  const buf = file.buffer;
  let detectedMimeType = null;

  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
    detectedMimeType = 'image/jpeg';
  } else if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
    detectedMimeType = 'image/png';
  } else if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    detectedMimeType = 'image/gif';
  } else if (buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP') {
    detectedMimeType = 'image/webp';
  } else if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp' && (buf.toString('ascii', 8, 12) === 'avif' || buf.toString('ascii', 8, 12) === 'avis')) {
    detectedMimeType = 'image/avif';
  } else if (buf.length >= 4 && (
    (buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2A && buf[3] === 0x00) ||
    (buf[0] === 0x4D && buf[1] === 0x4D && buf[2] === 0x00 && buf[3] === 0x2A)
  )) {
    detectedMimeType = 'image/tiff';
  } else if (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4D) {
    // BMP detected (included for testing whitelist check)
    detectedMimeType = 'image/bmp';
  }

  if (!detectedMimeType) {
    const hexBytes = buf.slice(0, 4).toString('hex').toUpperCase();
    throw new ValidationError(`Invalid file type. Detected bytes: ${hexBytes}`);
  }

  // 4. Mimetype consistency
  const declared = file.mimetype;
  if (declared !== detectedMimeType) {
    throw new ValidationError(`File type mismatch: declared ${declared} but detected ${detectedMimeType}. Possible file spoofing attempt.`);
  }

  // 5. Allowed types whitelist
  const type = detectedMimeType.replace('image/', '');
  const whitelist = ['jpeg', 'png', 'gif', 'webp', 'avif', 'tiff'];
  if (!whitelist.includes(type)) {
    throw new ValidationError(`Unsupported image type: ${type}`);
  }

  // 6. Minimum dimensions check using sharp
  try {
    const metadata = await sharp(file.buffer).metadata();
    if (!metadata.width || !metadata.height || metadata.width < 10 || metadata.height < 10) {
      const w = metadata.width || 0;
      const h = metadata.height || 0;
      throw new ValidationError(`Image dimensions are too small: ${w}x${h}px. Minimum required is 10x10px.`);
    }

    return {
      valid: true,
      detectedMimeType,
      width: metadata.width,
      height: metadata.height,
      channels: metadata.channels,
      hasAlpha: metadata.hasAlpha || metadata.channels === 4,
    };
  } catch (err) {
    if (err instanceof ValidationError) throw err;
    throw new ValidationError(`Failed to parse image metadata: ${err.message}`);
  }
};

module.exports = {
  ValidationError,
  validateImageOptions,
  validateImage,
};
