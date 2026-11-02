import { parseHttpUrl } from '../utils';
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

const MAX_REDIRECTS = 5;
const CHECK_TIMEOUT_MS = 10_000;
// Enough for any real status page or homepage; past this we stop reading.
const MAX_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Read and discard a response body, bounded in size and by the check's deadline.
 *
 * A monitored server is remote input: it can send headers promptly and then hold
 * the body open, or make it huge. `await resp.arrayBuffer()` buffers all of it and,
 * without a deadline, never settles, which stalls this batch and every later one
 * in `runInBatches`. Chunks are dropped as they arrive, so memory stays flat.
 */
async function drainBody(resp: Response, signal: AbortSignal): Promise<void> {
  if (!resp.body || resp.bodyUsed) return;
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = resp.body.getReader();
  } catch {
    return; // already locked: nothing left for us to drain
  }
  const cancel = () => {
    reader.cancel().catch(() => {});
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    let bytes = 0;
    while (!signal.aborted && bytes < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) return;
      bytes += value?.byteLength ?? 0;
    }
    cancel();
  } catch {
    // Body errors after the headers don't change the outcome (as before).
  } finally {
    signal.removeEventListener('abort', cancel);
  }
}

/**
 * Follow redirects by hand so the uptime token is never replayed off-origin.
 *
 * With `redirect: 'follow'` the runtime re-sends our headers to whatever host
 * the Location points at, so a monitored site redirecting to a third party
 * would hand `X-Uptime-Token` straight to it — and a monitored origin is not
 * necessarily one we control. Following manually lets us re-attach the token
 * only while we are still talking to the host the check started on.
 */
async function fetchFollowingRedirects(
  url: string,
  uptimeToken: string | undefined,
  signal: AbortSignal
): Promise<Response> {
  const originalHost = new URL(url).host;
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers: Record<string, string> = { 'User-Agent': 'UptimeBot/1.0' };
    if (uptimeToken && new URL(current).host === originalHost) {
      headers['X-Uptime-Token'] = uptimeToken;
    }

    const resp = await fetch(current, {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers,
      cf: { cacheTtlByStatus: { '100-599': -1 } },
    });

    const isRedirect = resp.status >= 300 && resp.status < 400;
    const location = isRedirect ? resp.headers.get('location') : null;
    if (!location) return resp;

    // Drain before moving on so the connection is not left hanging.
    await drainBody(resp, signal);

    // A Location header is remote input. Resolve it, then require http(s):
    // a redirect to another scheme is not something we should be following.
    const next = parseHttpUrl(new URL(location, current).toString());
    if (!next) throw new Error(`Redirect to unsupported scheme: ${location}`);
    current = next.toString();
  }

  throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
}

async function attemptFetch(
  url: string,
  uptimeToken?: string
): Promise<{ statusCode: number | null; responseMs: number; outcome: CheckOutcome; error: string | null }> {
  const start = Date.now();
  // One deadline for the whole attempt: headers, redirects and the body.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const resp = await fetchFollowingRedirects(url, uptimeToken, controller.signal);
    // Drain the body to avoid hanging connections in Workers
    await drainBody(resp, controller.signal);
    clearTimeout(timeout);
    const responseMs = Date.now() - start;
    const statusCode = resp.status;
    if (statusCode >= 200 && statusCode < 400) {
      return { statusCode, responseMs, outcome: 'up', error: null };
    }
    return { statusCode, responseMs, outcome: 'down', error: `HTTP ${statusCode}` };
  } catch (e: unknown) {
    clearTimeout(timeout);
    const responseMs = Date.now() - start;
    const message = e instanceof Error ? e.message : 'Network error';
    // Aborted requests (timeouts) are definitive failures; other network
    // errors may be transient and ambiguous on the first attempt.
    const outcome: CheckOutcome = 'down';
    return { statusCode: null, responseMs, outcome, error: message };
  }
}

async function checkSingle(env: Env, monitor: Monitor): Promise<void> {
  let result = await attemptFetch(monitor.url, env.UPTIME_TOKEN);

  // Retry on failure: only 'down' results trigger retries.
  // A single 'up' or 'unknown' aborts the retry loop immediately.
  if (result.outcome === 'down') {
    for (const delay of RETRY_DELAYS_MS) {
      await sleep(delay);
      result = await attemptFetch(monitor.url, env.UPTIME_TOKEN);
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
