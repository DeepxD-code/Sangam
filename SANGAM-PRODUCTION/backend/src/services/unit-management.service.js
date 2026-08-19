'use strict';

/**
 * SANGAM Unit Management Service  (Day 22)
 *
 * Manages the Army command unit hierarchy.
 *
 * Offline-first: in-memory Map is primary store; DB writes are
 * fire-and-forget. All reads degrade gracefully when db is null.
 *
 * Unit hierarchy (ascending authority):
 *   SECTION → PLATOON → COMPANY → BATTALION →
 *   BRIGADE → DIVISION → CORPS → COMMAND
 *
 * Methods:
 *   createUnit(params)                    → create a new unit node
 *   getUnitById(id)                       → single unit (null if not found)
 *   getUnitsInScope(scopeUnitIds, filter) → list units the caller can see
 *   getUnitHierarchy(rootId)              → nested tree structure
 *   updateUnit(id, updates, actorUserId)  → rename / change location / commander
 *   deactivateUnit(id, actorUserId)       → soft-deactivate (blocks if children active)
 *   reactivateUnit(id, actorUserId)       → restore deactivated unit
 *   reassignUnit(id, newParentId, actor)  → re-parent a unit (cycle guard)
 *   getUnitStats(id)                      → user count, item count per unit
 */

const UNIT_TYPES = [
  'SECTION', 'PLATOON', 'COMPANY', 'BATTALION',
  'BRIGADE',  'DIVISION', 'CORPS',  'COMMAND'
];

// Hierarchical rank: higher index = higher authority
const TYPE_RANK = Object.fromEntries(UNIT_TYPES.map((t, i) => [t, i]));

class UnitManagementService {

  /**
   * @param {object} db         - pg Pool (null = offline)
   * @param {object} auditLog   - AuditLogService instance
   * @param {object} rbac       - RBACService instance
   */
  constructor(db, auditLog = null, rbac = null) {
    this.db       = db;
    this.auditLog = auditLog;
    this.rbac     = rbac;

    // Primary in-memory stores
    this._units   = new Map();  // id → unit object
    this._nextId  = 1;

    // Stats counters
    this._stats = {
      unitsCreated:      0,
      unitsDeactivated:  0,
      unitsReassigned:   0
    };

    // Day 68: tracks in-flight fire-and-forget _dbWrite() calls so bulk-
    // creation callers (the demo seeder; potentially bulk-import) can
    // explicitly wait for a parent unit's row to actually land in SQL
    // before creating a child that references it via parent_unit_id —
    // without changing the live per-request path's deliberate fire-and-
    // forget timing at all. Motivated by a real, observed self-
    // referencing foreign key race (command_units_parent_unit_id_fkey)
    // during rapid bulk seeding against genuine PostgreSQL — see the
    // Day 68 handoff notes. Same pattern as SupplyChainService's
    // _trackWrite/flushPendingWrites, added the same day for the same
    // reason.
    this._pendingWrites = new Set();
  }

  /** See SupplyChainService._trackWrite for the full rationale. */
  _trackWrite(promise) {
    const tracked = promise.catch(err => console.error('[unit-management] persist error:', err.message));
    this._pendingWrites.add(tracked);
    tracked.finally(() => this._pendingWrites.delete(tracked));
    return tracked;
  }

  /** See SupplyChainService.flushPendingWrites for the full rationale. */
  async flushPendingWrites() {
    await Promise.allSettled([...this._pendingWrites]);
  }

  // ================================================================
  // 1. CREATE UNIT
  // ================================================================

  /**
   * @param {object} params
   *   unitName  {string} required
   *   unitType  {string} required — one of UNIT_TYPES
   *   unitCode  {string} required — unique identifier (e.g. '1 PARA')
   *   parentUnitId {number|null}
   *   commanderId  {number|null}
   *   location     {string}
   *   createdByUserId {number}
   */
  async createUnit(params) {
    const { unitName, unitType, unitCode, parentUnitId = null,
            commanderId = null, location = null, createdByUserId = null } = params || {};

    // Required field validation
    if (!unitName || !unitName.trim() || !unitType || !unitCode) {
      return {
        success: false, error: 'MISSING_REQUIRED_FIELDS',
        message: 'unitName, unitType, unitCode are required'
      };
    }

    if (!UNIT_TYPES.includes(unitType)) {
      return {
        success: false, error: 'INVALID_UNIT_TYPE',
        message: `unitType must be one of: ${UNIT_TYPES.join(', ')}`
      };
    }

    // Unique code check
    const existing = [...this._units.values()].find(
      u => u.unitCode === unitCode && u.active
    );
    if (existing) {
      return { success: false, error: 'UNIT_CODE_EXISTS',
               message: `Unit code '${unitCode}' is already in use` };
    }

    // Parent validation
    if (parentUnitId !== null) {
      const parent = this._units.get(parseInt(parentUnitId, 10));
      if (!parent) {
        return { success: false, error: 'PARENT_NOT_FOUND' };
      }
      if (!parent.active) {
        return { success: false, error: 'PARENT_INACTIVE',
                 message: 'Cannot attach to a deactivated parent unit' };
      }
      // Hierarchy rule: child must be strictly lower than parent
      if (TYPE_RANK[unitType] >= TYPE_RANK[parent.unitType]) {
        return {
          success: false, error: 'INVALID_HIERARCHY',
          message: `A ${unitType} cannot be a child of a ${parent.unitType}. ` +
                   `Child must have lower authority than parent.`
        };
      }
    }

    const id  = this._nextId++;
    const now = new Date().toISOString();
    const unit = {
      id,
      unitName,
      unitType,
      unitCode,
      parentUnitId: parentUnitId ? parseInt(parentUnitId, 10) : null,
      commanderId:  commanderId  ? parseInt(commanderId, 10)  : null,
      location,
      active:    true,
      createdAt: now,
      updatedAt: now
    };

    this._units.set(id, unit);
    this._stats.unitsCreated++;

    await this._audit({
      userId: createdByUserId,
      action: 'UNIT_CREATE',
      resource: 'command_units',
      resourceId: String(id),
      details: { unitName, unitType, unitCode, parentUnitId },
      success: true
    });

    // DB write (best-effort)
    this._dbWrite(id, unit);

    return { success: true, unit: { ...unit } };
  }

  // ================================================================
  // 2. GET ALL UNIT IDS (public — replaces reaching into _units internals)
  // ================================================================

  /**
   * Return an array of all active unit IDs currently held in memory.
   * Used by the alert poller in server.js and any other caller that
   * needs the full ID set without filtering by scope.
   *
   * @returns {number[]}
   */
  getUnitIds() {
    return [...this._units.keys()];
  }

  // ================================================================
  // SNAPSHOT / RESTORE  (Day 63 — admin-only backup tooling)
  // ================================================================

  /**
   * Return every unit, unfiltered — including inactive ones. Deliberately
   * distinct from getUnitsInScope(), which defaults to activeOnly:true;
   * a backup that silently dropped deactivated units would be a bad one.
   */
  exportSnapshot() {
    return [...this._units.values()].map(u => ({ ...u }));
  }

  /**
   * Replace all units with a previously-exported snapshot, preserving
   * exact IDs (so restored items/users' unitId references still point
   * at the right place) and advancing the ID counter past the restored
   * max so subsequent normal creates don't collide. This is a direct
   * state replacement for disaster recovery, NOT the normal creation
   * path — it does not go through createUnit()'s validation, by design,
   * since the snapshot was already valid when exported.
   */
  restoreSnapshot(unitsArray) {
    if (!Array.isArray(unitsArray)) {
      return { success: false, error: 'INVALID_SNAPSHOT', message: 'Expected an array of units' };
    }
    this._units = new Map(unitsArray.map(u => [u.id, { ...u }]));
    const maxId = unitsArray.reduce((max, u) => Math.max(max, u.id || 0), 0);
    this._nextId = maxId + 1;
    return { success: true, count: unitsArray.length };
  }

  // ================================================================
  // COMMAND SCOPE (Day 66 — offline-mode fallback for RBACService)
  // ================================================================

  /**
   * Return the command scope (self + all active descendant units) for
   * a given unit, computed from the live in-memory hierarchy. This is
   * consumed by RBACService.getCommandScope() as its fallback when no
   * `db` connection exists, so its return shape deliberately mirrors
   * that method's SQL recursive-CTE result: { ids: number[], codes: string[] }.
   *
   * Two deliberate, documented divergences from the SQL path's exact
   * semantics (both favor "never scope a user out of their own unit"
   * over byte-identical SQL parity):
   *   1. The anchor (self) unit is always included, even if inactive —
   *      the SQL CTE requires `active = true` on the anchor row too,
   *      which would return an EMPTY scope for a user whose own unit
   *      was deactivated after their JWT was issued. Consistent with
   *      this project's existing graceful-degradation principle.
   *   2. If the unit isn't found in memory at all (e.g. a synthetic
   *      unitId in an isolated test, or data not yet seeded), returns
   *      self-only using the original unitId value unchanged — this is
   *      byte-identical to what RBACService returned for EVERY offline
   *      call before this method existed, so nothing that depended on
   *      the old behavior can regress.
   * Descendants are included only while active, matching the SQL CTE's
   * recursive-step filter exactly.
   *
   * @param {number} unitId
   * @returns {{ids: number[], codes: string[]}}
   */
  getDescendantScope(unitId) {
    const id     = parseInt(unitId, 10);
    const anchor = this._units.get(id);

    if (!anchor) {
      return { ids: [unitId], codes: [] };
    }

    const includedIds   = [anchor.id];
    const includedCodes = anchor.unitCode ? [anchor.unitCode] : [];
    const visited        = new Set([anchor.id]);
    const queue           = [...this._units.values()].filter(
      u => u.parentUnitId === anchor.id && u.active
    );

    while (queue.length) {
      const u = queue.shift();
      if (visited.has(u.id)) continue; // cycle guard — mirrors _isDescendant's pattern
      visited.add(u.id);
      includedIds.push(u.id);
      if (u.unitCode) includedCodes.push(u.unitCode);
      queue.push(
        ...[...this._units.values()].filter(c => c.parentUnitId === u.id && c.active)
      );
    }

    return { ids: includedIds, codes: includedCodes };
  }

  // ================================================================
  // 3. GET UNIT BY ID
  // ================================================================

  getUnitById(id) {
    const unit = this._units.get(parseInt(id, 10));
    return unit ? { ...unit } : null;
  }

  // ================================================================
  // 3. GET UNITS IN SCOPE
  // ================================================================

  /**
   * Return all units whose IDs are in scopeUnitIds.
   *
   * @param {number[]} scopeUnitIds
   * @param {object}   filters - { unitType, activeOnly, search }
   */
  getUnitsInScope(scopeUnitIds, filters = {}) {
    const { unitType, activeOnly = true, search } = filters;

    let units = [...this._units.values()].filter(u =>
      scopeUnitIds.includes(u.id));

    if (activeOnly) units = units.filter(u => u.active);
    if (unitType)   units = units.filter(u => u.unitType === unitType);
    if (search) {
      const q = search.toLowerCase();
      units = units.filter(u =>
        u.unitName.toLowerCase().includes(q) ||
        u.unitCode.toLowerCase().includes(q));
    }

    units.sort((a, b) =>
      TYPE_RANK[b.unitType] - TYPE_RANK[a.unitType] || a.unitName.localeCompare(b.unitName));

    return { units: units.map(u => ({ ...u })), total: units.length };
  }

  // ================================================================
  // 4. GET UNIT HIERARCHY (TREE)
  // ================================================================

  /**
   * Build a nested tree rooted at rootId.
   * If rootId is null, returns the full forest.
   *
   * @param {number|null} rootId
   * @returns {{ success, tree }}
   */
  getUnitHierarchy(rootId = null) {
    const allUnits = [...this._units.values()].filter(u => u.active);

    const build = (parentId) =>
      allUnits
        .filter(u => u.parentUnitId === parentId)
        .sort((a, b) => TYPE_RANK[b.unitType] - TYPE_RANK[a.unitType])
        .map(u => ({
          ...u,
          children: build(u.id)
        }));

    let tree;
    if (rootId) {
      const root = this._units.get(parseInt(rootId, 10));
      if (!root) return { success: false, error: 'UNIT_NOT_FOUND' };
      tree = [{ ...root, children: build(root.id) }];
    } else {
      tree = build(null);
    }

    return { success: true, tree };
  }

  // ================================================================
  // 5. UPDATE UNIT
  // ================================================================

  /**
   * Update mutable fields of a unit.
   * unitType and unitCode cannot be changed after creation.
   *
   * @param {number|string} id
   * @param {object} updates  - { unitName, location, commanderId }
   * @param {number} actorUserId
   */
  async updateUnit(id, updates, actorUserId = null) {
    const unit = this._units.get(parseInt(id, 10));
    if (!unit) return { success: false, error: 'UNIT_NOT_FOUND' };
    if (!unit.active) return { success: false, error: 'UNIT_INACTIVE',
                               message: 'Cannot update a deactivated unit' };
    if (updates.unitName !== undefined && !updates.unitName.trim()) {
      return { success: false, error: 'INVALID_UNIT_NAME',
               message: 'unitName cannot be blank' };
    }

    const allowed  = ['unitName', 'location', 'commanderId'];
    const changes  = {};
    for (const key of allowed) {
      if (updates[key] !== undefined) changes[key] = updates[key];
    }
    if (Object.keys(changes).length === 0) {
      return {
        success: false, error: 'NO_UPDATE_FIELDS',
        message: `Updatable fields: ${allowed.join(', ')}`
      };
    }

    Object.assign(unit, changes, { updatedAt: new Date().toISOString() });
    this._dbWrite(id, unit);

    await this._audit({
      userId: actorUserId, action: 'UNIT_UPDATE',
      resource: 'command_units', resourceId: String(id),
      details: changes, success: true
    });

    return { success: true, unit: { ...unit } };
  }

  // ================================================================
  // 6. DEACTIVATE UNIT
  // ================================================================

  /**
   * Soft-deactivate a unit. Blocked if the unit has active children.
   */
  async deactivateUnit(id, actorUserId = null) {
    const unit = this._units.get(parseInt(id, 10));
    if (!unit) return { success: false, error: 'UNIT_NOT_FOUND' };
    if (!unit.active) return { success: false, error: 'ALREADY_INACTIVE' };

    // Block if active children exist
    const activeChildren = [...this._units.values()].filter(
      u => u.parentUnitId === unit.id && u.active);
    if (activeChildren.length > 0) {
      return {
        success: false, error: 'HAS_ACTIVE_CHILDREN',
        message: `${activeChildren.length} active child unit(s) must be deactivated first`,
        childIds: activeChildren.map(c => c.id)
      };
    }

    unit.active    = false;
    unit.updatedAt = new Date().toISOString();
    this._stats.unitsDeactivated++;
    this._dbWrite(id, unit);

    await this._audit({
      userId: actorUserId, action: 'UNIT_DEACTIVATE',
      resource: 'command_units', resourceId: String(id),
      details: { unitName: unit.unitName, unitCode: unit.unitCode },
      success: true, severity: 'WARNING'
    });

    return { success: true, unit: { ...unit } };
  }

  // ================================================================
  // 7. REACTIVATE UNIT
  // ================================================================

  async reactivateUnit(id, actorUserId = null) {
    const unit = this._units.get(parseInt(id, 10));
    if (!unit)       return { success: false, error: 'UNIT_NOT_FOUND' };
    if (unit.active) return { success: false, error: 'ALREADY_ACTIVE' };

    // If unit has a parent, parent must be active
    if (unit.parentUnitId) {
      const parent = this._units.get(unit.parentUnitId);
      if (parent && !parent.active) {
        return {
          success: false, error: 'PARENT_INACTIVE',
          message: 'Reactivate the parent unit first'
        };
      }
    }

    unit.active    = true;
    unit.updatedAt = new Date().toISOString();
    this._dbWrite(id, unit);

    await this._audit({
      userId: actorUserId, action: 'UNIT_REACTIVATE',
      resource: 'command_units', resourceId: String(id),
      details: { unitName: unit.unitName }, success: true
    });

    return { success: true, unit: { ...unit } };
  }

  // ================================================================
  // 8. REASSIGN UNIT (CHANGE PARENT)
  // ================================================================

  /**
   * Re-parent a unit. Guards:
   *   - New parent must exist and be active
   *   - New parent must have higher authority type
   *   - Must not create a cycle (unit cannot become its own ancestor)
   */
  async reassignUnit(id, newParentId, actorUserId = null) {
    const unitId = parseInt(id, 10);
    const unit   = this._units.get(unitId);
    if (!unit) return { success: false, error: 'UNIT_NOT_FOUND' };

    if (newParentId === null || newParentId === undefined) {
      // Allow detaching from hierarchy (become a root)
      const oldParentId     = unit.parentUnitId;
      unit.parentUnitId     = null;
      unit.updatedAt        = new Date().toISOString();
      this._stats.unitsReassigned++;
      this._dbWrite(id, unit);
      await this._audit({
        userId: actorUserId, action: 'UNIT_REASSIGN',
        resource: 'command_units', resourceId: String(id),
        details: { oldParentId, newParentId: null }, success: true
      });
      return { success: true, unit: { ...unit } };
    }

    const newPId   = parseInt(newParentId, 10);
    const newParent = this._units.get(newPId);
    if (!newParent) return { success: false, error: 'PARENT_NOT_FOUND' };
    if (!newParent.active) return { success: false, error: 'PARENT_INACTIVE' };

    // Hierarchy rule
    if (TYPE_RANK[unit.unitType] >= TYPE_RANK[newParent.unitType]) {
      return {
        success: false, error: 'INVALID_HIERARCHY',
        message: `A ${unit.unitType} cannot be a child of a ${newParent.unitType}`
      };
    }

    // Cycle guard: check newParent is not a descendant of unit
    if (this._isDescendant(unitId, newPId)) {
      return {
        success: false, error: 'CYCLE_DETECTED',
        message: 'Cannot reassign: would create a cycle in the hierarchy'
      };
    }

    const oldParentId   = unit.parentUnitId;
    unit.parentUnitId   = newPId;
    unit.updatedAt      = new Date().toISOString();
    this._stats.unitsReassigned++;
    this._dbWrite(id, unit);

    await this._audit({
      userId: actorUserId, action: 'UNIT_REASSIGN',
      resource: 'command_units', resourceId: String(id),
      details: { oldParentId, newParentId: newPId }, success: true
    });

    return { success: true, unit: { ...unit } };
  }

  /**
   * Returns true if `candidateId` is a descendant of `ancestorId`.
   */
  _isDescendant(ancestorId, candidateId) {
    const visited = new Set();
    let current   = this._units.get(candidateId);
    while (current && current.parentUnitId !== null) {
      if (visited.has(current.id)) break; // safety: already-cycled data
      visited.add(current.id);
      if (current.parentUnitId === ancestorId) return true;
      current = this._units.get(current.parentUnitId);
    }
    return false;
  }

  // ================================================================
  // 9. UNIT STATS
  // ================================================================

  /**
   * Return counts of active children and metadata for a single unit.
   * (Actual user/item counts require caller to pass their services.)
   */
  getUnitStats(id) {
    const unit = this._units.get(parseInt(id, 10));
    if (!unit) return null;

    const allUnits      = [...this._units.values()];
    const directChildren = allUnits.filter(u => u.parentUnitId === unit.id);
    const activeChildren = directChildren.filter(u => u.active);
    const descendants   = this._getAllDescendants(unit.id);

    return {
      unitId:               unit.id,
      unitCode:             unit.unitCode,
      directChildCount:     directChildren.length,
      activeChildCount:     activeChildren.length,
      totalDescendantCount: descendants.length,
      depth:                this._depthOf(unit.id)
    };
  }

  _getAllDescendants(unitId) {
    const result   = [];
    const queue    = [...this._units.values()].filter(u => u.parentUnitId === unitId);
    while (queue.length) {
      const u = queue.shift();
      result.push(u);
      queue.push(...[...this._units.values()].filter(c => c.parentUnitId === u.id));
    }
    return result;
  }

  _depthOf(unitId) {
    let depth = 0;
    let unit  = this._units.get(unitId);
    while (unit && unit.parentUnitId !== null) {
      depth++;
      unit = this._units.get(unit.parentUnitId);
      if (depth > 20) break; // guard against corrupted data
    }
    return depth;
  }

  // ================================================================
  // STATIC METADATA
  // ================================================================

  static get UNIT_TYPES() { return UNIT_TYPES; }

  getStats() {
    return { ...this._stats, totalUnits: this._units.size };
  }

  // ================================================================
  // INTERNALS
  // ================================================================

  async _audit(entry) {
    if (this.auditLog) await this.auditLog.log(entry).catch(err => console.error('[unit-management] audit error:', err.message));
  }

  _dbWrite(id, unit) {
    if (!this.db) return;
    // Day 67: extended to also sync updates from updateUnit/deactivateUnit/
    // reactivateUnit/reassignUnit, which previously never called _dbWrite at
    // all — SQL's command_units silently never reflected any change made
    // after a unit's initial creation (rename, relocation, commander
    // reassignment, deactivation, reactivation, re-parenting all stayed
    // in-memory only). parent_unit_id is now included in the UPDATE SET
    // list for the same reason. unit_type and unit_code remain deliberately
    // excluded — no service method ever changes them post-creation, so
    // they should never be touched by an UPDATE.
    const q = `
      INSERT INTO command_units
        (id, unit_name, unit_type, unit_code, parent_unit_id,
         commander_id, location, active, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE
        SET unit_name=EXCLUDED.unit_name, active=EXCLUDED.active,
            location=EXCLUDED.location, commander_id=EXCLUDED.commander_id,
            parent_unit_id=EXCLUDED.parent_unit_id,
            updated_at=EXCLUDED.updated_at
    `;
    this._trackWrite(this.db.query(q, [
      unit.id, unit.unitName, unit.unitType, unit.unitCode,
      unit.parentUnitId, unit.commanderId, unit.location,
      unit.active, unit.createdAt, unit.updatedAt
    ])); // best-effort, tracked (see constructor note)
  }
}

module.exports = UnitManagementService;
