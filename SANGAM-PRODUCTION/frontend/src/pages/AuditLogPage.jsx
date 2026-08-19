import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';

/**
 * Audit Log Page  (Day 36)
 *
 * Admin-only view of the SANGAM cryptographic audit log.
 * Shows action, user, timestamp, severity, success/failure.
 * Filters: severity, username, action keyword.
 */

const SEVERITY_FILTERS = ['ALL', 'INFO', 'WARNING', 'CRITICAL', 'SECURITY'];

const SEV_STYLE = {
  INFO:     'sev-info',
  WARNING:  'sev-warning',
  CRITICAL: 'sev-critical',
  SECURITY: 'sev-security',
};

const PAGE_SIZE = 50;

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hour12: false
  });
}

export default function AuditLogPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [entries,   setEntries]   = useState([]);
  const [total,     setTotal]     = useState(0);
  const [source,    setSource]    = useState('');
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [offset,    setOffset]    = useState(0);
  const [sevFilter, setSevFilter] = useState('ALL');
  const [search,    setSearch]    = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [verifying,  setVerifying]  = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifyError,  setVerifyError]  = useState(null);

  // Guard: Day 71 — was `user.role === 'SYSTEM_ADMIN'`, which blocked
  // AUDITOR (rankLevel 4) from this page even after fixing the sidebar
  // link and the backend permission requirement (same root cause, three
  // places). Uses the same rankLevel>=4 criterion as Sidebar.jsx's
  // minRankLevel for this link, for consistency — AUDITOR is the only
  // role at rankLevel 4, so this doesn't admit anyone unintended.
  const isAdmin = user && user.rankLevel >= 4;

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true); setError(null);
    try {
      const filters = { limit: PAGE_SIZE, offset };
      if (sevFilter !== 'ALL') filters.severity = sevFilter;
      if (search.trim())       filters.username  = search.trim();
      const result = await api.getAuditLog(filters);
      setEntries(result.entries || []);
      setTotal(result.total || 0);
      setSource(result.source || '');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      if (err instanceof ApiError && err.status === 403) {
        setError('Access denied — insufficient clearance for the audit log.');
        return;
      }
      setError(err.message || 'Failed to load audit log');
    } finally { setLoading(false); }
  }, [isAdmin, sevFilter, search, offset, onLogout]);

  useEffect(() => { setOffset(0); }, [sevFilter, search]);
  useEffect(() => { load(); }, [load]);

  function handleSearch(e) {
    if (e.key === 'Enter') setSearch(searchInput.trim());
  }

  // Day 71: surfaces the previously orphaned verify-integrity endpoint —
  // checks the audit log's own cryptographic hash chain for tampering.
  async function handleVerifyIntegrity() {
    setVerifying(true); setVerifyError(null); setVerifyResult(null);
    try {
      const result = await api.verifyAuditIntegrity();
      setVerifyResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      // Consistent with this page's existing "IN-MEMORY BUFFER (DB
      // OFFLINE)" messaging — integrity verification re-reads the SQL
      // audit_logs table directly, so it's genuinely unavailable (not
      // broken) whenever there's no database connection.
      setVerifyError(err.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  if (!isAdmin) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <p className="state-error">Access denied — insufficient clearance for the audit log.</p>
          <button className="btn btn-ghost" onClick={() => navigate('/')}>← Dashboard</button>
        </div>
      </div>
    );
  }

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Audit Log</h1>
          <span className="page-subtitle">
            {total} ENTR{total === 1 ? 'Y' : 'IES'}
            {source === 'buffer' && ' · IN-MEMORY BUFFER (DB OFFLINE)'}
            {source === 'db'     && ' · DATABASE'}
          </span>
        </div>
        <div className="page-header-right">
          <button className="btn btn-sm" onClick={handleVerifyIntegrity} disabled={verifying}>
            {verifying ? 'VERIFYING…' : '⛓ VERIFY INTEGRITY'}
          </button>
          <button className="btn btn-sm" onClick={load}>↻ REFRESH</button>
        </div>
      </div>

      {(verifyResult || verifyError) && (
        <div
          className={`integrity-banner ${verifyError || (verifyResult && !verifyResult.verified) ? 'integrity-banner--critical' : 'integrity-banner--good'}`}
          role="status"
        >
          {verifyError && (
            <span>⚠ Integrity check unavailable — {verifyError}</span>
          )}
          {!verifyError && verifyResult.verified && (
            <span>✓ Hash chain verified — {verifyResult.entriesChecked} {verifyResult.entriesChecked === 1 ? 'entry' : 'entries'} checked, no tampering detected.</span>
          )}
          {!verifyError && !verifyResult.verified && (
            <span>
              ⚠ TAMPERING DETECTED — {verifyResult.tamperedEntries.length} of {verifyResult.entriesChecked} entries failed hash verification
              (first affected entry: #{verifyResult.tamperedEntries[0]?.id}, action {verifyResult.tamperedEntries[0]?.action}).
            </span>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="filter-bar" style={{ marginBottom: 'var(--sp-3)' }}>
        <input
          type="text"
          placeholder="Filter by username…"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={handleSearch}
          onBlur={() => setSearch(searchInput.trim())}
        />
      </div>

      <div className="tab-bar">
        {SEVERITY_FILTERS.map(s => (
          <button key={s} className={`tab${sevFilter === s ? ' tab-active' : ''}`}
            onClick={() => setSevFilter(s)}>{s}</button>
        ))}
      </div>

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="table-empty">No audit log entries match the current filters.</div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="item-table audit-table">
              <thead>
                <tr>
                  <th>TIME</th>
                  <th>USER</th>
                  <th>ACTION</th>
                  <th>RESOURCE</th>
                  <th>SEV</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.id || i} className={!e.success ? 'audit-row-fail' : ''}>
                    <td className="audit-time">{fmtTime(e.createdAt || e.created_at)}</td>
                    <td className="audit-user">
                      <div className="item-name-cell">{e.username || '—'}</div>
                      {e.unitCode || e.unit_code
                        ? <div className="item-code-cell" style={{ fontSize: 10 }}>{e.unitCode || e.unit_code}</div>
                        : null}
                    </td>
                    <td className="audit-action">{e.action}</td>
                    <td className="item-code-cell">
                      {e.resource}{e.resourceId || e.resource_id ? `/${e.resourceId || e.resource_id}` : ''}
                    </td>
                    <td>
                      <span className={`sev-pill ${SEV_STYLE[e.severity] || ''}`}>
                        {e.severity || 'INFO'}
                      </span>
                    </td>
                    <td>
                      <span className={e.success ? 'status-good' : 'status-critical'}>
                        {e.success ? '✓' : '✗'}
                      </span>
                      {!e.success && e.failureReason || e.failure_reason
                        ? <span className="audit-fail-reason">
                            {(e.failureReason || e.failure_reason || '').slice(0, 30)}
                          </span>
                        : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
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
        </>
      )}
    </div>
  );
}
