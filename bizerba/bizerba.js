// Citire export USB Bizerba (jurnal RKSV Austria): fișierele „…_jour_export.json”.
// Fiecare bon e un XML ARTS POSLog codat base64: articole, storno, reduceri, TVA, plată.
const A = "http://www.nrf-arts.org/IXRetail/namespace/", B = "http://www.bizerba.com/retail";
const f = x => { const n = parseFloat(x); return isNaN(n) ? 0 : n; };
const kids = (el, ns, name) => el ? [...el.children].filter(c => c.namespaceURI === ns && c.localName === name) : [];
const kid = (el, ns, name) => kids(el, ns, name)[0] || null;
const txt = (el, ns, name) => { const k = kid(el, ns, name); return k ? k.textContent.trim() : ""; };
export const r2 = n => Math.round(n * 100) / 100;

function b64utf8(s) {
  const bin = atob(s), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(u);
}

export function parseReceipt(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const t = doc.getElementsByTagNameNS(A, "Transaction")[0];
  if (!t) return null;
  const op = kid(t, A, "OperatorID");
  const r = { kasse: txt(t, A, "WorkstationID"), serial: txt(t, B, "DeviceSerialID"), bon: txt(t, A, "ReceiptNumber"), seq: txt(t, A, "SequenceNumber"),
    begin: txt(t, A, "BeginDateTime"), end: txt(t, A, "EndDateTime"), operator: op ? (op.getAttribute("OperatorName") || "") : "",
    items: [], voids: 0, vat: {}, tender: {}, discount: 0, grand: 0, status: "" };
  const rt = kid(t, A, "RetailTransaction");
  if (!rt) { r.status = "fără vânzare"; r.ok = true; return r; }
  r.status = rt.getAttribute("TransactionStatus") || "";
  const g = kids(rt, A, "Total").find(e => e.getAttribute("TotalType") === "TransactionGrandAmount");
  r.grand = g ? f(g.textContent) : 0;
  for (const li of kids(rt, A, "LineItem")) {
    const isVoid = li.getAttribute("VoidFlag") === "true";
    const s = kid(li, A, "Sale") || kid(li, A, "Return");
    if (s) {
      const q = kid(s, A, "Quantity"), isKg = q && q.getAttribute("UnitOfMeasureCode") === "Kg";
      const amt = f(txt(s, A, "ExtendedAmount")), minus = txt(s, B, "PLUType") === "Minus" || s.localName === "Return", tx = kid(s, A, "Tax");
      r.items.push({ plu: txt(s, A, "ItemID"), name: txt(s, A, "Description"), kg: isKg ? f(q.getAttribute("Units")) : null,
        qty: q && !isKg ? f(q.textContent) : null, price: f(txt(s, A, "ActualSalesUnitPrice")), reg: f(txt(s, A, "RegularSalesUnitPrice")) || null, amount: minus ? -amt : amt,
        rate: tx ? f(txt(tx, A, "Percent")) : null, void: isVoid, minus, priceType: txt(s, B, "PriceType") });
      if (isVoid) r.voids++;
    }
    if (isVoid) continue;
    const d = kid(li, A, "Discount");
    if (d) r.discount += f(txt(d, B, "Amount")) || f(txt(d, A, "Amount"));
    const tx = kid(li, A, "Tax");
    if (tx && tx.getAttribute("TypeCode")) {
      const sign = tx.getAttribute("TypeCode") === "Refund" ? -1 : 1, rate = f(txt(tx, A, "Percent")).toFixed(2);
      const v = r.vat[rate] || (r.vat[rate] = { base: 0, tax: 0 });
      v.base += sign * f(txt(tx, A, "TaxableAmount")); v.tax += sign * f(txt(tx, A, "Amount"));
    }
    const te = kid(li, A, "Tender");
    if (te) {
      const sign = te.getAttribute("TypeCode") === "Refund" ? -1 : 1, ch = kid(kid(te, A, "TenderChange"), A, "Amount");
      const type = te.getAttribute("TenderType") || "Cash";
      r.tender[type] = (r.tender[type] || 0) + sign * (f(txt(te, A, "Amount")) - (ch ? f(ch.textContent) : 0));
    }
  }
  const live = r.items.filter(i => !i.void);
  const items = r2(live.reduce((s, i) => s + i.amount, 0) - r.discount);
  const vat = r2(Object.values(r.vat).reduce((s, v) => s + v.base, 0));
  const pay = r2(Object.values(r.tender).reduce((s, v) => s + v, 0));
  r.ok = Math.abs(items - r.grand) < 0.006 && Math.abs(vat - r.grand) < 0.006 && Math.abs(pay - r.grand) < 0.006;
  return r;
}

export const payKind = t => /cash|bar/i.test(t) ? "cash" : /card|karte|credit|debit|^ec/i.test(t) ? "card" : "other";

// Citește fișierele; bonurile duble (exporturi suprapuse) se elimină după casă + număr bon.
export async function readJournals(files, onProgress) {
  const seen = new Set(), out = [], lists = [];
  let done = 0, total = 0;
  for (const file of files) {
    if (!/jour_export\.json$/i.test(file.name)) continue;
    const arr = JSON.parse((await file.text()).replace(/^﻿/, ""));
    lists.push(arr); total += arr.length;
  }
  for (const arr of lists) for (const rec of arr) {
    done++;
    if (rec && rec.arts) {
      const r = parseReceipt(b64utf8(rec.arts));
      if (r) { const key = r.serial + "/" + r.bon; if (!seen.has(key)) { seen.add(key); r.id = key; out.push(r); } }
    }
    if (onProgress && done % 250 === 0) { onProgress(done, total); await new Promise(res => setTimeout(res, 0)); }
  }
  out.sort((a, b) => a.end.localeCompare(b.end));
  return out;
}
