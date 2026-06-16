const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const logger = require('../utils/logger');

const AWS_REGION = process.env.AWS_REGION || 'ap-south-1';
const DYNAMODB_TABLE_NAME = process.env.DYNAMODB_TABLE_NAME || 'cdn-image-service';

class NotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// Initialize low-level DynamoDB Client
const client = new DynamoDBClient({
  region: AWS_REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

// Configure Document Client to simplify working with JS objects
const ddbDocClient = DynamoDBDocumentClient.from(client, {
  marshallOptions: {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
});

class MetadataService {
  constructor() {
    this.tableName = DYNAMODB_TABLE_NAME;
  }

  /**
   * Saves image optimization metadata record to DynamoDB.
   * Input shape: { imageId, ownerId, sourceFormat, sourceWidth, sourceHeight, sourceSizeBytes, variants, createdAt }
   * @param {object} record Item details
   * @returns {Promise<object>} Saved item details
   */
  async saveImageRecord(record) {
    logger.debug(`Saving image record to DynamoDB: imageId ${record.imageId}`);

    // Compute fields
    const totalVariants = record.variants ? record.variants.length : 0;
    const totalSizeBytes = record.variants
      ? record.variants.reduce((sum, v) => sum + (v.sizeBytes || 0), 0)
      : 0;

    const recordToSave = {
      ...record,
      status: 'active',
      totalVariants,
      totalSizeBytes,
      updatedAt: new Date().toISOString(),
    };

    const command = new PutCommand({
      TableName: this.tableName,
      Item: recordToSave,
    });

    try {
      await ddbDocClient.send(command);
      logger.info(`Successfully saved metadata record for image: ${record.imageId}`);
      return recordToSave;
    } catch (error) {
      logger.error(`DynamoDB saveImageRecord error for imageId ${record.imageId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Retrieves image metadata record by ID.
   * Uses GetCommand with Key: { imageId, ownerId }
   * @param {string} imageId Partition key
   * @param {string} ownerId Sort key
   * @returns {Promise<object>} Item details
   */
  async getImageRecord(imageId, ownerId) {
    logger.debug(`Fetching image record from DynamoDB: imageId ${imageId}, ownerId ${ownerId}`);

    const command = new GetCommand({
      TableName: this.tableName,
      Key: { imageId, ownerId },
    });

    try {
      const { Item } = await ddbDocClient.send(command);
      if (!Item) {
        throw new NotFoundError(`Image not found: ${imageId}`);
      }
      return Item;
    } catch (error) {
      if (error instanceof NotFoundError) throw error;
      logger.error(`DynamoDB getImageRecord error for imageId ${imageId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Queries GSI to list all images owned by user.
   * @param {string} ownerId ID of the user
   * @param {number} limit Page limit
   * @param {object} lastKey Pagination cursor
   * @returns {Promise<{images: Array, nextKey: object, count: number}>} Query result
   */
  async listUserImages(ownerId, limit = 20, lastKey = null) {
    logger.debug(`Listing user images: ownerId ${ownerId}, limit ${limit}`);

    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'ownerId-createdAt-index',
      KeyConditionExpression: 'ownerId = :ownerId',
      ExpressionAttributeValues: {
        ':ownerId': ownerId,
      },
      ScanIndexForward: false, // Newest first
      Limit: limit,
      ExclusiveStartKey: lastKey || undefined,
    });

    try {
      const result = await ddbDocClient.send(command);
      const items = result.Items || [];
      return {
        images: items,
        nextKey: result.LastEvaluatedKey || null,
        count: items.length,
      };
    } catch (error) {
      logger.error(`DynamoDB listUserImages error for ownerId ${ownerId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Deletes image record from DynamoDB after validating presence.
   * @param {string} imageId Partition key
   * @param {string} ownerId Sort key
   * @returns {Promise<{deleted: boolean, imageId: string}>} Delete status
   */
  async deleteImageRecord(imageId, ownerId) {
    // Verify existence first
    await this.getImageRecord(imageId, ownerId);

    logger.debug(`Deleting image record from DynamoDB: imageId ${imageId}, ownerId ${ownerId}`);

    const command = new DeleteCommand({
      TableName: this.tableName,
      Key: { imageId, ownerId },
    });

    try {
      await ddbDocClient.send(command);
      logger.info(`Successfully deleted DynamoDB record for imageId ${imageId}`);
      return { deleted: true, imageId };
    } catch (error) {
      logger.error(`DynamoDB deleteImageRecord error for imageId ${imageId}: ${error.message}`);
      throw error;
    }
  }

  // Backward compatibility methods
  async saveMetadata(item) {
    return this.saveImageRecord({
      imageId: item.id,
      ownerId: item.uploadedBy || 'anonymous',
      ...item,
    });
  }

  async getMetadata(id) {
    return this.getImageRecord(id, 'anonymous');
  }

  async deleteMetadata(id) {
    return this.deleteImageRecord(id, 'anonymous');
  }
}

const metadataServiceInstance = new MetadataService();
module.exports = Object.assign(metadataServiceInstance, { NotFoundError });
