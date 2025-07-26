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
    capacity: 5, // Burst capacity to prevent hitting channel-specific limits
    refillRate: 1, // 1 request per second (matches Slack's effective per-channel limit)
    maxRetries: 5, // Increased retries for better reliability
    baseDelayMs: 2000, // 2 second base delay for better backoff
    maxDelayMs: 60_000, // 60 second max delay for rate limit recovery
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
    capacity: 3, // Very small burst to prevent channel rate limit hits
    refillRate: 0.8, // 0.8 requests per second (more conservative for import operations)
  },
  maxConcurrentOperations: 1, // Process channels sequentially to avoid cross-channel interference
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
