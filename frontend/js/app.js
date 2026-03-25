/**
 * app.js — QR Attendance System v7
 * Main application controller.
 * All UI interactions live here; all data goes through DataService + AuthService.
 */

'use strict';

/* ──────────────────────────────────────────
   SHORTHAND ALIASES  (set once Utils is loaded)
────────────────────────────────────────── */
const Q      = id => document.getElementById(id);
const esc    = s  => Middleware.esc(s);
const todayStr = () => Utils.todayStr();
const nowTime  = () => Utils.nowTime();
const pad      = n  => Utils.pad(n);
const fmtDur   = m  => Utils.fmtDur(m);

/* ──────────────────────────────────────────
   APPLICATION STATE
────────────────────────────────────────── */
const A = {
  lec: null, session: null,
  locOn: true, lecLat: null, lecLng: null, locAcquired: false,
  tickTimer: null, fbUnsubRec: null, fbUnsubBlk: null,
  stuSession: null, stuCdTimer: null, stuLat: null, stuLng: null,
  uidPg: 0,
};

/* ──────────────────────────────────────────
   VIEW NAVIGATION
────────────────────────────────────────── */
function goTo(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = Q('view-' + view);
  if (el) el.classList.add('active');
  window.scrollTo(0, 0);
  if (view === 'admin-login') checkAdminLoginState();
}

/* ──────────────────────────────────────────
   DARK / LIGHT MODE
────────────────────────────────────────── */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('qratt_theme', t);
  const icon = t === 'dark' ? '☀️' : '🌙';
  document.querySelectorAll('.theme-btn').forEach(b => b.textContent = icon);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = t === 'dark' ? '#0f0f11' : '#4f46e5';
}
function setTheme(t)  { applyTheme(t); }
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

/* ──────────────────────────────────────────
   ════════════════════════════════════════
   ADMIN AUTH
   ════════════════════════════════════════
────────────────────────────────────────── */

/** Called every time admin login view is opened */
async function checkAdminLoginState() {
  const exists = await DataService.superAdminExists();
  if (!exists) {
    Q('sadm-setup').style.display = 'block';
    Q('sadm-login').style.display = 'none';
    Q('al-title').textContent = 'Create Admin Account';
    Q('al-sub').textContent   = 'First-time setup — this only runs once.';
  } else {
    Q('sadm-setup').style.display = 'none';
    Q('sadm-login').style.display = 'block';
    Q('al-title').textContent = 'Admin Portal';
    Q('al-sub').textContent   = 'Sign in with your admin credentials';
  }
}

async function setupSuperAdmin() {
  const name  = Middleware.sanitiseText(Q('sa-name').value);
  const email = Middleware.sanitiseEmail(Q('sa-email').value);
  const pass  = Q('sa-pass').value;
  const pass2 = Q('sa-pass2').value;
  Utils.clrAlert('al-alert');

  if (!name)  return Utils.setAlert('al-alert', 'Full name is required.');
  if (!email) return Utils.setAlert('al-alert', 'Enter a valid email address.');
  const pwCheck = AuthService.validateNewPassword(pass, pass2);
  if (!pwCheck.ok) return Utils.setAlert('al-alert', pwCheck.error);

  Utils.btnLoad('sa-btn', true);

  if (await DataService.superAdminExists()) {
    Utils.btnLoad('sa-btn', false, 'Create admin account');
    return Utils.setAlert('al-alert', 'An admin account already exists. Please sign in.');
  }

  const { hash, salt } = AuthService.hashPassword(pass);
  const sa = {
    id       : AuthService.makeToken(16),
    name, email,
    pwHash   : hash,
    pwSalt   : salt,
    createdAt: new Date().toISOString(),
  };
  await DataService.saveSuperAdmin(sa);
  Utils.btnLoad('sa-btn', false, 'Create admin account');
  Utils.setAlert('al-alert', '✓ Admin account created! Sign in now.', 'ok');
  setTimeout(() => checkAdminLoginState(), 900);
}

async function adminLogin() {
  const email = Middleware.sanitiseEmail(Q('al-email').value);
  const pass  = Q('al-pass').value;
  Utils.clrAlert('al-alert');
  if (!email || !pass) return Utils.setAlert('al-alert', 'Enter your email and password.');

  if (AuthService.isLockedOut(email)) {
    const rem = Math.ceil(AuthService.lockoutRemaining(email) / 60000);
    return Utils.setAlert('al-alert', `Too many failed attempts. Try again in ${rem} minute(s).`);
  }

  Utils.btnLoad('al-login-btn', true);

  /* Try super admin */
  const sa = await DataService.getSuperAdmin();
  if (sa && sa.email === email && AuthService.verifyPassword(pass, { hash: sa.pwHash, salt: sa.pwSalt })) {
    AuthService.clearFailedAttempts(email);
    AuthService.setAdminSession('superadmin', sa);
    Utils.btnLoad('al-login-btn', false, 'Sign in');
    Q('sadm-name-tb').textContent = sa.name;
    goTo('sadmin');
    refreshSAdm();
    return;
  }

  /* Try co-admins */
  const cas = await DataService.getCoAdmins();
  const ca  = cas.find(c => c.email === email);
  if (ca && AuthService.verifyPassword(pass, { hash: ca.pwHash, salt: ca.pwSalt })) {
    if (ca.status === 'pending') { Utils.btnLoad('al-login-btn',false,'Sign in'); return Utils.setAlert('al-alert','Your application is still pending approval.'); }
    if (ca.status === 'revoked') { Utils.btnLoad('al-login-btn',false,'Sign in'); return Utils.setAlert('al-alert','Your co-admin access has been revoked. Contact the administrator.'); }
    AuthService.clearFailedAttempts(email);
    AuthService.setAdminSession('coadmin', ca);
    Utils.btnLoad('al-login-btn', false, 'Sign in');
    Q('cadm-tb-name').textContent  = ca.name;
    Q('cadm-dept-lbl').textContent = ca.department + ' — ' + ca.institution;
    goTo('cadmin');
    refreshCAdm();
    return;
  }

  AuthService.recordFailedAttempt(email);
  Utils.btnLoad('al-login-btn', false, 'Sign in');
  Utils.setAlert('al-alert', 'Invalid email or password.');
}

function adminLogout() {
  AuthService.logout();
  goTo('landing');
}

/* ──────────────────────────────────────────
   CO-ADMIN APPLICATION
────────────────────────────────────────── */
async function coAdminApply() {
  const name  = Middleware.sanitiseText(Q('cs-name').value);
  const email = Middleware.sanitiseEmail(Q('cs-email').value);
  const inst  = Middleware.sanitiseText(Q('cs-inst').value);
  const dept  = Middleware.sanitiseText(Q('cs-dept').value);
  const pass  = Q('cs-pass').value;
  const pass2 = Q('cs-pass2').value;
  Utils.clrAlert('cs-alert');
  if (!name || !email || !inst || !dept) return Utils.setAlert('cs-alert','All fields are required.');
  const pwCheck = AuthService.validateNewPassword(pass, pass2);
  if (!pwCheck.ok) return Utils.setAlert('cs-alert', pwCheck.error);

  if (Middleware.rateLimited('coAdminApply', 3, 300000)) return Utils.setAlert('cs-alert','Too many applications from this device. Please wait.');

  Utils.btnLoad('cs-btn', true);
  if (await DataService.getCoAdminByEmail(email)) {
    Utils.btnLoad('cs-btn',false,'Submit application');
    return Utils.setAlert('cs-alert','An account with this email already exists.');
  }
  const { hash, salt } = AuthService.hashPassword(pass);
  await DataService.saveCoAdmin({
    id: AuthService.makeToken(16), name, email, institution: inst, department: dept,
    pwHash: hash, pwSalt: salt, status: 'pending', createdAt: new Date().toISOString(),
  });
  Utils.btnLoad('cs-btn', false, 'Submit application');
  Utils.setAlert('cs-alert','✓ Application submitted! You can sign in once approved.','ok');
  ['cs-name','cs-email','cs-inst','cs-dept','cs-pass','cs-pass2'].forEach(id => { if (Q(id)) Q(id).value = ''; });
}

/* ──────────────────────────────────────────
   SUPER ADMIN DASHBOARD
────────────────────────────────────────── */
function sTab(tab) {
  document.querySelectorAll('#view-sadmin .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-sadmin .tab-page').forEach(p => p.classList.remove('active'));
  const el = Q('sadm-tab-' + tab); if (el) el.classList.add('active');
  const pg = Q('sadm-pg-'  + tab); if (pg) pg.classList.add('active');
  if (tab === 'ids')       renderUIDs();
  if (tab === 'sessions')  renderSAdmSess();
  if (tab === 'database')  renderSAdmDB();
  if (tab === 'coadmins')  renderCoAdmins();
  if (tab === 'settings')  renderSAdmSettings();
}

async function refreshSAdm() {
  const session = AuthService.getSession();
  if (!session || session.role !== 'superadmin') { goTo('landing'); return; }
  renderUIDs(); renderSAdmSess(); renderSAdmDB(); renderCoAdmins(); renderSAdmSettings();
}

/* Generate UID */
async function generateUID() {
  const forN = Middleware.sanitiseText(Q('uid-for')?.value || '');
  const dept = Middleware.sanitiseText(Q('uid-dept')?.value || '');
  const existing = new Set((await DataService.getUIDs()).map(u => u.id));
  let uid = Utils.genUID(), t = 0;
  while (existing.has(uid) && t++ < 30) uid = Utils.genUID();
  const entry = {
    id: uid, status: 'available',
    intendedFor: forN || '(unspecified)', dept: dept || '',
    createdBy: 'superAdmin', createdAt: new Date().toISOString(), assignedTo: null,
  };
  await DataService.saveUID(entry);
  if (Q('uid-val')) Q('uid-val').textContent = uid;
  if (Q('uid-result')) Q('uid-result').style.display = 'block';
  if (Q('uid-for'))  Q('uid-for').value  = '';
  if (Q('uid-dept')) Q('uid-dept').value = '';
  renderUIDs();
  Utils.toast('Unique ID generated', { type:'success' });
}

async function copyUID() {
  const v = Q('uid-val')?.textContent;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); Utils.toast('Copied: ' + v, { type:'info' }); }
  catch { await Utils.alert('Copy this ID:\n' + v, { title:'Unique ID', icon:'📋' }); }
}

async function revokeUID(id) {
  const ok = await Utils.confirm('Revoke this Unique ID? The lecturer will no longer be able to register with it.', { title:'Revoke ID', type:'error', confirmText:'Revoke' });
  if (!ok) return;
  const all = await DataService.getUIDs();
  const u   = all.find(x => x.id === id);
  if (u) { u.status = 'revoked'; await DataService.saveUID(u); }
  renderUIDs(); Utils.toast('ID revoked', { type:'warning' });
}

const UID_PG = 30;
async function renderUIDs() {
  const filter = Q('uid-filter')?.value || 'all';
  const all = (await DataService.getUIDs()).filter(u => filter === 'all' || u.status === filter);
  if (Q('uid-count')) Q('uid-count').textContent = all.length;
  const start = A.uidPg * UID_PG, page = all.slice(start, start + UID_PG);
  const el = Q('uid-list'); if (!el) return;
  el.innerHTML = page.length ? page.map(u => `
    <div class="att-item">
      <div class="att-dot" style="background:${u.status==='available'?'var(--green-t)':u.status==='revoked'?'var(--danger)':'var(--text4)'}"></div>
      <span style="font-family:monospace;font-weight:700;font-size:13px;color:${u.status==='available'?'var(--primary)':'var(--text3)'}">${esc(u.id)}</span>
      <span class="pill ${u.status==='available'?'green':u.status==='assigned'?'gray':'red'}">${u.status}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(u.intendedFor||'—')}</span>
      <span class="att-time">${new Date(u.createdAt).toLocaleDateString()}</span>
      ${u.status==='available'?`<button class="btn btn-danger btn-sm" onclick="revokeUID('${esc(u.id)}')">Revoke</button>`:''}
    </div>`).join('') : '<div class="no-rec">No IDs match this filter.</div>';
  const tp = Math.max(1, Math.ceil(all.length / UID_PG));
  if (Q('uid-pg-info')) Q('uid-pg-info').textContent = `Page ${A.uidPg+1} of ${tp}`;
  if (Q('uid-pg-sum'))  Q('uid-pg-sum').textContent  = all.length.toLocaleString() + ' IDs';
  if (Q('uid-prev'))    Q('uid-prev').disabled = A.uidPg === 0;
  if (Q('uid-next'))    Q('uid-next').disabled = A.uidPg >= tp - 1;
}
function uidPage(d) {
  DataService.getUIDs().then(all => {
    const tp = Math.max(1, Math.ceil(all.length / UID_PG));
    A.uidPg = Math.max(0, Math.min(A.uidPg + d, tp - 1));
    renderUIDs();
  });
}

async function renderSAdmSess() {
  const iF = Q('s-inst-f')?.value || 'all';
  const lF = Q('s-lec-f')?.value  || 'all';
  let   all = await DataService.getAllSessions();
  if (iF !== 'all') all = all.filter(s => s.institution === iF);
  if (lF !== 'all') all = all.filter(s => s.lecFbId === lF);
  const el = Q('sadm-sess-list'); if (!el) return;
  el.innerHTML = all.length ? all.sort((a,b) => b.date.localeCompare(a.date)).map(s => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--primary)"></div>
      <strong style="font-size:13px">${esc(s.code)}</strong>
      <span style="font-size:13px;color:var(--text2)">${esc(s.course)}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(s.lecturer)}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(s.institution||'')}</span>
      <span class="att-time">${esc(s.date)}</span>
      <span class="badge">${s.attendeeCount||0}</span>
    </div>`).join('') : '<div class="no-rec">No sessions yet.</div>';

  /* Populate filters */
  const institutions = [...new Set(all.map(s=>s.institution).filter(Boolean))];
  const lecturers    = [...new Set(all.map(s=>s.lecFbId))];
  const iSel = Q('s-inst-f'), lSel = Q('s-lec-f');
  if (iSel) {
    const cur = iSel.value;
    iSel.innerHTML = '<option value="all">All institutions</option>' + institutions.map(i=>`<option value="${esc(i)}"${i===cur?' selected':''}>${esc(i)}</option>`).join('');
  }
}

async function renderSAdmDB() {
  const el = Q('sadm-db-list'); if (!el) return;
  const all = await DataService.getAllSessions();
  if (!all.length) { el.innerHTML = '<div class="no-rec">No data yet.</div>'; return; }
  const groups = {};
  for (const s of all) { if (!groups[s.code]) groups[s.code] = []; groups[s.code].push(s); }
  el.innerHTML = Object.entries(groups).map(([code, sessions]) => `
    <div class="inner-panel" style="margin-bottom:10px">
      <strong>${esc(code)}</strong> — ${esc(sessions[0].course)}
      <span class="badge" style="margin-left:8px">${sessions.reduce((n,s)=>n+(s.attendeeCount||0),0)} total attendees</span>
      <div style="font-size:12px;color:var(--text3);margin-top:5px">${sessions.length} session(s)</div>
    </div>`).join('');
}

async function renderCoAdmins() {
  const all     = await DataService.getCoAdmins();
  const pending = all.filter(c => c.status === 'pending');
  const active  = all.filter(c => c.status === 'approved');
  const ps = Q('pending-section'), pl = Q('pending-list');
  if (ps) ps.style.display = pending.length ? 'block' : 'none';
  if (pl) pl.innerHTML = pending.map(c => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--amber)"></div>
      <strong>${esc(c.name)}</strong>
      <span style="font-size:12px;color:var(--text3)">${esc(c.email)}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(c.department)} — ${esc(c.institution)}</span>
      <button class="btn btn-teal btn-sm" onclick="approveCA('${c.id}')">Approve</button>
      <button class="btn btn-danger btn-sm" onclick="rejectCA('${c.id}')">Reject</button>
    </div>`).join('') || '<div class="no-rec">No pending applications.</div>';

  const el = Q('sadm-ca-list');
  if (el) el.innerHTML = active.length ? active.map(c => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--teal)"></div>
      <strong>${esc(c.name)}</strong>
      <span style="font-size:12px;color:var(--text3)">${esc(c.email)}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(c.department)} — ${esc(c.institution)}</span>
      <button class="btn btn-danger btn-sm" onclick="revokeCA('${c.id}')">Revoke</button>
    </div>`).join('') : '<div class="no-rec">No active co-admins.</div>';
}

async function approveCA(id) {
  const ok = await Utils.confirm('Approve this co-admin application?', { title:'Approve Co-Admin', confirmText:'Approve', type:'info' });
  if (!ok) return;
  const ca = await DataService.getCoAdminById(id);
  if (!ca) return;
  await DataService.saveCoAdmin({ ...ca, status: 'approved', approvedAt: new Date().toISOString() });
  renderCoAdmins(); Utils.toast(ca.name + ' approved', { type:'success' });
}

async function rejectCA(id) {
  const ok = await Utils.confirm('Reject and delete this application?', { title:'Reject Application', type:'error', confirmText:'Reject' });
  if (!ok) return;
  await DataService.deleteCoAdmin(id);
  renderCoAdmins(); Utils.toast('Application rejected', { type:'warning' });
}

async function revokeCA(id) {
  const ok = await Utils.confirm('Revoke this co-admin\'s access? They will no longer be able to sign in.', { title:'Revoke Access', type:'error', confirmText:'Revoke' });
  if (!ok) return;
  const ca = await DataService.getCoAdminById(id);
  if (!ca) return;
  await DataService.saveCoAdmin({ ...ca, status: 'revoked' });
  renderCoAdmins(); Utils.toast('Access revoked', { type:'warning' });
}

async function renderSAdmSettings() {
  const lecs = await DataService.getLecturers();
  const sess = await DataService.getAllSessions();
  const uids = await DataService.getUIDs();
  const el   = Q('sadm-stats');
  if (el) el.innerHTML = `
    <strong>System Overview</strong><br/>
    Lecturers: <strong>${lecs.length}</strong> &nbsp;·&nbsp;
    Sessions: <strong>${sess.length}</strong> &nbsp;·&nbsp;
    Unique IDs: <strong>${uids.filter(u=>u.status==='available').length}</strong> available / <strong>${uids.length}</strong> total`;
}

async function changeSAdmPw() {
  const cur  = Q('spw-cur')?.value;
  const nw   = Q('spw-new')?.value;
  const nw2  = Q('spw-new2')?.value;
  Utils.clrAlert('spw-err'); Utils.clrAlert('spw-ok');
  const sa = await DataService.getSuperAdmin();
  if (!sa) return;
  if (!AuthService.verifyPassword(cur, { hash: sa.pwHash, salt: sa.pwSalt })) return Utils.setAlert('spw-err','Current password is incorrect.');
  const check = AuthService.validateNewPassword(nw, nw2);
  if (!check.ok) return Utils.setAlert('spw-err', check.error);
  const { hash, salt } = AuthService.hashPassword(nw);
  await DataService.saveSuperAdmin({ ...sa, pwHash: hash, pwSalt: salt });
  Utils.setAlert('spw-ok', '✓ Password updated.', 'ok');
  ['spw-cur','spw-new','spw-new2'].forEach(id => { if (Q(id)) Q(id).value = ''; });
}

async function resetAll() {
  const ok = await Utils.confirm(
    'This permanently deletes ALL lecturer accounts, sessions, and UIDs. The admin account is kept. This cannot be undone.',
    { title:'⚠️ Reset All Data', type:'error', confirmText:'Yes, delete everything' }
  );
  if (!ok) return;
  const confirm2 = await Utils.prompt('Type DELETE to confirm:', { title:'Final Confirmation', placeholder:'DELETE' });
  if (confirm2 !== 'DELETE') { Utils.toast('Reset cancelled', { type:'info' }); return; }
  await DataService.resetAllData();
  Utils.toast('All data reset', { type:'warning' });
  refreshSAdm();
}

/* ──────────────────────────────────────────
   CO-ADMIN DASHBOARD
────────────────────────────────────────── */
function cTab(tab) {
  document.querySelectorAll('#view-cadmin .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-cadmin .tab-page').forEach(p => p.classList.remove('active'));
  const el = Q('cadm-tab-' + tab); if (el) el.classList.add('active');
  const pg = Q('cadm-pg-'  + tab); if (pg) pg.classList.add('active');
  if (tab === 'ids')       renderCAdmUIDs();
  if (tab === 'lecturers') renderCAdmLecs();
  if (tab === 'sessions')  renderCAdmSess();
  if (tab === 'database')  renderCAdmDB();
}

async function refreshCAdm() {
  const session = AuthService.getSession();
  if (!session || session.role !== 'coadmin') { goTo('landing'); return; }
  renderCAdmUIDs(); renderCAdmLecs(); renderCAdmSess(); renderCAdmDB();
}

async function cAdminGenerateUID() {
  const session = AuthService.getSession();
  const forN = Middleware.sanitiseText(Q('cadm-uid-for')?.value || '');
  const existing = new Set((await DataService.getUIDs()).map(u => u.id));
  let uid = Utils.genUID(), t = 0;
  while (existing.has(uid) && t++ < 30) uid = Utils.genUID();
  const ca = await DataService.getCoAdminById(session?.id);
  await DataService.saveUID({
    id: uid, status: 'available', intendedFor: forN || '(unspecified)',
    dept: ca?.department || '', institution: ca?.institution || '',
    createdBy: session?.id || '?', createdAt: new Date().toISOString(), assignedTo: null,
  });
  if (Q('cadm-uid-val')) Q('cadm-uid-val').textContent = uid;
  if (Q('cadm-uid-result')) Q('cadm-uid-result').style.display = 'block';
  if (Q('cadm-uid-for')) Q('cadm-uid-for').value = '';
  renderCAdmUIDs(); Utils.toast('Unique ID generated', { type:'success' });
}

async function cAdminCopyUID() {
  const v = Q('cadm-uid-val')?.textContent;
  if (!v) return;
  try { await navigator.clipboard.writeText(v); Utils.toast('Copied: ' + v, { type:'info' }); }
  catch { await Utils.alert('Copy this ID:\n' + v, { title:'Unique ID', icon:'📋' }); }
}

async function renderCAdmUIDs() {
  const session = AuthService.getSession();
  const all = (await DataService.getUIDs()).filter(u => u.createdBy === session?.id);
  if (Q('cadm-uid-count')) Q('cadm-uid-count').textContent = all.length;
  const el = Q('cadm-uid-list'); if (!el) return;
  el.innerHTML = all.length ? all.map(u => `
    <div class="att-item">
      <div class="att-dot" style="background:${u.status==='available'?'var(--green-t)':u.status==='revoked'?'var(--danger)':'var(--text4)'}"></div>
      <span style="font-family:monospace;font-weight:700;font-size:13px;color:var(--primary)">${esc(u.id)}</span>
      <span class="pill ${u.status==='available'?'green':u.status==='assigned'?'gray':'red'}">${u.status}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(u.intendedFor||'—')}</span>
      <span class="att-time">${new Date(u.createdAt).toLocaleDateString()}</span>
    </div>`).join('') : '<div class="no-rec">No IDs issued yet.</div>';
}

async function getDeptLecIds() {
  const session = AuthService.getSession();
  const ca = await DataService.getCoAdminById(session?.id);
  if (!ca) return new Set();
  const lecs = await DataService.getLecturers();
  return new Set(lecs.filter(l => l.institution === ca.institution && l.department === ca.department).map(l => l.id));
}

async function renderCAdmLecs() {
  const ids = await getDeptLecIds();
  const all = (await DataService.getLecturers()).filter(l => ids.has(l.id));
  const el  = Q('cadm-lec-list'); if (!el) return;
  el.innerHTML = all.length ? all.map(l => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--primary)"></div>
      <strong>${esc(l.name)}</strong>
      <span style="font-size:12px;color:var(--text3)">${esc(l.email)}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(l.department)}</span>
    </div>`).join('') : '<div class="no-rec">No lecturers in your department yet.</div>';
}

async function renderCAdmSess() {
  const ids = await getDeptLecIds();
  const all = (await DataService.getAllSessions()).filter(s => ids.has(s.lecFbId));
  const el  = Q('cadm-sess-list'); if (!el) return;
  el.innerHTML = all.length ? all.sort((a,b) => b.date.localeCompare(a.date)).map(s => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--primary)"></div>
      <strong>${esc(s.code)}</strong>
      <span style="font-size:13px;color:var(--text2)">${esc(s.course)}</span>
      <span style="font-size:12px;color:var(--text3)">${esc(s.lecturer)}</span>
      <span class="att-time">${esc(s.date)}</span>
      <span class="badge">${s.attendeeCount||0}</span>
    </div>`).join('') : '<div class="no-rec">No sessions yet.</div>';
}

async function renderCAdmDB() {
  const ids  = await getDeptLecIds();
  const all  = (await DataService.getAllSessions()).filter(s => ids.has(s.lecFbId));
  const el   = Q('cadm-db-list'); if (!el) return;
  if (!all.length) { el.innerHTML = '<div class="no-rec">No data yet.</div>'; return; }
  const groups = {};
  for (const s of all) { if (!groups[s.code]) groups[s.code] = []; groups[s.code].push(s); }
  el.innerHTML = Object.entries(groups).map(([code, sessions]) => `
    <div class="inner-panel" style="margin-bottom:10px">
      <strong>${esc(code)}</strong> — ${esc(sessions[0].course)}
      <span class="badge" style="margin-left:8px">${sessions.reduce((n,s)=>n+(s.attendeeCount||0),0)}</span>
      <div style="font-size:12px;color:var(--text3);margin-top:5px">${sessions.length} session(s)</div>
    </div>`).join('');
}

/* ──────────────────────────────────────────
   LECTURER AUTH
────────────────────────────────────────── */
async function lecLogin() {
  const email = Middleware.sanitiseEmail(Q('ll-email')?.value);
  const pass  = Q('ll-pass')?.value;
  Utils.clrAlert('ll-alert');
  if (!email || !pass) return Utils.setAlert('ll-alert','Enter your email and password.');

  if (AuthService.isLockedOut(email)) {
    const rem = Math.ceil(AuthService.lockoutRemaining(email)/60000);
    return Utils.setAlert('ll-alert',`Too many attempts. Try again in ${rem} minute(s).`);
  }

  Utils.btnLoad('ll-btn', true);
  const lec = await DataService.getLecturerByEmail(email);
  if (lec && AuthService.verifyPassword(pass, { hash: lec.pwHash, salt: lec.pwSalt })) {
    AuthService.clearFailedAttempts(email);
    AuthService.setLecSession(lec);
    Utils.btnLoad('ll-btn', false, 'Sign in');
    await activateLec(lec);
    return;
  }
  AuthService.recordFailedAttempt(email);
  Utils.btnLoad('ll-btn', false, 'Sign in');
  Utils.setAlert('ll-alert','Invalid email or password.');
}

async function lecSignup() {
  const uid   = Middleware.sanitiseUID(Q('ls-uid')?.value);
  const name  = Middleware.sanitiseText(Q('ls-name')?.value);
  const dept  = Middleware.sanitiseText(Q('ls-dept')?.value);
  const inst  = Middleware.sanitiseText(Q('ls-inst')?.value);
  const email = Middleware.sanitiseEmail(Q('ls-email')?.value);
  const pass  = Q('ls-pass')?.value;
  const pass2 = Q('ls-pass2')?.value;
  Utils.clrAlert('ls-alert');
  if (!uid||!name||!dept||!inst||!email) return Utils.setAlert('ls-alert','All fields are required.');
  const pwCheck = AuthService.validateNewPassword(pass, pass2);
  if (!pwCheck.ok) return Utils.setAlert('ls-alert', pwCheck.error);

  if (Middleware.rateLimited('lecSignup', 3, 300000)) return Utils.setAlert('ls-alert','Too many signup attempts from this device.');

  Utils.btnLoad('ls-btn', true);
  const claimed = await DataService.claimUID(uid);
  if (!claimed) { Utils.btnLoad('ls-btn',false,'Create account'); return Utils.setAlert('ls-alert','This Unique ID is not valid or has already been used.'); }
  if (await DataService.getLecturerByEmail(email)) {
    Utils.btnLoad('ls-btn',false,'Create account');
    return Utils.setAlert('ls-alert','An account with this email already exists.');
  }
  const { hash, salt } = AuthService.hashPassword(pass);
  const lec = {
    id: AuthService.makeToken(16), name, email, department: dept, institution: inst,
    pwHash: hash, pwSalt: salt, uid, createdAt: new Date().toISOString(),
  };
  await DataService.saveLecturer(lec);
  Utils.btnLoad('ls-btn', false, 'Create account');
  AuthService.setLecSession(lec);
  await activateLec(lec);
}

async function activateLec(lec) {
  A.lec = lec;
  if (Q('lec-tb-name')) Q('lec-tb-name').textContent = lec.name;
  if (Q('lecid-val'))   Q('lecid-val').textContent   = lec.id;
  if (Q('l-lecname'))   Q('l-lecname').value         = lec.name;
  goTo('lecturer');
  await renderLecRecords();
}

function lecLogout() {
  AuthService.logout();
  A.lec = null; A.session = null;
  if (A.tickTimer)   { clearInterval(A.tickTimer); A.tickTimer = null; }
  if (A.fbUnsubRec)  { A.fbUnsubRec(); A.fbUnsubRec = null; }
  if (A.fbUnsubBlk)  { A.fbUnsubBlk(); A.fbUnsubBlk = null; }
  goTo('landing');
}

function lecTab(tab) {
  document.querySelectorAll('#view-lecturer .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-lecturer .tab-page').forEach(p => p.classList.remove('active'));
  const el = Q('lec-tab-' + tab); if (el) el.classList.add('active');
  const pg = Q('lec-pg-'  + tab); if (pg) pg.classList.add('active');
  if (tab === 'records') renderLecRecords();
  if (tab === 'reports') renderLecReports();
}

/* ──────────────────────────────────────────
   LECTURER SESSION (QR generation)
────────────────────────────────────────── */
function getLecLoc() {
  const btn = Q('get-loc-btn'), txt = Q('loc-text'), dot = Q('loc-dot');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>Getting location…'; }
  if (!navigator.geolocation) { _simLecLoc(); return; }
  navigator.geolocation.getCurrentPosition(
    p => {
      A.lecLat = p.coords.latitude; A.lecLng = p.coords.longitude; A.locAcquired = true;
      if (txt) txt.textContent = `✓ ${A.lecLat.toFixed(5)}, ${A.lecLng.toFixed(5)}`;
      if (dot) dot.style.background = 'var(--green-t)';
      if (btn) { btn.disabled = false; btn.textContent = '📍 Location acquired — re-fetch'; }
      if (Q('gen-btn')) { Q('gen-btn').disabled = false; }
      if (Q('gen-hint')) Q('gen-hint').style.display = 'none';
    },
    () => _simLecLoc(),
    { timeout: 8000, maximumAge: 0 }
  );
}

function _simLecLoc() {
  const base = [5.6505, -0.1875];
  A.lecLat = base[0] + (Math.random()-.5)*.01;
  A.lecLng = base[1] + (Math.random()-.5)*.01;
  A.locAcquired = true;
  const btn = Q('get-loc-btn'), txt = Q('loc-text'), dot = Q('loc-dot');
  if (txt) txt.textContent = `⚠ Simulated: ${A.lecLat.toFixed(5)}, ${A.lecLng.toFixed(5)}`;
  if (dot) dot.style.background = 'var(--amber)';
  if (btn) { btn.disabled = false; btn.textContent = '📍 Re-fetch location'; }
  if (Q('gen-btn')) Q('gen-btn').disabled = false;
  if (Q('gen-hint')) Q('gen-hint').style.display = 'none';
}

function toggleLoc() {
  A.locOn = !A.locOn;
  const tog = Q('loc-tog'), lbl = Q('loc-lbl');
  if (tog) tog.classList.toggle('on', A.locOn);
  if (lbl) lbl.textContent = A.locOn ? 'Location fence enabled' : 'Location fence disabled';
}

async function startSession() {
  if (!A.lec) return;
  const code    = Middleware.sanitiseText(Q('l-code')?.value, 20).toUpperCase();
  const course  = Middleware.sanitiseText(Q('l-course')?.value, 100);
  const dur     = parseInt(Q('l-dur')?.value || 60);
  const radius  = parseInt(Q('l-radius')?.value || 100);
  if (!code || !course) {
    Utils.toast('Enter course code and name', { type:'warning' });
    return;
  }
  if (!A.locAcquired) {
    Utils.toast('Get your classroom location first', { type:'warning' });
    return;
  }
  const sessId    = AuthService.makeToken(12);
  const expiresAt = Date.now() + dur * 60000;
  const payload   = {
    id: sessId, token: AuthService.makeToken(8),
    code, course, date: todayStr(), lecturer: A.lec.name, lecId: A.lec.uid, lecFbId: A.lec.id,
    institution: A.lec.institution, department: A.lec.department,
    lat: A.locOn ? A.lecLat : null, lng: A.locOn ? A.lecLng : null,
    radius: A.locOn ? radius : null, expiresAt, createdAt: Date.now(),
  };
  const qrData = Utils.b64e(JSON.stringify(payload));
  const url    = location.origin + location.pathname + '?ci=' + encodeURIComponent(qrData);
  await DataService.saveSession({
    ...payload, status: 'active', attendeeCount: 0,
  });
  A.session = payload;

  /* Render active session UI */
  if (Q('l-si-code'))   Q('l-si-code').textContent   = code;
  if (Q('l-si-course')) Q('l-si-course').textContent = course;
  if (Q('l-si-lec'))    Q('l-si-lec').textContent    = A.lec.name;
  if (Q('l-si-date'))   Q('l-si-date').textContent   = todayStr();
  if (Q('l-si-lecid'))  Q('l-si-lecid').textContent  = A.lec.uid;
  if (Q('l-si-id'))     Q('l-si-id').textContent     = sessId;
  if (Q('l-si-dur'))    Q('l-si-dur').textContent    = fmtDur(dur);
  if (Q('l-lfc-detail')) Q('l-lfc-detail').textContent = A.locOn ? `${A.lecLat?.toFixed(5)}, ${A.lecLng?.toFixed(5)} — ${radius}m fence` : 'No fence';
  if (Q('lec-setup'))  Q('lec-setup').style.display   = 'none';
  if (Q('lec-active')) Q('lec-active').style.display  = 'block';

  /* Generate QR */
  const box = Q('qr-box');
  if (box) { box.innerHTML = ''; new QRCode(box, { text: url, width:240, height:240, correctLevel:QRCode.CorrectLevel.M }); }

  /* Live listeners */
  if (A.fbUnsubRec) A.fbUnsubRec();
  if (A.fbUnsubBlk) A.fbUnsubBlk();
  A.fbUnsubRec = DataService.listenRecords(sessId, recs => { renderLiveAtt(recs); DataService.updateSession(sessId, { attendeeCount: recs.length }); });
  A.fbUnsubBlk = DataService.listenBlocked(sessId, blks => renderLiveBlk(blks));

  /* Countdown */
  lecCdTick(); clearInterval(A.tickTimer); A.tickTimer = setInterval(lecCdTick, 1000);
}

function lecCdTick() {
  if (!A.session) return;
  const rem = Math.max(0, A.session.expiresAt - Date.now());
  const el  = Q('l-cd');
  if (!el) return;
  if (rem === 0) {
    el.textContent = 'Session expired';
    el.className   = 'countdown exp';
    clearInterval(A.tickTimer); A.tickTimer = null;
    Utils.toast('Session expired — end and save records', { type:'warning', duration:6000 });
    return;
  }
  const h = Math.floor(rem/3600000), m = Math.floor((rem%3600000)/60000), s = Math.floor((rem%60000)/1000);
  el.textContent = h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s left` : `${m}:${pad(s)} left`;
  el.className   = 'countdown ' + (rem < 180000 ? 'warn' : 'ok');
}

function renderLiveAtt(recs) {
  const list  = Q('l-att-list');
  const badge = Q('l-att-count');
  const csvBtn = Q('csv-btn');
  if (badge) badge.textContent = recs.length;
  if (csvBtn) csvBtn.style.display = recs.length ? 'inline-block' : 'none';
  if (!list)  return;
  if (!recs.length) { list.innerHTML = '<div class="att-empty">Waiting for students…</div>'; return; }
  list.innerHTML = recs.map(r => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--green-t)"></div>
      <strong style="font-size:13px">${esc(r.name)}</strong>
      <span style="font-size:12px;color:var(--text3)">${esc(r.sid)}</span>
      ${r.locNote ? `<span class="pill teal">${esc(r.locNote)}</span>` : ''}
      <span class="att-time">${esc(r.time)}</span>
    </div>`).join('');
}

function renderLiveBlk(blks) {
  const wrap = Q('l-blk-wrap'), list = Q('l-blk-list'), badge = Q('l-blk-count');
  if (wrap) wrap.style.display = blks.length ? 'block' : 'none';
  if (badge) badge.textContent = blks.length;
  if (list) list.innerHTML = blks.map(b => `
    <div class="att-item">
      <div class="att-dot" style="background:var(--danger)"></div>
      <strong style="font-size:13px">${esc(b.name||'—')}</strong>
      <span style="font-size:12px;color:var(--danger-t)">${esc(b.reason||'—')}</span>
      <span class="att-time">${esc(b.time||'')}</span>
    </div>`).join('');
}

async function endSession() {
  const ok = await Utils.confirm('End this session and save all records?', { title:'End Session', confirmText:'End & Save', type:'info' });
  if (!ok || !A.session) return;
  await DataService.updateSession(A.session.id, { status: 'ended', endedAt: new Date().toISOString() });
  clearInterval(A.tickTimer); A.tickTimer = null;
  if (A.fbUnsubRec) { A.fbUnsubRec(); A.fbUnsubRec = null; }
  if (A.fbUnsubBlk) { A.fbUnsubBlk(); A.fbUnsubBlk = null; }
  if (Q('lec-active')) Q('lec-active').style.display = 'none';
  if (Q('lec-setup'))  Q('lec-setup').style.display  = 'block';
  A.session = null; A.locAcquired = false;
  if (Q('gen-btn'))  Q('gen-btn').disabled = true;
  if (Q('gen-hint')) Q('gen-hint').style.display = '';
  const dot = Q('loc-dot'), txt = Q('loc-text');
  if (dot) dot.style.background = 'var(--border2)';
  if (txt) txt.textContent = '';
  lecTab('records');
  Utils.toast('Session ended and saved', { type:'success' });
}

function downloadQR() {
  const canvas = Q('qr-box')?.querySelector('canvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `QR_${A.session?.code || 'session'}_${todayStr()}.png`;
  a.click();
}

async function exportSessionCSV(id) {
  const recs = await DataService.getRecords(id);
  const sess = await DataService.getSession(id);
  Utils.downloadCSV(
    [['Name','Student ID','Time','Location','Device FP'], ...recs.map(r=>[r.name,r.sid,r.time,r.locNote||'',r.fp||''])],
    `${sess?.code||'session'}_${sess?.date||todayStr()}`
  );
}

async function renderLecRecords() {
  if (!A.lec) return;
  const all = await DataService.getLecturerSessions(A.lec.id);
  const el  = Q('records-list'); if (!el) return;
  if (!all.length) { el.innerHTML = '<div class="no-rec">No completed sessions yet.</div>'; return; }
  el.innerHTML = all.sort((a,b)=>b.createdAt-a.createdAt).map(s=>`
    <div class="att-item">
      <div class="att-dot" style="background:${s.status==='active'?'var(--green-t)':'var(--text4)'}"></div>
      <strong>${esc(s.code)}</strong>
      <span style="font-size:13px;color:var(--text2)">${esc(s.course)}</span>
      <span class="badge">${s.attendeeCount||0}</span>
      <span class="att-time">${esc(s.date)}</span>
      <button class="btn btn-secondary btn-sm" onclick="exportSessionCSV('${s.id}')">CSV</button>
    </div>`).join('');
}

async function renderLecReports() {
  if (!A.lec) return;
  const all = await DataService.getLecturerSessions(A.lec.id);
  const el  = Q('combined-list'); if (!el) return;
  if (!all.length) { el.innerHTML = '<div class="no-rec">No sessions yet.</div>'; return; }
  const groups = {};
  for (const s of all) { if (!groups[s.code]) groups[s.code]=[]; groups[s.code].push(s); }
  el.innerHTML = Object.entries(groups).map(([code, sessions]) => `
    <div class="inner-panel" style="margin-bottom:12px">
      <strong>${esc(code)}</strong> — ${esc(sessions[0].course)}
      <span class="badge" style="margin-left:8px">${sessions.reduce((n,s)=>n+(s.attendeeCount||0),0)} total</span>
      <div style="font-size:12px;color:var(--text3);margin-top:4px">${sessions.length} session(s)</div>
    </div>`).join('');
}

/* ──────────────────────────────────────────
   STUDENT CHECK-IN
────────────────────────────────────────── */
function stuState(state, title, msg) {
  ['loading','invalid','done'].forEach(n => Q('stu-' + n)?.classList.remove('show'));
  if (Q('stu-form')) Q('stu-form').style.display = 'none';
  if (state === 'invalid') {
    Q('stu-invalid')?.classList.add('show');
    if (title && Q('inv-title')) Q('inv-title').textContent = title;
    if (msg   && Q('inv-msg'))   Q('inv-msg').textContent   = msg;
  } else if (state === 'done') {
    Q('stu-done')?.classList.add('show');
    if (msg && Q('done-msg')) Q('done-msg').textContent = msg;
    clearInterval(A.stuCdTimer); A.stuCdTimer = null;
  }
}

async function initStu(ciParam) {
  try {
    const data = JSON.parse(Utils.b64d(decodeURIComponent(ciParam)));
    Q('stu-loading')?.classList.remove('show');
    if (!data?.id || !data?.token) { stuState('invalid','Invalid QR code','Malformed QR. Ask your lecturer for a new one.'); return; }
    if (Date.now() > data.expiresAt) { stuState('invalid','Session expired',`The sign-in window for ${data.code} has closed.`); return; }
    A.stuSession = data;
    const devId = AuthService.deviceId();
    if (await DataService.isDeviceUsed(data.id, devId)) {
      const recs = await DataService.getRecords(data.id);
      const who  = recs.find(r => r.fp === devId);
      stuState('done', null, `Your attendance for ${data.code} has already been recorded${who ? ' as ' + who.name : ''}.`);
      return;
    }
    if (Q('s-code'))   Q('s-code').textContent   = data.code;
    if (Q('s-course')) Q('s-course').textContent = data.course;
    if (Q('s-date'))   Q('s-date').textContent   = data.date;
    if (Q('s-fp'))     Q('s-fp').textContent     = devId.slice(0,6) + '…';
    if (Q('stu-form')) Q('stu-form').style.display = 'block';
    if (data.lat != null) {
      if (Q('loc-btn-row')) Q('loc-btn-row').style.display = 'flex';
      if (Q('no-loc-row'))  Q('no-loc-row').style.display  = 'none';
    } else {
      const lsText = Q('ls-text'); if (lsText) lsText.textContent = 'Location not required for this session';
      const lsBox  = Q('ls-box');  if (lsBox)  lsBox.className    = 'loc-status idle';
    }
    stuCdTick(); clearInterval(A.stuCdTimer); A.stuCdTimer = setInterval(stuCdTick, 1000);
  } catch (e) {
    console.error(e);
    Q('stu-loading')?.classList.remove('show');
    stuState('invalid','Could not read QR code','Please scan again or ask your lecturer for a new one.');
  }
}

function stuCdTick() {
  if (!A.stuSession) return;
  const rem = Math.max(0, A.stuSession.expiresAt - Date.now());
  const el  = Q('s-cd'); if (!el) return;
  if (rem === 0) { el.textContent='Session expired'; el.className='countdown exp'; clearInterval(A.stuCdTimer); stuState('invalid','Session expired','The sign-in window has closed.'); return; }
  const h=Math.floor(rem/3600000), m=Math.floor((rem%3600000)/60000), s=Math.floor((rem%60000)/1000);
  el.textContent = h > 0 ? `${h}h ${pad(m)}m ${pad(s)}s left` : `${m}:${pad(s)} left`;
  el.className   = 'countdown ' + (rem < 180000 ? 'warn' : 'ok');
}

function getStudentLoc() {
  setLS('busy','Fetching your location…');
  if (!navigator.geolocation) { _simStuLoc(); return; }
  navigator.geolocation.getCurrentPosition(
    p => { A.stuLat = p.coords.latitude; A.stuLng = p.coords.longitude; setLS('ok',`Location acquired: ${A.stuLat.toFixed(5)}, ${A.stuLng.toFixed(5)}`); },
    () => _simStuLoc(),
    { timeout: 8000, maximumAge: 0 }
  );
}
function _simStuLoc() {
  const inside = Math.random() > 0.3, base = A.stuSession?.lat ? [A.stuSession.lat, A.stuSession.lng] : [5.6505, -0.1875], d = inside ? 0.0004 : 0.0035;
  A.stuLat = base[0] + (Math.random()-.5)*d*2; A.stuLng = base[1] + (Math.random()-.5)*d*2;
  setLS('ok',`Location acquired: ${A.stuLat.toFixed(5)}, ${A.stuLng.toFixed(5)}`);
}
function setLS(cls, msg) { const b = Q('ls-box'); if (!b) return; b.className = 'loc-status ' + cls; const t = Q('ls-text'); if (t) t.textContent = msg; }

async function checkIn() {
  const nameEl = Q('s-name'), sidEl = Q('s-sid');
  if (!nameEl || !sidEl) return;
  const name = Middleware.sanitiseText(nameEl.value), sid = Middleware.sanitiseText(sidEl.value, 30);
  nameEl.classList.remove('err'); sidEl.classList.remove('err');
  Q('res-ok')?.classList.remove('show'); Q('res-err')?.classList.remove('show');
  if (!name) { nameEl.classList.add('err'); stuErr('Please enter your full name.'); return; }
  if (!sid)  { sidEl.classList.add('err');  stuErr('Student ID is required.'); return; }
  if (!A.stuSession) { stuErr('No session loaded. Scan the QR code again.'); return; }
  if (Date.now() > A.stuSession.expiresAt) { stuErr('This session has expired.'); return; }

  if (Middleware.rateLimited('checkIn', 3, 60000)) { stuErr('Too many check-in attempts. Please wait.'); return; }

  ['ci-btn','ci-btn-loc'].forEach(id => { const b=Q(id); if(b){b.disabled=true;b.innerHTML='<span class="spin"></span>Checking in…';} });
  const id = A.stuSession.id, ns = sid.toUpperCase().trim(), devId = AuthService.deviceId();
  try {
    if (await DataService.isDeviceUsed(id, devId)) {
      const who = (await DataService.getRecords(id)).find(r=>r.fp===devId);
      await DataService.pushBlocked(id, { name, sid, reason:`Device used by ${who?who.name:'another'}`, time:nowTime() });
      stuErr(`This device already checked in${who?' by '+who.name:''}. One device per session.`); resetCiBtn(); return;
    }
    if (await DataService.isSidUsed(id, ns)) {
      const who = (await DataService.getRecords(id)).find(r=>r.sid.toUpperCase()===ns);
      await DataService.pushBlocked(id, { name, sid, reason:`ID used by ${who?who.name:'another'}`, time:nowTime() });
      sidEl.classList.add('err'); stuErr(`Student ID "${sid}" already registered${who?' under '+who.name:''}.`); resetCiBtn(); return;
    }
    const existing = await DataService.getRecords(id);
    if (existing.find(r=>r.name.toLowerCase()===name.toLowerCase())) {
      await DataService.pushBlocked(id, { name, sid, reason:'Name already checked in', time:nowTime() });
      stuErr(`${name} has already checked in.`); resetCiBtn(); return;
    }
    let locNote = '';
    if (A.stuSession.lat != null) {
      if (A.stuLat === null) { stuErr('Location required — tap "Get my location" first.'); resetCiBtn(); return; }
      const dist = Utils.haversine(A.stuLat, A.stuLng, A.stuSession.lat, A.stuSession.lng);
      if (dist > A.stuSession.radius) {
        await DataService.pushBlocked(id, { name, sid, reason:`Too far — ${dist}m (limit ${A.stuSession.radius}m)`, time:nowTime() });
        stuErr(`You are ${dist}m away. Must be within ${A.stuSession.radius}m.`); resetCiBtn(); return;
      }
      locNote = `${dist}m`;
    }
    await DataService.addDevice(id, devId);
    await DataService.addSid(id, ns);
    await DataService.pushRecord(id, { name, sid, fp: devId, time: nowTime(), locNote });
    stuState('done', null, `Attendance for ${A.stuSession.code} — ${A.stuSession.course} on ${A.stuSession.date} recorded successfully.`);
  } catch (e) { stuErr('Error: ' + (e.message||e)); resetCiBtn(); }
}
function resetCiBtn() { ['ci-btn','ci-btn-loc'].forEach(id => { const b=Q(id); if(b){b.disabled=false;b.textContent='Check in';} }); }
function stuErr(msg) { const el=Q('res-err'); if(el){el.innerHTML=`<strong>✗ Check-in failed</strong><br>${esc(msg)}`;el.classList.add('show');} }

/* ──────────────────────────────────────────
   BOOT
────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  /* Init backend services */
  DataService.init();

  /* Service worker */
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

  /* Theme */
  const savedTheme = localStorage.getItem('qratt_theme') || 'light';
  applyTheme(savedTheme);

  /* Online/offline */
  window.addEventListener('online',  () => { Q('offline-bar')?.classList.remove('show'); DataService.processOfflineQueue(); });
  window.addEventListener('offline', () => Q('offline-bar')?.classList.add('show'));
  if (!navigator.onLine) Q('offline-bar')?.classList.add('show');
  if (!DataService.isFirebaseLive()) Q('demo-bar')?.classList.add('show');

  /* QR check-in route */
  const params = new URLSearchParams(location.search), ci = params.get('ci');
  if (ci) { goTo('stu-checkin'); await initStu(ci); return; }

  /* Restore session */
  const session = AuthService.getSession();
  if (session?.role === 'lecturer') {
    const lec = await DataService.getLecturerById(session.id).catch(() => null);
    if (lec) { await activateLec(lec); return; }
  }
  if (session?.role === 'superadmin') {
    const sa = await DataService.getSuperAdmin().catch(() => null);
    if (sa) { Q('sadm-name-tb').textContent = sa.name; goTo('sadmin'); refreshSAdm(); return; }
  }
  if (session?.role === 'coadmin') {
    const ca = await DataService.getCoAdminById(session.id).catch(() => null);
    if (ca) { Q('cadm-tb-name').textContent = ca.name; goTo('cadmin'); refreshCAdm(); return; }
  }

  goTo('landing');
});
