import type { Env, Monitor } from '../types';
import { escapeHtml } from '../utils';

// Simple queue to avoid hitting Telegram rate limits when many monitors alert at once.
// Telegram allows ~30 msg/s per bot, but bursts to the same chat can still get throttled.
let sendQueue: Promise<void> = Promise.resolve();

export async function sendTelegramAlert(
  env: Env,
  monitor: Monitor,
  status: 'down' | 'up',
  error: string | null
): Promise<void> {
  const parts = env.TELEGRAM.split('|');
  if (parts.length !== 2) return; // Not configured properly

  const [botToken, chatId] = parts;

  const emoji = status === 'down' ? '\u{1F534}' : '\u{1F7E2}';
  // parse_mode is HTML, so unescaped values are not just an injection risk:
  // a single stray '<' in a monitor name or error makes Telegram reject the
  // whole message with a 400, and the down-alert is lost silently.
  const text =
    status === 'down'
      ? `${emoji} <b>DOWN</b>: ${escapeHtml(monitor.name)}\n${escapeHtml(monitor.url)}\nError: ${escapeHtml(error || 'Unknown')}`
      : `${emoji} <b>RECOVERED</b>: ${escapeHtml(monitor.name)}\n${escapeHtml(monitor.url)}`;

  // Chain sends sequentially with a small gap to avoid rate limiting
  sendQueue = sendQueue.then(async () => {
    const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });

    // If rate-limited, wait for the retry_after period
    if (resp.status === 429) {
      const body = await resp.json<{ parameters?: { retry_after?: number } }>();
      const wait = (body.parameters?.retry_after ?? 1) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      // Retry once
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
    }

    // Small delay between messages to stay under rate limits
    await new Promise((r) => setTimeout(r, 100));
  }).catch(() => {});
  await sendQueue;
}
