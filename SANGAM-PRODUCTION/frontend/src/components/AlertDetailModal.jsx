import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

/**
 * AlertDetailModal  (Day 49)
 *
 * Opens when a user clicks an alert card or its DETAILS button. Shows the
 * full escalation history timeline reconstructed from the alert's own
 * lifecycle timestamps (raisedAt → acknowledgedAt → escalatedAt →
 * resolvedAt/suppressedAt) — all fields AlertEscalationService already
 * stamps on the entity, so no separate audit-log query is needed and this
 * works identically online or fully offline.
 *
 * Props:
 *   alertId    {number|null}  - null = closed
 *   onClose    {() => void}
 *   user       {object}       - current user
 *   onChanged  {() => void}   - called after acknowledge/resolve/suppress
 *                                so the parent list can refresh
 */

const SEVERITY_CLASS = {
  CRITICAL: 'status-critical',
  HIGH:     'status-warn',
  MEDIUM:   'status-warn',
  LOW:      'status-good'
};

const STATUS_CLASS = {
  OPEN:       'pill-active',
  ESCALATED:  'pill-escalated',
  RESOLVED:   'pill-resolved',
  SUPPRESSED: 'pill-suppressed'
};

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

export default function AlertDetailModal({ alertId, onClose, user, onChanged }) {
  const navigate = useNavigate();
  const [alert,   setAlert]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [busy,    setBusy]    = useState(null);
  const [suppressReason, setSuppressReason] = useState('');
  const [showSuppressForm, setShowSuppressForm] = useState(false);

  const open = alertId != null;
  const canAct = user && user.rankLevel >= 3; // OFFICER+ (matches supply:write / supply:approve tier used elsewhere)

  useEffect(() => {
    if (!open) { setAlert(null); setError(null); setShowSuppressForm(false); setSuppressReason(''); return; }
    setLoading(true);
    api.getAlert(alertId)
      .then(r => { if (r?.success) setAlert(r.alert); else setError('Alert not found.'); })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [alertId, open]);

  const a = alert;

  // Escalation history — every stamp AlertEscalationService already tracks
  // on the entity itself, in chronological order.
  const events = a ? [
    { label: 'Raised', time: a.raisedAt, icon: '◎', cls: '' },
    a.acknowledgedAt ? { label: `Acknowledged (User #${a.acknowledgedBy})`, time: a.acknowledgedAt, icon: '👁', cls: 'tl-approved' } : null,
    a.escalatedAt ? { label: 'Escalated — unacknowledged past threshold', time: a.escalatedAt, icon: '⚠', cls: 'tl-rejected' } : null,
    a.resolvedAt ? { label: `Resolved (User #${a.resolvedBy})`, time: a.resolvedAt, icon: '✓', cls: 'tl-approved' } : null,
    a.suppressedAt ? { label: `Suppressed (User #${a.suppressedBy})`, time: a.suppressedAt, icon: '⊘', cls: 'tl-rejected' } : null,
  ].filter(Boolean).sort((x, y) => new Date(x.time) - new Date(y.time)) : [];

  async function runAction(kind, fn) {
    setBusy(kind);
    try {
      const r = await fn();
      if (r?.success) {
        setAlert(r.alert);
        onChanged && onChanged();
      } else {
        setError(r?.error || 'Action failed');
      }
    } catch (e) {
      setError(e.message || 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  const canAcknowledge = a && ['OPEN', 'ESCALATED'].includes(a.status) && !a.acknowledgedAt;
  const canResolve     = a && ['OPEN', 'ESCALATED'].includes(a.status);
  const canSuppress    = a && ['OPEN', 'ESCALATED'].includes(a.status);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={a ? `Alert #${a.id} — ${a.title || a.type}` : 'Alert Details'}
      size="md"
      actions={
        <>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          {canAct && canSuppress && (
            <button className="btn btn-sm btn-reject" disabled={!!busy}
              onClick={() => setShowSuppressForm(s => !s)}>
              SUPPRESS
            </button>
          )}
          {canAct && canResolve && (
            <button className="btn btn-sm" disabled={!!busy}
              onClick={() => runAction('resolve', () => api.resolveAlert(a.id, 'Resolved from detail view'))}>
              {busy === 'resolve' ? '…' : 'RESOLVE'}
            </button>
          )}
          {canAct && canAcknowledge && (
            <button className="btn btn-sm btn-approve" disabled={!!busy}
              onClick={() => runAction('ack', () => api.acknowledgeAlert(a.id))}>
              {busy === 'ack' ? '…' : 'ACKNOWLEDGE'}
            </button>
          )}
        </>
      }
    >
      {loading && <div className="state-screen" style={{ minHeight: 120 }}><div className="spinner" /></div>}
      {error   && <p className="state-error">{error}</p>}

      {a && (
        <div className="transfer-detail">
          <div className="td-header">
            <span className={`sev-badge ${SEVERITY_CLASS[a.severity] || ''}`}>{a.severity}</span>
            <span className={`status-pill ${STATUS_CLASS[a.status] || ''}`}>{a.status}</span>
          </div>

          <div className="td-section">
            <div className="td-section-label">Description</div>
            <div className="td-item-name">{a.title || a.type}</div>
            {a.detail && <div className="td-notes">{a.detail}</div>}
            <div className="td-item-meta">
              <span className="td-chip">TYPE: {a.type}</span>
              {a.unitId && (
                <button className="td-chip" style={{ cursor: 'pointer' }}
                  onClick={() => { onClose(); navigate(`/units/${a.unitId}`); }}>
                  UNIT #{a.unitId} →
                </button>
              )}
              {a.meta?.itemId && <span className="td-chip">ITEM #{a.meta.itemId}</span>}
              {a.meta?.quantity != null && <span className="td-chip">QTY: {a.meta.quantity}</span>}
              {a.meta?.threshold != null && <span className="td-chip">THRESHOLD: {a.meta.threshold}</span>}
            </div>
          </div>

          {showSuppressForm && (
            <div className="td-section">
              <div className="td-section-label" style={{ color: 'var(--status-critical)' }}>Suppress — reason required</div>
              <textarea
                className="form-input"
                rows={2}
                placeholder="Why is this alert being suppressed?"
                value={suppressReason}
                onChange={e => setSuppressReason(e.target.value)}
              />
              <div style={{ display: 'flex', gap: 'var(--sp-2)', marginTop: 'var(--sp-2)' }}>
                <button className="btn btn-sm btn-ghost" onClick={() => setShowSuppressForm(false)}>Cancel</button>
                <button
                  className="btn btn-sm btn-reject"
                  disabled={!suppressReason.trim() || busy === 'suppress'}
                  onClick={() => runAction('suppress', () => api.suppressAlert(a.id, suppressReason.trim()))}
                >
                  {busy === 'suppress' ? '…' : 'CONFIRM SUPPRESS'}
                </button>
              </div>
            </div>
          )}

          {a.resolution && (
            <div className="td-section">
              <div className="td-section-label">Resolution Note</div>
              <div className="td-notes">{a.resolution}</div>
            </div>
          )}
          {a.suppression && (
            <div className="td-section">
              <div className="td-section-label" style={{ color: 'var(--status-critical)' }}>Suppression Reason</div>
              <div className="td-notes td-rejection">{a.suppression}</div>
            </div>
          )}

          <div className="td-section">
            <div className="td-section-label">Escalation History</div>
            <div className="td-timeline">
              {events.map((ev, i) => (
                <div key={i} className={`td-event ${ev.cls}`}>
                  <span className="td-event-icon">{ev.icon}</span>
                  <div className="td-event-body">
                    <span className="td-event-label">{ev.label}</span>
                    <span className="td-event-time">{fmt(ev.time)}</span>
                  </div>
                  {i < events.length - 1 && <div className="td-event-connector" />}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
