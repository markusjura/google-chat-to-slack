/**
 * Tests for the new functional rate limiter
 */

import { beforeEach, describe, expect, test } from 'vitest';
import {
  API_SERVICES,
  configureForExport,
  configureForImport,
  createTokenBucket,
  getRateLimiterManager,
  type RateLimitConfig,
  resetRateLimiter,
} from '../../utils/rate-limiting';

describe('Rate Limiting', () => {
  beforeEach(() => {
    resetRateLimiter();
  });

  describe('Token Bucket', () => {
    test('should allow requests when tokens are available', async () => {
      const config: RateLimitConfig = {
        capacity: 10,
        refillRate: 5,
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      };

      const tokenBucket = createTokenBucket(config);

      // Should be able to acquire a token immediately
      await expect(tokenBucket.acquireToken()).resolves.toBeUndefined();

      // Check available tokens decreased
      expect(tokenBucket.getAvailableTokens()).toBe(9);
    });

    test('should refill tokens over time', async () => {
      const config: RateLimitConfig = {
        capacity: 5,
        refillRate: 10, // 10 tokens per second
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      };

      const tokenBucket = createTokenBucket(config);

      // Use all tokens
      await Promise.all(
        Array.from({ length: 5 }, () => tokenBucket.acquireToken())
      );

      expect(tokenBucket.getAvailableTokens()).toBe(0);

      // Wait for tokens to refill (100ms should give us 1 token at 10/second)
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(tokenBucket.getAvailableTokens()).toBeGreaterThan(0);
    });

    test('should not exceed capacity when refilling', async () => {
      const config: RateLimitConfig = {
        capacity: 3,
        refillRate: 10,
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 1000,
      };

      const tokenBucket = createTokenBucket(config);

      // Wait long enough to generate more tokens than capacity
      await new Promise((resolve) => setTimeout(resolve, 500));

      expect(tokenBucket.getAvailableTokens()).toBe(3);
    });
  });

  describe('Rate Limiter Manager', () => {
    test('should initialize services with default configurations', async () => {
      const manager = getRateLimiterManager();

      // Should be able to acquire tokens for any service
      await expect(
        manager.acquireToken(API_SERVICES.GOOGLE_CHAT)
      ).resolves.toBeUndefined();

      await expect(
        manager.acquireToken(API_SERVICES.SLACK)
      ).resolves.toBeUndefined();
    });

    test('should provide status information', () => {
      const manager = getRateLimiterManager();

      const status = manager.getStatus(API_SERVICES.GOOGLE_CHAT);

      expect(status).toHaveProperty('available');
      expect(status).toHaveProperty('capacity');
      expect(typeof status.available).toBe('number');
      expect(typeof status.capacity).toBe('number');
    });

    test('should allow custom configuration', () => {
      const manager = getRateLimiterManager();

      const customConfig: RateLimitConfig = {
        capacity: 100,
        refillRate: 20,
        maxRetries: 5,
        baseDelayMs: 500,
        maxDelayMs: 5000,
      };

      manager.configure(API_SERVICES.GOOGLE_CHAT, customConfig);

      const status = manager.getStatus(API_SERVICES.GOOGLE_CHAT);
      expect(status.capacity).toBe(100);
    });
  });

  describe('Command Configuration', () => {
    test('should configure export rate limits', () => {
      configureForExport();

      const manager = getRateLimiterManager();

      // Should be able to get status for Google services
      const googleChatStatus = manager.getStatus(API_SERVICES.GOOGLE_CHAT);
      const googleDirectoryStatus = manager.getStatus(
        API_SERVICES.GOOGLE_DIRECTORY
      );

      expect(googleChatStatus.capacity).toBeGreaterThan(0);
      expect(googleDirectoryStatus.capacity).toBeGreaterThan(0);
    });

    test('should configure import rate limits', () => {
      configureForImport();

      const manager = getRateLimiterManager();

      // Should be able to get status for Slack service
      const slackStatus = manager.getStatus(API_SERVICES.SLACK);

      expect(slackStatus.capacity).toBeGreaterThan(0);
    });

    test('should accept custom overrides', () => {
      configureForExport({
        googleChat: {
          capacity: 200,
          refillRate: 100,
        },
      });

      const manager = getRateLimiterManager();
      const status = manager.getStatus(API_SERVICES.GOOGLE_CHAT);

      expect(status.capacity).toBe(200);
    });
  });
});
