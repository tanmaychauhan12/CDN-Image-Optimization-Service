const request = require('supertest');

jest.mock('../../src/services/s3Service', () => ({
  checkS3Connection: jest.fn().mockResolvedValue({ ok: true }),
}));

const app = require('../../src/app');
const s3Service = require('../../src/services/s3Service');

describe('Health Check Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /api/v1/health should return 200 and health info when S3 is up', async () => {
    s3Service.checkS3Connection.mockResolvedValueOnce({ ok: true });

    const res = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(200);

    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('services');
    expect(res.body.services).toHaveProperty('s3', 'ok');
  });

  it('GET /api/v1/health should return 503 when S3 is degraded', async () => {
    s3Service.checkS3Connection.mockRejectedValueOnce(new Error('S3 Connection Timeout'));

    const res = await request(app)
      .get('/api/v1/health')
      .expect('Content-Type', /json/)
      .expect(503);

    expect(res.body).toHaveProperty('status', 'degraded');
    expect(res.body.services).toHaveProperty('s3', 'error');
  });

  it('GET /api/v1/non-existent-route should return 404', async () => {
    const res = await request(app)
      .get('/api/v1/non-existent-route')
      .expect(404);

    expect(res.body).toHaveProperty('error', 'NotFoundError');
    expect(res.body.message).toContain('Cannot find requested route');
  });
});
