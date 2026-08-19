import React, { useState } from 'react';

/**
 * DemoBanner  (Day 39)
 *
 * Shown in the sidebar footer when demo credentials are detected
 * (user is one of the seeded demo accounts or NODE_ENV signals demo).
 *
 * Shows a collapsible credential cheat-sheet for stakeholder demos.
 */

const DEMO_USERS = [
  { user: 'brig.sharma',  pass: 'Officer@1234', role: 'COMMANDER' },
  { user: 'lt.col.verma', pass: 'Officer@1234', role: 'OFFICER' },
  { user: 'maj.singh',    pass: 'Officer@1234', role: 'OFFICER' },
  { user: 'hav.kumar',    pass: 'Soldier@1234', role: 'NCO' },
  { user: 'admin',        pass: 'Admin@1234',   role: 'ADMIN' },
];

const DEMO_USERNAMES = new Set(DEMO_USERS.map(u => u.user));

export function isDemoUser(user) {
  return user && DEMO_USERNAMES.has(user.username);
}

export default function DemoBanner({ user }) {
  const [expanded, setExpanded] = useState(false);

  if (!isDemoUser(user)) return null;

  return (
    <div className="demo-banner">
      <button
        className="demo-banner-toggle"
        onClick={() => setExpanded(e => !e)}
        aria-expanded={expanded}
      >
        <span className="demo-banner-dot" />
        <span className="demo-banner-label">DEMO MODE</span>
        <span className="demo-banner-chevron">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="demo-creds">
          <div className="demo-creds-title">LOGIN CREDENTIALS</div>
          {DEMO_USERS.map(u => (
            <div key={u.user} className={`demo-cred-row${u.user === user.username ? ' demo-cred-active' : ''}`}>
              <span className="demo-cred-user">{u.user}</span>
              <span className="demo-cred-role">{u.role}</span>
              <span className="demo-cred-pass">{u.pass}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
