import React, { useEffect, useState, useCallback, Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { api, getToken, clearToken, ApiError } from './api/client.js';
import Sidebar            from './components/Sidebar.jsx';
import KeyboardShortcuts  from './components/KeyboardShortcuts.jsx';
import ErrorBoundary      from './components/ErrorBoundary.jsx';
import LoginPage          from './pages/LoginPage.jsx';
import DashboardPage      from './pages/DashboardPage.jsx';

// Route-based code splitting (Day 51): everything reachable only after
// navigating away from the dashboard is lazy-loaded, so the initial bundle
// a fresh login has to download/parse only includes the login + dashboard
// path. LoginPage and DashboardPage stay eager since they're on every
// session's critical first paint.
const ItemListPage       = lazy(() => import('./pages/ItemListPage.jsx'));
const TransferListPage   = lazy(() => import('./pages/TransferListPage.jsx'));
const TransferCreatePage = lazy(() => import('./pages/TransferCreatePage.jsx'));
const BlockchainPage     = lazy(() => import('./pages/BlockchainPage.jsx'));
const AlertListPage      = lazy(() => import('./pages/AlertListPage.jsx'));
const MovementOrderPage  = lazy(() => import('./pages/MovementOrderPage.jsx'));
const InventoryPage      = lazy(() => import('./pages/InventoryPage.jsx'));
const AuditLogPage       = lazy(() => import('./pages/AuditLogPage.jsx'));
const UserManagementPage = lazy(() => import('./pages/UserManagementPage.jsx'));
const PasswordChangePage = lazy(() => import('./pages/PasswordChangePage.jsx'));
const ReportsPage        = lazy(() => import('./pages/ReportsPage.jsx'));
const UnitsPage          = lazy(() => import('./pages/UnitsPage.jsx'));
const UnitDetailPage     = lazy(() => import('./pages/UnitDetailPage.jsx'));
const AboutPage          = lazy(() => import('./pages/AboutPage.jsx'));
const CompliancePage     = lazy(() => import('./pages/CompliancePage.jsx'));
const DelegationPage     = lazy(() => import('./pages/DelegationPage.jsx'));
const DemoWalkthrough    = lazy(() => import('./components/DemoWalkthrough.jsx'));

/**
 * Root application shell  (Day 32 — sidebar layout)
 *
 * Layout:
 *   .app-layout
 *     <Sidebar>          (fixed 220px left rail, collapses on mobile)
 *     <main.app-main>    (scrolling content area)
 *       <Routes>         (all pages render here without their own TopBar)
 *
 * Session:
 *   On mount, if a stored token exists, verify via /api/auth/me.
 *   User context + logout propagated to all pages via pageProps.
 *
 * pendingCount:
 *   Polled every 60s — shows approval badge on Sidebar Transfers link
 *   for OFFICER+ users.
 */
// Normalize user object: ensure userId is always present regardless of whether
// the API returns `id` or `userId` (login vs. /me endpoints differ).
function normalizeUser(u) {
  if (!u) return null;
  return { ...u, userId: u.userId ?? u.id };
}

export default function App() {
  const [user,         setUser]         = useState(null);
  const [checking,     setChecking]     = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [tourActive,   setTourActive]   = useState(false);

  // ── Session restore ──────────────────────────────────────────
  useEffect(() => {
    const token = getToken();
    if (!token) { setChecking(false); return; }

    api.getMe()
      .then(result => { if (result?.success) setUser(normalizeUser(result.user)); else clearToken(); })
      .catch(err   => { if (err instanceof ApiError) clearToken(); })
      .finally(()  => setChecking(false));
  }, []);

  // ── Pending transfer count (for badge) ───────────────────────
  const refreshPending = useCallback(async () => {
    if (!user || user.rankLevel < 3) return; // OFFICER+ only
    try {
      const res = await api.getTransfers({ status: 'PENDING', limit: 100 });
      if (res?.success && Array.isArray(res.transfers)) {
        setPendingCount(res.transfers.length);
      }
    } catch { /* non-fatal */ }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    refreshPending();
    const id = setInterval(refreshPending, 60_000);
    return () => clearInterval(id);
  }, [user, refreshPending]);

  // ── Logout ───────────────────────────────────────────────────
  async function handleLogout() {
    await api.logout().catch(() => {});
    clearToken();
    setUser(null);
    setPendingCount(0);
  }

  // ── Loading state ────────────────────────────────────────────
  if (checking) {
    return (
      <div className="app-shell">
        <div className="state-screen">
          <div className="spinner" />
          <p className="state-message">Restoring session…</p>
        </div>
      </div>
    );
  }

  // ── Unauthenticated ──────────────────────────────────────────
  if (!user) {
    return (
      <BrowserRouter>
        <div className="app-shell">
          <LoginPage onLoginSuccess={(u) => setUser(normalizeUser(u))} />
        </div>
      </BrowserRouter>
    );
  }

  // ── Common page props ────────────────────────────────────────
  const pageProps = { user, onLogout: handleLogout, onStartTour: () => setTourActive(true) };

  return (
    <BrowserRouter>
      <ErrorBoundary label="The application shell hit an unexpected error.">
        <div className="app-layout">
          <a href="#main-content" className="skip-link">Skip to main content</a>
          <Sidebar
            user={user}
            onLogout={handleLogout}
            pendingCount={pendingCount}
            onStartTour={() => setTourActive(true)}
          />
          <KeyboardShortcuts />
          <main className="app-main" id="main-content" tabIndex={-1}>
            <ErrorBoundary label="This page hit an unexpected error.">
              <Suspense fallback={<div className="state-screen" style={{ minHeight: 300 }}><div className="spinner" /></div>}>
                <Routes>
                  <Route path="/"                       element={<DashboardPage      {...pageProps} />} />
                  <Route path="/supply/items"           element={<ItemListPage       {...pageProps} />} />
                  <Route path="/supply/transfers"       element={<TransferListPage   {...pageProps} onApproveAction={refreshPending} />} />
                  <Route path="/supply/transfers/new"   element={<TransferCreatePage {...pageProps} />} />
                  <Route path="/supply/blockchain"      element={<BlockchainPage     {...pageProps} />} />
                  <Route path="/alerts"                 element={<AlertListPage      {...pageProps} />} />
                  <Route path="/movement"               element={<MovementOrderPage  {...pageProps} />} />
                  <Route path="/inventory"              element={<InventoryPage      {...pageProps} />} />
                  <Route path="/audit"                  element={<AuditLogPage       {...pageProps} />} />
                  <Route path="/admin/users"            element={<UserManagementPage {...pageProps} />} />
                  <Route path="/profile/password"       element={<PasswordChangePage {...pageProps} />} />
                  <Route path="/reports"                element={<ReportsPage        {...pageProps} />} />
                  <Route path="/units"                  element={<UnitsPage          {...pageProps} />} />
                  <Route path="/units/:id"              element={<UnitDetailPage     {...pageProps} />} />
                  <Route path="/about"                  element={<AboutPage          {...pageProps} />} />
                  <Route path="/compliance"             element={<CompliancePage     {...pageProps} />} />
                  <Route path="/delegation"              element={<DelegationPage     {...pageProps} />} />
                  {/* Catch-all → dashboard */}
                  <Route path="*"                       element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </ErrorBoundary>
          </main>
          <Suspense fallback={null}>
            <DemoWalkthrough active={tourActive} onExit={() => setTourActive(false)} />
          </Suspense>
        </div>
      </ErrorBoundary>
    </BrowserRouter>
  );
}
