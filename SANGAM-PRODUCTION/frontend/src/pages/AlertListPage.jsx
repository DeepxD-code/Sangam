import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useSearchState } from '../hooks/useSearchState.js';
import AlertDetailModal from '../components/AlertDetailModal.jsx';

/**
 * Alert Monitor  (Day 31, refactored Day 32, detail modal Day 49)
 * Sidebar handles navigation; TopBar removed.
 */

const SEVERITY_FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

const SEVERITY_CLASS = {
  CRITICAL: 'status-critical',
  HIGH:     'status-warn',
  MEDIUM:   'status-warn',
  LOW:      'status-good'
};

// Backend AlertEscalationService.STATUS only ever produces these 4 values
// (OPEN, ESCALATED, RESOLVED, SUPPRESSED) — there is no 'ACTIVE' status.
const STATUS_CLASS = {
  OPEN:         'pill-active',
  ESCALATED:    'pill-escalated',
  RESOLVED:     'pill-resolved',
  SUPPRESSED:   'pill-suppressed'
};

function age(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function AlertListPage({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [alerts,     setAlerts]     = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [alertFilters, setAlertFilters] = useSearchState('alerts', { sevFilter: 'ALL' });
  const sevFilter    = alertFilters.sevFilter;
  const setSevFilter = v => setAlertFilters(f => ({ ...f, sevFilter: v }));
  const [actionBusy, setActionBusy] = useState(null);
  const [scanning,   setScanning]   = useState(false);
  const [feedback,   setFeedback]   = useState(null);
  const [detailId,   setDetailId]   = useState(null);

  // Deep-link support: dashboard's ALT widget (or any future cross-link)
  // can pass { openAlertId } in router state to jump straight to a detail.
  useEffect(() => {
    if (location.state?.openAlertId) {
      setDetailId(location.state.openAlertId);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters = sevFilter !== 'ALL' ? { severity: sevFilter } : {};
      const result  = await api.getAlerts(filters);
      setAlerts(result.alerts || []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, [sevFilter, onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleScan() {
    setScanning(true);
    setFeedback(null);
    try {
      const result = await api.scanAlerts();
      setFeedback({
        type: 'success',
        message: `Scan complete — ${result.raised || 0} raised, ${result.escalated || 0} escalated, ${result.resolved || 0} resolved`
      });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Scan failed' });
    } finally {
      setScanning(false);
    }
  }

  async function handleAck(id) {
    setActionBusy(id + '_ack');
    try {
      await api.acknowledgeAlert(id);
      setFeedback({ type: 'success', message: `Alert #${id} acknowledged.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setActionBusy(null);
    }
  }

  async function handleResolve(id) {
    setActionBusy(id + '_res');
    try {
      await api.resolveAlert(id, 'Resolved via dashboard');
      setFeedback({ type: 'success', message: `Alert #${id} resolved.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally {
      setActionBusy(null);
    }
  }

  const activeCount = alerts.filter(a => ['OPEN', 'ESCALATED'].includes(a.status)).length;

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Alert Monitor</h1>
          <span className="page-subtitle">
            {alerts.length} ALERT{alerts.length !== 1 ? 'S' : ''} · {activeCount} ACTIVE
          </span>
        </div>
        <button className="btn btn-primary" onClick={handleScan} disabled={scanning} data-tour="scan-alerts-btn">
          {scanning ? 'SCANNING…' : '↻ SCAN NOW'}
        </button>
      </div>

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      <div className="tab-bar">
        {SEVERITY_FILTERS.map(s => (
          <button
            key={s}
            className={`tab${sevFilter === s ? ' tab-active' : ''}`}
            onClick={() => setSevFilter(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : alerts.length === 0 ? (
        <div className="table-empty">
          No {sevFilter !== 'ALL' ? sevFilter.toLowerCase() + ' ' : ''}alerts.
          Click "SCAN NOW" to run a fresh violation check.
        </div>
      ) : (
        <div className="alert-list">
          {alerts.map(a => (
            <div key={a.id} className={`alert-card sev-${(a.severity || '').toLowerCase()} alert-card--clickable`}
              onClick={() => setDetailId(a.id)} role="button" tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter') setDetailId(a.id); }}>
              <div className="alert-header">
                <span className={`sev-badge ${SEVERITY_CLASS[a.severity] || ''}`}>
                  {a.severity}
                </span>
                <span className={`status-pill ${STATUS_CLASS[a.status] || ''}`}>
                  {a.status}
                </span>
                <span className="alert-age">{age(a.raisedAt || a.createdAt)}</span>
              </div>
              <div className="alert-title">{a.title || a.type}</div>
              {a.detail && <div className="alert-message">{a.detail}</div>}
              <div className="alert-meta">
                TYPE: {a.type}
                {a.unitId ? (
                  <button className="alert-unit-link" onClick={(e) => { e.stopPropagation(); navigate('/supply/items'); }} title="View supply items">
                    {` · UNIT: U-${a.unitId}`}
                  </button>
                ) : ''}
                {a.meta?.itemId ? ` · ITEM: ${a.meta.itemId}` : ''}
              </div>
              <div className="action-cell" onClick={e => e.stopPropagation()}>
                {['OPEN', 'ESCALATED'].includes(a.status) && !a.acknowledgedAt && (
                  <button
                    className="btn btn-sm btn-approve"
                    disabled={actionBusy === a.id + '_ack'}
                    onClick={() => handleAck(a.id)}
                  >
                    {actionBusy === a.id + '_ack' ? '…' : 'ACKNOWLEDGE'}
                  </button>
                )}
                {['OPEN', 'ESCALATED'].includes(a.status) && (
                  <button
                    className="btn btn-sm"
                    disabled={actionBusy === a.id + '_res'}
                    onClick={() => handleResolve(a.id)}
                  >
                    {actionBusy === a.id + '_res' ? '…' : 'RESOLVE'}
                  </button>
                )}
                <button className="btn btn-sm btn-ghost" onClick={() => setDetailId(a.id)}>DETAILS</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDetailModal
        alertId={detailId}
        onClose={() => setDetailId(null)}
        user={user}
        onChanged={load}
      />
    </div>
  );
}
