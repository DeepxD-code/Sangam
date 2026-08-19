/**
 * Demo Walkthrough Steps  (Day 50)
 *
 * Each step optionally navigates to a route and optionally highlights one
 * element (via a CSS selector matching a data-tour attribute already
 * placed in the relevant page). Steps without a target render as a
 * centered panel — used for the intro/outro and any page-level step
 * where no single element is the focus.
 *
 * This list is intentionally the "vertical slice" story in order: command
 * structure → supply → transfers/blockchain proof → alerts → reporting.
 * Keep it short enough for a live walkthrough (under ten steps).
 */

export const TOUR_STEPS = [
  {
    path: '/',
    target: null,
    title: 'Welcome to SANGAM',
    body: 'This short walkthrough covers the core vertical slice: command structure, supply, blockchain-backed transfers, alerting, and reporting. Use Next to move through each stop, or Exit at any time.',
  },
  {
    path: '/',
    target: '[data-tour="widget-units"]',
    title: 'Command Structure',
    body: 'Every unit in the hierarchy is tracked here — active/inactive counts by echelon. Click through to see personnel, supply holdings, and active movements for any single unit.',
  },
  {
    path: '/supply/items',
    target: '[data-tour="items-table"]',
    title: 'Supply Items',
    body: 'Items are scoped to the viewer\'s command — stock levels, categories, and low-stock flags are all live, not a static report.',
  },
  {
    path: '/supply/transfers',
    target: '[data-tour="transfers-list"]',
    title: 'Transfers',
    body: 'Every transfer request runs through an approval workflow. Once approved, it is written to the append-only blockchain ledger — click any transfer for its full timeline and blockchain proof.',
  },
  {
    path: '/supply/blockchain',
    target: '[data-tour="verify-chain-btn"]',
    title: 'Blockchain Ledger',
    body: 'This button re-hashes every block and confirms the chain has not been tampered with. Click any block below to expand its full transaction data.',
  },
  {
    path: '/alerts',
    target: '[data-tour="scan-alerts-btn"]',
    title: 'Alert Monitor',
    body: 'Low stock, stale transfers, and other violations are detected automatically and escalate if left unacknowledged. Click an alert for its full escalation history.',
  },
  {
    path: '/reports',
    target: '[data-tour="reports-grid"]',
    title: 'Reporting',
    body: 'Stock levels, transfers, unit rosters, and mesh health can all be exported to CSV for offline briefings — no network connection required.',
  },
  {
    path: '/reports',
    target: null,
    title: 'That\'s the vertical slice',
    body: 'Command structure, supply, blockchain-verified transfers, alerting, and reporting — all offline-first. Exit the tour to explore freely.',
  },
];
