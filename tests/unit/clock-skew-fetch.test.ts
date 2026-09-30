import { describe, expect, it } from "vitest";
import { skewWaitMs, withClockSkewRetry } from "@/lib/supabase/clock-skew-fetch";

const API_NOW = Date.parse("2026-09-30T12:00:00Z");
const skew = () =>
  new Response(JSON.stringify({ code: "PGRST303", message: "JWT issued at future" }), {
    status: 401,
    headers: { date: new Date(API_NOW).toUTCString() },
  });
const ok = () => new Response("[]", { status: 200 });

/** A bearer token (unsigned; only the payload matters here) issued `ahead` seconds after the API's clock. */
function bearer(ahead: number): RequestInit {
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return { headers: { Authorization: `Bearer ${part({ alg: "none" })}.${part({ iat: API_NOW / 1000 + ahead })}.sig` } };
}

/** A fetch that answers with the given responses in order, counting calls. */
function scripted(...responses: (() => Response)[]) {
  let calls = 0;
  const fetchFn: typeof fetch = async () => responses[Math.min(calls++, responses.length - 1)]();
  return { fetchFn, calls: () => calls };
}

function recordSleeps() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => void waits.push(ms) };
}

describe("withClockSkewRetry", () => {
  it("waits until the API clock passes the token's issue time, then returns the success", async () => {
    const api = scripted(skew, ok);
    const { waits, sleep } = recordSleeps();
    const response = await withClockSkewRetry(api.fetchFn, sleep)("https://x/rest/v1/t", bearer(5));
    expect(response.status).toBe(200);
    expect(api.calls()).toBe(2);
    expect(waits).toEqual([6000]); // 5 s ahead + 1 s margin
  });

  it("gives up after three retries and returns the 401", async () => {
    const api = scripted(skew);
    const response = await withClockSkewRetry(api.fetchFn, recordSleeps().sleep)("https://x/rest/v1/t", bearer(1));
    expect(response.status).toBe(401);
    expect(api.calls()).toBe(4);
  });

  it("does not retry other 401s or other errors", async () => {
    for (const other of [
      () => new Response(JSON.stringify({ message: "JWT expired" }), { status: 401 }),
      () => new Response("boom", { status: 500 }),
    ]) {
      const api = scripted(other);
      const response = await withClockSkewRetry(api.fetchFn, recordSleeps().sleep)("https://x/rest/v1/t", bearer(1));
      expect(api.calls()).toBe(1);
      expect(await response.text()).not.toBe(""); // body still readable by the caller
    }
  });
});

describe("skewWaitMs", () => {
  const apiDate = new Date(API_NOW).toUTCString();
  const iat = (ahead: number) => API_NOW / 1000 + ahead;

  it("measures the wait from the token and the API's Date header", () => {
    expect(skewWaitMs(iat(2.5), apiDate, 0)).toBe(3500);
  });

  it("waits at least a moment, and at most 15 seconds", () => {
    expect(skewWaitMs(iat(-3), apiDate, 0)).toBe(250);
    expect(skewWaitMs(iat(600), apiDate, 0)).toBe(15_000);
  });

  it("falls back to growing delays when the token or the date can't be read", () => {
    expect([0, 1, 2, 5].map((retry) => skewWaitMs(null, apiDate, retry))).toEqual([1000, 2000, 4000, 4000]);
    expect(skewWaitMs(iat(2), null, 0)).toBe(1000);
  });
});
