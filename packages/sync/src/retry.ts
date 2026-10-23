/** Bounded GET retry for transient registry failures; never retries permanent
 * HTTP errors. Each request and each backoff has an upper bound. */

/**
 * Per-request ceiling. The nightly registry reconcile now walks a catalogue in
 * the tens of thousands, and a slow-but-responding deep page (the Oct 22-23
 * failures stalled on one) must not trip a 15s abort three times in a row and
 * abort the whole stage after 20+ successful minutes. 30s lets such a page
 * answer; overridable and clamped so it can never grow unbounded.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function requestTimeoutMs(): number {
  const parsed = Number(process.env.REGISTRY_REQUEST_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed >= 5_000
    ? Math.min(Math.floor(parsed), 120_000)
    : DEFAULT_REQUEST_TIMEOUT_MS;
}

export async function fetchWithRetry(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs()) });
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * 2 ** attempt));
      continue;
    }
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === 2) return response;
    const retryAfter = response.headers?.get('retry-after');
    const seconds = retryAfter ? Number(retryAfter) : NaN;
    const requestedDelay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter ?? '') - Date.now();
    const delay = Math.min(10_000, Math.max(1000 * 2 ** attempt, Number.isFinite(requestedDelay) ? requestedDelay : 0));
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error('Registry retry budget exhausted');
}
