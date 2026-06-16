const jwt = require('jsonwebtoken');
const authMiddleware = require('../../src/middleware/auth');

// Mock req, res, next
const mockRequest = (headers = {}) => ({
  headers,
});

const mockResponse = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const mockNext = jest.fn();

describe('Auth Middleware Unit Tests', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_for_local_development_only';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 401 if Authorization header is missing', () => {
    const req = mockRequest();
    const res = mockResponse();

    authMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'No token provided',
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('should return 401 if Bearer token structure is invalid', () => {
    const req = mockRequest({ authorization: 'InvalidTokenStructure' });
    const res = mockResponse();

    authMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'No token provided',
    });
  });

  it('should return 401 if token is expired', () => {
    const expiredToken = jwt.sign({ userId: '123' }, JWT_SECRET, { expiresIn: '-1s' });
    const req = mockRequest({ authorization: `Bearer ${expiredToken}` });
    const res = mockResponse();

    authMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Token has expired',
    });
  });

  it('should return 401 if token signature is invalid', () => {
    const invalidToken = jwt.sign({ userId: '123' }, 'wrong_secret');
    const req = mockRequest({ authorization: `Bearer ${invalidToken}` });
    const res = mockResponse();

    authMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized',
      message: 'Invalid token',
    });
  });

  it('should call next and set req.user if token is valid', () => {
    const validToken = jwt.sign({ userId: '123' }, JWT_SECRET);
    const req = mockRequest({ authorization: `Bearer ${validToken}` });
    const res = mockResponse();

    authMiddleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(req.user).toBeDefined();
    expect(req.user.userId).toBe('123');
  });
});
