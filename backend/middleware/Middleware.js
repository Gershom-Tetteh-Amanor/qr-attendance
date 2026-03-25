/**
 * Middleware.js — QR Attendance System v7
 * SOLID middleware pipeline.
 * Single Responsibility: guards, input sanitisation, CSRF tokens.
 */

'use strict';

const Middleware = (() => {

  /* ──────────────────────────────────────────
     INPUT SANITISATION  (XSS prevention)
  ────────────────────────────────────────── */

  /** Escape HTML entities — always call before inserting user content into DOM */
  function esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#x27;');
  }

  /** Strip tags, trim, max-length */
  function sanitiseText(s, maxLen = 200) {
    return String(s || '').replace(/<[^>]*>/g, '').trim().slice(0, maxLen);
  }

  /** Validate email — returns cleaned email or null */
  function sanitiseEmail(s) {
    const email = String(s || '').toLowerCase().trim().slice(0, 254);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
  }

  /** Validate and sanitise a Unique ID token (alphanumeric + hyphens) */
  function sanitiseUID(s) {
    return String(s || '').toUpperCase().replace(/[^A-Z0-9\-]/g, '').slice(0, 30);
  }

  /* ──────────────────────────────────────────
     CSRF  (double-submit cookie pattern using sessionStorage)
  ────────────────────────────────────────── */
  const CSRF_KEY = 'qratt_csrf';

  function _genCSRF() {
    const t = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2,'0')).join('');
    try { sessionStorage.setItem(CSRF_KEY, t); } catch {}
    return t;
  }

  function getCSRFToken() {
    let t;
    try { t = sessionStorage.getItem(CSRF_KEY); } catch {}
    if (!t) t = _genCSRF();
    return t;
  }

  function verifyCSRF(token) {
    let stored;
    try { stored = sessionStorage.getItem(CSRF_KEY); } catch {}
    return stored && stored === token;
  }

  /* ──────────────────────────────────────────
     ROUTE GUARDS
  ────────────────────────────────────────── */

  /** Guard a function call — if session is missing or wrong role, redirect to landing */
  function requireRole(role, redirectFn) {
    const session = AuthService.getSession();
    if (!session) { redirectFn?.('landing'); return false; }
    if (role && session.role !== role) { redirectFn?.('landing'); return false; }
    return true;
  }

  function requireAdmin(redirectFn) {
    const session = AuthService.getSession();
    if (!session) { redirectFn?.('admin-login'); return null; }
    if (session.role !== 'superadmin' && session.role !== 'coadmin') { redirectFn?.('admin-login'); return null; }
    return session;
  }

  function requireLecturer(redirectFn) {
    const session = AuthService.getSession();
    if (!session || session.role !== 'lecturer') { redirectFn?.('lec-login'); return null; }
    return session;
  }

  /* ──────────────────────────────────────────
     RATE LIMITER (in-memory, client-side, per action)
  ────────────────────────────────────────── */
  const _rateCounts = {};

  /**
   * Returns true if the action should be blocked.
   * @param {string} key    — e.g. "checkin", "lecSignup"
   * @param {number} max    — max calls allowed in window
   * @param {number} windowMs — time window
   */
  function rateLimited(key, max = 10, windowMs = 60000) {
    const now = Date.now();
    if (!_rateCounts[key]) _rateCounts[key] = { count: 0, reset: now + windowMs };
    if (now > _rateCounts[key].reset) _rateCounts[key] = { count: 0, reset: now + windowMs };
    _rateCounts[key].count++;
    return _rateCounts[key].count > max;
  }

  /* ──────────────────────────────────────────
     PUBLIC
  ────────────────────────────────────────── */
  return {
    esc,
    sanitiseText,
    sanitiseEmail,
    sanitiseUID,
    getCSRFToken,
    verifyCSRF,
    requireRole,
    requireAdmin,
    requireLecturer,
    rateLimited,
  };
})();

window.Middleware = Middleware;
