/**
 * DataService.js — QR Attendance System v7
 * SOLID Data-Access Layer.
 * Single Responsibility: read/write to Firebase (primary) or localStorage (offline).
 * Open/Closed: extend by adding new methods — never modify existing ones.
 * Interface Segregation: organised by entity (SA, CoAdmin, Lecturer, Session, UID).
 */

'use strict';

const DataService = (() => {

  /* ──────────────────────────────────────────
     FIREBASE CONFIG  — replace with your own
  ────────────────────────────────────────── */
  const FB_CFG = {
    apiKey            : 'YOUR_API_KEY',
    authDomain        : 'YOUR_PROJECT.firebaseapp.com',
    databaseURL       : 'https://YOUR_PROJECT-default-rtdb.firebaseio.com',
    projectId         : 'YOUR_PROJECT',
    storageBucket     : 'YOUR_PROJECT.appspot.com',
    messagingSenderId : 'YOUR_SENDER_ID',
    appId             : 'YOUR_APP_ID',
  };

  /* ──────────────────────────────────────────
     INTERNAL STATE
  ────────────────────────────────────────── */
  let _fbDb   = null;
  let _fbLive = false;

  /* ──────────────────────────────────────────
     FIREBASE INIT
  ────────────────────────────────────────── */
  function _initFirebase() {
    if (FB_CFG.apiKey.startsWith('YOUR_')) return;
    try {
      if (typeof firebase === 'undefined') return;
      firebase.initializeApp(FB_CFG);
      _fbDb   = firebase.database();
      _fbLive = true;
      _fbDb.ref('.info/connected').on('value', s => {
        if (s.val()) _processOfflineQueue();
      });
    } catch (e) { console.warn('[DataService] Firebase init:', e.message); }
  }

  /* ──────────────────────────────────────────
     OFFLINE QUEUE
  ────────────────────────────────────────── */
  function _enqueue(op) {
    const q = _lsGet('offline_q') || [];
    q.push({ ...op, queuedAt: Date.now() });
    _lsSet('offline_q', q);
  }

  async function _processOfflineQueue() {
    if (!_fbLive) return;
    const q = _lsGet('offline_q') || [];
    if (!q.length) return;
    _lsSet('offline_q', []);
    for (const op of q) {
      try {
        if (op.type === 'set')    await _fbDb.ref(op.path).set(op.data);
        if (op.type === 'update') await _fbDb.ref(op.path).update(op.data);
        if (op.type === 'remove') await _fbDb.ref(op.path).remove();
      } catch (e) { console.warn('[DataService] Queue replay failed:', e.message); }
    }
  }

  /* ──────────────────────────────────────────
     FIREBASE HELPERS (fire-and-forget with queue)
  ────────────────────────────────────────── */
  async function _fbSet(path, data) {
    if (_fbLive) {
      await _fbDb.ref(path).set(data).catch(e => { console.warn(e); _enqueue({ type:'set', path, data }); });
    } else {
      _enqueue({ type:'set', path, data });
    }
  }

  async function _fbGet(path) {
    if (!_fbLive) return null;
    try {
      const snap = await _fbDb.ref(path).once('value');
      return snap.val();
    } catch { return null; }
  }

  async function _fbRemove(path) {
    if (_fbLive) {
      await _fbDb.ref(path).remove().catch(e => _enqueue({ type:'remove', path }));
    } else {
      _enqueue({ type:'remove', path });
    }
  }

  function _fbListen(path, cb) {
    if (!_fbLive) return () => {};
    const ref = _fbDb.ref(path);
    ref.on('value', snap => cb(snap.val()));
    return () => ref.off();
  }

  /* ──────────────────────────────────────────
     LOCALSTORAGE HELPERS
  ────────────────────────────────────────── */
  const _NS = 'qratt7_';
  function _lsGet(k) { try { return JSON.parse(localStorage.getItem(_NS + k)); } catch { return null; } }
  function _lsSet(k, v) { try { localStorage.setItem(_NS + k, JSON.stringify(v)); } catch {} }
  function _lsDel(k)    { try { localStorage.removeItem(_NS + k); } catch {} }

  /* ──────────────────────────────────────────
     SUPER ADMIN  (path: "sa")
     Only one super admin ever exists.
  ────────────────────────────────────────── */
  async function getSuperAdmin() {
    const fb = await _fbGet('sa');
    if (fb) { _lsSet('sa', fb); return fb; }
    return _lsGet('sa');
  }

  async function saveSuperAdmin(sa) {
    _lsSet('sa', sa);
    await _fbSet('sa', sa);
  }

  /** Returns true if a super admin record already exists (used for first-time gate). */
  async function superAdminExists() {
    const sa = await getSuperAdmin();
    return !!sa;
  }

  /* ──────────────────────────────────────────
     CO-ADMINS  (path: "cas/<id>")
  ────────────────────────────────────────── */
  async function getCoAdmins() {
    const fb = await _fbGet('cas');
    if (fb) {
      const list = Object.values(fb);
      _lsSet('cas', list);
      return list;
    }
    return _lsGet('cas') || [];
  }

  async function getCoAdminById(id) {
    const all = await getCoAdmins();
    return all.find(c => c.id === id) || null;
  }

  async function getCoAdminByEmail(email) {
    const all = await getCoAdmins();
    return all.find(c => c.email === email.toLowerCase()) || null;
  }

  async function saveCoAdmin(ca) {
    const all = (_lsGet('cas') || []).filter(c => c.id !== ca.id);
    all.push(ca);
    _lsSet('cas', all);
    await _fbSet('cas/' + ca.id, ca);
  }

  async function deleteCoAdmin(id) {
    _lsSet('cas', (_lsGet('cas') || []).filter(c => c.id !== id));
    await _fbRemove('cas/' + id);
  }

  /* ──────────────────────────────────────────
     LECTURERS  (path: "lecs/<id>")
  ────────────────────────────────────────── */
  async function getLecturers() {
    const fb = await _fbGet('lecs');
    if (fb) { const a = Object.values(fb); _lsSet('lecs', a); return a; }
    return _lsGet('lecs') || [];
  }

  async function getLecturerByEmail(email) {
    const all = await getLecturers();
    return all.find(l => l.email === email.toLowerCase()) || null;
  }

  async function getLecturerById(id) {
    const all = await getLecturers();
    return all.find(l => l.id === id) || null;
  }

  async function saveLecturer(lec) {
    const all = (_lsGet('lecs') || []).filter(l => l.id !== lec.id);
    all.push(lec);
    _lsSet('lecs', all);
    await _fbSet('lecs/' + lec.id, lec);
  }

  async function deleteLecturer(id) {
    _lsSet('lecs', (_lsGet('lecs') || []).filter(l => l.id !== id));
    await _fbRemove('lecs/' + id);
  }

  /* ──────────────────────────────────────────
     UNIQUE IDs  (path: "uids/<sanitised_id>")
  ────────────────────────────────────────── */
  function _sanitiseKey(id) { return id.replace(/[^a-zA-Z0-9]/g, '_'); }

  async function getUIDs() {
    const fb = await _fbGet('uids');
    if (fb) { const a = Object.values(fb); _lsSet('uids', a); return a; }
    return _lsGet('uids') || [];
  }

  async function saveUID(uid) {
    const all = (_lsGet('uids') || []).filter(u => u.id !== uid.id);
    all.push(uid);
    _lsSet('uids', all);
    await _fbSet('uids/' + _sanitiseKey(uid.id), uid);
  }

  /** Claims an available UID atomically. Returns claimed object or null. */
  async function claimUID(uidStr) {
    const all = await getUIDs();
    const idx = all.findIndex(u => u.id === uidStr && u.status === 'available');
    if (idx === -1) return null;
    const claimed = { ...all[idx], status: 'assigned', assignedAt: new Date().toISOString() };
    await saveUID(claimed);
    return claimed;
  }

  /* ──────────────────────────────────────────
     SESSIONS  (path: "sess/<id>")
  ────────────────────────────────────────── */
  async function getAllSessions() {
    const fb = await _fbGet('sess');
    if (fb) { const a = Object.values(fb); _lsSet('sess', a); return a; }
    return _lsGet('sess') || [];
  }

  async function getSession(id) {
    const fb = await _fbGet('sess/' + id);
    if (fb) return fb;
    return (_lsGet('sess') || []).find(s => s.id === id) || null;
  }

  async function saveSession(sess) {
    const all = (_lsGet('sess') || []).filter(s => s.id !== sess.id);
    all.push(sess);
    _lsSet('sess', all);
    await _fbSet('sess/' + sess.id, sess);
  }

  async function updateSession(id, patch) {
    _lsSet('sess', (_lsGet('sess') || []).map(s => s.id === id ? { ...s, ...patch } : s));
    if (_fbLive) await _fbDb.ref('sess/' + id).update(patch).catch(() => {});
  }

  async function getLecturerSessions(lecId) {
    const all = await getAllSessions();
    return all.filter(s => s.lecFbId === lecId);
  }

  /* ──────────────────────────────────────────
     ATTENDANCE RECORDS  (path: "att/<sessId>/rec")
  ────────────────────────────────────────── */
  function _recKey(sessId) { return 'rec_' + sessId; }
  function _blkKey(sessId) { return 'blk_' + sessId; }
  function _devKey(sessId) { return 'dev_' + sessId; }
  function _sidKey(sessId) { return 'sid_' + sessId; }

  async function getRecords(sessId) {
    const fb = await _fbGet('sess/' + sessId + '/records');
    if (fb) { const a = Object.values(fb); _lsSet(_recKey(sessId), a); return a; }
    return _lsGet(_recKey(sessId)) || [];
  }

  async function pushRecord(sessId, rec) {
    const key = AuthService.makeToken(8);
    const full = { ...rec, _key: key };
    const all = (_lsGet(_recKey(sessId)) || []); all.push(full); _lsSet(_recKey(sessId), all);
    await _fbSet('sess/' + sessId + '/records/' + key, full);
  }

  async function getBlocked(sessId) {
    const fb = await _fbGet('sess/' + sessId + '/blocked');
    if (fb) { const a = Object.values(fb); _lsSet(_blkKey(sessId), a); return a; }
    return _lsGet(_blkKey(sessId)) || [];
  }

  async function pushBlocked(sessId, rec) {
    const key = AuthService.makeToken(8);
    const all = (_lsGet(_blkKey(sessId)) || []); all.push(rec); _lsSet(_blkKey(sessId), all);
    await _fbSet('sess/' + sessId + '/blocked/' + key, rec);
  }

  async function isDeviceUsed(sessId, fp) {
    const devs = _lsGet(_devKey(sessId)) || [];
    if (devs.includes(fp)) return true;
    const fb = await _fbGet('sess/' + sessId + '/devices');
    return fb ? Object.values(fb).includes(fp) : false;
  }

  async function addDevice(sessId, fp) {
    const all = _lsGet(_devKey(sessId)) || [];
    if (!all.includes(fp)) { all.push(fp); _lsSet(_devKey(sessId), all); }
    const key = AuthService.makeToken(6);
    await _fbSet('sess/' + sessId + '/devices/' + key, fp);
  }

  async function isSidUsed(sessId, sid) {
    const sids = _lsGet(_sidKey(sessId)) || [];
    if (sids.includes(sid.toUpperCase())) return true;
    const fb = await _fbGet('sess/' + sessId + '/sids');
    return fb ? Object.values(fb).includes(sid.toUpperCase()) : false;
  }

  async function addSid(sessId, sid) {
    const n = sid.toUpperCase();
    const all = _lsGet(_sidKey(sessId)) || [];
    if (!all.includes(n)) { all.push(n); _lsSet(_sidKey(sessId), all); }
    const key = AuthService.makeToken(6);
    await _fbSet('sess/' + sessId + '/sids/' + key, n);
  }

  /* Live listener for records */
  function listenRecords(sessId, cb) { return _fbListen('sess/' + sessId + '/records', v => cb(v ? Object.values(v) : [])); }
  function listenBlocked(sessId, cb) { return _fbListen('sess/' + sessId + '/blocked', v => cb(v ? Object.values(v) : [])); }

  /* ──────────────────────────────────────────
     BACKUPS  (path: "bkp/<key>")
  ────────────────────────────────────────── */
  async function saveBackup(key, data) {
    _lsSet('bkp_' + key, data);
    await _fbSet('bkp/' + key, data);
  }

  /* ──────────────────────────────────────────
     NUKE ALL DATA (danger zone)
  ────────────────────────────────────────── */
  async function resetAllData() {
    ['lecs','sess','uids','cas'].forEach(k => _lsDel(k));
    // also clean up record/device/sid keys
    const keys = Object.keys(localStorage).filter(k => k.startsWith(_NS + 'rec_') || k.startsWith(_NS + 'blk_') || k.startsWith(_NS + 'dev_') || k.startsWith(_NS + 'sid_'));
    keys.forEach(k => localStorage.removeItem(k));
    if (_fbLive) {
      await Promise.all(['lecs','sess','uids','cas'].map(p => _fbDb.ref(p).remove().catch(() => {})));
    }
  }

  /* ──────────────────────────────────────────
     EXPOSE
  ────────────────────────────────────────── */
  return {
    init        : _initFirebase,
    isFirebaseLive: () => _fbLive,
    processOfflineQueue: _processOfflineQueue,

    getSuperAdmin, saveSuperAdmin, superAdminExists,
    getCoAdmins, getCoAdminById, getCoAdminByEmail, saveCoAdmin, deleteCoAdmin,
    getLecturers, getLecturerByEmail, getLecturerById, saveLecturer, deleteLecturer,
    getUIDs, saveUID, claimUID,
    getAllSessions, getSession, saveSession, updateSession, getLecturerSessions,
    getRecords, pushRecord, getBlocked, pushBlocked,
    isDeviceUsed, addDevice, isSidUsed, addSid,
    listenRecords, listenBlocked,
    saveBackup, resetAllData,
  };
})();

window.DataService = DataService;
