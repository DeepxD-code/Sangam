import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { useSearchState } from '../hooks/useSearchState.js';

/**
 * Supply Items drill-down  (Day 29, refactored Day 32; pagination Day 62)
 * Sidebar handles nav; TopBar removed.
 */
const PAGE_SIZE = 50;

export default function ItemListPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [items, setItems]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [categories, setCategories] = useState([]);
  const [filters, setFilters] = useSearchState('items', { search: '', category: '', lowStockOnly: false });
  const { search, category, lowStockOnly } = filters;
  const setSearch      = v => setFilters(f => ({ ...f, search: v }));
  const setCategory    = v => setFilters(f => ({ ...f, category: v }));
  const setLowStockOnly = v => setFilters(f => ({ ...f, lowStockOnly: v }));
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [offset, setOffset]         = useState(0);

  const load = useCallback(async () => {
    try {
      const result = await api.getSupplyItems({
        search: search.trim() || undefined,
        category: category || undefined,
        lowStockOnly,
        limit: PAGE_SIZE,
        offset
      });
      setItems(result.items || []);
      setTotal(result.total ?? (result.items || []).length);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load items');
    } finally {
      setLoading(false);
    }
  }, [search, category, lowStockOnly, offset, onLogout]);

  useEffect(() => {
    api.getSupplyCategories()
      .then(r => setCategories(r.categories || []))
      .catch(() => {});
  }, []);

  // Any filter change starts back at page 1 — an offset from a previous,
  // now-invalid filter combination could otherwise land past the new
  // (likely shorter) result set.
  useEffect(() => {
    setOffset(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, lowStockOnly]);

  useEffect(() => {
    setLoading(true);
    const handle = setTimeout(() => load(), search ? 300 : 0);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, category, lowStockOnly, offset]);

  const totalPages  = Math.ceil(total / PAGE_SIZE) || 1;
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Supply Items</h1>
          <span className="page-subtitle">
            {total} ITEM{total === 1 ? '' : 'S'} IN SCOPE
            {totalPages > 1 ? ` · PAGE ${currentPage}/${totalPages}` : ''}
          </span>
        </div>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Search by name or item code…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search items"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label className={`filter-toggle${lowStockOnly ? ' active' : ''}`}>
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
          />
          LOW STOCK ONLY
        </label>
      </div>

      {error ? <p className="state-error">{error}</p> : null}

      {loading ? (
        <div className="state-screen"><div className="spinner" /></div>
      ) : !error && items.length === 0 ? (
        <div className="table-empty">No items match the current filters.</div>
      ) : (
        <table className="item-table" data-tour="items-table">
          <thead>
            <tr>
              <th>Item Code</th>
              <th>Name</th>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>Quantity</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const isLow = item.lowStockThreshold > 0 && item.quantity < item.lowStockThreshold;
              return (
                <tr key={item.id}>
                  <td className="item-code-cell">{item.itemCode}</td>
                  <td className="item-name-cell">{item.itemName}</td>
                  <td>{item.category}</td>
                  <td className="qty-cell">{item.quantity} {item.unitOfMeasure}</td>
                  <td>
                    <span className={`status-pill ${isLow ? 'low' : 'ok'}`}>
                      {isLow ? 'LOW' : 'OK'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {!loading && !error && totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-sm btn-ghost"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← PREV
          </button>
          <span className="pagination-info">
            PAGE {currentPage} / {totalPages}
          </span>
          <button className="btn btn-sm btn-ghost"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}>
            NEXT →
          </button>
        </div>
      )}
    </div>
  );
}
