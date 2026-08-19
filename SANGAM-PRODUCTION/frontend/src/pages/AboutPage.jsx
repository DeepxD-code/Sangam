import React, { useEffect, useState } from 'react';
import { api } from '../api/client.js';

/**
 * About / System Info Page  (Day 55)
 *
 * A quick-reference page for stakeholder demos: what SANGAM is, what's
 * built so far (pulled live from the same endpoints every other page
 * already uses — no new backend surface needed), and a way to (re)start
 * the guided tour without hunting for the sidebar button.
 */

const FEATURES = [
  'Command hierarchy — full unit tree with personnel, supply, and movement roll-up per unit',
  'Supply chain tracking — categorized items, live stock levels, low-stock alerting',
  'Blockchain-backed transfers — every approved transfer is written to a tamper-evident, hash-chained ledger',
  'Movement orders — dispatch, in-transit, and delivery tracking between units',
  'Stocktake / inventory reconciliation sessions',
  'Automated alert escalation with full lifecycle history (raised → acknowledged → escalated → resolved/suppressed)',
  'Role-based access control across 8 ranks, from Soldier to System Admin',
  'CSV reporting for stock levels, transfers, unit rosters, and mesh health',
  'Fully offline-first — every service degrades gracefully with no database connection',
];

const STACK = [
  'Node.js 22 + Express 5', 'React 18 + Vite 5', 'JWT auth with refresh rotation',
  'AES-256-GCM audit logging', 'PostgreSQL (optional) / in-memory (primary)', 'Docker'
];

export default function AboutPage({ user, onStartTour }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.getUnitsHierarchy().catch(() => null),
      api.getSupplyItems().catch(() => null),
      api.getUsers({ limit: 1 }).catch(() => null),
    ]).then(([unitsRes, itemsRes, usersRes]) => {
      if (cancelled) return;
      function countTree(nodes) {
        return (nodes || []).reduce((sum, n) => sum + 1 + countTree(n.children), 0);
      }
      setStats({
        units: unitsRes ? countTree(unitsRes.tree) : null,
        items: itemsRes?.items?.length ?? itemsRes?.total ?? null,
        users: usersRes?.total ?? null,
      });
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">About SANGAM</h1>
          <span className="page-subtitle">Permissioned blockchain supply chain management — vertical slice demo</span>
        </div>
        {onStartTour && (
          <button className="btn btn-primary" onClick={onStartTour}>▶ START DEMO TOUR</button>
        )}
      </div>

      {stats && (
        <div className="unit-stat-grid" style={{ marginBottom: 'var(--sp-6)' }}>
          <div className="unit-stat-card">
            <span className="unit-stat-value">{stats.units ?? '—'}</span>
            <span className="unit-stat-label">UNITS TRACKED</span>
          </div>
          <div className="unit-stat-card">
            <span className="unit-stat-value">{stats.items ?? '—'}</span>
            <span className="unit-stat-label">SUPPLY ITEMS</span>
          </div>
          <div className="unit-stat-card">
            <span className="unit-stat-value">{stats.users ?? '—'}</span>
            <span className="unit-stat-label">PERSONNEL IN SCOPE</span>
          </div>
          <div className="unit-stat-card">
            <span className="unit-stat-value">{user?.role || '—'}</span>
            <span className="unit-stat-label">YOUR ROLE</span>
          </div>
        </div>
      )}

      <div className="unit-section">
        <h2 className="unit-section-title">What's Built</h2>
        <ul className="about-feature-list">
          {FEATURES.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      </div>

      <div className="unit-section">
        <h2 className="unit-section-title">Technology</h2>
        <div className="widget-breakdown">
          {STACK.map(s => <span className="chip" key={s}>{s}</span>)}
        </div>
      </div>

      <div className="unit-section">
        <p className="text-dim" style={{ fontSize: 12 }}>
          This is a solo-built 90-day MVP sprint intended to demonstrate a working vertical slice before any
          production commitment. Offline-first by design — every feature above works with zero network
          connectivity beyond the browser loading this page once.
        </p>
      </div>
    </div>
  );
}
