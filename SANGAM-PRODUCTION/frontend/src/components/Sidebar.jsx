import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import DemoBanner from './DemoBanner.jsx';
import NotificationBell from './NotificationBell.jsx';

/**
 * Sidebar  (Day 32)
 *
 * Persistent left-side navigation rail.
 *
 * Features:
 *  - Active route highlighting via NavLink
 *  - Role-aware links (OFFICER+ sees APPROVE badge on Transfers)
 *  - Collapsible on mobile (hamburger toggle)
 *  - Rank + unit display at bottom
 *
 * Rank levels:
 *   JAWAN   → clearance 1 (read-only scope)
 *   HAVILDAR → clearance 2 (unit scope)
 *   OFFICER  → clearance 3 (command scope, can approve transfers)
 *   ADMIN    → clearance 5 (system scope)
 */

const NAV_LINKS = [
  {
    to:    '/',
    label: 'COMMAND HQ',
    icon:  '◉',
    exact: true,
    description: 'Overview dashboard',
  },
  {
    to:    '/units',
    label: 'COMMAND UNITS',
    icon:  '⬡',
    description: 'Unit hierarchy & roster',
    minRankLevel: 4,
  },
  {
    to:    '/supply/items',
    label: 'SUPPLY ITEMS',
    icon:  '▣',
    description: 'Inventory catalogue',
  },
  {
    to:    '/supply/transfers',
    label: 'TRANSFERS',
    icon:  '⇄',
    description: 'Movement requests',
    requiresApproval: true,  // show badge for officers
  },
  {
    to:    '/supply/blockchain',
    label: 'LEDGER',
    icon:  '⛓',
    description: 'Blockchain audit chain',
  },
  {
    to:    '/alerts',
    label: 'ALERTS',
    icon:  '◈',
    description: 'Escalation monitor',
    alertLink: true,
  },
  {
    to:    '/reports',
    label: 'REPORTS',
    icon:  '⬇',
    description: 'CSV exports',
  },
  {
    to:    '/movement',
    label: 'MOVEMENT',
    icon:  '➤',
    description: 'Orders & dispatch',
  },
  {
    to:    '/inventory',
    label: 'STOCK-TAKE',
    icon:  '▦',
    description: 'Inventory ledger',
  },
  {
    to:        '/audit',
    label:     'AUDIT LOG',
    icon:      '◎',
    description: 'Cryptographic event log',
    // Day 71: was `adminOnly: true` (rankLevel >= 5), which excluded
    // AUDITOR (rankLevel 4) — the one role whose entire defined purpose
    // ("read-only across all data plus full audit log access") centers
    // on this exact page. AUDITOR is the only role at rankLevel 4 (see
    // rbac.service.js ROLES), so this change adds access for exactly
    // that role and nobody else. Matches the existing minRankLevel
    // pattern already used for Compliance below. See the backend fix to
    // /api/reports/audit-log's permission requirement (same root cause)
    // in the Day 71 handoff notes.
    minRankLevel: 4,
  },
  {
    to:        '/admin/users',
    label:     'USERS',
    icon:      '⊞',
    description: 'User management',
    adminOnly: true,
  },
  {
    to:    '/compliance',
    label: 'COMPLIANCE',
    icon:  '⚖',
    description: 'Chain of custody, discrepancies & audit export',
    minRankLevel: 4,
  },
  {
    to:    '/delegation',
    label: 'DELEGATION',
    icon:  '🤝',
    description: 'Delegate authority & emergency override',
    // No minRankLevel — creating delegations/overrides and viewing your
    // own is open to every role; only the in-page Review Queue tab
    // (audit:read) is restricted, handled the same way as Compliance.
  },
  {
    to:    '/about',
    label: 'ABOUT',
    icon:  'ⓘ',
    description: 'System info & demo tour',
  },
];

function rankBadge(rankLevel) {
  if (!rankLevel) return null;
  const map = { 1: 'JWN', 2: 'HVL', 3: 'OFF', 5: 'ADM' };
  return map[rankLevel] || `L${rankLevel}`;
}

function canApprove(user) {
  return user && user.rankLevel >= 3;
}

export default function Sidebar({ user, onLogout, pendingCount = 0, onStartTour }) {
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const isOfficer = canApprove(user);

  return (
    <>
      {/* ── Mobile hamburger ─────────────────────────────── */}
      <button
        className="sidebar-hamburger"
        aria-label={open ? 'Close navigation' : 'Open navigation'}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="hamburger-line" />
        <span className="hamburger-line" />
        <span className="hamburger-line" />
      </button>

      {/* ── Overlay (mobile only) ────────────────────────── */}
      {open && (
        <div
          className="sidebar-overlay"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Sidebar panel ────────────────────────────────── */}
      <nav
        className={`sidebar${open ? ' sidebar--open' : ''}`}
        aria-label="Main navigation"
      >
        {/* Wordmark */}
        <div className="sidebar-wordmark">
          SANGAM<span className="sidebar-wordmark-dot">.</span>
        </div>
        <div className="sidebar-mission">SUPPLY CHAIN COMMAND</div>

        {/* Nav links */}
        <ul className="sidebar-nav" role="list">
          {NAV_LINKS.map(link => {
            // Skip admin-only links for non-admins
            if (link.adminOnly && (!user || user.rankLevel < 5)) return null;
            // Skip links with a minimum rank requirement the user doesn't meet
            if (link.minRankLevel && (!user || user.rankLevel < link.minRankLevel)) return null;

            if (link.comingSoon) {
              return (
                <li key={link.to} className="sidebar-nav-item sidebar-nav-item--soon">
                  <span className="sidebar-link sidebar-link--disabled">
                    <span className="sidebar-icon">{link.icon}</span>
                    <span className="sidebar-label">{link.label}</span>
                    <span className="sidebar-soon-tag">SOON</span>
                  </span>
                </li>
              );
            }

            return (
              <li key={link.to} className="sidebar-nav-item">
                <NavLink
                  to={link.to}
                  end={link.exact}
                  className={({ isActive }) =>
                    `sidebar-link${isActive ? ' sidebar-link--active' : ''}`
                  }
                  onClick={() => setOpen(false)}
                >
                  <span className="sidebar-icon">{link.icon}</span>
                  <span className="sidebar-label">{link.label}</span>

                  {/* Pending-approval badge for OFFICER+ on Transfers */}
                  {link.requiresApproval && isOfficer && pendingCount > 0 && (
                    <span className="sidebar-badge" aria-label={`${pendingCount} pending approvals`}>
                      {pendingCount > 9 ? '9+' : pendingCount}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>

        {/* System status + notification bell */}
        <div className="sidebar-status">
          <span className="sidebar-status-dot sidebar-status-dot--live" />
          <span className="sidebar-status-text">SYSTEM LIVE</span>
          <NotificationBell user={user} />
        </div>

        {/* User identity */}
        {user && (
          <div className="sidebar-user">
            <div className="sidebar-user-info">
              <span className="sidebar-user-rank">{rankBadge(user.rankLevel)}</span>
              <div className="sidebar-user-details">
                <div className="sidebar-user-name">{user.displayName || user.username}</div>
                <NavLink
                  to="/profile/password"
                  className={({ isActive }) =>
                    `sidebar-user-unit sidebar-pw-link${isActive ? ' sidebar-pw-link--active' : ''}`
                  }
                  onClick={() => setOpen(false)}
                >
                  {user.unitCode || `UNIT ${user.unitId}`} · Change password
                </NavLink>
              </div>
            </div>
            <button className="sidebar-logout" onClick={onLogout} aria-label="Log out">
              LOGOUT
            </button>
          </div>
        )}

        {/* Demo mode credential cheat-sheet */}
        <DemoBanner user={user} />

        {onStartTour && (
          <button
            className="sidebar-tour-btn"
            onClick={() => { setOpen(false); onStartTour(); }}
          >
            ▶ START DEMO TOUR
          </button>
        )}

      </nav>
    </>
  );
}
