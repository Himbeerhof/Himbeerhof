/* Himbeerhof – eine einzige Bewegung beim Laden (Motion, motion.dev).
 * Ohne Motion oder bei "Bewegung reduzieren" bleibt die Seite statisch. */
(function () {
    const M = window.Motion;
    if (!M || !M.animate) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const { animate, stagger, hover, press } = M;
    const sanft = [0.22, 1, 0.36, 1];
    const $ = (s) => document.querySelector(s);
    const $$ = (s) => Array.from(document.querySelectorAll(s));

    /* Überschrift steigt Zeile für Zeile auf, dann wird die Markttafel "angeheftet" */
    const titel = $$('.hero h1 span');
    animate(titel, { opacity: [0, 1], y: [40, 0] }, { duration: 0.8, ease: sanft, delay: stagger(0.12) });

    const bild = $('.hero-bild img');
    if (bild) animate(bild, { opacity: [0, 1], scale: [1.04, 1] }, { duration: 1.1, ease: sanft, delay: 0.2 });

    const tafel = $('.tafel');
    if (tafel) animate(tafel, { opacity: [0, 1], rotate: [-6, -1.5], y: [30, 0] }, { type: 'spring', stiffness: 160, damping: 14, delay: 0.55 });

    /* Himbeer-Logo: kleiner Hüpfer beim Überfahren */
    if (hover) hover('.marke svg', el => { animate(el, { rotate: [0, -12, 8, 0], scale: [1, 1.12, 1] }, { duration: 0.6 }); });

    /* Knöpfe: federndes Drücken */
    if (press) press('.knopf', el => {
        animate(el, { scale: 0.96 }, { type: 'spring', stiffness: 600, damping: 30 });
        return () => animate(el, { scale: 1 }, { type: 'spring', stiffness: 500, damping: 20 });
    });
})();
