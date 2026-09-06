import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { applyMigrations, resetDB, insertMonitor } from './setup';
import { mintAccessToken, stubJwksEndpoint } from './access-helpers';
import { escapeHtml, parseHttpUrl, safeHref } from '../utils';
import { renderDashboard } from '../ui/dashboard';
import { renderMonitors } from '../ui/monitors';
import { renderDetail } from '../ui/detail';

const testEnv = env as unknown as import('../types').Env;

let restoreFetch: () => void;
let accessToken: string;

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  return SELF.fetch(`https://test.local${path}`, {
    ...init,
    headers: {
      ...(init?.headers || {}),
      'Cf-Access-Jwt-Assertion': accessToken,
      Origin: 'https://test.local',
    },
  });
}

beforeAll(async () => {
  await applyMigrations();
  restoreFetch = await stubJwksEndpoint();
  accessToken = await mintAccessToken();
});

afterAll(() => {
  restoreFetch();
});

beforeEach(async () => {
  await resetDB();
});

describe('escapeHtml', () => {
  it('escapes the characters that break out of text and attributes', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('" onmouseover="x')).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml("it's")).toBe('it&#39;s');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('renders null and undefined as empty, not as the literal words', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('parseHttpUrl', () => {
  it('accepts http and https', () => {
    expect(parseHttpUrl('https://example.com')).not.toBeNull();
    expect(parseHttpUrl('http://example.com')).not.toBeNull();
  });

  it('rejects schemes that new URL() would otherwise accept', () => {
    expect(parseHttpUrl('javascript:alert(1)')).toBeNull();
    expect(parseHttpUrl('file:///etc/passwd')).toBeNull();
    expect(parseHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects malformed input', () => {
    expect(parseHttpUrl('not-a-url')).toBeNull();
  });
});

describe('safeHref', () => {
  it('neutralises a javascript: URL that predates validation', () => {
    expect(safeHref('javascript:alert(1)')).toBe('#');
  });

  it('escapes quotes so a URL cannot break out of the attribute', () => {
    expect(safeHref('https://x.test/"onmouseover="alert(1)')).not.toContain('"onmouseover');
  });
});

describe('XSS is not reachable through rendered pages', () => {
  it('escapes a script tag in a monitor name on the dashboard', async () => {
    await env.DB.prepare(
      "INSERT INTO monitors (url, name, source, current_status) VALUES (?, ?, 'manual', 1)"
    ).bind('https://x.test', '<script>alert(1)</script>').run();

    const html = await renderDashboard(testEnv);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('does not emit a javascript: href for a legacy row', async () => {
    await env.DB.prepare(
      "INSERT INTO monitors (url, name, source) VALUES (?, ?, 'manual')"
    ).bind('javascript:alert(document.domain)', 'Evil').run();

    const html = await renderMonitors(testEnv);
    expect(html).not.toContain('href="javascript:');
  });

  it('escapes a check error so it cannot break out of the title attribute', async () => {
    const id = await insertMonitor(env.DB, 'https://y.test', 'Y');
    await env.DB.prepare(
      'INSERT INTO checks (monitor_id, status_code, is_up, error) VALUES (?, 500, 0, ?)'
    ).bind(id, '" onmouseover="alert(1)').run();

    const html = await renderDashboard(testEnv);
    expect(html).not.toContain('onmouseover="alert(1)"');
  });

  it('escapes the monitor name in the detail page edit field', async () => {
    const id = await insertMonitor(env.DB, 'https://z.test', '"><script>alert(1)</script>');
    const html = await renderDetail(testEnv, id);
    expect(html).not.toContain('<script>alert(1)</script>');
  });
});

describe('URL scheme validation on the API', () => {
  it('rejects a javascript: URL on create', async () => {
    const resp = await authedFetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'javascript:alert(1)' }),
    });
    expect(resp.status).toBe(400);
  });

  it('rejects a file: URL on update', async () => {
    const id = await insertMonitor(env.DB, 'https://ok.test', 'OK');
    const resp = await authedFetch(`/api/monitors/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'file:///etc/passwd' }),
    });
    expect(resp.status).toBe(400);
  });

  it('still accepts a normal https URL', async () => {
    const resp = await authedFetch('/api/monitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://fine.test' }),
    });
    expect(resp.status).toBe(201);
  });
});

describe('CSRF protection', () => {
  it('rejects a state-changing request from another origin', async () => {
    const id = await insertMonitor(env.DB, 'https://csrf.test', 'CSRF');
    const resp = await SELF.fetch(`https://test.local/api/monitors/${id}/toggle`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': accessToken,
        Origin: 'https://evil.test',
      },
    });
    expect(resp.status).toBe(403);
  });

  it('rejects when only a cross-origin Referer is present', async () => {
    const id = await insertMonitor(env.DB, 'https://csrf2.test', 'CSRF2');
    const resp = await SELF.fetch(`https://test.local/api/monitors/${id}/toggle`, {
      method: 'POST',
      headers: {
        'Cf-Access-Jwt-Assertion': accessToken,
        Referer: 'https://evil.test/page',
      },
    });
    expect(resp.status).toBe(403);
  });

  it('allows a same-origin state-changing request', async () => {
    const id = await insertMonitor(env.DB, 'https://same.test', 'Same');
    const resp = await authedFetch(`/api/monitors/${id}/toggle`, { method: 'POST' });
    expect(resp.status).toBe(200);
  });

  it('does not block safe methods from anywhere', async () => {
    const resp = await SELF.fetch('https://test.local/api/stats', {
      headers: {
        'Cf-Access-Jwt-Assertion': accessToken,
        Origin: 'https://evil.test',
      },
    });
    expect(resp.status).toBe(200);
  });
});

describe('checks limit is bounded', () => {
  it('does not pass a NaN limit through to the database', async () => {
    const id = await insertMonitor(env.DB, 'https://limit.test', 'Limit');
    const resp = await authedFetch(`/api/monitors/${id}/checks?limit=abc`);
    expect(resp.status).toBe(200);
  });

  it('clamps an absurd limit', async () => {
    const id = await insertMonitor(env.DB, 'https://limit2.test', 'Limit2');
    const resp = await authedFetch(`/api/monitors/${id}/checks?limit=999999999`);
    expect(resp.status).toBe(200);
  });
});
