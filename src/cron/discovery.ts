import type { Env, CfAccount } from '../types';
import { getCfAccounts } from '../db/queries';
import { normalizeUrl } from '../utils';

interface ZoneResult {
  name: string;
}

interface CFResponse {
  result: ZoneResult[];
  result_info: { total_pages: number };
  success: boolean;
}

async function fetchZonesForAccount(account: CfAccount): Promise<{ name: string; url: string }[]> {
  const domains: { name: string; url: string }[] = [];
  let page = 1;

  while (true) {
    const resp = await fetch(
      `https://api.cloudflare.com/client/v4/zones?per_page=50&page=${page}&status=active`,
      {
        headers: {
          'X-Auth-Email': account.email,
          'X-Auth-Key': account.api_key,
          'Content-Type': 'application/json',
        },
      }
    );

    const data = await resp.json() as CFResponse;
    if (!data.success) break;

    for (const zone of data.result) {
      domains.push({ name: zone.name, url: normalizeUrl(`https://${zone.name}`) });
    }

    if (page >= data.result_info.total_pages) break;
    page++;
  }

  return domains;
}

export async function syncZones(env: Env): Promise<void> {
  // Gather accounts from DB
  const accounts = await getCfAccounts(env);

  // Fallback: if env vars are set and no DB accounts exist, use them
  if (accounts.length === 0 && env.CLOUDFLARE_API_KEY && env.CLOUDFLARE_EMAIL) {
    accounts.push({
      id: 0,
      name: 'Default',
      email: env.CLOUDFLARE_EMAIL,
      api_key: env.CLOUDFLARE_API_KEY,
      is_active: 1,
      created_at: '',
    });
  }

  // Fetch zones per account, tracking which accounts succeeded
  const allDomains: { name: string; url: string; accountId: number }[] = [];
  const succeededAccountIds: number[] = [];

  for (const account of accounts) {
    const domains = await fetchZonesForAccount(account);
    if (domains.length > 0) {
      succeededAccountIds.push(account.id);
      for (const d of domains) {
        allDomains.push({ ...d, accountId: account.id });
      }
    }
  }

  // Upsert each domain — skip any that were manually deleted
  for (const domain of allDomains) {
    await env.DB.prepare(
      `INSERT INTO monitors (url, name, source, cf_account_id) VALUES (?, ?, 'auto', ?)
       ON CONFLICT(url) DO UPDATE SET name = excluded.name, cf_account_id = excluded.cf_account_id, updated_at = datetime('now')
       WHERE deleted_at IS NULL`
    ).bind(domain.url, domain.name, domain.accountId || null).run();
  }

  // Only deactivate monitors belonging to accounts that successfully returned zones.
  // This prevents wiping monitors if an API call fails or an account isn't configured yet.
  if (succeededAccountIds.length > 0) {
    const urls = allDomains.map(d => d.url);
    const urlPlaceholders = urls.map(() => '?').join(',');
    const accountPlaceholders = succeededAccountIds.map(() => '?').join(',');

    // Deactivate auto monitors whose zones no longer exist — only for accounts that responded
    await env.DB.prepare(
      `UPDATE monitors SET is_active = 0
       WHERE source = 'auto' AND deleted_at IS NULL
       AND (cf_account_id IN (${accountPlaceholders}) OR cf_account_id IS NULL)
       AND url NOT IN (${urlPlaceholders})`
    ).bind(...succeededAccountIds, ...urls).run();

    // Re-activate auto monitors whose zones are back — only if not manually paused
    await env.DB.prepare(
      `UPDATE monitors SET is_active = 1
       WHERE source = 'auto' AND deleted_at IS NULL AND user_paused = 0
       AND url IN (${urlPlaceholders})`
    ).bind(...urls).run();
  }
}
