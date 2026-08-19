'use strict';

/**
 * SANGAM OpenAPI 3.0 Specification Generator
 *
 * Builds a complete, hand-accurate OpenAPI 3.0.3 spec for all SANGAM
 * endpoints across Days 11–17. Rather than using Express route introspection
 * (which gives paths but not schemas), this generator hardcodes accurate
 * schemas derived directly from the service implementations.
 *
 * The output is both machine-readable (openapi.json for integrators) and
 * human-browsable (Swagger UI served at GET /api/docs).
 *
 * Usage:
 *   node backend/scripts/generate-openapi.js
 *   → writes docs/openapi.json
 */

const fs   = require('fs');
const path = require('path');

const OUT_PATH = path.join(__dirname, '../../docs/openapi.json');

// ============================================================
// REUSABLE SCHEMA COMPONENTS
// ============================================================

const components = {
  securitySchemes: {
    BearerAuth: {
      type:   'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT access token obtained from POST /api/auth/login (Day 14). Expires after 8h.'
    }
  },

  schemas: {
    // ---- Common ----
    Success: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true }
      }
    },

    Error: {
      type: 'object',
      required: ['success', 'error'],
      properties: {
        success: { type: 'boolean', example: false },
        error:   { type: 'string', example: 'INVALID_REQUEST' },
        message: { type: 'string', example: 'A descriptive error message' }
      }
    },

    // ---- Auth ----
    LoginRequest: {
      type: 'object',
      required: ['username', 'password'],
      properties: {
        username: { type: 'string', example: 'jco_ram' },
        password: { type: 'string', format: 'password', example: 'Str0ngPass!' }
      }
    },

    LoginResponse: {
      type: 'object',
      properties: {
        success:          { type: 'boolean', example: true },
        accessToken:      { type: 'string', description: 'JWT (8h lifetime)' },
        refreshToken:     { type: 'string', description: 'Opaque 128-char hex (30d lifetime)' },
        refreshExpiresAt: { type: 'string', format: 'date-time' },
        user: {
          type: 'object',
          properties: {
            id:          { type: 'integer' },
            username:    { type: 'string' },
            displayName: { type: 'string' },
            role:        { $ref: '#/components/schemas/RoleName' },
            unitId:      { type: 'integer' },
            unitCode:    { type: 'string' }
          }
        }
      }
    },

    // ---- RBAC ----
    RoleName: {
      type: 'string',
      enum: ['SOLDIER','NCO','JCO','LOGISTICS_OFFICER','OFFICER',
             'SENIOR_OFFICER','COMMANDER','AUDITOR','SYSTEM_ADMIN'],
      description: 'Indian Army rank-mapped role (Day 13)'
    },

    Permission: {
      type: 'string',
      pattern: '^[a-z]+:[a-z_]+$',
      example: 'supply:approve',
      description: 'resource:action permission string'
    },

    Role: {
      type: 'object',
      properties: {
        name:            { $ref: '#/components/schemas/RoleName' },
        displayName:     { type: 'string' },
        rankLevel:       { type: 'integer', minimum: 1, maximum: 10 },
        description:     { type: 'string' },
        permissionCount: { type: 'integer' },
        permissions:     { type: 'array', items: { $ref: '#/components/schemas/Permission' } }
      }
    },

    // ---- Notifications ----
    NotificationType: {
      type: 'string',
      enum: ['LOW_STOCK','TRANSFER_PENDING','TRANSFER_APPROVED','TRANSFER_REJECTED',
             'MESH_PEER_OFFLINE','MESH_PEER_ONLINE','SYNC_CONFLICT',
             'SECURITY_ALERT','BLOCKCHAIN_TAMPER','SYSTEM_ANNOUNCEMENT',
             'DELEGATION_GRANTED']
    },

    Severity: {
      type: 'string',
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
    },

    Notification: {
      type: 'object',
      properties: {
        id:           { type: 'integer' },
        type:         { $ref: '#/components/schemas/NotificationType' },
        severity:     { $ref: '#/components/schemas/Severity' },
        title:        { type: 'string' },
        message:      { type: 'string' },
        sourceUnitId: { type: 'integer', nullable: true },
        minRankLevel: { type: 'integer' },
        targetUserId: { type: 'integer', nullable: true },
        resourceType: { type: 'string', nullable: true },
        resourceId:   { type: ['integer', 'string'], nullable: true },
        requiresAck:  { type: 'boolean' },
        createdAt:    { type: 'string', format: 'date-time' },
        expiresAt:    { type: 'string', format: 'date-time', nullable: true },
        read:         { type: 'boolean', description: 'Per-user read status' },
        acknowledged: { type: 'boolean', description: 'Per-user acknowledge status' }
      }
    },

    // ---- Delegation ----
    Delegation: {
      type: 'object',
      properties: {
        id:               { type: 'integer' },
        delegatorUserId:  { type: 'integer' },
        delegateUserId:   { type: 'integer' },
        permission:       { $ref: '#/components/schemas/Permission' },
        unitId:           { type: 'integer' },
        reason:           { type: 'string' },
        createdAt:        { type: 'string', format: 'date-time' },
        expiresAt:        { type: 'string', format: 'date-time' },
        revokedAt:        { type: 'string', format: 'date-time', nullable: true },
        revokedBy:        { type: 'integer', nullable: true },
        revocationReason: { type: 'string', nullable: true }
      }
    },

    Override: {
      type: 'object',
      properties: {
        id:               { type: 'integer' },
        userId:           { type: 'integer' },
        permission:       { $ref: '#/components/schemas/Permission' },
        attemptedUnitId:  { type: 'integer', nullable: true },
        justification:    { type: 'string' },
        createdAt:        { type: 'string', format: 'date-time' },
        expiresAt:        { type: 'string', format: 'date-time' },
        usedAt:           { type: 'string', format: 'date-time', nullable: true },
        reviewedAt:       { type: 'string', format: 'date-time', nullable: true },
        reviewedBy:       { type: 'integer', nullable: true }
      }
    },

    // ---- Health ----
    HealthResponse: {
      type: 'object',
      properties: {
        status:  { type: 'string', enum: ['ok', 'degraded'] },
        version: { type: 'string', example: '1.0.0' },
        nodeEnv: { type: 'string', example: 'production' },
        uptime:  { type: 'integer', description: 'Process uptime in seconds' },
        db: {
          type: 'object',
          properties: {
            connected:  { type: 'boolean' },
            latencyMs:  { type: 'integer', nullable: true }
          }
        }
      }
    }
  },

  responses: {
    Unauthorized: {
      description: 'Missing or invalid JWT',
      content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } }
    },
    Forbidden: {
      description: 'Insufficient permissions or outside command scope',
      content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } }
    },
    NotFound: {
      description: 'Resource not found',
      content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } }
    },
    BadRequest: {
      description: 'Invalid request body or parameters',
      content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } }
    }
  }
};

// ============================================================
// HELPER BUILDERS
// ============================================================

const bearer = [{ BearerAuth: [] }];

function jsonResponse(description, schemaRef, extra = {}) {
  return {
    description,
    content: { 'application/json': { schema: { '$ref': `#/components/schemas/${schemaRef}` } } },
    ...extra
  };
}

function stdErrors(...codes) {
  const map = {
    400: { '$ref': '#/components/responses/BadRequest' },
    401: { '$ref': '#/components/responses/Unauthorized' },
    403: { '$ref': '#/components/responses/Forbidden' },
    404: { '$ref': '#/components/responses/NotFound' }
  };
  return Object.fromEntries(codes.map(c => [c, map[c]]));
}

// ============================================================
// PATHS
// ============================================================

const paths = {

  // ── Health ──────────────────────────────────────────────────
  '/health': {
    get: {
      tags: ['System'],
      summary: 'Health check',
      description: 'Returns system status and DB latency. Used by Docker HEALTHCHECK and load balancers. No authentication required.',
      operationId: 'getHealth',
      responses: {
        200: jsonResponse('System healthy', 'HealthResponse'),
        503: { description: 'Database unreachable', content: { 'application/json': { schema: { '$ref': '#/components/schemas/HealthResponse' } } } }
      }
    }
  },

  // ── Auth ─────────────────────────────────────────────────────
  '/api/auth/login': {
    post: {
      tags: ['Authentication'],
      summary: 'Login',
      description: 'Authenticate with username/password. Returns JWT access token (8h) and refresh token (30d). Rate-limited: 10 attempts per IP per 5 minutes.',
      operationId: 'login',
      requestBody: { required: true, content: { 'application/json': { schema: { '$ref': '#/components/schemas/LoginRequest' } } } },
      responses: {
        200: jsonResponse('Login successful', 'LoginResponse'),
        401: { description: 'Invalid credentials', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        423: { description: 'Account locked (5 consecutive failures)', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } },
        429: { description: 'Rate limit exceeded', content: { 'application/json': { schema: { '$ref': '#/components/schemas/Error' } } } }
      }
    }
  },

  '/api/auth/refresh': {
    post: {
      tags: ['Authentication'],
      summary: 'Rotate refresh token',
      description: 'Exchange a refresh token for a new access+refresh pair (single-use rotation). Presenting a revoked token triggers a security event and revokes all sessions.',
      operationId: 'refreshToken',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
      responses: {
        200: jsonResponse('Tokens rotated', 'LoginResponse'),
        ...stdErrors(400, 401)
      }
    }
  },

  '/api/auth/logout': {
    post: {
      tags: ['Authentication'],
      summary: 'Logout (single session)',
      description: 'Revoke a specific refresh token.',
      operationId: 'logout',
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['refreshToken'], properties: { refreshToken: { type: 'string' } } } } } },
      responses: { 200: jsonResponse('Logged out', 'Success') }
    }
  },

  '/api/auth/logout-all': {
    post: {
      tags: ['Authentication'],
      summary: 'Logout (all sessions)',
      description: 'Revoke all refresh tokens for the authenticated user.',
      operationId: 'logoutAll',
      security: bearer,
      responses: {
        200: jsonResponse('All sessions revoked', 'Success'),
        ...stdErrors(401)
      }
    }
  },

  '/api/auth/change-password': {
    post: {
      tags: ['Authentication'],
      summary: 'Change password',
      description: 'Change password. Requires current password. On success, all sessions are revoked (force re-login everywhere).',
      operationId: 'changePassword',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['oldPassword','newPassword'], properties: { oldPassword: { type: 'string' }, newPassword: { type: 'string', description: 'Min 8 chars, 1 uppercase, 1 lowercase, 1 digit' } } } } } },
      responses: {
        200: jsonResponse('Password changed', 'Success'),
        ...stdErrors(400, 401)
      }
    }
  },

  '/api/auth/unlock/{userId}': {
    post: {
      tags: ['Authentication'],
      summary: 'Admin unlock account',
      description: 'Clear account lockout for a user. Requires users:write permission.',
      operationId: 'unlockAccount',
      security: bearer,
      parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        200: jsonResponse('Account unlocked', 'Success'),
        ...stdErrors(401, 403, 404)
      }
    }
  },

  '/api/auth/me': {
    get: {
      tags: ['Authentication'],
      summary: 'Current user identity',
      description: 'Return the identity and role of the authenticated user.',
      operationId: 'getMe',
      security: bearer,
      responses: {
        200: {
          description: 'Current user',
          content: { 'application/json': { schema: { type: 'object', properties: {
            success: { type: 'boolean' },
            user: { type: 'object', properties: {
              id:          { type: 'integer' },
              username:    { type: 'string' },
              displayName: { type: 'string' },
              role:        { '$ref': '#/components/schemas/RoleName' },
              rankLevel:   { type: 'integer' },
              unitId:      { type: 'integer' },
              unitCode:    { type: 'string' }
            }}
          }}}}
        },
        ...stdErrors(401)
      }
    }
  },

  // ── RBAC ─────────────────────────────────────────────────────
  '/api/rbac/roles': {
    get: {
      tags: ['RBAC'],
      summary: 'List all army roles',
      description: 'Returns all 9 rank-mapped roles with their permission counts. Requires users:read.',
      operationId: 'listRoles',
      security: bearer,
      responses: {
        200: { description: 'Role list', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, roles: { type: 'array', items: { '$ref': '#/components/schemas/Role' } } } } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/rbac/my-permissions': {
    get: {
      tags: ['RBAC'],
      summary: 'Current user permissions',
      description: 'Full permission context for the authenticated user — role info, unit scope, and complete permission list.',
      operationId: 'getMyPermissions',
      security: bearer,
      responses: {
        200: { description: 'Permission context', content: { 'application/json': { schema: { type: 'object' } } } },
        ...stdErrors(401)
      }
    }
  },

  '/api/rbac/check/{permission}': {
    get: {
      tags: ['RBAC'],
      summary: 'Permission probe',
      description: 'Check whether the current user holds a specific permission. Used by UIs to conditionally show/hide controls.',
      operationId: 'checkPermission',
      security: bearer,
      parameters: [{ name: 'permission', in: 'path', required: true, schema: { '$ref': '#/components/schemas/Permission' }, example: 'supply:approve' }],
      responses: {
        200: { description: 'Permission check result', content: { 'application/json': { schema: { type: 'object', properties: { permission: { type: 'string' }, granted: { type: 'boolean' }, role: { '$ref': '#/components/schemas/RoleName' } } } } } },
        ...stdErrors(401)
      }
    }
  },

  '/api/rbac/audit-logs': {
    get: {
      tags: ['Audit'],
      summary: 'Query audit logs',
      description: 'Filter and paginate the tamper-evident audit trail. Requires audit:read (SENIOR_OFFICER+).',
      operationId: 'queryAuditLogs',
      security: bearer,
      parameters: [
        { name: 'action',    in: 'query', schema: { type: 'string' } },
        { name: 'userId',    in: 'query', schema: { type: 'integer' } },
        { name: 'severity',  in: 'query', schema: { type: 'string', enum: ['INFO','WARNING','CRITICAL','SECURITY'] } },
        { name: 'success',   in: 'query', schema: { type: 'boolean' } },
        { name: 'startTime', in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'endTime',   in: 'query', schema: { type: 'string', format: 'date-time' } },
        { name: 'limit',     in: 'query', schema: { type: 'integer', default: 100, maximum: 1000 } },
        { name: 'offset',    in: 'query', schema: { type: 'integer', default: 0 } }
      ],
      responses: {
        200: { description: 'Audit log entries', content: { 'application/json': { schema: { type: 'object', properties: { entries: { type: 'array', items: { type: 'object' } }, total: { type: 'integer' }, limit: { type: 'integer' }, offset: { type: 'integer' } } } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/rbac/audit-logs/security': {
    get: {
      tags: ['Audit'],
      summary: 'Security events',
      description: 'Returns SECURITY and CRITICAL severity audit events in the last N hours. Requires audit:read.',
      operationId: 'getSecurityEvents',
      security: bearer,
      parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }],
      responses: {
        200: { description: 'Security events', content: { 'application/json': { schema: { type: 'object' } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/rbac/audit-logs/verify-integrity': {
    post: {
      tags: ['Audit'],
      summary: 'Verify audit hash chain',
      description: 'Run an on-demand integrity check of the SHA-256 hash chain. Returns any tampered entries. Requires audit:read.',
      operationId: 'verifyAuditIntegrity',
      security: bearer,
      responses: {
        200: { description: 'Integrity result', content: { 'application/json': { schema: { type: 'object', properties: { verified: { type: 'boolean' }, entriesChecked: { type: 'integer' }, tamperedEntries: { type: 'array', items: { type: 'object' } }, message: { type: 'string' } } } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  // ── Notifications ─────────────────────────────────────────────
  '/api/notifications': {
    get: {
      tags: ['Notifications'],
      summary: 'List visible notifications',
      description: 'Returns notifications visible to the current user based on rank and command scope. Filters available: unreadOnly, type, severity.',
      operationId: 'listNotifications',
      security: bearer,
      parameters: [
        { name: 'unreadOnly', in: 'query', schema: { type: 'boolean' } },
        { name: 'type',       in: 'query', schema: { '$ref': '#/components/schemas/NotificationType' } },
        { name: 'severity',   in: 'query', schema: { '$ref': '#/components/schemas/Severity' } },
        { name: 'limit',      in: 'query', schema: { type: 'integer', default: 50 } },
        { name: 'offset',     in: 'query', schema: { type: 'integer', default: 0 } }
      ],
      responses: {
        200: { description: 'Notification list', content: { 'application/json': { schema: { type: 'object', properties: { notifications: { type: 'array', items: { '$ref': '#/components/schemas/Notification' } }, total: { type: 'integer' }, unreadTotal: { type: 'integer' } } } } } },
        ...stdErrors(401)
      }
    }
  },

  '/api/notifications/unread-count': {
    get: {
      tags: ['Notifications'],
      summary: 'Unread notification count',
      description: 'Returns the unread count for the notification badge.',
      operationId: 'getUnreadCount',
      security: bearer,
      responses: {
        200: { description: 'Unread count', content: { 'application/json': { schema: { type: 'object', properties: { unreadCount: { type: 'integer' } } } } } },
        ...stdErrors(401)
      }
    }
  },

  '/api/notifications/digest': {
    get: {
      tags: ['Notifications'],
      summary: 'Daily digest',
      description: 'Summary of notifications in a time window — counts by type/severity and pending acknowledgments.',
      operationId: 'getDigest',
      security: bearer,
      parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }],
      responses: {
        200: { description: 'Digest', content: { 'application/json': { schema: { type: 'object' } } } },
        ...stdErrors(401)
      }
    }
  },

  '/api/notifications/stream': {
    get: {
      tags: ['Notifications'],
      summary: 'Real-time notification stream (SSE)',
      description: 'Server-Sent Events stream delivering notifications in real time. Connect with EventSource and include a JWT token as query param `?token=...`.',
      operationId: 'streamNotifications',
      security: bearer,
      responses: {
        200: { description: 'text/event-stream — notifications as JSON data events', content: { 'text/event-stream': { schema: { type: 'string' } } } },
        ...stdErrors(401)
      }
    }
  },

  '/api/notifications/{id}/acknowledge': {
    post: {
      tags: ['Notifications'],
      summary: 'Acknowledge a notification',
      description: 'Mark a notification as acknowledged (implies read). For requiresAck notifications, this is an auditable action.',
      operationId: 'acknowledgeNotification',
      security: bearer,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        200: jsonResponse('Acknowledged', 'Success'),
        ...stdErrors(401, 403, 404)
      }
    }
  },

  // ── Reports ──────────────────────────────────────────────────
  '/api/reports/dashboard': {
    get: {
      tags: ['Reports'],
      summary: 'Command dashboard (all reports)',
      description: 'Runs all 6 report types for the current user\'s command scope in parallel. Cached 5 minutes per user. Add ?refresh=true to bypass cache. Requires reports:read.',
      operationId: 'getDashboard',
      security: bearer,
      parameters: [{ name: 'refresh', in: 'query', schema: { type: 'boolean' } }],
      responses: {
        200: { description: 'Dashboard payload — stock, transfers, blockchain, mesh, security, roster', content: { 'application/json': { schema: { type: 'object' } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/reports/stock-levels': {
    get: {
      tags: ['Reports'],
      summary: 'Stock level report',
      description: 'Per-unit/category inventory totals and low-stock items across the user\'s command scope. Requires reports:read.',
      operationId: 'getStockLevels',
      security: bearer,
      parameters: [{ name: 'category', in: 'query', schema: { type: 'string' } }],
      responses: {
        200: { description: 'Stock report', content: { 'application/json': { schema: { type: 'object' } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/reports/security-posture': {
    get: {
      tags: ['Reports'],
      summary: 'Security posture report',
      description: 'Combines Day 13 audit event counts (SECURITY/CRITICAL) with Day 11 pending acknowledgments. Requires reports:advanced (SENIOR_OFFICER+).',
      operationId: 'getSecurityPosture',
      security: bearer,
      parameters: [{ name: 'hours', in: 'query', schema: { type: 'integer', default: 24 } }],
      responses: {
        200: { description: 'Security posture', content: { 'application/json': { schema: { type: 'object' } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/reports/export/{type}': {
    get: {
      tags: ['Reports'],
      summary: 'Export report as CSV',
      description: 'Download a report as CSV. Supported types: stock-levels, transfers, unit-roster, mesh-health. Requires reports:export.',
      operationId: 'exportReport',
      security: bearer,
      parameters: [
        { name: 'type', in: 'path', required: true, schema: { type: 'string', enum: ['stock-levels', 'transfers', 'unit-roster', 'mesh-health'] } }
      ],
      responses: {
        200: { description: 'CSV file', content: { 'text/csv': { schema: { type: 'string' } } } },
        ...stdErrors(400, 401, 403)
      }
    }
  },

  // ── Delegation ───────────────────────────────────────────────
  '/api/delegation': {
    post: {
      tags: ['Delegation'],
      summary: 'Create delegation',
      description: 'Temporarily delegate a permission you hold to another user for a specific unit\'s command scope. Duration 1–168 hours. A DELEGATION_GRANTED notification is sent to the delegate.',
      operationId: 'createDelegation',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['delegateUserId','permission','unitId','durationHours','reason'], properties: { delegateUserId: { type: 'integer' }, permission: { '$ref': '#/components/schemas/Permission' }, unitId: { type: 'integer' }, durationHours: { type: 'number', minimum: 1, maximum: 168 }, reason: { type: 'string', minLength: 5 } } } } } },
      responses: {
        201: { description: 'Delegation created', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, delegation: { '$ref': '#/components/schemas/Delegation' } } } } } },
        ...stdErrors(400, 401)
      }
    }
  },

  '/api/delegation/overrides': {
    post: {
      tags: ['Delegation'],
      summary: 'Issue emergency override',
      description: 'Self-issue a single-use permission override with a mandatory written justification. Immediately logged as SECURITY severity. Sits in the review queue until a Senior Officer signs off.',
      operationId: 'createOverride',
      security: bearer,
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['permission','justification'], properties: { permission: { '$ref': '#/components/schemas/Permission' }, attemptedUnitId: { type: 'integer' }, justification: { type: 'string', minLength: 10 }, durationMinutes: { type: 'integer', minimum: 1, maximum: 120 } } } } } },
      responses: {
        201: { description: 'Override issued (expires after 30min by default)', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, override: { '$ref': '#/components/schemas/Override' } } } } } },
        ...stdErrors(400, 401)
      }
    }
  },

  '/api/delegation/overrides/pending-review': {
    get: {
      tags: ['Delegation'],
      summary: 'Override review queue',
      description: 'All unreviewed overrides, oldest first, with overdue count. Requires audit:read (SENIOR_OFFICER+).',
      operationId: 'getPendingReviews',
      security: bearer,
      responses: {
        200: { description: 'Review queue', content: { 'application/json': { schema: { type: 'object', properties: { overrides: { type: 'array', items: { '$ref': '#/components/schemas/Override' } }, overdueCount: { type: 'integer' } } } } } },
        ...stdErrors(401, 403)
      }
    }
  },

  '/api/delegation/overrides/{id}/review': {
    post: {
      tags: ['Delegation'],
      summary: 'Review an override',
      description: 'Senior Officer sign-off on an issued override. Clears it from the review queue and audits the action. Idempotent — already-reviewed returns ALREADY_REVIEWED. Requires audit:read.',
      operationId: 'reviewOverride',
      security: bearer,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      responses: {
        200: { description: 'Override reviewed', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, override: { '$ref': '#/components/schemas/Override' } } } } } },
        ...stdErrors(400, 401, 403, 404)
      }
    }
  }
};

// ============================================================
// ASSEMBLE & WRITE
// ============================================================

function buildSpec() {
  return {
    openapi: '3.0.3',
    info: {
      title:       'SANGAM — Supply Chain Management API',
      version:     '1.0.0',
      description: [
        'REST API for the SANGAM permissioned blockchain-based supply chain',
        'management system built for the Indian Army.',
        '',
        '## Authentication',
        'All protected endpoints require a `Bearer` JWT obtained from `POST /api/auth/login`.',
        'Tokens expire after 8 hours (one operational shift). Use `POST /api/auth/refresh` to rotate.',
        '',
        '## Permissions',
        'Every endpoint lists the required permission (format: `resource:action`).',
        'Permissions are granted by role (Day 13 RBAC), temporary delegation (Day 15),',
        'or single-use emergency override (Day 15).',
        '',
        '## Command Scope',
        'Data is filtered to the requesting user\'s command scope — their unit and all',
        'subordinate units. A battalion CO automatically sees all companies and platoons.',
        'Lateral access (sibling units) is denied.',
        '',
        '## Offline-First',
        'All services degrade gracefully when the database is unavailable.',
        'Notifications and audit events are buffered in memory and flushed on reconnect.'
      ].join('\n'),
      contact: {
        name: 'SANGAM Development Team',
        url:  'https://github.com/sangam-scm'
      },
      license: { name: 'Proprietary — Indian Army Internal Use' }
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local / Docker development' },
      { url: 'https://sangam.army.mil', description: 'Production (classified network)' }
    ],
    tags: [
      { name: 'System',         description: 'Health checks and system status' },
      { name: 'Authentication', description: 'Login, token management, account security (Day 14)' },
      { name: 'RBAC',           description: 'Role and permission management (Day 13)' },
      { name: 'Audit',          description: 'Tamper-evident audit log with hash chain (Days 13, 16)' },
      { name: 'Notifications',  description: 'Rank-scoped real-time alerts with SSE (Day 11)' },
      { name: 'Reports',        description: 'Command-scope aggregated dashboards and exports (Day 12)' },
      { name: 'Delegation',     description: 'Temporary authority transfer and emergency overrides (Day 15)' }
    ],
    components,
    paths,
    security: []  // Default: no security (per-operation security specified explicitly)
  };
}

function generate() {
  const spec = buildSpec();
  const json = JSON.stringify(spec, null, 2);
  fs.writeFileSync(OUT_PATH, json);
  console.log(`✅  OpenAPI spec written to ${OUT_PATH}`);
  console.log(`    ${Object.keys(paths).length} paths, ${Object.keys(components.schemas).length} schemas`);
  return spec;
}

if (require.main === module) {
  generate();
}

module.exports = { buildSpec, generate };
