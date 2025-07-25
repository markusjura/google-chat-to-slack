/**
 * Rate limiting types and interfaces
 */

// Rate limit configuration for different APIs
export interface RateLimitConfig {
  readonly capacity: number; // Maximum tokens in bucket
  readonly refillRate: number; // Tokens per second
  readonly maxRetries: number; // Maximum retry attempts
  readonly baseDelayMs: number; // Base delay for exponential backoff
  readonly maxDelayMs: number; // Maximum delay between retries
}

// Token bucket state
export interface TokenBucket {
  readonly acquireToken: () => Promise<void>;
  readonly getAvailableTokens: () => number;
}

// API service identifiers
export const API_SERVICES = {
  GOOGLE_CHAT: 'google-chat',
  GOOGLE_DIRECTORY: 'google-directory',
  SLACK: 'slack',
} as const;

export type ApiService = (typeof API_SERVICES)[keyof typeof API_SERVICES];

// Rate limiter manager interface
export interface RateLimiterManager {
  readonly acquireToken: (service: ApiService) => Promise<void>;
  readonly configure: (service: ApiService, config: RateLimitConfig) => void;
  readonly getStatus: (service: ApiService) => {
    available: number;
    capacity: number;
  };
}

// Command-level rate limit configurations
export interface CommandRateLimits {
  readonly googleChat?: Partial<RateLimitConfig>;
  readonly googleDirectory?: Partial<RateLimitConfig>;
  readonly slack?: Partial<RateLimitConfig>;
  readonly maxConcurrentOperations?: number;
}

// Error types for rate limiting
export interface RateLimitError extends Error {
  readonly isRateLimitError: true;
  readonly retryAfterMs?: number;
  readonly service: ApiService;
}
