# Day 20 — Compliance Reporting
## SANGAM Supply Chain Management System

---

## What Is Compliance Reporting?

In military logistics, a supply item does not simply exist — it has a **legal chain of custody**. Every transfer must be authorised, every approval documented, every discrepancy explained. When a court of inquiry investigates a missing rifle or a fuel shortage, the system must be able to answer:

- Who created this item record?
- Who transferred it, when, and under whose authority?
- Was every transfer approved by a qualified officer?
- Does the current quantity match what the blockchain ledger says?

**Compliance reporting** turns raw audit trails and blockchain records into legally meaningful documents. It is not analytics (that is Day 12's reporting service) — it is **traceability and accountability**.

---

## Five Report Types Built Today

### 1. Chain of Custody (`getChainOfCustody`)
The complete history of a single supply item: creation → quantity adjustments → transfers → deletions. Sourced from the audit log's action entries (`SUPPLY_CREATE`, `SUPPLY_UPDATE`, `SUPPLY_TRANSFER_*`). Output is chronologically ordered and includes the acting user, timestamp, and delta for each event.

### 2. Transfer Register (`getTransferRegister`)
A filtered list of all transfers within scope and date range, enriched with the requester and approver information. Used for monthly returns and end-of-quarter reconciliation. Exportable as CSV.

### 3. Discrepancy Report (`getDiscrepancyReport`)
Compares the **expected quantity** derived from blockchain blocks (sum of approved transfer outflows) against the **recorded quantity** in the item store. A delta ≠ 0 means either:
- A direct stock adjustment was made (legitimate if audited)
- The data was tampered with (CRITICAL security event)

### 4. Audit Export (`getAuditExport`)
Filtered dump of the audit log: by severity, action type, user, date range, or resource. The primary artefact for a court of inquiry. Supports CSV export with the AES-256-GCM fields decrypted for authorised exporters.

### 5. Compliance Summary (`getComplianceSummary`)
Dashboard metrics for a Senior Officer: transfer approval rate, pending transfer count, items below threshold, unacknowledged security alerts, audit entries in the last 24 hours, chain integrity status.

---

## Design Principles

**Source of Truth Hierarchy:**
```
Blockchain ledger  ← immutable, tamper-evident
    ↓ compared to
Audit log entries  ← tamper-evident hash chain
    ↓ compared to
Item store quantities ← mutable, last-write-wins
```
Any disagreement between levels is a **discrepancy requiring explanation**.

**Scope Enforcement:**
All compliance reports respect the same command scope as supply operations — a JCO cannot pull chain-of-custody reports for items in units outside their authority.

**Permissions Required:**
- `reports:read` — summary and register
- `reports:advanced` — chain of custody, discrepancy report
- `reports:export` — any CSV export
- `audit:export` — audit log export (Senior Officer+)

---

## Army Context

Under Army Ordnance regulations, a **Board of Officers** convened for shortage investigation requires:
1. The item's complete chain of custody
2. All transfer vouchers (DA-3161 equivalent) for the period
3. A signed statement from every custodian in the chain
4. Evidence the blockchain record was not tampered with

This service produces the digital equivalents of (1), (2), and (4) automatically.
