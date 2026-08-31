/* ══════════════════════════════════════════════════════════════
   cues.js — Pistas de gestos ocultos (coachmarks de «primera vez»)

   Filosofía (entrevista 2026-07-02, memoria `sistema-cues-gestos`):
   ligeras y contextuales, NUNCA tutorial. Enseñan el gesto cómodo que
   existe pero no se ve (clic derecho / mantener pulsado / swipe…).

   Modelo C: una cue aparece máx 2 veces, 1 por sesión; si el usuario
   REALIZA el gesto una vez → nunca más; si no lo usa en 2 sesiones →
   se rinde. Estado híbrido: localStorage por dispositivo + cloud-sync
   por cuenta (clave `pocketboard_cues_v1`, fusión en cloud-sync.js).

   Guardarraíles: nunca en Inicio, nunca dos a la vez, no bloquea el
   gesto (pointer-events:none), respeta «Reducir animaciones».

   API:
     window.pbCue.maybe(id, { anchor, place })  → muestra si es elegible
     window.pbCue.done(id)                       → «ya lo hizo», no vuelve
     window.pbCue.eligible(id)                   → ¿podría mostrarse ahora?
   Cada cue (glifo + texto por plataforma) se define en CUES por id.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var STORE     = 'pocketboard_cues_v1';
  var MAX_SHOWS = 2;

  // ── Glifos SVG (monocromo, currentColor) ──
  var GLYPHS = {
    // Ratón con el botón DERECHO resaltado
    rightClick:
      '<svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">' +
      '<rect x="6.5" y="2.6" width="11" height="18.8" rx="5.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
      '<path d="M12 3.2 a5.4 5.4 0 0 1 5.4 5.4 V 11 H 12 Z" fill="currentColor"/>' +
      '<path d="M12 3.2 V 11" stroke="currentColor" stroke-width="1.4"/></svg>',
    // Dedo (punto) + ondas = pulsación larga
    hold:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor">' +
      '<circle cx="12" cy="13" r="3.2" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="13" r="6.4" stroke-width="1.4" opacity="0.55"/>' +
      '<circle cx="12" cy="13" r="9.3" stroke-width="1.4" opacity="0.28"/></svg>',
    // Flecha arriba con punto (dedo que desliza)
    swipeUp:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 20 V 6.5"/><path d="M6.8 11.5 12 6.3 17.2 11.5"/>' +
      '<circle cx="12" cy="20" r="1.5" fill="currentColor" stroke="none"/></svg>',
    swipeDown:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M12 4 V 17.5"/><path d="M6.8 12.5 12 17.7 17.2 12.5"/>' +
      '<circle cx="12" cy="4" r="1.5" fill="currentColor" stroke="none"/></svg>',
    // Toque simple = punto + UN anillo (el «hold» lleva dos)
    tap:
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor">' +
      '<circle cx="12" cy="13" r="3.4" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="13" r="7.2" stroke-width="1.5" opacity="0.5"/></svg>'
  };

  // ── Catálogo de cues (glifo + texto es/en/ja por plataforma) ──
  // El TEXTO vive en el i18n del sitio (data/i18n.js) → traduce solo como el resto
  // de la web y se re-traduce en `langchange`. Aquí solo el glifo por plataforma.
  var CUES = {
    cardsAddDeck: {
      desktop: { glyph: 'rightClick', key: 'cue.cardsAdd.desktop' },
      touch:   { glyph: 'hold',       key: 'cue.cardsAdd.touch' }
    },
    // Excluir un filtro en Cartas: mismo gesto que añadir al mazo, pero sobre un chip.
    cardsExclude: {
      desktop: { glyph: 'rightClick', key: 'cue.cardsExclude.desktop' },
      touch:   { glyph: 'hold',       key: 'cue.cardsExclude.touch' }
    },
    // Quitar del deck builder: hint flotante minimal (misma estética que la Tierlist), sin glifo.
    cardsRemoveDeck: {
      desktop: { key: 'cue.cardsRemove.desktop' },
      touch:   { key: 'cue.cardsRemove.touch' }
    },
    // Draft en móvil: SOLO táctil (en escritorio se elige con clic) → cue EN PAREJA
    // (dos gestos complementarios: swipe↑ despliega la línea, swipe↓ elige).
    draftPick: {
      touch: { pair: [
        { glyph: 'swipeUp',   key: 'cue.draftPick.up' },
        { glyph: 'swipeDown', key: 'cue.draftPick.down' }
      ] }
    },
    // Tierlist en móvil: hint flotante mínimo, sin glifo (texto y punto). Táctil-only.
    tierlistPlace: {
      touch: { key: 'cue.tierlistPlace' }
    }
  };

  // ── Estado persistente (por dispositivo; cloud-sync fusiona por cuenta) ──
  function loadStore() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; } }
  function saveStore(o) { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch (e) {} }
  function rec(id)      { var s = loadStore(); return s[id] || { shown: 0, done: false }; }
  function setRec(id, r) { var s = loadStore(); s[id] = r; saveStore(s); }

  // ── Guardarraíles ──
  function reduceMotion() { return !!(window.pbFx && window.pbFx('reduceMotion')); }
  function anyCueVisible() { return !!document.querySelector('.pb-cue'); }

  // 1 vez por sesión: sessionStorage sobrevive recargas de la MISMA pestaña,
  // pero una sesión nueva (otra pestaña / otro día) vuelve a permitirla.
  function seenThisSession(id) { try { return sessionStorage.getItem('pbcue_s_' + id) === '1'; } catch (e) { return false; } }
  function markSession(id)     { try { sessionStorage.setItem('pbcue_s_' + id, '1'); } catch (e) {} }

  function eligible(id) {
    if (!CUES[id]) return false;
    var r = rec(id);
    if (r.done || r.shown >= MAX_SHOWS) return false;
    if (seenThisSession(id)) return false;
    if (anyCueVisible()) return false;
    return true;
  }

  function lang() { try { return (window.i18n && window.i18n.getLang && window.i18n.getLang()) || 'es'; } catch (e) { return 'es'; } }
  function variant(id) {
    var c = CUES[id]; if (!c) return null;
    var touch = !!(window.pbIsTouchMobile && window.pbIsTouchMobile());
    return c[touch ? 'touch' : 'desktop'] || c.desktop;
  }
  function text(v) {
    if (v.key && window.t) { var s = window.t(v.key); if (s && s !== v.key) return s; }
    return v[lang()] || v.en || v.es || v.key || '';   // fallback si el motor i18n no está
  }

  // ── Render / posicionado ──
  function place(el, anchor, side) {
    var a = anchor.getBoundingClientRect();
    var b = el.getBoundingClientRect();
    var x, y;
    if (side === 'below')      { x = a.left + a.width / 2 - b.width / 2; y = a.bottom + 11; }
    else if (side === 'right') { x = a.right + 11;                       y = a.top + a.height / 2 - b.height / 2; }
    else if (side === 'left')  { x = a.left - b.width - 11;              y = a.top + a.height / 2 - b.height / 2; }
    else /* above */           { x = a.left + a.width / 2 - b.width / 2; y = a.top - b.height - 11; }
    x = Math.max(8, Math.min(x, window.innerWidth  - b.width  - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - b.height - 8));
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    // La flecha SIGUE apuntando al centro del ancla aunque el bocadillo se
    // haya clampado contra el borde (evita el «descentrado»).
    if (side === 'above' || side === 'below') {
      var arrow = el.querySelector('.pb-cue-arrow');
      if (arrow) {
        var t = Math.max(14, Math.min(a.left + a.width / 2 - x, b.width - 14));
        arrow.style.left = (t - arrow.offsetWidth / 2) + 'px';
        arrow.style.marginLeft = '0';
      }
    }
  }

  function remove(el) {
    if (!el || !el.parentNode || el._cueRemoving) return;
    el._cueRemoving = true;
    if (el._cueCleanup) el._cueCleanup();
    el.classList.remove('in'); el.classList.add('out');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
  }

  function render(id, anchor, opts) {
    var v = variant(id); if (!v) return;
    var side = opts.place || 'above';
    var el = document.createElement('div');
    el.className = 'pb-cue pb-cue-' + side + (v.pair ? ' pb-cue-pair' : '');
    el.setAttribute('data-cue-id', id);
    if (v.pair) {
      var rows = '';
      for (var k = 0; k < v.pair.length; k++) {
        rows += '<div class="pb-cue-row"><span class="pb-cue-glyph">' + (GLYPHS[v.pair[k].glyph] || '') + '</span><span class="pb-cue-text"></span></div>';
      }
      el.innerHTML = rows + '<span class="pb-cue-arrow"></span>';
      var tx = el.querySelectorAll('.pb-cue-text');
      for (var m = 0; m < tx.length; m++) tx[m].textContent = text({ key: v.pair[m].key });
    } else {
      var gh = (v.glyph && GLYPHS[v.glyph]) ? '<span class="pb-cue-glyph">' + GLYPHS[v.glyph] + '</span>' : '';
      el.innerHTML = gh + '<span class="pb-cue-text"></span><span class="pb-cue-arrow"></span>';
      el.querySelector('.pb-cue-text').textContent = text(v);
    }
    document.body.appendChild(el);

    // Modo «float»: fijo (bottom-center por CSS), SIN ancla, SIN flecha y NO sigue
    // el scroll → discreto y flotante (para zonas donde anclar sería intrusivo).
    var isFloat = (side === 'float');
    function reposition() { if (!isFloat && el.parentNode) place(el, anchor, side); }
    var raf = 0;
    function schedule() { if (isFloat || raf) return; raf = requestAnimationFrame(function () { raf = 0; reposition(); }); }
    reposition();
    requestAnimationFrame(function () { el.classList.add('in'); reposition(); });

    // El ancla puede CRECER/MOVERSE (al redimensionar/scroll) → recoloca. En «float»
    // no se ancla ni sigue el scroll (posición fija por CSS).
    var ro = null;
    if (!isFloat) {
      if (window.ResizeObserver) { ro = new ResizeObserver(schedule); try { ro.observe(anchor); } catch (e) {} }
      window.addEventListener('resize', schedule);
      window.addEventListener('scroll', schedule, true);
    }

    // Se re-traduce sola al cambiar de idioma (como el resto de la web).
    function onLang() {
      if (v.pair) {
        var tx = el.querySelectorAll('.pb-cue-text');
        for (var q = 0; q < tx.length; q++) tx[q].textContent = text({ key: v.pair[q].key });
      } else {
        var tn = el.querySelector('.pb-cue-text'); if (tn) tn.textContent = text(v);
      }
      schedule();
    }
    window.addEventListener('langchange', onLang);

    // Ciclo de vida «pegajoso»: NO se va sola. Vive un MÍNIMO (12 s) y, pasado ese
    // tiempo, la primera interacción del usuario la cierra. Las acciones «productivas»
    // (clic derecho a una carta / clic en «+» / abrir el mazo) la cierran aparte,
    // llamando a pbCue.done/dismiss desde su sitio, saltándose el mínimo.
    var born = Date.now();
    var minMs = (opts.minMs != null) ? opts.minMs : 12000;
    var IEV = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
    function onInteract() { if (Date.now() - born < minMs) return; remove(el); }
    // Adjunta en el próximo tick para no captar el propio gesto que la disparó.
    var attachT = setTimeout(function () {
      IEV.forEach(function (ev) { document.addEventListener(ev, onInteract, true); });
    }, 0);

    el._cueCleanup = function () {
      clearTimeout(attachT);
      if (raf) cancelAnimationFrame(raf);
      if (ro) { try { ro.disconnect(); } catch (e) {} }
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('langchange', onLang);
      IEV.forEach(function (ev) { document.removeEventListener(ev, onInteract, true); });
    };
    return el;
  }

  // ── API pública ──
  function maybe(id, opts) {
    opts = opts || {};
    if (!eligible(id)) return;
    if (!variant(id)) return;             // p.ej. cue táctil-only invocada en escritorio
    var anchor = opts.anchor;
    if (opts.place !== 'float' && (!anchor || !anchor.getBoundingClientRect)) return;   // float no necesita ancla
    // Marca mostrado (sesión + contador persistente) ANTES de pintar.
    markSession(id);
    var r = rec(id); r.shown = (r.shown || 0) + 1; setRec(id, r);
    render(id, anchor, opts);
  }

  function done(id) {                    // «ya lo hizo»: marca hecho (no vuelve) + cierra
    var r = rec(id);
    if (!r.done) { r.done = true; setRec(id, r); }
    dismiss(id);
  }

  function dismiss(id) {                  // cierra la cue actual SIN marcarla hecha (puede volver otra sesión)
    var el = document.querySelector('.pb-cue[data-cue-id="' + id + '"]');
    if (el) remove(el);
  }

  function dismissAll() {                 // cierra cualquier cue visible (p.ej. al cambiar de vista)
    var all = document.querySelectorAll('.pb-cue');
    for (var i = 0; i < all.length; i++) remove(all[i]);
  }

  window.pbCue = { maybe: maybe, done: done, dismiss: dismiss, dismissAll: dismissAll, eligible: eligible, GLYPHS: GLYPHS };
})();
