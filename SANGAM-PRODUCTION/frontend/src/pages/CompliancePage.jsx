import React, { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../api/client.js';
import Widget from '../components/Widget.jsx';

/**
 * CompliancePage  (Day 56)
 *
 * Surfaces ComplianceService (Day 20) and its 5 routes, which were fully
 * built and mounted at /api/compliance since Day 20 but had zero frontend
 * surface — not one page, not one client.js method — until now.
 *
 * Five independent sections (tabs), each fetched only when selected:
 *   Summary            — reports:advanced   (Senior-Officer-style aggregate dashboard)
 *   Chain of Custody   — reports:advanced   (per-item full history, offline-safe)
 *   Discrepancy Report — reports:advanced   (quantity vs blockchain-derived expected value)
 *   Transfer Register  — reports:read       (audit-enriched, live browsable — complements
 *                                             ReportsPage's CSV-only "Transfer Register" export)
 *   Audit Export       — audit:export       (the AUDITOR role's *only* route to audit data —
 *                                             AuditLogPage is hard-gated to SYSTEM_ADMIN, so
 *                                             without this tab, a user whose entire job is
 *                                             "audit role — read-only... full audit log access"
 *                                             could not view any audit data at all)
 *
 * reports:advanced is NOT a clean rank-level cutoff (LOGISTICS_OFFICER=6 has
 * it, OFFICER=7 does not — see rbac.service.js ROLE_PERMISSIONS). The client never receives
 * a permissions array (only role/rankLevel), so this page does not attempt to
 * replicate the permission matrix client-side. Each tab independently calls
 * its real endpoint and shows a plain "access denied" state on a real 403 —
 * the backend is always the actual authority, matching ReportsPage's existing
 * pattern. The Sidebar link visibility is a rough rankLevel>=4 heuristic only.
 */

const SEV_STYLE = { INFO: 'sev-info', WARNING: 'sev-warning', CRITICAL: 'sev-critical', SECURITY: 'sev-security' };

const TABS = [
  { key: 'summary',     label: 'SUMMARY' },
  { key: 'custody',     label: 'CHAIN OF CUSTODY' },
  { key: 'discrepancy', label: 'DISCREPANCY REPORT' },
  { key: 'register',    label: 'TRANSFER REGISTER' },
  { key: 'audit',       label: 'AUDIT EXPORT' },
];

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hour12: false
  });
}

// Compliance routes return {success:false, error:'CODE'} with no separate
// `message` field, and the route layer sends these as non-2xx statuses —
// so client.js's request() always throws an ApiError for them. Without this
// mapping, the raw code (e.g. "ITEM_NOT_FOUND") would render to the user.
function friendlyError(err) {
  if (!(err instanceof ApiError)) return err?.message || 'Something went wrong.';
  if (err.status === 403) return 'Your role does not have access to this section.';
  if (err.status === 0)   return err.message;
  const code = err.payload?.error;
  const map = {
    ITEM_NOT_FOUND:    'No item with that ID exists in your command scope.',
    UNIT_OUT_OF_SCOPE: 'That item belongs to a unit outside your command scope.',
  };
  return map[code] || err.message || 'Request failed.';
}

export default function CompliancePage({ onLogout }) {
  const [tab, setTab] = useState('summary');

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Compliance &amp; Assurance</h1>
          <span className="page-subtitle">Chain of custody, discrepancy detection &amp; audit exports</span>
        </div>
      </div>

      <div className="tab-bar">
        {TABS.map(t => (
          <button key={t.key} className={`tab${tab === t.key ? ' tab-active' : ''}`}
            onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'summary'     && <SummaryTab     onLogout={onLogout} />}
      {tab === 'custody'     && <CustodyTab     onLogout={onLogout} />}
      {tab === 'discrepancy' && <DiscrepancyTab onLogout={onLogout} />}
      {tab === 'register'    && <RegisterTab    onLogout={onLogout} />}
      {tab === 'audit'       && <AuditExportTab onLogout={onLogout} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════
function SummaryTab({ onLogout }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getComplianceSummary();
      setData(result.summary);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>;
  if (error)   return <div className="state-screen" style={{ minHeight: 200 }}><p className="state-error">{error}</p></div>;
  if (!data)   return null;

  return (
    <>
      <div className="widget-grid">
        <Widget
          code="XFR"
          headline={String(data.transfers.completed)}
          unit="COMPLETED"
          subline={`${data.transfers.approvalRate} approval rate · ${data.transfers.pending} pending · ${data.transfers.rejected} rejected`}
        />
        <Widget
          code="INV"
          headline={String(data.inventory.totalItems)}
          unit="ITEMS"
          subline={data.inventory.lowStockItems > 0
            ? <span className="status-warn">{data.inventory.lowStockItems} below threshold</span>
            : <span className="status-good">All items above threshold</span>}
        />
        <Widget
          code="LDG"
          headline={String(data.blockchain.blockCount)}
          unit="BLOCKS"
          subline={data.blockchain.chainVerified
            ? <span className="status-good">✓ Chain verified</span>
            : <span className="status-critical">⚠ {data.blockchain.tamperCount} tampered</span>}
        />
        <Widget
          code="AUD"
          headline={String(data.audit.entriesLast24h)}
          unit="LAST 24H"
          subline={`${data.audit.securityEvents} security events · ${data.audit.totalEntries} total entries`}
        />
      </div>

      {data.inventory.lowStockDetails?.length > 0 && (
        <div className="table-scroll" style={{ marginTop: 'var(--sp-4)' }}>
          <table className="item-table">
            <thead><tr><th>ITEM</th><th>QTY</th><th>THRESHOLD</th><th>UNIT</th></tr></thead>
            <tbody>
              {data.inventory.lowStockDetails.map(i => (
                <tr key={i.itemId}>
                  <td className="item-name-cell">{i.itemName}<div className="item-code-cell">{i.itemCode}</div></td>
                  <td className="status-warn">{i.quantity}</td>
                  <td>{i.threshold}</td>
                  <td>{i.unitId}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="report-note">
        <span className="report-note-icon">ℹ</span>
        Generated {fmtTime(data.generatedAt)}. Scoped to your command hierarchy.
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// CHAIN OF CUSTODY
// ════════════════════════════════════════════════════════════════
// NOTE: two audit layers exist in this system — auth.auditRequest()
// middleware (generic HTTP access log, action names like
// SUPPLY_ITEM_CREATE) and the service's own internal _audit() call
// (domain-specific, action names like SUPPLY_CREATE). They're genuinely
// separate log entries. But getChainOfCustody() applies its own explicit
// SUPPLY_ACTIONS allowlist (compliance.service.js) containing only the
// service-level names below — so only those six ever reach this view.
// The middleware-level names still exist in the Audit Export tab's raw
// feed (by design — that tab shows entries unfiltered/unmapped).
const CUSTODY_ACTION_LABELS = {
  SUPPLY_CREATE:            'Item created',
  SUPPLY_UPDATE:            'Item updated',
  SUPPLY_DELETE:            'Item deleted',
  SUPPLY_TRANSFER_INITIATE: 'Transfer requested',
  SUPPLY_TRANSFER_APPROVE:  'Transfer approved',
  SUPPLY_TRANSFER_REJECT:   'Transfer rejected',
};

function custodyEventMeta(ev) {
  const label = CUSTODY_ACTION_LABELS[ev.action] || ev.action;
  if (ev.action === 'SUPPLY_TRANSFER_APPROVE') return { icon: '✓', cls: 'tl-approved', label };
  if (ev.action === 'SUPPLY_TRANSFER_REJECT' || ev.action === 'SUPPLY_DELETE') {
    return { icon: '✗', cls: 'tl-rejected', label };
  }
  if (ev.action === 'SUPPLY_TRANSFER_INITIATE') return { icon: '⇄', cls: '', label };
  if (ev.action === 'SUPPLY_CREATE') return { icon: '✚', cls: '', label };
  return { icon: '•', cls: '', label };
}

function CustodyTab({ onLogout }) {
  const [itemId, setItemId]   = useState('');
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleLookup(e) {
    e.preventDefault();
    if (!itemId.trim()) return;
    setLoading(true); setError(null); setData(null);
    try {
      const result = await api.getChainOfCustody(itemId.trim());
      setData(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }

  async function handleExportCSV() {
    if (!data) return;
    try { await api.exportComplianceCSV('chain-of-custody', {}, data.itemId); }
    catch (err) { setError(friendlyError(err)); }
  }

  return (
    <>
      <form className="filter-bar" onSubmit={handleLookup} style={{ marginBottom: 'var(--sp-4)' }}>
        <input
          type="text"
          inputMode="numeric"
          className="form-input"
          placeholder="Item ID (e.g. 14)"
          value={itemId}
          onChange={e => setItemId(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !itemId.trim()}>
          {loading ? 'Looking up…' : '🔍 Look Up'}
        </button>
      </form>

      {error && (
        <div className="feedback-banner error">
          {error}
          <button className="feedback-close" onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {data && (
        <>
          <div className="report-card" style={{ marginBottom: 'var(--sp-4)' }}>
            <div className="report-card-header">
              <span className="report-card-icon">▣</span>
              <span className="report-card-label">{data.item.itemName} ({data.item.itemCode})</span>
            </div>
            <p className="report-card-desc">
              {data.eventCount} custody event{data.eventCount === 1 ? '' : 's'} · current quantity {data.item.quantity} · unit {data.item.unitId}
            </p>
            <button className="btn btn-sm" onClick={handleExportCSV}>⬇ Export CSV</button>
          </div>

          {data.events.length === 0 ? (
            <div className="table-empty">No custody events recorded for this item yet.</div>
          ) : (
            <div className="td-timeline">
              {data.events.map((ev, i) => {
                const meta = custodyEventMeta(ev);
                return (
                  <div key={i} className={`td-event ${meta.cls}`}>
                    <span className="td-event-icon">{meta.icon}</span>
                    <div className="td-event-body">
                      <span className="td-event-label">
                        {meta.label} — actor #{ev.actorId ?? '—'}{ev.success ? '' : ' (failed)'}
                      </span>
                      <span className="td-event-time">{fmtTime(ev.timestamp)}</span>
                    </div>
                    {i < data.events.length - 1 && <div className="td-event-connector" />}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// DISCREPANCY REPORT
// ════════════════════════════════════════════════════════════════
function DiscrepancyTab({ onLogout }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getDiscrepancyReport();
      setData(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>;
  if (error)   return <div className="state-screen" style={{ minHeight: 200 }}><p className="state-error">{error}</p></div>;
  if (!data)   return null;

  return (
    <>
      <div className="page-header" style={{ marginBottom: 'var(--sp-3)' }}>
        <span className="page-subtitle">
          {data.discrepancyCount} discrepanc{data.discrepancyCount === 1 ? 'y' : 'ies'} found across {data.totalItems} items
        </span>
        <button className="btn btn-sm" onClick={load}>↻ Re-scan</button>
      </div>

      {data.discrepancies.length === 0 ? (
        <div className="table-empty">✓ No discrepancies. Every item's quantity matches its blockchain-derived expected value.</div>
      ) : (
        <div className="table-scroll">
          <table className="item-table">
            <thead>
              <tr><th>ITEM</th><th>INITIAL</th><th>NET TRANSFERS</th><th>EXPECTED</th><th>ACTUAL</th><th>DELTA</th><th>SEV</th></tr>
            </thead>
            <tbody>
              {data.discrepancies.map(d => (
                <tr key={d.itemId}>
                  <td className="item-name-cell">{d.itemName}<div className="item-code-cell">{d.itemCode}</div></td>
                  <td>{d.initialQty}</td>
                  <td>{d.transferNet > 0 ? `+${d.transferNet}` : d.transferNet}</td>
                  <td>{d.expectedQty}</td>
                  <td>{d.actualQty}</td>
                  <td className={d.delta > 0 ? 'status-warn' : 'status-critical'}>{d.delta > 0 ? `+${d.delta}` : d.delta}</td>
                  <td><span className={`sev-pill ${d.severity === 'HIGH' ? 'sev-critical' : 'sev-warning'}`}>{d.severity}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="report-note">
        <span className="report-note-icon">ℹ</span>
        Compares each item's current quantity against its blockchain-derived expected value (initial quantity ± approved transfers).
        A non-zero delta may be a legitimate manual adjustment or a tamper event — investigate via Chain of Custody.
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// TRANSFER REGISTER
// ════════════════════════════════════════════════════════════════
function RegisterTab({ onLogout }) {
  const [transfers, setTransfers] = useState([]);
  const [total, setTotal]         = useState(0);
  const [status, setStatus]       = useState('');
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getComplianceTransferRegister({ status: status || undefined, limit: 100 });
      setTransfers(result.transfers || []);
      setTotal(result.total || 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [status, onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleExportCSV() {
    try { await api.exportComplianceCSV('transfer-register', { status: status || undefined }); }
    catch (err) { setError(friendlyError(err)); }
  }

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: 'var(--sp-3)' }}>
        <select className="form-select" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">ALL STATUSES</option>
          <option value="PENDING">PENDING</option>
          <option value="COMPLETED">COMPLETED</option>
          <option value="REJECTED">REJECTED</option>
        </select>
        <button className="btn btn-sm" onClick={handleExportCSV}>⬇ Export CSV</button>
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}><p className="state-error">{error}</p></div>
      ) : transfers.length === 0 ? (
        <div className="table-empty">No transfers match the current filter.</div>
      ) : (
        <div className="table-scroll">
          <table className="item-table">
            <thead>
              <tr><th>ITEM</th><th>FROM → TO</th><th>QTY</th><th>STATUS</th><th>REQUESTED BY</th><th>APPROVED BY</th><th>VERIFIED</th></tr>
            </thead>
            <tbody>
              {transfers.map(t => (
                <tr key={t.transferId}>
                  <td className="item-name-cell">{t.itemName}<div className="item-code-cell">{t.itemCode}</div></td>
                  <td>{t.fromUnitId} → {t.toUnitId}</td>
                  <td>{t.quantity}</td>
                  <td>
                    <span className={`sev-pill ${t.status === 'COMPLETED' ? 'sev-info' : t.status === 'REJECTED' ? 'sev-critical' : 'sev-warning'}`}>
                      {t.status}
                    </span>
                  </td>
                  <td>#{t.requestedByUserId}</td>
                  <td>{t.approvedByUserId ? `#${t.approvedByUserId}` : '—'}</td>
                  <td>{t.auditVerified ? <span className="status-good">✓</span> : <span className="status-critical">✗</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="report-note">
        <span className="report-note-icon">ℹ</span>
        {total} transfer{total === 1 ? '' : 's'} in scope. VERIFIED confirms an audit-log entry exists for the approval/rejection decision.
      </div>
    </>
  );
}

// ════════════════════════════════════════════════════════════════
// AUDIT EXPORT  (the AUDITOR role's only route to audit data)
// ════════════════════════════════════════════════════════════════
function AuditExportTab({ onLogout }) {
  const [severity, setSeverity] = useState('');
  const [entries, setEntries]   = useState([]);
  const [total, setTotal]       = useState(0);
  const [capped, setCapped]     = useState(false);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getComplianceAuditExport({ severity: severity || undefined, limit: 50 });
      setEntries(result.entries || []);
      setTotal(result.total || 0);
      setCapped(!!result.capped);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(friendlyError(err));
    } finally { setLoading(false); }
  }, [severity, onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleExportCSV() {
    try { await api.exportComplianceCSV('audit-export', { severity: severity || undefined }); }
    catch (err) { setError(friendlyError(err)); }
  }

  return (
    <>
      <div className="filter-bar" style={{ marginBottom: 'var(--sp-3)' }}>
        <select className="form-select" value={severity} onChange={e => setSeverity(e.target.value)}>
          <option value="">ALL SEVERITIES</option>
          <option value="INFO">INFO</option>
          <option value="WARNING">WARNING</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="SECURITY">SECURITY</option>
        </select>
        <button className="btn btn-sm" onClick={handleExportCSV}>⬇ Export Full CSV</button>
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}><p className="state-error">{error}</p></div>
      ) : entries.length === 0 ? (
        <div className="table-empty">No audit entries match the current filter.</div>
      ) : (
        <div className="table-scroll">
          <table className="item-table audit-table">
            <thead><tr><th>TIME</th><th>USER</th><th>ACTION</th><th>RESOURCE</th><th>SEV</th><th>STATUS</th></tr></thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={e.id || i} className={!e.success ? 'audit-row-fail' : ''}>
                  <td className="audit-time">{fmtTime(e.timestamp)}</td>
                  <td>#{e.userId ?? '—'}</td>
                  <td className="audit-action">{e.action}</td>
                  <td className="item-code-cell">{e.resource}{e.resourceId ? `/${e.resourceId}` : ''}</td>
                  <td><span className={`sev-pill ${SEV_STYLE[e.severity] || ''}`}>{e.severity}</span></td>
                  <td><span className={e.success ? 'status-good' : 'status-critical'}>{e.success ? '✓' : '✗'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="report-note">
        <span className="report-note-icon">ℹ</span>
        Showing {entries.length} of {total}{capped ? ' (server-capped at 1000 for preview)' : ''}. Use Export Full CSV for the complete filtered set.
      </div>
    </>
  );
}
