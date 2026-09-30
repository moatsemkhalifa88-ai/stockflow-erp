/**
 * Right after a sign-in or token refresh, the new access token is stamped with
 * Supabase Auth's clock. Now and then that clock runs seconds ahead of the
 * database API's, and the API rejects the brand-new token with
 * 401 "JWT issued at future" until its own clock catches up. The first page
 * after login runs many queries at once, so one of them occasionally hit that
 * window and the page failed.
 *
 * This fetch retries exactly that response. The wait is measured, not guessed:
 * the token says when it was issued and the 401's Date header says what time
 * the API thinks it is. Every other response, including other 401s, is
 * returned untouched.
 */
const CLOCK_SKEW_MESSAGE = "JWT issued at future";
const MAX_RETRIES = 3;
/** Used when the token or the Date header can't be read. */
const FALLBACK_DELAYS_MS = [1000, 2000, 4000];
const MIN_WAIT_MS = 250;
/** A page that waits this long is slow, but better than an error screen; beyond it, give up. */
const MAX_WAIT_MS = 15_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The "iat" (issued at, in seconds) of the bearer token on the request, if there is one. */
function tokenIssuedAt(input: RequestInfo | URL, init?: RequestInit): number | null {
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  const token = headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  try {
    // atob, not Buffer: the browser client uses this fetch too.
    const base64 = (token.split(".")[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
    const payload: unknown = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const iat = typeof payload === "object" && payload !== null && "iat" in payload ? payload.iat : null;
    return typeof iat === "number" ? iat : null;
  } catch {
    return null;
  }
}

/** How long until the API's clock passes the token's issue time, plus a second of margin. */
export function skewWaitMs(iat: number | null, apiDate: string | null, retry: number): number {
  const apiNow = apiDate ? Date.parse(apiDate) / 1000 : Number.NaN;
  if (iat === null || Number.isNaN(apiNow)) return FALLBACK_DELAYS_MS[Math.min(retry, FALLBACK_DELAYS_MS.length - 1)];
  return Math.min(MAX_WAIT_MS, Math.max(MIN_WAIT_MS, Math.ceil((iat - apiNow + 1) * 1000)));
}

export function withClockSkewRetry(
  baseFetch: typeof fetch = fetch,
  sleep: (ms: number) => Promise<void> = wait,
): typeof fetch {
  return async (input, init) => {
    let response = await baseFetch(input, init);
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      if (response.status !== 401) return response;
      const body = await response.clone().text();
      if (!body.includes(CLOCK_SKEW_MESSAGE)) return response;
      const delay = skewWaitMs(tokenIssuedAt(input, init), response.headers.get("date"), retry);
      console.warn(`Supabase rejected a new token as issued in the future (clock skew); retrying in ${delay}ms`);
      await sleep(delay);
      response = await baseFetch(input, init);
    }
    return response;
  };
}
