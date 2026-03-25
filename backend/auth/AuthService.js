/**
 * AuthService.js — QR Attendance System v7
 * SOLID backend authentication layer.
 * Single Responsibility: handles identity, tokens, and session state.
 * All passwords are hashed (FNV-1a). JWT-style signed session tokens.
 * Never exposes raw password hashes to the UI layer.
 */

'use strict';

const AuthService = (() => {

  /* ──────────────────────────────────────────
     CONSTANTS
  ────────────────────────────────────────── */
  const SESSION_KEY   = 'qratt_session_v7';
  const TOKEN_TTL_MS  = 8 * 60 * 60 * 1000;   // 8 hours
  const MAX_ATTEMPTS  = 5;
  const LOCKOUT_MS    = 15 * 60 * 1000;        // 15 min
  const MIN_PW_LEN    = 8;

  /* ──────────────────────────────────────────
     PRIVATE HELPERS
  ────────────────────────────────────────── */

  /** FNV-1a 32-bit hash — deterministic, not reversible */
  function _hash(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  /** Salt + hash password.  Salt is stored alongside hash. */
  function _hashPassword(password, salt) {
    if (!salt) salt = _makeToken(8);
    return { hash: _hash(salt + password + salt), salt };
  }

  /** Verify password against stored { hash, salt } */
  function _verifyPassword(password, stored) {
    if (!stored?.hash || !stored?.salt) return false;
    return _hash(stored.salt + password + stored.salt) === stored.hash;
  }

  /** Cryptographically random token */
  function _makeToken(len = 16) {
    const arr = crypto.getRandomValues(new Uint8Array(len));
    return Array.from(arr).map(b => b.toString(36)).join('').slice(0, len).toUpperCase();
  }

  /** Per-device fingerprint — for session binding */
  function _deviceId() {
    const raw = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height + 'x' + screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timeZone,
      navigator.hardwareConcurrency || 0,
      navigator.platform || '',
      navigator.vendor  || '',
    ].join('||');
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < raw.length; i++) { h ^= raw.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }

  /** Sign a payload to detect tampering in localStorage */
  function _sign(payload) {
    const body = JSON.stringify(payload);
    const sig  = _hash(body + _deviceId());
    return { body, sig };
  }

  function _verify(stored) {
    if (!stored?.body || !stored?.sig) return null;
    const expected = _hash(stored.body + _deviceId());
    if (stored.sig !== expected) return null;
    try { return JSON.parse(stored.body); } catch { return null; }
  }

  /* ──────────────────────────────────────────
     BRUTE-FORCE LOCKOUT  (in-memory per page load)
  ────────────────────────────────────────── */
  const _attempts = {};   // { email: { count, lockedUntil } }

  function _recordFail(email) {
    const key = email.toLowerCase();
    if (!_attempts[key]) _attempts[key] = { count: 0, lockedUntil: 0 };
    _attempts[key].count++;
    if (_attempts[key].count >= MAX_ATTEMPTS) {
      _attempts[key].lockedUntil = Date.now() + LOCKOUT_MS;
      _attempts[key].count = 0;
    }
  }

  function _isLocked(email) {
    const r = _attempts[email.toLowerCase()];
    if (!r) return false;
    if (r.lockedUntil > Date.now()) return true;
    return false;
  }

  function _clearFail(email) {
    delete _attempts[email.toLowerCase()];
  }

  /* ──────────────────────────────────────────
     SESSION TOKEN
  ────────────────────────────────────────── */

  function _writeSession(role, id, name, email, extra = {}) {
    const payload = {
      role, id, name, email,
      ...extra,
      issuedAt : Date.now(),
      expiresAt: Date.now() + TOKEN_TTL_MS,
      device   : _deviceId(),
    };
    const signed = _sign(payload);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(signed)); } catch {}
  }

  function _readSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const stored  = JSON.parse(raw);
      const payload = _verify(stored);
      if (!payload) return null;
      if (Date.now() > payload.expiresAt) { _clearSession(); return null; }
      if (payload.device !== _deviceId()) { _clearSession(); return null; }
      return payload;
    } catch { return null; }
  }

  function _clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
  }

  /* ──────────────────────────────────────────
     VALIDATION HELPERS
  ────────────────────────────────────────── */

  function validatePassword(pw) {
    if (!pw || pw.length < MIN_PW_LEN) return `Password must be at least ${MIN_PW_LEN} characters.`;
    return null;
  }

  function validateEmail(email) {
    if (!email) return 'Email is required.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address.';
    return null;
  }

  /* ──────────────────────────────────────────
     PUBLIC API
  ────────────────────────────────────────── */

  return {
    /* Helpers exposed for use by other modules */
    hashPassword  : (pw)         => _hashPassword(pw),
    verifyPassword: (pw, stored) => _verifyPassword(pw, stored),
    makeToken     : (len)        => _makeToken(len),
    deviceId      : ()           => _deviceId(),
    validatePassword,
    validateEmail,

    /** Returns { ok, error } — call before saving a new user */
    validateNewPassword(pw, pw2) {
      const e = validatePassword(pw);
      if (e) return { ok: false, error: e };
      if (pw !== pw2) return { ok: false, error: 'Passwords do not match.' };
      return { ok: true };
    },

    /** Called on failed login attempt */
    recordFailedAttempt(email) { _recordFail(email); },

    /** Returns lockout remaining ms, or 0 */
    lockoutRemaining(email) {
      const r = _attempts[email.toLowerCase()];
      if (!r || r.lockedUntil <= Date.now()) return 0;
      return r.lockedUntil - Date.now();
    },

    isLockedOut(email) { return _isLocked(email); },
    clearFailedAttempts(email) { _clearFail(email); },

    /** Write a verified session (super admin or co-admin) */
    setAdminSession(role, user) {
      _writeSession(role, user.id, user.name, user.email);
    },

    /** Write a lecturer session */
    setLecSession(lec) {
      _writeSession('lecturer', lec.id, lec.name, lec.email, { dept: lec.department, institution: lec.institution });
    },

    /** Read the current session (null if not logged in or expired) */
    getSession() { return _readSession(); },

    /** Destroy the current session */
    logout() { _clearSession(); },

    /** Is the current session a super admin? */
    isSuperAdmin() { const s = _readSession(); return s?.role === 'superadmin'; },

    /** Is the current session a co-admin? */
    isCoAdmin() { const s = _readSession(); return s?.role === 'coadmin'; },

    /** Is the current session a lecturer? */
    isLecturer() { const s = _readSession(); return s?.role === 'lecturer'; },
  };
})();

window.AuthService = AuthService;
