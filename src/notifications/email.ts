import type { Env, Monitor } from '../types';
import { escapeHtml } from '../utils';

export async function sendEmailAlert(
  env: Env,
  monitor: Monitor,
  status: 'down' | 'up',
  error: string | null
): Promise<void> {
  const subject =
    status === 'down'
      ? `[DOWN] ${monitor.name} is unreachable`
      : `[RECOVERED] ${monitor.name} is back online`;

  const html = `
    <h2>${escapeHtml(subject)}</h2>
    <p><strong>URL:</strong> ${escapeHtml(monitor.url)}</p>
    ${error ? `<p><strong>Error:</strong> ${escapeHtml(error)}</p>` : ''}
    <p><strong>Time:</strong> ${new Date().toISOString()}</p>
  `;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Uptime Monitor <onboarding@resend.dev>',
      to: [env.ALERT_EMAIL],
      subject,
      html,
    }),
  });
}
