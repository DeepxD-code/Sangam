import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';

/**
 * PasswordChangePage  (Day 44)
 *
 * Accessible via /profile/password.
 * Validates old password, enforces minimum strength on new password,
 * and confirms with a repeat field before submitting.
 */

const STRENGTH_RULES = [
  { label: 'At least 8 characters',      test: p => p.length >= 8 },
  { label: 'Contains a number',          test: p => /\d/.test(p) },
  { label: 'Contains uppercase letter',  test: p => /[A-Z]/.test(p) },
  { label: 'Contains special character', test: p => /[^A-Za-z0-9]/.test(p) },
];

function strengthScore(p) {
  return STRENGTH_RULES.filter(r => r.test(p)).length;
}

const STRENGTH_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_CLASS = ['', 'pw-weak', 'pw-fair', 'pw-good', 'pw-strong'];

export default function PasswordChangePage({ user, onLogout }) {
  const navigate = useNavigate();
  const [oldPw,   setOldPw]   = useState('');
  const [newPw,   setNewPw]   = useState('');
  const [confirm, setConfirm] = useState('');
  const [error,   setError]   = useState(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const score = strengthScore(newPw);
  const mismatch = confirm && newPw !== confirm;

  async function handleSubmit() {
    setError(null);
    if (!oldPw)          { setError('Current password is required.'); return; }
    if (score < 2)       { setError('New password is too weak — meet at least 2 strength criteria.'); return; }
    if (newPw !== confirm){ setError('Passwords do not match.'); return; }
    if (newPw === oldPw)  { setError('New password must differ from the current one.'); return; }

    setLoading(true);
    try {
      await api.changePassword(oldPw, newPw);
      setSuccess(true);
      setOldPw(''); setNewPw(''); setConfirm('');
    } catch (err) {
      if (err instanceof ApiError) {
        if      (err.status === 401) setError('Current password is incorrect.');
        else if (err.status === 400) setError(err.message || 'Password does not meet requirements.');
        else if (err.status === 503) setError('Database unavailable in offline mode — cannot change password.');
        else                          setError(err.message || 'Failed to change password.');
      } else {
        setError('Unexpected error — please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Change Password</h1>
          <span className="page-subtitle">
            {user?.displayName} · {user?.unitCode || `UNIT ${user?.unitId}`}
          </span>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/')}>← Dashboard</button>
      </div>

      <div className="form-card pw-card">
        {success && (
          <div className="feedback-banner success" style={{ marginBottom: 'var(--sp-4)' }}>
            ✓ Password changed successfully. Use your new password next time you log in.
            <button className="feedback-close" onClick={() => setSuccess(false)}>✕</button>
          </div>
        )}

        {error && (
          <div className="feedback-banner error" style={{ marginBottom: 'var(--sp-4)' }}>
            {error}
            <button className="feedback-close" onClick={() => setError(null)}>✕</button>
          </div>
        )}

        <div className="form-group">
          <label className="form-label" htmlFor="old-pw">Current Password</label>
          <input
            id="old-pw"
            className="form-input"
            type="password"
            autoComplete="current-password"
            value={oldPw}
            onChange={e => setOldPw(e.target.value)}
            disabled={loading}
            placeholder="Your current password"
          />
        </div>

        <div className="pw-divider" />

        <div className="form-group">
          <label className="form-label" htmlFor="new-pw">New Password</label>
          <input
            id="new-pw"
            className="form-input"
            type="password"
            autoComplete="new-password"
            value={newPw}
            onChange={e => setNewPw(e.target.value)}
            disabled={loading}
            placeholder="Choose a strong password"
          />

          {/* Strength meter */}
          {newPw.length > 0 && (
            <div className="pw-strength">
              <div className="pw-strength-bar">
                {[1,2,3,4].map(i => (
                  <div key={i} className={`pw-bar-segment${score >= i ? ` ${STRENGTH_CLASS[score]}` : ''}`} />
                ))}
              </div>
              <span className={`pw-strength-label ${STRENGTH_CLASS[score]}`}>
                {STRENGTH_LABEL[score]}
              </span>
            </div>
          )}

          {/* Requirements checklist */}
          {newPw.length > 0 && (
            <ul className="pw-rules">
              {STRENGTH_RULES.map(r => (
                <li key={r.label} className={`pw-rule${r.test(newPw) ? ' pw-rule-met' : ''}`}>
                  <span className="pw-rule-icon">{r.test(newPw) ? '✓' : '○'}</span>
                  {r.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="confirm-pw">Confirm New Password</label>
          <input
            id="confirm-pw"
            className={`form-input${mismatch ? ' input-error' : ''}`}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            disabled={loading}
            placeholder="Repeat new password"
          />
          {mismatch && <p className="field-error">Passwords do not match.</p>}
        </div>

        <div className="form-actions">
          <button className="btn btn-ghost" onClick={() => navigate('/')} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={loading || score < 2 || mismatch || !oldPw || !newPw}
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
