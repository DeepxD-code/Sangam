import React from 'react';

/**
 * Generic SITREP-style stat card. Every dashboard section (units,
 * personnel, supply, transfers, movement, stock-take) renders through
 * this one component so the visual language stays consistent —
 * the only bespoke widget is BlockchainSeal (the signature element).
 *
 * @param {string}   code        - 3-letter section code, e.g. "UNT"
 * @param {string}   headline    - the big number
 * @param {string}   unit        - optional small label after the headline
 * @param {string}   subline     - secondary status line (can include JSX)
 * @param {object}   breakdown   - optional { label: count } map rendered as chips
 * @param {boolean}  available   - if false, renders the "data unavailable" state
 * @param {number}   delay       - stagger index for the entrance animation
 * @param {function} onClick     - if provided, the card becomes an interactive
 *                                 drill-down trigger (keyboard accessible)
 */
export default function Widget({
  code, headline, unit, subline, breakdown, available = true, delay = 0, onClick
}) {
  const style = { animationDelay: `${delay * 40}ms` };
  const interactive = typeof onClick === 'function' && available;

  const interactiveProps = interactive ? {
    role: 'button',
    tabIndex: 0,
    onClick,
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
    }
  } : {};

  if (!available) {
    return (
      <div className="widget" style={style}>
        <span className="widget-code">{code}</span>
        <p className="widget-unavailable">Data source unavailable</p>
      </div>
    );
  }

  return (
    <div
      className={`widget${interactive ? ' widget-interactive' : ''}`}
      style={style}
      {...interactiveProps}
    >
      <span className="widget-code">{code}</span>
      <p className="widget-headline">
        {headline}
        {unit ? <span className="unit">{unit}</span> : null}
      </p>
      {subline ? <div className="widget-sub">{subline}</div> : null}
      {breakdown && Object.keys(breakdown).length > 0 ? (
        <div className="widget-breakdown">
          {Object.entries(breakdown).map(([label, count]) => (
            <span className="chip" key={label}>{label} · {count}</span>
          ))}
        </div>
      ) : null}
      {interactive ? <span className="widget-drill-hint">VIEW →</span> : null}
    </div>
  );
}
