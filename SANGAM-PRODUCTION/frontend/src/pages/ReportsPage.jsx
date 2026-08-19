import React, { useState, useEffect } from 'react';
import { api, ApiError } from '../api/client.js';

/**
 * ReportsPage  (Day 45; DB-availability warning added Day 59)
 *
 * Provides CSV export buttons for all exportable report types.
 * Each export button calls GET /api/reports/export/:type and
 * triggers a browser file download.
 *
 * Report types:
 *   stock-levels   → inventory by unit
 *   transfers      → pending / historical transfers (date range)
 *   unit-roster    → all units with personnel counts
 *   mesh-health    → peer node connectivity summary
 *
 * All four are backed by reporting.service.js methods that query
 * Postgres directly and return `available:false` when `db` is null —
 * which is this app's PRIMARY, default mode (offline-first in-memory
 * Maps). Before Day 59, the export button gave no indication of this:
 * clicking Export in offline mode silently downloaded a 0-byte CSV.
 * This now checks GET /health once on mount (a single, permission-free
 * call — cheaper and more direct than probing each report type, since
 * `db` is one server-wide connection, not a per-type property) and
 * disables the export buttons with a clear explanation when there's no
 * database connection, rather than allowing a confusing silent download.
 */

const REPORTS = [
  {
    type: 'stock-levels',
    label: 'Stock Levels',
    icon: '▣',
    description: 'Current inventory quantities across all units in command scope.',
    hasDateRange: false,
  },
  {
    type: 'transfers',
    label: 'Transfer Register',
    icon: '⇄',
    description: 'Supply transfer records. Optionally filter by date range.',
    hasDateRange: true,
  },
  {
    type: 'unit-roster',
    label: 'Unit Roster',
    icon: '⊞',
    description: 'Full unit hierarchy with personnel and status summary.',
    hasDateRange: false,
  },
  {
    type: 'mesh-health',
    label: 'Mesh Health',
    icon: '◈',
    description: 'Peer node connectivity and sync status for offline mesh network.',
    hasDateRange: false,
  },
];

function todayISO() { return new Date().toISOString().slice(0, 10); }
function thirtyDaysAgo() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export default function ReportsPage({ user }) {
  const [downloading, setDownloading] = useState(null);
  const [feedback,    setFeedback]    = useState(null);
  const [startDate,   setStartDate]   = useState(thirtyDaysAgo);
  const [endDate,     setEndDate]     = useState(todayISO);
  const [dbConnected, setDbConnected] = useState(true); // optimistic default while checking

  useEffect(() => {
    let cancelled = false;
    api.getHealth()
      .then(h => { if (!cancelled) setDbConnected(!!h?.db?.connected); })
      .catch(() => { if (!cancelled) setDbConnected(true); }); // fail open — don't block exports on a health-check hiccup
    return () => { cancelled = true; };
  }, []);

  async function handleExport(type, hasDateRange) {
    setDownloading(type);
    setFeedback(null);
    try {
      const params = hasDateRange ? { startDate, endDate } : {};
      await api.exportCSV(type, params);
      setFeedback({ type: 'success', message: `${type} report downloaded.` });
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setFeedback({ type: 'error', message: 'Access denied — insufficient permissions.' });
      } else {
        setFeedback({ type: 'error', message: err.message || 'Export failed.' });
      }
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Reports &amp; Exports</h1>
          <span className="page-subtitle">CSV downloads for command scope data</span>
        </div>
      </div>

      {!dbConnected && (
        <div className="feedback-banner error" style={{ marginBottom: 'var(--sp-4)' }}>
          These four reports query the database directly and require a Postgres connection —
          SANGAM is currently running offline-first on in-memory data, so exports below are disabled.
          Live dashboard figures are unaffected.
        </div>
      )}

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      {/* Global date range for reports that support it */}
      <div className="report-date-range">
        <span className="report-date-label">DATE RANGE (for transfer report):</span>
        <input
          type="date"
          className="form-input report-date-input"
          value={startDate}
          max={endDate}
          onChange={e => setStartDate(e.target.value)}
          aria-label="Start date"
        />
        <span className="report-date-sep">→</span>
        <input
          type="date"
          className="form-input report-date-input"
          value={endDate}
          min={startDate}
          max={todayISO()}
          onChange={e => setEndDate(e.target.value)}
          aria-label="End date"
        />
      </div>

      <div className="report-grid" data-tour="reports-grid">
        {REPORTS.map(r => (
          <div key={r.type} className={`report-card${!dbConnected ? ' report-card-disabled' : ''}`}>
            <div className="report-card-header">
              <span className="report-card-icon">{r.icon}</span>
              <span className="report-card-label">{r.label}</span>
            </div>
            <p className="report-card-desc">{r.description}</p>
            {r.hasDateRange && (
              <p className="report-card-range">
                Period: {startDate} → {endDate}
              </p>
            )}
            <button
              className="btn btn-primary report-export-btn"
              disabled={downloading === r.type || !dbConnected}
              title={!dbConnected ? 'Requires a database connection' : undefined}
              onClick={() => handleExport(r.type, r.hasDateRange)}
            >
              {downloading === r.type
                ? '⬇ Downloading…'
                : !dbConnected
                  ? '⊘ Requires database'
                  : '⬇ Export CSV'}
            </button>
          </div>
        ))}
      </div>

      <div className="report-note">
        <span className="report-note-icon">ℹ</span>
        All exports are scoped to your command hierarchy and logged in the audit trail.
        {dbConnected
          ? ' Files are generated in real-time from live data.'
          : ' These four require a database connection — the live dashboard and Compliance page work from in-memory data regardless.'}
      </div>
    </div>
  );
}

