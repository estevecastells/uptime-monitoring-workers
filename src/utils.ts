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
 * Parse a URL and require an http(s) scheme with no embedded credentials.
 *
 * `new URL()` alone is not validation: it happily accepts `javascript:alert(1)`
 * and `file:///etc/passwd`, which would then be stored, rendered into an href,
 * and handed to fetch().
 *
 * Userinfo (`https://user:pass@host`) is rejected as well. A password there
 * would be written to the database in clear, printed into the dashboard and
 * its href, and — worst of all — copied into every Telegram and email alert
 * about that monitor. There is no way to monitor such a URL without spreading
 * the secret, so the URL is refused rather than silently stripped: quietly
 * dropping the credentials would just turn it into a check that fails to
 * authenticate.
 */
export function parseHttpUrl(raw: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!SAFE_SCHEMES.has(parsed.protocol)) return null;
  if (parsed.username || parsed.password) return null;
  return parsed;
}

/**
 * Render a stored URL as an href value. Anything that is not http(s) — which
 * should not exist post-validation, but may predate it — degrades to '#'
 * rather than becoming a script-executing link.
 */
export function safeHref(raw: string): string {
  return parseHttpUrl(raw) ? escapeHtml(raw) : '#';
}
