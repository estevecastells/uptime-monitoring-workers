/** Strip trailing slashes from a URL so https://x.com/ and https://x.com are treated as the same. */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '');
}
