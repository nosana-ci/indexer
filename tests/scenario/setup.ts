export const backendUrl: string = process.env.BACKEND_URL!;
export const testRunId = new Date().toISOString();

// A request to a stuck service fails after 30s, naming the URL, instead of
// holding its step until the test timeout. Callers passing a signal keep it.
const REQUEST_TIMEOUT_MS = 30_000;
const fetchWithoutTimeout = globalThis.fetch;

globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) =>
    fetchWithoutTimeout(input, {
      ...init,
      signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch((error: unknown) => {
      const url = input instanceof Request ? input.url : String(input);
      throw new Error(`Request to ${url} failed: ${String(error)}`, { cause: error });
    }),
  fetchWithoutTimeout,
);
