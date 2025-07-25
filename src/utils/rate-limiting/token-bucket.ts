/**
 * Token bucket implementation for rate limiting
 * Uses functional programming patterns following project guidelines
 */

import type { RateLimitConfig, TokenBucket } from './types';

// Internal state for token bucket
interface TokenBucketState {
  tokens: number;
  lastRefillTime: number;
}

// Sleep utility function
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Calculate tokens to add based on time elapsed
const calculateTokensToAdd = (
  lastRefillTime: number,
  refillRate: number,
  capacity: number,
  currentTokens: number
): { newTokens: number; newRefillTime: number } => {
  const now = Date.now();
  const timeDelta = (now - lastRefillTime) / 1000; // Convert to seconds
  const tokensToAdd = Math.floor(timeDelta * refillRate);
  const newTokens = Math.min(capacity, currentTokens + tokensToAdd);

  return {
    newTokens,
    newRefillTime: now,
  };
};

// Calculate exponential backoff delay
const calculateBackoffDelay = (
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number
): number => {
  const exponentialDelay = baseDelayMs * 2 ** attempt;
  return Math.min(exponentialDelay, maxDelayMs);
};

// Check if an error is a rate limit error
const isRateLimitError = (error: unknown): boolean => {
  // Handle Google API GaxiosError
  if (error && typeof error === 'object' && 'response' in error) {
    const gaxiosError = error as { response?: { status?: number } };
    return gaxiosError.response?.status === 429;
  }

  // Handle standard HTTP errors
  if (error && typeof error === 'object' && 'status' in error) {
    const httpError = error as { status?: number };
    return httpError.status === 429;
  }

  // Handle Slack API WebAPIHTTPError
  if (error && typeof error === 'object' && 'code' in error) {
    const slackError = error as { code?: string };
    return slackError.code === 'slack_webapi_rate_limited';
  }

  // Handle Google API quota exceeded errors
  if (error instanceof Error && error.message) {
    return (
      error.message.includes('Quota exceeded') ||
      error.message.includes('quota metric') ||
      error.message.includes('Critical read requests') ||
      error.message.includes('rate_limited') ||
      error.message.includes('Rate limit exceeded')
    );
  }

  return false;
};

// Create a token bucket with functional interface
export function createTokenBucket(config: RateLimitConfig): TokenBucket {
  const state: TokenBucketState = {
    tokens: config.capacity,
    lastRefillTime: Date.now(),
  };

  const refillTokens = (): void => {
    const { newTokens, newRefillTime } = calculateTokensToAdd(
      state.lastRefillTime,
      config.refillRate,
      config.capacity,
      state.tokens
    );

    state.tokens = newTokens;
    state.lastRefillTime = newRefillTime;
  };

  const acquireToken = async (): Promise<void> => {
    let attempt = 0;

    while (attempt <= config.maxRetries) {
      // Refill tokens based on elapsed time
      refillTokens();

      // Check if token is available
      if (state.tokens >= 1) {
        state.tokens -= 1;
        return;
      }

      // If no tokens available, wait and retry
      if (attempt < config.maxRetries) {
        const delayMs = calculateBackoffDelay(
          attempt,
          config.baseDelayMs,
          config.maxDelayMs
        );
        // biome-ignore lint/nursery/noAwaitInLoop: Rate limiting requires sequential waits
        await sleep(delayMs);
        attempt++;
      } else {
        throw new Error(
          `Rate limit exceeded: No tokens available after ${config.maxRetries} retries`
        );
      }
    }
  };

  const getAvailableTokens = (): number => {
    refillTokens();
    return state.tokens;
  };

  return {
    acquireToken,
    getAvailableTokens,
  };
}

// Create a rate-limited executor function
export function createRateLimitedExecutor<T>(
  tokenBucket: TokenBucket,
  config: RateLimitConfig
) {
  return async (fn: () => Promise<T>): Promise<T> => {
    let attempt = 0;

    while (attempt <= config.maxRetries) {
      try {
        // Acquire token before executing
        // biome-ignore lint/nursery/noAwaitInLoop: Rate limiting requires sequential token acquisition
        await tokenBucket.acquireToken();

        // Execute the function
        return await fn();
      } catch (error: unknown) {
        const isRateLimit = isRateLimitError(error);

        if (isRateLimit && attempt < config.maxRetries) {
          const delayMs = calculateBackoffDelay(
            attempt,
            config.baseDelayMs,
            config.maxDelayMs
          );

          console.warn(
            `Rate limit hit. Retrying in ${delayMs}ms (attempt ${attempt + 1}/${config.maxRetries + 1})`
          );

          await sleep(delayMs);
          attempt++;
          continue;
        }

        // Re-throw if not a rate limit error or max retries exceeded
        throw error;
      }
    }

    throw new Error(
      `Rate limit exceeded: Max retries (${config.maxRetries}) exceeded`
    );
  };
}
