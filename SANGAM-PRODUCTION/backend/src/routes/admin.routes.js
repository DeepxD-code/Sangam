const express         = require('express');
const AuditLogService = require('../services/audit-log.service');
const AuthMiddleware  = require('../middleware/auth.middleware');

/**
 * SANGAM Admin Routes  (Day 63)
 *
 *   GET  /api/admin/snapshot  → export units + supply items  [system:admin]
 *   POST /api/admin/restore   → restore units + supply items [system:admin]
 *
 * Scope, deliberately limited and stated plainly: this covers Units and
 * Supply Items only — the two entities where a byte-for-byte state
 * replacement (exact ID preservation, direct Map replacement bypassing
 * normal create validation) is both safe and clearly correct.
 *
 * Explicitly OUT of scope for this snapshot tool:
 *   - Users: password hashes shouldn't be casually round-tripped through
 *     a JSON file, and createUser()'s validation path expects a
 *     plaintext password to hash, not a hash to restore directly.
 *   - Transfers / blockchain: these have real state machines (PENDING →
 *     APPROVED/REJECTED) and represent an actual audit trail, not
 *     simple CRUD data — naively replaying or replacing them risks
 *     corrupting the blockchain hash chain or duplicating notifications.
 *   - Notifications / audit log: historical event data, not state to
 *     restore.
 *
 * This is a genuine but intentionally narrow tool: "recover my command
 * structure and current stock levels after a restart," not a full
 * system time machine. SEED_DEMO_DATA=true (Day 59) remains the right
 * tool for "get back to a known demo state" specifically.
 */
function createAdminRoutes(db, sharedAudit = null, sharedUnits = null, sharedSupply = null) {
  const router = express.Router();
  const audit  = sharedAudit || new AuditLogService(db);
  const auth   = new AuthMiddleware(db, audit);

  router.get('/snapshot',
    auth.authenticate(),
    auth.requirePermission('system:admin'),
    auth.auditRequest('ADMIN_SNAPSHOT_EXPORT', 'admin'),
    (req, res) => {
      try {
        const units = sharedUnits?.exportSnapshot() || [];
        const items = sharedSupply?.exportItemsSnapshot() || [];
        res.json({
          success: true,
          exportedAt: new Date().toISOString(),
          unitCount: units.length,
          itemCount: items.length,
          units,
          items
        });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  router.post('/restore',
    auth.authenticate(),
    auth.requirePermission('system:admin'),
    auth.auditRequest('ADMIN_SNAPSHOT_RESTORE', 'admin'),
    (req, res) => {
      try {
        const { units, items } = req.body || {};
        if (!Array.isArray(units) && !Array.isArray(items)) {
          return res.status(400).json({
            success: false, error: 'INVALID_SNAPSHOT',
            message: 'Body must include a "units" array, an "items" array, or both'
          });
        }

        const result = { success: true, restoredAt: new Date().toISOString() };

        if (Array.isArray(units)) {
          const r = sharedUnits?.restoreSnapshot(units);
          if (!r?.success) {
            return res.status(400).json({ success: false, error: r?.error || 'RESTORE_FAILED', message: r?.message });
          }
          result.unitsRestored = r.count;
        }

        if (Array.isArray(items)) {
          const r = sharedSupply?.restoreItemsSnapshot(items);
          if (!r?.success) {
            return res.status(400).json({ success: false, error: r?.error || 'RESTORE_FAILED', message: r?.message });
          }
          result.itemsRestored = r.count;
        }

        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createAdminRoutes;
