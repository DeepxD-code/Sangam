import React, { useEffect, useRef } from 'react';

/**
 * Modal  (Day 33; focus trap + restoration added Day 64)
 *
 * Lightweight modal overlay — used for confirmation dialogs and
 * forms that shouldn't navigate away (e.g. reject-reason textarea).
 *
 * Props:
 *   open     {boolean}         - controls visibility
 *   onClose  {() => void}      - called on backdrop click or Escape
 *   title    {string}          - header text
 *   children {ReactNode}       - modal body
 *   actions  {ReactNode}       - footer action buttons (optional)
 *   size     {'sm'|'md'|'lg'}  - defaults to 'md'
 */
export default function Modal({ open, onClose, title, children, actions, size = 'md' }) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  // Auto-focus first focusable element on open; trap Tab within the
  // dialog while open; restore focus to whatever had it before the
  // modal opened once it closes. Before Day 64, Tab past the last
  // focusable element would escape to the page behind the modal, and
  // closing never returned focus anywhere — both are real keyboard/
  // screen-reader gaps affecting every page that uses this component.
  useEffect(() => {
    if (!open) return;
    const el = dialogRef.current;
    if (!el) return;

    previouslyFocused.current = document.activeElement;

    function getFocusable() {
      return Array.from(el.querySelectorAll(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
    }

    const focusable = getFocusable();
    if (focusable.length > 0) focusable[0].focus();

    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;

      const items = getFocusable();
      if (items.length === 0) return;
      const first = items[0];
      const last  = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Restore focus to whatever triggered the modal, but only if it's
      // still attached to the page (it may have been removed/replaced
      // by whatever action the modal performed).
      if (previouslyFocused.current && document.contains(previouslyFocused.current)) {
        previouslyFocused.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div ref={dialogRef} className={`modal-panel modal-${size}`}>
        {/* Header */}
        <div className="modal-header">
          <h2 id="modal-title" className="modal-title">{title}</h2>
          <button
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="modal-body">
          {children}
        </div>

        {/* Footer (optional) */}
        {actions && (
          <div className="modal-footer">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}
