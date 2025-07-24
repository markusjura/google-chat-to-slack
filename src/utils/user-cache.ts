/**
 * User cache utility to prevent redundant API calls to Google Directory API
 */

import type { User } from '../types/google-chat';

interface CacheEntry {
  user?: User;
  timestamp: number;
  attempts: number;
}

export class UserCache {
  private cache = new Map<string, CacheEntry>();
  private readonly cacheExpiryMs: number;
  private readonly maxAttempts: number;

  constructor(cacheExpiryMs = 300_000, maxAttempts = 3) {
    // 5 minutes default (test modification)
    this.cacheExpiryMs = cacheExpiryMs;
    this.maxAttempts = maxAttempts;
  }

  /**
   * Get user from cache if available and not expired
   */
  get(userId: string): User | undefined {
    const entry = this.cache.get(userId);

    if (!entry) {
      return; // Not cached
    }

    const isExpired = Date.now() - entry.timestamp > this.cacheExpiryMs;
    const maxAttemptsReached = entry.attempts >= this.maxAttempts;

    if (isExpired || maxAttemptsReached) {
      this.cache.delete(userId);
      return; // Expired or too many failed attempts
    }

    return entry.user;
  }

  /**
   * Set user in cache
   */
  set(userId: string, user?: User, isError = false): void {
    const existing = this.cache.get(userId);
    const attempts = isError ? (existing?.attempts ?? 0) + 1 : 0;

    this.cache.set(userId, {
      user,
      timestamp: Date.now(),
      attempts,
    });
  }

  /**
   * Check if user should be skipped due to repeated failures
   */
  shouldSkip(userId: string): boolean {
    const entry = this.cache.get(userId);
    return entry ? entry.attempts >= this.maxAttempts : false;
  }

  /**
   * Clear expired entries from cache
   */
  cleanup(): void {
    const now = Date.now();
    for (const [userId, entry] of Array.from(this.cache.entries())) {
      if (now - entry.timestamp > this.cacheExpiryMs) {
        this.cache.delete(userId);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; hitRate?: number } {
    return {
      size: this.cache.size,
      // TODO: Track hit rate in future version (test change)
    };
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
  }
}

// Global user cache instance
export const userCache = new UserCache();
