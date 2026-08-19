import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { TOUR_STEPS } from '../data/walkthroughSteps.js';

/**
 * DemoWalkthrough  (Day 50)
 *
 * A guided overlay for live stakeholder presentations. Mounted once at
 * the app shell level (inside .app-layout) so it survives route changes
 * as the tour navigates between pages.
 *
 * Deliberately NON-blocking: the dark backdrop and highlight ring are
 * pointer-events:none, so a presenter can still click anything on the
 * real page mid-tour (e.g. to actually demo an action) without first
 * exiting the tour. Only the tour control panel itself captures clicks.
 *
 * Props:
 *   active   {boolean}     - tour is running
 *   onExit   {() => void}  - called on Exit/Finish
 */
export default function DemoWalkthrough({ active, onExit }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const step = TOUR_STEPS[stepIndex];

  // Reset to step 0 whenever the tour is (re)started
  useEffect(() => { if (active) setStepIndex(0); }, [active]);

  // Navigate to the current step's route
  useEffect(() => {
    if (!active || !step) return;
    if (step.path && location.pathname !== step.path) {
      navigate(step.path);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stepIndex]);

  // Locate + measure the target element, retrying briefly for post-navigation render
  useEffect(() => {
    if (!active || !step) { setRect(null); return; }
    if (!step.target) { setRect(null); return; }

    let cancelled = false;
    let attempts = 0;
    let raf;

    function locate() {
      if (cancelled) return;
      const el = document.querySelector(step.target);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        // Small delay so scrollIntoView settles before measuring
        setTimeout(() => { if (!cancelled) setRect(el.getBoundingClientRect()); }, 220);
      } else if (attempts < 25) {
        attempts++;
        raf = requestAnimationFrame(locate);
      } else {
        setRect(null); // target never appeared — fall back to a centered panel
      }
    }
    raf = requestAnimationFrame(locate);
    return () => { cancelled = true; cancelAnimationFrame(raf); };
  }, [active, stepIndex, location.pathname]);

  // Keep the spotlight aligned on resize/scroll
  useEffect(() => {
    if (!active || !step?.target) return;
    function reposition() {
      const el = document.querySelector(step.target);
      if (el) setRect(el.getBoundingClientRect());
    }
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [active, stepIndex]);

  if (!active || !step) return null;

  const isLast = stepIndex === TOUR_STEPS.length - 1;

  function next() {
    if (!isLast) setStepIndex(i => i + 1);
    else onExit();
  }
  function back() {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  }

  // Anchor the panel near the spotlighted element, clamped to the viewport;
  // otherwise center it.
  const panelStyle = rect ? {
    top:  Math.max(16, Math.min(rect.bottom + 16, window.innerHeight - 260)),
    left: Math.max(16, Math.min(rect.left, window.innerWidth - 380)),
  } : {};

  return (
    <div className="tour-overlay" aria-live="polite">
      {rect && (
        <div
          className="tour-spotlight"
          style={{
            top: rect.top - 8, left: rect.left - 8,
            width: rect.width + 16, height: rect.height + 16
          }}
        />
      )}
      <div className={`tour-panel${rect ? '' : ' tour-panel--centered'}`} style={panelStyle}>
        <div className="tour-panel-step">STEP {stepIndex + 1} OF {TOUR_STEPS.length}</div>
        <h3 className="tour-panel-title">{step.title}</h3>
        <p className="tour-panel-body">{step.body}</p>
        <div className="tour-progress">
          {TOUR_STEPS.map((_, i) => (
            <span key={i} className={`tour-progress-dot${i === stepIndex ? ' tour-progress-dot--active' : ''}`} />
          ))}
        </div>
        <div className="tour-panel-actions">
          <button className="btn btn-ghost btn-sm" onClick={onExit}>EXIT TOUR</button>
          <div className="tour-panel-spacer" />
          {stepIndex > 0 && <button className="btn btn-ghost btn-sm" onClick={back}>← BACK</button>}
          <button className="btn btn-primary btn-sm" onClick={next}>{isLast ? 'FINISH' : 'NEXT →'}</button>
        </div>
      </div>
    </div>
  );
}
