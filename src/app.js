import { initializeApp } from 'firebase/app';
import {
  initializeAuth, indexedDBLocalPersistence, inMemoryPersistence, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword,
  EmailAuthProvider, reauthenticateWithCredential
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager, doc, getDoc, setDoc,
  deleteDoc, updateDoc, collection, query, where, onSnapshot, serverTimestamp
} from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { firebaseConfig } from './firebase-config.js';

/* ---------- utilitare ---------- */
const DOMAIN = 'pontaj.himbeerhof.app';
const $ = (s, r = document) => r.querySelector(s);
const root = $('#app');
const modal = $('#modal');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const dstr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = () => dstr(new Date());
const thisMonth = () => today().slice(0, 7);
const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
const DAYS = ['Du', 'Lu', 'Ma', 'Mi', 'Jo', 'Vi', 'Sâ'];
const monthName = m => { const [y, mm] = m.split('-').map(Number); return `${MONTHS[mm - 1]} ${y}`; };
const fmtDate = ds => { const [y, m, d] = ds.split('-').map(Number); const dt = new Date(y, m - 1, d); return `${DAYS[dt.getDay()]} ${pad(d)}.${pad(m)}.${y}`; };
const toMin = t => { if (!t) return null; const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function calcTotal(start, end, pause) {
  const s = toMin(start), e = toMin(end);
  if (s == null || e == null) return null;
  let d = e - s; if (d < 0) d += 1440;
  return d - (Number(pause) || 0);
}
const fmtH = min => (min == null || isNaN(min)) ? '–' : `${min < 0 ? '-' : ''}${Math.floor(Math.abs(min) / 60)}h ${pad(Math.abs(min) % 60)}m`;
const fmtDec = min => (min / 60).toFixed(2).replace('.', ',');
const slug = s => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9._-]/g, '');
const toEmail = u => u.includes('@') ? u.trim().toLowerCase() : `${slug(u)}@${DOMAIN}`;
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'ro');
const pauseLabel = v => v === 0 ? 'fără pauză' : v < 60 ? `${v} min` : `${Math.floor(v / 60)} h${v % 60 ? ` ${v % 60} min` : ''}`;
const zile = n => n === 1 ? '1 zi' : `${n} zile`;
const PAUSES = [0, 15, 20, 30, 45, 60, 75, 90, 105, 120, 150, 180];

function errText(e) {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Utilizator sau parolă greșită.';
  if (c.includes('network')) return 'Nu există conexiune la internet.';
  if (c.includes('weak-password')) return 'Parola trebuie să aibă cel puțin 6 caractere.';
  if (c.includes('email-already-in-use')) return 'Acest nume de utilizator există deja.';
  if (c.includes('invalid-email')) return 'Nume de utilizator / e-mail invalid.';
  if (c.includes('too-many-requests')) return 'Prea multe încercări. Așteaptă puțin.';
  if (c.includes('permission-denied')) return 'Nu ai drept pentru această acțiune.';
  if (c.includes('requires-recent-login')) return 'Ieși și intră din nou, apoi reîncearcă.';
  return 'Eroare: ' + (e?.message || e);
}

/* ---------- Firebase ---------- */
const configured = !!firebaseConfig?.apiKey && !firebaseConfig.apiKey.startsWith('PUNE');
let fbApp, auth, db;
if (configured) {
  fbApp = initializeApp(firebaseConfig);
  auth = initializeAuth(fbApp, { persistence: indexedDBLocalPersistence });
  db = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentSingleTabManager() }) });
}

let me = null;          // { uid, email, admin, name }
let subs = [];          // dezabonări onSnapshot
let settingUp = false;
const unsubAll = () => { subs.forEach(u => { try { u(); } catch { } }); subs = []; };
const entryId = (uid, date) => `${uid}_${date}`;

/* ---------- formular zi (comun angajat / admin) ---------- */
function dayFormHtml(e = {}, { dateEditable = true, maxDate = today() } = {}) {
  const p = e.pauseMin ?? 30;
  const opts = (PAUSES.includes(p) ? PAUSES : [...PAUSES, p].sort((a, b) => a - b))
    .map(v => `<option value="${v}" ${v === p ? 'selected' : ''}>${pauseLabel(v)}</option>`).join('');
  return `
    <label>Data</label>
    <input type="date" name="date" value="${esc(e.date || today())}" max="${maxDate}" ${dateEditable ? '' : 'disabled'}>
    <div class="row">
      <div><label>Început</label><input type="time" name="start" value="${esc(e.start || '')}"></div>
      <div><label>Sfârșit</label><input type="time" name="end" value="${esc(e.end || '')}"></div>
    </div>
    <label>Pauze (în total)</label>
    <select name="pause">${opts}</select>
    <label>Mențiuni</label>
    <textarea name="note" placeholder="ex.: cules zmeură, piața Lindau…">${esc(e.note || '')}</textarea>
    <div class="total"><span>Total ore lucrate</span><b data-total>–</b></div>`;
}
function readForm(f) {
  const v = n => f.querySelector(`[name="${n}"]`).value;
  const start = v('start'), end = v('end'), pauseMin = Number(v('pause')) || 0;
  return { date: v('date'), start, end, pauseMin, note: v('note').trim(), totalMin: calcTotal(start, end, pauseMin) };
}
function validate(d) {
  if (!d.date) return 'Alege data.';
  if (d.date > today()) return 'Nu poți trece ore pentru o zi viitoare.';
  if (!d.start || !d.end) return 'Completează ora de început și de sfârșit.';
  if (d.totalMin == null || d.totalMin <= 0) return 'Pauza este mai mare decât timpul lucrat — verifică orele.';
  if (d.totalMin > 16 * 60) return 'Peste 16 ore într-o zi — verifică orele.';
  return null;
}
function wireTotal(f) {
  const upd = () => { const d = readForm(f); $('[data-total]', f).textContent = fmtH(d.totalMin); };
  f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
}
function fillForm(f, e) {
  const set = (n, val) => { const el = f.querySelector(`[name="${n}"]`); if (el) el.value = val; };
  set('start', e?.start || ''); set('end', e?.end || ''); set('note', e?.note || '');
  const sel = f.querySelector('[name="pause"]');
  const p = e?.pauseMin ?? 30;
  if (![...sel.options].some(o => Number(o.value) === p)) sel.insertAdjacentHTML('beforeend', `<option value="${p}">${pauseLabel(p)}</option>`);
  sel.value = String(p);
  f.dispatchEvent(new Event('change'));
}
function saveEntry(uid, name, d) {
  const data = { uid, name, date: d.date, start: d.start, end: d.end, pauseMin: d.pauseMin, note: d.note, totalMin: d.totalMin, updatedAt: serverTimestamp(), updatedBy: me.uid };
  // fără await: funcționează și fără internet, se sincronizează automat
  return setDoc(doc(db, 'entries', entryId(uid, d.date)), data);
}
function changedLater(e) {
  const t = e.updatedAt?.toDate?.(); if (!t) return '';
  const late = dstr(t) > e.date && (t - new Date(e.date + 'T23:59:59')) > 36 * 3600e3;
  const byAdmin = e.updatedBy && e.updatedBy !== e.uid;
  const parts = [];
  if (late) parts.push(`modificat pe ${fmtDate(dstr(t))}`);
  if (byAdmin && me?.admin) parts.push('corectat de tine');
  return parts.length ? `<div class="flag">⚠ ${parts.join(' · ')}</div>` : '';
}

/* ---------- ecran neconfigurat ---------- */
function renderNotConfigured() {
  root.innerHTML = `<div class="login"><div class="logo">🫐</div><h1>Pontaj Himbeerhof</h1>
  <div class="card"><p>Aplicația nu este încă legată de serverul Firebase.</p><p class="muted small">Pune datele proiectului în <code>src/firebase-config.js</code> și compilează din nou.</p></div></div>`;
}

/* ---------- autentificare ---------- */
async function renderLogin() {
  root.innerHTML = `<div class="login">
    <div class="logo">🫐</div><h1>Pontaj</h1><p class="center muted" style="padding:0 0 16px">Himbeerhof</p>
    <form class="card" id="f">
      <label>Utilizator</label><input name="u" autocomplete="username" autocapitalize="none" required>
      <label>Parolă</label><input name="p" type="password" autocomplete="current-password" required>
      <button class="btn">Intră</button><div class="msg err" id="m"></div>
    </form>
    <div class="center hidden" id="setup" style="padding:0"><button class="link" id="go-setup">Prima configurare (administrator)</button></div>
  </div>`;
  $('#f').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target; const b = $('button', f); b.disabled = true; $('#m').textContent = '';
    try { await signInWithEmailAndPassword(auth, toEmail(f.u.value), f.p.value); }
    catch (e) { $('#m').textContent = errText(e); b.disabled = false; }
  };
  $('#go-setup').onclick = renderSetup;
  try { const s = await getDoc(doc(db, 'config', 'admin')); if (!s.exists()) $('#setup')?.classList.remove('hidden'); } catch { }
}

function renderSetup() {
  root.innerHTML = `<div class="login"><div class="logo">🫐</div><h1>Configurare</h1>
    <form class="card" id="f">
      <p class="small muted" style="margin-top:0">Se face o singură dată, pe telefonul tău. Contul creat aici devine administrator și vede orele tuturor.</p>
      <label>E-mailul tău</label><input name="e" type="email" autocapitalize="none" required>
      <label>Parolă (min. 6 caractere)</label><input name="p" type="password" required minlength="6">
      <label>Repetă parola</label><input name="p2" type="password" required minlength="6">
      <button class="btn">Creează cont administrator</button><div class="msg err" id="m"></div>
    </form><div class="center" style="padding:0"><button class="link" id="back">Înapoi</button></div></div>`;
  $('#back').onclick = renderLogin;
  $('#f').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target;
    if (f.p.value !== f.p2.value) return $('#m').textContent = 'Parolele nu coincid.';
    const b = $('button', f); b.disabled = true; settingUp = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, f.e.value.trim(), f.p.value);
      await setDoc(doc(db, 'config', 'admin'), { uid: cred.user.uid, email: cred.user.email, createdAt: serverTimestamp() });
      settingUp = false; onUser(cred.user);
    } catch (e) {
      settingUp = false; b.disabled = false; $('#m').textContent = errText(e);
      if (auth.currentUser) { try { await auth.currentUser.delete(); } catch { } }
    }
  };
}

async function onUser(user) {
  unsubAll(); closeModal();
  if (!configured) return renderNotConfigured();
  if (!user) { me = null; return renderLogin(); }
  if (settingUp) return;
  root.innerHTML = `<div class="center muted">Se încarcă…</div>`;
  try {
    const a = await getDoc(doc(db, 'config', 'admin'));
    if (a.exists() && a.data().uid === user.uid) {
      me = { uid: user.uid, email: user.email, admin: true, name: 'Administrator' };
      return renderAdmin();
    }
    const u = await getDoc(doc(db, 'users', user.uid));
    if (!u.exists() || u.data().active === false) {
      root.innerHTML = `<div class="login"><div class="card center"><p>Contul tău nu este activ.</p><p class="small muted">Vorbește cu administratorul.</p><button class="btn sec" id="lo">Ieșire</button></div></div>`;
      $('#lo').onclick = () => signOut(auth); return;
    }
    me = { uid: user.uid, email: user.email, admin: false, name: u.data().name };
    renderEmployee();
  } catch (e) {
    root.innerHTML = `<div class="login"><div class="card center"><p>${esc(errText(e))}</p><button class="btn" id="re">Reîncearcă</button><button class="btn sec" id="lo">Ieșire</button></div></div>`;
    $('#re').onclick = () => onUser(auth.currentUser); $('#lo').onclick = () => signOut(auth);
  }
}

/* ---------- modal ---------- */
function openModal(html) { modal.innerHTML = `<div class="sheet">${html}</div>`; modal.classList.remove('hidden'); }
function closeModal() { modal.classList.add('hidden'); modal.innerHTML = ''; }
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

function openPasswordModal() {
  openModal(`<h2>Schimbă parola</h2><form id="pf">
    <label>Parola actuală</label><input name="o" type="password" required>
    <label>Parola nouă (min. 6)</label><input name="n" type="password" required minlength="6">
    <button class="btn">Salvează</button><button type="button" class="btn sec" id="cx">Renunță</button><div class="msg" id="pm"></div></form>`);
  $('#cx').onclick = closeModal;
  $('#pf').onsubmit = async ev => {
    ev.preventDefault(); const f = ev.target; const m = $('#pm');
    try {
      await reauthenticateWithCredential(auth.currentUser, EmailAuthProvider.credential(auth.currentUser.email, f.o.value));
      await updatePassword(auth.currentUser, f.n.value);
      m.className = 'msg ok'; m.textContent = 'Parola a fost schimbată ✓'; setTimeout(closeModal, 1200);
    } catch (e) { m.className = 'msg err'; m.textContent = errText(e); }
  };
}

function header(title) {
  return `<header class="top"><h1>${esc(title)}</h1><button id="pw">Parolă</button><button id="lo">Ieșire</button></header>`;
}
function wireHeader() { $('#pw').onclick = openPasswordModal; $('#lo').onclick = () => signOut(auth); }

/* ---------- ANGAJAT ---------- */
function renderEmployee() {
  let entries = {};
  let viewMonth = thisMonth();
  root.innerHTML = `${header('Bună, ' + me.name)}<main>
    <form class="card" id="day"><h2>Ziua mea de lucru</h2>${dayFormHtml()}
      <button class="btn" id="save">Salvează ziua</button>
      <button type="button" class="btn danger hidden" id="del">Șterge ziua</button>
      <div class="msg" id="m"></div></form>
    <div class="card"><div class="row" style="align-items:center"><h2 style="margin:0">Orele mele</h2>
      <input type="month" id="mon" value="${viewMonth}" max="${thisMonth()}" style="max-width:170px"></div>
      <div class="stats" style="margin:14px 0 4px"><div class="stat"><b id="sumH">–</b><span>ore</span></div><div class="stat"><b id="sumD">–</b><span>zile</span></div></div>
      <ul class="list" id="lst"></ul></div></main>`;
  wireHeader();
  const f = $('#day'); wireTotal(f);
  const dateEl = f.querySelector('[name="date"]');
  const msg = (t, ok) => { const m = $('#m'); m.className = 'msg ' + (ok ? 'ok' : 'err'); m.textContent = t; };
  const syncForm = () => {
    const e = entries[dateEl.value];
    fillForm(f, e);
    $('#save').textContent = e ? 'Actualizează ziua' : 'Salvează ziua';
    $('#del').classList.toggle('hidden', !e);
  };
  dateEl.addEventListener('change', () => { msg(''); syncForm(); });
  f.onsubmit = ev => {
    ev.preventDefault();
    const d = readForm(f); const err = validate(d); if (err) return msg(err);
    const existed = !!entries[d.date];
    saveEntry(me.uid, me.name, d).catch(e => msg(errText(e)));
    msg(existed ? `Actualizat ✓ (${fmtH(d.totalMin)})` : `Salvat ✓ — ${fmtH(d.totalMin)} pe ${fmtDate(d.date)}`, true);
  };
  $('#del').onclick = () => {
    const d = dateEl.value; if (!entries[d]) return;
    if ($('#del').dataset.sure !== d) { $('#del').dataset.sure = d; $('#del').textContent = 'Apasă din nou pentru a șterge'; return; }
    delete $('#del').dataset.sure; $('#del').textContent = 'Șterge ziua';
    deleteDoc(doc(db, 'entries', entryId(me.uid, d))).catch(e => msg(errText(e)));
    msg('Ziua a fost ștearsă.', true);
  };
  $('#mon').onchange = e => { viewMonth = e.target.value || thisMonth(); renderList(); };
  function renderList() {
    const list = Object.values(entries).filter(e => e.date.startsWith(viewMonth)).sort((a, b) => b.date.localeCompare(a.date));
    $('#sumH').textContent = fmtDec(list.reduce((s, e) => s + (e.totalMin || 0), 0));
    $('#sumD').textContent = list.length;
    $('#lst').innerHTML = list.length ? list.map(e => `<li class="tap" data-d="${e.date}"><div class="grow"><div class="name">${fmtDate(e.date)}</div>
      <div class="sub">${esc(e.start)}–${esc(e.end)} · pauză ${e.pauseMin} min</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}</div>
      <div class="right hours">${fmtH(e.totalMin)}</div></li>`).join('') : `<li class="muted">Nicio zi trecută în ${monthName(viewMonth)}.</li>`;
  }
  $('#lst').onclick = e => {
    const li = e.target.closest('li[data-d]'); if (!li) return;
    dateEl.value = li.dataset.d; msg(''); syncForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  subs.push(onSnapshot(query(collection(db, 'entries'), where('uid', '==', me.uid)), snap => {
    entries = {}; snap.forEach(d => { const e = d.data(); entries[e.date] = e; });
    if (!f.dataset.touched) syncForm();
    renderList();
  }, e => msg(errText(e))));
  f.addEventListener('input', () => { f.dataset.touched = '1'; });
  dateEl.addEventListener('change', () => { delete f.dataset.touched; });
}

/* ---------- ADMIN ---------- */
function renderAdmin() {
  let tab = 'today';
  let users = {};
  let dayDate = today(), dayEntries = {};
  let month = thisMonth(), monthEntries = [];
  let daySub = null, monthSub = null;
  root.innerHTML = `${header('Pontaj — Administrator')}<main id="view"></main>
    <nav class="tabs"><button data-t="today" class="on">Azi</button><button data-t="month">Lună</button><button data-t="staff">Angajați</button></nav>`;
  wireHeader();
  const view = $('#view');
  $('nav.tabs').onclick = e => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    tab = b.dataset.t; document.querySelectorAll('nav.tabs button').forEach(x => x.classList.toggle('on', x === b));
    render(); window.scrollTo(0, 0);
  };
  const activeUsers = () => Object.values(users).filter(u => u.active !== false).sort(byName);

  subs.push(onSnapshot(collection(db, 'users'), s => {
    users = {}; s.forEach(d => { users[d.id] = { id: d.id, ...d.data() }; }); render();
  }));
  function subDay() {
    daySub?.(); daySub = onSnapshot(query(collection(db, 'entries'), where('date', '==', dayDate)), s => {
      dayEntries = {}; s.forEach(d => { const e = d.data(); dayEntries[e.uid] = e; }); if (tab === 'today') render();
    });
  }
  function subMonth() {
    monthSub?.(); monthSub = onSnapshot(query(collection(db, 'entries'), where('date', '>=', month + '-01'), where('date', '<=', month + '-31')), s => {
      monthEntries = []; s.forEach(d => monthEntries.push(d.data())); if (tab === 'month') render();
    });
  }
  subDay(); subMonth();
  subs.push(() => daySub?.(), () => monthSub?.());

  function render() {
    if (tab === 'today') renderToday(); else if (tab === 'month') renderMonth(); else renderStaff();
  }

  function renderToday() {
    const list = activeUsers();
    Object.values(dayEntries).forEach(e => { if (!list.find(u => u.id === e.uid)) list.push({ id: e.uid, name: e.name + ' (inactiv)' }); });
    const done = list.filter(u => dayEntries[u.id]).length;
    const sum = Object.values(dayEntries).reduce((s, e) => s + (e.totalMin || 0), 0);
    view.innerHTML = `<div class="card" style="padding:12px 16px"><div class="row" style="align-items:center"><b>Ziua</b>
      <input type="date" id="dd" value="${dayDate}" max="${today()}"></div></div>
      <div class="stats"><div class="stat"><b>${done}/${list.length}</b><span>au trecut orele</span></div><div class="stat"><b>${fmtDec(sum)}</b><span>ore în total</span></div></div>
      <div class="card"><h2>${fmtDate(dayDate)}</h2><ul class="list" id="dl">${list.length ? list.map(u => {
        const e = dayEntries[u.id];
        return `<li class="tap" data-u="${u.id}"><div class="grow"><div class="name">${esc(u.name)}</div>${e
          ? `<div class="sub">${esc(e.start)}–${esc(e.end)} · pauză ${e.pauseMin} min</div>${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}${changedLater(e)}`
          : `<div class="sub">nu a trecut încă orele</div>`}</div>
          <div class="right">${e ? `<div class="hours">${fmtH(e.totalMin)}</div><span class="chip ok">trecut</span>` : `<span class="chip no">lipsă</span>`}</div></li>`;
      }).join('') : `<li class="muted">Nu ai încă angajați. Adaugă-i în fila „Angajați”.</li>`}</ul>
      <p class="small muted" style="margin:10px 0 0">Atinge un angajat pentru a corecta sau completa ziua.</p></div>`;
    $('#dd').onchange = e => { dayDate = e.target.value || today(); dayEntries = {}; subDay(); renderToday(); };
    $('#dl').onclick = e => { const li = e.target.closest('li[data-u]'); if (!li) return; const u = users[li.dataset.u] || { id: li.dataset.u, name: dayEntries[li.dataset.u]?.name }; openEntryModal(u, dayDate, dayEntries[u.id]); };
  }

  function renderMonth() {
    const per = {};
    monthEntries.forEach(e => { (per[e.uid] ||= { uid: e.uid, name: users[e.uid]?.name || e.name, list: [] }).list.push(e); });
    activeUsers().forEach(u => { per[u.id] ||= { uid: u.id, name: u.name, list: [] }; });
    const rows = Object.values(per).sort(byName);
    const all = monthEntries.reduce((s, e) => s + (e.totalMin || 0), 0);
    view.innerHTML = `<div class="card" style="padding:12px 16px"><div class="row" style="align-items:center"><b>Luna</b>
      <input type="month" id="mm" value="${month}" max="${thisMonth()}"></div></div>
      <div class="stats"><div class="stat"><b>${fmtDec(all)}</b><span>ore în ${monthName(month)}</span></div><div class="stat"><b>${monthEntries.length}</b><span>zile pontate</span></div></div>
      <div class="card"><h2>Pe angajați</h2><div id="ml">${rows.length ? rows.map(r => {
        const t = r.list.reduce((s, e) => s + (e.totalMin || 0), 0);
        r.list.sort((a, b) => a.date.localeCompare(b.date));
        return `<details style="border-top:1px solid var(--line);padding:10px 0"><summary class="row" style="align-items:center">
          <div class="grow"><div class="name">${esc(r.name)}</div><div class="sub">${zile(r.list.length)}</div></div>
          <div class="right hours">${fmtDec(t)} h</div></summary>
          <ul class="list" style="margin-top:6px">${r.list.map(e => `<li class="tap" data-u="${r.uid}" data-d="${e.date}"><div class="grow">
            <div>${fmtDate(e.date)}</div><div class="sub">${esc(e.start)}–${esc(e.end)} · pauză ${e.pauseMin} min</div>
            ${e.note ? `<div class="note">${esc(e.note)}</div>` : ''}${changedLater(e)}</div><div class="right">${fmtH(e.totalMin)}</div></li>`).join('') || '<li class="muted small">nicio zi</li>'}</ul></details>`;
      }).join('') : '<p class="muted">Nimic în această lună.</p>'}</div>
      <button class="btn" id="exp">Exportă raportul (Excel / CSV)</button><div class="msg" id="xm"></div></div>`;
    $('#mm').onchange = e => { month = e.target.value || thisMonth(); monthEntries = []; subMonth(); renderMonth(); };
    $('#ml').onclick = e => {
      const li = e.target.closest('li[data-d]'); if (!li) return;
      const en = monthEntries.find(x => x.uid === li.dataset.u && x.date === li.dataset.d);
      openEntryModal(users[li.dataset.u] || { id: li.dataset.u, name: en?.name }, li.dataset.d, en);
    };
    $('#exp').onclick = () => exportCsv(rows).catch(e => { $('#xm').className = 'msg err'; $('#xm').textContent = errText(e); });
  }

  async function exportCsv(rows) {
    const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const L = [['Angajat', 'Data', 'Zi', 'Început', 'Sfârșit', 'Pauză (min)', 'Ore', 'Mențiuni'].map(q).join(';')];
    rows.forEach(r => {
      r.list.forEach(e => L.push([r.name, e.date.split('-').reverse().join('.'), fmtDate(e.date).slice(0, 2), e.start, e.end, e.pauseMin, fmtDec(e.totalMin), e.note].map(q).join(';')));
      if (r.list.length) L.push([`TOTAL ${r.name}`, '', '', '', '', '', fmtDec(r.list.reduce((s, e) => s + e.totalMin, 0)), zile(r.list.length)].map(q).join(';'), '');
    });
    const csv = '﻿' + L.join('\r\n');
    const name = `pontaj_${month}.csv`;
    if (Capacitor.isNativePlatform()) {
      const r = await Filesystem.writeFile({ path: name, data: csv, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: `Pontaj ${monthName(month)}`, url: r.uri, dialogTitle: 'Trimite raportul' });
    } else {
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = name; a.click();
    }
  }

  function renderStaff() {
    const all = Object.values(users).sort(byName);
    view.innerHTML = `<form class="card" id="nf"><h2>Adaugă angajat</h2>
        <label>Nume și prenume</label><input name="n" required>
        <label>Utilizator (pentru intrare în aplicație)</label><input name="u" autocapitalize="none" required placeholder="ex.: ion">
        <label>Parolă (min. 6 caractere)</label><input name="p" required minlength="6" value="${Math.floor(100000 + Math.random() * 900000)}">
        <button class="btn">Creează cont</button><div class="msg" id="nm"></div><div id="cr"></div></form>
      <div class="card"><h2>Angajați (${all.filter(u => u.active !== false).length} activi)</h2><ul class="list" id="sl">${all.map(u => `
        <li><div class="grow"><div class="name">${esc(u.name)}</div><div class="sub">utilizator: <b>${esc(u.username)}</b></div></div>
        <div class="right"><span class="chip ${u.active === false ? 'off' : 'ok'}">${u.active === false ? 'inactiv' : 'activ'}</span><br>
        <button class="link small" data-tog="${u.id}">${u.active === false ? 'Activează' : 'Dezactivează'}</button></div></li>`).join('') || '<li class="muted">Niciun angajat încă.</li>'}</ul>
        <p class="small muted">Un angajat dezactivat nu mai poate trece ore; orele lui rămân în rapoarte. Dacă cineva își uită parola, dezactivează-l și creează-i un cont nou (alt utilizator).</p></div>`;
    const n = $('#nf'), nm = $('#nm');
    n.onsubmit = async ev => {
      ev.preventDefault(); const b = $('button', n); nm.textContent = ''; $('#cr').innerHTML = '';
      const name = n.n.value.trim(), username = slug(n.u.value), pass = n.p.value;
      if (!username) { nm.className = 'msg err'; return nm.textContent = 'Utilizator invalid (folosește litere și cifre).'; }
      b.disabled = true;
      try {
        // a doua instanță Firebase: creează contul fără să te deconecteze pe tine
        const sec = initializeApp(firebaseConfig, 'sec-' + Date.now());
        const secAuth = initializeAuth(sec, { persistence: inMemoryPersistence });
        const cred = await createUserWithEmailAndPassword(secAuth, toEmail(username), pass);
        await signOut(secAuth);
        await setDoc(doc(db, 'users', cred.user.uid), { name, username, active: true, createdAt: serverTimestamp() });
        nm.className = 'msg ok'; nm.textContent = 'Cont creat ✓';
        $('#cr').innerHTML = `<div class="creds">Dă-i lui <b>${esc(name)}</b> aceste date:<br>Utilizator: <b>${esc(username)}</b><br>Parolă: <b>${esc(pass)}</b></div>`;
        n.n.value = ''; n.u.value = ''; n.p.value = String(Math.floor(100000 + Math.random() * 900000));
      } catch (e) { nm.className = 'msg err'; nm.textContent = errText(e); }
      b.disabled = false;
    };
    $('#sl').onclick = e => {
      const id = e.target.dataset?.tog; if (!id) return;
      updateDoc(doc(db, 'users', id), { active: users[id].active === false }).catch(err => alertMsg(errText(err)));
    };
  }

  function openEntryModal(u, date, e) {
    openModal(`<h2>${esc(u.name)}</h2><div class="sub">${fmtDate(date)}${e ? '' : ' · nu a trecut încă orele'}</div>
      <form id="ef">${dayFormHtml(e || { date }, { dateEditable: false })}
      <button class="btn">${e ? 'Salvează corectura' : 'Trece ziua pentru angajat'}</button>
      ${e ? '<button type="button" class="btn danger" id="ed">Șterge ziua</button>' : ''}
      <button type="button" class="btn sec" id="ec">Închide</button><div class="msg err" id="em"></div></form>`);
    const f = $('#ef'); wireTotal(f);
    $('#ec').onclick = closeModal;
    f.onsubmit = ev => {
      ev.preventDefault(); const d = readForm(f); d.date = date;
      const err = validate(d); if (err) return $('#em').textContent = err;
      saveEntry(u.id, u.name?.replace(/ \(inactiv\)$/, '') || e?.name || '', d).catch(x => alertMsg(errText(x)));
      closeModal();
    };
    const del = $('#ed');
    if (del) del.onclick = () => {
      if (!del.dataset.sure) { del.dataset.sure = 1; del.textContent = 'Apasă din nou pentru a șterge'; return; }
      deleteDoc(doc(db, 'entries', entryId(u.id, date))).catch(x => alertMsg(errText(x))); closeModal();
    };
  }
  render();
}
function alertMsg(t) { openModal(`<p>${esc(t)}</p><button class="btn" id="ok">OK</button>`); $('#ok').onclick = closeModal; }

/* ---------- start ---------- */
if (!configured) renderNotConfigured();
else onAuthStateChanged(auth, onUser);
