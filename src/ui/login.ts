import { layout } from './layout';

export function renderLogin(error?: string): string {
  return layout('Login', `
    <div style="max-width: 360px; margin: 80px auto; text-align: center;">
      <div style="font-size: 36px; margin-bottom: 16px;">&#x1F512;</div>
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
