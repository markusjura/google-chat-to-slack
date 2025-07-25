/**
 * Rate limiter manager - Global coordinator for all rate limiting
 * Uses functional programming patterns following project guidelines
 */

import { getDefaultConfig, mergeConfigWithDefaults } from './config';
import { createRateLimitedExecutor, createTokenBucket } from './token-bucket';
import type {
  ApiService,
  CommandRateLimits,
  RateLimitConfig,
  RateLimiterManager,
  TokenBucket,
} from './types';
import { API_SERVICES } from './types';

// Global state for rate limiter manager
interface RateLimiterState {
  tokenBuckets: Map<ApiService, TokenBucket>;
  executors: Map<ApiService, ReturnType<typeof createRateLimitedExecutor>>;
  configs: Map<ApiService, RateLimitConfig>;
}

// Create initial state
const createInitialState = (): RateLimiterState => ({
  tokenBuckets: new Map(),
  executors: new Map(),
  configs: new Map(),
});

// Global singleton state
let globalState: RateLimiterState = createInitialState();

// Initialize a service with its configuration
const initializeService = (
  service: ApiService,
  config: RateLimitConfig
): void => {
  const tokenBucket = createTokenBucket(config);
  const executor = createRateLimitedExecutor(tokenBucket, config);

  globalState.tokenBuckets.set(service, tokenBucket);
  globalState.executors.set(service, executor);
  globalState.configs.set(service, config);
};

// Ensure a service is initialized with default config if not already
const ensureServiceInitialized = (service: ApiService): void => {
  if (!globalState.tokenBuckets.has(service)) {
    const defaultConfig = getDefaultConfig(service);
    initializeService(service, defaultConfig);
  }
};

// Create the rate limiter manager
export function createRateLimiterManager(): RateLimiterManager {
  const configure = (service: ApiService, config: RateLimitConfig): void => {
    initializeService(service, config);
  };

  const acquireToken = async (service: ApiService): Promise<void> => {
    ensureServiceInitialized(service);
    const tokenBucket = globalState.tokenBuckets.get(service);
    if (!tokenBucket) {
      throw new Error(`Token bucket not initialized for service: ${service}`);
    }
    await tokenBucket.acquireToken();
  };

  const getStatus = (
    service: ApiService
  ): { available: number; capacity: number } => {
    ensureServiceInitialized(service);
    const tokenBucket = globalState.tokenBuckets.get(service);
    const config = globalState.configs.get(service);

    if (!tokenBucket) {
      throw new Error(`Token bucket not initialized for service: ${service}`);
    }

    if (!config) {
      throw new Error(`Config not initialized for service: ${service}`);
    }

    return {
      available: tokenBucket.getAvailableTokens(),
      capacity: config.capacity,
    };
  };

  return {
    configure,
    acquireToken,
    getStatus,
  };
}

// Global rate limiter manager instance
let rateLimiterManager: RateLimiterManager | null = null;

// Get the global rate limiter manager (singleton)
export function getRateLimiterManager(): RateLimiterManager {
  if (!rateLimiterManager) {
    rateLimiterManager = createRateLimiterManager();
  }
  return rateLimiterManager;
}

// Configure rate limiter for export command
export function configureForExport(overrides?: CommandRateLimits): void {
  const manager = getRateLimiterManager();

  // Configure Google Chat service
  const googleChatConfig = mergeConfigWithDefaults(
    API_SERVICES.GOOGLE_CHAT,
    overrides?.googleChat
  );
  manager.configure(API_SERVICES.GOOGLE_CHAT, googleChatConfig);

  // Configure Google Directory service
  const googleDirectoryConfig = mergeConfigWithDefaults(
    API_SERVICES.GOOGLE_DIRECTORY,
    overrides?.googleDirectory
  );
  manager.configure(API_SERVICES.GOOGLE_DIRECTORY, googleDirectoryConfig);
}

// Configure rate limiter for import command
export function configureForImport(overrides?: CommandRateLimits): void {
  const manager = getRateLimiterManager();

  // Configure Slack service
  const slackConfig = mergeConfigWithDefaults(
    API_SERVICES.SLACK,
    overrides?.slack
  );
  manager.configure(API_SERVICES.SLACK, slackConfig);
}

// Execute a function with rate limiting for a specific service
export async function executeWithRateLimit<T>(
  service: ApiService,
  fn: () => Promise<T>
): Promise<T> {
  const manager = getRateLimiterManager();

  // Acquire token before execution
  await manager.acquireToken(service);

  // Execute the function
  return await fn();
}

// Helper functions for common API calls
export const withGoogleChatRateLimit = <T>(fn: () => Promise<T>): Promise<T> =>
  executeWithRateLimit(API_SERVICES.GOOGLE_CHAT, fn);

export const withGoogleDirectoryRateLimit = <T>(
  fn: () => Promise<T>
): Promise<T> => executeWithRateLimit(API_SERVICES.GOOGLE_DIRECTORY, fn);

export const withSlackRateLimit = <T>(fn: () => Promise<T>): Promise<T> =>
  executeWithRateLimit(API_SERVICES.SLACK, fn);

// Reset the global state (useful for testing)
export function resetRateLimiter(): void {
  globalState = createInitialState();
  rateLimiterManager = null;
}
