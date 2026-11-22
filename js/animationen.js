/* Himbeerhof – sanfte Animationen mit Motion (motion.dev)
 * Lädt nach js/vendor/motion.js. Ohne Motion oder bei
 * "Bewegung reduzieren" bleibt die Seite einfach statisch. */
(function () {
    const M = window.Motion;
    if (!M || !M.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const { animate, inView, stagger, hover, press } = M;
    const sanft = [0.22, 1, 0.36, 1];          // weiches Ausrollen
    const $ = (s, r) => (r || document).querySelector(s);
    const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

    /* Elemente erst verstecken, dann beim Sichtbarwerden einblenden */
    function einblenden(elemente, opt) {
        opt = opt || {};
        elemente = elemente.filter(Boolean);
        if (!elemente.length) return;
        const y = opt.y == null ? 28 : opt.y;
        elemente.forEach(el => { el.style.opacity = '0'; el.style.transform = `translateY(${y}px)`; });
        inView(opt.ausloeser || elemente[0], () => {
            animate(elemente, { opacity: [0, 1], y: [y, 0] },
                { duration: opt.dauer || 0.7, ease: sanft, delay: stagger(opt.abstand || 0.08, { startDelay: opt.start || 0 }) });
        }, { amount: opt.anteil || 0.2 });
    }

    /* 1) Hero beim Laden */
    const heroText = [
        ...$$('.hero h1 span'),
        $('.hero-text'),
        ...$$('.hero-knoepfe .knopf'),
        $('.hero-herkunft')
    ].filter(Boolean);
    heroText.forEach(el => { el.style.opacity = '0'; });
    animate(heroText, { opacity: [0, 1], y: [32, 0] },
        { duration: 0.8, ease: sanft, delay: stagger(0.09, { startDelay: 0.1 }) });

    const heroBild = $('.hero-bild img');
    if (heroBild) {
        heroBild.style.opacity = '0';
        animate(heroBild, { opacity: [0, 1], scale: [1.06, 1] }, { duration: 1.1, ease: sanft, delay: 0.15 });
    }
    const jetzt = $('.jetzt');
    if (jetzt) {
        jetzt.style.opacity = '0';
        animate(jetzt, { opacity: [0, 1], y: [24, 0] }, { duration: 0.7, ease: sanft, delay: 0.6 });
    }

    /* Himbeer-Logo: kleiner Hüpfer beim Überfahren */
    if (hover) {
        hover('.marke svg', el => {
            animate(el, { rotate: [0, -12, 8, 0], scale: [1, 1.12, 1] }, { duration: 0.6, ease: 'easeInOut' });
        });
    }

    /* Knöpfe: federndes Drücken */
    if (press) {
        press('.knopf', el => {
            animate(el, { scale: 0.96 }, { type: 'spring', stiffness: 600, damping: 30 });
            return () => animate(el, { scale: 1 }, { type: 'spring', stiffness: 500, damping: 20 });
        });
    }

    /* 2) Abschnitte beim Scrollen */
    einblenden([$('.ueber img')], { y: 40, dauer: 0.9 });
    einblenden($$('.ueber .innen > div > *'), { start: 0.1 });
    $$('.teil-kopf').forEach(k => einblenden(Array.from(k.children)));
    einblenden($$('.kontakt .innen > div'), { abstand: 0.12 });

    /* 3) Listen, die per JSON nachgeladen werden: beim ersten Befüllen gestaffelt */
    function listeAnimieren(id, auswahl, opt) {
        const box = document.getElementById(id);
        if (!box) return;
        let fertig = false;
        const los = () => {
            if (fertig) return;
            const kinder = $$(auswahl, box);
            if (!kinder.length) return;
            fertig = true;                     // Sprachwechsel später nicht erneut animieren
            beob.disconnect();
            einblenden(kinder, Object.assign({ ausloeser: box, anteil: 0.1 }, opt));
        };
        const beob = new MutationObserver(los);
        beob.observe(box, { childList: true });
        los();
    }
    listeAnimieren('produkte-grid', '.k-zeile', { y: 18, abstand: 0.045, dauer: 0.55 });
    listeAnimieren('maerkte-grid', '.markt', { y: 22, abstand: 0.08 });
    listeAnimieren('bestell-box', ':scope > *', { y: 22 });
})();
