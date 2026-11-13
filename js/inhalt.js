// Lädt die Inhalte aus /data/*.json (bearbeitbar über /admin) und baut die Seite auf.
(function () {
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenu = document.getElementById('mobile-menu');
    mobileMenuBtn.addEventListener('click', () => mobileMenu.classList.toggle('hidden'));
    document.querySelectorAll('.mobile-link').forEach(a => a.addEventListener('click', () => mobileMenu.classList.add('hidden')));

    const FARBEN = {
        beere:  'bg-berry-100 text-berry-700',
        rot:    'bg-red-100 text-red-800',
        lila:   'bg-purple-100 text-purple-800',
        gruen:  'bg-emerald-100 text-emerald-800',
        gelb:   'bg-amber-100 text-amber-800',
        orange: 'bg-orange-100 text-orange-800',
        grau:   'bg-stone-200 text-stone-800'
    };

    const esc = (t) => String(t ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const fett = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    const holen = (pfad) => fetch(pfad, { cache: 'no-cache' }).then(r => r.ok ? r.json() : Promise.reject(pfad));
    const wert = (obj, schluessel) => schluessel.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);

    const produkteNachId = {};

    function seiteFuellen(site) {
        document.querySelectorAll('[data-feld]').forEach(el => {
            const v = wert(site, el.dataset.feld);
            if (v === undefined || v === '') return;
            if (el.dataset.format === 'fett') el.innerHTML = fett(v);
            else el.textContent = v;
        });
        document.querySelectorAll('[data-bild]').forEach(el => {
            const v = site[el.dataset.bild];
            if (v) el.src = v;
        });
        if (site.telefon) {
            const tel = 'tel:' + site.telefon.replace(/[^\d+]/g, '');
            document.querySelectorAll('[data-tel]').forEach(a => a.href = tel);
        }
        if (site.email) document.querySelectorAll('[data-mail]').forEach(a => a.href = 'mailto:' + site.email);
        if (site.hero_bild) {
            document.getElementById('hero').style.background =
                `linear-gradient(180deg, rgba(139,0,50,0.78) 0%, rgba(35,25,20,0.88) 100%), url('${site.hero_bild.replace(/'/g, '%27')}') center/cover no-repeat`;
        }
        const ex = site.exoten;
        if (ex && ex.anzeigen !== false) {
            document.getElementById('exoten-banner').classList.remove('hidden');
            produkteNachId.exoten = { titel: ex.titel, saison: ex.saison, untertitel: ex.untertitel, beschreibung: ex.beschreibung, fotos: ex.fotos };
        }
    }

    function produkteAnzeigen(liste) {
        const grid = document.getElementById('produkte-grid');
        grid.innerHTML = liste.filter(p => p.sichtbar !== false).map((p, i) => {
            const id = 'p' + i;
            produkteNachId[id] = p;
            return `
            <div onclick="openProductModal('${id}')" class="bg-white rounded-3xl overflow-hidden shadow-sm border border-cream-200 flex flex-col justify-between cursor-pointer hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group">
                <div>
                    <div class="relative overflow-hidden">
                        <img src="${esc(p.bild)}" alt="${esc(p.name)}" loading="lazy" class="w-full h-52 object-cover group-hover:scale-110 transition-transform duration-500">
                        <div class="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white font-semibold text-sm">
                            <span class="bg-berry-600/90 backdrop-blur-sm px-4 py-2 rounded-full"><i class="fa-solid fa-eye mr-2"></i>Fotos & Details</span>
                        </div>
                    </div>
                    <div class="p-6">
                        ${p.saison ? `<span class="text-xs ${FARBEN[p.farbe] || FARBEN.beere} px-3 py-1 rounded-full font-bold uppercase inline-block mb-2">${esc(p.saison)}</span>` : ''}
                        <h3 class="font-serif text-xl font-bold text-stone-800 group-hover:text-berry-600 transition-colors">${esc(p.name)}</h3>
                        <p class="text-stone-600 text-sm mt-2">${esc(p.kurz)}</p>
                    </div>
                </div>
                <div class="px-6 pb-6 pt-2 text-berry-600 text-xs font-bold flex items-center gap-1">
                    <span>Mehr erfahren & Hofbilder</span>
                    <i class="fa-solid fa-arrow-right group-hover:translate-x-1 transition-transform"></i>
                </div>
            </div>`;
        }).join('');
    }

    function maerkteAnzeigen(liste) {
        const grid = document.getElementById('maerkte-grid');
        grid.innerHTML = liste.filter(m => m.sichtbar !== false).map(m => {
            const rahmen = m.hervorheben ? 'border-2 border-berry-600 shadow-md' : 'border border-cream-200 shadow-sm';
            const badgeFarbe = m.hervorheben ? 'bg-berry-600' : 'bg-leaf-600';
            return `
            <div class="bg-white rounded-3xl p-6 ${rahmen} relative">
                ${m.saison ? `<span class="absolute -top-3 right-4 ${badgeFarbe} text-white text-[10px] uppercase font-bold tracking-wider px-3 py-1 rounded-full">${esc(m.saison)}</span>` : ''}
                <h3 class="font-serif text-2xl font-bold text-stone-800 mb-1">${esc(m.ort)}</h3>
                <p class="text-xs text-stone-500 mb-4">${esc(m.platz)}</p>
                <p class="text-sm font-semibold text-stone-700">${esc(m.zeiten)}</p>
            </div>`;
        }).join('');
    }

    window.openProductModal = function (id) {
        const p = produkteNachId[id];
        if (!p) return;
        document.getElementById('modal-title').textContent = p.titel || p.name;
        document.getElementById('modal-season').textContent = p.saison || '';
        document.getElementById('modal-subtitle').textContent = p.untertitel || p.kurz || '';
        document.getElementById('modal-description').textContent = p.beschreibung || '';
        const fotos = (p.fotos || []).map(f => (typeof f === 'string' ? f : f.bild)).filter(Boolean);
        if (!fotos.length && p.bild) fotos.push(p.bild);
        document.getElementById('modal-gallery').innerHTML = fotos.map((u, i) => `
            <div class="rounded-2xl overflow-hidden h-48 border border-cream-200 shadow-sm">
                <img src="${esc(u)}" alt="${esc(p.titel || p.name)} Foto ${i + 1}" loading="lazy" class="w-full h-full object-cover hover:scale-105 transition-transform duration-300">
            </div>`).join('');
        document.getElementById('product-modal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    };

    window.closeProductModal = function () {
        document.getElementById('product-modal').classList.add('hidden');
        document.body.style.overflow = 'auto';
    };

    document.getElementById('product-modal').addEventListener('click', function (e) {
        if (e.target === this) window.closeProductModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') window.closeProductModal(); });

    holen('/data/site.json').then(seiteFuellen).catch(console.error);
    holen('/data/produkte.json').then(d => produkteAnzeigen(d.produkte || [])).catch(console.error);
    holen('/data/maerkte.json').then(d => maerkteAnzeigen(d.maerkte || [])).catch(console.error);
})();
