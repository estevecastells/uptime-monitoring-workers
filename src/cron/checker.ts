import type { Env, Monitor, CheckOutcome } from '../types';
import {
  getActiveMonitors,
  getDownMonitors,
  recordCheck,
  getOpenIncident,
  createIncident,
  resolveIncident,
} from '../db/queries';
import { sendTelegramAlert } from '../notifications/telegram';
import { sendEmailAlert } from '../notifications/email';

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [300, 800] as const;

type FetchOutcome = 'up' | 'down' | 'unknown';

async function runInBatches(env: Env, monitors: Monitor[]): Promise<void> {
  for (let i = 0; i < monitors.length; i += BATCH_SIZE) {
    const batch = monitors.slice(i, i + BATCH_SIZE);
    await Promise.allSettled(batch.map((m) => checkSingle(env, m)));
  }
}

export async function runChecks(env: Env): Promise<void> {
  const monitors = await getActiveMonitors(env);
  await runInBatches(env, monitors);
}

export async function recheckDown(env: Env): Promise<void> {
  const monitors = await getDownMonitors(env);
  await runInBatches(env, monitors);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function attemptFetch(
  env: Env,
  url: string
): Promise<{ statusCode: number | null; responseMs: number; outcome: FetchOutcome; error: string | null }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const headers: Record<string, string> = { 'User-Agent': 'UptimeBot/1.0' };
    // Shared secret to bypass origin WAF rules that block scanners. The token
    // must match the value whitelisted in the Cloudflare WAF custom rules
    // (`x-uptime-token` header check).
    if (env.UPTIME_TOKEN) {
      headers['X-Uptime-Token'] = env.UPTIME_TOKEN;
    }
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers,
      // Cache 2xx responses 60s on Cloudflare edge so the per-minute cron does
      // not hammer the origin (it would otherwise issue ~1 request per site
      // per minute with no cache). Bypass cache on 3xx-5xx so genuine outages
      // are detected immediately without being masked by stale OK responses.
      cf: { cacheTtlByStatus: { '200-299': 60, '300-599': -1 } },
    });
    clearTimeout(timeout);
    // Drain the body to avoid hanging connections in Workers
    await resp.arrayBuffer().catch(() => {});
    const responseMs = Date.now() - start;
    const statusCode = resp.status;
    if (statusCode >= 200 && statusCode < 400) {
      return { statusCode, responseMs, outcome: 'up', error: null };
    }
    return { statusCode, responseMs, outcome: 'down', error: `HTTP ${statusCode}` };
  } catch (e: unknown) {
    const responseMs = Date.now() - start;
    const message = e instanceof Error ? e.message : 'Network error';
    // Aborted requests (timeouts) are definitive failures; other network
    // errors may be transient and ambiguous on the first attempt.
    const outcome: FetchOutcome = 'down';
    return { statusCode: null, responseMs, outcome, error: message };
  }
}

async function checkSingle(env: Env, monitor: Monitor): Promise<void> {
  let result = await attemptFetch(env, monitor.url);

  // Retry on failure: only 'down' results trigger retries.
  // A single 'up' or 'unknown' aborts the retry loop immediately.
  if (result.outcome === 'down') {
    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      result = await attemptFetch(env, monitor.url);
      if (result.outcome !== 'down') break;
    }
  }

  const isUp = result.outcome === 'up';
  const outcome = await recordCheck(
    env,
    monitor,
    result.statusCode,
    result.responseMs,
    isUp,
    result.error
  );

  // 'unknown' outcomes preserve the current state — don't trigger incident logic
  if (result.outcome !== 'unknown') {
    await handleIncident(env, monitor, isUp, result.error, outcome);
  }
}

async function handleIncident(
  env: Env,
  monitor: Monitor,
  isUp: boolean,
  error: string | null,
  outcome: CheckOutcome
): Promise<void> {
  const openIncident = await getOpenIncident(env, monitor.id);

  if (!isUp) {
    // Alert once we've seen 2+ consecutive failures. The counter lives on the
    // monitors row so we don't have to re-scan the checks table.
    const confirmedDown = outcome.consecutiveDowns >= 2;

    if (confirmedDown && !openIncident) {
      await createIncident(env, monitor.id);
      const alerts: Promise<void>[] = [];
      if (monitor.notify_telegram) alerts.push(sendTelegramAlert(env, monitor, 'down', error));
      if (monitor.notify_email) alerts.push(sendEmailAlert(env, monitor, 'down', error));
      await Promise.allSettled(alerts);
    }
  } else if (openIncident) {
    const shouldNotify = openIncident.notified_down === 1;
    await resolveIncident(env, openIncident.id, shouldNotify);

    if (shouldNotify) {
      const alerts: Promise<void>[] = [];
      if (monitor.notify_telegram) alerts.push(sendTelegramAlert(env, monitor, 'up', null));
      if (monitor.notify_email) alerts.push(sendEmailAlert(env, monitor, 'up', null));
      await Promise.allSettled(alerts);
    }
  }
}
