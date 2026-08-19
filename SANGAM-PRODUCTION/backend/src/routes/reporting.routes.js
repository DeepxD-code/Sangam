'use strict';

const express          = require('express');
const ReportingService = require('../services/reporting.service');
const AuditLogService  = require('../services/audit-log.service');
const AuthMiddleware   = require('../middleware/auth.middleware');

/**
 * SANGAM Reporting & Analytics Routes
 *
 * All endpoints aggregate across the requesting user's command scope
 * (their unit + every subordinate unit) via ReportingService.
 *
 *   GET /reports/dashboard          → all 6 reports, cached 5min  [reports:read]
 *   GET /reports/stock-levels       → [reports:read]
 *   GET /reports/transfers          → [reports:read]
 *   GET /reports/blockchain-health  → [reports:read]
 *   GET /reports/mesh-health        → [reports:read]
 *   GET /reports/security-posture   → [reports:advanced]
 *   GET /reports/unit-roster        → [reports:read]
 *   GET /reports/export/:type       → CSV download [reports:export]
 */
function createReportingRoutes(db, sharedAudit = null, sharedNotifications = null) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);
  const reports = new ReportingService(db, auth.rbac, sharedNotifications, audit);

  const EXPORTABLE = new Set([
    'stock-levels', 'transfers', 'unit-roster', 'mesh-health'
  ]);

  // ----------------------------------------------------------------
  // Dashboard summary (all reports, cached)
  // ----------------------------------------------------------------
  router.get('/dashboard',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const forceRefresh = req.query.refresh === 'true';
        const data = await reports.getDashboardSummary(req.user, { forceRefresh });
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Stock levels
  // ----------------------------------------------------------------
  router.get('/stock-levels',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const filters = {};
        if (req.query.category) filters.category = req.query.category;
        const data = await reports.getStockLevelReport(req.user, filters);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Transfer activity
  // ----------------------------------------------------------------
  router.get('/transfers',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const filters = {};
        if (req.query.startDate) filters.startDate = req.query.startDate;
        if (req.query.endDate)   filters.endDate   = req.query.endDate;
        const data = await reports.getTransferReport(req.user, filters);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Blockchain health
  // ----------------------------------------------------------------
  router.get('/blockchain-health',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const data = await reports.getBlockchainHealthReport();
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Mesh network health
  // ----------------------------------------------------------------
  router.get('/mesh-health',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const data = await reports.getMeshHealthReport(req.user);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Security posture — requires reports:advanced (Senior Officer+)
  // ----------------------------------------------------------------
  router.get('/security-posture',
    auth.authenticate(),
    auth.requirePermission('reports:advanced'),
    auth.auditRequest('REPORTS_SECURITY_POSTURE', 'reports'),
    async (req, res) => {
      try {
        const hours = req.query.hours ? parseInt(req.query.hours, 10) : undefined;
        const data = await reports.getSecurityPostureReport(req.user, hours);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Unit roster
  // ----------------------------------------------------------------
  router.get('/unit-roster',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const data = await reports.getUnitRosterReport(req.user);
        res.json({ success: true, ...data });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // CSV export
  // ----------------------------------------------------------------
  router.get('/export/:type',
    auth.authenticate(),
    auth.requirePermission('reports:export'),
    auth.auditRequest('REPORTS_EXPORT', 'reports'),
    async (req, res) => {
      const { type } = req.params;
      if (!EXPORTABLE.has(type)) {
        return res.status(400).json({
          success: false, error: 'UNSUPPORTED_EXPORT_TYPE',
          supported: Array.from(EXPORTABLE)
        });
      }

      try {
        let rows;
        switch (type) {
          case 'stock-levels': {
            const r = await reports.getStockLevelReport(req.user);
            rows = r.byUnit;
            break;
          }
          case 'transfers': {
            const r = await reports.getTransferReport(req.user, {
              startDate: req.query.startDate, endDate: req.query.endDate
            });
            rows = r.pending;
            break;
          }
          case 'unit-roster': {
            const r = await reports.getUnitRosterReport(req.user);
            rows = r.units;
            break;
          }
          case 'mesh-health': {
            const r = await reports.getMeshHealthReport(req.user);
            rows = r.peers;
            break;
          }
        }

        const csv = reports.exportReportToCSV(rows || []);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition',
          `attachment; filename="sangam-${type}-${Date.now()}.csv"`);
        res.send(csv);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // GET /reports/audit-log
  // Returns in-memory audit buffer (offline) or DB (online).
  // Restricted to SYSTEM_ADMIN (supply:admin) only.
  // ================================================================
  router.get('/audit-log',
    auth.authenticate(),
    // Day 71: was auth.requirePermission('system:admin') — AUDITOR's own
    // role description is "read-only across all data plus full audit log
    // access", and it has audit:read specifically for this, but not
    // system:admin. That meant the one role whose entire defined purpose
    // includes audit log access could not reach this endpoint at all.
    // audit:read is the correct, purpose-built permission — SYSTEM_ADMIN
    // has both, so this only adds access (to AUDITOR and anyone else
    // with audit:read), never removes it. See the Day 71 handoff notes.
    auth.requirePermission('audit:read'),
    async (req, res) => {
      try {
        const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
        const offset = parseInt(req.query.offset || '0', 10);
        const filters = {};
        if (req.query.action)   filters.action   = req.query.action;
        if (req.query.username) filters.username  = req.query.username;
        if (req.query.severity) filters.severity  = req.query.severity;
        if (req.query.success !== undefined) filters.success = req.query.success === 'true';

        // Try DB first
        if (audit.db) {
          try {
            const result = await audit.query({ ...filters, limit, offset });
            return res.json({ success: true, source: 'db', ...result });
          } catch { /* fall through to buffer */ }
        }

        // Fallback: return in-memory buffer (most-recent first, filtered)
        let entries = [...(audit._inMemoryBuffer || [])].reverse();
        if (filters.action)   entries = entries.filter(e => e.action   === filters.action);
        if (filters.username) entries = entries.filter(e => e.username === filters.username);
        if (filters.severity) entries = entries.filter(e => e.severity === filters.severity);
        if (filters.success !== undefined)
          entries = entries.filter(e => e.success === filters.success);

        const total = entries.length;
        entries = entries.slice(offset, offset + limit);

        res.json({ success: true, source: 'buffer', entries, total, limit, offset });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createReportingRoutes;
