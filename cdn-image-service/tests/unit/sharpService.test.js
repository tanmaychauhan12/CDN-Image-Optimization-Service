const sharpService = require('../../src/services/sharpService');

describe('SharpService Unit Tests', () => {
  it('should expose optimize and getMetadata functions', () => {
    expect(sharpService).toBeDefined();
    expect(typeof sharpService.optimize).toBe('function');
    expect(typeof sharpService.getMetadata).toBe('function');
  });
});
