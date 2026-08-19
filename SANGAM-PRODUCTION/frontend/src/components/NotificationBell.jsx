import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';

/**
 * NotificationBell  (Day 42; digest + preferences added Day 58)
 *
 * Sits in the Sidebar's status area. Polls /api/notifications/unread-count
 * every 30 seconds. On click opens a dropdown with three views, switched
 * via small header buttons:
 *   RECENT   (default) — the original scrollable list + "mark all read"
 *   DIGEST   — summary over a time window (total/unread/pending-ack,
 *              severity & type breakdown, top 10 items) — surfaces
 *              GET /notifications/digest, which existed with zero
 *              frontend surface until now
 *   SETTINGS — per-type mute toggles — surfaces GET/PUT
 *              /notifications/preferences, same gap
 *
 * Props:
 *   user  {object}  current user
 */

const SEV_ICON = {
  CRITICAL: '🔴',
  HIGH:     '🟠',
  MEDIUM:   '🟡',
  LOW:      '🔵',
  INFO:     '⚪',
};

const TYPE_LABELS = {
  LOW_STOCK:           'Low stock',
  TRANSFER_PENDING:    'Transfer pending',
  TRANSFER_APPROVED:   'Transfer approved',
  TRANSFER_REJECTED:   'Transfer rejected',
  MESH_PEER_OFFLINE:   'Mesh peer offline',
  MESH_PEER_ONLINE:    'Mesh peer online',
  SYNC_CONFLICT:       'Sync conflict',
  SECURITY_ALERT:      'Security alert',
  BLOCKCHAIN_TAMPER:   'Blockchain tamper',
  SYSTEM_ANNOUNCEMENT: 'System announcement',
  DELEGATION_GRANTED:  'Delegation granted',
};

function age(iso) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 60)   return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const POLL_MS = 30_000;

export default function NotificationBell({ user }) {
  const [count,  setCount]  = useState(0);
  const [open,   setOpen]   = useState(false);
  const [view,   setView]   = useState('recent'); // 'recent' | 'digest' | 'settings'
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [digest, setDigest]   = useState(null);
  const [digestLoading, setDigestLoading] = useState(false);
  const [prefs, setPrefs]     = useState(null);
  const [prefsLoading, setPrefsLoading]   = useState(false);
  const panelRef = useRef(null);

  // Poll unread count
  const pollCount = useCallback(async () => {
    if (!user) return;
    try {
      const r = await api.getUnreadCount();
      if (r?.success) setCount(r.unreadCount ?? 0);
    } catch { /* non-fatal */ }
  }, [user]);

  useEffect(() => {
    pollCount();
    const id = setInterval(pollCount, POLL_MS);
    return () => clearInterval(id);
  }, [pollCount]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function onDoc(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Load notifications when opening
  async function handleOpen() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setView('recent');
    setLoading(true);
    try {
      const r = await api.getNotifications({ limit: 20 });
      setNotifs(r?.notifications || r?.items || []);
    } catch { setNotifs([]); }
    finally { setLoading(false); }
  }

  async function handleMarkAll() {
    try {
      await api.markAllNotificationsRead();
      setCount(0);
      setNotifs(prev => prev.map(n => ({ ...n, isRead: true, read: true })));
    } catch { /* non-fatal */ }
  }

  async function handleMarkOne(id) {
    try {
      await api.markNotificationRead(id);
      setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true, read: true } : n));
      setCount(c => Math.max(0, c - 1));
    } catch { /* non-fatal */ }
  }

  async function switchView(v) {
    setView(v);
    if (v === 'digest' && !digest) {
      setDigestLoading(true);
      try { const r = await api.getNotificationDigest(24); if (r?.success) setDigest(r); }
      catch { /* non-fatal */ }
      finally { setDigestLoading(false); }
    }
    if (v === 'settings' && !prefs) {
      setPrefsLoading(true);
      try { const r = await api.getNotificationPreferences(); if (r?.success) setPrefs(r.preferences); }
      catch { /* non-fatal */ }
      finally { setPrefsLoading(false); }
    }
  }

  async function handleTogglePref(type, enabled) {
    setPrefs(prev => ({ ...prev, [type]: enabled })); // optimistic
    try { await api.setNotificationPreference(type, enabled); }
    catch { setPrefs(prev => ({ ...prev, [type]: !enabled })); } // revert on failure
  }

  return (
    <div className="notif-bell-wrap" ref={panelRef}>
      <button
        className="notif-bell-btn"
        onClick={handleOpen}
        aria-label={`Notifications${count > 0 ? ` — ${count} unread` : ''}`}
        aria-expanded={open}
      >
        <span className="notif-bell-icon">🔔</span>
        {count > 0 && (
          <span className="notif-bell-badge" aria-hidden="true">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
          <div className="notif-panel-header">
            <span className="notif-panel-title">NOTIFICATIONS</span>
            <div className="notif-view-switch">
              <button className={`notif-view-btn${view === 'recent' ? ' active' : ''}`}
                onClick={() => switchView('recent')} title="Recent" aria-label="Recent">🔔</button>
              <button className={`notif-view-btn${view === 'digest' ? ' active' : ''}`}
                onClick={() => switchView('digest')} title="Digest" aria-label="Digest">📊</button>
              <button className={`notif-view-btn${view === 'settings' ? ' active' : ''}`}
                onClick={() => switchView('settings')} title="Preferences" aria-label="Preferences">⚙</button>
            </div>
          </div>

          {view === 'recent' && (
            <>
              {count > 0 && (
                <div className="notif-mark-all-row">
                  <button className="notif-mark-all" onClick={handleMarkAll}>Mark all read</button>
                </div>
              )}
              <div className="notif-list">
                {loading ? (
                  <div className="notif-empty"><div className="spinner" style={{ width: 16, height: 16 }} /></div>
                ) : notifs.length === 0 ? (
                  <div className="notif-empty">No notifications.</div>
                ) : (
                  notifs.map(n => {
                    const isRead = n.isRead || n.read;
                    return (
                      <div
                        key={n.id}
                        className={`notif-item${isRead ? ' notif-read' : ' notif-unread'}`}
                        onClick={() => !isRead && handleMarkOne(n.id)}
                        role={isRead ? undefined : 'button'}
                        tabIndex={isRead ? undefined : 0}
                      >
                        <span className="notif-sev-icon">
                          {SEV_ICON[n.severity] || SEV_ICON.INFO}
                        </span>
                        <div className="notif-body">
                          <div className="notif-title">{n.title || n.type}</div>
                          {n.message && <div className="notif-msg">{n.message}</div>}
                        </div>
                        <span className="notif-age">{age(n.createdAt)}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </>
          )}

          {view === 'digest' && (
            <div className="notif-digest">
              {digestLoading ? (
                <div className="notif-empty"><div className="spinner" style={{ width: 16, height: 16 }} /></div>
              ) : !digest ? (
                <div className="notif-empty">Digest unavailable.</div>
              ) : (
                <>
                  <div className="notif-digest-stats">
                    <div><span className="notif-digest-num">{digest.total}</span><span className="notif-digest-label">LAST {digest.windowHours}H</span></div>
                    <div><span className="notif-digest-num">{digest.unread}</span><span className="notif-digest-label">UNREAD</span></div>
                    <div><span className="notif-digest-num">{digest.pendingAck}</span><span className="notif-digest-label">PENDING ACK</span></div>
                  </div>

                  {Object.keys(digest.bySeverity || {}).length > 0 && (
                    <div className="notif-digest-chips">
                      {Object.entries(digest.bySeverity).map(([sev, n]) => (
                        <span key={sev} className="chip">{SEV_ICON[sev] || ''} {sev} · {n}</span>
                      ))}
                    </div>
                  )}

                  {digest.items.length === 0 ? (
                    <div className="notif-empty">Nothing in this window.</div>
                  ) : (
                    <div className="notif-list">
                      {digest.items.map(n => (
                        <div key={n.id} className="notif-item notif-read">
                          <span className="notif-sev-icon">{SEV_ICON[n.severity] || SEV_ICON.INFO}</span>
                          <div className="notif-body">
                            <div className="notif-title">{n.title || n.type}</div>
                            {n.message && <div className="notif-msg">{n.message}</div>}
                          </div>
                          <span className="notif-age">{age(n.createdAt)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {view === 'settings' && (
            <div className="notif-settings">
              {prefsLoading ? (
                <div className="notif-empty"><div className="spinner" style={{ width: 16, height: 16 }} /></div>
              ) : !prefs ? (
                <div className="notif-empty">Preferences unavailable.</div>
              ) : (
                <div className="notif-pref-list">
                  {Object.keys(TYPE_LABELS).map(type => (
                    <label key={type} className={`filter-toggle${prefs[type] !== false ? ' active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={prefs[type] !== false}
                        onChange={e => handleTogglePref(type, e.target.checked)}
                      />
                      {TYPE_LABELS[type]}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

