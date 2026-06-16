const mockSend = jest.fn();

// Mock @aws-sdk/client-s3
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockSend,
    })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    HeadBucketCommand: jest.fn(),
  };
});

// Mock @aws-sdk/lib-storage
jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation(() => ({
    done: jest.fn().mockResolvedValue({ ETag: 'mock-etag', Location: 'mock-location' }),
  })),
}));

// Mock @aws-sdk/s3-request-presigner
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com/file'),
}));

const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Service = require('../../src/services/s3Service');

describe('S3Service Unit Tests', () => {
  beforeAll(() => {
    // Inject bucketName so validator checks pass in tests
    s3Service.bucketName = 'test-bucket';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should upload a single file', async () => {
    mockSend.mockResolvedValueOnce({});
    const result = await s3Service.uploadFile('test-key', Buffer.from('data'), 'image/png');
    expect(result).toBe('test-key');
    expect(mockSend).toHaveBeenCalled();
  });

  it('should generate a presigned url', async () => {
    const url = await s3Service.getPresignedUrl('test-key');
    expect(url).toBe('https://mock-presigned-url.com/file');
    expect(getSignedUrl).toHaveBeenCalled();
  });

  it('should generate a signed download url', async () => {
    const url = await s3Service.getSignedDownloadUrl('test-key');
    expect(url).toBe('https://mock-presigned-url.com/file');
  });

  it('should delete a single file', async () => {
    mockSend.mockResolvedValueOnce({});
    await s3Service.deleteFile('test-key');
    expect(mockSend).toHaveBeenCalled();
  });

  it('should upload variants in parallel using lib-storage Upload', async () => {
    const variants = [
      { variantName: 'thumb', s3Key: 'key1', buffer: Buffer.from('1'), mimeType: 'image/webp', width: 10, height: 10 },
      { variantName: 'large', s3Key: 'key2', buffer: Buffer.from('2'), mimeType: 'image/webp', width: 20, height: 20 },
    ];

    const results = await s3Service.uploadVariants(variants);

    expect(Upload).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({
      variantName: 'thumb',
      s3Key: 'key1',
      etag: 'mock-etag',
      location: 'mock-location',
    });
  });

  it('should delete image folder prefix with batch delete', async () => {
    // Mock ListObjectsV2Command response
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'user/img/thumb.webp' }, { Key: 'user/img/large.webp' }],
    });
    // Mock DeleteObjectsCommand response
    mockSend.mockResolvedValueOnce({
      Deleted: [{ Key: 'user/img/thumb.webp' }, { Key: 'user/img/large.webp' }],
    });

    const result = await s3Service.deleteImage('img', 'user');

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ deleted: 2 });
  });

  it('should check connection', async () => {
    mockSend.mockResolvedValueOnce({});
    const res = await s3Service.checkS3Connection();
    expect(res).toEqual({ ok: true });
  });
});
