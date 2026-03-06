import type { Env } from '../types';
import { getSetting, getAllCfAccounts } from '../db/queries';
import { layout } from './layout';

export async function renderSettings(env: Env): Promise<string> {
  const retentionDays = parseInt(await getSetting(env, 'retention_days') || '7') || 7;
  const cfAccounts = await getAllCfAccounts(env);

  const accountRows = cfAccounts.length > 0
    ? cfAccounts.map(a => `
        <tr>
          <td style="font-weight: 500; color: #fff;">${a.name}</td>
          <td>${a.email}</td>
          <td style="font-family: monospace; font-size: 12px; color: #737373;">${a.api_key.slice(0, 6)}...</td>
          <td>
            ${a.is_active ? '<span class="badge badge-up">Active</span>' : '<span class="badge badge-unknown">Disabled</span>'}
          </td>
          <td style="text-align: right;">
            <button class="btn-ghost" style="padding: 4px 12px; font-size: 12px;" onclick="toggleAccount(${a.id})">${a.is_active ? 'Disable' : 'Enable'}</button>
            <button class="btn-danger" style="padding: 4px 12px; font-size: 12px; margin-left: 6px;" onclick="deleteAccount(${a.id})">Remove</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="5" style="text-align: center; color: #525252; padding: 20px;">No accounts added yet</td></tr>';

  const content = `
    <h1>Settings</h1>

    <div class="card" style="margin-bottom: 24px;">
      <h2 style="margin-bottom: 12px;">Cloudflare Accounts</h2>
      <p style="color: #a3a3a3; font-size: 13px; margin-bottom: 16px;">Connect multiple Cloudflare accounts to auto-discover zones. Each account's active zones will be synced as monitors.</p>

      <form id="addAccountForm" style="margin-bottom: 16px;">
        <div class="form-row">
          <input type="text" id="accName" placeholder="Account name" required style="max-width: 180px;" />
          <input type="email" id="accEmail" placeholder="CF email" required style="max-width: 220px;" />
          <input type="text" id="accKey" placeholder="Global API key" required />
          <button type="submit">Add</button>
        </div>
      </form>
      <div id="accMsg" style="margin-top: -8px; margin-bottom: 12px; font-size: 13px;"></div>

      <div style="overflow-x: auto;">
        <table>
          <tr><th>Name</th><th>Email</th><th>API Key</th><th>Status</th><th></th></tr>
          ${accountRows}
        </table>
      </div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <h2 style="margin-bottom: 12px;">Data Retention</h2>
      <p style="color: #a3a3a3; font-size: 13px; margin-bottom: 12px;">How long to keep check history and resolved incidents. Old data is purged nightly.</p>
      <div class="form-row">
        <select id="retention" style="max-width: 200px;">
          <option value="1"${retentionDays === 1 ? ' selected' : ''}>1 day</option>
          <option value="3"${retentionDays === 3 ? ' selected' : ''}>3 days</option>
          <option value="7"${retentionDays === 7 ? ' selected' : ''}>7 days</option>
          <option value="14"${retentionDays === 14 ? ' selected' : ''}>14 days</option>
          <option value="30"${retentionDays === 30 ? ' selected' : ''}>30 days</option>
          <option value="60"${retentionDays === 60 ? ' selected' : ''}>60 days</option>
          <option value="90"${retentionDays === 90 ? ' selected' : ''}>90 days</option>
        </select>
        <button onclick="saveRetention()">Save</button>
      </div>
      <div id="retentionMsg" style="margin-top: 8px; font-size: 13px;"></div>
    </div>

    <script>
    // ── CF Accounts ──
    const accMsg = document.getElementById('accMsg');

    document.getElementById('addAccountForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('accName').value;
      const email = document.getElementById('accEmail').value;
      const api_key = document.getElementById('accKey').value;
      accMsg.textContent = 'Adding...';
      accMsg.style.color = '#a3a3a3';
      try {
        const res = await fetch('/api/cf-accounts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, api_key }),
        });
        const data = await res.json();
        if (res.ok) {
          accMsg.textContent = 'Account added! Reloading...';
          accMsg.style.color = '#4ade80';
          setTimeout(() => location.reload(), 500);
        } else {
          accMsg.textContent = data.error || 'Failed to add';
          accMsg.style.color = '#f87171';
        }
      } catch {
        accMsg.textContent = 'Network error';
        accMsg.style.color = '#f87171';
      }
    });

    async function toggleAccount(id) {
      await fetch('/api/cf-accounts/' + id + '/toggle', { method: 'POST' });
      location.reload();
    }

    async function deleteAccount(id) {
      if (!confirm('Remove this Cloudflare account? Monitors it discovered will remain but won\\u0027t be synced.')) return;
      await fetch('/api/cf-accounts/' + id, { method: 'DELETE' });
      location.reload();
    }

    // ── Data Retention ──
    async function saveRetention() {
      const days = parseInt(document.getElementById('retention').value);
      const rmsg = document.getElementById('retentionMsg');
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ retention_days: days }),
        });
        if (res.ok) {
          rmsg.textContent = 'Saved! Data older than ' + days + ' days will be purged at next cleanup.';
          rmsg.style.color = '#4ade80';
        } else {
          rmsg.textContent = 'Failed to save';
          rmsg.style.color = '#f87171';
        }
      } catch {
        rmsg.textContent = 'Network error';
        rmsg.style.color = '#f87171';
      }
    }
    </script>
  `;

  return layout('Settings', content);
}
