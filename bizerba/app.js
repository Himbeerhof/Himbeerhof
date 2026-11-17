// Casa Bizerba – cititor de salvări (export USB „fiscal_data”). Totul rulează local, în browser.
import { readJournals, payKind, r2 } from "./bizerba.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const eur = n => (n < 0 ? "−" : "") + Math.abs(n).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const kgf = n => n.toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const WD = ["Du", "Lu", "Ma", "Mi", "Jo", "Vi", "Sâ"];
const MONTHS = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const wdOf = d => new Date(d + "T12:00:00").getDay();
const fmtD = d => d.slice(8, 10) + "." + d.slice(5, 7) + "." + d.slice(0, 4);
const ymName = ym => MONTHS[+ym.slice(5) - 1] + " " + ym.slice(0, 4);
const KNOWN = ["Dornbirn", "Bregenz", "Feldkirch", "Hard", "Götzis"];
function toast(t, ms = 3000) { const d = document.createElement("div"); d.className = "toast"; d.textContent = t; document.body.append(d); setTimeout(() => d.remove(), ms); }
const ls = (k, v) => { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } };

/* ---------- stocare locală (IndexedDB): bonurile rămân de la un import la altul ---------- */
const db = await new Promise((res, rej) => { const q = indexedDB.open("casa-bizerba", 1); q.onupgradeneeded = () => q.result.createObjectStore("bons", { keyPath: "id" }); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
const tx = (mode, fn) => new Promise((res, rej) => { const t = db.transaction("bons", mode); const r = fn(t.objectStore("bons")); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); });
let ALL = (await tx("readonly", s => s.getAll())) || [];
ALL.sort((a, b) => a.end.localeCompare(b.end));

/* ---------- piețe: ținute minte pe zi + casă și pe zi a săptămânii + casă ---------- */
const MK = ls("bz_markets") || {};
const marketOf = (date, k) => MK[date + "|" + k] ?? MK["wd" + wdOf(date) + "|" + k] ?? "";
function setMarket(date, k, v) { MK[date + "|" + k] = v; MK["wd" + wdOf(date) + "|" + k] = v; ls("bz_markets", MK); }

/* ---------- filtre ---------- */
let view = "days", artSort = "amount", artDir = -1, artQ = "", bonQ = "", bonFlags = new Set(), bonLimit = 200;
const F = { month: "", market: "", kasse: "" };
const months = () => [...new Set(ALL.map(r => r.end.slice(0, 7)))].sort();
function fillFilters() {
  const ms = months(), cur = F.month && (F.month === "*" || ms.includes(F.month)) ? F.month : (ms[ms.length - 1] || "*");
  F.month = cur;
  $("#p-month").innerHTML = ms.map(m => `<option value="${m}">${ymName(m)}</option>`).reverse().join("") + `<option value="*">Toate lunile</option>`;
  $("#p-month").value = cur;
  const ks = [...new Set(ALL.map(r => r.kasse))].sort((a, b) => a - b);
  $("#p-kasse").innerHTML = `<option value="">Toate casele</option>` + ks.map(k => `<option value="${esc(k)}">Kasse ${esc(k)}</option>`).join("");
  $("#p-kasse").value = F.kasse;
  const mks = [...new Set([...KNOWN, ...Object.values(MK).filter(Boolean)])];
  $("#p-market").innerHTML = `<option value="">Toate piețele</option>` + mks.map(m => `<option>${esc(m)}</option>`).join("") + `<option value="-">fără piață</option>`;
  $("#p-market").value = F.market;
  $("#st").textContent = ALL.length ? `${ALL.length.toLocaleString("de-DE")} bonuri salvate · ${fmtD(ALL[0].end.slice(0, 10))} – ${fmtD(ALL[ALL.length - 1].end.slice(0, 10))}` : "";
}
const sel = () => ALL.filter(r => (F.month === "*" || r.end.startsWith(F.month)) && (!F.kasse || r.kasse === F.kasse) && (!F.market || (F.market === "-" ? !marketOf(r.end.slice(0, 10), r.kasse) : marketOf(r.end.slice(0, 10), r.kasse) === F.market)));
["month", "market", "kasse"].forEach(k => $("#p-" + k).addEventListener("change", e => { F[k] = e.target.value; bonLimit = 200; render(); }));
$("#tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (!b) return; view = b.dataset.v; [...$("#tabs").children].forEach(x => x.classList.toggle("on", x === b)); render(); });

/* ---------- import ---------- */
async function importFiles(list) {
  const files = [...list].filter(f => /jour_export\.json$/i.test(f.name));
  if (!files.length) { toast("N-am găsit fișiere „…_jour_export.json”. Alege folderul „fiscal_data” de pe stick.", 5000); return; }
  $("#main").innerHTML = `<div class="empty"><b>Citesc bonurile…</b><span id="prog">${files.length} fișiere</span></div>`;
  try {
    const rec = await readJournals(files, (d, t) => { const p = $("#prog"); if (p) p.textContent = `${d.toLocaleString("de-DE")} din ${t.toLocaleString("de-DE")}`; });
    const have = new Set(ALL.map(r => r.id)), fresh = rec.filter(r => !have.has(r.id));
    await tx("readwrite", s => { fresh.forEach(r => s.put(r)); });
    ALL = ALL.concat(fresh).sort((a, b) => a.end.localeCompare(b.end));
    const bad = rec.filter(r => !r.ok).length;
    F.month = rec.length ? rec[rec.length - 1].end.slice(0, 7) : F.month;
    fillFilters(); render();
    toast(`${rec.length.toLocaleString("de-DE")} bonuri citite · ${fresh.length.toLocaleString("de-DE")} noi${rec.length - fresh.length ? ` · ${(rec.length - fresh.length).toLocaleString("de-DE")} erau deja` : ""}${bad ? ` · ${bad} nu se potrivesc!` : " · toate verificate ✓"}`, 6000);
  } catch (e) { console.error(e); toast("Nu am putut citi fișierele: " + e.message, 6000); render(); }
}
["#f-dir", "#f-files"].forEach(id => $(id).addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; importFiles(f); }));

/* ---------- vederi ---------- */
function render() {
  const m = $("#main");
  $("#filters").classList.toggle("hidden", !ALL.length);
  if (!ALL.length) { m.innerHTML = `<div class="empty"><b>Încă nu ai încărcat nicio salvare.</b>Pune stick-ul de la casa Bizerba și apasă <b>📂 Alege folderul de pe stick</b> – alege folderul <b>fiscal_data</b> (sau tot stick-ul).<br>Bonurile se citesc doar pe acest calculator, nimic nu pleacă pe internet, și rămân salvate pentru data viitoare.</div>`; return; }
  const R = sel();
  if (view === "days") renderDays(m, R); else if (view === "art") renderArt(m, R); else if (view === "bons") renderBons(m, R); else renderVat(m, R);
}
function kpis(R) {
  const t = { gross: 0, cash: 0, card: 0, other: 0 };
  R.forEach(r => { t.gross += r.grand; Object.entries(r.tender).forEach(([k, v]) => t[payKind(k)] += v); });
  const bad = R.filter(r => !r.ok).length, days = new Set(R.map(r => r.end.slice(0, 10))).size;
  return `<div class="cards"><div class="kpi"><small>Total încasat</small><b>${eur(r2(t.gross))}</b></div><div class="kpi"><small>Numerar</small><b>${eur(r2(t.cash))}</b></div>
    <div class="kpi"><small>Card</small><b>${eur(r2(t.card + t.other))}</b></div><div class="kpi"><small>Bonuri / zile</small><b>${R.length.toLocaleString("de-DE")} / ${days}</b></div>
    <div class="kpi"><small>Verificare bonuri</small><b class="${bad ? "bad" : "ok"}">${bad ? bad + " greșite" : "✓ toate corecte"}</b></div></div>`;
}
function dayRows(R) {
  const g = {};
  R.forEach(r => { const date = r.end.slice(0, 10), k = date + "|" + r.kasse;
    const x = g[k] || (g[k] = { date, kasse: r.kasse, n: 0, cash: 0, card: 0, other: 0, gross: 0, voids: 0, ops: new Set() });
    x.n++; x.gross += r.grand; x.voids += r.voids; if (r.operator) x.ops.add(r.operator); Object.entries(r.tender).forEach(([t, v]) => x[payKind(t)] += v); });
  return Object.values(g).sort((a, b) => a.date.localeCompare(b.date) || a.kasse - b.kasse).map(x => ({ ...x, market: marketOf(x.date, x.kasse), cash: r2(x.cash), card: r2(x.card), other: r2(x.other), gross: r2(x.gross) }));
}
function renderDays(m, R) {
  const rows = dayRows(R), byM = {};
  rows.forEach(x => { const k = x.market || "fără piață"; const y = byM[k] || (byM[k] = { n: 0, gross: 0, cash: 0, card: 0, days: new Set() }); y.n += x.n; y.gross += x.gross; y.cash += x.cash; y.card += x.card + x.other; y.days.add(x.date); });
  const tot = rows.reduce((s, x) => s + x.gross, 0), mks = [...new Set([...KNOWN, ...Object.values(MK).filter(Boolean)])];
  m.innerHTML = kpis(R) + `
  <h2>Pe piețe</h2><div class="card"><table><tr><th>Piața</th><th class="n">Zile</th><th class="n">Bonuri</th><th class="n">Numerar</th><th class="n">Card</th><th class="n">Total</th><th style="width:30%"></th></tr>
    ${Object.entries(byM).sort((a, b) => b[1].gross - a[1].gross).map(([k, y]) => `<tr><td>${esc(k)}</td><td class="n">${y.days.size}</td><td class="n">${y.n}</td><td class="n">${eur(r2(y.cash))}</td><td class="n">${eur(r2(y.card))}</td><td class="n"><b>${eur(r2(y.gross))}</b></td><td><div class="bar" style="width:${tot ? Math.max(1, y.gross / tot * 100) : 0}%"></div></td></tr>`).join("")}</table></div>
  <h2>Pe zile <small class="muted" style="font-weight:400">– scrie piața la fiecare casă; se ține minte pe zi a săptămânii</small></h2>
  <div class="card"><table><tr><th>Data</th><th>Casa</th><th>Piața</th><th class="n">Bonuri</th><th class="n">Numerar</th><th class="n">Card</th><th class="n">Total</th><th>Vânzători</th><th class="n">Storno</th></tr>
    ${rows.map(x => `<tr><td>${WD[wdOf(x.date)]} ${fmtD(x.date)}</td><td>Kasse ${esc(x.kasse)}</td><td><input type="text" list="mk-list" data-dk="${x.date}|${esc(x.kasse)}" value="${esc(x.market)}" placeholder="piața"></td>
      <td class="n">${x.n}</td><td class="n">${eur(x.cash)}</td><td class="n">${eur(r2(x.card + x.other))}</td><td class="n"><b>${eur(x.gross)}</b></td><td class="muted">${esc([...x.ops].join(", "))}</td><td class="n ${x.voids ? "warn" : "muted"}">${x.voids || "–"}</td></tr>`).join("")}
    <tr class="sum"><td colspan="3">Total</td><td class="n">${R.length}</td><td class="n">${eur(r2(rows.reduce((s, x) => s + x.cash, 0)))}</td><td class="n">${eur(r2(rows.reduce((s, x) => s + x.card + x.other, 0)))}</td><td class="n">${eur(r2(tot))}</td><td colspan="2"></td></tr></table>
    <datalist id="mk-list">${mks.map(x => `<option value="${esc(x)}">`).join("")}</datalist></div>`;
  m.querySelectorAll("[data-dk]").forEach(i => i.addEventListener("change", () => { const [d, k] = i.dataset.dk.split("|"); setMarket(d, k, i.value.trim()); fillFilters(); render(); }));
}
function artRows(R) {
  const g = {};
  R.forEach(r => { const seen = new Set(); r.items.forEach(i => { if (i.void) return; const k = i.plu + "|" + i.name;
    const x = g[k] || (g[k] = { plu: i.plu, name: i.name, kg: 0, qty: 0, amount: 0, amountKg: 0, n: 0, rate: i.rate });
    if (i.kg != null) { x.kg += (i.minus ? -1 : 1) * i.kg; x.amountKg += i.amount; } else x.qty += (i.minus ? -1 : 1) * (i.qty || 0);
    x.amount += i.amount; if (!seen.has(k)) { x.n++; seen.add(k); } }); });
  return Object.values(g).map(x => ({ ...x, kg: Math.round(x.kg * 1000) / 1000, amount: r2(x.amount), amountKg: r2(x.amountKg) }));
}
function renderArt(m, R) {
  let rows = artRows(R); const tot = rows.reduce((s, x) => s + x.amount, 0);
  if (artQ) { const q = artQ.toLowerCase(); rows = rows.filter(x => x.name.toLowerCase().includes(q) || x.plu === artQ); }
  rows.sort((a, b) => artDir * ((typeof a[artSort] === "string") ? a[artSort].localeCompare(b[artSort], "de", { numeric: true }) : (a[artSort] - b[artSort])));
  const disc = r2(R.reduce((s, r) => s + r.discount, 0));
  const th = (k, t, n) => `<th class="${n ? "n" : ""}" data-s="${k}">${t}${artSort === k ? (artDir < 0 ? " ▾" : " ▴") : ""}</th>`;
  m.innerHTML = `<div class="row" style="margin:12px 0"><input type="search" id="a-q" placeholder="Caută articol sau PLU…" value="${esc(artQ)}" style="min-width:260px"><span class="muted">${rows.length} articole · total ${eur(r2(tot))}${disc ? ` · reduceri pe bon ${eur(-disc)}` : ""}</span></div>
  <div class="card"><table><tr>${th("plu", "PLU")}${th("name", "Articol")}${th("kg", "kg", 1)}${th("qty", "Bucăți", 1)}${th("amount", "Vânzări", 1)}<th class="n">Preț mediu</th>${th("n", "Bonuri", 1)}<th class="n">TVA</th><th style="width:22%">Parte</th></tr>
    ${rows.map(x => `<tr><td class="muted">${esc(x.plu)}</td><td>${esc(x.name)}</td><td class="n">${x.kg ? kgf(x.kg) : ""}</td><td class="n">${x.qty || ""}</td><td class="n"><b>${eur(x.amount)}</b></td>
      <td class="n muted">${x.kg ? eur(r2(x.amountKg / x.kg)) + "/kg" : x.qty ? eur(r2(x.amount / x.qty)) + "/buc" : ""}</td><td class="n">${x.n}</td><td class="n muted">${x.rate != null ? x.rate.toLocaleString("de-DE") + " %" : ""}</td>
      <td><div class="bar" style="width:${tot ? Math.max(0.5, x.amount / tot * 100) : 0}%"></div></td></tr>`).join("")}</table></div>`;
  const q = $("#a-q"); q.addEventListener("input", () => { artQ = q.value.trim(); renderArt(m, R); const n = $("#a-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  m.querySelectorAll("th[data-s]").forEach(h => h.addEventListener("click", () => { const k = h.dataset.s; artDir = artSort === k ? -artDir : (k === "name" || k === "plu" ? 1 : -1); artSort = k; renderArt(m, R); }));
}
function renderBons(m, R) {
  const q = bonQ.toLowerCase();
  let rows = R.filter(r => (!q || r.bon.includes(q) || r.items.some(i => i.name.toLowerCase().includes(q)) || (r.operator || "").toLowerCase().includes(q))
    && (!bonFlags.has("void") || r.voids) && (!bonFlags.has("disc") || r.discount) && (!bonFlags.has("neg") || r.grand < 0) && (!bonFlags.has("bad") || !r.ok));
  rows = rows.slice().reverse();
  const flag = (k, t) => `<label class="btn" style="font-weight:500;padding:6px 10px"><input type="checkbox" data-f="${k}" ${bonFlags.has(k) ? "checked" : ""}> ${t}</label>`;
  m.innerHTML = `<div class="row" style="margin:12px 0"><input type="search" id="b-q" placeholder="Nr. bon, articol sau vânzător…" value="${esc(bonQ)}" style="min-width:260px">
    ${flag("void", "cu storno")}${flag("disc", "cu reducere")}${flag("neg", "retur / minus")}${flag("bad", "nu se potrivesc")}<span class="muted">${rows.length.toLocaleString("de-DE")} bonuri</span></div>
  <div class="card"><table><tr><th>Data, ora</th><th>Casa</th><th>Piața</th><th>Bon</th><th>Vânzător</th><th>Articole</th><th class="n">Total</th><th>Plată</th><th></th></tr>
    ${rows.slice(0, bonLimit).map(r => `<tr class="click" data-id="${esc(r.id)}"><td>${fmtD(r.end.slice(0, 10))} ${r.end.slice(11, 16)}</td><td>${esc(r.kasse)}</td><td>${esc(marketOf(r.end.slice(0, 10), r.kasse))}</td><td>${esc(r.bon)}</td><td>${esc(r.operator)}</td>
      <td class="muted" style="max-width:320px;overflow:hidden;text-overflow:ellipsis">${esc(r.items.filter(i => !i.void).map(i => i.name).join(", "))}</td><td class="n"><b>${eur(r.grand)}</b></td>
      <td>${Object.keys(r.tender).map(t => payKind(t) === "cash" ? "numerar" : "card").join("+")}</td><td>${r.voids ? `<span class="pill">storno</span>` : ""}${r.discount ? `<span class="pill">reducere</span>` : ""}${r.ok ? "" : `<span class="pill" style="color:var(--bad)">!</span>`}</td></tr>`).join("")}</table></div>
  ${rows.length > bonLimit ? `<div class="row" style="justify-content:center;margin:12px"><button class="btn" id="more">Arată încă ${Math.min(200, rows.length - bonLimit)}</button></div>` : ""}`;
  const qi = $("#b-q"); qi.addEventListener("input", () => { bonQ = qi.value.trim(); bonLimit = 200; renderBons(m, R); const n = $("#b-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  m.querySelectorAll("[data-f]").forEach(c => c.addEventListener("change", () => { c.checked ? bonFlags.add(c.dataset.f) : bonFlags.delete(c.dataset.f); bonLimit = 200; renderBons(m, R); }));
  const more = $("#more"); if (more) more.addEventListener("click", () => { bonLimit += 200; renderBons(m, R); });
  m.querySelectorAll("tr[data-id]").forEach(tr => tr.addEventListener("click", () => showBon(ALL.find(r => r.id === tr.dataset.id))));
}
function showBon(r) {
  const o = document.createElement("div"); o.className = "overlay";
  o.innerHTML = `<div class="sheet"><div class="row"><h2 class="grow" style="margin:0">Bon ${esc(r.bon)}</h2><button class="btn" data-x>✕</button></div>
    <div class="muted" style="margin:4px 0 10px">${WD[wdOf(r.end.slice(0, 10))]} ${fmtD(r.end.slice(0, 10))}, ${r.begin.slice(11, 19)}–${r.end.slice(11, 19)} · Kasse ${esc(r.kasse)} ${esc(marketOf(r.end.slice(0, 10), r.kasse))} · vânzător ${esc(r.operator || "–")}</div>
    <table><tr><th>Articol</th><th class="n">Cantitate</th><th class="n">Preț</th><th class="n">Sumă</th></tr>
    ${r.items.map(i => `<tr class="${i.void ? "void" : ""}"><td>${esc(i.name)}${i.void ? ` <span class="pill">storno</span>` : ""}${i.minus ? ` <span class="pill">minus</span>` : ""}</td>
      <td class="n">${i.kg != null ? kgf(i.kg) + " kg" : (i.qty ?? "") + (i.qty != null ? " buc" : "")}</td><td class="n">${i.price ? eur(i.price) + (i.kg != null ? "/kg" : "") : ""}</td><td class="n">${eur(i.amount)}</td></tr>`).join("")}
    ${r.discount ? `<tr><td colspan="3">Reducere pe bon</td><td class="n">${eur(-r.discount)}</td></tr>` : ""}
    <tr class="sum"><td colspan="3">Total</td><td class="n">${eur(r.grand)}</td></tr></table>
    ${Object.keys(r.vat).length ? "<h2>TVA</h2>" : ""}<table>${Object.entries(r.vat).map(([k, v]) => `<tr><td>${(+k).toLocaleString("de-DE")} %</td><td class="n">brut ${eur(r2(v.base))}</td><td class="n">TVA ${eur(r2(v.tax))}</td></tr>`).join("")}</table>
    ${Object.keys(r.tender).length ? "<h2>Plată</h2>" : ""}<table>${Object.entries(r.tender).map(([k, v]) => `<tr><td>${payKind(k) === "cash" ? "Numerar" : "Card"} <span class="muted">(${esc(k)})</span></td><td class="n">${eur(r2(v))}</td></tr>`).join("")}</table>
    <p class="${r.ok ? "ok" : "bad"}" style="font-weight:600">${r.ok ? "✓ Articolele, TVA-ul și plata se potrivesc cu totalul." : "Atenție: articolele, TVA-ul sau plata nu se potrivesc cu totalul bonului."}</p></div>`;
  o.addEventListener("click", e => { if (e.target === o || e.target.closest("[data-x]")) o.remove(); });
  document.body.append(o);
}
function vatByMonth(R) {
  const m = {};
  R.forEach(r => { const ym = r.end.slice(0, 7), x = m[ym] || (m[ym] = {}); Object.entries(r.vat).forEach(([k, v]) => { const y = x[k] || (x[k] = { base: 0, tax: 0 }); y.base += v.base; y.tax += v.tax; }); });
  return m;
}
function renderVat(m, R) {
  const V = vatByMonth(R), co = ls("bz_company") || { name: "", street: "", city: "" };
  m.innerHTML = `${Object.keys(V).sort().map(ym => { const rates = Object.entries(V[ym]).sort((a, b) => +a[0] - +b[0]); const s = rates.reduce((a, [, v]) => ({ base: a.base + v.base, tax: a.tax + v.tax }), { base: 0, tax: 0 });
    return `<h2>${ymName(ym)}</h2><div class="card"><table><tr><th>Cota TVA</th><th class="n">Brut (cu TVA)</th><th class="n">TVA</th><th class="n">Net</th></tr>
      ${rates.map(([k, v]) => `<tr><td>${(+k).toLocaleString("de-DE")} %</td><td class="n">${eur(r2(v.base))}</td><td class="n">${eur(r2(v.tax))}</td><td class="n">${eur(r2(v.base - v.tax))}</td></tr>`).join("")}
      <tr class="sum"><td>Total</td><td class="n">${eur(r2(s.base))}</td><td class="n">${eur(r2(s.tax))}</td><td class="n">${eur(r2(s.base - s.tax))}</td></tr></table></div>`; }).join("")}
  <h2>Export Excel</h2>
  <div class="card" style="padding:12px 14px">
    <div class="row"><input type="text" id="c-name" placeholder="Numele firmei" value="${esc(co.name)}" class="grow"><input type="text" id="c-street" placeholder="Strada" value="${esc(co.street)}"><input type="text" id="c-city" placeholder="Cod poștal, oraș" value="${esc(co.city)}"></div>
    <p class="muted" style="margin:8px 0">Se exportă ce e ales sus (luna, piața, casa).</p>
    <div class="row"><button class="btn primary" id="x-wm">📊 Excel Wochenmarktumsätze</button><button class="btn" id="x-det">📄 Excel detaliat (zile, articole, toate bonurile)</button></div>
  </div>
  <h2>Date salvate</h2><div class="card" style="padding:12px 14px"><div class="row"><span class="grow muted">${ALL.length.toLocaleString("de-DE")} bonuri salvate în acest browser. Un stick nou se adaugă la ele; bonurile deja citite nu se dublează.</span><button class="btn" id="x-del">Șterge toate bonurile</button></div></div>`;
  ["name", "street", "city"].forEach(k => $("#c-" + k).addEventListener("change", e => { co[k] = e.target.value.trim(); ls("bz_company", co); }));
  const tag = F.month === "*" ? "toate" : F.month;
  $("#x-wm").addEventListener("click", () => xl(async X => X.buildWochenmarkt({ company: co, days: dayRows(R).map(d => ({ date: d.date, market: d.market, gross: d.gross })), vat: V }), `Wochenmarktumsaetze_${tag}.xlsx`));
  $("#x-det").addEventListener("click", () => xl(async X => X.buildDetail({ days: dayRows(R).map(d => ({ ...d, wd: WD[wdOf(d.date)], k: d.kasse, m: d.market })), articles: artRows(R).sort((a, b) => b.amount - a.amount), receipts: R.map(r => ({ ...r, market: marketOf(r.end.slice(0, 10), r.kasse) })) }), `Bizerba_${tag}.xlsx`));
  $("#x-del").addEventListener("click", async () => { if (!confirm("Ștergi toate bonurile salvate în acest browser? (Stick-ul nu se atinge.)")) return; await tx("readwrite", s => s.clear()); ALL = []; fillFilters(); render(); });
}
async function xl(build, name) {
  toast("Fac fișierul Excel…", 1500);
  try {
    if (!window.ExcelJS) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/exceljs.min.js"; s.onload = res; s.onerror = () => rej(new Error("exceljs")); document.head.append(s); });
    const blob = await build(await import("./xlsx.js"));
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  } catch (e) { console.error(e); toast("Excel-ul nu a putut fi făcut: " + e.message, 5000); }
}

fillFilters(); render();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
