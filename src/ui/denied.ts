import { layout } from './layout';

/**
 * Shown when a request reaches the Worker without a valid Access token.
 *
 * In normal operation nobody sees this: Access intercepts at the edge and
 * redirects to the identity provider first. It appears when the Worker is
 * reached outside of Access (for example a direct `workers.dev` hit while the
 * Access application is missing or misconfigured), which is exactly the case
 * we must not serve the dashboard for.
 */
export function renderDenied(detail: string): string {
  return layout('Access Denied', `
    <div style="max-width: 420px; margin: 80px auto; text-align: center;">
      <div style="margin-bottom: 16px;"><svg width="48" height="48" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#141414"/><path d="M4 18h6l3-10 4 16 3-12 2 6h6" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <h1 style="margin-bottom: 8px;">Access Denied</h1>
      <p style="color: #737373; font-size: 14px; margin-bottom: 20px;">
        This dashboard is protected by Cloudflare Access. ${detail}
      </p>
      <p style="color: #525252; font-size: 12px;">
        If you reached this page directly, open the dashboard through its
        Access-protected URL so you get signed in first.
      </p>
    </div>
  `, false);
}
