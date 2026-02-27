import type { Env } from '../types';

interface ZoneResult {
  name: string;
}

interface CFResponse {
  result: ZoneResult[];
  result_info: { total_pages: number };
  success: boolean;
}

export async function syncZones(env: Env): Promise<void> {
  const allDomains: { name: string; url: string }[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/zones?per_page=50&page=${page}&status=active`,
      {
        headers: {
          'X-Auth-Email': env.CLOUDFLARE_EMAIL,
          'X-Auth-Key': env.CLOUDFLARE_API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await resp.json() as CFResponse;
    if (!data.success) break;

    for (const zone of data.result) {
      allDomains.push({ name: zone.name, url: `https://${zone.name}` });
    }

    if (page >= data.result_info.total_pages) break;
    page++;
  }

  // Upsert each domain
  for (const domain of allDomains) {
    await env.DB.prepare(
      `INSERT INTO monitors (url, name, source) VALUES (?, ?, 'auto')
       ON CONFLICT(url) DO UPDATE SET name = excluded.name, updated_at = datetime('now')`
    ).bind(domain.url, domain.name).run();
  }

  // Deactivate auto-discovered monitors whose zones no longer exist
  if (allDomains.length > 0) {
    const urls = allDomains.map(d => d.url);
    const placeholders = urls.map(() => '?').join(',');
    await env.DB.prepare(
      `UPDATE monitors SET is_active = 0 WHERE source = 'auto' AND url NOT IN (${placeholders})`
    ).bind(...urls).run();

    // Re-activate auto monitors that are back
    await env.DB.prepare(
      `UPDATE monitors SET is_active = 1 WHERE source = 'auto' AND url IN (${placeholders})`
    ).bind(...urls).run();
  }
}
