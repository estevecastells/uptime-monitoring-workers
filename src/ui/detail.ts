import type { Env } from '../types';
import { getMonitor, getRecentChecks, getMonitorIncidents } from '../db/queries';
import { layout } from './layout';

export async function renderDetail(env: Env, id: number): Promise<string> {
  const monitor = await getMonitor(env, id);
  if (!monitor) {
    return layout('Not Found', '<div class="empty"><p>Monitor not found.</p></div>');
  }

  const checks = await getRecentChecks(env, id, 288); // ~24h
  const incidents = await getMonitorIncidents(env, id, 10);

  const upChecks = checks.filter((c) => c.is_up === 1).length;
  const uptimePct = checks.length > 0 ? ((upChecks / checks.length) * 100) : 100;
  const pctClass = uptimePct >= 99 ? 'good' : uptimePct >= 95 ? 'warn' : 'bad';

  const avgResponse =
    checks.length > 0
      ? Math.round(
          checks.reduce((sum, c) => sum + (c.response_ms || 0), 0) / checks.length
        )
      : 0;

  const currentStatus =
    checks.length > 0
      ? checks[0].is_up
        ? '<span class="badge badge-up">Up</span>'
        : '<span class="badge badge-down">Down</span>'
      : '<span class="badge badge-unknown">Pending</span>';

  // Build 90-segment uptime bar
  const barChecks = checks.slice(0, 90).reverse();
  const segments = [];
  for (let i = 0; i < 90; i++) {
    const check = barChecks[i];
    if (!check) {
      segments.push('<div class="seg seg-none" title="No data"></div>');
    } else {
      const cls = check.is_up ? 'seg-up' : 'seg-down';
      const title = check.is_up
        ? `Up — ${check.response_ms}ms`
        : `Down — ${check.error || 'Error'}`;
      segments.push(`<div class="seg ${cls}" title="${title}"></div>`);
    }
  }

  // Response time data for chart (oldest to newest, last 50)
  const chartChecks = checks.slice(0, 50).reverse();
  const chartLabels = JSON.stringify(chartChecks.map((c) => c.checked_at.slice(11, 16)));
  const chartData = JSON.stringify(chartChecks.map((c) => c.response_ms || 0));

  // Incidents table
  const incidentRows = incidents.length > 0
    ? incidents
        .map((inc) => {
          const duration = inc.resolved_at
            ? formatDuration(new Date(inc.started_at), new Date(inc.resolved_at))
            : 'Ongoing';
          return `
          <tr>
            <td>${inc.started_at.replace('T', ' ').slice(0, 16)}</td>
            <td>${inc.resolved_at ? inc.resolved_at.replace('T', ' ').slice(0, 16) : '—'}</td>
            <td>${duration}</td>
          </tr>`;
        })
        .join('')
    : '<tr><td colspan="3" style="text-align: center; color: #525252; padding: 20px;">No incidents recorded</td></tr>';

  const content = `
    <div style="margin-bottom: 8px;">
      <a href="/" style="color: #737373; font-size: 13px;">&larr; Back to dashboard</a>
    </div>
    <div class="flex-between" style="margin-bottom: 20px;">
      <h1 style="margin-bottom: 0;">${monitor.name} ${currentStatus}</h1>
      <div style="display: flex; align-items: center; gap: 8px;">
        <a href="${monitor.url}" target="_blank" rel="noopener" style="color: #737373; font-size: 13px;">${monitor.url} &#x2197;</a>
        <button class="btn-ghost" style="padding: 4px 14px; font-size: 13px;" onclick="showEdit()">Edit</button>
        <button class="btn-ghost" style="padding: 4px 14px; font-size: 13px;" onclick="toggleMonitor(${monitor.id})">${monitor.is_active ? 'Pause' : 'Resume'}</button>
        <button class="btn-danger" style="padding: 4px 14px; font-size: 13px;" onclick="deleteMonitor(${monitor.id})">Delete</button>
      </div>
    </div>
    <div id="editForm" class="card" style="display: none; margin-bottom: 16px;">
      <h2 style="margin-bottom: 12px;">Edit Monitor</h2>
      <div class="form-row">
        <input type="text" id="editName" value="${monitor.name}" placeholder="Name" />
        <input type="url" id="editUrl" value="${monitor.url}" placeholder="https://example.com" />
        <button onclick="saveEdit(${monitor.id})">Save</button>
        <button class="btn-ghost" onclick="hideEdit()">Cancel</button>
      </div>
      <div id="editMsg" style="margin-top: 8px; font-size: 13px;"></div>
    </div>

    <div class="grid-2">
      <div class="card" style="text-align: center;">
        <div style="color: #737373; font-size: 13px; margin-bottom: 4px;">Uptime (24h)</div>
        <div class="uptime-pct ${pctClass}">${uptimePct.toFixed(2)}%</div>
      </div>
      <div class="card" style="text-align: center;">
        <div style="color: #737373; font-size: 13px; margin-bottom: 4px;">Avg Response</div>
        <div style="font-size: 28px; font-weight: 700; color: #fff;">${avgResponse}<span style="font-size: 14px; color: #737373;">ms</span></div>
      </div>
    </div>

    <div class="card">
      <div style="color: #a3a3a3; font-size: 13px; margin-bottom: 6px;">Uptime (last ~7.5 hours)</div>
      <div class="uptime-bar">${segments.join('')}</div>
    </div>

    <div class="card" style="margin-top: 12px; position: relative;">
      <div style="color: #a3a3a3; font-size: 13px; margin-bottom: 12px;">Response Time (last 50 checks)</div>
      <canvas id="chart" height="160"></canvas>
      <div id="tooltip" style="display:none; position:absolute; background:#1a1a1a; border:1px solid #404040; border-radius:6px; padding:6px 10px; font-size:12px; color:#e5e5e5; pointer-events:none; white-space:nowrap; z-index:10;">
        <div id="ttTime" style="color:#737373; margin-bottom:2px;"></div>
        <div><span style="color:#60a5fa; font-weight:600;" id="ttVal"></span></div>
      </div>
    </div>

    <h2 style="margin-top: 24px;">Recent Incidents</h2>
    <div class="card">
      <table>
        <tr><th>Started</th><th>Resolved</th><th>Duration</th></tr>
        ${incidentRows}
      </table>
    </div>

    <script>
    function showEdit() { document.getElementById('editForm').style.display = 'block'; }
    function hideEdit() { document.getElementById('editForm').style.display = 'none'; }
    async function saveEdit(id) {
      const url = document.getElementById('editUrl').value;
      const name = document.getElementById('editName').value;
      const msg = document.getElementById('editMsg');
      try {
        const res = await fetch('/api/monitors/' + id, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url, name }),
        });
        const data = await res.json();
        if (res.ok) { location.reload(); }
        else { msg.textContent = data.error || 'Failed'; msg.style.color = '#f87171'; }
      } catch { msg.textContent = 'Network error'; msg.style.color = '#f87171'; }
    }
    async function toggleMonitor(id) {
      await fetch('/api/monitors/' + id + '/toggle', { method: 'POST' });
      location.reload();
    }
    async function deleteMonitor(id) {
      if (!confirm('Delete this monitor and all its data?')) return;
      await fetch('/api/monitors/' + id, { method: 'DELETE' });
      location.href = '/';
    }
    (function() {
      const ctx = document.getElementById('chart').getContext('2d');
      const labels = ${chartLabels};
      const data = ${chartData};
      const max = Math.max(...data, 1);
      const w = ctx.canvas.width = ctx.canvas.offsetWidth;
      const h = 160;
      ctx.canvas.height = h;

      // Grid
      ctx.strokeStyle = '#262626';
      ctx.lineWidth = 1;
      for (let i = 0; i < 4; i++) {
        const y = (h / 4) * i + 10;
        ctx.beginPath();
        ctx.moveTo(40, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.fillStyle = '#525252';
        ctx.font = '11px system-ui';
        ctx.fillText(Math.round(max - (max / 4) * i) + 'ms', 0, y + 4);
      }

      // Line
      if (data.length > 1) {
        const step = (w - 50) / (data.length - 1);
        ctx.beginPath();
        ctx.strokeStyle = '#60a5fa';
        ctx.lineWidth = 2;
        data.forEach((v, i) => {
          const x = 50 + i * step;
          const y = h - 10 - ((v / max) * (h - 30));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Fill
        ctx.lineTo(50 + (data.length - 1) * step, h - 10);
        ctx.lineTo(50, h - 10);
        ctx.closePath();
        ctx.fillStyle = 'rgba(96, 165, 250, 0.08)';
        ctx.fill();

        // Hover tooltip
        const canvas = ctx.canvas;
        const tooltip = document.getElementById('tooltip');
        const ttTime = document.getElementById('ttTime');
        const ttVal = document.getElementById('ttVal');
        canvas.addEventListener('mousemove', function(e) {
          const rect = canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left;
          const idx = Math.round((mx - 50) / step);
          if (idx >= 0 && idx < data.length) {
            ttTime.textContent = labels[idx];
            ttVal.textContent = data[idx] + ' ms';
            tooltip.style.display = 'block';
            const tx = 50 + idx * step;
            const ty = h - 10 - ((data[idx] / max) * (h - 30));
            tooltip.style.left = Math.min(tx + 8, w - 100) + 'px';
            tooltip.style.top = Math.max(ty - 44, 0) + 'px';

            // Draw crosshair dot
            ctx.clearRect(0, 0, w, h);
            // Redraw grid
            ctx.strokeStyle = '#262626'; ctx.lineWidth = 1;
            for (var gi = 0; gi < 4; gi++) {
              var gy = (h / 4) * gi + 10;
              ctx.beginPath(); ctx.moveTo(40, gy); ctx.lineTo(w, gy); ctx.stroke();
              ctx.fillStyle = '#525252'; ctx.font = '11px system-ui';
              ctx.fillText(Math.round(max - (max / 4) * gi) + 'ms', 0, gy + 4);
            }
            // Redraw line
            ctx.beginPath(); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2;
            data.forEach(function(v, i) {
              var x = 50 + i * step, y = h - 10 - ((v / max) * (h - 30));
              if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.lineTo(50 + (data.length - 1) * step, h - 10);
            ctx.lineTo(50, h - 10); ctx.closePath();
            ctx.fillStyle = 'rgba(96, 165, 250, 0.08)'; ctx.fill();
            // Draw dot
            ctx.beginPath();
            ctx.arc(tx, ty, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#60a5fa'; ctx.fill();
            ctx.strokeStyle = '#0a0a0a'; ctx.lineWidth = 2; ctx.stroke();
          }
        });
        canvas.addEventListener('mouseleave', function() {
          tooltip.style.display = 'none';
          // Redraw without dot
          ctx.clearRect(0, 0, w, h);
          ctx.strokeStyle = '#262626'; ctx.lineWidth = 1;
          for (var gi = 0; gi < 4; gi++) {
            var gy = (h / 4) * gi + 10;
            ctx.beginPath(); ctx.moveTo(40, gy); ctx.lineTo(w, gy); ctx.stroke();
            ctx.fillStyle = '#525252'; ctx.font = '11px system-ui';
            ctx.fillText(Math.round(max - (max / 4) * gi) + 'ms', 0, gy + 4);
          }
          ctx.beginPath(); ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 2;
          data.forEach(function(v, i) {
            var x = 50 + i * step, y = h - 10 - ((v / max) * (h - 30));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.lineTo(50 + (data.length - 1) * step, h - 10);
          ctx.lineTo(50, h - 10); ctx.closePath();
          ctx.fillStyle = 'rgba(96, 165, 250, 0.08)'; ctx.fill();
        });
      }
    })();
    </script>
  `;

  return layout(monitor.name, content);
}

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  if (hours < 24) return `${hours}h ${remMins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
