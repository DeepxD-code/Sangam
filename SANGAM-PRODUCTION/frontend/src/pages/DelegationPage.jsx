import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../api/client.js';
import Widget from '../components/Widget.jsx';
import Modal from '../components/Modal.jsx';

/**
 * DelegationPage  (Day 57)
 *
 * Surfaces DelegationService (Day 15) and its 8 routes, mounted at
 * /api/delegation since Day 15 with zero frontend surface until now.
 * Two mechanisms, both fully audited:
 *
 *   DELEGATION — planned, time-boxed handoff of a permission the
 *                delegator already holds, to one delegate, scoped to
 *                one unit's command tree. The backend enforces you can
 *                only delegate what you personally hold
 *                (DELEGATOR_LACKS_PERMISSION) — this page does not
 *                pre-filter the permission list by the caller's own
 *                role, since that would duplicate the permission
 *                matrix client-side; a rejected attempt just surfaces
 *                the server's own message.
 *
 *   OVERRIDE   — emergency, self-issued, single-use exception. Logged
 *                as a SECURITY audit event at issuance (before any
 *                use) and held in a review queue until a Senior
 *                Officer, Commander, Auditor, or System Admin signs
 *                off (audit:read — the same 4-role, non-monotonic set
 *                as Day 56's audit:export, see CompliancePage.jsx).
 *
 * There is no GET /delegation/overrides/mine — a regular user cannot
 * see their own override history through the API, only issue new ones.
 * That's a real, current backend limitation, not something this page
 * works around or hides.
 */

const ALL_PERMISSIONS = [
  'audit:export', 'audit:read', 'blockchain:read', 'blockchain:verify', 'blockchain:write',
  'mesh:admin', 'mesh:read', 'mesh:write', 'reports:advanced', 'reports:export', 'reports:read',
  'supply:approve', 'supply:delete', 'supply:export', 'supply:read', 'supply:transfer', 'supply:write',
  'system:admin', 'system:config', 'units:admin', 'units:read', 'units:write',
  'users:delete', 'users:read', 'users:write'
];

const TABS = [
  { key: 'mine',     label: 'MY DELEGATIONS' },
  { key: 'granted',  label: 'GRANTED BY ME' },
  { key: 'override', label: 'EMERGENCY OVERRIDE' },
  { key: 'review',   label: 'REVIEW QUEUE' },
];

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hour12: false
  });
}

// Most delegation/override error codes already carry a server-provided
// .message (see delegation.service.js validation branches) — this only
// covers the handful that don't.
function friendlyError(err) {
  if (!(err instanceof ApiError)) return err?.message || 'Something went wrong.';
  if (err.status === 403) return 'Your role does not have access to this section.';
  if (err.status === 0)   return err.message;
  const map = {
    CANNOT_DELEGATE_TO_SELF: "You can't delegate a permission to yourself.",
    DELEGATION_NOT_FOUND:    'That delegation no longer exists.',
    ALREADY_REVOKED:         'That delegation has already been revoked.',
    OVERRIDE_NOT_FOUND:      'That override no longer exists.',
    ALREADY_REVIEWED:        'That override has already been reviewed.',
    INVALID_ID:              'Invalid ID.',
  };
  return map[err.payload?.error] || err.message || 'Request failed.';
}

export default function DelegationPage({ onLogout }) {
  const [tab, setTab]     = useState('mine');
  const [stats, setStats] = useState(null);

  const loadStats = useCallback(async () => {
    try {
      const result = await api.getDelegationStats();
      setStats(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      // reports:read is held by every role, so a failure here is unusual;
      // fail quietly and just skip the widgets rather than blocking the page.
    }
  }, [onLogout]);

  useEffect(() => { loadStats(); }, [loadStats]);

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Delegation &amp; Emergency Override</h1>
          <span className="page-subtitle">Time-boxed authority handoff &amp; audited break-glass access</span>
        </div>
      </div>

      {stats && (
        <div className="widget-grid" style={{ marginBottom: 'var(--sp-4)' }}>
          <Widget code="DEL" headline={String(stats.activeDelegations)} unit="ACTIVE"
            subline={`${stats.totalDelegations} total delegations`} />
          <Widget code="OVR" headline={String(stats.activeOverrides)} unit="ACTIVE"
            subline={`${stats.totalOverrides} total overrides`} />
          <Widget code="REV" headline={String(stats.pendingReview)} unit="PENDING REVIEW"
            subline={stats.overdueReview > 0
              ? <span className="status-critical">⚠ {stats.overdueReview} overdue (&gt;24h)</span>
              : <span className="status-good">None overdue</span>} />
        </div>
      )}

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab${tab === t.key ? ' tab-active' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'mine'     && <MyDelegationsTab onLogout={onLogout} />}
      {tab === 'granted'  && <GrantedTab       onLogout={onLogout} onChanged={loadStats} />}
      {tab === 'override' && <OverrideTab      onLogout={onLogout} onIssued={loadStats} />}
      {tab === 'review'   && <ReviewQueueTab   onLogout={onLogout} onReviewed={loadStats} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MY DELEGATIONS (incoming, as delegate)
// ════════════════════════════════════════════════════════════════
function MyDelegationsTab({ onLogout }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getMyDelegations();
      setItems(result.delegations || []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>;
  if (error)   return <div className="state-screen" style={{ minHeight: 200 }}><p className="state-error">{error}</p></div>;
  if (items.length === 0) return <div className="table-empty">No active delegations. Permissions delegated to you by others will appear here.</div>;

  return (
    <div className="table-scroll">
      <table className="item-table">
        <thead><tr><th>PERMISSION</th><th>UNIT</th><th>DELEGATED BY</th><th>EXPIRES</th></tr></thead>
        <tbody>
          {items.map(d => (
            <tr key={d.id}>
              <td className="item-code-cell">{d.permission}</td>
              <td>{d.unitId}</td>
              <td>#{d.delegatorUserId}</td>
              <td>{fmtTime(d.expiresAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// GRANTED BY ME (outgoing, as delegator) + New Delegation modal
// ════════════════════════════════════════════════════════════════
function delegationStatus(d) {
  if (d.revokedAt) return { label: 'REVOKED', cls: 'sev-critical' };
  if (new Date(d.expiresAt).getTime() <= Date.now()) return { label: 'EXPIRED', cls: 'sev-warning' };
  return { label: 'ACTIVE', cls: 'sev-info' };
}

function GrantedTab({ onLogout, onChanged }) {
  const [items, setItems]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [busyId, setBusyId]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getGrantedDelegations();
      setItems(result.delegations || []);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleRevoke(d) {
    if (!window.confirm(`Revoke "${d.permission}" from user #${d.delegateUserId}?`)) return;
    setBusyId(d.id);
    try {
      await api.revokeDelegation(d.id, 'Revoked from Delegation & Override page');
      await load();
      onChanged?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setBusyId(null); }
  }

  return (
    <>
      <div className="page-header" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className="page-subtitle">{items.length} delegation{items.length === 1 ? '' : 's'} granted (all statuses)</span>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>+ New Delegation</button>
      </div>

      {error && (
        <div className="feedback-banner error">
          {error}
          <button className="feedback-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : items.length === 0 ? (
        <div className="table-empty">You haven't delegated any permissions yet.</div>
      ) : (
        <div className="table-scroll">
          <table className="item-table">
            <thead><tr><th>DELEGATE</th><th>PERMISSION</th><th>UNIT</th><th>STATUS</th><th>EXPIRES</th><th /></tr></thead>
            <tbody>
              {items.map(d => {
                const st = delegationStatus(d);
                return (
                  <tr key={d.id}>
                    <td>#{d.delegateUserId}</td>
                    <td className="item-code-cell">{d.permission}</td>
                    <td>{d.unitId}</td>
                    <td><span className={`sev-pill ${st.cls}`}>{st.label}</span></td>
                    <td>{fmtTime(d.expiresAt)}</td>
                    <td>
                      {st.label === 'ACTIVE' && (
                        <button className="btn btn-sm" disabled={busyId === d.id} onClick={() => handleRevoke(d)}>
                          {busyId === d.id ? '…' : 'Revoke'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <NewDelegationModal
        open={showForm}
        onClose={() => setShowForm(false)}
        onLogout={onLogout}
        onCreated={() => { setShowForm(false); load(); onChanged?.(); }}
      />
    </>
  );
}

function NewDelegationModal({ open, onClose, onLogout, onCreated }) {
  const emptyForm = { delegateUserId: '', permission: '', unitId: '', durationHours: 24, reason: '' };
  const [form, setForm]           = useState(emptyForm);
  const [error, setError]         = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) { setForm(emptyForm); setError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!form.delegateUserId || !form.permission || !form.unitId || !form.durationHours || !form.reason) {
      setError('All fields are required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.createDelegation({
        delegateUserId: Number(form.delegateUserId),
        permission:     form.permission,
        unitId:         Number(form.unitId),
        durationHours:  Number(form.durationHours),
        reason:         form.reason
      });
      onCreated();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setSubmitting(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Delegation"
      actions={
        <>
          <button className="btn" onClick={onClose} disabled={submitting}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Delegating…' : 'Delegate'}
          </button>
        </>
      }
    >
      <form onSubmit={handleSubmit}>
        {error && <div className="feedback-banner error" style={{ marginBottom: 'var(--sp-3)' }}>{error}</div>}

        <div className="form-group">
          <label className="form-label">Delegate user ID *</label>
          <input type="text" inputMode="numeric" className="form-input" placeholder="e.g. 14"
            value={form.delegateUserId} onChange={e => setField('delegateUserId', e.target.value)} />
          <p className="field-hint">Find a user's ID under User Management.</p>
        </div>

        <div className="form-group">
          <label className="form-label">Permission *</label>
          <select className="form-select" value={form.permission} onChange={e => setField('permission', e.target.value)}>
            <option value="">— Select permission —</option>
            {ALL_PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <p className="field-hint">You can only delegate a permission you personally hold.</p>
        </div>

        <div className="form-group">
          <label className="form-label">Unit ID *</label>
          <input type="text" inputMode="numeric" className="form-input" placeholder="e.g. 3"
            value={form.unitId} onChange={e => setField('unitId', e.target.value)} />
          <p className="field-hint">Covers this unit and everything below it in the command tree.</p>
        </div>

        <div className="form-group">
          <label className="form-label">Duration (hours) *</label>
          <input type="number" min="1" max="168" className="form-input"
            value={form.durationHours} onChange={e => setField('durationHours', e.target.value)} />
          <p className="field-hint">1–168 hours (7 days max).</p>
        </div>

        <div className="form-group">
          <label className="form-label">Reason *</label>
          <textarea className="form-textarea" rows={3} value={form.reason}
            onChange={e => setField('reason', e.target.value)} placeholder="Why is this delegation needed?" />
        </div>
      </form>
    </Modal>
  );
}

// ════════════════════════════════════════════════════════════════
// EMERGENCY OVERRIDE (issue-only — no GET .../mine exists)
// ════════════════════════════════════════════════════════════════
function OverrideTab({ onLogout, onIssued }) {
  const emptyForm = { permission: '', attemptedUnitId: '', justification: '', durationMinutes: 30 };
  const [form, setForm]             = useState(emptyForm);
  const [error, setError]           = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [issued, setIssued]         = useState(null);

  function setField(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null); setIssued(null);
    if (!form.permission || !form.justification) {
      setError('Permission and justification are required.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.createOverride({
        permission:       form.permission,
        attemptedUnitId:  form.attemptedUnitId ? Number(form.attemptedUnitId) : null,
        justification:    form.justification,
        durationMinutes:  Number(form.durationMinutes) || undefined
      });
      setIssued(result.override);
      setForm(emptyForm);
      onIssued?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setSubmitting(false); }
  }

  return (
    <div>
      <div className="report-note" style={{ marginBottom: 'var(--sp-4)' }}>
        <span className="report-note-icon">⚠</span>
        Emergency overrides are logged as a SECURITY event the moment they're issued — before any use —
        and must be reviewed by a Senior Officer, Commander, Auditor, or System Admin within 24 hours.
        Use only when the normal delegation process isn't fast enough.
      </div>

      {error && (
        <div className="feedback-banner error">
          {error}
          <button className="feedback-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}
      {issued && (
        <div className="feedback-banner success">
          Override #{issued.id} issued for <strong>{issued.permission}</strong>, valid until {fmtTime(issued.expiresAt)}.
          <button className="feedback-close" onClick={() => setIssued(null)}>✕</button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label className="form-label">Permission needed *</label>
          <select className="form-select" value={form.permission} onChange={e => setField('permission', e.target.value)}>
            <option value="">— Select permission —</option>
            {ALL_PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Unit ID (optional)</label>
          <input type="text" inputMode="numeric" className="form-input" placeholder="Leave blank if not unit-specific"
            value={form.attemptedUnitId} onChange={e => setField('attemptedUnitId', e.target.value)} />
        </div>

        <div className="form-group">
          <label className="form-label">Duration (minutes)</label>
          <input type="number" min="1" max="120" className="form-input"
            value={form.durationMinutes} onChange={e => setField('durationMinutes', e.target.value)} />
          <p className="field-hint">1–120 minutes (defaults to 30).</p>
        </div>

        <div className="form-group">
          <label className="form-label">Justification *</label>
          <textarea className="form-textarea" rows={3} value={form.justification}
            onChange={e => setField('justification', e.target.value)}
            placeholder="What's the emergency, and why can't this wait for a normal delegation?" />
          <p className="field-hint">Minimum 10 characters. This is reviewed after the fact, not approved in advance.</p>
        </div>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Issuing…' : '⚠ Issue Emergency Override'}
        </button>
      </form>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// REVIEW QUEUE  (audit:read — AUDITOR / SENIOR_OFFICER / COMMANDER / SYSTEM_ADMIN)
// ════════════════════════════════════════════════════════════════
function ReviewQueueTab({ onLogout, onReviewed }) {
  const [overrides, setOverrides]     = useState([]);
  const [overdueCount, setOverdueCount] = useState(0);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [busyId, setBusyId]           = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getPendingReviewOverrides();
      setOverrides(result.overrides || []);
      setOverdueCount(result.overdueCount || 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleReview(o) {
    setBusyId(o.id);
    try {
      await api.reviewOverride(o.id);
      await load();
      onReviewed?.();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setBusyId(null); }
  }

  if (loading) return <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>;
  if (error)   return <div className="state-screen" style={{ minHeight: 200 }}><p className="state-error">{error}</p></div>;

  return (
    <>
      <div className="page-header" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className="page-subtitle">
          {overrides.length} awaiting review
          {overdueCount > 0 && <span className="status-critical"> · {overdueCount} overdue (&gt;24h)</span>}
        </span>
        <button className="btn btn-sm" onClick={load}>↻ Refresh</button>
      </div>

      {overrides.length === 0 ? (
        <div className="table-empty">✓ No overrides awaiting review.</div>
      ) : (
        <div className="td-timeline">
          {overrides.map(o => {
            const overdue = (Date.now() - new Date(o.createdAt).getTime()) > 24 * 3_600_000;
            return (
              <div key={o.id} className={`td-event ${overdue ? 'tl-rejected' : ''}`}>
                <span className="td-event-icon">{overdue ? '⚠' : '⏱'}</span>
                <div className="td-event-body">
                  <span className="td-event-label">
                    <span className="sev-pill sev-security">SECURITY</span>{' '}
                    #{o.id} · {o.permission} · issued by #{o.userId}{o.attemptedUnitId ? ` · unit ${o.attemptedUnitId}` : ''}
                  </span>
                  <span className="td-event-time">{fmtTime(o.createdAt)} · expires {fmtTime(o.expiresAt)}</span>
                  <p className="report-card-desc" style={{ margin: 'var(--sp-1) 0 0' }}>{o.justification}</p>
                  <button className="btn btn-sm" style={{ marginTop: 'var(--sp-2)' }}
                    disabled={busyId === o.id} onClick={() => handleReview(o)}>
                    {busyId === o.id ? 'Reviewing…' : '✓ Mark Reviewed'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
