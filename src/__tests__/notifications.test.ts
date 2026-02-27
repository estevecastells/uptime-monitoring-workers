import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendTelegramAlert } from '../notifications/telegram';
import { sendEmailAlert } from '../notifications/email';
import type { Env, Monitor } from '../types';

const mockMonitor: Monitor = {
  id: 1,
  url: 'https://example.com',
  name: 'Example',
  source: 'manual',
  is_active: 1,
  created_at: '2024-01-01',
  updated_at: '2024-01-01',
};

const originalFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = originalFetch;
});

describe('sendTelegramAlert', () => {
  it('sends a DOWN alert with correct payload', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch;

    const env = { TELEGRAM: 'BOT_TOKEN|CHAT_ID' } as unknown as Env;
    await sendTelegramAlert(env, mockMonitor, 'down', 'Connection timeout');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botBOT_TOKEN/sendMessage');

    const body = JSON.parse(options.body);
    expect(body.chat_id).toBe('CHAT_ID');
    expect(body.text).toContain('DOWN');
    expect(body.text).toContain('Example');
    expect(body.text).toContain('Connection timeout');
    expect(body.parse_mode).toBe('HTML');
  });

  it('sends a RECOVERED alert', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch;

    const env = { TELEGRAM: 'BOT_TOKEN|CHAT_ID' } as unknown as Env;
    await sendTelegramAlert(env, mockMonitor, 'up', null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain('RECOVERED');
    expect(body.text).toContain('Example');
  });

  it('does nothing if TELEGRAM secret is malformed', async () => {
    const mockFetch = vi.fn();
    globalThis.fetch = mockFetch;

    const env = { TELEGRAM: 'no-pipe-separator' } as unknown as Env;
    await sendTelegramAlert(env, mockMonitor, 'down', 'error');

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('sendEmailAlert', () => {
  it('sends a DOWN email via Resend API', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch;

    const env = {
      RESEND: 'test-api-key',
      ALERT_EMAIL: 'test@example.com',
    } as unknown as Env;

    await sendEmailAlert(env, mockMonitor, 'down', 'HTTP 500');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');

    const body = JSON.parse(options.body);
    expect(body.to).toEqual(['test@example.com']);
    expect(body.subject).toContain('[DOWN]');
    expect(body.subject).toContain('Example');
    expect(body.html).toContain('HTTP 500');
    expect(options.headers.Authorization).toBe('Bearer test-api-key');
  });

  it('sends a RECOVERED email', async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = mockFetch;

    const env = {
      RESEND: 'test-api-key',
      ALERT_EMAIL: 'test@example.com',
    } as unknown as Env;

    await sendEmailAlert(env, mockMonitor, 'up', null);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.subject).toContain('[RECOVERED]');
  });
});
