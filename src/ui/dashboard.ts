import type { Env } from '../types';
import { getMonitorStats, getRecentChecks } from '../db/queries';
import { layout } from './layout';

export async function renderDashboard(env: Env): Promise<string> {
  const stats = await getMonitorStats(env);

  if (stats.length === 0) {
    return layout('Dashboard', `
      <h1>Dashboard</h1>
      <div class="empty">
        <p style="font-size: 36px; margin-bottom: 12px;">&#x1F4E1;</p>
        <p style="color: #a3a3a3; margin-bottom: 16px;">No monitors yet</p>
        <p style="font-size: 13px;">Monitors will appear automatically after the first zone sync, or you can <a href="/settings">add one manually</a>.</p>
      </div>
    `);
  }

  // Fetch uptime bars for each monitor (last 90 checks ~ 7.5 hours)
  const monitorCards = await Promise.all(
    stats.map(async (m) => {
      const checks = await getRecentChecks(env, m.id, 90);
      const uptimePct = m.total_24h > 0 ? ((m.up_24h / m.total_24h) * 100) : 100;
      const pctClass = uptimePct >= 99 ? 'good' : uptimePct >= 95 ? 'warn' : 'bad';

      const statusBadge =
        m.current_status === 1
          ? '<span class="badge badge-up">Up</span>'
          : m.current_status === 0
          ? '<span class="badge badge-down">Down</span>'
          : '<span class="badge badge-unknown">Pending</span>';

      // Build uptime bar segments (oldest to newest)
      const segments = [];
      const reversed = [...checks].reverse();
      for (let i = 0; i < 90; i++) {
        const check = reversed[i];
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

      return `
        <div class="card" style="cursor: pointer;" onclick="if(event.target.tagName!=='A')location.href='/monitor/${m.id}'">
          <div class="card-header">
            <div>
              <span class="name">${m.name}</span>
              <a href="${m.url}" target="_blank" rel="noopener" onclick="event.stopPropagation()" style="color: #737373; font-size: 13px; margin-left: 8px;">${m.url} &#x2197;</a>
            </div>
            ${statusBadge}
          </div>
          <div class="uptime-bar">${segments.join('')}</div>
          <div class="card-meta">
            <span class="uptime-pct ${pctClass}" style="font-size: 14px;">${uptimePct.toFixed(2)}%</span>
            <span class="response-time">${m.last_response_ms !== null ? m.last_response_ms + 'ms' : '—'}</span>
            <span class="badge badge-${m.source}" style="font-size: 11px;">${m.source}</span>
          </div>
        </div>
      `;
    })
  );

  const upCount = stats.filter((m) => m.current_status === 1).length;
  const downCount = stats.filter((m) => m.current_status === 0).length;

  const content = `
    <div class="flex-between" style="margin-bottom: 20px;">
      <h1 style="margin-bottom: 0;">Dashboard</h1>
      <div style="display: flex; gap: 12px; font-size: 14px;">
        <span style="color: #4ade80;">${upCount} up</span>
        ${downCount > 0 ? `<span style="color: #f87171;">${downCount} down</span>` : ''}
        <span style="color: #737373;">${stats.length} total</span>
      </div>
    </div>
    ${monitorCards.join('')}
  `;

  return layout('Dashboard', content);
}
