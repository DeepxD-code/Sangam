import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';

/**
 * Units Page  (Day 47)
 *
 * Command hierarchy tree — the landing page when a user drills down from
 * the dashboard's UNT widget. Renders the caller's scoped unit tree
 * (GET /api/units/hierarchy already filters to command scope server-side)
 * with expand/collapse and a click-through to UnitDetailPage for any node.
 */

const UNIT_TYPE_ORDER = [
  'SECTION', 'PLATOON', 'COMPANY', 'BATTALION',
  'BRIGADE', 'DIVISION', 'CORPS', 'COMMAND'
];

function flattenActive(node, out = { active: 0, inactive: 0, byType: {} }) {
  if (!node) return out;
  if (node.active) out.active++; else out.inactive++;
  out.byType[node.unitType] = (out.byType[node.unitType] || 0) + 1;
  (node.children || []).forEach(c => flattenActive(c, out));
  return out;
}

function TreeNode({ node, depth, expanded, toggle, onSelect }) {
  const hasChildren = node.children && node.children.length > 0;
  const isOpen = expanded.has(node.id);

  return (
    <>
      <div
        className={`unit-tree-row${!node.active ? ' unit-tree-row--inactive' : ''}`}
        style={{ paddingLeft: `${depth * 22 + 12}px` }}
      >
        <button
          className="unit-tree-toggle"
          onClick={() => hasChildren && toggle(node.id)}
          aria-label={hasChildren ? (isOpen ? 'Collapse' : 'Expand') : undefined}
          disabled={!hasChildren}
        >
          {hasChildren ? (isOpen ? '▾' : '▸') : '·'}
        </button>
        <button className="unit-tree-name" onClick={() => onSelect(node.id)}>
          <span className={`unit-type-badge unit-type-${node.unitType?.toLowerCase()}`}>
            {node.unitType}
          </span>
          <span className="unit-tree-label">{node.unitName}</span>
          <span className="unit-tree-code">[{node.unitCode}]</span>
          {!node.active && <span className="status-pill status-critical">INACTIVE</span>}
        </button>
        {hasChildren && (
          <span className="unit-tree-count">{node.children.length} SUBORDINATE{node.children.length !== 1 ? 'S' : ''}</span>
        )}
      </div>
      {hasChildren && isOpen && node.children
        .slice()
        .sort((a, b) => a.unitName.localeCompare(b.unitName))
        .map(child => (
          <TreeNode key={child.id} node={child} depth={depth + 1}
            expanded={expanded} toggle={toggle} onSelect={onSelect} />
        ))}
    </>
  );
}

export default function UnitsPage({ user }) {
  const navigate = useNavigate();
  const [tree,     setTree]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState(null);
  const [expanded, setExpanded] = useState(new Set());

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const result = await api.getUnitsHierarchy();
      const roots = result.tree || [];
      setTree(roots);
      // Auto-expand the top two levels so the tree isn't collapsed-to-nothing on first paint
      const initial = new Set();
      const seed = (nodes, depth) => nodes.forEach(n => {
        if (depth < 2) initial.add(n.id);
        seed(n.children || [], depth + 1);
      });
      seed(roots, 0);
      setExpanded(initial);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      setError(err.message || 'Failed to load unit hierarchy');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  function toggle(id) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const summary = useMemo(() => {
    const out = { active: 0, inactive: 0, byType: {} };
    tree.forEach(root => flattenActive(root, out));
    return out;
  }, [tree]);

  const total = summary.active + summary.inactive;

  if (user && user.rankLevel < 4) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <p className="state-error">Access denied — this view requires JCO rank or higher.</p>
          <button className="btn btn-ghost" onClick={() => navigate('/')}>← Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Command Units</h1>
          <span className="page-subtitle">{total} UNIT{total !== 1 ? 'S' : ''} IN SCOPE</span>
        </div>
        <button className="btn btn-sm" onClick={load} aria-label="Refresh unit hierarchy">↻ REFRESH</button>
      </div>

      {!loading && !error && total > 0 && (
        <div className="widget-breakdown" style={{ marginBottom: 'var(--sp-5)' }}>
          <span className="chip"><span className="status-good">{summary.active} ACTIVE</span></span>
          {summary.inactive > 0 && (
            <span className="chip"><span className="status-critical">{summary.inactive} INACTIVE</span></span>
          )}
          {UNIT_TYPE_ORDER.filter(t => summary.byType[t]).map(t => (
            <span className="chip" key={t}>{t} · {summary.byType[t]}</span>
          ))}
        </div>
      )}

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}><div className="spinner" /></div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : tree.length === 0 ? (
        <div className="table-empty">No units are visible within your command scope.</div>
      ) : (
        <div className="unit-tree">
          {tree
            .slice()
            .sort((a, b) => a.unitName.localeCompare(b.unitName))
            .map(root => (
              <TreeNode key={root.id} node={root} depth={0}
                expanded={expanded} toggle={toggle}
                onSelect={id => navigate(`/units/${id}`)} />
            ))}
        </div>
      )}
    </div>
  );
}
