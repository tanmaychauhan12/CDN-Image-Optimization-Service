const mockDocSend = jest.fn();

// Mock @aws-sdk/client-dynamodb
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

// Mock @aws-sdk/lib-dynamodb
jest.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({
        send: mockDocSend,
      })),
    },
    PutCommand: jest.fn(),
    GetCommand: jest.fn(),
    QueryCommand: jest.fn(),
    DeleteCommand: jest.fn(),
  };
});

const { PutCommand, GetCommand, QueryCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const metadataService = require('../../src/services/metadataService');
const { NotFoundError } = metadataService;

describe('MetadataService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should save an image record with computed fields', async () => {
    mockDocSend.mockResolvedValueOnce({});
    
    const record = {
      imageId: 'img123',
      ownerId: 'owner456',
      sourceFormat: 'png',
      sourceWidth: 100,
      sourceHeight: 100,
      sourceSizeBytes: 5000,
      variants: [
        { variantName: 'thumb', sizeBytes: 1500 },
        { variantName: 'medium', sizeBytes: 3000 },
      ],
      createdAt: new Date().toISOString(),
    };

    const savedRecord = await metadataService.saveImageRecord(record);

    expect(mockDocSend).toHaveBeenCalled();
    expect(savedRecord).toBeDefined();
    expect(savedRecord.status).toBe('active');
    expect(savedRecord.totalVariants).toBe(2);
    expect(savedRecord.totalSizeBytes).toBe(4500);
    expect(savedRecord.updatedAt).toBeDefined();
  });

  it('should retrieve an image record by imageId and ownerId', async () => {
    const mockItem = { imageId: 'img123', ownerId: 'owner456', status: 'active' };
    mockDocSend.mockResolvedValueOnce({ Item: mockItem });

    const item = await metadataService.getImageRecord('img123', 'owner456');

    expect(mockDocSend).toHaveBeenCalled();
    expect(item).toEqual(mockItem);
  });

  it('should throw NotFoundError if image record does not exist', async () => {
    mockDocSend.mockResolvedValueOnce({ Item: null });

    await expect(
      metadataService.getImageRecord('non-existent', 'owner456')
    ).rejects.toThrow(NotFoundError);
  });

  it('should list user images query on index', async () => {
    const mockItems = [{ imageId: 'img1' }, { imageId: 'img2' }];
    mockDocSend.mockResolvedValueOnce({
      Items: mockItems,
      LastEvaluatedKey: { imageId: 'img2', ownerId: 'owner456' },
    });

    const result = await metadataService.listUserImages('owner456', 10);

    expect(mockDocSend).toHaveBeenCalled();
    expect(result.images).toEqual(mockItems);
    expect(result.count).toBe(2);
    expect(result.nextKey).toEqual({ imageId: 'img2', ownerId: 'owner456' });
  });

  it('should delete image record successfully after checking existence', async () => {
    // 1st call: getImageRecord verification
    mockDocSend.mockResolvedValueOnce({ Item: { imageId: 'img123', ownerId: 'owner456' } });
    // 2nd call: DeleteCommand execution
    mockDocSend.mockResolvedValueOnce({});

    const result = await metadataService.deleteImageRecord('img123', 'owner456');

    expect(mockDocSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ deleted: true, imageId: 'img123' });
  });
});
