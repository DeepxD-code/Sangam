'use strict';

const express            = require('express');
const NotificationService = require('../services/notification.service');
const AuditLogService     = require('../services/audit-log.service');
const AuthMiddleware      = require('../middleware/auth.middleware');

/**
 * SANGAM Notification Routes
 *
 * Endpoints:
 *   GET    /notifications                → list visible notifications
 *   GET    /notifications/unread-count   → badge count
 *   GET    /notifications/digest         → summary over a time window
 *   GET    /notifications/preferences    → per-type mute settings
 *   PUT    /notifications/preferences    → update a preference
 *   POST   /notifications/:id/read       → mark read
 *   POST   /notifications/:id/acknowledge→ mark acknowledged (audited)
 *   POST   /notifications/mark-all-read  → bulk mark read
 *   GET    /notifications/stream         → SSE real-time feed
 *   POST   /notifications                → manual/system creation [system:config]
 *
 * Notifications are immutable once created — no DELETE endpoint.
 * "Dismissing" a notification is modeled as acknowledge + read.
 */
function createNotificationRoutes(db, sharedAudit = null, sharedNotifications = null) {
  const router        = express.Router();
  const audit         = sharedAudit || new AuditLogService(db);
  const auth          = new AuthMiddleware(db, audit);
  const notifications = sharedNotifications || new NotificationService(db, auth.rbac, audit);

  // ----------------------------------------------------------------
  // List notifications for current user
  // ----------------------------------------------------------------
  router.get('/',
    auth.authenticate(),
    async (req, res) => {
      try {
        const filters = {
          unreadOnly: req.query.unreadOnly === 'true',
          type:       req.query.type,
          severity:   req.query.severity,
          limit:      req.query.limit  ? parseInt(req.query.limit, 10)  : 50,
          offset:     req.query.offset ? parseInt(req.query.offset, 10) : 0
        };
        const result = await notifications.getForUser(req.user, filters);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Unread count (for nav badge)
  // ----------------------------------------------------------------
  router.get('/unread-count',
    auth.authenticate(),
    async (req, res) => {
      try {
        const count = await notifications.getUnreadCount(req.user);
        res.json({ success: true, unreadCount: count });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Digest
  // ----------------------------------------------------------------
  router.get('/digest',
    auth.authenticate(),
    async (req, res) => {
      try {
        const hours  = req.query.hours ? parseInt(req.query.hours, 10) : 24;
        const digest = await notifications.getDailyDigest(req.user, hours);
        res.json({ success: true, ...digest });
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Preferences
  // ----------------------------------------------------------------
  router.get('/preferences',
    auth.authenticate(),
    async (req, res) => {
      const prefs = notifications.getPreferences(req.user.userId);
      res.json({ success: true, preferences: prefs });
    }
  );

  router.put('/preferences',
    auth.authenticate(),
    async (req, res) => {
      try {
        const { type, enabled } = req.body;
        if (!type || enabled === undefined) {
          return res.status(400).json({
            success: false, error: 'INVALID_REQUEST',
            message: 'Body must include { type, enabled }'
          });
        }
        const result = notifications.setPreference(req.user.userId, type, enabled);
        res.json({ success: true, ...result });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Mark read / acknowledge
  // ----------------------------------------------------------------
  router.post('/:id/read',
    auth.authenticate(),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const notification = notifications.getById(id);
        if (!notification) {
          return res.status(404).json({ success: false, error: 'NOTIFICATION_NOT_FOUND' });
        }
        if (!(await notifications.isVisibleTo(notification, req.user))) {
          return res.status(403).json({ success: false, error: 'NOT_VISIBLE' });
        }
        const result = notifications.markRead(id, req.user.userId);
        res.json(result);
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  router.post('/:id/acknowledge',
    auth.authenticate(),
    async (req, res) => {
      try {
        const id = parseInt(req.params.id, 10);
        const notification = notifications.getById(id);
        if (!notification) {
          return res.status(404).json({ success: false, error: 'NOTIFICATION_NOT_FOUND' });
        }
        if (!(await notifications.isVisibleTo(notification, req.user))) {
          return res.status(403).json({ success: false, error: 'NOT_VISIBLE' });
        }

        const result = notifications.acknowledge(id, req.user.userId);

        // Acknowledging a requires-ack alert is itself audit-worthy
        if (notification.requiresAck) {
          audit.log({
            userId:   req.user.userId,
            username: req.user.username,
            role:     req.user.role,
            unitCode: req.user.unitCode,
            action:   'NOTIFICATION_ACKNOWLEDGED',
            resource: 'notifications',
            resourceId: String(id),
            details:  { type: notification.type, severity: notification.severity },
            success:  true
          }).catch(err => console.error('[notification-routes] audit error:', err.message));
        }

        res.json(result);
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  router.post('/mark-all-read',
    auth.authenticate(),
    async (req, res) => {
      try {
        const result = await notifications.markAllRead(req.user);
        res.json(result);
      } catch (err) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  );

  // ----------------------------------------------------------------
  // Real-time stream (SSE)
  // ----------------------------------------------------------------
  router.get('/stream',
    auth.authenticate(),
    (req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      // Initial comment to open the stream promptly
      res.write(': connected\n\n');

      const send = (notification) => {
        res.write(`data: ${JSON.stringify(notification)}\n\n`);
      };

      const unsubscribe = notifications.subscribe(req.user, send);

      // Heartbeat keeps proxies/load balancers from closing idle connections
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }
  );

  // ----------------------------------------------------------------
  // Manual / system-triggered creation
  // ----------------------------------------------------------------
  router.post('/',
    auth.authenticate(),
    auth.requirePermission('system:config'),
    auth.auditRequest('NOTIFICATION_CREATE', 'notifications'),
    async (req, res) => {
      try {
        const notification = await notifications.create(req.body);
        res.status(201).json({ success: true, notification });
      } catch (err) {
        res.status(400).json({ success: false, error: err.message });
      }
    }
  );

  return router;
}

module.exports = createNotificationRoutes;
