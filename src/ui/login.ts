import { layout } from './layout';

export function renderLogin(error?: string): string {
  return layout('Login', `
    <div style="max-width: 360px; margin: 80px auto; text-align: center;">
      <div style="margin-bottom: 16px;"><svg width="48" height="48" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#141414"/><path d="M4 18h6l3-10 4 16 3-12 2 6h6" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h1 style="margin-bottom: 8px;">Uptime Monitor</h1>
      <p style="color: #737373; font-size: 14px; margin-bottom: 24px;">Enter your password to access the dashboard.</p>
      ${error ? `<div style="background: #450a0a; color: #f87171; padding: 10px; border-radius: 8px; font-size: 14px; margin-bottom: 16px;">${error}</div>` : ''}
      <form method="POST" action="/login">
        <input type="password" name="password" placeholder="Password" required autofocus
          style="text-align: center;" />
        <button type="submit" style="width: 100; margin-top: 4px;">Sign In</button>
      </form>
    </div>
  `);
}
