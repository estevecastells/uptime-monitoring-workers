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

export async function runChecks(env: Env): Promise<void> {
  const monitors = await getActiveMonitors(env);
  await Promise.allSettled(
    monitors.map((monitor) => checkSingle(env, monitor))
  );
}

export async function recheckDown(env: Env): Promise<void> {
  const monitors = await getDownMonitors(env);
  await Promise.allSettled(
    monitors.map((monitor) => checkSingle(env, monitor))
  );
}

async function checkSingle(env: Env, monitor: Monitor): Promise<void> {
  let statusCode: number | null = null;
  let responseMs: number | null = null;
  let isUp = false;
  let error: string | null = null;

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const resp = await fetch(monitor.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'UptimeBot/1.0' },
    });
    clearTimeout(timeout);
    // Drain the body to avoid hanging connections in Workers
    await resp.arrayBuffer().catch(() => {});
    responseMs = Date.now() - start;
    statusCode = resp.status;
    isUp = resp.status >= 200 && resp.status < 400;
    if (!isUp) error = `HTTP ${resp.status}`;
  } catch (e: unknown) {
    responseMs = Date.now() - start;
    error = e instanceof Error ? e.message : 'Network error';
  }

  await insertCheck(env, monitor.id, statusCode, responseMs, isUp, error);
  await handleIncident(env, monitor, isUp, error);
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
      await Promise.allSettled([
        sendTelegramAlert(env, monitor, 'down', error),
        sendEmailAlert(env, monitor, 'down', error),
      ]);
    }
  } else if (openIncident) {
    const shouldNotify = openIncident.notified_down === 1;
    await resolveIncident(env, openIncident.id, shouldNotify);

    if (shouldNotify) {
      await Promise.allSettled([
        sendTelegramAlert(env, monitor, 'up', null),
        sendEmailAlert(env, monitor, 'up', null),
      ]);
    }
  }
}
