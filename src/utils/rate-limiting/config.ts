/**
 * Rate limiting configuration for different APIs
 */

import type { ApiService, CommandRateLimits, RateLimitConfig } from './types';
import { API_SERVICES } from './types';

// Default rate limit configurations based on API documentation
const DEFAULT_CONFIGS: Record<ApiService, RateLimitConfig> = {
  [API_SERVICES.GOOGLE_CHAT]: {
    capacity: 50, // Burst capacity
    refillRate: 50, // 50 requests per second (3000/minute with buffer)
    maxRetries: 5,
    baseDelayMs: 1000, // 1 second base delay
    maxDelayMs: 30_000, // 30 second max delay
  },
  [API_SERVICES.GOOGLE_DIRECTORY]: {
    capacity: 10, // Lower burst for directory API
    refillRate: 1.5, // ~90 requests per minute (100/minute with buffer)
    maxRetries: 3,
    baseDelayMs: 2000, // 2 second base delay
    maxDelayMs: 60_000, // 1 minute max delay
  },
  [API_SERVICES.SLACK]: {
    capacity: 20, // Burst capacity for Slack (allows short bursts)
    refillRate: 3, // 3 requests per second (conservative vs workspace limit)
    maxRetries: 5, // Increased retries for better reliability
    baseDelayMs: 1000, // 1 second base delay
    maxDelayMs: 30_000, // 30 second max delay for rate limit recovery
  },
} as const;

// Export command configurations
export const EXPORT_RATE_LIMITS: CommandRateLimits = {
  googleChat: {
    capacity: 100, // Higher burst for export operations
    refillRate: 45, // Slightly more conservative for bulk operations
  },
  googleDirectory: {
    refillRate: 1.2, // More conservative for user lookups
  },
  maxConcurrentOperations: 5, // Process up to 5 spaces concurrently
} as const;

export const IMPORT_RATE_LIMITS: CommandRateLimits = {
  slack: {
    capacity: 20, // Allow burst behavior as documented by Slack
    refillRate: 3, // 3 requests per second (more conservative than workspace limit of ~5/sec)
  },
  maxConcurrentOperations: 3, // Process up to 3 channels concurrently
} as const;

// Function to get default configuration
export function getDefaultConfig(service: ApiService): RateLimitConfig {
  return DEFAULT_CONFIGS[service];
}

// Function to merge command-specific overrides with defaults
export function mergeConfigWithDefaults(
  service: ApiService,
  override?: Partial<RateLimitConfig>
): RateLimitConfig {
  const defaultConfig = getDefaultConfig(service);

  if (!override) {
    return defaultConfig;
  }

  return {
    capacity: override.capacity ?? defaultConfig.capacity,
    refillRate: override.refillRate ?? defaultConfig.refillRate,
    maxRetries: override.maxRetries ?? defaultConfig.maxRetries,
    baseDelayMs: override.baseDelayMs ?? defaultConfig.baseDelayMs,
    maxDelayMs: override.maxDelayMs ?? defaultConfig.maxDelayMs,
  };
}
