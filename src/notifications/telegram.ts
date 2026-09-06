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

  // Chain sends sequentially with a small gap to avoid rate limiting.
  //
  // Delivery problems are logged, never thrown: a failed alert must not take
  // down the check run that produced it. But they are logged — swallowing them
  // silently is how an alerting system ends up looking healthy while nothing
  // is being delivered. The bot token lives in the request URL, so only the
  // status and the API's description are recorded, never the URL itself.
  const endpoint = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const payload = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

  const post = () =>
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    });

  const describe = async (resp: Response): Promise<string> => {
    try {
      const body = await resp.json<{ description?: string }>();
      return body.description ?? '(no description)';
    } catch {
      return '(unparseable response)';
    }
  };

  sendQueue = sendQueue
    .then(async () => {
      let resp = await post();

      // If rate-limited, wait for the retry_after period and try once more.
      if (resp.status === 429) {
        let wait = 1000;
        try {
          const body = await resp.clone().json<{ parameters?: { retry_after?: number } }>();
          wait = (body.parameters?.retry_after ?? 1) * 1000;
        } catch {
          // keep the default
        }
        await new Promise((r) => setTimeout(r, wait));
        resp = await post();
      }

      if (!resp.ok) {
        console.error(
          `Telegram alert for "${monitor.name}" (${status}) failed: HTTP ${resp.status} — ${await describe(resp)}`
        );
      }

      // Small delay between messages to stay under rate limits
      await new Promise((r) => setTimeout(r, 100));
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Telegram alert for "${monitor.name}" (${status}) threw: ${message}`);
    });
  await sendQueue;
}
