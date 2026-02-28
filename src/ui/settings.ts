import type { Env } from '../types';
import { getAllMonitors, getSetting } from '../db/queries';
import { layout } from './layout';

export async function renderSettings(env: Env): Promise<string> {
  const monitors = await getAllMonitors(env);
  const retentionDays = parseInt(await getSetting(env, 'retention_days') || '7') || 7;

  const rows = monitors.length > 0
    ? monitors
        .map(
          (m) => `
        <tr>
          <td>
            <a href="/monitor/${m.id}">${m.name}</a>
          </td>
          <td><a href="${m.url}" target="_blank" rel="noopener" style="color: #737373; font-size: 13px;">${m.url} &#x2197;</a></td>
          <td><span class="badge badge-${m.source}" style="font-size: 11px;">${m.source}</span></td>
          <td>
            ${m.is_active ? '<span class="badge badge-up">Active</span>' : '<span class="badge badge-unknown">Paused</span>'}
          </td>
          <td style="text-align: right;">
            <button class="btn-ghost" style="padding: 4px 12px; font-size: 12px;" onclick="toggleMonitor(${m.id})">${m.is_active ? 'Pause' : 'Resume'}</button>
            ${m.source === 'manual' ? `<button class="btn-danger" style="padding: 4px 12px; font-size: 12px; margin-left: 6px;" onclick="deleteMonitor(${m.id})">Delete</button>` : ''}
          </td>
        </tr>`
        )
        .join('')
    : '<tr><td colspan="5" style="text-align: center; color: #525252; padding: 20px;">No monitors yet</td></tr>';

  const content = `
    <h1>Settings</h1>

    <div class="card" style="margin-bottom: 24px;">
      <h2 style="margin-bottom: 12px;">Add Monitor</h2>
      <form id="addForm">
        <div class="form-row">
          <input type="url" id="url" placeholder="https://example.com" required />
          <input type="text" id="name" placeholder="Name (optional)" style="max-width: 200px;" />
          <button type="submit">Add</button>
        </div>
      </form>
      <div id="formMsg" style="margin-top: 8px; font-size: 13px;"></div>
    </div>

    <div class="card" style="margin-bottom: 24px;">
      <h2 style="margin-bottom: 12px;">Data Retention</h2>
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

    <div class="flex-between" style="margin-bottom: 16px;">
      <h2 style="margin-bottom: 0;">Monitors (${monitors.length})</h2>
      <button class="btn-ghost" onclick="syncZones()">Sync CF Zones</button>
    </div>

    <div class="card" style="padding: 0; overflow-x: auto;">
      <table>
        <tr><th>Name</th><th>URL</th><th>Source</th><th>Status</th><th></th></tr>
        ${rows}
      </table>
    </div>

    <script>
    const msg = document.getElementById('formMsg');

    document.getElementById('addForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const url = document.getElementById('url').value;
      const name = document.getElementById('name').value;
      msg.textContent = 'Adding...';
      msg.style.color = '#a3a3a3';
      try {
        const res = await fetch('/api/monitors', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name: name || undefined }),
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = 'Added! Reloading...';
          msg.style.color = '#4ade80';
          setTimeout(() => location.reload(), 500);
        } else {
          msg.textContent = data.error || 'Failed to add';
          msg.style.color = '#f87171';
        }
      } catch {
        msg.textContent = 'Network error';
        msg.style.color = '#f87171';
      }
    });

    async function toggleMonitor(id) {
      await fetch('/api/monitors/' + id + '/toggle', { method: 'POST' });
      location.reload();
    }

    async function deleteMonitor(id) {
      if (!confirm('Delete this monitor?')) return;
      await fetch('/api/monitors/' + id, { method: 'DELETE' });
      location.reload();
    }

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

    async function syncZones() {
      const btn = event.target;
      btn.textContent = 'Syncing...';
      btn.disabled = true;
      try {
        await fetch('/api/sync-zones', { method: 'POST' });
        location.reload();
      } catch {
        btn.textContent = 'Failed';
        setTimeout(() => { btn.textContent = 'Sync CF Zones'; btn.disabled = false; }, 2000);
      }
    }
    </script>
  `;

  return layout('Settings', content);
}
