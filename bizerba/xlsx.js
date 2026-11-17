// Export „Wochenmarktumsätze” în Excel – aceeași structură ca fișierul folosit până acum:
// o foaie pe lună (zile × piețe, Firmen Überw./bar, sume, împărțire pe cote TVA) + foaia „Total”.
const XL = () => window.ExcelJS;

const MONTHS_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const EUR = '#,##0.00 "€"';
const FIXED = ["Dornbirn", "Bregenz", "Feldkirch", "Hard", "Götzis"];

// data: { company:{name,street,city}, days:[{date:'2026-10-03', market:'Dornbirn', gross:1767.15}], vat:{'2026-10':{'4.90':{base,tax},...}} }
export async function buildWochenmarkt(data) {
  const wb = new (XL().Workbook)();
  wb.creator = data.company.name || "Casa Bizerba"; wb.created = new Date();
  const markets = [...FIXED];
  data.days.forEach(d => { if (d.market && !markets.includes(d.market)) markets.push(d.market); });
  const hasUnassigned = data.days.some(d => !d.market);
  if (hasUnassigned) markets.push("ohne Markt");
  const byMonth = {};
  data.days.forEach(d => { (byMonth[d.date.slice(0, 7)] ||= []).push(d); });
  const yearTotals = {};
  const font = { name: "Arial", size: 8 };

  for (const ym of Object.keys(byMonth).sort()) {
    const [y, m] = ym.split("-").map(Number);
    const ws = wb.addWorksheet(`${String(m).padStart(2, "0")}.${y}`, { pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
    const firstMk = 4, lastMk = firstMk + markets.length - 1, colFirmName = lastMk + 1, colUeb = lastMk + 2, colBar = lastMk + 3;
    ws.columns = [{ width: 5 }, { width: 11 }, { width: 2 }, ...markets.map(() => ({ width: 12 })), { width: 18 }, { width: 13 }, { width: 13 }];
    ws.getCell(1, 1).value = data.company.name || ""; ws.getCell(1, 1).font = { name: "Arial", size: 12 };
    ws.getCell(3, 1).value = data.company.street || ""; ws.getCell(4, 1).value = data.company.city || "";
    [3, 4].forEach(r => ws.getCell(r, 1).font = { name: "Arial", size: 10 });
    ws.getCell(6, 1).value = "Wochenmarktumsätze"; ws.getCell(6, 1).font = { name: "Arial", size: 10, bold: true };
    ws.getCell(6, colBar).value = `${MONTHS_DE[m - 1]} ${y}`; ws.getCell(6, colBar).font = { name: "Arial", size: 10, bold: true }; ws.getCell(6, colBar).alignment = { horizontal: "right" };
    const head = ws.getRow(8);
    head.getCell(1).value = "Pos"; head.getCell(2).value = "Datum";
    markets.forEach((mk, i) => head.getCell(firstMk + i).value = mk);
    head.getCell(colUeb).value = "Firmen Überw."; head.getCell(colBar).value = "Firmen bar";
    head.eachCell(c => { c.font = { ...font, bold: true }; c.border = { bottom: { style: "thin" } }; c.alignment = { horizontal: "center" }; });

    // zilele lunii, în ordine; o zi = un rând
    const dates = [...new Set(byMonth[ym].map(d => d.date))].sort();
    let r = 9;
    dates.forEach((date, i) => {
      const row = ws.getRow(r);
      row.getCell(1).value = i + 1; row.getCell(1).font = font;
      const c = row.getCell(2); c.value = new Date(Date.UTC(y, m - 1, Number(date.slice(8, 10)))); c.numFmt = "dd.mm.yyyy"; c.font = { name: "Arial", size: 10 };
      byMonth[ym].filter(d => d.date === date).forEach(d => {
        const col = firstMk + markets.indexOf(d.market || "ohne Markt");
        const cell = row.getCell(col); cell.value = Math.round(((Number(cell.value) || 0) + d.gross) * 100) / 100; cell.numFmt = EUR; cell.font = font;
      });
      r++;
    });
    // rânduri libere pentru firme (facturi), ca în fișierul vechi
    const firmStart = r; for (let k = 0; k < 4; k++) { ws.getRow(r).getCell(1).value = dates.length + k + 1; ws.getRow(r).getCell(1).font = font; r++; }
    const last = r - 1, sumRow = r;
    const colL = n => ws.getColumn(n).letter;
    ws.getCell(sumRow, 1).value = "Summe"; ws.getCell(sumRow, 1).font = { ...font, bold: true };
    for (let col = firstMk; col <= colBar; col++) {
      if (col === colFirmName) continue;
      const cell = ws.getCell(sumRow, col); cell.value = { formula: `SUM(${colL(col)}9:${colL(col)}${last})` }; cell.numFmt = EUR; cell.font = { ...font, bold: true };
      cell.border = { top: { style: "thin" } };
    }
    const gesRow = sumRow + 1;
    ws.getCell(gesRow, 1).value = "Su. / Ges."; ws.getCell(gesRow, 1).font = font;
    const g = ws.getCell(gesRow, colBar); g.value = { formula: `SUM(${colL(firstMk)}${sumRow}:${colL(colBar)}${sumRow})` }; g.numFmt = EUR; g.font = { name: "Arial", size: 10, bold: true };
    // împărțirea pe cote TVA – din jurnalul casei (exactă)
    let vr = gesRow + 2;
    ws.getCell(vr, 1).value = "Umsatz incl. MwSt laut Kasse"; ws.getCell(vr, 1).font = { ...font, bold: true }; ws.getCell(vr, firstMk + 2).value = "brutto"; ws.getCell(vr, firstMk + 2).font = font;
    const vat = data.vat[ym] || {};
    const rates = Object.keys(vat).sort((a, b) => +a - +b);
    const firstV = vr + 1;
    rates.forEach((rate, i) => {
      const row = vr + 1 + i;
      ws.getCell(row, 1).value = +rate >= 20 ? "Wein, Pfand etc." : "Lebensmittel";
      ws.getCell(row, firstMk).value = "MwSt."; const p = ws.getCell(row, firstMk + 1); p.value = +rate / 100; p.numFmt = "0.0%";
      const b = ws.getCell(row, firstMk + 2); b.value = Math.round(vat[rate].base * 100) / 100; b.numFmt = EUR;
      const t = ws.getCell(row, firstMk + 3); t.value = Math.round(vat[rate].tax * 100) / 100; t.numFmt = EUR;
      [1, firstMk, firstMk + 1, firstMk + 2, firstMk + 3].forEach(c => ws.getCell(row, c).font = font);
    });
    const sr = vr + 1 + rates.length;
    ws.getCell(sr, firstMk + 1).value = "Summe"; ws.getCell(sr, firstMk + 1).font = { ...font, bold: true };
    if (rates.length) {
      const s1 = ws.getCell(sr, firstMk + 2); s1.value = { formula: `SUM(${colL(firstMk + 2)}${firstV}:${colL(firstMk + 2)}${sr - 1})` }; s1.numFmt = EUR; s1.font = { ...font, bold: true };
      const s2 = ws.getCell(sr, firstMk + 3); s2.value = { formula: `SUM(${colL(firstMk + 3)}${firstV}:${colL(firstMk + 3)}${sr - 1})` }; s2.numFmt = EUR; s2.font = { ...font, bold: true };
    }
    ws.getCell(vr, firstMk + 3).value = "davon USt"; ws.getCell(vr, firstMk + 3).font = font;
    // totaluri pe an
    byMonth[ym].forEach(d => { const k = d.market || "ohne Markt"; yearTotals[k] = (yearTotals[k] || 0) + d.gross; });
    ws.views = [{ state: "frozen", ySplit: 8 }];
  }

  // foaia Total
  const t = wb.addWorksheet("Total");
  t.columns = [{ width: 4 }, { width: 4 }, { width: 14 }, { width: 18 }, { width: 4 }, { width: 16 }];
  t.getCell(2, 3).value = "Umsatz gesamt"; t.getCell(2, 3).font = { name: "Arial", size: 10, bold: true };
  let r = 4;
  markets.forEach(mk => {
    if (!yearTotals[mk]) return;
    t.getCell(r, 4).value = mk; const c = t.getCell(r, 6); c.value = Math.round(yearTotals[mk] * 100) / 100; c.numFmt = EUR; r++;
  });
  t.getCell(r + 1, 4).value = "Summe"; t.getCell(r + 1, 4).font = { bold: true };
  const s = t.getCell(r + 1, 6); s.value = { formula: `SUM(F4:F${r - 1})` }; s.numFmt = EUR; s.font = { bold: true };
  return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

// Excel detaliat: foile Zile, Articole, Bonuri (cu rândurile din fiecare bon).
export async function buildDetail({ title, days, articles, receipts }) {
  const wb = new (XL().Workbook)(); wb.created = new Date();
  const bold = { bold: true };
  const sheet = (name, cols) => { const ws = wb.addWorksheet(name); ws.columns = cols; ws.getRow(1).font = bold; ws.views = [{ state: "frozen", ySplit: 1 }]; ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } }; return ws; };
  const z = sheet("Zile", [{ header: "Datum", key: "d", width: 12 }, { header: "Tag", key: "wd", width: 6 }, { header: "Kasse", key: "k", width: 7 }, { header: "Markt", key: "m", width: 14 }, { header: "Bons", key: "n", width: 7 }, { header: "Bar", key: "cash", width: 12, style: { numFmt: EUR } }, { header: "Karte", key: "card", width: 12, style: { numFmt: EUR } }, { header: "Andere", key: "other", width: 12, style: { numFmt: EUR } }, { header: "Gesamt", key: "gross", width: 13, style: { numFmt: EUR } }]);
  days.forEach(d => z.addRow({ ...d, d: new Date(d.date + "T12:00:00Z") })); z.getColumn(1).numFmt = "dd.mm.yyyy";
  const a = sheet("Artikel", [{ header: "PLU", key: "plu", width: 7 }, { header: "Artikel", key: "name", width: 28 }, { header: "kg", key: "kg", width: 10, style: { numFmt: "#,##0.000" } }, { header: "Stück", key: "qty", width: 8 }, { header: "Umsatz", key: "amount", width: 13, style: { numFmt: EUR } }, { header: "Ø Preis/kg", key: "pkg", width: 11, style: { numFmt: EUR } }, { header: "Bons", key: "n", width: 7 }, { header: "MwSt %", key: "rate", width: 8 }]);
  articles.forEach(x => a.addRow({ ...x, kg: x.kg || null, qty: x.qty || null, pkg: x.kg ? Math.round(x.amountKg / x.kg * 100) / 100 : null }));
  const b = sheet("Bons", [{ header: "Datum/Zeit", key: "t", width: 17 }, { header: "Kasse", key: "k", width: 7 }, { header: "Markt", key: "m", width: 13 }, { header: "Bon", key: "bon", width: 11 }, { header: "Bediener", key: "op", width: 11 }, { header: "Artikel", key: "name", width: 26 }, { header: "kg", key: "kg", width: 9, style: { numFmt: "#,##0.000" } }, { header: "Stück", key: "qty", width: 7 }, { header: "Preis", key: "price", width: 10, style: { numFmt: EUR } }, { header: "Betrag", key: "amount", width: 11, style: { numFmt: EUR } }, { header: "Storno", key: "void", width: 8 }, { header: "Bon gesamt", key: "grand", width: 12, style: { numFmt: EUR } }, { header: "Zahlung", key: "pay", width: 12 }]);
  receipts.forEach(r => { const pay = Object.keys(r.tender).join("+"); const t = r.end.replace("T", " ").slice(0, 16);
    if (!r.items.length) b.addRow({ t, k: r.kasse, m: r.market, bon: r.bon, op: r.operator, grand: r.grand, pay });
    r.items.forEach((i, n) => b.addRow({ t, k: r.kasse, m: r.market, bon: r.bon, op: r.operator, name: i.name, kg: i.kg, qty: i.qty, price: i.price || null, amount: i.amount, void: i.void ? "storno" : "", grand: n === 0 ? r.grand : null, pay: n === 0 ? pay : "" }));
    if (r.discount) b.addRow({ t, k: r.kasse, m: r.market, bon: r.bon, name: "Rabatt", amount: -r.discount }); });
  return new Blob([await wb.xlsx.writeBuffer()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}
