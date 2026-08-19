import React, { useEffect, useState, useCallback } from 'react';
import { api, ApiError } from '../api/client.js';
import Modal from '../components/Modal.jsx';

/**
 * Movement Orders Page  (Day 34)
 *
 * View and manage inter-unit supply movement orders.
 * Routes:  GET  /api/movement/orders
 *          POST /api/movement/orders
 *          POST /api/movement/orders/:id/dispatch
 *          POST /api/movement/orders/:id/deliver
 *          POST /api/movement/orders/:id/cancel
 */

const STATE_FILTERS = ['ALL', 'PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED'];
const PRIORITY_LEVELS = ['ROUTINE', 'PRIORITY', 'IMMEDIATE', 'EMERGENCY'];

const STATE_STYLE = {
  PLANNED:    'status-warn',
  DISPATCHED: 'status-warn',
  IN_TRANSIT: 'status-warn',
  DELIVERED:  'status-good',
  CANCELLED:  'status-critical',
};

const PRIORITY_STYLE = {
  ROUTINE:   'priority-routine',
  PRIORITY:  'priority-priority',
  IMMEDIATE: 'priority-immediate',
  EMERGENCY: 'priority-emergency',
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
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false
  });
}

const EMPTY_FORM = {
  fromUnitId: '', toUnitId: '', priority: 'ROUTINE',
  vehicleReg: '', route: '', notes: '',
  plannedDeparture: '', plannedArrival: '',
  itemId: '', itemQuantity: '',
};

export default function MovementOrderPage({ user, onLogout }) {
  const [orders,      setOrders]      = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [stateFilter, setStateFilter] = useState('ALL');
  const [feedback,    setFeedback]    = useState(null);
  const [actionBusy,  setActionBusy]  = useState(null);

  // Units + items for create form
  const [units,  setUnits]  = useState([]);
  const [items,  setItems]  = useState([]);

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [formErrors, setFormErrors]   = useState({});
  const [creating, setCreating]       = useState(false);

  // Cancel modal
  const [cancelModal, setCancelModal] = useState({ open: false, orderId: null });
  const [cancelReason, setCancelReason] = useState('');

  const canDispatch = user && user.rankLevel >= 3;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const filters = stateFilter !== 'ALL' ? { state: stateFilter } : {};
      const result  = await api.getMovementOrders({ ...filters, limit: 100 });
      setOrders(result.orders || []);
      setTotal(result.total ?? (result.orders || []).length);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load orders');
    } finally { setLoading(false); }
  }, [stateFilter, onLogout]);

  useEffect(() => { load(); }, [load]);

  // Load units + items for form once
  useEffect(() => {
    api.getUnits().then(r => setUnits(r.units || [])).catch(() => {});
    api.getSupplyItems().then(r => setItems(r.items || [])).catch(() => {});
  }, []);

  function openCreate() { setForm(EMPTY_FORM); setFormErrors({}); setCreateModal(true); }

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function validateForm() {
    const e = {};
    if (!form.fromUnitId)   e.fromUnitId = 'Required';
    if (!form.toUnitId)     e.toUnitId   = 'Required';
    if (form.fromUnitId && form.fromUnitId === form.toUnitId) e.toUnitId = 'Must differ from source';
    if (!form.itemId)       e.itemId     = 'Required';
    if (!form.itemQuantity || parseInt(form.itemQuantity, 10) <= 0)
      e.itemQuantity = 'Must be > 0';
    return e;
  }

  async function handleCreate() {
    const errs = validateForm();
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setCreating(true); setFeedback(null);
    try {
      await api.createMovementOrder({
        fromUnitId: parseInt(form.fromUnitId, 10),
        toUnitId:   parseInt(form.toUnitId, 10),
        priority:   form.priority,
        vehicleReg: form.vehicleReg || undefined,
        route:      form.route      || undefined,
        notes:      form.notes      || undefined,
        plannedDeparture: form.plannedDeparture || undefined,
        plannedArrival:   form.plannedArrival   || undefined,
        createdByUserId:  user?.userId,
        items: [{ itemId: parseInt(form.itemId, 10), quantity: parseInt(form.itemQuantity, 10) }]
      });
      setFeedback({ type: 'success', message: 'Movement order created.' });
      setCreateModal(false);
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Create failed' });
    } finally { setCreating(false); }
  }

  async function handleDispatch(id) {
    setActionBusy(id + '_disp');
    try {
      await api.dispatchMovementOrder(id);
      setFeedback({ type: 'success', message: `Order #${id} dispatched.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally { setActionBusy(null); }
  }

  async function handleDeliver(id) {
    setActionBusy(id + '_del');
    try {
      await api.deliverMovementOrder(id, null, 'Delivered via dashboard');
      setFeedback({ type: 'success', message: `Order #${id} marked delivered.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally { setActionBusy(null); }
  }

  async function handleCancel() {
    const { orderId } = cancelModal;
    if (!cancelReason.trim()) return;
    setActionBusy(orderId + '_can');
    try {
      await api.cancelMovementOrder(orderId, cancelReason.trim());
      setFeedback({ type: 'success', message: `Order #${orderId} cancelled.` });
      setCancelModal({ open: false, orderId: null }); setCancelReason('');
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message });
    } finally { setActionBusy(null); }
  }

  const activeCount = orders.filter(o => ['PLANNED','DISPATCHED','IN_TRANSIT'].includes(o.state)).length;

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Movement Orders</h1>
          <span className="page-subtitle">
            {total} ORDER{total !== 1 ? 'S' : ''} · {activeCount} ACTIVE
          </span>
        </div>
        <button className="btn btn-primary" onClick={openCreate}>+ NEW ORDER</button>
      </div>

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      <div className="tab-bar">
        {STATE_FILTERS.map(s => (
          <button key={s} className={`tab${stateFilter === s ? ' tab-active' : ''}`}
            onClick={() => setStateFilter(s)}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : orders.length === 0 ? (
        <div className="table-empty">
          No {stateFilter !== 'ALL' ? stateFilter.toLowerCase() + ' ' : ''}movement orders.
        </div>
      ) : (
        <div className="movement-list">
          {orders.map(o => (
            <div key={o.id} className={`movement-card priority-${(o.priority||'').toLowerCase()}-card`}>
              <div className="movement-card-header">
                <div className="movement-id-block">
                  <span className="movement-id">ORD-{String(o.id).padStart(4, '0')}</span>
                  <span className={`priority-badge ${PRIORITY_STYLE[o.priority] || ''}`}>
                    {o.priority}
                  </span>
                </div>
                <span className={`status-pill ${STATE_STYLE[o.state] || ''}`}>{o.state}</span>
              </div>

              <div className="movement-route">
                <span className="movement-unit">U-{o.fromUnitId}</span>
                <span className="movement-arrow">→</span>
                <span className="movement-unit">U-{o.toUnitId}</span>
              </div>

              <div className="movement-meta">
                {o.vehicleReg && <span>VEH: {o.vehicleReg}</span>}
                {o.route && <span>ROUTE: {o.route}</span>}
                <span>CREATED: {age(o.createdAt)}</span>
                {o.plannedDeparture && <span>DEP: {fmtDate(o.plannedDeparture)}</span>}
              </div>

              {o.items && o.items.length > 0 && (
                <div className="movement-items">
                  {o.items.map((item, idx) => (
                    <span key={idx} className="movement-item-tag">
                      Item #{item.itemId} × {item.quantity}
                    </span>
                  ))}
                </div>
              )}

              {canDispatch && (
                <div className="action-cell" style={{ marginTop: 'var(--sp-3)' }}>
                  {o.state === 'PLANNED' && (
                    <>
                      <button className="btn btn-sm btn-approve"
                        disabled={actionBusy === o.id + '_disp'}
                        onClick={() => handleDispatch(o.id)}>
                        {actionBusy === o.id + '_disp' ? '…' : '▶ DISPATCH'}
                      </button>
                      <button className="btn btn-sm btn-reject"
                        onClick={() => { setCancelReason(''); setCancelModal({ open: true, orderId: o.id }); }}>
                        CANCEL
                      </button>
                    </>
                  )}
                  {(o.state === 'DISPATCHED' || o.state === 'IN_TRANSIT') && (
                    <>
                      <button className="btn btn-sm btn-approve"
                        disabled={actionBusy === o.id + '_del'}
                        onClick={() => handleDeliver(o.id)}>
                        {actionBusy === o.id + '_del' ? '…' : '✓ DELIVERED'}
                      </button>
                      <button className="btn btn-sm btn-reject"
                        onClick={() => { setCancelReason(''); setCancelModal({ open: true, orderId: o.id }); }}>
                        CANCEL
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Create order modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)}
        title="New Movement Order" size="md"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateModal(false)} disabled={creating}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create Order'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">From Unit *</label>
          <select className={`form-select${formErrors.fromUnitId ? ' input-error' : ''}`}
            value={form.fromUnitId} onChange={e => setField('fromUnitId', e.target.value)}>
            <option value="">— Select source —</option>
            {units.map(u => <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>)}
          </select>
          {formErrors.fromUnitId && <p className="field-error">{formErrors.fromUnitId}</p>}
        </div>
        <div className="form-group">
          <label className="form-label">To Unit *</label>
          <select className={`form-select${formErrors.toUnitId ? ' input-error' : ''}`}
            value={form.toUnitId} onChange={e => setField('toUnitId', e.target.value)}>
            <option value="">— Select destination —</option>
            {units.filter(u => String(u.id) !== form.fromUnitId)
              .map(u => <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>)}
          </select>
          {formErrors.toUnitId && <p className="field-error">{formErrors.toUnitId}</p>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div className="form-group">
            <label className="form-label">Item *</label>
            <select className={`form-select${formErrors.itemId ? ' input-error' : ''}`}
              value={form.itemId} onChange={e => setField('itemId', e.target.value)}>
              <option value="">— Select item —</option>
              {items.map(i => <option key={i.id} value={i.id}>[{i.itemCode}] {i.itemName}</option>)}
            </select>
            {formErrors.itemId && <p className="field-error">{formErrors.itemId}</p>}
          </div>
          <div className="form-group">
            <label className="form-label">Quantity *</label>
            <input className={`form-input${formErrors.itemQuantity ? ' input-error' : ''}`}
              type="number" min="1" value={form.itemQuantity}
              onChange={e => setField('itemQuantity', e.target.value)} placeholder="0" />
            {formErrors.itemQuantity && <p className="field-error">{formErrors.itemQuantity}</p>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div className="form-group">
            <label className="form-label">Priority</label>
            <select className="form-select" value={form.priority}
              onChange={e => setField('priority', e.target.value)}>
              {PRIORITY_LEVELS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="form-label">Vehicle Reg <span className="form-label-hint">(optional)</span></label>
            <input className="form-input" type="text" value={form.vehicleReg}
              onChange={e => setField('vehicleReg', e.target.value)} placeholder="e.g. DL 1C 2345" />
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Route <span className="form-label-hint">(optional)</span></label>
          <input className="form-input" type="text" value={form.route}
            onChange={e => setField('route', e.target.value)}
            placeholder="e.g. Delhi → Meerut via NH-58" />
        </div>
        <div className="form-group">
          <label className="form-label">Notes <span className="form-label-hint">(optional)</span></label>
          <textarea className="form-textarea" rows={2} value={form.notes}
            onChange={e => setField('notes', e.target.value)}
            placeholder="Any additional instructions or authority reference…" />
        </div>
      </Modal>

      {/* Cancel reason modal */}
      <Modal open={cancelModal.open} onClose={() => setCancelModal({ open: false, orderId: null })}
        title={`Cancel Order #${cancelModal.orderId}`} size="sm"
        actions={
          <>
            <button className="btn btn-ghost"
              onClick={() => setCancelModal({ open: false, orderId: null })}>Back</button>
            <button className="btn btn-reject"
              disabled={!cancelReason.trim() || actionBusy}
              onClick={handleCancel}>
              {actionBusy ? '…' : 'Confirm Cancel'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-textarea" rows={3} value={cancelReason}
            onChange={e => setCancelReason(e.target.value)} autoFocus
            placeholder="State reason for cancellation (required for audit)…" />
          {!cancelReason.trim() && <p className="field-error">A reason is required.</p>}
        </div>
      </Modal>
    </div>
  );
}
