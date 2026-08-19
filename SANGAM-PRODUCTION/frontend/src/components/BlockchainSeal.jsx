import React from 'react';

/**
 * The dashboard's one bespoke visual element: a seal/stamp motif for
 * blockchain ledger integrity. Everything else on the dashboard is a
 * quiet, disciplined data card — this is where the design spends its
 * one deliberate risk, because ledger integrity is SANGAM's actual
 * differentiator versus a conventional supply system.
 *
 * Day 31: accepts onClick → becomes a drill-down to BlockchainPage.
 */
export default function BlockchainSeal({ data, delay = 0, onClick }) {
  const style = { animationDelay: `${delay * 40}ms` };
  const interactive = typeof onClick === 'function' && data?.available;

  const interactiveProps = interactive ? {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    }
  } : {};

  if (!data?.available) {
    return (
      <div className="widget seal-widget" style={style}>
        <span className="widget-code">BLK</span>
        <p className="widget-unavailable">Ledger unavailable</p>
      </div>
    );
  }

  const tampered = !data.verified;

  return (
    <div
      className={`widget seal-widget${interactive ? ' widget-interactive' : ''}`}
      style={style}
      {...interactiveProps}
    >
      <span className="widget-code">BLK</span>
      <div className={`seal ${tampered ? 'tampered' : ''}`}>
        <span className="seal-text">{tampered ? 'TAMPER\nDETECT' : 'VERIFIED'}</span>
      </div>
      <div className="widget-sub">
        {data.blockCount} BLOCKS
        {data.tamperCount > 0 ? (
          <span className="status-critical"> · {data.tamperCount} FLAGGED</span>
        ) : null}
      </div>
      {interactive && <span className="widget-drill-hint">VIEW LEDGER →</span>}
    </div>
  );
}
