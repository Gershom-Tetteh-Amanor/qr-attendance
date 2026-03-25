/**
 * Utils.js — QR Attendance System v7
 * Shared pure utility functions — no DOM mutations.
 * UI helpers (modal, toast) are also here as they are stateless wrappers.
 */

'use strict';

const Utils = (() => {

  /* ──────────────────────────────────────────
     FORMATTING
  ────────────────────────────────────────── */
  const pad      = n => String(n).padStart(2, '0');
  const todayStr = () => new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  const nowTime  = () => new Date().toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const fmtDur   = m => { if (m < 60) return m + ' min'; const h = Math.floor(m/60), r = m%60; return r ? `${h}h ${r}min` : `${h}h`; };

  /* ──────────────────────────────────────────
     TOKEN GENERATION
  ────────────────────────────────────────── */
  function genUID() {
    const arr = crypto.getRandomValues(new Uint8Array(8));
    return 'LEC-' + Array.from(arr).map(b => b.toString(36)).join('').toUpperCase().slice(0, 10);
  }

  /* ──────────────────────────────────────────
     GEO
  ────────────────────────────────────────── */
  function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000, dL = (lat2 - lat1) * Math.PI/180, dG = (lng2 - lng1) * Math.PI/180;
    const x = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dG/2)**2;
    return Math.round(R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x)));
  }

  /* ──────────────────────────────────────────
     BASE64 URL-SAFE
  ────────────────────────────────────────── */
  const b64e = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const b64d = s => { s = s.replace(/-/g,'+').replace(/_/g,'/'); while (s.length%4) s += '='; return decodeURIComponent(escape(atob(s))); };

  /* ──────────────────────────────────────────
     CSV / EXCEL DOWNLOAD
  ────────────────────────────────────────── */
  function downloadCSV(rows, filename) {
    const csv = rows.map(r => r.map(v => `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const a   = document.createElement('a');
    a.href     = URL.createObjectURL(new Blob([csv], { type:'text/csv;charset=utf-8' }));
    a.download = filename.replace(/[^a-zA-Z0-9_-]/g,'_') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ──────────────────────────────────────────
     MODAL SYSTEM (replaces alert/confirm)
     Renders a modal and returns a Promise.
  ────────────────────────────────────────── */

  let _modalContainer = null;

  function _ensureContainer() {
    if (_modalContainer) return _modalContainer;
    _modalContainer = document.createElement('div');
    _modalContainer.id = 'modal-root';
    document.body.appendChild(_modalContainer);
    return _modalContainer;
  }

  /**
   * Show an alert modal (single OK button).
   * @returns {Promise<void>}
   */
  function alert(message, { title = 'Notice', icon = 'ℹ️', type = 'info' } = {}) {
    return new Promise(resolve => {
      const root = _ensureContainer();
      const id   = 'modal-' + Date.now();
      const colorMap = { info:'var(--primary)', success:'var(--teal)', warning:'var(--amber)', error:'var(--danger)' };
      const color = colorMap[type] || colorMap.info;
      root.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="${id}-overlay" role="dialog" aria-modal="true">
          <div class="modal-box modal-sm" id="${id}">
            <div class="modal-icon" style="color:${color}">${icon}</div>
            <div class="modal-title">${Middleware.esc(title)}</div>
            <div class="modal-body">${Middleware.esc(message)}</div>
            <div class="modal-footer">
              <button class="btn btn-primary modal-ok" id="${id}-ok">OK</button>
            </div>
          </div>
        </div>`);
      const overlay = document.getElementById(id + '-overlay');
      const btn     = document.getElementById(id + '-ok');
      function close() { overlay.classList.add('modal-out'); setTimeout(() => overlay.remove(), 200); resolve(); }
      btn.onclick = close;
      overlay.onclick = e => { if (e.target === overlay) close(); };
      requestAnimationFrame(() => overlay.classList.add('modal-in'));
      btn.focus();
    });
  }

  /**
   * Show a confirm modal (Confirm / Cancel).
   * @returns {Promise<boolean>}
   */
  function confirm(message, { title = 'Confirm', confirmText = 'Confirm', cancelText = 'Cancel', type = 'warning' } = {}) {
    return new Promise(resolve => {
      const root = _ensureContainer();
      const id   = 'modal-' + Date.now();
      const iconMap = { warning:'⚠️', error:'🗑️', info:'❓', success:'✅' };
      const colorMap = { warning:'var(--amber)', error:'var(--danger)', info:'var(--primary)', success:'var(--teal)' };
      root.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="${id}-overlay" role="dialog" aria-modal="true">
          <div class="modal-box modal-sm" id="${id}">
            <div class="modal-icon" style="color:${colorMap[type]||colorMap.warning}">${iconMap[type]||'⚠️'}</div>
            <div class="modal-title">${Middleware.esc(title)}</div>
            <div class="modal-body">${Middleware.esc(message)}</div>
            <div class="modal-footer modal-footer-row">
              <button class="btn btn-secondary" id="${id}-cancel">${Middleware.esc(cancelText)}</button>
              <button class="btn ${type==='error'?'btn-danger':'btn-primary'}" id="${id}-ok">${Middleware.esc(confirmText)}</button>
            </div>
          </div>
        </div>`);
      const overlay = document.getElementById(id + '-overlay');
      function close(val) { overlay.classList.add('modal-out'); setTimeout(() => overlay.remove(), 200); resolve(val); }
      document.getElementById(id + '-ok').onclick     = () => close(true);
      document.getElementById(id + '-cancel').onclick = () => close(false);
      overlay.onclick = e => { if (e.target === overlay) close(false); };
      requestAnimationFrame(() => overlay.classList.add('modal-in'));
      document.getElementById(id + '-ok').focus();
    });
  }

  /**
   * Show a prompt modal (text input + Confirm / Cancel).
   * @returns {Promise<string|null>}  — null if cancelled
   */
  function prompt(message, { title = 'Enter value', placeholder = '', defaultValue = '', type = 'text' } = {}) {
    return new Promise(resolve => {
      const root = _ensureContainer();
      const id   = 'modal-' + Date.now();
      root.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="${id}-overlay" role="dialog" aria-modal="true">
          <div class="modal-box modal-sm" id="${id}">
            <div class="modal-icon" style="color:var(--primary)">✏️</div>
            <div class="modal-title">${Middleware.esc(title)}</div>
            <div class="modal-body">${Middleware.esc(message)}</div>
            <div class="modal-input-wrap">
              <input class="modal-input" id="${id}-input" type="${type}" placeholder="${Middleware.esc(placeholder)}" value="${Middleware.esc(defaultValue)}" autocomplete="off"/>
            </div>
            <div class="modal-footer modal-footer-row">
              <button class="btn btn-secondary" id="${id}-cancel">Cancel</button>
              <button class="btn btn-primary" id="${id}-ok">OK</button>
            </div>
          </div>
        </div>`);
      const overlay = document.getElementById(id + '-overlay');
      const input   = document.getElementById(id + '-input');
      function close(val) { overlay.classList.add('modal-out'); setTimeout(() => overlay.remove(), 200); resolve(val); }
      document.getElementById(id + '-ok').onclick     = () => close(input.value);
      document.getElementById(id + '-cancel').onclick = () => close(null);
      input.onkeydown = e => { if (e.key === 'Enter') close(input.value); if (e.key === 'Escape') close(null); };
      overlay.onclick = e => { if (e.target === overlay) close(null); };
      requestAnimationFrame(() => overlay.classList.add('modal-in'));
      input.focus();
    });
  }

  /* ──────────────────────────────────────────
     TOAST NOTIFICATIONS
  ────────────────────────────────────────── */
  let _toastContainer = null;

  function toast(message, { type = 'info', duration = 3500 } = {}) {
    if (!_toastContainer) {
      _toastContainer = document.createElement('div');
      _toastContainer.id = 'toast-root';
      document.body.appendChild(_toastContainer);
    }
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    _toastContainer.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-in'));
    setTimeout(() => {
      el.classList.remove('toast-in');
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 300);
    }, duration);
  }

  /* ──────────────────────────────────────────
     DOM SHORTCUTS
  ────────────────────────────────────────── */
  const Q    = id  => document.getElementById(id);
  const tgEye = (id, btn) => { const el = Q(id); if (!el) return; el.type = el.type === 'password' ? 'text' : 'password'; btn.textContent = el.type === 'password' ? '👁' : '🙈'; };

  /* ──────────────────────────────────────────
     ALERT ELEMENTS (inline form feedback)
  ────────────────────────────────────────── */
  const setAlert = (id, msg, type = 'err') => { const el = Q(id); if (!el) return; el.textContent = msg; el.className = `alert ${type} show`; };
  const clrAlert = id => { const el = Q(id); if (el) el.className = 'alert'; };
  const btnLoad  = (id, on, label) => { const b = Q(id); if (!b) return; b.disabled = on; b.innerHTML = on ? '<span class="spin"></span>Please wait…' : (label || b.dataset.orig || b.textContent); if (!on && label) b.dataset.orig = label; };

  /* ──────────────────────────────────────────
     PUBLIC
  ────────────────────────────────────────── */
  return {
    pad, todayStr, nowTime, fmtDur,
    genUID, haversine, b64e, b64d,
    downloadCSV,
    alert, confirm, prompt,
    toast,
    Q, tgEye,
    setAlert, clrAlert, btnLoad,
  };
})();

window.Utils = Utils;
/* Friendly aliases */
window.Modal = { alert: Utils.alert, confirm: Utils.confirm, prompt: Utils.prompt };
window.Toast  = Utils.toast;
