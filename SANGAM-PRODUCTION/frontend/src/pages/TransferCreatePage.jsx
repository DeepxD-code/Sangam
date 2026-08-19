import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';

/**
 * Transfer Create Page  (Day 31, refactored Day 32)
 * Sidebar handles navigation; TopBar removed.
 */
export default function TransferCreatePage({ user, onLogout }) {
  const navigate = useNavigate();
  const [items,        setItems]        = useState([]);
  const [units,        setUnits]        = useState([]);
  const [selectedItem, setSelectedItem] = useState('');
  const [toUnitId,     setToUnitId]     = useState('');
  const [quantity,     setQuantity]     = useState('');
  const [notes,        setNotes]        = useState('');
  const [loadingDeps,  setLoadingDeps]  = useState(true);
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState(null);
  const [fieldErrors,  setFieldErrors]  = useState({});

  useEffect(() => {
    setLoadingDeps(true);
    Promise.all([
      api.getSupplyItems().catch(() => ({ items: [] })),
      api.getUnits().catch(() => ({ units: [] }))
    ]).then(([itemsResult, unitsResult]) => {
      setItems(itemsResult.items || []);
      setUnits(unitsResult.units || []);
    }).catch(err => {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError('Failed to load form data');
    }).finally(() => setLoadingDeps(false));
  }, [onLogout]);

  const currentItem = items.find(i => String(i.id) === selectedItem) || null;

  function validate() {
    const errs = {};
    if (!selectedItem) errs.item = 'Select an item';
    if (!toUnitId)     errs.toUnit = 'Select destination unit';
    if (!quantity || isNaN(parseInt(quantity, 10)) || parseInt(quantity, 10) <= 0)
      errs.quantity = 'Enter a valid quantity';
    else if (currentItem && parseInt(quantity, 10) > currentItem.quantity)
      errs.quantity = `Only ${currentItem.quantity} in stock`;
    if (currentItem && String(currentItem.unitId) === toUnitId)
      errs.toUnit = 'Destination cannot be the same as source unit';
    return errs;
  }

  async function handleSubmit() {
    setError(null);
    const errs = validate();
    if (Object.keys(errs).length > 0) { setFieldErrors(errs); return; }
    setFieldErrors({});
    setSubmitting(true);
    try {
      await api.createTransfer({
        itemId:     parseInt(selectedItem, 10),
        fromUnitId: currentItem.unitId,
        toUnitId:   parseInt(toUnitId, 10),
        quantity:   parseInt(quantity, 10),
        notes
      });
      navigate('/supply/transfers');
    } catch (err) {
      setError(err.message || 'Failed to create transfer');
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingDeps) {
    return (
      <div className="page-content">
        <div className="state-screen">
          <div className="spinner" />
          <p className="state-message">Loading form…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">New Transfer Request</h1>
          <span className="page-subtitle">Initiate an inter-unit supply transfer voucher</span>
        </div>
        <button className="btn btn-ghost" onClick={() => navigate('/supply/transfers')}>
          ← CANCEL
        </button>
      </div>

      <div className="form-card">
        {error && <div className="form-error-banner">{error}</div>}

        <div className="form-group">
          <label className="form-label">Supply Item *</label>
          <select
            className={`form-select${fieldErrors.item ? ' input-error' : ''}`}
            value={selectedItem}
            onChange={e => { setSelectedItem(e.target.value); setFieldErrors(f => ({ ...f, item: '' })); }}
          >
            <option value="">— Select item —</option>
            {items.map(i => (
              <option key={i.id} value={i.id}>
                [{i.itemCode}] {i.itemName} · {i.quantity} in stock (U-{i.unitId})
              </option>
            ))}
          </select>
          {fieldErrors.item && <p className="field-error">{fieldErrors.item}</p>}
        </div>

        {currentItem && (
          <div className="form-group">
            <label className="form-label">Source Unit</label>
            <div className="form-readonly">U-{currentItem.unitId} (derived from item)</div>
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Destination Unit *</label>
          <select
            className={`form-select${fieldErrors.toUnit ? ' input-error' : ''}`}
            value={toUnitId}
            onChange={e => { setToUnitId(e.target.value); setFieldErrors(f => ({ ...f, toUnit: '' })); }}
          >
            <option value="">— Select destination —</option>
            {units
              .filter(u => !currentItem || String(u.id) !== String(currentItem.unitId))
              .map(u => (
                <option key={u.id} value={u.id}>[{u.unitCode}] {u.unitName}</option>
              ))}
          </select>
          {fieldErrors.toUnit && <p className="field-error">{fieldErrors.toUnit}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">
            Quantity *
            {currentItem && <span className="form-label-hint"> (max {currentItem.quantity})</span>}
          </label>
          <input
            type="number"
            className={`form-input${fieldErrors.quantity ? ' input-error' : ''}`}
            min="1"
            max={currentItem?.quantity || undefined}
            value={quantity}
            onChange={e => { setQuantity(e.target.value); setFieldErrors(f => ({ ...f, quantity: '' })); }}
            placeholder="0"
          />
          {fieldErrors.quantity && <p className="field-error">{fieldErrors.quantity}</p>}
        </div>

        <div className="form-group">
          <label className="form-label">Notes <span className="form-label-hint">(optional)</span></label>
          <textarea
            className="form-textarea"
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Purpose of transfer, authority reference, etc."
          />
        </div>

        <div className="form-actions">
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/supply/transfers')}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSubmit}
            disabled={submitting}
          >
            {submitting ? 'Submitting…' : 'Submit Transfer Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
