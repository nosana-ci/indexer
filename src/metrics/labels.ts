export const MIN_PUBKEY_LENGTH = 32;
export const MAX_PUBKEY_LENGTH = 44;

/**
 * Extracts a route pattern from a URL pathname by replacing dynamic segments
 * (numeric IDs, Solana addresses, invitation tokens) with placeholders.
 *
 * Fixes vs dashboard-backend reference:
 *   - /^\d+$/ (correct digit regex) instead of /^\\d+$/ (literal backslash-d)
 *   - Trailing slash stripped before segment processing
 */
export function extractRoutePattern(pathname: string): string {
  const cleanPath = pathname.split("?")[0];

  const normalizedPath =
    cleanPath.endsWith("/") && cleanPath.length > 1 ? cleanPath.slice(0, -1) : cleanPath;

  const segments = normalizedPath.split("/");

  const processedSegments = segments.map((segment) => {
    if (!segment) return segment;

    if (/^\d+$/.test(segment)) {
      return ":id";
    }

    if (segment.length === 64 && /^[a-zA-Z0-9]+$/.test(segment)) {
      return ":invitation-token";
    }

    if (
      segment.length >= MIN_PUBKEY_LENGTH &&
      segment.length <= MAX_PUBKEY_LENGTH &&
      /^[a-zA-Z0-9]+$/.test(segment)
    ) {
      return ":address";
    }

    return segment;
  });

  return processedSegments.join("/");
}

export type StatusRange = "1xx" | "2xx" | "3xx" | "4xx" | "5xx";

export function statusRange(code: number): StatusRange {
  if (code >= 500) return "5xx";
  if (code >= 400) return "4xx";
  if (code >= 300) return "3xx";
  if (code >= 200) return "2xx";
  return "1xx";
}
