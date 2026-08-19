import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import Modal from './Modal.jsx';

/**
 * TransferDetailModal  (Day 41)
 *
 * Opens when user clicks a transfer row.
 * Shows full timeline, item details, blockchain proof (if approved).
 *
 * Props:
 *   transferId  {number|null}   - null = closed
 *   onClose     {() => void}
 *   onApprove   {(id) => void}  - optional, shown for OFFICER+ on PENDING
 *   onReject    {(id) => void}  - optional
 *   user        {object}        - current user
 */

const STATUS_STYLE = {
  PENDING:   'status-warn',
  APPROVED:  'status-good',
  COMPLETED: 'status-good',
  REJECTED:  'status-critical',
};

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
}

function shortHash(h) {
  if (!h) return null;
  return h.slice(0, 10) + '…' + h.slice(-8);
}

export default function TransferDetailModal({ transferId, onClose, onApprove, onReject, user }) {
  const navigate = useNavigate();
  const [transfer, setTransfer] = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState(null);

  const isOfficer = user && user.rankLevel >= 3;
  const open = transferId != null;

  useEffect(() => {
    if (!open) { setTransfer(null); setError(null); return; }
    setLoading(true);
    api.getTransfer(transferId)
      .then(r => { if (r?.success) setTransfer(r.transfer); else setError('Transfer not found.'); })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [transferId, open]);

  const t = transfer;

  // Build timeline events
  const events = t ? [
    { label: 'Requested',  time: t.createdAt,  icon: '◎', cls: '' },
    t.decidedAt && t.status !== 'PENDING' ? {
      label: t.status === 'REJECTED' ? 'Rejected' : 'Approved',
      time: t.decidedAt, icon: t.status === 'REJECTED' ? '✗' : '✓',
      cls: t.status === 'REJECTED' ? 'tl-rejected' : 'tl-approved'
    } : null,
    t.blockIndex != null ? {
      label: 'Ledger entry recorded',
      time: t.decidedAt, icon: '⛓', cls: 'tl-blockchain'
    } : null,
  ].filter(Boolean) : [];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t ? `Transfer #${t.id} — ${t.itemCode || t.itemName}` : 'Transfer Details'}
      size="md"
      actions={
        isOfficer && t?.status === 'PENDING' ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-reject btn-sm"
              onClick={() => { onReject && onReject(t.id); onClose(); }}>
              Reject
            </button>
            <button className="btn btn-approve btn-sm"
              onClick={() => { onApprove && onApprove(t.id); onClose(); }}>
              Approve
            </button>
          </>
        ) : (
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        )
      }
    >
      {loading && <div className="state-screen" style={{ minHeight: 120 }}><div className="spinner" /></div>}
      {error   && <p className="state-error">{error}</p>}

      {t && (
        <div className="transfer-detail">

          {/* Header row */}
          <div className="td-header">
            <span className={`status-pill ${STATUS_STYLE[t.status] || ''}`}>{t.status}</span>
            {t.blockIndex != null && (
              <button
                className="btn btn-sm td-blockchain-btn"
                onClick={() => { onClose(); navigate('/supply/blockchain'); }}
                title="View in blockchain ledger"
              >
                ⛓ Block #{t.blockIndex}
              </button>
            )}
          </div>

          {/* Item info */}
          <div className="td-section">
            <div className="td-section-label">Supply Item</div>
            <div className="td-item-name">{t.itemName}</div>
            <div className="td-item-meta">
              <span className="td-chip">{t.itemCode}</span>
              <span className="td-chip">Qty: {t.quantity}</span>
            </div>
          </div>

          {/* Route */}
          <div className="td-section">
            <div className="td-section-label">Movement Route</div>
            <div className="td-route">
              <div className="td-unit">
                <span className="td-unit-label">FROM</span>
                <span className="td-unit-code">UNIT-{t.fromUnitId}</span>
              </div>
              <span className="td-route-arrow">→</span>
              <div className="td-unit">
                <span className="td-unit-label">TO</span>
                <span className="td-unit-code">UNIT-{t.toUnitId}</span>
              </div>
            </div>
          </div>

          {/* Notes */}
          {t.notes && (
            <div className="td-section">
              <div className="td-section-label">Notes</div>
              <div className="td-notes">{t.notes}</div>
            </div>
          )}

          {/* Rejection reason */}
          {t.rejectionReason && (
            <div className="td-section">
              <div className="td-section-label" style={{ color: 'var(--status-critical)' }}>Rejection Reason</div>
              <div className="td-notes td-rejection">{t.rejectionReason}</div>
            </div>
          )}

          {/* Timeline */}
          <div className="td-section">
            <div className="td-section-label">Timeline</div>
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

          {/* Blockchain proof */}
          {t.blockIndex != null && (
            <div className="td-section td-proof">
              <div className="td-section-label">Blockchain Proof</div>
              <div className="td-proof-grid">
                <div>
                  <span className="td-proof-key">Block Index</span>
                  <span className="td-proof-val">#{t.blockIndex}</span>
                </div>
                {t.blockHash && (
                  <div>
                    <span className="td-proof-key">Block Hash</span>
                    <span className="td-proof-val mono">{shortHash(t.blockHash)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Actor IDs */}
          <div className="td-actors">
            <span>Requested by: User #{t.requestedByUserId || '—'}</span>
            {t.approvedByUserId && <span>Decided by: User #{t.approvedByUserId}</span>}
          </div>
        </div>
      )}
    </Modal>
  );
}
