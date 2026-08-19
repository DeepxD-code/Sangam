# SANGAM — Supply Chain Management for Army Logistics

*One-page overview — prepared as a leave-behind for stakeholder discussion.*

## What it is

SANGAM is a permissioned, blockchain-backed supply chain management
system built for Army logistics: tracking equipment and supplies as they
move between units, with every transfer cryptographically sealed and
every action attributed to a real person, in real time.

It is designed offline-first — the operational core runs without
requiring a live database connection, so it keeps working in
low-connectivity conditions rather than depending on one.

## What it does today

- **Command structure** — units, sub-units, and personnel modeled as an
  actual chain of command, not a flat list.
- **Supply tracking** — items, quantities, and low-stock thresholds per
  unit, with full history.
- **Transfers with proof** — a transfer request → approval sequence
  where every approval writes a blockchain block. The chain can be
  verified on demand: tamper with a record, and verification fails.
- **Chain of custody** — for any item, a complete, attributed history:
  who created it, who moved it, who approved each step, when.
- **Discrepancy detection** — an on-demand scan comparing each item's
  actual quantity against what the blockchain-derived history says it
  should be. A clean scan is a positive signal; a flagged one is an
  early warning.
- **Delegation & emergency override** — time-boxed handoff of a specific
  authority (e.g. transfer approval) to a named person for a defined
  window, and a separate, audited "break glass" path for genuine
  emergencies — both fully logged and reviewable.
- **Alerts** — automatic escalation for conditions like low stock or a
  stalled transfer, with an acknowledge → resolve workflow.
- **Reporting** — exportable records for stock levels, transfers, unit
  rosters, and audit history.
- **Role-based access** — nine distinct rank/role levels (Soldier
  through System Admin), each with a specific, deliberately-scoped set
  of permissions — not just "admin vs. everyone."

## What it doesn't do yet

This is an MVP, not a finished system. Known gaps, honestly stated:
mobile/tablet-optimized field use is untested at scale; true offline
mesh sync between physically separated units is modeled but not
field-proven; integration with any existing Army logistics system has
not been scoped. This is a foundation to evaluate and react to, not a
finished product to sign off on as-is.

## Why it's built this way

Every design choice trades off toward two things: **accountability**
(who did what, provably, not just "the database says so") and
**resilience** (works without depending on infrastructure that may not
be there). Those are the two properties that seemed to matter most for
this domain — everything else was built in service of them.

## Next step

This is a working demonstration, not a proposal for a specific
deployment. The useful next step is a conversation: does this match a
real gap, and if so, what would a genuinely useful pilot look like.

---
*Built as a solo engineering sprint. Technical detail, architecture
notes, and a live walkthrough available on request.*
