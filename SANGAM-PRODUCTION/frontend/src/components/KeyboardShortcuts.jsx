import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * KeyboardShortcuts  (Day 64)
 *
 * GitHub-style "g then a letter" navigation, plus "?" to show this
 * overlay listing every shortcut. Mounted once near the root of the
 * authenticated app shell (App.jsx), not per-page.
 *
 * Ignored entirely while focus is inside an input, textarea, select, or
 * any contentEditable element — this only ever fires between actions,
 * never while someone is typing a search term or a form field.
 */
const ROUTES = [
  { key: 'd', label: 'Dashboard',   path: '/' },
  { key: 'i', label: 'Items',       path: '/supply/items' },
  { key: 't', label: 'Transfers',   path: '/supply/transfers' },
  { key: 'b', label: 'Blockchain',  path: '/supply/blockchain' },
  { key: 'a', label: 'Alerts',      path: '/alerts' },
  { key: 'm', label: 'Movement',    path: '/movement' },
  { key: 'v', label: 'Inventory',   path: '/inventory' },
  { key: 'r', label: 'Reports',     path: '/reports' },
  { key: 'u', label: 'Units',       path: '/units' },
  { key: 'c', label: 'Compliance',  path: '/compliance' },
  { key: 'l', label: 'Delegation',  path: '/delegation' },
];

const CHORD_TIMEOUT_MS = 1500;

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export default function KeyboardShortcuts() {
  const navigate = useNavigate();
  const [showHelp, setShowHelp] = useState(false);
  const pendingG = useRef(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    function clearPending() {
      pendingG.current = false;
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    }

    function onKeyDown(e) {
      if (isTypingTarget(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape' && showHelp) { setShowHelp(false); return; }

      if (e.key === '?') {
        e.preventDefault();
        setShowHelp(v => !v);
        return;
      }

      if (pendingG.current) {
        const route = ROUTES.find(r => r.key === e.key.toLowerCase());
        clearPending();
        if (route) {
          e.preventDefault();
          navigate(route.path);
        }
        return;
      }

      if (e.key === 'g') {
        pendingG.current = true;
        timeoutRef.current = setTimeout(clearPending, CHORD_TIMEOUT_MS);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearPending();
    };
  }, [navigate, showHelp]);

  if (!showHelp) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      onClick={(e) => { if (e.target === e.currentTarget) setShowHelp(false); }}
    >
      <div className="modal-panel modal-sm">
        <div className="modal-header">
          <h2 id="shortcuts-title" className="modal-title">Keyboard Shortcuts</h2>
          <button className="modal-close" aria-label="Close" onClick={() => setShowHelp(false)}>✕</button>
        </div>
        <div className="modal-body">
          <div className="shortcuts-list">
            {ROUTES.map(r => (
              <div key={r.key} className="shortcuts-row">
                <span className="shortcuts-keys">
                  <kbd>g</kbd> <kbd>{r.key}</kbd>
                </span>
                <span className="shortcuts-label">{r.label}</span>
              </div>
            ))}
            <div className="shortcuts-row">
              <span className="shortcuts-keys"><kbd>?</kbd></span>
              <span className="shortcuts-label">Show / hide this help</span>
            </div>
            <div className="shortcuts-row">
              <span className="shortcuts-keys"><kbd>Esc</kbd></span>
              <span className="shortcuts-label">Close a dialog</span>
            </div>
          </div>
          <p className="shortcuts-hint">Ignored while typing in a field.</p>
        </div>
      </div>
    </div>
  );
}
