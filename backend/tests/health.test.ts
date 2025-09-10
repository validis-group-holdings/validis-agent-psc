import { describe, it, expect } from '@jest/globals';

describe('Health Check', () => {
  it('should return true for basic test', () => {
    expect(true).toBe(true);
  });

  it('should perform basic math', () => {
    expect(2 + 2).toBe(4);
  });
});
