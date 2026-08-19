import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Modal from '../components/Modal.jsx';

/**
 * User Management Page  (Day 37)
 *
 * SYSTEM_ADMIN-only page to view, create, deactivate, and change roles of users.
 */

const VALID_ROLES = [
  'SOLDIER', 'NCO', 'JCO', 'LOGISTICS_OFFICER',
  'OFFICER', 'SENIOR_OFFICER', 'COMMANDER', 'AUDITOR', 'SYSTEM_ADMIN'
];

const ROLE_RANK = {
  SOLDIER: 1, NCO: 2, JCO: 2, LOGISTICS_OFFICER: 3,
  OFFICER: 3, SENIOR_OFFICER: 3, COMMANDER: 3, AUDITOR: 3, SYSTEM_ADMIN: 5
};

function rankLabel(role) {
  const r = ROLE_RANK[role];
  if (!r) return '';
  return r >= 5 ? 'ADM' : r >= 3 ? 'OFF' : r >= 2 ? 'HVL' : 'JWN';
}

const EMPTY_FORM = {
  username: '', displayName: '', serviceNumber: '',
  role: 'NCO', unitId: '', password: ''
};

export default function UserManagementPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [users,       setUsers]       = useState([]);
  const [total,       setTotal]       = useState(0);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState(null);
  const [search,      setSearch]      = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [roleFilter,  setRoleFilter]  = useState('');
  const [feedback,    setFeedback]    = useState(null);
  const [actionBusy,  setActionBusy]  = useState(null);
  const [units,       setUnits]       = useState([]);

  // Create modal
  const [createModal, setCreateModal] = useState(false);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [formErrors,  setFormErrors]  = useState({});
  const [creating,    setCreating]    = useState(false);

  // Role change modal
  const [roleModal,  setRoleModal]  = useState({ open: false, user: null });
  const [newRole,    setNewRole]    = useState('');
  const [newUnitId,  setNewUnitId]  = useState('');

  const isAdmin = user && user.role === 'SYSTEM_ADMIN';

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setError(null);
    try {
      const filters = { limit: 100 };
      if (search.trim()) filters.search = search.trim();
      if (roleFilter)    filters.role   = roleFilter;
      const result = await api.getUsers(filters);
      setUsers(result.users || []);
      setTotal(result.total ?? (result.users || []).length);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load users');
    } finally { setLoading(false); }
  }, [isAdmin, search, roleFilter, onLogout]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.getUnits().then(r => setUnits(r.units || [])).catch(() => {});
  }, []);

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function validateForm() {
    const e = {};
    if (!form.username.trim())     e.username     = 'Required';
    if (!form.displayName.trim())  e.displayName  = 'Required';
    if (!form.role)                e.role         = 'Required';
    if (!form.unitId)              e.unitId       = 'Required';
    if (!form.password || form.password.length < 8)
      e.password = 'Minimum 8 characters';
    return e;
  }

  async function handleCreate() {
    const errs = validateForm();
    if (Object.keys(errs).length) { setFormErrors(errs); return; }
    setCreating(true); setFeedback(null);
    try {
      await api.createUser({
        username:     form.username.trim(),
        displayName:  form.displayName.trim(),
        serviceNumber: form.serviceNumber.trim() || undefined,
        role:         form.role,
        unitId:       parseInt(form.unitId, 10),
        password:     form.password,
        createdByUserId: user?.userId
      });
      setFeedback({ type: 'success', message: `User "${form.username}" created.` });
      setCreateModal(false); setForm(EMPTY_FORM); setFormErrors({});
      await load();
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Create failed' });
    } finally { setCreating(false); }
  }

  async function handleDeactivate(u) {
    setActionBusy(u.id + '_deact'); setFeedback(null);
    try {
      await api.deactivateUser(u.id);
      setFeedback({ type: 'success', message: `${u.displayName} deactivated.` });
      await load();
    } catch (err) { setFeedback({ type: 'error', message: err.message }); }
    finally { setActionBusy(null); }
  }

  async function handleReactivate(u) {
    setActionBusy(u.id + '_react'); setFeedback(null);
    try {
      await api.reactivateUser(u.id);
      setFeedback({ type: 'success', message: `${u.displayName} reactivated.` });
      await load();
    } catch (err) { setFeedback({ type: 'error', message: err.message }); }
    finally { setActionBusy(null); }
  }

  async function handleUnlock(u) {
    setActionBusy(u.id + '_unlock'); setFeedback(null);
    try {
      await api.unlockUser(u.id);
      setFeedback({ type: 'success', message: `${u.displayName} unlocked.` });
      await load();
    } catch (err) { setFeedback({ type: 'error', message: err.message }); }
    finally { setActionBusy(null); }
  }

  function openRoleModal(u) {
    setNewRole(u.role || 'NCO');
    setNewUnitId(String(u.unitId || ''));
    setRoleModal({ open: true, user: u });
  }

  async function confirmRoleChange() {
    const { user: u } = roleModal;
    setActionBusy(u.id + '_role'); setFeedback(null);
    try {
      await api.changeUserRole(u.id, newRole, parseInt(newUnitId, 10) || u.unitId);
      setFeedback({ type: 'success', message: `${u.displayName} role updated to ${newRole}.` });
      setRoleModal({ open: false, user: null });
      await load();
    } catch (err) { setFeedback({ type: 'error', message: err.message }); }
    finally { setActionBusy(null); }
  }

  if (!isAdmin) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <p className="state-error">Access denied — SYSTEM_ADMIN required.</p>
          <button className="btn btn-ghost" onClick={() => navigate('/')}>← Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">User Management</h1>
          <span className="page-subtitle">{total} USER{total !== 1 ? 'S' : ''} IN SCOPE</span>
        </div>
        <button className="btn btn-primary" onClick={() => { setForm(EMPTY_FORM); setFormErrors({}); setCreateModal(true); }}>
          + CREATE USER
        </button>
      </div>

      {feedback && (
        <div className={`feedback-banner ${feedback.type}`}>
          {feedback.message}
          <button className="feedback-close" onClick={() => setFeedback(null)}>✕</button>
        </div>
      )}

      <div className="filter-bar">
        <input type="text" placeholder="Search by username or name…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && setSearch(searchInput.trim())}
          onBlur={() => setSearch(searchInput.trim())} />
        <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)}>
          <option value="">All roles</option>
          {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : users.length === 0 ? (
        <div className="table-empty">No users match the current filters.</div>
      ) : (
        <div className="table-scroll">
          <table className="item-table">
            <thead>
              <tr>
                <th>USERNAME</th>
                <th>DISPLAY NAME</th>
                <th>ROLE</th>
                <th>UNIT</th>
                <th>STATUS</th>
                <th>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className={!u.isActive ? 'user-inactive-row' : ''}>
                  <td className="item-code-cell">
                    {u.username}
                    {u.isLocked && <span className="user-locked-badge">🔒</span>}
                  </td>
                  <td className="item-name-cell">{u.displayName}</td>
                  <td>
                    <span className="user-role-badge">
                      <span className="user-rank-tag">{rankLabel(u.role)}</span>
                      {u.role}
                    </span>
                  </td>
                  <td className="item-code-cell">{u.unitCode || `U-${u.unitId}`}</td>
                  <td>
                    <span className={`status-pill ${u.isActive ? 'status-good' : 'status-critical'}`}>
                      {u.isLocked ? 'LOCKED' : u.isActive ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td>
                    <div className="action-cell">
                      <button className="btn btn-sm" onClick={() => openRoleModal(u)}
                        disabled={u.id === user?.userId}>
                        ROLE
                      </button>
                      {u.isLocked && (
                        <button className="btn btn-sm btn-approve"
                          disabled={actionBusy === u.id + '_unlock'}
                          onClick={() => handleUnlock(u)}>
                          {actionBusy === u.id + '_unlock' ? '…' : 'UNLOCK'}
                        </button>
                      )}
                      {u.isActive && u.id !== user?.userId ? (
                        <button className="btn btn-sm btn-reject"
                          disabled={actionBusy === u.id + '_deact'}
                          onClick={() => handleDeactivate(u)}>
                          {actionBusy === u.id + '_deact' ? '…' : 'DEACTIVATE'}
                        </button>
                      ) : !u.isActive ? (
                        <button className="btn btn-sm btn-approve"
                          disabled={actionBusy === u.id + '_react'}
                          onClick={() => handleReactivate(u)}>
                          {actionBusy === u.id + '_react' ? '…' : 'REACTIVATE'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create user modal */}
      <Modal open={createModal} onClose={() => setCreateModal(false)}
        title="Create New User" size="md"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setCreateModal(false)} disabled={creating}>Cancel</button>
            <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating…' : 'Create User'}
            </button>
          </>
        }>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div className="form-group">
            <label className="form-label">Username *</label>
            <input className={`form-input${formErrors.username ? ' input-error' : ''}`}
              type="text" value={form.username}
              onChange={e => setField('username', e.target.value)}
              placeholder="e.g. lt.col.sharma" />
            {formErrors.username && <p className="field-error">{formErrors.username}</p>}
          </div>
          <div className="form-group">
            <label className="form-label">Display Name *</label>
            <input className={`form-input${formErrors.displayName ? ' input-error' : ''}`}
              type="text" value={form.displayName}
              onChange={e => setField('displayName', e.target.value)}
              placeholder="e.g. Lt Col R.K. Sharma" />
            {formErrors.displayName && <p className="field-error">{formErrors.displayName}</p>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div className="form-group">
            <label className="form-label">Role *</label>
            <select className={`form-select${formErrors.role ? ' input-error' : ''}`}
              value={form.role} onChange={e => setField('role', e.target.value)}>
              {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            {formErrors.role && <p className="field-error">{formErrors.role}</p>}
          </div>
          <div className="form-group">
            <label className="form-label">Unit *</label>
            <select className={`form-select${formErrors.unitId ? ' input-error' : ''}`}
              value={form.unitId} onChange={e => setField('unitId', e.target.value)}>
              <option value="">— Select unit —</option>
              {units.map(u => <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>)}
            </select>
            {formErrors.unitId && <p className="field-error">{formErrors.unitId}</p>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--sp-4)' }}>
          <div className="form-group">
            <label className="form-label">Service Number <span className="form-label-hint">(optional)</span></label>
            <input className="form-input" type="text" value={form.serviceNumber}
              onChange={e => setField('serviceNumber', e.target.value)}
              placeholder="e.g. IC-45678" />
          </div>
          <div className="form-group">
            <label className="form-label">Temporary Password *</label>
            <input className={`form-input${formErrors.password ? ' input-error' : ''}`}
              type="password" value={form.password}
              onChange={e => setField('password', e.target.value)}
              placeholder="Min 8 characters" />
            {formErrors.password && <p className="field-error">{formErrors.password}</p>}
          </div>
        </div>
      </Modal>

      {/* Role change modal */}
      <Modal open={roleModal.open} onClose={() => setRoleModal({ open: false, user: null })}
        title={`Change Role — ${roleModal.user?.displayName || ''}`} size="sm"
        actions={
          <>
            <button className="btn btn-ghost"
              onClick={() => setRoleModal({ open: false, user: null })}>Cancel</button>
            <button className="btn btn-primary"
              disabled={actionBusy !== null}
              onClick={confirmRoleChange}>
              {actionBusy ? '…' : 'Update Role'}
            </button>
          </>
        }>
        <div className="form-group">
          <label className="form-label">New Role</label>
          <select className="form-select" value={newRole} onChange={e => setNewRole(e.target.value)}>
            {VALID_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Unit</label>
          <select className="form-select" value={newUnitId} onChange={e => setNewUnitId(e.target.value)}>
            <option value="">— Keep current —</option>
            {units.map(u => <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>)}
          </select>
        </div>
      </Modal>
    </div>
  );
}
