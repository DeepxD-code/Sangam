import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Modal from '../components/Modal.jsx';

/**
 * Unit Detail Page  (Day 47)
 *
 * Drill-down destination from the dashboard's UNT widget and from the
 * Units hierarchy tree. Aggregates everything already scoped to a single
 * unit across four existing services (units, users, supply, movement)
 * into one operational picture: identity, stats, chain of command,
 * personnel roster, supply items, active movement orders, and
 * subordinate units — plus edit / deactivate / reactivate admin actions
 * gated the same way the rest of the app gates them (by rankLevel).
 */

const MOVEMENT_STATE_STYLE = {
  PLANNED:    'status-warn',
  DISPATCHED: 'status-warn',
  IN_TRANSIT: 'status-warn',
  DELIVERED:  'status-good',
  CANCELLED:  'status-critical',
};

function StatCard({ label, value }) {
  return (
    <div className="unit-stat-card">
      <span className="unit-stat-value">{value}</span>
      <span className="unit-stat-label">{label}</span>
    </div>
  );
}

export default function UnitDetailPage({ user }) {
  const { id } = useParams();
  const navigate = useNavigate();

  const [unit,       setUnit]       = useState(null);
  const [stats,      setStats]      = useState(null);
  const [children,   setChildren]   = useState([]);
  const [roster,     setRoster]     = useState([]);
  const [items,      setItems]      = useState([]);
  const [orders,     setOrders]     = useState([]);
  const [parentUnit, setParentUnit] = useState(null);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [feedback, setFeedback] = useState(null);
  const [actionBusy, setActionBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ unitName: '', location: '', commanderId: '' });
  const [saving,   setSaving]   = useState(false);

  const canEdit   = user && user.rankLevel >= 7;
  const canAdmin  = user && user.rankLevel >= 8;

  const load = useCallback(async () => {
    setLoading(true); setError(null); setNotFound(false);
    try {
      const [unitRes, statsRes, subtreeRes, rosterRes, itemsRes, ordersRes] = await Promise.all([
        api.getUnit(id),
        api.getUnitStats(id).catch(() => ({ success: false })),
        api.getUnitSubtree(id).catch(() => ({ success: false, tree: null })),
        api.getUsers({ unitId: id, limit: 200 }).catch(() => ({ users: [] })),
        api.getSupplyItems({ unitId: id }).catch(() => ({ items: [] })),
        api.getActiveOrdersForUnit(id).catch(() => ({ orders: [] })),
      ]);

      setUnit(unitRes.unit);
      setStats(statsRes.success ? statsRes.stats : null);
      // getUnitSubtree wraps its single root in a 1-element array: [{ ...unit, children }]
      setChildren((subtreeRes.tree && subtreeRes.tree[0] && subtreeRes.tree[0].children) || []);
      setRoster(rosterRes.users || []);
      setItems(itemsRes.items || []);
      setOrders(ordersRes.orders || []);

      if (unitRes.unit?.parentUnitId) {
        api.getUnit(unitRes.unit.parentUnitId)
          .then(r => setParentUnit(r.unit))
          .catch(() => setParentUnit(null));
      } else {
        setParentUnit(null);
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (err instanceof ApiError && err.status === 404) { setNotFound(true); return; }
      if (err instanceof ApiError && err.status === 403) {
        setError('This unit is outside your command scope.');
        return;
      }
      setError(err.message || 'Failed to load unit');
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const commander = useMemo(
    () => roster.find(u => u.id === unit?.commanderId) || null,
    [roster, unit]
  );

  function openEdit() {
    setEditForm({
      unitName: unit.unitName || '',
      location: unit.location || '',
      commanderId: unit.commanderId ? String(unit.commanderId) : ''
    });
    setEditOpen(true);
  }

  async function handleSaveEdit() {
    setSaving(true); setFeedback(null);
    try {
      await api.updateUnit(id, {
        unitName: editForm.unitName.trim(),
        location: editForm.location.trim() || null,
        commanderId: editForm.commanderId ? parseInt(editForm.commanderId, 10) : null
      });
      setFeedback({ type: 'success', message: 'Unit updated.' });
      setEditOpen(false);
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Update failed' });
    } finally { setSaving(false); }
  }

  async function handleDeactivate() {
    setActionBusy(true); setFeedback(null);
    try {
      await api.deactivateUnit(id);
      setFeedback({ type: 'success', message: `${unit.unitName} deactivated.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Deactivation failed' });
    } finally { setActionBusy(false); }
  }

  async function handleReactivate() {
    setActionBusy(true); setFeedback(null);
    try {
      await api.reactivateUnit(id);
      setFeedback({ type: 'success', message: `${unit.unitName} reactivated.` });
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Reactivation failed' });
    } finally { setActionBusy(false); }
  }

  if (loading) {
    return (
      <div className="page-content">
        <div className="state-screen" style={{ minHeight: 300 }}><div className="spinner" /></div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <p className="state-error">Unit not found.</p>
          <button className="btn btn-ghost" onClick={() => navigate('/units')}>← Units</button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <p className="state-error">{error}</p>
          <button className="btn btn-ghost" onClick={() => navigate('/units')}>← Units</button>
        </div>
      </div>
    );
  }

  if (!unit) return null;

  const lowStockCount = items.filter(i => i.lowStockThreshold > 0 && i.quantity < i.lowStockThreshold).length;

  return (
    <div className="page-content">
      {/* Breadcrumb */}
      <div className="unit-breadcrumb">
        <Link to="/units">Command Units</Link>
        <span className="unit-breadcrumb-sep">/</span>
        {parentUnit && (
          <>
            <Link to={`/units/${parentUnit.id}`}>{parentUnit.unitName}</Link>
            <span className="unit-breadcrumb-sep">/</span>
          </>
        )}
        <span className="unit-breadcrumb-current">{unit.unitName}</span>
      </div>

      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">
            {unit.unitName}
            {!unit.active && <span className="status-pill status-critical" style={{ marginLeft: 'var(--sp-3)' }}>INACTIVE</span>}
          </h1>
          <span className="page-subtitle">
            <span className={`unit-type-badge unit-type-${unit.unitType?.toLowerCase()}`}>{unit.unitType}</span>
            {' '}[{unit.unitCode}]{unit.location ? ` · ${unit.location}` : ''}
          </span>
        </div>
        <div className="action-cell">
          {canEdit && (
            <button className="btn btn-sm" onClick={openEdit}>EDIT</button>
          )}
          {canAdmin && unit.active && (
            <button className="btn btn-sm btn-reject" disabled={actionBusy} onClick={handleDeactivate}>
              {actionBusy ? '…' : 'DEACTIVATE'}
            </button>
          )}
          {canAdmin && !unit.active && (
            <button className="btn btn-sm btn-approve" disabled={actionBusy} onClick={handleReactivate}>
              {actionBusy ? '…' : 'REACTIVATE'}
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      {/* Stats */}
      {stats && (
        <div className="unit-stat-grid">
          <StatCard label="DIRECT SUBORDINATES" value={stats.directChildCount} />
          <StatCard label="ACTIVE SUBORDINATES" value={stats.activeChildCount} />
          <StatCard label="TOTAL DESCENDANTS" value={stats.totalDescendantCount} />
          <StatCard label="PERSONNEL" value={roster.length} />
          <StatCard label="SUPPLY ITEMS" value={items.length} />
          <StatCard label="ACTIVE MOVEMENTS" value={orders.length} />
        </div>
      )}

      {/* Commander */}
      <div className="unit-section">
        <h2 className="unit-section-title">Chain of Command</h2>
        {commander ? (
          <div className="unit-commander-card">
            <span className="unit-commander-name">{commander.displayName}</span>
            <span className="unit-commander-meta">{commander.role} · {commander.username}</span>
          </div>
        ) : unit.commanderId ? (
          <p className="text-dim">Commander (user #{unit.commanderId}) is not in this unit's current roster.</p>
        ) : (
          <p className="text-dim">No commander assigned.</p>
        )}
      </div>

      {/* Personnel roster */}
      <div className="unit-section">
        <h2 className="unit-section-title">Personnel ({roster.length})</h2>
        {roster.length === 0 ? (
          <div className="table-empty">No personnel assigned to this unit.</div>
        ) : (
          <div className="table-scroll">
            <table className="item-table">
              <thead>
                <tr><th>USERNAME</th><th>DISPLAY NAME</th><th>ROLE</th><th>STATUS</th></tr>
              </thead>
              <tbody>
                {roster.map(u => (
                  <tr key={u.id}>
                    <td className="item-code-cell">{u.username}</td>
                    <td className="item-name-cell">{u.displayName}</td>
                    <td>{u.role}</td>
                    <td>
                      <span className={`status-pill ${u.active ? 'status-good' : 'status-critical'}`}>
                        {u.active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Supply items */}
      <div className="unit-section">
        <h2 className="unit-section-title">
          Supply Items ({items.length})
          {lowStockCount > 0 && <span className="status-pill status-warn" style={{ marginLeft: 'var(--sp-3)' }}>{lowStockCount} BELOW THRESHOLD</span>}
        </h2>
        {items.length === 0 ? (
          <div className="table-empty">No supply items held by this unit.</div>
        ) : (
          <div className="table-scroll">
            <table className="item-table">
              <thead>
                <tr><th>CODE</th><th>NAME</th><th>CATEGORY</th><th>QUANTITY</th><th>STATUS</th></tr>
              </thead>
              <tbody>
                {items.map(it => {
                  const isLow = it.lowStockThreshold > 0 && it.quantity < it.lowStockThreshold;
                  return (
                    <tr key={it.id}>
                      <td className="item-code-cell">{it.itemCode}</td>
                      <td className="item-name-cell">{it.itemName}</td>
                      <td>{it.category}</td>
                      <td>{it.quantity} {it.unitOfMeasure}</td>
                      <td><span className={`status-pill ${isLow ? 'low' : 'ok'}`}>{isLow ? 'LOW' : 'OK'}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Active movement orders */}
      <div className="unit-section">
        <h2 className="unit-section-title">Active Movement Orders ({orders.length})</h2>
        {orders.length === 0 ? (
          <div className="table-empty">No active movement orders involving this unit.</div>
        ) : (
          <div className="table-scroll">
            <table className="item-table">
              <thead>
                <tr><th>ORDER</th><th>FROM</th><th>TO</th><th>PRIORITY</th><th>STATE</th></tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id}>
                    <td className="item-code-cell">#{o.id}</td>
                    <td>{o.fromUnitId === unit.id ? 'THIS UNIT' : `Unit ${o.fromUnitId}`}</td>
                    <td>{o.toUnitId === unit.id ? 'THIS UNIT' : `Unit ${o.toUnitId}`}</td>
                    <td>{o.priority}</td>
                    <td><span className={`status-pill ${MOVEMENT_STATE_STYLE[o.state] || ''}`}>{o.state}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Subordinate units */}
      <div className="unit-section">
        <h2 className="unit-section-title">Subordinate Units ({children.length})</h2>
        {children.length === 0 ? (
          <div className="table-empty">No subordinate units.</div>
        ) : (
          <div className="unit-child-grid">
            {children
              .slice()
              .sort((a, b) => a.unitName.localeCompare(b.unitName))
              .map(c => (
                <button key={c.id} className="unit-child-card" onClick={() => navigate(`/units/${c.id}`)}>
                  <span className={`unit-type-badge unit-type-${c.unitType?.toLowerCase()}`}>{c.unitType}</span>
                  <span className="unit-child-name">{c.unitName}</span>
                  <span className="unit-child-code">[{c.unitCode}]</span>
                  {!c.active && <span className="status-pill status-critical">INACTIVE</span>}
                </button>
              ))}
          </div>
        )}
      </div>

      {/* Edit modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)}
        title={`Edit Unit — ${unit.unitName}`} size="md"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setEditOpen(false)} disabled={saving}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSaveEdit} disabled={saving || !editForm.unitName.trim()}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">Unit Name *</label>
          <input className="form-input" type="text" value={editForm.unitName}
            onChange={e => setEditForm(f => ({ ...f, unitName: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="form-label">Location <span className="form-label-hint">(optional)</span></label>
          <input className="form-input" type="text" value={editForm.location}
            onChange={e => setEditForm(f => ({ ...f, location: e.target.value }))}
            placeholder="e.g. Siachen Base Camp" />
        </div>
        <div className="form-group">
          <label className="form-label">Commander <span className="form-label-hint">(optional)</span></label>
          <select className="form-select" value={editForm.commanderId}
            onChange={e => setEditForm(f => ({ ...f, commanderId: e.target.value }))}>
            <option value="">— None —</option>
            {roster.map(u => (
              <option key={u.id} value={u.id}>{u.displayName} ({u.role})</option>
            ))}
          </select>
        </div>
      </Modal>
    </div>
  );
}
