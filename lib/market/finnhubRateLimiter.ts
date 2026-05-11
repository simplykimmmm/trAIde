type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

let nextRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();
const cache = new Map<string, CacheEntry<unknown>>();

export async function runFinnhubRequest<T>(fn: () => Promise<T>): Promise<T> {
  const scheduled = queue.catch(() => undefined).then(async () => {
    await waitForBudgetSlot();
    return await fn();
  });

  queue = scheduled.catch(() => undefined);

  return await scheduled;
}

export async function getFinnhubCached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const value = await runFinnhubRequest(loader);
  cache.set(key, {
    expiresAt: now + ttlMs,
    value,
  });

  return value;
}

async function waitForBudgetSlot(): Promise<void> {
  const now = Date.now();
  const waitMs = Math.max(nextRequestAt - now, 0);

  if (waitMs > 0) {
    await delay(waitMs);
  }

  nextRequestAt = Date.now() + getFinnhubSpacingMs();
}

function getFinnhubSpacingMs(): number {
  const requestsPerMinute = clampNumber(Number(process.env.FINNHUB_REQUESTS_PER_MINUTE ?? 50), 1, 60);
  const safetyBufferMs = clampNumber(Number(process.env.FINNHUB_RATE_LIMIT_SAFETY_MS ?? 250), 0, 5000);

  return Math.ceil(60_000 / requestsPerMinute) + safetyBufferMs;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}
