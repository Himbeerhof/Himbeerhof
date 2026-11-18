// Lädt die Inhalte aus data/*.json (bearbeitbar über /admin) und baut die Seite auf.
(function () {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    mobileMenuBtn.addEventListener('click', () => {
        const offen = mobileMenu.classList.toggle('hidden') === false;
        mobileMenuBtn.setAttribute('aria-expanded', offen);
    });
    document.querySelectorAll('.mobile-link').forEach(a => a.addEventListener('click', () => {
        mobileMenu.classList.add('hidden'); mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }));

    // Farbe aus dem Admin-Feld "farbe" → Farbe des Balkens im Erntekalender
    const FARBEN = { beere: '--f-beere', rot: '--f-rot', lila: '--f-lila', gruen: '--f-gruen', gelb: '--f-gelb', orange: '--f-orange', grau: '--f-grau' };
    const farbe = (f) => `var(${FARBEN[f] || FARBEN.beere})`;

    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fett = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const holen = (pfad) => fetch(pfad, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject(pfad));
    const wert = (obj, schluessel) => schluessel.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);

    // ---- Limba: ?lang=xx > alegerea salvată > limba browserului > germană ----
    const SPRACHEN = ['de', 'en', 'ro'];
    const UI = window.UI_TEXTE || { de: {} };
    function startSprache() {
        const q = new URLSearchParams(location.search).get('lang');
        if (SPRACHEN.includes(q)) return q;
        try { const g = localStorage.getItem('sprache'); if (SPRACHEN.includes(g)) return g; } catch (e) {}
        const b = (navigator.language || 'de').slice(0, 2).toLowerCase();
        return SPRACHEN.includes(b) ? b : 'de';
    }
    let sprache = startSprache();
    const tx = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[sprache] || v.de || '') : (v ?? '');
    const ui = (k) => (UI[sprache] && UI[sprache][k]) || (UI.de && UI.de[k]) || '';

    // ---- Saison → Monate (aus dem deutschen Text, z. B. "Juni – Oktober", "September – April", "Ganzjährig") ----
    const MONATE_DE = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
    function monatIndex(wort) {
        const w = wort.toLowerCase().replace('jänner', 'januar').replace('maerz', 'märz').trim();
        return MONATE_DE.findIndex(m => w.startsWith(m.slice(0, 3)));
    }
    // "Mitte August" → halber Monat (Balken endet bzw. beginnt in der Monatsmitte)
    function saisonMonate(saison) {
        const de = (saison && typeof saison === 'object') ? (saison.de || '') : String(saison || '');
        if (/ganzj/i.test(de)) return new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        const set = new Set();
        set.halbStart = new Set(); set.halbEnde = new Set();
        de.split(/[,;&]| und /).forEach(teil => {
            const stuecke = teil.split(/[–—]| - | bis /);
            const w = stuecke.map(x => monatIndex(x.replace(/^\s*(mitte|ende|anfang)\s+/i, ''))).filter(i => i >= 0);
            if (w.length >= 2) {
                if (/^\s*mitte/i.test(stuecke[0])) set.halbStart.add(w[0]);
                if (/^\s*mitte/i.test(stuecke[stuecke.length - 1])) set.halbEnde.add(w[1]);
            }
            if (w.length === 1) set.add(w[0]);
            if (w.length >= 2) { let i = w[0]; for (let n = 0; n < 12; n++) { set.add(i); if (i === w[1]) break; i = (i + 1) % 12; } }
        });
        return set;
    }
    const heute = new Date().getMonth();
    const monatsKurz = () => (ui('monate') || 'Jan,Feb,Mär,Apr,Mai,Jun,Jul,Aug,Sep,Okt,Nov,Dez').split(',');
    const monatLang = () => { try { return new Date(2026, heute, 1).toLocaleDateString(sprache === 'de' ? 'de-AT' : sprache, { month: 'long' }); } catch (e) { return monatsKurz()[heute]; } };

    const daten = { site: null, produkte: null, maerkte: null };
    const produkteNachId = {};

    function uiTexteSetzen() {
        document.documentElement.lang = sprache;
        if (ui('_title')) document.title = ui('_title');
        const md = document.querySelector('meta[name="description"]');
        if (md && ui('_description')) md.content = ui('_description');
        document.querySelectorAll('[data-t]').forEach(el => {
            const v = ui(el.dataset.t); if (!v) return;
            if (el.hasAttribute('data-html')) el.innerHTML = v; else el.textContent = v;
        });
        document.querySelectorAll('[data-t-aria]').forEach(el => { const v = ui(el.dataset.tAria); if (v) el.setAttribute('aria-label', v); });
        document.querySelectorAll('[data-lang]').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === sprache));
        const m = document.getElementById('jetzt-monat');
        if (m) { const t = monatLang(); m.textContent = t.charAt(0).toUpperCase() + t.slice(1); }
    }

    function spracheWechseln(neu) {
        if (!SPRACHEN.includes(neu) || neu === sprache) return;
        sprache = neu;
        try { localStorage.setItem('sprache', neu); } catch (e) {}
        try {
            const url = new URL(location.href);
            if (neu === 'de') url.searchParams.delete('lang'); else url.searchParams.set('lang', neu);
            history.replaceState(null, '', url);
        } catch (e) {}
        allesAnzeigen();
    }
    document.querySelectorAll('[data-lang]').forEach(b => b.addEventListener('click', () => spracheWechseln(b.dataset.lang)));

    function allesAnzeigen() {
        uiTexteSetzen();
        if (daten.site) seiteFuellen(daten.site);
        if (daten.produkte) produkteAnzeigen(daten.produkte);
        if (daten.maerkte) maerkteAnzeigen(daten.maerkte);
    }

    function seiteFuellen(site) {
        document.querySelectorAll('[data-feld]').forEach(el => {
            const v = tx(wert(site, el.dataset.feld));
            if (v === undefined || v === '') return;
            if (el.dataset.format === 'fett') el.innerHTML = fett(v);
            else el.textContent = v;
        });
        document.querySelectorAll('[data-bild]').forEach(el => { const v = site[el.dataset.bild]; if (v) el.src = v; });
        if (site.telefon) {
            const tel = 'tel:' + site.telefon.replace(/[^\d+]/g, '');
            document.querySelectorAll('[data-tel]').forEach(a => a.href = tel);
        }
        if (site.email) document.querySelectorAll('[data-mail]').forEach(a => a.href = 'mailto:' + site.email);
        document.querySelectorAll('[data-fb]').forEach(a => { if (site.facebook) a.href = site.facebook; else a.style.display = 'none'; });
        const ex = site.exoten;
        if (ex && ex.anzeigen !== false) {
            produkteNachId.exoten = { titel: tx(ex.titel), name: tx(ex.titel), saison: tx(ex.saison), kurz: tx(ex.text), untertitel: tx(ex.untertitel), beschreibung: tx(ex.beschreibung), herkunft: tx(ex.herkunft), fotos: ex.fotos, bild: (ex.fotos && ex.fotos[0] && (ex.fotos[0].bild || ex.fotos[0])) || '' };
        } else delete produkteNachId.exoten;
        if (daten.produkte) produkteAnzeigen(daten.produkte);
    }

    function zeileHtml(id, p, monate, extraKlasse) {
        const mk = monatsKurz();
        const zellen = mk.map((k, i) => {
            const an = monate.has(i);
            const kl = ['k-m'];
            if (an) {
                kl.push('an');
                if (!monate.has((i + 11) % 12) || i === 0) kl.push('start');
                if (!monate.has((i + 1) % 12) || i === 11) kl.push('ende');
                if (monate.halbEnde && monate.halbEnde.has(i)) kl.push('halb-ende');
                if (monate.halbStart && monate.halbStart.has(i)) kl.push('halb-start');
            }
            if (i === heute) kl.push('ist-jetzt');
            return `<span class="${kl.join(' ')}" aria-hidden="true">${esc(k.charAt(0))}</span>`;
        }).join('');
        return `
            <button type="button" class="k-zeile ${extraKlasse || ''}" style="--f:${farbe(p.farbe)}" onclick="openProductModal('${id}')">
                ${p.bild ? `<img class="k-bild" src="${esc(p.bild)}" alt="" loading="lazy">` : '<span></span>'}
                <span class="k-name"><b>${esc(p.name)}</b>${p.saison ? `<small>${esc(p.saison)}</small>` : ''}</span>
                <span class="k-monate">${zellen}</span>
            </button>`;
    }

    function produkteAnzeigen(liste) {
        const grid = document.getElementById('produkte-grid');
        const mk = monatsKurz();
        const kopf = `<div class="k-zeile k-kopf" aria-hidden="true"><span></span><span></span>${mk.map((k, i) => `<span class="${i === heute ? 'ist-jetzt' : ''}">${esc(k)}</span>`).join('')}</div>`;
        const jetzt = [];
        const zeilen = liste.filter(p => p.sichtbar !== false).map((roh, i) => {
            const id = 'p' + i;
            const p = { ...roh, name: tx(roh.name), saison: tx(roh.saison), kurz: tx(roh.kurz), titel: tx(roh.titel), untertitel: tx(roh.untertitel), beschreibung: tx(roh.beschreibung), herkunft: tx(roh.herkunft) };
            produkteNachId[id] = p;
            const monate = saisonMonate(roh.saison);
            if (monate.has(heute)) jetzt.push(p);
            return zeileHtml(id, p, monate);
        }).join('');
        const ex = produkteNachId.exoten ? zeileHtml('exoten', { ...produkteNachId.exoten, farbe: 'beere' }, new Set(), 'bestellung') : '';
        grid.innerHTML = kopf + zeilen + ex;

        const jl = document.getElementById('jetzt-liste');
        if (jl) {
            jl.innerHTML = jetzt.length
                ? jetzt.map(p => `<li><i style="--f:${farbe(p.farbe)}"></i>${esc(p.name)}</li>`).join('')
                : `<li><p>${esc(ui('jetzt_leer'))}</p></li>`;
        }
    }

    function maerkteAnzeigen(liste) {
        const grid = document.getElementById('maerkte-grid');
        grid.innerHTML = liste.filter(m => m.sichtbar !== false).map(m => {
            m = { ...m, platz: tx(m.platz), zeiten: tx(m.zeiten), saison: tx(m.saison), ort: tx(m.ort) };
            return `
            <li class="markt ${m.hervorheben ? 'hervor' : ''}">
                <h3>${esc(m.ort)}</h3>
                <span class="platz">${esc(m.platz)}</span>
                <span class="zeiten">${esc(m.zeiten)}</span>
                <span class="saison">${esc(m.saison)}</span>
            </li>`;
        }).join('');
    }

    let zuletzt = null;
    window.openProductModal = function (id) {
        const p = produkteNachId[id];
        if (!p) return;
        zuletzt = document.activeElement;
        document.getElementById('modal-title').textContent = p.titel || p.name;
        document.getElementById('modal-season').textContent = p.saison || '';
        document.getElementById('modal-subtitle').textContent = p.untertitel || p.kurz || '';
        document.getElementById('modal-description').textContent = p.beschreibung || '';
        document.getElementById('modal-herkunft').textContent = p.herkunft || 'Himbeerhof Neukirch';
        const fotos = (p.fotos || []).map(f => (typeof f === 'string' ? f : f.bild)).filter(Boolean);
        if (!fotos.length && p.bild) fotos.push(p.bild);
        document.getElementById('modal-gallery').innerHTML = fotos.map((u, i) =>
            `<img src="${esc(u)}" alt="${esc(p.titel || p.name)} – ${esc(ui('foto'))} ${i + 1}" loading="lazy">`).join('');
        document.getElementById('product-modal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        document.querySelector('.fenster-zu').focus();
    };

    window.closeProductModal = function () {
        document.getElementById('product-modal').classList.add('hidden');
        document.body.style.overflow = '';
        if (zuletzt) zuletzt.focus();
    };

    document.getElementById('product-modal').addEventListener('click', function (e) { if (e.target === this) window.closeProductModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !document.getElementById('product-modal').classList.contains('hidden')) window.closeProductModal(); });

    uiTexteSetzen();
    holen('data/site.json').then(d => { daten.site = d; seiteFuellen(d); }).catch(console.error);
    holen('data/produkte.json').then(d => { daten.produkte = d.produkte || []; produkteAnzeigen(daten.produkte); }).catch(console.error);
    holen('data/maerkte.json').then(d => { daten.maerkte = d.maerkte || []; maerkteAnzeigen(daten.maerkte); }).catch(console.error);
})();
