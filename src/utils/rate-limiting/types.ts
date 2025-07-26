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

// API service identifiers (legacy - for Google APIs)
export const API_SERVICES = {
  GOOGLE_CHAT: 'google-chat',
  GOOGLE_DIRECTORY: 'google-directory',
  SLACK: 'slack',
} as const;

export type ApiService = (typeof API_SERVICES)[keyof typeof API_SERVICES];

// Slack API endpoints organized by official rate limit tiers
export const SLACK_API_ENDPOINTS = {
  // Special tier - unique rate limiting per method
  CHAT_POST_MESSAGE: 'chat.postMessage',

  // Tier 3 - 50+ requests per minute
  REACTIONS_ADD: 'reactions.add',

  // Tier 4 - 100+ requests per minute
  FILES_GET_UPLOAD_URL_EXTERNAL: 'files.getUploadURLExternal',
  FILES_COMPLETE_UPLOAD_EXTERNAL: 'files.completeUploadExternal',

  // Other commonly used endpoints (add as needed)
  CONVERSATIONS_LIST: 'conversations.list',
  CONVERSATIONS_CREATE: 'conversations.create',
  CONVERSATIONS_INFO: 'conversations.info',
  CONVERSATIONS_SET_PURPOSE: 'conversations.setPurpose',
  CONVERSATIONS_ARCHIVE: 'conversations.archive',
  AUTH_TEST: 'auth.test',
} as const;

export type SlackApiEndpoint =
  (typeof SLACK_API_ENDPOINTS)[keyof typeof SLACK_API_ENDPOINTS];

// Slack API rate limit tiers based on official documentation
export const SLACK_RATE_LIMIT_TIERS = {
  TIER_1: 'tier1', // 1+ per minute
  TIER_2: 'tier2', // 20+ per minute
  TIER_3: 'tier3', // 50+ per minute
  TIER_4: 'tier4', // 100+ per minute
  SPECIAL: 'special', // Varies by method
} as const;

export type SlackRateLimitTier =
  (typeof SLACK_RATE_LIMIT_TIERS)[keyof typeof SLACK_RATE_LIMIT_TIERS];

// Mapping of Slack API endpoints to their official rate limit tiers
export const SLACK_ENDPOINT_TO_TIER: Record<
  SlackApiEndpoint,
  SlackRateLimitTier
> = {
  [SLACK_API_ENDPOINTS.CHAT_POST_MESSAGE]: SLACK_RATE_LIMIT_TIERS.SPECIAL,
  [SLACK_API_ENDPOINTS.REACTIONS_ADD]: SLACK_RATE_LIMIT_TIERS.TIER_3,
  [SLACK_API_ENDPOINTS.FILES_GET_UPLOAD_URL_EXTERNAL]:
    SLACK_RATE_LIMIT_TIERS.TIER_4,
  [SLACK_API_ENDPOINTS.FILES_COMPLETE_UPLOAD_EXTERNAL]:
    SLACK_RATE_LIMIT_TIERS.TIER_4,
  [SLACK_API_ENDPOINTS.CONVERSATIONS_LIST]: SLACK_RATE_LIMIT_TIERS.TIER_2,
  [SLACK_API_ENDPOINTS.CONVERSATIONS_CREATE]: SLACK_RATE_LIMIT_TIERS.TIER_2,
  [SLACK_API_ENDPOINTS.CONVERSATIONS_INFO]: SLACK_RATE_LIMIT_TIERS.TIER_3,
  [SLACK_API_ENDPOINTS.CONVERSATIONS_SET_PURPOSE]:
    SLACK_RATE_LIMIT_TIERS.TIER_3,
  [SLACK_API_ENDPOINTS.CONVERSATIONS_ARCHIVE]: SLACK_RATE_LIMIT_TIERS.TIER_3,
  [SLACK_API_ENDPOINTS.AUTH_TEST]: SLACK_RATE_LIMIT_TIERS.TIER_4,
} as const;

// Rate limit configurations based on Slack's official tier system
export const SLACK_TIER_CONFIGS: Record<SlackRateLimitTier, RateLimitConfig> = {
  [SLACK_RATE_LIMIT_TIERS.TIER_1]: {
    capacity: 2, // Small burst capacity
    refillRate: 1 / 60, // ~1 request per minute
    maxRetries: 3,
    baseDelayMs: 5000, // 5 second base delay
    maxDelayMs: 300_000, // 5 minute max delay
  },
  [SLACK_RATE_LIMIT_TIERS.TIER_2]: {
    capacity: 5, // Moderate burst capacity
    refillRate: 20 / 60, // 20 requests per minute (~0.33/sec)
    maxRetries: 3,
    baseDelayMs: 3000, // 3 second base delay
    maxDelayMs: 180_000, // 3 minute max delay
  },
  [SLACK_RATE_LIMIT_TIERS.TIER_3]: {
    capacity: 10, // Good burst capacity
    refillRate: 50 / 60, // 50 requests per minute (~0.83/sec)
    maxRetries: 5,
    baseDelayMs: 2000, // 2 second base delay
    maxDelayMs: 120_000, // 2 minute max delay
  },
  [SLACK_RATE_LIMIT_TIERS.TIER_4]: {
    capacity: 20, // High burst capacity
    refillRate: 100 / 60, // 100 requests per minute (~1.67/sec)
    maxRetries: 5,
    baseDelayMs: 1000, // 1 second base delay
    maxDelayMs: 60_000, // 1 minute max delay
  },
  [SLACK_RATE_LIMIT_TIERS.SPECIAL]: {
    // chat.postMessage: 1 message per second per channel with burst behavior
    capacity: 3, // Conservative burst for channel-specific limiting
    refillRate: 1, // 1 request per second (as documented)
    maxRetries: 5,
    baseDelayMs: 1000, // 1 second base delay
    maxDelayMs: 30_000, // 30 second max delay
  },
} as const;

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
