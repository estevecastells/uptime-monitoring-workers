/** Strip trailing slashes from a URL so https://x.com/ and https://x.com are treated as the same. */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Escape a value for interpolation into HTML text or a quoted attribute.
 *
 * Every template in src/ui builds HTML with string interpolation, so anything
 * coming out of the database has to pass through here. Both quote styles are
 * escaped so the same function is safe in `<td>${x}</td>` and in
 * `title="${x}"`.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Schemes we are willing to monitor, and to emit into an href. */
const SAFE_SCHEMES = new Set(['http:', 'https:']);

/**
 * Parse a URL and require an http(s) scheme.
 *
 * `new URL()` alone is not validation: it happily accepts `javascript:alert(1)`
 * and `file:///etc/passwd`, which would then be stored, rendered into an href,
 * and handed to fetch().
 */
export function parseHttpUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  return SAFE_SCHEMES.has(parsed.protocol) ? parsed : null;
}

/**
 * Render a stored URL as an href value. Anything that is not http(s) — which
 * should not exist post-validation, but may predate it — degrades to '#'
 * rather than becoming a script-executing link.
 */
export function safeHref(raw: string): string {
  return parseHttpUrl(raw) ? escapeHtml(raw) : '#';
}
