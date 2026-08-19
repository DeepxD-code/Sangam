import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Modal from '../components/Modal.jsx';
import TransferDetailModal from '../components/TransferDetailModal.jsx';
import { useSearchState } from '../hooks/useSearchState.js';

/**
 * Transfer Register  (Day 31 → Day 33 — reject modal; pagination Day 62)
 */
const STATUS_FILTERS = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];
const PAGE_SIZE = 50;

const STATUS_STYLE = {
  PENDING:   'status-warn',
  APPROVED:  'status-good',
  REJECTED:  'status-critical',
  COMPLETED: 'status-good'
};

function age(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function TransferListPage({ user, onLogout, onApproveAction }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [transfers,    setTransfers]    = useState([]);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [filters, setFilters] = useSearchState('transfers', { statusFilter: 'ALL' });
  const statusFilter    = filters.statusFilter;
  const setStatusFilter = v => setFilters(f => ({ ...f, statusFilter: v }));
  const [actionBusy,   setActionBusy]   = useState(null);
  const [feedback,     setFeedback]     = useState(null);
  const [offset,       setOffset]       = useState(0);

  // Reject modal state
  const [rejectModal,  setRejectModal]  = useState({ open: false, transferId: null });
  const [rejectReason, setRejectReason] = useState('');
  const [rejectBusy,   setRejectBusy]   = useState(false);

  // Detail modal
  const [detailId, setDetailId] = useState(null);

  // Deep-link support: arriving from the blockchain page's "View Transfer"
  // action passes { openTransferId } in router state.
  useEffect(() => {
    if (location.state?.openTransferId) {
      setDetailId(location.state.openTransferId);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, location.pathname, navigate]);

  const isOfficer = user && user.rankLevel >= 3;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const statusFilters = statusFilter !== 'ALL' ? { status: statusFilter } : {};
      const result  = await api.getTransfers({ ...statusFilters, limit: PAGE_SIZE, offset });
      setTransfers(result.transfers || []);
      setTotal(result.total || 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load transfers');
    } finally {
      setLoading(false);
    }
  }, [statusFilter, offset, onLogout]);

  // A status filter change starts back at page 1.
  useEffect(() => {
    setOffset(0);
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const totalPages  = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  async function handleApprove(id) {
    setActionBusy(id);
    setFeedback(null);
    try {
      await api.approveTransfer(id);
      setFeedback({ type: 'success', message: `Transfer #${id} approved.` });
      await load();
      if (onApproveAction) onApproveAction();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Approval failed' });
    } finally {
      setActionBusy(null);
    }
  }

  function openRejectModal(transferId) {
    setRejectReason('');
    setRejectModal({ open: true, transferId });
  }

  function closeRejectModal() {
    if (rejectBusy) return;
    setRejectModal({ open: false, transferId: null });
    setRejectReason('');
  }

  async function confirmReject() {
    const { transferId } = rejectModal;
    if (!rejectReason.trim()) return;
    setRejectBusy(true);
    setFeedback(null);
    try {
      await api.rejectTransfer(transferId, rejectReason.trim());
      setFeedback({ type: 'success', message: `Transfer #${transferId} rejected.` });
      closeRejectModal();
      await load();
      if (onApproveAction) onApproveAction();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Rejection failed' });
    } finally {
      setRejectBusy(false);
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Transfer Register</h1>
          <span className="page-subtitle">
            {total} TRANSFER{total !== 1 ? 'S' : ''} IN SCOPE
            {totalPages > 1 ? ` · PAGE ${currentPage}/${totalPages}` : ''}
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/supply/transfers/new')}>
          + NEW TRANSFER
        </button>
      </div>

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      <div className="tab-bar">
        {STATUS_FILTERS.map(s => (
          <button key={s} className={`tab${statusFilter === s ? ' tab-active' : ''}`}
            onClick={() => setStatusFilter(s)}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : transfers.length === 0 ? (
        <div className="table-empty">
          No {statusFilter !== 'ALL' ? statusFilter.toLowerCase() + ' ' : ''}transfers in scope
        </div>
      ) : (
        <div className="table-scroll" data-tour="transfers-list">
          <table className="item-table">
            <thead>
              <tr>
                <th>#</th>
                <th>ITEM</th>
                <th>FROM → TO</th>
                <th className="qty-cell">QTY</th>
                <th>STATUS</th>
                <th>AGE</th>
                {isOfficer && <th>ACTIONS</th>}
              </tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.id}
                  className="tr-clickable"
                  onClick={e => { if (e.target.closest('.action-cell,.btn')) return; setDetailId(t.id); }}
                  title="Click to view details"
                >
                  <td className="item-code-cell">{t.id}</td>
                  <td>
                    <div className="item-name-cell">{t.itemName || '—'}</div>
                    <div className="item-code-cell" style={{ fontSize: 11 }}>{t.itemCode || ''}</div>
                  </td>
                  <td className="item-code-cell">U-{t.fromUnitId} → U-{t.toUnitId}</td>
                  <td className="qty-cell">{t.quantity}</td>
                  <td>
                    <span className={`status-pill ${STATUS_STYLE[t.status] || ''}`}>{t.status}</span>
                  </td>
                  <td className="item-code-cell">{age(t.createdAt)}</td>
                  {isOfficer && (
                    <td>
                      {t.status === 'PENDING' ? (
                        <div className="action-cell">
                          <button className="btn btn-sm btn-approve"
                            disabled={actionBusy === t.id}
                            onClick={() => handleApprove(t.id)}>
                            {actionBusy === t.id ? '…' : 'APPROVE'}
                          </button>
                          <button className="btn btn-sm btn-reject"
                            onClick={() => openRejectModal(t.id)}>
                            REJECT
                          </button>
                        </div>
                      ) : (
                        <span className="item-code-cell">{t.decidedAt ? age(t.decidedAt) : '—'}</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm btn-ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← PREV
          </button>
          <span className="pagination-info">
            PAGE {currentPage} / {totalPages}
          </span>
          <button className="btn btn-sm btn-ghost"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>
            NEXT →
          </button>
        </div>
      )}

      {/* Reject-reason modal */}
      <Modal
        open={rejectModal.open}
        onClose={closeRejectModal}
        title={`Reject Transfer #${rejectModal.transferId}`}
        size="sm"
        actions={
          <>
            <button className="btn btn-ghost" onClick={closeRejectModal} disabled={rejectBusy}>
              Cancel
            </button>
            <button
              className="btn btn-reject"
              onClick={confirmReject}
              disabled={rejectBusy || !rejectReason.trim()}
            >
              {rejectBusy ? 'Rejecting…' : 'Confirm Reject'}
            </button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label">
            Reason for rejection <span style={{ color: 'var(--status-critical)' }}>*</span>
          </label>
          <textarea
            className="form-textarea"
            rows={4}
            placeholder="State the operational reason for rejection (required for audit record)…"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            autoFocus
            disabled={rejectBusy}
          />
          {!rejectReason.trim() && (
            <p className="field-error">A rejection reason is required for the audit log.</p>
          )}
        </div>
      </Modal>

      {/* Transfer detail modal */}
      <TransferDetailModal
        transferId={detailId}
        onClose={() => setDetailId(null)}
        user={user}
        onApprove={(id) => { setDetailId(null); handleApprove(id); }}
        onReject={(id)  => { setDetailId(null); openRejectModal(id); }}
      />
    </div>
  );
}
