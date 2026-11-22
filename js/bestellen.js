// Online-Vorbestellung: Produkte wählen → Markt & Abholtag → Angaben → per E-Mail (Web3Forms) oder WhatsApp senden.
// Bezahlt wird bei Abholung am Stand. Einstellungen im Panel (/admin): Produkte (Preis, Einheit, bestellbar),
// Märkte (Bestelltage, bestellbar) und "Bestellung" in den allgemeinen Einstellungen.
(function () {
    const H = window.HIMBEER;
    if (!H) return;
    const { esc } = H;
    const ui = (k) => H.ui(k);
    const tx = (v) => H.tx(v);

    const TAGE = ['so', 'mo', 'di', 'mi', 'do', 'fr', 'sa'];   // Date.getDay()
    const EINHEIT_SCHRITT = { kg: 0.5 };
    const korb = {};          // Schlüssel (deutscher Produktname) → Menge
    let gewaehlterMarkt = '';
    let gewaehlterTag = '';
    let gesendet = null;      // null | 'mail' | 'wa'

    const el = (id) => document.getElementById(id);
    const zahl = (n) => n.toLocaleString(H.sprache() === 'en' ? 'en-GB' : 'de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const menge = (n) => n.toLocaleString(H.sprache() === 'en' ? 'en-GB' : 'de-AT', { maximumFractionDigits: 1 });
    const einheitText = (e, spr) => (window.UI_TEXTE[spr || H.sprache()] || window.UI_TEXTE.de)['einheit_' + (e || 'kg')] || e;
    const einst = () => (H.daten.site && H.daten.site.bestellung) || {};

    // ---- Was ist jetzt bestellbar? ----
    function produkte() {
        const heute = new Date().getMonth();
        return (H.daten.produkte || []).filter(p => p.sichtbar !== false && p.bestellbar !== false && H.saisonMonate(p.saison).has(heute))
            .map(p => ({ key: (p.name && p.name.de) || tx(p.name), name: tx(p.name), nameDe: (p.name && p.name.de) || tx(p.name),
                         bild: p.bild, preis: Number(p.preis) > 0 ? Number(p.preis) : null, einheit: p.einheit || 'kg' }));
    }

    function maerkte() {
        return (H.daten.maerkte || []).filter(m => m.sichtbar !== false && m.bestellbar !== false && Array.isArray(m.bestelltage) && m.bestelltage.length && termine(m).length);
    }

    function termine(m) {
        const schluss = Number(einst().bestellschluss_stunde ?? 18);
        const saison = H.saisonMonate(m.saison);
        const hatSaison = saison.size > 0;
        const jetzt = new Date();
        const liste = [];
        for (let i = 1; i <= 60 && liste.length < 6; i++) {
            const d = new Date(jetzt.getFullYear(), jetzt.getMonth(), jetzt.getDate() + i);
            if (!m.bestelltage.includes(TAGE[d.getDay()])) continue;
            if (hatSaison && !saison.has(d.getMonth())) continue;
            const frist = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, schluss, 0, 0);
            if (jetzt > frist) continue;
            liste.push(d);
        }
        return liste;
    }
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const datumText = (d, spr) => d.toLocaleDateString({ de: 'de-AT', en: 'en-GB', ro: 'ro-RO' }[spr || H.sprache()], { weekday: 'long', day: 'numeric', month: 'long' });

    // ---- Anzeige ----
    function anzeigen() {
        const box = el('bestell-box');
        if (!box) return;
        const s = einst();
        const teil = el('bestellen');
        if (s.aktiv === false) { teil.classList.add('hidden'); document.querySelectorAll('[data-bestellen-link]').forEach(a => a.classList.add('hidden')); return; }
        teil.classList.remove('hidden'); document.querySelectorAll('[data-bestellen-link]').forEach(a => a.classList.remove('hidden'));

        if (gesendet) { box.innerHTML = dankeHtml(); el('best-neu').onclick = neu; return; }

        const ps = produkte();
        const ms = maerkte();
        if (!ps.length) { box.innerHTML = `<p class="best-leer">${esc(ui('best_leer_saison'))}</p>`; return; }

        if (!ms.find(m => m.ort === gewaehlterMarkt)) gewaehlterMarkt = ms.length === 1 ? ms[0].ort : '';
        const markt = ms.find(m => m.ort === gewaehlterMarkt);
        const ts = markt ? termine(markt) : [];
        if (!ts.find(d => iso(d) === gewaehlterTag)) gewaehlterTag = '';

        const zeilen = ps.map(p => {
            const n = korb[p.key] || 0;
            const preis = p.preis ? `${zahl(p.preis)} € / ${esc(einheitText(p.einheit))}` : esc(ui('best_preis_stand'));
            return `<li class="best-p ${n ? 'gewaehlt' : ''}">
                ${p.bild ? `<img src="${esc(p.bild)}" alt="" loading="lazy">` : '<span></span>'}
                <span class="best-p-name"><b>${esc(p.name)}</b><small>${preis}</small></span>
                <span class="best-menge" role="group" aria-label="${esc(p.name)}">
                    <button type="button" data-minus="${esc(p.key)}" aria-label="−" ${n ? '' : 'disabled'}>−</button>
                    <output>${n ? `${menge(n)} <small>${esc(einheitText(p.einheit))}</small>` : '0'}</output>
                    <button type="button" data-plus="${esc(p.key)}" aria-label="+">+</button>
                </span>
            </li>`;
        }).join('');

        const summe = summeBerechnen(ps);
        const marktKnoepfe = ms.length ? ms.map(m => `<button type="button" class="best-wahl ${m.ort === gewaehlterMarkt ? 'an' : ''}" data-markt="${esc(m.ort)}"><b>${esc(tx(m.ort))}</b><small>${esc(tx(m.zeiten))}</small></button>`).join('')
            : `<p class="best-leer">${esc(ui('best_kein_markt'))}</p>`;
        const tagKnoepfe = !markt ? '' : (ts.length ? ts.map(d => `<button type="button" class="best-wahl tag ${iso(d) === gewaehlterTag ? 'an' : ''}" data-tag="${iso(d)}">${esc(datumText(d))}</button>`).join('')
            : `<p class="best-leer">${esc(ui('best_kein_termin'))}</p>`);

        const formAlt = formWerte();
        const mailAn = !!(s.web3forms_key && String(s.web3forms_key).trim());
        const waNr = String(s.whatsapp || (H.daten.site && H.daten.site.telefon) || '').replace(/[^\d]/g, '');

        box.innerHTML = `
            <div class="best-schritt">
                <h3>${esc(ui('best_schritt1'))}</h3>
                <ul class="best-liste">${zeilen}</ul>
                <p class="best-summe">${summe}</p>
            </div>
            <div class="best-schritt">
                <h3>${esc(ui('best_schritt2'))}</h3>
                <div class="best-wahlen">${marktKnoepfe}</div>
                ${markt ? `<h4>${esc(ui('best_tag'))}</h4><div class="best-wahlen tage">${tagKnoepfe}</div>
                <p class="best-klein">${esc(ui('best_schluss').replace('{h}', String(s.bestellschluss_stunde ?? 18)))}</p>` : ''}
            </div>
            <form class="best-schritt" id="best-form" novalidate>
                <h3>${esc(ui('best_schritt3'))}</h3>
                <div class="best-felder">
                    <label>${esc(ui('best_name'))} *<input name="name" autocomplete="name" required value="${esc(formAlt.name)}"></label>
                    <label>${esc(ui('best_tel'))} *<input name="tel" type="tel" autocomplete="tel" required value="${esc(formAlt.tel)}"></label>
                    <label>${esc(ui('best_email'))}<input name="email" type="email" autocomplete="email" value="${esc(formAlt.email)}"></label>
                    <label class="breit">${esc(ui('best_notiz'))}<textarea name="notiz" rows="2">${esc(formAlt.notiz)}</textarea></label>
                    <input type="checkbox" name="botcheck" class="versteckt" tabindex="-1" autocomplete="off" aria-hidden="true">
                    <label class="best-ok breit"><input type="checkbox" name="ok" ${formAlt.ok ? 'checked' : ''} required> <span>${ui('best_einverstanden')}</span></label>
                </div>
                <p class="best-hinweis">${esc(tx(s.hinweis) || ui('best_hinweis'))}</p>
                <p class="best-fehler hidden" id="best-fehler" role="alert"></p>
                <div class="best-knoepfe">
                    ${mailAn ? `<button type="submit" class="knopf knopf-voll" data-weg="mail"><svg aria-hidden="true"><use href="#i-mail"/></svg>${esc(ui('best_senden_mail'))}</button>` : ''}
                    ${waNr ? `<button type="submit" class="knopf ${mailAn ? 'knopf-rand' : 'knopf-voll'}" data-weg="wa">${esc(ui('best_senden_wa'))}</button>` : ''}
                </div>
            </form>`;

        box.querySelectorAll('[data-plus]').forEach(b => b.onclick = () => aendern(b.dataset.plus, +1));
        box.querySelectorAll('[data-minus]').forEach(b => b.onclick = () => aendern(b.dataset.minus, -1));
        box.querySelectorAll('[data-markt]').forEach(b => b.onclick = () => { gewaehlterMarkt = b.dataset.markt; gewaehlterTag = ''; anzeigen(); });
        box.querySelectorAll('[data-tag]').forEach(b => b.onclick = () => { gewaehlterTag = b.dataset.tag; anzeigen(); });
        const f = el('best-form');
        let weg = mailAn ? 'mail' : 'wa';
        f.querySelectorAll('[data-weg]').forEach(b => b.addEventListener('click', () => { weg = b.dataset.weg; }));
        f.addEventListener('submit', (e) => { e.preventDefault(); senden(weg, ps, markt, waNr); });
    }

    let formCache = { name: '', tel: '', email: '', notiz: '', ok: false };
    function formWerte() {
        const f = el('best-form');
        if (f) formCache = { name: f.elements.namedItem('name').value, tel: f.elements.namedItem('tel').value, email: f.elements.namedItem('email').value, notiz: f.elements.namedItem('notiz').value, ok: f.elements.namedItem('ok').checked };
        return formCache;
    }

    function aendern(key, richtung) {
        const p = produkte().find(x => x.key === key); if (!p) return;
        const schritt = EINHEIT_SCHRITT[p.einheit] || 1;
        const neu = Math.max(0, Math.round(((korb[key] || 0) + richtung * schritt) * 10) / 10);
        if (neu) korb[key] = neu; else delete korb[key];
        formWerte(); anzeigen();
    }

    function summeBerechnen(ps) {
        const gewaehlt = ps.filter(p => korb[p.key]);
        if (!gewaehlt.length) return esc(ui('best_noch_nichts'));
        const mitPreis = gewaehlt.filter(p => p.preis);
        const summe = mitPreis.reduce((s, p) => s + p.preis * korb[p.key], 0);
        let t = mitPreis.length ? `${esc(ui('best_summe'))} <b>${zahl(summe)} €</b>` : '';
        if (!mitPreis.length) return esc(ui('best_alle_stand'));
        if (mitPreis.length < gewaehlt.length) t += ' · ' + esc(ui('best_rest_stand'));
        return t;
    }

    // ---- Nachricht an den Hof (immer auf Deutsch) ----
    function nachricht(ps, markt, f) {
        const tag = new Date(gewaehlterTag + 'T12:00:00');
        const zeilen = ps.filter(p => korb[p.key]).map(p => {
            const preis = p.preis ? ` (ca. ${(p.preis * korb[p.key]).toFixed(2).replace('.', ',')} €)` : '';
            const n = String(korb[p.key]).replace('.', ',');
            return p.einheit === 'kg' ? `• ${n} kg ${p.nameDe}${preis}` : `• ${n} × ${einheitText(p.einheit, 'de')} ${p.nameDe}${preis}`;
        });
        const mitPreis = ps.filter(p => korb[p.key] && p.preis);
        const summe = mitPreis.reduce((s, p) => s + p.preis * korb[p.key], 0);
        return [
            'Vorbestellung Himbeerhof',
            `Markt: ${markt.ort} – ${datumText(tag, 'de')}`,
            '', ...zeilen,
            mitPreis.length ? `Summe ca.: ${summe.toFixed(2).replace('.', ',')} €` : '',
            '', `Name: ${f.elements.namedItem('name').value.trim()}`, `Telefon: ${f.elements.namedItem('tel').value.trim()}`,
            f.elements.namedItem('email').value.trim() ? `E-Mail: ${f.elements.namedItem('email').value.trim()}` : '',
            f.elements.namedItem('notiz').value.trim() ? `Anmerkung: ${f.elements.namedItem('notiz').value.trim()}` : '',
            `Sprache der Website: ${H.sprache().toUpperCase()}`
        ].filter((z, i, a) => z !== '' || (a[i - 1] !== '' && i > 0)).join('\n');
    }

    async function senden(weg, ps, markt, waNr) {
        const f = el('best-form');
        const fehler = el('best-fehler');
        fehler.classList.add('hidden');
        formWerte();
        const ok = Object.keys(korb).length && markt && gewaehlterTag && f.elements.namedItem('name').value.trim() && f.elements.namedItem('tel').value.trim().replace(/[^\d]/g, '').length >= 6 && f.elements.namedItem('ok').checked;
        if (!ok) { fehler.textContent = ui('best_fehlt'); fehler.classList.remove('hidden'); return; }
        if (f.elements.namedItem('botcheck').checked) return;
        const text = nachricht(ps, markt, f);

        if (weg === 'wa') {
            window.open(`https://wa.me/${waNr}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
            gesendet = 'wa'; anzeigen(); el('bestellen').scrollIntoView({ block: 'start' });
            return;
        }
        const knopf = f.querySelector('[data-weg="mail"]');
        knopf.disabled = true; knopf.lastChild.textContent = ui('best_sendet');
        try {
            const r = await fetch('https://api.web3forms.com/submit', {
                method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    access_key: String(einst().web3forms_key).trim(),
                    subject: `Vorbestellung ${markt.ort} ${gewaehlterTag.split('-').reverse().join('.')} – ${f.elements.namedItem('name').value.trim()}`,
                    from_name: 'Himbeerhof Website',
                    replyto: f.elements.namedItem('email').value.trim() || undefined,
                    message: text
                })
            });
            const j = await r.json().catch(() => ({}));
            if (!r.ok || j.success === false) throw new Error(j.message || r.status);
            gesendet = 'mail'; anzeigen(); el('bestellen').scrollIntoView({ block: 'start' });
        } catch (e) {
            console.error(e);
            knopf.disabled = false; knopf.lastChild.textContent = ui('best_senden_mail');
            fehler.textContent = ui('best_fehler'); fehler.classList.remove('hidden');
        }
    }

    function dankeHtml() {
        return `<div class="best-danke" role="status">
            <h3>${esc(ui(gesendet === 'wa' ? 'best_ok_wa_titel' : 'best_ok_mail_titel'))}</h3>
            <p>${esc(ui(gesendet === 'wa' ? 'best_ok_wa' : 'best_ok_mail'))}</p>
            <p class="best-hinweis">${esc(tx(einst().hinweis) || ui('best_hinweis'))}</p>
            <button type="button" class="knopf knopf-rand" id="best-neu">${esc(ui('best_neu'))}</button>
        </div>`;
    }
    function neu() { Object.keys(korb).forEach(k => delete korb[k]); gewaehlterTag = ''; gesendet = null; anzeigen(); }

    // Aus dem Produktfenster: "Vorbestellen"
    window.vorbestellen = function (nameDe) {
        const p = produkte().find(x => x.key === nameDe);
        if (p && !korb[p.key]) korb[p.key] = EINHEIT_SCHRITT[p.einheit] || 1;
        if (window.closeProductModal) window.closeProductModal();
        gesendet = null; formWerte(); anzeigen();
        el('bestellen').scrollIntoView({ block: 'start' });
    };
    H.istBestellbar = (nameDe) => !!produkte().find(x => x.key === nameDe) && einst().aktiv !== false;

    document.addEventListener('himbeer:update', () => { formWerte(); anzeigen(); });
    anzeigen();
})();
