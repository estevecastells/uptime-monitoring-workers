import type { Env, Monitor } from '../types';
import {
  getActiveMonitors,
  getDownMonitors,
  insertCheck,
  getLastNChecks,
  getOpenIncident,
  createIncident,
  resolveIncident,
} from '../db/queries';
import { sendTelegramAlert } from '../notifications/telegram';
import { sendEmailAlert } from '../notifications/email';

const BATCH_SIZE = 10;
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [300, 800] as const;

type CheckOutcome = 'up' | 'down' | 'unknown';

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
  url: string
): Promise<{ statusCode: number | null; responseMs: number; outcome: CheckOutcome; error: string | null }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const resp = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'UptimeBot/1.0' },
      cf: { cacheTtlByStatus: { '100-599': -1 } },
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
    const outcome: CheckOutcome = 'down';
    return { statusCode: null, responseMs, outcome, error: message };
  }
}

async function checkSingle(env: Env, monitor: Monitor): Promise<void> {
  let result = await attemptFetch(monitor.url);

  // Retry on failure: only 'down' results trigger retries.
  // A single 'up' or 'unknown' aborts the retry loop immediately.
  if (result.outcome === 'down') {
    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      result = await attemptFetch(monitor.url);
      if (result.outcome !== 'down') break;
    }
  }

  const isUp = result.outcome === 'up';
  await insertCheck(env, monitor.id, result.statusCode, result.responseMs, isUp, result.error);

  // 'unknown' outcomes preserve the current state — don't trigger incident logic
  if (result.outcome !== 'unknown') {
    await handleIncident(env, monitor, isUp, result.error);
  }
}

async function handleIncident(
  env: Env,
  monitor: Monitor,
  isUp: boolean,
  error: string | null
): Promise<void> {
  const openIncident = await getOpenIncident(env, monitor.id);

  if (!isUp) {
    // Check for 2 consecutive failures before alerting
    const recent = await getLastNChecks(env, monitor.id, 2);
    const confirmedDown =
      recent.length >= 2 && recent.every((c) => c.is_up === 0);

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
