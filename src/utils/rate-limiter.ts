/**
 * Rate limiter utility for API calls with exponential backoff
 */

interface RateLimiterOptions {
  maxRequestsPerMinute: number;
  retryDelayMs?: number;
  maxRetries?: number;
  exponentialBackoffBase?: number;
}

interface RequestMetrics {
  timestamp: number;
  count: number;
}

export class RateLimiter {
  private readonly maxRequestsPerMinute: number;
  private readonly retryDelayMs: number;
  private readonly maxRetries: number;
  private readonly exponentialBackoffBase: number;
  private requestHistory: RequestMetrics[] = [];

  constructor(options: RateLimiterOptions) {
    this.maxRequestsPerMinute = options.maxRequestsPerMinute;
    this.retryDelayMs = options.retryDelayMs ?? 1000;
    this.maxRetries = options.maxRetries ?? 5;
    this.exponentialBackoffBase = options.exponentialBackoffBase ?? 2;
  }

  /**
   * Execute a function with rate limiting and exponential backoff
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    let retryCount = 0;

    while (retryCount <= this.maxRetries) {
      // biome-ignore lint/nursery/noAwaitInLoop: Sequential retry logic requires await in loop
      await this.waitIfNeeded();

      try {
        const result = await fn();
        this.recordRequest();
        return result;
      } catch (error: unknown) {
        const isRateLimitError = this.isRateLimitError(error);

        if (isRateLimitError && retryCount < this.maxRetries) {
          const delayMs = this.calculateBackoffDelay(retryCount);
          console.warn(
            `Rate limit exceeded. Retrying in ${delayMs}ms (attempt ${retryCount + 1}/${this.maxRetries + 1})`
          );
          await this.sleep(delayMs);
          retryCount++;
          continue;
        }

        throw error;
      }
    }

    throw new Error(
      `Max retries (${this.maxRetries}) exceeded for rate-limited request`
    );
  }

  /**
   * Check if an error is a rate limit error (429 status or quota exceeded)
   */
  private isRateLimitError(error: unknown): boolean {
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

    // Handle Google API quota exceeded errors
    if (error instanceof Error && error.message) {
      return (
        error.message.includes('Quota exceeded') ||
        error.message.includes('quota metric') ||
        error.message.includes('Critical read requests')
      );
    }

    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoffDelay(retryCount: number): number {
    return this.retryDelayMs * this.exponentialBackoffBase ** retryCount;
  }

  /**
   * Wait if we've hit the rate limit based on request history
   */
  private async waitIfNeeded(): Promise<void> {
    this.cleanOldRequests();

    const currentRequestCount = this.requestHistory.reduce(
      (sum, metric) => sum + metric.count,
      0
    );

    if (currentRequestCount >= this.maxRequestsPerMinute) {
      const oldestRequest = this.requestHistory[0];
      const waitTime = 60_000 - (Date.now() - oldestRequest.timestamp);

      if (waitTime > 0) {
        console.log(
          `Rate limit approached (${currentRequestCount}/${this.maxRequestsPerMinute} requests). Waiting ${waitTime}ms...`
        );
        await this.sleep(waitTime);
        this.cleanOldRequests();
      }
    }
  }

  /**
   * Record a successful request
   */
  private recordRequest(): void {
    const now = Date.now();
    this.requestHistory.push({ timestamp: now, count: 1 });
    this.cleanOldRequests();
  }

  /**
   * Remove requests older than 60 seconds
   */
  private cleanOldRequests(): void {
    const cutoff = Date.now() - 60_000; // 60 seconds ago
    this.requestHistory = this.requestHistory.filter(
      (metric) => metric.timestamp > cutoff
    );
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get current request count in the last minute
   */
  getCurrentRequestCount(): number {
    this.cleanOldRequests();
    return this.requestHistory.reduce((sum, metric) => sum + metric.count, 0);
  }
}

// Pre-configured rate limiters for Google Chat API
export const googleChatProjectRateLimiter = new RateLimiter({
  maxRequestsPerMinute: 2900, // Slightly under 3000 to provide buffer
  retryDelayMs: 1000,
  maxRetries: 5,
  exponentialBackoffBase: 2,
});

export const googleChatSpaceRateLimiter = new RateLimiter({
  maxRequestsPerMinute: 850, // Slightly under 900 to provide buffer
  retryDelayMs: 1000,
  maxRetries: 5,
  exponentialBackoffBase: 2,
});

// People API has much stricter rate limits for contact/profile reads
export const googlePeopleApiRateLimiter = new RateLimiter({
  maxRequestsPerMinute: 80, // Well under 90 to provide buffer
  retryDelayMs: 2000, // Longer retry delay
  maxRetries: 3,
  exponentialBackoffBase: 3, // More aggressive backoff
});
