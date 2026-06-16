const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../src/app');

// Mock metadataService
jest.mock('../../src/services/metadataService', () => {
  const mockGetImageRecord = jest.fn();
  const mockListUserImages = jest.fn();
  const mockDeleteImageRecord = jest.fn();
  
  class MockNotFoundError extends Error {
    constructor(message) {
      super(message);
      this.name = 'NotFoundError';
    }
  }

  const service = {
    getImageRecord: mockGetImageRecord,
    listUserImages: mockListUserImages,
    deleteImageRecord: mockDeleteImageRecord,
    NotFoundError: MockNotFoundError,
  };

  return service;
});

// Mock s3Service
jest.mock('../../src/services/s3Service', () => ({
  deleteImage: jest.fn().mockResolvedValue({ deleted: 3 }),
  getSignedDownloadUrl: jest.fn().mockResolvedValue('https://s3.aws.com/signed-download-url'),
}));

// Mock cloudFrontService
jest.mock('../../src/services/cloudFrontService', () => ({
  generateSignedUrl: jest.fn().mockReturnValue({ url: 'https://cf.cdn.com/signed-cdn-url', expiresAt: '2026-06-16T10:48:11Z' }),
  generateVariantSignedUrls: jest.fn().mockReturnValue({
    imageId: 'img1',
    variants: {
      thumb: { url: 'https://cf.cdn.com/signed-cdn-url/thumb.webp', expiresAt: '2026-06-16T10:48:11Z' },
      large: { url: 'https://cf.cdn.com/signed-cdn-url/large.webp', expiresAt: '2026-06-16T10:48:11Z' }
    }
  }),
  getCdnUrl: jest.fn().mockReturnValue('https://cf.cdn.com/file'),
  invalidatePaths: jest.fn().mockResolvedValue('mock-invalidation-id'),
}));

const metadataService = require('../../src/services/metadataService');

describe('Images Router Integration Tests', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_local_development_only';
  let authToken;

  beforeAll(() => {
    authToken = jwt.sign({ userId: 'test-user-123' }, JWT_SECRET);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/v1/images should list user images', async () => {
    const mockImages = [{ imageId: 'img1', status: 'active' }];
    metadataService.listUserImages.mockResolvedValueOnce({
      images: mockImages,
      nextKey: null,
      count: 1,
    });

    const res = await request(app)
      .get('/api/v1/images')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body.images).toEqual(mockImages);
    expect(res.body.count).toBe(1);
    expect(metadataService.listUserImages).toHaveBeenCalledWith('test-user-123', 20, null);
  });

  it('GET /api/v1/images/:id should return image metadata', async () => {
    const mockImage = { imageId: 'img1', ownerId: 'test-user-123', status: 'active' };
    metadataService.getImageRecord.mockResolvedValueOnce(mockImage);

    const res = await request(app)
      .get('/api/v1/images/img1')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body).toEqual(mockImage);
    expect(metadataService.getImageRecord).toHaveBeenCalledWith('img1', 'test-user-123');
  });

  it('GET /api/v1/images/:id should return 404 if image not found', async () => {
    metadataService.getImageRecord.mockRejectedValueOnce(
      new metadataService.NotFoundError('Image not found: img1')
    );

    const res = await request(app)
      .get('/api/v1/images/img1')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(404);

    expect(res.body).toHaveProperty('error', 'NotFoundError');
    expect(res.body.message).toContain('Image not found');
  });

  it('GET /api/v1/images/:imageId/urls should return variants signed URLs', async () => {
    const mockImage = {
      imageId: 'img1',
      variants: [
        { variantName: 'thumb', s3Key: 'user/img1/thumb.webp' },
        { variantName: 'large', s3Key: 'user/img1/large.webp' }
      ]
    };
    metadataService.getImageRecord.mockResolvedValueOnce(mockImage);

    const res = await request(app)
      .get('/api/v1/images/img1/urls')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('imageId', 'img1');
    expect(res.body).toHaveProperty('ownerId', 'test-user-123');
    expect(res.body).toHaveProperty('signedUrls');
    expect(res.body.signedUrls.thumb.url).toContain('thumb.webp');
  });

  it('GET /api/v1/images/:imageId/urls should support query validation for IP and expiresIn', async () => {
    const mockImage = { imageId: 'img1', variants: [] };
    metadataService.getImageRecord.mockResolvedValueOnce(mockImage);

    await request(app)
      .get('/api/v1/images/img1/urls?expiresIn=200') // invalid: < 300
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);

    await request(app)
      .get('/api/v1/images/img1/urls?ip=invalid-ip') // invalid IP
      .set('Authorization', `Bearer ${authToken}`)
      .expect(400);
  });

  it('DELETE /api/v1/images/:imageId should delete image record, S3 variants, and create CF Invalidation', async () => {
    metadataService.getImageRecord.mockResolvedValueOnce({ imageId: 'img1', s3Key: 'key123' });
    metadataService.deleteImageRecord.mockResolvedValueOnce({ deleted: true, imageId: 'img1' });

    const res = await request(app)
      .delete('/api/v1/images/img1')
      .set('Authorization', `Bearer ${authToken}`)
      .expect(200);

    expect(res.body).toEqual({
      deleted: true,
      imageId: 'img1',
      message: 'Image and all variants deleted',
    });
    expect(metadataService.deleteImageRecord).toHaveBeenCalledWith('img1', 'test-user-123');
  });
});
