const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  HeadBucketCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { Upload } = require('@aws-sdk/lib-storage');
const logger = require('../utils/logger');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;

// Initialize AWS S3 Client
const s3Client = new S3Client({
  region: AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

class S3Service {
  constructor() {
    this.bucketName = S3_BUCKET_NAME;
  }

  /**
   * Uploads a file buffer to S3 (legacy/direct helper).
   * @param {string} key File key (path/filename) in S3
   * @param {Buffer} buffer File buffer
   * @param {string} contentType MIME type of the file
   * @returns {Promise<string>} S3 Object Key
   */
  async uploadFile(key, buffer, contentType) {
    if (!this.bucketName) {
      logger.warn('S3 Bucket name is not configured in environment variables.');
      throw new Error('S3 configurations are incomplete.');
    }

    logger.debug(`Uploading file to S3: Bucket: ${this.bucketName}, Key: ${key}`);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    });

    try {
      await s3Client.send(command);
      logger.info(`Successfully uploaded ${key} to S3`);
      return key;
    } catch (error) {
      logger.error(`Failed uploading file to S3: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generates a pre-signed URL to read a file from S3.
   * @param {string} key S3 file key
   * @param {number} expiresIn URL expiration time in seconds (default 3600 - 1 hour)
   * @returns {Promise<string>} Presigned URL
   */
  async getPresignedUrl(key, expiresIn = 3600) {
    if (!this.bucketName) {
      throw new Error('S3 configurations are incomplete.');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });
      logger.debug(`Generated presigned URL for ${key}`);
      return url;
    } catch (error) {
      logger.error(`Error generating S3 presigned URL for ${key}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Deletes a single file from S3.
   * @param {string} key S3 file key
   */
  async deleteFile(key) {
    if (!this.bucketName) {
      throw new Error('S3 configurations are incomplete.');
    }

    logger.debug(`Deleting file from S3: ${key}`);

    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    try {
      await s3Client.send(command);
      logger.info(`Successfully deleted ${key} from S3`);
    } catch (error) {
      logger.error(`Failed deleting file from S3: ${error.message}`);
      throw error;
    }
  }

  /**
   * Uploads multiple image variants in parallel using @aws-sdk/lib-storage.
   * @param {Array<object>} variants Array of variant objects containing s3Key, buffer, and mimeType
   * @returns {Promise<Array<object>>} Array of upload receipts with Location and ETag
   */
  async uploadVariants(variants) {
    if (!this.bucketName) {
      throw new Error('S3 configurations are incomplete.');
    }

    logger.debug(`Uploading ${variants.length} image variants in parallel using lib-storage`);

    try {
      const uploadPromises = variants.map(async (variant) => {
        const upload = new Upload({
          client: s3Client,
          params: {
            Bucket: this.bucketName,
            Key: variant.s3Key,
            Body: variant.buffer,
            ContentType: variant.mimeType,
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: {
              variantName: variant.variantName,
              width: String(variant.width),
              height: String(variant.height),
            },
          },
          queueSize: 3,
          partSize: 1024 * 1024 * 5,
        });

        const result = await upload.done();
        logger.info(`Successfully uploaded variant: ${variant.variantName} -> Key: ${variant.s3Key}`);
        return {
          variantName: variant.variantName,
          s3Key: variant.s3Key,
          etag: result.ETag,
          location: result.Location,
        };
      });

      return await Promise.all(uploadPromises);
    } catch (error) {
      logger.error(`Failed uploading variants using lib-storage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Deletes all objects matching the prefix `${ownerId}/${imageId}/`.
   * @param {string} imageId ID of the image
   * @param {string} ownerId ID of the owner user
   * @returns {Promise<{deleted: number}>} Deleted count
   */
  async deleteImage(imageId, ownerId) {
    const prefix = `${ownerId}/${imageId}/`;
    logger.debug(`Deleting all S3 objects under prefix: ${prefix}`);
    
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const listResponse = await s3Client.send(listCommand);
      const objects = listResponse.Contents;

      if (!objects || objects.length === 0) {
        logger.info(`No S3 objects found under prefix: ${prefix}`);
        return { deleted: 0 };
      }

      // Prepare keys to delete
      const keys = objects.map((obj) => ({ Key: obj.Key }));
      let deletedCount = 0;

      // S3 delete objects command can accept up to 1000 keys per call
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000);
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.bucketName,
          Delete: {
            Objects: batch,
            Quiet: false,
          },
        });

        const deleteResponse = await s3Client.send(deleteCommand);
        deletedCount += (deleteResponse.Deleted ? deleteResponse.Deleted.length : 0);
      }

      logger.info(`Successfully deleted ${deletedCount} S3 objects under prefix: ${prefix}`);
      return { deleted: deletedCount };
    } catch (error) {
      logger.error(`Error deleting image S3 objects under prefix ${prefix}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generates a presigned download URL for direct S3 access.
   * @param {string} s3Key S3 file key
   * @param {number} expiresIn Expiration time in seconds
   * @returns {Promise<string>} Presigned URL
   */
  async getSignedDownloadUrl(s3Key, expiresIn = 3600) {
    if (!this.bucketName) {
      throw new Error('S3 configurations are incomplete.');
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: s3Key,
      });

      const url = await getSignedUrl(s3Client, command, { expiresIn });
      logger.debug(`Generated download presigned URL for key: ${s3Key}`);
      return url;
    } catch (error) {
      logger.error(`Error generating download presigned URL: ${error.message}`);
      throw error;
    }
  }

  /**
   * Tests S3 connection by verifying bucket accessibility.
   * @returns {Promise<{ok: boolean}>} Connection check status
   */
  async checkS3Connection() {
    if (!this.bucketName) {
      throw new Error('S3 Bucket name is not configured.');
    }

    try {
      const command = new HeadBucketCommand({
        Bucket: this.bucketName,
      });

      await s3Client.send(command);
      return { ok: true };
    } catch (error) {
      logger.error(`S3 connection health check failed: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new S3Service();
