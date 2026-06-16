const mockCfSend = jest.fn();

// Mock @aws-sdk/client-cloudfront
jest.mock('@aws-sdk/client-cloudfront', () => {
  return {
    CloudFrontClient: jest.fn().mockImplementation(() => ({
      send: mockCfSend,
    })),
    CreateInvalidationCommand: jest.fn(),
  };
});

const { CreateInvalidationCommand } = require('@aws-sdk/client-cloudfront');
const cloudFrontService = require('../../src/services/cloudFrontService');

describe('CloudFrontService Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a signed URL with canned policy when no IP is provided', () => {
    const result = cloudFrontService.generateSignedUrl('processed/img1.webp', { expiresIn: 3600 });
    
    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('expiresAt');
    expect(result.url).toContain('Expires=');
    expect(result.url).toContain('Signature=');
    expect(result.url).toContain('Key-Pair-Id=');
  });

  it('should generate a signed URL with custom policy when IP is provided', () => {
    const result = cloudFrontService.generateSignedUrl('processed/img1.webp', {
      expiresIn: 3600,
      ipAddress: '192.168.1.1',
    });

    expect(result).toHaveProperty('url');
    expect(result).toHaveProperty('expiresAt');
    expect(result.url).toContain('Policy=');
    expect(result.url).toContain('Signature=');
    expect(result.url).toContain('Key-Pair-Id=');
  });

  it('should create a CloudFront invalidation for the specified paths', async () => {
    mockCfSend.mockResolvedValueOnce({
      Invalidation: { Id: 'mock-invalidation-123' },
    });

    const invalidationId = await cloudFrontService.invalidatePaths(['/processed/img1.webp']);

    expect(mockCfSend).toHaveBeenCalled();
    expect(invalidationId).toBe('mock-invalidation-123');
  });

  it('should generate signed URLs for all variants of an image record', () => {
    const mockRecord = {
      imageId: 'img123',
      variants: [
        { variantName: 'thumb', s3Key: 'user/img123/thumb.webp' },
        { variantName: 'large', s3Key: 'user/img123/large.webp' },
      ],
    };

    const result = cloudFrontService.generateVariantSignedUrls(mockRecord);

    expect(result.imageId).toBe('img123');
    expect(result.variants).toHaveProperty('thumb');
    expect(result.variants).toHaveProperty('large');
    expect(result.variants.thumb.url).toContain('thumb.webp');
    expect(result.variants.large.url).toContain('large.webp');
  });
});
