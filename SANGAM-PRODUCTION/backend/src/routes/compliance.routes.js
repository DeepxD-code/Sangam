'use strict';

const express           = require('express');
const ComplianceService = require('../services/compliance.service');
const AuditLogService   = require('../services/audit-log.service');
const AuthMiddleware    = require('../middleware/auth.middleware');

/**
 * SANGAM Compliance Routes  (Day 20)
 *
 *   GET  /compliance/chain-of-custody/:itemId  → item custody history      [reports:advanced]
 *   GET  /compliance/transfer-register         → full transfer register     [reports:read]
 *   GET  /compliance/discrepancy-report        → quantity vs blockchain     [reports:advanced]
 *   GET  /compliance/audit-export              → filtered audit log export  [audit:export]
 *   GET  /compliance/summary                   → Senior Officer dashboard   [reports:advanced]
 *
 * CSV export variants (add ?format=csv to any report):
 *   GET  /compliance/chain-of-custody/:itemId?format=csv
 *   GET  /compliance/transfer-register?format=csv
 *   GET  /compliance/audit-export?format=csv
 */
function createComplianceRoutes(
  db,
  sharedAudit       = null,
  sharedSupply      = null,
  sharedNotifications = null
) {
  const router  = express.Router();
  const audit   = sharedAudit || new AuditLogService(db);
  const auth    = new AuthMiddleware(db, audit);

  // ComplianceService needs the supply chain service.
  // In normal app use sharedSupply is the same instance as in app.locals.
  const compliance = new ComplianceService(db, audit, sharedSupply, sharedNotifications);

  // Helper: resolve caller's command scope
  async function scopeFor(user) {
    // RBACService.getCommandScope returns { ids: number[], codes: string[] }
    // Routes need the plain ids array for .includes() checks.
    const scope = await auth.rbac.getCommandScope(user.unitId, db);
    return scope.ids;
  }

  // Helper: send CSV response
  function sendCSV(res, filename, rows, headers = null) {
    const csv = compliance.exportToCSV(rows, headers);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition',
      `attachment; filename="${filename}-${Date.now()}.csv"`);
    res.send(csv);
  }

  // ================================================================
  // 1. CHAIN OF CUSTODY
  // ================================================================

  router.get('/chain-of-custody/:itemId',
    auth.authenticate(),
    auth.requirePermission('reports:advanced'),
    auth.auditRequest('COMPLIANCE_CHAIN_OF_CUSTODY', 'compliance'),
    async (req, res) => {
      try {
        const scope  = await scopeFor(req.user);
        const result = await compliance.getChainOfCustody(req.params.itemId, scope);

        if (!result.success) {
          const statusMap = { ITEM_NOT_FOUND: 404, UNIT_OUT_OF_SCOPE: 403 };
          return res.status(statusMap[result.error] || 400).json(result);
        }

        if (req.query.format === 'csv') {
          return sendCSV(res, `chain-of-custody-item-${req.params.itemId}`,
            result.events, ['timestamp','action','actorId','resource','resourceId','success','severity']);
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // 2. TRANSFER REGISTER
  // ================================================================

  router.get('/transfer-register',
    auth.authenticate(),
    auth.requirePermission('reports:read'),
    async (req, res) => {
      try {
        const scope = await scopeFor(req.user);
        const filters = {};
        if (req.query.status)    filters.status    = req.query.status;
        if (req.query.startDate) filters.startDate = req.query.startDate;
        if (req.query.endDate)   filters.endDate   = req.query.endDate;
        if (req.query.itemId)    filters.itemId    = req.query.itemId;
        if (req.query.limit)     filters.limit     = parseInt(req.query.limit, 10);
        if (req.query.offset)    filters.offset    = parseInt(req.query.offset, 10);

        const result = compliance.getTransferRegister(scope, filters);

        if (req.query.format === 'csv') {
          return sendCSV(res, 'transfer-register', result.transfers, [
            'transferId','itemCode','itemName','fromUnitId','toUnitId',
            'quantity','status','requestedByUserId','approvedByUserId',
            'notes','createdAt','decidedAt','auditVerified'
          ]);
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // 3. DISCREPANCY REPORT
  // ================================================================

  router.get('/discrepancy-report',
    auth.authenticate(),
    auth.requirePermission('reports:advanced'),
    auth.auditRequest('COMPLIANCE_DISCREPANCY_REPORT', 'compliance'),
    async (req, res) => {
      try {
        const scope  = await scopeFor(req.user);
        const result = compliance.getDiscrepancyReport(scope);
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // 4. AUDIT EXPORT
  // ================================================================

  router.get('/audit-export',
    auth.authenticate(),
    auth.requirePermission('audit:export'),
    auth.auditRequest('COMPLIANCE_AUDIT_EXPORT', 'audit_logs'),
    async (req, res) => {
      try {
        const filters = {};
        if (req.query.severity)  filters.severity  = req.query.severity;
        if (req.query.action)    filters.action    = req.query.action;
        if (req.query.userId)    filters.userId    = req.query.userId;
        if (req.query.resource)  filters.resource  = req.query.resource;
        if (req.query.startDate) filters.startDate = req.query.startDate;
        if (req.query.endDate)   filters.endDate   = req.query.endDate;
        if (req.query.limit)     filters.limit     = parseInt(req.query.limit, 10);

        const result = compliance.getAuditExport(filters);

        if (req.query.format === 'csv') {
          return sendCSV(res, 'audit-export', result.entries, [
            'id','timestamp','userId','action','resource','resourceId',
            'success','severity','ipAddress','logHash'
          ]);
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ================================================================
  // 5. COMPLIANCE SUMMARY
  // ================================================================

  router.get('/summary',
    auth.authenticate(),
    auth.requirePermission('reports:advanced'),
    async (req, res) => {
      try {
        const scope  = await scopeFor(req.user);
        const result = compliance.getComplianceSummary(req.user, scope);
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createComplianceRoutes;
