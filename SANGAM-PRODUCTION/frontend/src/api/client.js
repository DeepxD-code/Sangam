// SANGAM API Client (Day 27 / extended Day 31)
//
// Thin fetch wrapper. Stores the JWT in localStorage so a session
// survives a page reload — standard practice for an internal SPA
// deployed on a unit's own server (not a sandboxed artifact preview).

const TOKEN_KEY   = 'sangam_token';
const REFRESH_KEY = 'sangam_refresh_token';

export function getToken()         { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t)        { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }
export function getRefreshToken()  { return localStorage.getItem(REFRESH_KEY); }
export function setRefreshToken(t) { t ? localStorage.setItem(REFRESH_KEY, t) : localStorage.removeItem(REFRESH_KEY); }
export function clearToken()       { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(REFRESH_KEY); }

export class ApiError extends Error {
  constructor(message, status, payload) {
    super(message);
    this.status  = status;
    this.payload = payload;
  }
}

/**
 * Core request helper. Paths are relative ('/api/...') so the Vite
 * dev-server proxy handles routing to the backend.
 */
async function request(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };

  let res;
  try {
    res = await fetch(path, { ...options, headers });
  } catch (_networkErr) {
    throw new ApiError('Unable to reach the SANGAM server. Check the backend is running.', 0, null);
  }

  let body = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    body = await res.json().catch(() => null);
  }

  if (!res.ok) {
    const message = body?.message || body?.error || `Request failed (${res.status})`;
    throw new ApiError(message, res.status, body);
  }

  return body;
}

export const api = {
  // ── Auth ──────────────────────────────────────────────────────
  async login(username, password) {
    const result = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    if (result?.accessToken)  setToken(result.accessToken);
    if (result?.refreshToken) setRefreshToken(result.refreshToken);
    return result;
  },

  async logout() {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) {
        await request('/api/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken })
        });
      }
    } finally {
      clearToken();
    }
  },

  async changePassword(oldPassword, newPassword) {
    return request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword })
    });
  },

  async getMe() {
    return request('/api/auth/me');
  },

  // ── Dashboard ─────────────────────────────────────────────────
  async getDashboardSummary({ forceRefresh = false } = {}) {
    const qs = forceRefresh ? '?forceRefresh=true' : '';
    return request(`/api/dashboard/summary${qs}`);
  },

  async refreshDashboard() {
    return request('/api/dashboard/refresh', { method: 'POST' });
  },

  // ── Supply items ──────────────────────────────────────────────
  async getSupplyItems(filters = {}) {
    const p = new URLSearchParams();
    if (filters.category)     p.set('category', filters.category);
    if (filters.search)       p.set('search', filters.search);
    if (filters.unitId)       p.set('unitId', filters.unitId);
    if (filters.lowStockOnly) p.set('lowStockOnly', 'true');
    if (filters.limit)        p.set('limit', String(filters.limit));
    if (filters.offset)       p.set('offset', String(filters.offset));
    const qs = p.toString();
    return request(`/api/supply/items${qs ? `?${qs}` : ''}`);
  },

  async getSupplyCategories() {
    return request('/api/supply/categories');
  },

  // ── Transfers ─────────────────────────────────────────────────
  /** @returns {{ success, transfers, total }} */
  async getTransfer(id) {
    return request(`/api/supply/transfers/${id}`);
  },

  async getTransfers(filters = {}) {
    const p = new URLSearchParams();
    if (filters.status) p.set('status', filters.status);
    if (filters.itemId) p.set('itemId', filters.itemId);
    if (filters.limit)  p.set('limit', filters.limit);
    if (filters.offset) p.set('offset', filters.offset);
    const qs = p.toString();
    return request(`/api/supply/transfers${qs ? `?${qs}` : ''}`);
  },

  /**
   * @param {{ itemId, fromUnitId, toUnitId, quantity, notes }} params
   * @returns {{ success, transfer }}
   */
  async createTransfer(params) {
    return request('/api/supply/transfers', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  /** @returns {{ success, transfer }} */
  async approveTransfer(id) {
    return request(`/api/supply/transfers/${id}/approve`, { method: 'POST' });
  },

  /** @returns {{ success, transfer }} */
  async rejectTransfer(id, reason = '') {
    return request(`/api/supply/transfers/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  // ── Blockchain ────────────────────────────────────────────────
  /** @returns {{ success, blocks, totalBlocks }} */
  async getBlockchain(limit = 20) {
    return request(`/api/supply/blockchain?limit=${limit}`);
  },

  /** @returns {{ success, verified, blockCount, tampered }} */
  async verifyBlockchain() {
    return request('/api/supply/blockchain/verify', { method: 'POST' });
  },

  // ── Alerts ────────────────────────────────────────────────────
  /** @returns {{ success, alerts }} */
  async getAlerts(filters = {}) {
    const p = new URLSearchParams();
    if (filters.status)   p.set('status', filters.status);
    if (filters.severity) p.set('severity', filters.severity);
    if (filters.type)     p.set('type', filters.type);
    const qs = p.toString();
    return request(`/api/alerts${qs ? `?${qs}` : ''}`);
  },

  async getActiveAlerts() {
    return request('/api/alerts/active');
  },

  /** @returns {{ success, alert }} */
  async getAlert(id) {
    return request(`/api/alerts/${id}`);
  },

  async scanAlerts() {
    return request('/api/alerts/scan', { method: 'POST' });
  },

  async acknowledgeAlert(id) {
    return request(`/api/alerts/${id}/acknowledge`, { method: 'POST' });
  },

  async resolveAlert(id, note = '') {
    return request(`/api/alerts/${id}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ note })
    });
  },

  async suppressAlert(id, reason = '') {
    return request(`/api/alerts/${id}/suppress`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  // ── Units ─────────────────────────────────────────────────────
  /** @returns {{ success, units, total }} */
  async getUnits(filters = {}) {
    const p = new URLSearchParams();
    if (filters.type)       p.set('type', filters.type);
    if (filters.activeOnly) p.set('activeOnly', 'true');
    const qs = p.toString();
    return request(`/api/units${qs ? `?${qs}` : ''}`);
  },

  /** @returns {{ success, tree }} full command hierarchy, filtered to caller's scope */
  async getUnitsHierarchy() {
    return request('/api/units/hierarchy');
  },

  /** @returns {{ success, unit }} */
  async getUnit(id) {
    return request(`/api/units/${id}`);
  },

  /** @returns {{ success, tree }} subtree rooted at this unit */
  async getUnitSubtree(id) {
    return request(`/api/units/${id}/hierarchy`);
  },

  /** @returns {{ success, unitId, unitCode, directChildCount, activeChildCount, totalDescendantCount, depth }} */
  async getUnitStats(id) {
    return request(`/api/units/${id}/stats`);
  },

  /** @returns {{ success, unit }} */
  async createUnit(params) {
    return request('/api/units', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  /** @returns {{ success, unit }} */
  async updateUnit(id, params) {
    return request(`/api/units/${id}`, {
      method: 'PUT',
      body: JSON.stringify(params)
    });
  },

  /** @returns {{ success, unit }} */
  async deactivateUnit(id) {
    return request(`/api/units/${id}/deactivate`, { method: 'POST' });
  },

  /** @returns {{ success, unit }} */
  async reactivateUnit(id) {
    return request(`/api/units/${id}/reactivate`, { method: 'POST' });
  },

  /** @returns {{ success, unit }} */
  async reassignUnit(id, newParentId) {
    return request(`/api/units/${id}/reassign`, {
      method: 'POST',
      body: JSON.stringify({ newParentId })
    });
  },

  // ── Movement Orders ───────────────────────────────────────────
  /** @returns {{ success, orders, total }} */
  async getMovementOrders(filters = {}) {
    const p = new URLSearchParams();
    if (filters.state)    p.set('state', filters.state);
    if (filters.priority) p.set('priority', filters.priority);
    if (filters.limit)    p.set('limit', String(filters.limit));
    const qs = p.toString();
    return request(`/api/movement/orders${qs ? `?${qs}` : ''}`);
  },

  /** @returns {{ success, order }} */
  async getMovementOrder(id) {
    return request(`/api/movement/orders/${id}`);
  },

  /** @returns {{ success, order }} */
  async createMovementOrder(params) {
    return request('/api/movement/orders', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  /** @returns {{ success, order }} */
  async dispatchMovementOrder(id) {
    return request(`/api/movement/orders/${id}/dispatch`, { method: 'POST' });
  },

  /** @returns {{ success, order }} */
  async deliverMovementOrder(id, receivedQty = null, notes = '') {
    return request(`/api/movement/orders/${id}/deliver`, {
      method: 'POST',
      body: JSON.stringify({ receivedQty, notes })
    });
  },

  /** @returns {{ success, order }} */
  async cancelMovementOrder(id, reason = '') {
    return request(`/api/movement/orders/${id}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  /** @returns {{ success, orders, count }} */
  async getActiveOrdersForUnit(unitId) {
    return request(`/api/movement/orders/unit/${unitId}/active`);
  },

  // ── Inventory / Stock-Take ────────────────────────────────────
  /** @returns {{ success, sessions, total }} */
  async getInventorySessions(unitId, filters = {}) {
    const p = new URLSearchParams();
    p.set('unitId', String(unitId));
    if (filters.state) p.set('state', filters.state);
    if (filters.limit) p.set('limit', String(filters.limit));
    return request(`/api/inventory/sessions?${p.toString()}`);
  },

  async getActiveInventorySession(unitId) {
    return request(`/api/inventory/sessions/active?unitId=${unitId}`);
  },

  /** @returns {{ success, session }} */
  async getInventorySession(id) {
    return request(`/api/inventory/sessions/${id}`);
  },

  /** @returns {{ success, session }} */
  async createInventorySession(params) {
    return request('/api/inventory/sessions', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  /** @returns {{ success, session }} */
  async recordInventoryCount(sessionId, itemId, physicalCount, notes = '') {
    return request(`/api/inventory/sessions/${sessionId}/count`, {
      method: 'POST',
      body: JSON.stringify({ itemId, physicalCount, notes })
    });
  },

  /** @returns {{ success, session }} */
  async finalizeInventorySession(id) {
    return request(`/api/inventory/sessions/${id}/finalize`, { method: 'POST' });
  },

  // ── Users (admin) ─────────────────────────────────────────────
  /** @returns {{ success, users, total }} */
  async getUsers(filters = {}) {
    const p = new URLSearchParams();
    if (filters.role)       p.set('role', filters.role);
    if (filters.search)     p.set('search', filters.search);
    if (filters.unitId)     p.set('unitId', filters.unitId);
    if (filters.activeOnly !== undefined) p.set('activeOnly', filters.activeOnly ? 'true' : 'false');
    if (filters.limit)      p.set('limit', String(filters.limit));
    if (filters.offset)     p.set('offset', String(filters.offset));
    const qs = p.toString();
    return request(`/api/users${qs ? `?${qs}` : ''}`);
  },

  /** @returns {{ success, user }} */
  async createUser(params) {
    return request('/api/users', {
      method: 'POST',
      body: JSON.stringify(params)
    });
  },

  /** @returns {{ success, user }} */
  async deactivateUser(id) {
    return request(`/api/users/${id}/deactivate`, { method: 'POST' });
  },

  /** @returns {{ success, user }} */
  async reactivateUser(id) {
    return request(`/api/users/${id}/reactivate`, { method: 'POST' });
  },

  /** @returns {{ success, user }} */
  async changeUserRole(id, role, unitId) {
    return request(`/api/users/${id}/assign-role`, {
      method: 'POST',
      body: JSON.stringify({ role, unitId })
    });
  },

  /** @returns {{ success, user }} */
  async unlockUser(id) {
    return request(`/api/users/${id}/unlock`, { method: 'POST' });
  },

  // ── CSV Export ────────────────────────────────────────────────
  /**
   * Triggers a CSV file download from the server.
   * Valid types: stock-levels, transfers, unit-roster, mesh-health
   */
  async exportCSV(type, params = {}) {
    const token = getToken();
    const p = new URLSearchParams(params);
    const qs = p.toString();
    const url = `/api/reports/export/${type}${qs ? `?${qs}` : ''}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || `Export failed (${res.status})`, res.status, body);
    }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href  = URL.createObjectURL(blob);
    link.download = `sangam-${type}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    return { success: true };
  },

  // ── Notifications ─────────────────────────────────────────────
  async getNotifications(filters = {}) {
    const p = new URLSearchParams();
    if (filters.unreadOnly) p.set('unreadOnly', 'true');
    if (filters.limit)      p.set('limit', String(filters.limit));
    const qs = p.toString();
    return request(`/api/notifications${qs ? `?${qs}` : ''}`);
  },

  async getUnreadCount() {
    return request('/api/notifications/unread-count');
  },

  /**
   * @returns {{ status, version, nodeEnv, uptime, db: { connected, latencyMs } }}
   * /health intentionally returns HTTP 503 when the database is unreachable
   * (for load-balancer health checks) — the body still carries useful
   * status info in that case, so it's surfaced here rather than thrown.
   */
  async getHealth() {
    try {
      return await request('/health');
    } catch (err) {
      if (err instanceof ApiError && err.payload) return err.payload;
      throw err;
    }
  },

  async markNotificationRead(id) {
    return request(`/api/notifications/${id}/read`, { method: 'POST' });
  },

  async markAllNotificationsRead() {
    return request('/api/notifications/mark-all-read', { method: 'POST' });
  },

  // ── Notification digest & preferences (Day 58) ─────────────────
  // Both routes/service methods existed since notifications were built
  // but had no frontend surface — same pattern as Days 56/57.

  /** @returns {{ success, windowHours, total, unread, pendingAck, bySeverity, byType, items }} */
  async getNotificationDigest(hours = 24) {
    return request(`/api/notifications/digest?hours=${hours}`);
  },

  /** @returns {{ success, preferences: { [type]: boolean } }} */
  async getNotificationPreferences() {
    return request('/api/notifications/preferences');
  },

  /** @returns {{ success, userId, type, enabled }} */
  async setNotificationPreference(type, enabled) {
    return request('/api/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ type, enabled })
    });
  },

  // ── Audit Log (admin only) ────────────────────────────────────
  /** @returns {{ success, entries, total, source }} */
  async getAuditLog(filters = {}) {
    const p = new URLSearchParams();
    if (filters.action)   p.set('action', filters.action);
    if (filters.username) p.set('username', filters.username);
    if (filters.severity) p.set('severity', filters.severity);
    if (filters.limit)    p.set('limit', String(filters.limit));
    if (filters.offset)   p.set('offset', String(filters.offset));
    const qs = p.toString();
    return request(`/api/reports/audit-log${qs ? `?${qs}` : ''}`);
  },

  // Day 71: surfaces RBACService's audit-logs/verify-integrity endpoint
  // (mounted since day-13, never called from anywhere in the frontend
  // until now) — checks the audit log's own cryptographic hash chain
  // for tampering. Requires audit:read (AUDITOR, SYSTEM_ADMIN, and
  // others — see rbac.service.js ROLE_PERMISSIONS).
  async verifyAuditIntegrity(startId = null, limit = 1000) {
    return request('/api/rbac/audit-logs/verify-integrity', {
      method: 'POST',
      body: JSON.stringify({ startId, limit })
    });
  },

  // ── Compliance (Day 56) ────────────────────────────────────────
  // Surfaces ComplianceService (Day 20), which was fully built and
  // mounted at /api/compliance but had zero frontend surface until now.
  //
  // NOTE: getComplianceTransferRegister is intentionally distinct from
  // getTransfers() — it returns an audit-enriched register (auditVerified
  // flag, requestedBy/approvedBy) for compliance review, not the live
  // operational transfer list.

  /** @returns {{ success, itemId, item, eventCount, events, exportedAt }} */
  async getChainOfCustody(itemId) {
    return request(`/api/compliance/chain-of-custody/${itemId}`);
  },

  /** @returns {{ success, transfers, total, limit, offset, generatedAt }} */
  async getComplianceTransferRegister(filters = {}) {
    const p = new URLSearchParams();
    if (filters.status)    p.set('status', filters.status);
    if (filters.startDate) p.set('startDate', filters.startDate);
    if (filters.endDate)   p.set('endDate', filters.endDate);
    if (filters.itemId)    p.set('itemId', filters.itemId);
    if (filters.limit)     p.set('limit', String(filters.limit));
    if (filters.offset)    p.set('offset', String(filters.offset));
    const qs = p.toString();
    return request(`/api/compliance/transfer-register${qs ? `?${qs}` : ''}`);
  },

  /** @returns {{ success, discrepancies, cleanItems, totalItems, discrepancyCount, generatedAt }} */
  async getDiscrepancyReport() {
    return request('/api/compliance/discrepancy-report');
  },

  /** @returns {{ success, entries, total, capped, exportedAt }} */
  async getComplianceAuditExport(filters = {}) {
    const p = new URLSearchParams();
    if (filters.severity)  p.set('severity', filters.severity);
    if (filters.action)    p.set('action', filters.action);
    if (filters.userId)    p.set('userId', filters.userId);
    if (filters.resource)  p.set('resource', filters.resource);
    if (filters.startDate) p.set('startDate', filters.startDate);
    if (filters.endDate)   p.set('endDate', filters.endDate);
    if (filters.limit)     p.set('limit', String(filters.limit));
    const qs = p.toString();
    return request(`/api/compliance/audit-export${qs ? `?${qs}` : ''}`);
  },

  /** @returns {{ success, summary }} */
  async getComplianceSummary() {
    return request('/api/compliance/summary');
  },

  /**
   * Downloads a compliance report as CSV.
   * reportType: 'chain-of-custody' | 'transfer-register' | 'audit-export'
   * itemId is required (and only used) for 'chain-of-custody'.
   */
  async exportComplianceCSV(reportType, params = {}, itemId = null) {
    const token = getToken();
    const p = new URLSearchParams(params);
    p.set('format', 'csv');
    const qs  = p.toString();
    const base = reportType === 'chain-of-custody'
      ? `/api/compliance/chain-of-custody/${itemId}`
      : `/api/compliance/${reportType}`;
    const url = `${base}?${qs}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error || `Export failed (${res.status})`, res.status, body);
    }
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href  = URL.createObjectURL(blob);
    link.download = `sangam-compliance-${reportType}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);
    return { success: true };
  },

  // ── Delegation & Override (Day 57) ─────────────────────────────
  // Surfaces DelegationService (Day 15), mounted at /api/delegation since
  // Day 15 but with zero frontend surface until now. Two mechanisms:
  //   delegation — planned, time-boxed handoff of a permission the
  //                delegator already holds, to one delegate, for one
  //                unit's command tree
  //   override   — emergency, self-issued, single-use, audited as
  //                SECURITY immediately, reviewed after the fact

  /** @returns {{ success, delegation }} or throws ApiError with a server-provided .message */
  async createDelegation({ delegateUserId, permission, unitId, durationHours, reason }) {
    return request('/api/delegation', {
      method: 'POST',
      body: JSON.stringify({ delegateUserId, permission, unitId, durationHours, reason })
    });
  },

  /** @returns {{ success, count, delegations }} — active delegations where I'm the delegate */
  async getMyDelegations() {
    return request('/api/delegation/mine');
  },

  /** @returns {{ success, count, delegations }} — delegations I've granted (any status) */
  async getGrantedDelegations() {
    return request('/api/delegation/granted');
  },

  /** @returns {{ success, delegation }} */
  async revokeDelegation(id, reason) {
    return request(`/api/delegation/${id}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason })
    });
  },

  /** @returns {{ success, override }} */
  async createOverride({ permission, attemptedUnitId, justification, durationMinutes }) {
    return request('/api/delegation/overrides', {
      method: 'POST',
      body: JSON.stringify({ permission, attemptedUnitId, justification, durationMinutes })
    });
  },

  /** @returns {{ success, count, overdueCount, overrides }} — [audit:read] */
  async getPendingReviewOverrides() {
    return request('/api/delegation/overrides/pending-review');
  },

  /** @returns {{ success, override }} — [audit:read] */
  async reviewOverride(id) {
    return request(`/api/delegation/overrides/${id}/review`, { method: 'POST' });
  },

  /** @returns {{ success, totalDelegations, activeDelegations, totalOverrides, activeOverrides, pendingReview, overdueReview }} */
  async getDelegationStats() {
    return request('/api/delegation/stats');
  },
};
