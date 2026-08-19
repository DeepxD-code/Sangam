import React, { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api/client.js';
import Modal from '../components/Modal.jsx';

/**
 * Inventory / Stock-Take Page  (Day 35)
 *
 * Allows unit officers to initiate stock-takes and track reconciliation.
 * Routes:  GET  /api/inventory/sessions?unitId=X
 *          POST /api/inventory/sessions
 *          POST /api/inventory/sessions/:id/count
 *          POST /api/inventory/sessions/:id/finalize
 */

const STATE_FILTERS = ['ALL', 'OPEN', 'COUNTING', 'PENDING_APPROVAL', 'RECONCILED', 'CANCELLED'];

const STATE_STYLE = {
  OPEN:             'status-warn',
  COUNTING:         'status-warn',
  PENDING_APPROVAL: 'status-warn',
  RECONCILED:       'status-good',
  CANCELLED:        'status-critical',
};

const STATE_LABEL = {
  OPEN:             'OPEN',
  COUNTING:         'COUNTING',
  PENDING_APPROVAL: 'PENDING APPROVAL',
  RECONCILED:       'RECONCILED',
  CANCELLED:        'CANCELLED',
};

function age(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
}

export default function InventoryPage({ user, onLogout }) {
  const [units,       setUnits]       = useState([]);
  const [unitId,      setUnitId]      = useState('');
  const [sessions,    setSessions]    = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);
  const [stateFilter, setStateFilter] = useState('ALL');
  const [feedback,    setFeedback]    = useState(null);
  const [actionBusy,  setActionBusy]  = useState(null);

  // Detail modal (session counts)
  const [detailModal, setDetailModal] = useState({ open: false, session: null });

  // Create session modal
  const [createModal, setCreateModal] = useState(false);
  const [creating,    setCreating]    = useState(false);
  const [newUnitId,   setNewUnitId]   = useState('');
  const [newNotes,    setNewNotes]    = useState('');
  const [createErr,   setCreateErr]   = useState('');

  const canFinalize = user && user.rankLevel >= 2;
  const canApprove  = user && user.rankLevel >= 3;

  // Load units
  useEffect(() => {
    api.getUnits()
      .then(r => {
        const us = r.units || [];
        setUnits(us);
        // Default to user's own unit
        if (us.length > 0 && user?.unitId) {
          const own = us.find(u => u.id === user.unitId);
          if (own) setUnitId(String(own.id));
          else setUnitId(String(us[0].id));
        }
      })
      .catch(() => {});
  }, [user]);

  const load = useCallback(async () => {
    if (!unitId) return;
    setLoading(true); setError(null);
    try {
      const filters = stateFilter !== 'ALL' ? { state: stateFilter } : {};
      const result  = await api.getInventorySessions(unitId, { ...filters, limit: 50 });
      setSessions(result.sessions || []);
      setTotal(result.total ?? (result.sessions || []).length);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load sessions');
    } finally { setLoading(false); }
  }, [unitId, stateFilter, onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!newUnitId) { setCreateErr('Select a unit to stock-take.'); return; }
    setCreating(true); setCreateErr(''); setFeedback(null);
    try {
      await api.createInventorySession({
        unitId: parseInt(newUnitId, 10),
        notes: newNotes || undefined,
        createdByUserId: user?.userId
      });
      setFeedback({ type: 'success', message: 'Stock-take session started.' });
      setCreateModal(false); setNewNotes('');
      setUnitId(newUnitId);
      await load();
    } catch (err) {
      setCreateErr(err.message || 'Failed to create session');
    } finally { setCreating(false); }
  }

  async function handleFinalize(id) {
    setActionBusy(id + '_fin'); setFeedback(null);
    try {
      await api.finalizeInventorySession(id);
      setFeedback({ type: 'success', message: `Session #${id} finalized — pending approval.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally { setActionBusy(null); }
  }

  async function openDetail(session) {
    setDetailModal({ open: true, session });
    // Refresh session details
    try {
      const r = await api.getInventorySession(session.id);
      if (r.success) setDetailModal({ open: true, session: r.session });
    } catch { /* show cached version */ }
  }

  const activeCount = sessions.filter(s => ['OPEN','COUNTING','PENDING_APPROVAL'].includes(s.state)).length;

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Stock-Take</h1>
          <span className="page-subtitle">
            {total} SESSION{total !== 1 ? 'S' : ''} · {activeCount} ACTIVE
          </span>
        </div>
        <button className="btn btn-primary" onClick={() => { setNewUnitId(unitId); setNewNotes(''); setCreateErr(''); setCreateModal(true); }}>
          + NEW SESSION
        </button>
      </div>

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      {/* Unit selector */}
      <div className="filter-bar" style={{ marginBottom: 'var(--sp-4)' }}>
        <select value={unitId} onChange={e => setUnitId(e.target.value)} aria-label="Select unit">
          <option value="">— Select unit —</option>
          {units.map(u => (
            <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>
          ))}
        </select>
      </div>

      <div className="tab-bar">
        {STATE_FILTERS.map(s => (
          <button key={s} className={`tab${stateFilter === s ? ' tab-active' : ''}`}
            onClick={() => setStateFilter(s)}>
            {s === 'PENDING_APPROVAL' ? 'PENDING' : s}
          </button>
        ))}
      </div>

      {!unitId ? (
        <div className="table-empty">Select a unit to view stock-take sessions.</div>
      ) : loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : sessions.length === 0 ? (
        <div className="table-empty">
          No {stateFilter !== 'ALL' ? STATE_LABEL[stateFilter]?.toLowerCase() + ' ' : ''}sessions.
          Click "NEW SESSION" to begin a stock-take.
        </div>
      ) : (
        <div className="stocktake-list">
          {sessions.map(s => (
            <div key={s.id} className={`stocktake-card state-${(s.state||'').toLowerCase()}`}>
              <div className="stocktake-header">
                <div>
                  <span className="stocktake-id">ST-{String(s.id).padStart(4, '0')}</span>
                  <span className="stocktake-unit">{s.unitCode || `U-${s.unitId}`}</span>
                </div>
                <span className={`status-pill ${STATE_STYLE[s.state] || ''}`}>
                  {STATE_LABEL[s.state] || s.state}
                </span>
              </div>

              <div className="stocktake-meta">
                <span>STARTED: {age(s.createdAt)}</span>
                {s.finalizedAt && <span>FINALIZED: {fmtDate(s.finalizedAt)}</span>}
                {s.countEntries != null && (
                  <span>{s.countEntries} ITEM{s.countEntries !== 1 ? 'S' : ''} COUNTED</span>
                )}
                {s.discrepancyCount > 0 && (
                  <span className="stocktake-discrepancy">
                    ⚠ {s.discrepancyCount} DISCREPANC{s.discrepancyCount > 1 ? 'IES' : 'Y'}
                  </span>
                )}
              </div>

              {s.notes && <div className="stocktake-notes">{s.notes}</div>}

              <div className="action-cell" style={{ marginTop: 'var(--sp-3)' }}>
                <button className="btn btn-sm btn-ghost" onClick={() => openDetail(s)}>
                  VIEW DETAILS
                </button>
                {canFinalize && (s.state === 'OPEN' || s.state === 'COUNTING') && (
                  <button className="btn btn-sm btn-approve"
                    disabled={actionBusy === s.id + '_fin'}
                    onClick={() => handleFinalize(s.id)}>
                    {actionBusy === s.id + '_fin' ? '…' : 'FINALIZE'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Session detail modal */}
      <Modal
        open={detailModal.open}
        onClose={() => setDetailModal({ open: false, session: null })}
        title={`Stock-Take ST-${String(detailModal.session?.id || '').padStart(4, '0')}`}
        size="lg"
      >
        {detailModal.session && (
          <div>
            <div className="stocktake-detail-grid">
              <div><span className="detail-label">Unit</span><span className="detail-value">{detailModal.session.unitCode || `U-${detailModal.session.unitId}`}</span></div>
              <div><span className="detail-label">State</span><span className={`status-pill ${STATE_STYLE[detailModal.session.state] || ''}`}>{STATE_LABEL[detailModal.session.state] || detailModal.session.state}</span></div>
              <div><span className="detail-label">Started</span><span className="detail-value">{fmtDate(detailModal.session.createdAt)}</span></div>
              {detailModal.session.finalizedAt && <div><span className="detail-label">Finalized</span><span className="detail-value">{fmtDate(detailModal.session.finalizedAt)}</span></div>}
            </div>
            {detailModal.session.counts && detailModal.session.counts.length > 0 ? (
              <div style={{ marginTop: 'var(--sp-4)' }}>
                <div className="form-label" style={{ marginBottom: 'var(--sp-2)' }}>Count Entries</div>
                <div className="table-scroll">
                  <table className="item-table">
                    <thead><tr><th>Item</th><th className="qty-cell">Expected</th><th className="qty-cell">Counted</th><th>Variance</th></tr></thead>
                    <tbody>
                      {detailModal.session.counts.map((c, i) => {
                        const variance = c.physicalCount - (c.expectedQty || 0);
                        return (
                          <tr key={i}>
                            <td className="item-code-cell">#{c.itemId}</td>
                            <td className="qty-cell">{c.expectedQty ?? '—'}</td>
                            <td className="qty-cell">{c.physicalCount}</td>
                            <td>
                              {c.expectedQty != null ? (
                                <span className={variance < 0 ? 'status-critical' : variance > 0 ? 'status-warn' : 'status-good'}>
                                  {variance > 0 ? '+' : ''}{variance}
                                </span>
                              ) : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="table-empty" style={{ marginTop: 'var(--sp-4)' }}>
                No count entries recorded yet.
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Create session modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)}
        title="Start New Stock-Take Session" size="sm"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateModal(false)} disabled={creating}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating || !newUnitId}>
              {creating ? 'Starting…' : 'Start Session'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">Unit to Stock-Take *</label>
          <select className="form-select" value={newUnitId} onChange={e => setNewUnitId(e.target.value)}>
            <option value="">— Select unit —</option>
            {units.map(u => <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Notes <span className="form-label-hint">(optional)</span></label>
          <textarea className="form-textarea" rows={2} value={newNotes}
            onChange={e => setNewNotes(e.target.value)}
            placeholder="Authority, purpose, or reference number…" />
        </div>
        {createErr && <p className="field-error">{createErr}</p>}
      </Modal>
    </div>
  );
}
