import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import Widget         from '../components/Widget.jsx';
import BlockchainSeal from '../components/BlockchainSeal.jsx';
import ActivityFeed   from '../components/ActivityFeed.jsx';

const POLL_INTERVAL_MS = 30 * 1000;
const TOUR_DISMISS_KEY = 'sangam:tourPromptDismissed';

export default function DashboardPage({ user, onLogout, onStartTour }) {
  const [data,     setData]     = useState(null);
  const [error,    setError]    = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [lastSync, setLastSync] = useState(null);
  const [tourDismissed, setTourDismissed] = useState(() => {
    try { return localStorage.getItem(TOUR_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const navigate = useNavigate();

  function handleDismissTour() {
    setTourDismissed(true);
    try { localStorage.setItem(TOUR_DISMISS_KEY, '1'); } catch { /* non-fatal */ }
  }

  const load = useCallback(async (forceRefresh = false) => {
    try {
      const result = await api.getDashboardSummary({ forceRefresh });
      setData(result);
      setError(null);
      setLastSync(
        new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        })
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => {
    load(false);
    const interval = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  if (loading) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <div className="spinner" />
          <p className="state-message">Loading command dashboard…</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={() => { setLoading(true); load(true); }}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const { units, personnel, supply, transfers, movement, blockchain, stocktake, alerts, recentActivity } = data;

  return (
    <div className="page-content">
      {/* Page header */}
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Command Overview</h1>
          <span className="page-subtitle">
            SCOPE: {data.scope.scopeSize} UNIT{data.scope.scopeSize === 1 ? '' : 'S'}
            {data.cached ? ' · CACHED' : ' · LIVE'}
          </span>
        </div>
        <div className="page-header-right">
          {lastSync && (
            <span className="sync-indicator">
              <span className="sync-dot" />
              SYNC {lastSync}
            </span>
          )}
          <button
            className="btn btn-sm"
            onClick={() => { setLoading(true); load(true); }}
            aria-label="Force refresh dashboard"
          >
            ↻ REFRESH
          </button>
        </div>
      </div>

      {onStartTour && !tourDismissed && (
        <div className="tour-prompt">
          <span className="tour-prompt-icon">🧭</span>
          <div className="tour-prompt-body">
            <span className="tour-prompt-title">New to SANGAM?</span>
            <span className="tour-prompt-desc">
              Take the guided tour — command structure, supply chain, blockchain proof of transfer, and alerts.
            </span>
          </div>
          <button className="btn btn-primary btn-sm" onClick={onStartTour}>▶ Start Tour</button>
          <button className="tour-prompt-dismiss" onClick={handleDismissTour} aria-label="Dismiss tour prompt">✕</button>
        </div>
      )}

      {/* Widget grid */}
      <div className="widget-grid">
        <div data-tour="widget-units">
          <Widget
            code="UNT"
            available={units.available}
            headline={units.total}
            unit="UNITS"
            subline={
              <span>
                <span className="status-good">{units.active} ACTIVE</span>
                {units.inactive > 0 ? ` · ${units.inactive} INACTIVE` : ''}
              </span>
            }
            breakdown={units.byType}
            delay={0}
            onClick={user && user.rankLevel >= 4 ? () => navigate('/units') : undefined}
          />
        </div>

        <Widget
          code="PER"
          available={personnel.available}
          headline={personnel.total}
          unit="PERSONNEL"
          subline={
            <span>
              <span className="status-good">{personnel.active} ACTIVE</span>
              {personnel.locked > 0
                ? <span className="status-critical"> · {personnel.locked} LOCKED</span>
                : ''}
            </span>
          }
          breakdown={personnel.byRole}
          delay={1}
        />

        <Widget
          code="SUP"
          available={supply.available}
          headline={supply.totalItems}
          unit="ITEMS"
          subline={
            supply.lowStockCount > 0
              ? <span className="status-warn">{supply.lowStockCount} BELOW THRESHOLD</span>
              : <span className="status-good">STOCK NOMINAL</span>
          }
          breakdown={supply.byCategory}
          delay={2}
          onClick={() => navigate('/supply/items')}
        />

        <BlockchainSeal
          data={blockchain}
          delay={3}
          onClick={() => navigate('/supply/blockchain')}
        />

        <Widget
          code="TRF"
          available={transfers.available}
          headline={transfers.pending}
          unit="PENDING"
          subline={
            <span>
              {transfers.approvalRate} APPROVAL RATE
              {transfers.completedToday > 0 ? ` · ${transfers.completedToday} TODAY` : ''}
            </span>
          }
          delay={4}
          onClick={() => navigate('/supply/transfers')}
        />

        <Widget
          code="MOV"
          available={movement.available}
          headline={movement.activeOrders}
          unit="ACTIVE ORDERS"
          subline={
            <span>
              {movement.inTransit} IN TRANSIT
              {movement.emergencyCount > 0
                ? <span className="status-critical"> · {movement.emergencyCount} EMERGENCY</span>
                : ''}
            </span>
          }
          delay={5}
        />

        <Widget
          code="STK"
          available={stocktake.available}
          headline={stocktake.activeSessions}
          unit="SESSIONS"
          subline={
            stocktake.openDiscrepancies > 0
              ? <span className="status-warn">{stocktake.openDiscrepancies} OPEN DISCREPANCIES</span>
              : <span className="status-good">NO OPEN DISCREPANCIES</span>
          }
          delay={6}
        />

        <Widget
          code="ALT"
          available={alerts ? alerts.available : false}
          headline={alerts?.totalActive ?? 0}
          unit="ACTIVE"
          subline={
            alerts?.available
              ? (
                <span>
                  {alerts.critical > 0
                    ? <span className="status-critical">{alerts.critical} CRITICAL</span>
                    : <span className="status-good">NO CRITICAL</span>}
                  {alerts.escalated > 0
                    ? <span className="status-warn"> · {alerts.escalated} ESCALATED</span>
                    : ''}
                </span>
              )
              : 'Alert engine offline'
          }
          delay={7}
          onClick={() => navigate('/alerts')}
        />
      </div>

      <ActivityFeed entries={recentActivity} />
    </div>
  );
}
