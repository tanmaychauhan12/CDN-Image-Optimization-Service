const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const s3Service = require('./s3Service');
const metadataService = require('./metadataService');
const logger = require('../utils/logger');

const VARIANT_CONFIG = {
  thumb:    { width: 150,  height: 150,  fit: 'cover',    quality: 80 },
  small:    { width: 400,  height: null, fit: 'inside',   quality: 82 },
  medium:   { width: 800,  height: null, fit: 'inside',   quality: 85 },
  large:    { width: 1600, height: null, fit: 'inside',   quality: 87 },
  og:       { width: 1200, height: 630,  fit: 'cover',    quality: 90 },
  original: { width: null, height: null, fit: 'inside',   quality: 88 }
};

/**
 * Image processing service powered by Sharp.
 */
class SharpService {
  /**
   * Retrieves basic metadata (dimensions, format, size) of an image buffer.
   * @param {Buffer} buffer Input image file buffer
   * @returns {Promise<object>} Image metadata
   */
  async getMetadata(buffer) {
    try {
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        space: metadata.space,
        channels: metadata.channels,
        hasAlpha: metadata.hasAlpha,
      };
    } catch (error) {
      logger.error(`Sharp getMetadata error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Processes, optimizes, and compresses an image buffer based on options.
   * @param {Buffer} buffer Input image file buffer
   * @param {object} options Transformation options (width, height, format, quality)
   * @returns {Promise<{data: Buffer, info: object}>} Optimized image buffer and processing info
   */
  async optimize(buffer, options = {}) {
    const { width, height, format, quality = 80 } = options;
    logger.debug(`Starting image optimization. Options: ${JSON.stringify(options)}`);

    try {
      let pipeline = sharp(buffer);

      // 1. Apply resizing if dimensions are provided
      if (width || height) {
        pipeline = pipeline.resize({
          width: width ? parseInt(width, 10) : null,
          height: height ? parseInt(height, 10) : null,
          fit: 'inside', // preserve aspect ratio
          withoutEnlargement: true, // don't upscale images
        });
      }

      // 2. Format conversion and compression quality
      let targetFormat = format;
      if (!targetFormat) {
        // Fallback to original image format if none requested, default to jpeg if unknown
        const meta = await this.getMetadata(buffer);
        targetFormat = meta.format || 'jpeg';
      }

      // Standardize format extensions
      if (targetFormat === 'jpg') targetFormat = 'jpeg';

      if (['jpeg', 'png', 'webp', 'avif'].includes(targetFormat)) {
        pipeline = pipeline.toFormat(targetFormat, {
          quality: parseInt(quality, 10),
          effort: 4, // Balancing CPU cycles vs compression ratio
        });
      } else {
        // Fallback if unsupported format requested
        pipeline = pipeline.jpeg({ quality: parseInt(quality, 10) });
        targetFormat = 'jpeg';
      }

      // 3. Execute pipeline
      const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

      logger.debug(`Image optimization complete. Target Format: ${targetFormat}, Output Size: ${info.size} bytes`);
      return {
        buffer: data,
        info: {
          width: info.width,
          height: info.height,
          format: targetFormat,
          size: info.size,
        },
      };
    } catch (error) {
      logger.error(`Sharp optimization error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Processes the input image into multiple formats and resizes them based on configuration,
   * uploads them to S3, and writes the metadata to DynamoDB.
   * @param {object} file Multer file object
   * @param {string} ownerId ID of the user owning the image
   * @returns {Promise<object>} Image registration metadata
   */
  async processImage(file, ownerId) {
    // 1. Generate imageId
    const imageId = `img_${uuidv4().replace(/-/g, '')}`;
    logger.info(`Starting processImage pipeline for ID: ${imageId}, owner: ${ownerId}`);

    let format, width, height;
    try {
      // 2. Read source metadata
      const sourceMeta = await sharp(file.buffer).metadata();
      format = sourceMeta.format;
      width = sourceMeta.width;
      height = sourceMeta.height;
    } catch (err) {
      logger.error(`Failed to read source image metadata: ${err.message}`);
      throw new Error(`Failed to parse source image: ${err.message}`);
    }

    // 3. Process each variant in parallel
    const variantNames = Object.keys(VARIANT_CONFIG);
    let variants;

    try {
      variants = await Promise.all(
        variantNames.map(async (variantName) => {
          const config = VARIANT_CONFIG[variantName];
          try {
            // a. Create sharp instance
            let pipeline = sharp(file.buffer);

            // b. If variant has width/height: resize
            if (config.width || config.height) {
              pipeline = pipeline.resize(config.width, config.height, {
                fit: config.fit,
                withoutEnlargement: true,
              });
            }

            // c. Strip all metadata
            pipeline = pipeline.withMetadata(false);

            // d. Convert to WebP for all variants EXCEPT 'original' which gets AVIF
            let ext, mimeType;
            if (variantName === 'original') {
              ext = 'avif';
              mimeType = 'image/avif';
              pipeline = pipeline.avif({
                quality: Math.max(1, config.quality - 10),
                effort: 4,
              });
            } else {
              ext = 'webp';
              mimeType = 'image/webp';
              pipeline = pipeline.webp({
                quality: config.quality,
                effort: 4,
              });
            }

            // e. Run pipeline
            const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

            // f. Build S3 key
            const s3Key = `${ownerId}/${imageId}/${variantName}.${ext}`;

            // g. Return variant results
            return {
              variantName,
              s3Key,
              buffer: data,
              width: info.width,
              height: info.height,
              format: info.format,
              sizeBytes: info.size,
              mimeType,
            };
          } catch (err) {
            logger.error(`Error processing variant "${variantName}" for image ${imageId}: ${err.message}`);
            // Rethrow with context and ensure buffer is never leaked in the error
            throw new Error(`Failed to process image variant "${variantName}": ${err.message}`);
          }
        })
      );
    } catch (err) {
      throw err;
    }

    // 4. Call s3Service.uploadVariants in parallel
    try {
      await s3Service.uploadVariants(variants);
    } catch (err) {
      logger.error(`Error uploading variants for image ${imageId}: ${err.message}`);
      throw new Error(`Failed to upload image variants to storage: ${err.message}`);
    }

    // 5. Write metadata record
    const variantsWithoutBuffer = variants.map(({ buffer, ...rest }) => rest);
    const metadataRecord = {
      imageId,
      ownerId,
      sourceFormat: format,
      sourceWidth: width,
      sourceHeight: height,
      sourceSizeBytes: file.buffer.length,
      variants: variantsWithoutBuffer,
      createdAt: new Date().toISOString(),
    };

    try {
      await metadataService.saveImageRecord(metadataRecord);
    } catch (err) {
      logger.error(`Error saving metadata record for image ${imageId}: ${err.message}`);
      throw new Error(`Failed to save image metadata: ${err.message}`);
    }

    // 6. Return response format without buffer fields
    return {
      imageId,
      ownerId,
      variants: variantsWithoutBuffer,
    };
  }
}

module.exports = new SharpService();
