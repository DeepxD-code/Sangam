import React from 'react';

/**
 * ActivityFeed  (Day 38 — enhanced)
 *
 * Shows a timestamped list of recent system events from the dashboard.
 * Severity-coded left border. Limits to 12 entries for visual cleanliness.
 */

const SEV_CLASS = {
  CRITICAL: 'activity-sev-critical',
  WARNING:  'activity-sev-warning',
  SECURITY: 'activity-sev-security',
  INFO:     '',
};

function formatTime(iso) {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function formatDate(iso) {
  if (!iso) return '';
  const d   = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'today';
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

export default function ActivityFeed({ entries = [] }) {
  const shown = entries.slice(0, 15);

  return (
    <div className="activity-panel">
      <div className="activity-header">
        <span>RECENT ACTIVITY</span>
        <span className="activity-count">{entries.length} EVENT{entries.length !== 1 ? 'S' : ''}</span>
      </div>
      {shown.length === 0 ? (
        <div className="activity-empty">No recent activity recorded.</div>
      ) : (
        <div className="activity-list">
          {shown.map((e, i) => (
            <div
              key={`${e.action}-${e.timestamp}-${i}`}
              className={`activity-row ${SEV_CLASS[e.severity] || ''}`}
            >
              <span className="activity-time">
                {formatTime(e.timestamp)}
                <span className="activity-date">{formatDate(e.timestamp)}</span>
              </span>
              <div className="activity-body">
                <span className="activity-action">{e.action}</span>
                {e.resource && (
                  <span className="activity-resource">{e.resource}</span>
                )}
                {e.user && (
                  <span className="activity-user">{e.user}</span>
                )}
              </div>
              {e.severity && e.severity !== 'INFO' && (
                <span className={`activity-sev-tag sev-${(e.severity||'').toLowerCase()}`}>
                  {e.severity}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
