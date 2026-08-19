'use strict';

const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const fs      = require('fs');

// Services
const AuditLogService        = require('./services/audit-log.service');
const RBACService            = require('./services/rbac.service');
const NotificationService    = require('./services/notification.service');
const ReportingService       = require('./services/reporting.service');
const AuthService            = require('./services/auth.service');
const DelegationService      = require('./services/delegation.service');
const AuditHardeningService  = require('./services/audit-hardening.service');
const SupplyChainService     = require('./services/supply-chain.service');
const MovementOrderService   = require('./services/movement-order.service');
const UnitManagementService  = require('./services/unit-management.service');
const UserManagementService  = require('./services/user-management.service');
const InventoryLedgerService = require('./services/inventory-ledger.service');
const AlertEscalationService = require('./services/alert-escalation.service');

// Routes
const createHealthRoutes       = require('./routes/health.routes');
const createAdminRoutes        = require('./routes/admin.routes');
const createAuthRoutes         = require('./routes/auth.routes');
const createRBACRoutes         = require('./routes/rbac.routes');
const createNotificationRoutes = require('./routes/notification.routes');
const createReportingRoutes    = require('./routes/reporting.routes');
const createDelegationRoutes   = require('./routes/delegation.routes');
const createDocsRoutes         = require('./routes/docs.routes');
const createSupplyRoutes       = require('./routes/supply.routes');
const createComplianceRoutes   = require('./routes/compliance.routes');
const createBulkRoutes         = require('./routes/bulk.routes');
const createUnitRoutes         = require('./routes/unit.routes');
const createUserRoutes         = require('./routes/user.routes');
const createInventoryRoutes    = require('./routes/inventory.routes');
const createMovementRoutes     = require('./routes/movement.routes');
const createDashboardRoutes    = require('./routes/dashboard.routes');
const createAlertRoutes        = require('./routes/alert.routes');

/**
 * SANGAM Express App Factory
 *
 * Returns a fully-configured Express app, ready to listen.
 * Factory pattern allows injection of db/services for testing.
 *
 * @param {object} db            - pg Pool instance (required in production)
 * @param {object} [services]    - optional pre-constructed service overrides
 * @param {object} [options]     - { logLevel: 'dev'|'combined'|false }
 * @returns {express.Application}
 */
function createApp(db, services = {}, options = {}) {
  const app = express();

  // ============================================================
  // Shared services (constructed once, injected into routes)
  // ============================================================
  const audit = services.audit
    || new AuditLogService(db);

  const rbac = services.rbac
    || new RBACService(db);

  const notifications = services.notifications
    || new NotificationService(db, rbac, audit);

  const hardening = services.hardening
    || new AuditHardeningService(db, audit, notifications);

  const delegation = services.delegation
    || new DelegationService(db, rbac, notifications, audit);

  const supply = services.supply
    || new SupplyChainService(db, rbac, notifications, audit);

  const movement = services.movement
    || new MovementOrderService(db, audit, notifications);

  const units = services.units
    || new UnitManagementService(db, audit, rbac);

  // Day 66: register the live unit hierarchy so RBACService.getCommandScope()
  // can resolve real (non-self-only) scope in offline/in-memory mode — the
  // default mode this project runs and is demoed in. See rbac.service.js's
  // module-level comment for the full reasoning. Registered unconditionally
  // (whether `units` came from the default branch or a test override) so
  // behavior is consistent regardless of how the app was constructed.
  RBACService.setSharedUnitService(units);

  const userMgmt = services.users
    || new UserManagementService(db, audit, rbac);

  const inventory = services.inventory
    || new InventoryLedgerService(db, supply, audit, notifications);

  // Day 31: AlertEscalationService wired as shared singleton
  // so server.js poller and alert routes use the SAME instance.
  const alerts = services.alerts
    || new AlertEscalationService(
      { supply, inventory, movement, auditLog: audit },
      {},
      notifications
    );

  // Store shared services for lifecycle hooks (server.js)
  app.locals.services = {
    audit, rbac, notifications, hardening, delegation,
    supply, movement, units, users: userMgmt, inventory, alerts
  };
  app.locals.db = db;

  // ============================================================
  // Global middleware
  // ============================================================
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'"],
        imgSrc:     ["'self'", 'data:']
      }
    }
  }));

  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  const logFormat = options.logLevel || (process.env.NODE_ENV === 'production' ? 'combined' : 'dev');
  if (logFormat) app.use(morgan(logFormat));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  // ============================================================
  // Routes
  // ============================================================
  app.use('/health',             createHealthRoutes(db));
  app.use('/api/admin',          createAdminRoutes(db, audit, units, supply));
  app.use('/api/auth',           createAuthRoutes(db, audit));
  app.use('/api/rbac',           createRBACRoutes(db));
  app.use('/api/notifications',  createNotificationRoutes(db, audit, notifications));
  app.use('/api/reports',        createReportingRoutes(db, audit, notifications));
  app.use('/api/delegation',     createDelegationRoutes(db, audit, notifications));
  app.use('/api/docs',           createDocsRoutes());
  app.use('/api/supply',         createSupplyRoutes(db, audit, notifications, supply));
  app.use('/api/compliance',     createComplianceRoutes(db, audit, supply, notifications));
  app.use('/api/bulk',           createBulkRoutes(db, audit, supply));
  app.use('/api/units',          createUnitRoutes(db, audit, units));
  app.use('/api/users',          createUserRoutes(db, audit, userMgmt));
  app.use('/api/inventory',      createInventoryRoutes(db, audit, supply, inventory));
  app.use('/api/movement',       createMovementRoutes(db, audit, movement));

  // Day 31: pass alerts singleton to dashboard so it can include alert counts
  // services.dashboard (optional) lets tests inject a pre-built DashboardService
  app.use('/api/dashboard',      createDashboardRoutes(db, audit, {
    supply, units, users: userMgmt, inventory, movement, alerts,
    dashboard: services.dashboard
  }));

  // Day 31: pass the shared singleton — routes no longer create a private instance
  app.use('/api/alerts',         createAlertRoutes(db, audit, {
    supply, inventory, movement, notifications,
    alertService: alerts
  }));

  // ============================================================
  // Static frontend (Day 28)
  // ============================================================
  const frontendDist  = path.join(__dirname, '..', '..', 'frontend', 'dist');
  const frontendIndex = path.join(frontendDist, 'index.html');

  if (fs.existsSync(frontendIndex)) {
    app.use(express.static(frontendDist));

    // SPA fallback: GET requests that aren't /api/* → index.html
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(frontendIndex);
    });
  }

  // ============================================================
  // 404 fallback
  // ============================================================
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error:   'NOT_FOUND',
      path:    req.path
    });
  });

  // ============================================================
  // Error handler
  // ============================================================
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    const message = process.env.NODE_ENV === 'production'
      ? 'An internal error occurred'
      : err.message;

    if (audit && status >= 500) {
      audit.log({
        action: 'SERVER_ERROR', resource: req.path,
        details: { method: req.method, status, error: err.message },
        success: false, severity: 'CRITICAL'
      }).catch(err => console.error('[app] serverError audit error:', err.message));
    }

    res.status(status).json({ success: false, error: message });
  });

  return app;
}

module.exports = createApp;
