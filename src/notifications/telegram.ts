import type { Env, Monitor } from '../types';

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
  const text =
    status === 'down'
      ? `${emoji} <b>DOWN</b>: ${monitor.name}\n${monitor.url}\nError: ${error || 'Unknown'}`
      : `${emoji} <b>RECOVERED</b>: ${monitor.name}\n${monitor.url}`;

  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  });
}
