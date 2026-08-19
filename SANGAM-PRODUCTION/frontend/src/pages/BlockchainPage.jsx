import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';

/**
 * Blockchain Ledger Viewer  (Day 31, refactored Day 32)
 * Sidebar handles navigation; TopBar removed.
 */

function shortHash(h) {
  if (!h) return '—';
  return h.slice(0, 8) + '…' + h.slice(-6);
}

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: false
  });
}

function fmtFieldLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase());
}

async function copyToClipboard(text, onDone) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    onDone?.();
  } catch { /* clipboard permissions denied — silently ignore, non-critical */ }
}

export default function BlockchainPage({ user, onLogout }) {
  const navigate = useNavigate();
  const [blocks,       setBlocks]       = useState([]);
  const [totalBlocks,  setTotalBlocks]  = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [verifyResult, setVerifyResult] = useState(null);
  const [verifying,    setVerifying]    = useState(false);
  const [expanded,     setExpanded]     = useState(new Set());
  const [copiedField,  setCopiedField]  = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.getBlockchain(50);
      setBlocks(result.blocks || []);
      setTotalBlocks(result.totalBlocks || 0);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { onLogout(); return; }
      setError(err.message || 'Failed to load blockchain');
    } finally {
      setLoading(false);
    }
  }, [onLogout]);

  useEffect(() => { load(); }, [load]);

  async function handleVerify() {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const result = await api.verifyBlockchain();
      setVerifyResult(result);
    } catch (err) {
      setVerifyResult({ verified: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  }

  function toggleExpand(blockIndex) {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(blockIndex) ? next.delete(blockIndex) : next.add(blockIndex);
      return next;
    });
  }

  function handleCopy(field, value) {
    copyToClipboard(value, () => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(c => (c === field ? null : c)), 1500);
    });
  }

  return (
    <div className="page-content">
      <div className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Blockchain Ledger</h1>
          <span className="page-subtitle">
            {totalBlocks} TOTAL BLOCKS · SHOWING LAST {blocks.length}
          </span>
        </div>
        <div className="page-header-right">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/supply/transfers')}>
            View Transfers
          </button>
          <button
            className={`btn btn-verify${verifyResult ? (verifyResult.verified ? ' verified' : ' tampered') : ''}`}
            onClick={handleVerify}
            disabled={verifying}
            data-tour="verify-chain-btn"
          >
            {verifying ? 'VERIFYING…' : '⬡ VERIFY CHAIN'}
          </button>
        </div>
      </div>

      {verifyResult && (
        <div className={`verify-banner ${verifyResult.verified ? 'verified' : 'tampered'}`}>
          {verifyResult.verified ? (
            <span>✓ CHAIN INTEGRITY VERIFIED — {verifyResult.blockCount} blocks, no tampering detected</span>
          ) : (
            <span>
              ✗ TAMPER DETECTED — {verifyResult.tampered?.length || 0} block(s) flagged:&nbsp;
              {verifyResult.tampered?.map(b => `#${b.blockIndex}`).join(', ')}
              {verifyResult.error ? ` (${verifyResult.error})` : ''}
            </span>
          )}
        </div>
      )}

      {loading ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <div className="spinner" />
        </div>
      ) : error ? (
        <div className="state-screen" style={{ minHeight: 200 }}>
          <p className="state-error">{error}</p>
          <button className="btn btn-primary" onClick={load}>Retry</button>
        </div>
      ) : blocks.length === 0 ? (
        <div className="table-empty">
          No blocks in ledger. Approve a transfer to create the first block.
        </div>
      ) : (
        <div className="blockchain-list">
          {blocks.map(block => {
            const flagged = verifyResult?.tampered?.some(t => t.blockIndex === block.blockIndex);
            const isOpen  = expanded.has(block.blockIndex);
            return (
              <div key={block.blockIndex} className={`block-card${flagged ? ' block-tampered' : ''}${isOpen ? ' block-card--expanded' : ''}`}>
                <button
                  className="block-card-trigger"
                  onClick={() => toggleExpand(block.blockIndex)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? 'Collapse' : 'Expand'} block ${block.blockIndex} details`}
                >
                  <div className="block-index">
                    <span className="block-expand-caret">{isOpen ? '▾' : '▸'}</span>
                    #{block.blockIndex}
                  </div>
                  <div className="block-meta">
                    <div className="block-hash">
                      <span className="block-label">HASH</span>
                      <span className="block-value mono">{shortHash(block.blockHash)}</span>
                    </div>
                    <div className="block-prev">
                      <span className="block-label">PREV</span>
                      <span className="block-value mono">{shortHash(block.previousHash)}</span>
                    </div>
                    <div className="block-time">
                      <span className="block-label">TIME</span>
                      <span className="block-value">{fmtTime(block.timestamp)}</span>
                    </div>
                  </div>
                  {block.transactionData && (
                    <div className="block-tx">
                      <span className="block-label">TX</span>
                      <span className="block-value">
                        {block.transactionData.itemCode || block.transactionData.itemId}
                        {block.transactionData.quantity ? ` · ${block.transactionData.quantity} units` : ''}
                        {block.transactionData.fromUnitId
                          ? ` · U-${block.transactionData.fromUnitId} → U-${block.transactionData.toUnitId}`
                          : ''}
                      </span>
                    </div>
                  )}
                  {flagged && (
                    <div className="block-flag">⚠ HASH MISMATCH — THIS BLOCK HAS BEEN TAMPERED WITH</div>
                  )}
                </button>

                {isOpen && (
                  <div className="block-detail-panel">
                    <div className="block-detail-row">
                      <span className="block-detail-label">Block Hash</span>
                      <span className="block-detail-value mono">{block.blockHash}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleCopy('hash-' + block.blockIndex, block.blockHash)}>
                        {copiedField === 'hash-' + block.blockIndex ? 'COPIED' : 'COPY'}
                      </button>
                    </div>
                    <div className="block-detail-row">
                      <span className="block-detail-label">Previous Hash</span>
                      <span className="block-detail-value mono">{block.previousHash}</span>
                      <button className="btn btn-sm btn-ghost" onClick={() => handleCopy('prev-' + block.blockIndex, block.previousHash)}>
                        {copiedField === 'prev-' + block.blockIndex ? 'COPIED' : 'COPY'}
                      </button>
                    </div>
                    <div className="block-detail-row">
                      <span className="block-detail-label">Timestamp</span>
                      <span className="block-detail-value">{block.timestamp}</span>
                    </div>

                    {block.transactionData && (
                      <>
                        <div className="block-detail-divider">TRANSACTION DATA</div>
                        {Object.entries(block.transactionData).map(([key, value]) => (
                          <div className="block-detail-row" key={key}>
                            <span className="block-detail-label">{fmtFieldLabel(key)}</span>
                            <span className="block-detail-value">{String(value)}</span>
                          </div>
                        ))}
                        {block.transactionData.transferId && (
                          <button
                            className="btn btn-sm btn-primary"
                            style={{ marginTop: 'var(--sp-3)' }}
                            onClick={() => navigate('/supply/transfers', {
                              state: { openTransferId: block.transactionData.transferId }
                            })}
                          >
                            VIEW SOURCE TRANSFER →
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
