'use strict';

const crypto = require('crypto');

/**
 * Day 66 — shared in-memory UnitManagementService reference, used by
 * getCommandScope() to resolve real hierarchical scope when no `db` is
 * available (the default, "offline-first" runtime mode this project is
 * built and demoed in — see the Day 66 handoff for the full incident
 * writeup).
 *
 * Why module-level state instead of constructor/DI: `new RBACService(db)`
 * is called ad-hoc in ~10 places across this codebase (AuthMiddleware,
 * rbac.routes.js, and the default-fallback branch of four other
 * services) — none of which currently receive or forward a
 * UnitManagementService instance. Threading it through every one of
 * those call sites would touch ~10 files in the authentication/
 * authorization path for a fix that is conceptually about one thing:
 * there is exactly one real in-memory unit hierarchy per running
 * server process. A single, explicit registration point set once by
 * createApp() (and left untouched by any code path that doesn't call
 * createApp()) gives every RBACService instance in the process access
 * to the same live hierarchy with a one-line change at the call site,
 * while every existing direct `new RBACService(db)` usage that never
 * triggers registration keeps its exact prior self-only behavior.
 * Confirmed safe for this test suite: every verify-day-NN.js script
 * that builds multiple app/server instances does so strictly
 * sequentially (build → listen → assert → close), never concurrently,
 * so "last write wins" here never crosses two live apps.
 */
let _sharedUnitService = null;

/**
 * SANGAM RBAC Service
 * Role-Based Access Control for Indian Army Supply Chain
 *
 * Architecture:
 *   USER → ROLE → PERMISSIONS  (what you can do)
 *   USER → UNIT → COMMAND SCOPE (what data you can access)
 *
 * Permission format: "resource:action"
 * All access decisions are auditable via AuditLogService.
 */
class RBACService {

  // ============================================================
  // ROLE DEFINITIONS  — matches Indian Army rank groups
  // ============================================================
  static ROLES = {
    SOLDIER: {
      name: 'SOLDIER',
      displayName: 'Soldier / Sepoy / Constable',
      rankLevel: 1,
      description: 'Basic enlisted — read-only access to own unit data'
    },
    NCO: {
      name: 'NCO',
      displayName: 'Non-Commissioned Officer (Naik / Havildar)',
      rankLevel: 3,
      description: 'NCO — can record transactions for their section/platoon'
    },
    JCO: {
      name: 'JCO',
      displayName: 'Junior Commissioned Officer (Naib Subedar / Subedar / Subedar Major)',
      rankLevel: 5,
      description: 'JCO — can manage supply operations at company level'
    },
    LOGISTICS_OFFICER: {
      name: 'LOGISTICS_OFFICER',
      displayName: 'Logistics Staff Officer (Quartermaster / AQMG)',
      rankLevel: 6,
      description: 'Specialist logistics officer — full supply chain management'
    },
    OFFICER: {
      name: 'OFFICER',
      displayName: 'Commissioned Officer (Lieutenant / Captain / Major)',
      rankLevel: 7,
      description: 'Officer — command and control access for their unit'
    },
    SENIOR_OFFICER: {
      name: 'SENIOR_OFFICER',
      displayName: 'Senior Officer (Lieutenant Colonel / Colonel)',
      rankLevel: 8,
      description: 'Senior officer — battalion/brigade oversight and audit access'
    },
    COMMANDER: {
      name: 'COMMANDER',
      displayName: 'Formation Commander (Brigadier / Major General / Lieutenant General)',
      rankLevel: 9,
      description: 'Formation commander — division/corps level access'
    },
    AUDITOR: {
      name: 'AUDITOR',
      displayName: 'Internal Auditor / Inspector / VCAO',
      rankLevel: 4,
      description: 'Audit role — read-only across all data plus full audit log access'
    },
    SYSTEM_ADMIN: {
      name: 'SYSTEM_ADMIN',
      displayName: 'System Administrator (Technical Staff)',
      rankLevel: 10,
      description: 'Technical administrator — full system access'
    }
  };

  // ============================================================
  // PERMISSION CATALOGUE — resource:action pairs
  // ============================================================
  static PERMISSIONS = {
    // Supply chain operations
    SUPPLY_READ:     'supply:read',
    SUPPLY_WRITE:    'supply:write',
    SUPPLY_DELETE:   'supply:delete',
    SUPPLY_TRANSFER: 'supply:transfer',
    SUPPLY_APPROVE:  'supply:approve',

    // Blockchain
    BLOCKCHAIN_READ:   'blockchain:read',
    BLOCKCHAIN_WRITE:  'blockchain:write',
    BLOCKCHAIN_VERIFY: 'blockchain:verify',

    // Mesh networking
    MESH_READ:  'mesh:read',
    MESH_WRITE: 'mesh:write',
    MESH_ADMIN: 'mesh:admin',

    // Reports & analytics
    REPORTS_READ:     'reports:read',
    REPORTS_EXPORT:   'reports:export',
    REPORTS_ADVANCED: 'reports:advanced',

    // User management
    USERS_READ:   'users:read',
    USERS_WRITE:  'users:write',
    USERS_DELETE: 'users:delete',

    // Audit logs
    AUDIT_READ:   'audit:read',
    AUDIT_EXPORT: 'audit:export',

    // Data export
    SUPPLY_EXPORT: 'supply:export',

    // System administration
    SYSTEM_CONFIG: 'system:config',
    SYSTEM_ADMIN:  'system:admin',

    // Unit management (hierarchy management)
    UNITS_READ:  'units:read',
    UNITS_WRITE: 'units:write',
    UNITS_ADMIN: 'units:admin'
  };

  // ============================================================
  // PERMISSION MATRIX — what each role can do
  // ============================================================
  static ROLE_PERMISSIONS = {
    SOLDIER: [
      'supply:read',
      'blockchain:read',
      'mesh:read',
      'reports:read'
    ],

    NCO: [
      'supply:read', 'supply:write',
      'blockchain:read', 'blockchain:write',
      'mesh:read',
      'reports:read',
      'users:read'
    ],

    JCO: [
      'supply:read', 'supply:write', 'supply:transfer',
      'blockchain:read', 'blockchain:write', 'blockchain:verify',
      'mesh:read', 'mesh:write',
      'reports:read', 'reports:export',
      'users:read',
      'units:read'
    ],

    LOGISTICS_OFFICER: [
      'supply:read', 'supply:write', 'supply:delete',
      'supply:transfer', 'supply:approve', 'supply:export',
      'blockchain:read', 'blockchain:write', 'blockchain:verify',
      'mesh:read', 'mesh:write',
      'reports:read', 'reports:export', 'reports:advanced',
      'users:read',
      'units:read'
    ],

    OFFICER: [
      'supply:read', 'supply:write', 'supply:transfer', 'supply:approve',
      'blockchain:read', 'blockchain:write', 'blockchain:verify',
      'mesh:read', 'mesh:write',
      'reports:read', 'reports:export',
      'users:read', 'users:write',
      'units:read', 'units:write'
    ],

    SENIOR_OFFICER: [
      'supply:read', 'supply:write', 'supply:delete',
      'supply:transfer', 'supply:approve', 'supply:export',
      'blockchain:read', 'blockchain:write', 'blockchain:verify',
      'mesh:read', 'mesh:write', 'mesh:admin',
      'reports:read', 'reports:export', 'reports:advanced',
      'users:read', 'users:write',
      'audit:read',
      'units:read', 'units:write', 'units:admin'
    ],

    COMMANDER: [
      'supply:read', 'supply:write', 'supply:delete',
      'supply:transfer', 'supply:approve', 'supply:export',
      'blockchain:read', 'blockchain:write', 'blockchain:verify',
      'mesh:read', 'mesh:write', 'mesh:admin',
      'reports:read', 'reports:export', 'reports:advanced',
      'users:read', 'users:write', 'users:delete',
      'audit:read', 'audit:export',
      'system:config',
      'units:read', 'units:write', 'units:admin'
    ],

    AUDITOR: [
      'supply:read',
      'blockchain:read', 'blockchain:verify',
      'mesh:read',
      'reports:read', 'reports:export', 'reports:advanced',
      'users:read',
      'audit:read', 'audit:export',
      'units:read'
    ],

    SYSTEM_ADMIN: [
      'supply:read', 'supply:write', 'supply:delete',
      'supply:transfer', 'supply:approve', 'supply:export',
      'blockchain:read', 'blockchain:write', 'blockchain:verify',
      'mesh:read', 'mesh:write', 'mesh:admin',
      'reports:read', 'reports:export', 'reports:advanced',
      'users:read', 'users:write', 'users:delete',
      'audit:read', 'audit:export',
      'system:admin', 'system:config',
      'units:read', 'units:write', 'units:admin'
    ]
  };

  // ============================================================
  // UNIT TYPE HIERARCHY — Indian Army structure
  // ============================================================
  static UNIT_HIERARCHY = {
    SECTION:   { level: 1, size: '8–10',       commandedBy: 'Lance Naik / Naik' },
    PLATOON:   { level: 2, size: '30–40',      commandedBy: 'JCO / Lieutenant' },
    COMPANY:   { level: 3, size: '100–150',    commandedBy: 'Captain / Major' },
    BATTALION: { level: 4, size: '800–1000',   commandedBy: 'Lieutenant Colonel' },
    BRIGADE:   { level: 5, size: '3000–5000',  commandedBy: 'Brigadier' },
    DIVISION:  { level: 6, size: '10000–15000',commandedBy: 'Major General' },
    CORPS:     { level: 7, size: '40000–80000',commandedBy: 'Lieutenant General' },
    COMMAND:   { level: 8, size: 'Variable',   commandedBy: 'General / Army Commander' }
  };

  constructor(db) {
    this.db = db;
    this._hierarchyCache = new Map(); // Cache command scope lookups
  }

  // ============================================================
  // SHARED UNIT SERVICE REGISTRATION (Day 66)
  // ============================================================

  /**
   * Register the live in-memory UnitManagementService instance so that
   * every RBACService instance in this process can resolve real
   * hierarchical command scope when running without a `db` connection.
   * Called once by createApp(); see the module-level comment above for
   * the full reasoning behind this being a static registration point
   * rather than constructor injection.
   */
  static setSharedUnitService(unitService) {
    _sharedUnitService = unitService || null;
  }

  /** Returns the currently-registered shared UnitManagementService, or null. */
  static getSharedUnitService() {
    return _sharedUnitService;
  }

  /**
   * Test-only helper: clears the shared reference so an isolated test
   * can verify the pre-registration (self-only) fallback behavior.
   */
  static _resetSharedUnitService() {
    _sharedUnitService = null;
  }

  // ============================================================
  // PERMISSION CHECKING
  // ============================================================

  /**
   * Check if a role has a specific permission.
   * SYSTEM_ADMIN bypasses all permission checks.
   *
   * @param {string} roleName  - e.g. 'OFFICER'
   * @param {string} permission - e.g. 'supply:approve'
   * @returns {boolean}
   */
  hasPermission(roleName, permission) {
    const rolePerms = RBACService.ROLE_PERMISSIONS[roleName];
    if (!rolePerms) return false;

    // system:admin is a super-permission
    if (rolePerms.includes('system:admin')) return true;

    // Exact match
    if (rolePerms.includes(permission)) return true;

    // Resource wildcard (e.g. "supply:*" covers all supply actions)
    const [resource] = permission.split(':');
    if (rolePerms.includes(`${resource}:*`)) return true;

    return false;
  }

  /**
   * Check that a role has ALL listed permissions.
   */
  hasAllPermissions(roleName, permissions) {
    return permissions.every(p => this.hasPermission(roleName, p));
  }

  /**
   * Check that a role has AT LEAST ONE of the listed permissions.
   */
  hasAnyPermission(roleName, permissions) {
    return permissions.some(p => this.hasPermission(roleName, p));
  }

  /**
   * Return the full permission list for a role.
   * SYSTEM_ADMIN returns every defined permission.
   */
  getRolePermissions(roleName) {
    if (roleName === 'SYSTEM_ADMIN') {
      return Object.values(RBACService.PERMISSIONS);
    }
    return [...(RBACService.ROLE_PERMISSIONS[roleName] || [])];
  }

  /**
   * Return role metadata or null if unknown.
   */
  getRoleInfo(roleName) {
    return RBACService.ROLES[roleName] || null;
  }

  /**
   * Compare rank levels of two roles.
   * @returns positive if role1 outranks role2, 0 if equal, negative if lower
   */
  compareRankLevel(role1, role2) {
    const r1 = RBACService.ROLES[role1];
    const r2 = RBACService.ROLES[role2];
    if (!r1 || !r2) return 0;
    return r1.rankLevel - r2.rankLevel;
  }

  // ============================================================
  // COMMAND HIERARCHY  — data scope enforcement
  // ============================================================

  /**
   * Get all unit IDs within a user's command scope.
   * Includes the user's own unit plus all subordinate units (recursive).
   * Results are cached for 5 minutes.
   *
   * @param {number} unitId  - The user's assigned unit ID
   * @param {object} db      - DB pool (optional override)
   * @returns {{ ids: number[], codes: string[] }}
   */
  async getCommandScope(unitId, db = this.db) {
    const cacheKey = `scope_${unitId}`;
    if (this._hierarchyCache.has(cacheKey)) {
      return this._hierarchyCache.get(cacheKey);
    }

    if (!db) {
      // Day 66 fix: previously this unconditionally collapsed to
      // self-only, meaning hierarchical command scope never worked in
      // offline/in-memory mode — this project's default, "non-negotiable"
      // runtime mode, exercised by every one of this suite's 1,920+
      // assertions (all of which run with db=null). If the live in-memory
      // unit hierarchy has been registered (createApp() does this
      // automatically), delegate to it so a Commander's scope actually
      // includes their subordinate units, exactly as it would via the
      // SQL recursive CTE below if a database were connected. Not cached
      // here — in-memory traversal is cheap, and skipping the cache
      // avoids any staleness window after a unit is created/reassigned/
      // deactivated. Falls back to the original self-only behavior if
      // no unit service is registered (e.g. isolated direct
      // `new RBACService(db)` usage that never calls createApp()) or if
      // it doesn't recognize the unit — identical to pre-Day-66 output
      // in both cases, so nothing that depended on the old behavior can
      // regress.
      if (_sharedUnitService && typeof _sharedUnitService.getDescendantScope === 'function') {
        return _sharedUnitService.getDescendantScope(unitId);
      }
      return { ids: [unitId], codes: [] };
    }

    try {
      const result = await db.query(`
        WITH RECURSIVE unit_tree AS (
          SELECT id, unit_code
          FROM   command_units
          WHERE  id = $1 AND active = true

          UNION ALL

          SELECT cu.id, cu.unit_code
          FROM   command_units cu
          INNER JOIN unit_tree ut ON cu.parent_unit_id = ut.id
          WHERE  cu.active = true
        )
        SELECT id, unit_code FROM unit_tree
      `, [unitId]);

      const scope = {
        ids:   result.rows.map(r => r.id),
        codes: result.rows.map(r => r.unit_code)
      };

      this._hierarchyCache.set(cacheKey, scope);
      // Cache expires in 5 minutes
      setTimeout(() => this._hierarchyCache.delete(cacheKey), 5 * 60 * 1000);

      return scope;
    } catch {
      // Degrade gracefully — allow only own unit
      return { ids: [unitId], codes: [] };
    }
  }

  /**
   * Return true if targetUnitId is within userUnitId's command scope.
   */
  async isInCommandScope(userUnitId, targetUnitId, db = this.db) {
    if (userUnitId === targetUnitId) return true;
    const scope = await this.getCommandScope(userUnitId, db);
    return scope.ids.includes(targetUnitId);
  }

  /**
   * Return the chain of command above a given unit (parent hierarchy).
   */
  async getChainOfCommand(unitId, db = this.db) {
    if (!db) return [];
    try {
      const result = await db.query(`
        WITH RECURSIVE chain AS (
          SELECT id, unit_name, unit_type, unit_code, parent_unit_id, 0 AS depth
          FROM   command_units WHERE id = $1

          UNION ALL

          SELECT cu.id, cu.unit_name, cu.unit_type, cu.unit_code,
                 cu.parent_unit_id, c.depth + 1
          FROM   command_units cu
          INNER JOIN chain c ON cu.id = c.parent_unit_id
        )
        SELECT * FROM chain ORDER BY depth
      `, [unitId]);
      return result.rows;
    } catch {
      return [];
    }
  }

  /** Clear cached hierarchy (call after unit structure changes). */
  clearHierarchyCache() {
    this._hierarchyCache.clear();
  }

  // ============================================================
  // USER CONTEXT BUILDER
  // ============================================================

  /**
   * Build a rich permission context object for the authenticated user.
   * Attached to req.user by AuthMiddleware.authenticate().
   *
   * @param {object} user  - Raw user record
   * @returns {UserContext}
   */
  buildUserContext(user) {
    const permissions = this.getRolePermissions(user.role);
    const roleInfo    = this.getRoleInfo(user.role);

    return {
      userId:      user.id,
      username:    user.username,
      displayName: user.display_name || user.displayName,
      role:        user.role,
      roleInfo,
      unitId:      user.unit_id   || user.unitId,
      unitCode:    user.unit_code || user.unitCode,
      permissions,
      // Convenience helpers
      can:       (perm)  => this.hasPermission(user.role, perm),
      canAny:    (perms) => this.hasAnyPermission(user.role, perms),
      canAll:    (perms) => this.hasAllPermissions(user.role, perms),
      isAdmin:   ()      => user.role === 'SYSTEM_ADMIN',
      isSuperUser: ()    => ['SYSTEM_ADMIN', 'COMMANDER'].includes(user.role)
    };
  }

  // ============================================================
  // DATABASE OPERATIONS
  // ============================================================

  /**
   * Seed army_roles, permissions, and role_permissions tables.
   * Safe to run multiple times (ON CONFLICT DO NOTHING / DO UPDATE).
   */
  async initializeRolesAndPermissions(db = this.db) {
    if (!db) throw new Error('Database connection required');
    const client = await db.connect();

    try {
      await client.query('BEGIN');

      // Roles
      for (const role of Object.values(RBACService.ROLES)) {
        await client.query(`
          INSERT INTO army_roles (name, display_name, rank_level, description)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (name) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            rank_level   = EXCLUDED.rank_level,
            description  = EXCLUDED.description
        `, [role.name, role.displayName, role.rankLevel, role.description]);
      }

      // Permissions
      for (const perm of Object.values(RBACService.PERMISSIONS)) {
        const [resource, action] = perm.split(':');
        await client.query(`
          INSERT INTO permissions (resource, action, description)
          VALUES ($1, $2, $3)
          ON CONFLICT (resource, action) DO NOTHING
        `, [resource, action, `${action} on ${resource}`]);
      }

      // Role → Permission links
      for (const [roleName, perms] of Object.entries(RBACService.ROLE_PERMISSIONS)) {
        for (const perm of perms) {
          const [resource, action] = perm.split(':');
          await client.query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id
            FROM   army_roles r, permissions p
            WHERE  r.name = $1 AND p.resource = $2 AND p.action = $3
            ON CONFLICT DO NOTHING
          `, [roleName, resource, action]);
        }
      }

      await client.query('COMMIT');
      return { success: true, message: 'RBAC tables seeded successfully' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Return all roles with their permission counts.
   * Works without a DB connection (pure in-memory).
   */
  async getRoles() {
    return Object.entries(RBACService.ROLES).map(([key, role]) => ({
      ...role,
      permissionCount: (RBACService.ROLE_PERMISSIONS[key] || []).length,
      permissions:     RBACService.ROLE_PERMISSIONS[key] || []
    }));
  }
}

module.exports = RBACService;
