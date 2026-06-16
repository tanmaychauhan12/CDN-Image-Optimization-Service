process.env.JWT_SECRET = 'test-secret';
process.env.S3_BUCKET_NAME = 'test-bucket';
process.env.DYNAMODB_TABLE_NAME = 'test-table';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const sharp = require('sharp');

// Mock multer to use a smaller limit in tests to prevent ECONNRESET when testing size limits
const mockMulterActual = jest.requireActual('multer');
jest.mock('multer', () => {
  const mockMulter = (options) => {
    return mockMulterActual({
      ...options,
      limits: {
        ...options?.limits,
        fileSize: 10 * 1024, // 10KB limit for integration testing
      }
    });
  };
  mockMulter.memoryStorage = mockMulterActual.memoryStorage;
  mockMulter.MulterError = mockMulterActual.MulterError;
  return mockMulter;
});

// Set up AWS SDK v3 mock implementations before importing the app
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({
      send: mockS3Send,
    })),
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    HeadBucketCommand: jest.fn(),
  };
});

jest.mock('@aws-sdk/lib-storage', () => {
  return {
    Upload: jest.fn().mockImplementation(() => ({
      done: jest.fn().mockResolvedValue({
        ETag: '"abc123"',
        Location: 'https://s3.amazonaws.com/mock-bucket/mock-key'
      }),
    })),
  };
});

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com/file'),
}));

const mockDocSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

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

const mockCfSend = jest.fn();
jest.mock('@aws-sdk/client-cloudfront', () => {
  return {
    CloudFrontClient: jest.fn().mockImplementation(() => ({
      send: mockCfSend,
    })),
    CreateInvalidationCommand: jest.fn(),
  };
});

const app = require('../../src/app');

describe('Scaffold Integration Tests', () => {
  const JWT_SECRET = 'test-secret';
  let validPngBuffer;
  let validJpegBuffer;
  let textBuffer;
  let oversizedBuffer;

  function makeToken(payload = {}) {
    return jwt.sign(
      { userId: 'test-user-123', email: 'test@test.com', ...payload },
      JWT_SECRET,
      { expiresIn: '1h' }
    );
  }

  beforeAll(async () => {
    // Generate valid 10x10 PNG buffer
    validPngBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    }).png().toBuffer();

    // Generate valid 10x10 JPEG buffer
    validJpegBuffer = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    }).jpeg().toBuffer();

    // Plain text buffer for testing invalid file types
    textBuffer = Buffer.from('this is plain text data');

    // Oversized buffer: 11KB (exceeds our 10KB test limit)
    oversizedBuffer = Buffer.alloc(11 * 1024);
  });

  beforeEach(() => {
    mockDocSend.mockReset();
    mockS3Send.mockReset();
    mockCfSend.mockReset();
  });

  describe('POST /api/v1/upload', () => {
    test('rejects request with no auth token → 401', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .attach('image', validPngBuffer, 'test.png')
        .expect(401);

      expect(res.body).toHaveProperty('error', 'Unauthorized');
      expect(res.body.message).toContain('No token provided');
    });

    test('rejects request with invalid JWT → 401', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', 'Bearer invalid-token')
        .attach('image', validPngBuffer, 'test.png')
        .expect(401);

      expect(res.body).toHaveProperty('error', 'Unauthorized');
      expect(res.body.message).toContain('Invalid token');
    });

    test('rejects non-image file (text/plain) → 400 with "Invalid file type"', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', `Bearer ${makeToken()}`)
        .attach('image', textBuffer, { filename: 'test.txt', contentType: 'text/plain' })
        .expect(400);

      expect(res.body).toHaveProperty('error', 'ValidationError');
      expect(res.body.message).toContain('Invalid file type');
    });

    test('rejects oversized file → 400 with "too large"', async () => {
      const res = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', `Bearer ${makeToken()}`)
        .attach('image', oversizedBuffer, 'oversized.png')
        .expect(400);

      expect(res.body).toHaveProperty('error', 'MulterError');
      expect(res.body.message).toContain('too large');
    });

    test('accepts valid JPEG, returns 201 with { imageId, variants }', async () => {
      mockDocSend.mockResolvedValueOnce({}); // PutCommand mock resolution

      const res = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', `Bearer ${makeToken()}`)
        .attach('image', validJpegBuffer, 'test.jpg')
        .expect(201);

      expect(res.body).toHaveProperty('imageId');
      expect(res.body).toHaveProperty('variants');
      expect(res.body.imageId).toMatch(/^img_[a-f0-9]{32}$/);
      expect(mockDocSend).toHaveBeenCalled();
    });

    test('accepts valid PNG, returns 201', async () => {
      mockDocSend.mockResolvedValueOnce({}); // PutCommand mock resolution

      const res = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', `Bearer ${makeToken()}`)
        .attach('image', validPngBuffer, 'test.png')
        .expect(201);

      expect(res.body).toHaveProperty('imageId');
      expect(res.body.imageId).toMatch(/^img_[a-f0-9]{32}$/);
    });

    test('imageId in response matches pattern /^img_[a-f0-9]{32}$/', async () => {
      mockDocSend.mockResolvedValueOnce({}); // PutCommand mock resolution

      const res = await request(app)
        .post('/api/v1/upload')
        .set('Authorization', `Bearer ${makeToken()}`)
        .attach('image', validPngBuffer, 'test.png')
        .expect(201);

      expect(res.body.imageId).toMatch(/^img_[a-f0-9]{32}$/);
    });
  });

  describe('GET /api/v1/images/:imageId/urls', () => {
    const mockImageRecord = {
      imageId: 'img_0123456789abcdef0123456789abcdef',
      ownerId: 'test-user-123',
      variants: [
        { variantName: 'thumb', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/thumb.webp' },
        { variantName: 'small', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/small.webp' },
        { variantName: 'medium', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/medium.webp' },
        { variantName: 'large', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/large.webp' },
        { variantName: 'og', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/og.webp' },
        { variantName: 'original', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/original.avif' }
      ]
    };

    test('404 for unknown imageId', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: null }); // GetCommand returns no item

      const res = await request(app)
        .get('/api/v1/images/img_unknown/urls')
        .set('Authorization', `Bearer ${makeToken()}`)
        .expect(404);

      expect(res.body).toHaveProperty('error', 'NotFoundError');
      expect(res.body.message).toContain('Image not found');
    });

    test('200 with signedUrls containing all 6 variant keys', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: mockImageRecord });

      const res = await request(app)
        .get('/api/v1/images/img_0123456789abcdef0123456789abcdef/urls')
        .set('Authorization', `Bearer ${makeToken()}`)
        .expect(200);

      expect(res.body.imageId).toBe(mockImageRecord.imageId);
      expect(res.body.ownerId).toBe('test-user-123');
      expect(res.body).toHaveProperty('signedUrls');
      
      const variantKeys = ['thumb', 'small', 'medium', 'large', 'og', 'original'];
      variantKeys.forEach((key) => {
        expect(res.body.signedUrls).toHaveProperty(key);
        expect(res.body.signedUrls[key]).toHaveProperty('url');
        expect(res.body.signedUrls[key]).toHaveProperty('expiresAt');
      });
    });

    test('signed URLs contain Key-Pair-Id param', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: mockImageRecord });

      const res = await request(app)
        .get('/api/v1/images/img_0123456789abcdef0123456789abcdef/urls')
        .set('Authorization', `Bearer ${makeToken()}`)
        .expect(200);

      const variantKeys = ['thumb', 'small', 'medium', 'large', 'og', 'original'];
      variantKeys.forEach((key) => {
        expect(res.body.signedUrls[key].url).toContain('Key-Pair-Id=');
      });
    });
  });

  describe('DELETE /api/v1/images/:imageId', () => {
    const mockImageRecord = {
      imageId: 'img_0123456789abcdef0123456789abcdef',
      ownerId: 'test-user-123',
      variants: [
        { variantName: 'thumb', s3Key: 'test-user-123/img_0123456789abcdef0123456789abcdef/thumb.webp' }
      ]
    };

    test('404 for unknown imageId', async () => {
      mockDocSend.mockResolvedValueOnce({ Item: null });

      const res = await request(app)
        .delete('/api/v1/images/img_unknown')
        .set('Authorization', `Bearer ${makeToken()}`)
        .expect(404);

      expect(res.body).toHaveProperty('error', 'NotFoundError');
    });

    test('200 with { deleted: true }', async () => {
      // 1. Route calls metadataService.getImageRecord
      mockDocSend.mockResolvedValueOnce({ Item: mockImageRecord });
      // 2. Route calls s3Service.deleteImage -> list files
      mockS3Send.mockResolvedValueOnce({ Contents: [{ Key: 'some-key' }] });
      // 3. Route calls s3Service.deleteImage -> delete files
      mockS3Send.mockResolvedValueOnce({ Deleted: [{ Key: 'some-key' }] });
      // 4. Route calls cloudFrontService.invalidatePaths -> invalidate paths
      mockCfSend.mockResolvedValueOnce({ Invalidation: { Id: 'mock-inval-id' } });
      // 5. Route calls metadataService.deleteImageRecord -> calls getImageRecord
      mockDocSend.mockResolvedValueOnce({ Item: mockImageRecord });
      // 6. deleteImageRecord calls DeleteCommand
      mockDocSend.mockResolvedValueOnce({});

      const res = await request(app)
        .delete('/api/v1/images/img_0123456789abcdef0123456789abcdef')
        .set('Authorization', `Bearer ${makeToken()}`)
        .expect(200);

      expect(res.body).toEqual({
        deleted: true,
        imageId: 'img_0123456789abcdef0123456789abcdef',
        message: 'Image and all variants deleted'
      });
    });
  });
});
