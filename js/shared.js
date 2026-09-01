/* ══════════════════════════════════════════════════════════════
   SHARED  (js/shared.js)
   Constantes y helpers comunes a tablero (main.js), Cartas
   (cards-view.js) y Mazos (mazos-view.js).
   DEBE cargarse antes que el resto de scripts de js/.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
const firebaseConfig = {
  apiKey: "AIzaSyD9_yuDSKCGPoUSKVz80gdl-Nz7NeY_wFk",
  authDomain: "pokelink-2026.firebaseapp.com",
  databaseURL: "https://firebaseio.com",
  projectId: "pokelink-2026",
  storageBucket: "pokelink-2026.firebasestorage.app",
  messagingSenderId: "501151685730",
  appId: "1:501151685730:web:fada98a770c437e743853b"
};

if (typeof firebase !== 'undefined') {
  firebase.initializeApp(firebaseConfig);
}


  // ── Refracción del material «liquid glass» (solo Chromium) ──
  // Safari/Firefox parsean `backdrop-filter: url(#…)` como válido pero no lo
  // renderizan (perderían TODO el blur, no solo la ondulación) → la variante con
  // el filtro SVG #pb-glass-warp se activa por clase, solo donde sabemos que va.
  try {
    if (navigator.userAgentData && navigator.userAgentData.brands &&
        navigator.userAgentData.brands.some(b => /Chromium/i.test(b.brand))) {
      document.documentElement.classList.add('pb-warp');
    }
  } catch (e) {}

  // ── Efectos visuales activables (Ajustes) ──
  // pocketboard_fx_v1 = { tilt:bool, holo:bool, autoRotate:bool, cardInfo:bool }.
  // Toggles separados: `tilt` = inclinación 3D de cartas (zoom + grid + tablero);
  // `holo` = brillo holográfico / glare (zoom + grid + tablero); `autoRotate` =
  // auto-rotación lenta del zoom cuando no hay hover (depende del tilt; si está OFF
  // la carta vuelve plana con el muelle snappy del táctil); `cardInfo` = ficha de
  // datos al lado de la carta en el zoom (si está OFF la carta va sola al centro).
  // `pbFx(name)` = ¿activo? (def sí).
  // `cardPeek` = ampliar la carta que señalas durante la partida (hover en PC, dedo en
  // móvil); `peekCenter` = enseñarla SIEMPRE en el centro en vez de en el lateral libre
  // (por defecto APAGADO: el lateral no tapa el tablero; en móvil siempre es el centro).
  const FX_DEFAULTS = { tilt: true, holo: true, autoRotate: true, cardInfo: true, cardPeek: true, peekCenter: false };
  let _fx = Object.assign({}, FX_DEFAULTS);
  try {
    const s = JSON.parse(localStorage.getItem('pocketboard_fx_v1') || 'null');
    if (s) _fx = Object.assign(_fx, s);
  } catch (e) {}
  // `reduceMotion` (Ajustes): si nunca se definió, hereda el ajuste del SISTEMA.
  if (_fx.reduceMotion === undefined) {
    try { _fx.reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { _fx.reduceMotion = false; }
  }
  window.PB_FX = _fx;
  window.pbFx = function (name) { return window.PB_FX[name] !== false; };

  // Haptic feedback: vibración SUAVE al añadir / más BRUSCA al rechazar.
  // navigator.vibrate funciona en Android (Galaxy S21+). iOS Safari NO soporta
  // la Vibration API (limitación de Apple) → en iPhone no vibrará.
  window.pbHaptic = function (kind) {
    try {
      // Suave al añadir; doble buzz al rechazar. (Funciona en Chrome Android;
      // Firefox/iOS no soportan la Vibration API.)
      if (navigator.vibrate) navigator.vibrate(kind === 'error' ? [0, 30, 40, 30] : 8);
    } catch (e) {}
  };

  // Gira suavemente un icono (SVG) 360° — para botones tipo "recargar / limpiar
  // filtros / rerollear". Sutil, sin partículas. Gated por «Reducir animaciones».
  window.pbSpinIcon = function (el, opts) {
    if (!el) return;
    if (document.documentElement.classList.contains('pb-reduce-motion')) return;
    opts = opts || {};
    var svg = (el.tagName && el.tagName.toLowerCase() === 'svg') ? el : el.querySelector('svg');
    var target = svg || el;
    try {
      target.style.transformOrigin = '50% 50%';
      target.animate(
        [{ transform: 'rotate(0deg)' }, { transform: 'rotate(' + ((opts.turns || 1) * 360) + 'deg)' }],
        { duration: opts.duration || 560, easing: opts.easing || 'cubic-bezier(0.4,0,0.2,1)' }
      );
    } catch (e) {}
  };

  // ── Feedback "jugoso" al pulsar (estilo Duolingo) ──
  // Un pequeño estallido + "pop" (encoge → rebota) del botón. SUTIL y SUAVE.
  // Reutilizable en cualquier botón:  pbJuicyBurst(el, opts)
  //   · colors[] / count / size / spread      → partículas (puntos)
  //   · icon / iconSize / iconTint            → partículas = imagen; iconTint la
  //                                             colorea por máscara (símbolo teñido)
  //   · ring / ringRainbow                    → halo; ringScale/ringBand/ringOpacity/
  //                                             ringDuration lo afinan; rings:N + ringDelay
  //                                             → varias ondas concéntricas (lentas)
  //   · rise:px      → sesga las partículas hacia ARRIBA (brasas / Pasado)
  //   · upward       → emite en abanico hacia arriba (retirada: orbes que suben)
  //   · sharp        → chispas pequeñas, rectas y rápidas (Futuro)
  //   · flash:color  → destello breve sobre el botón (glitch / Futuro)
  //   · evolveStack:N→ N clones con la forma del botón que CAEN encima (evolución)
  //   · popOnly      → SOLO el rebote del botón;  bounce → rebote más marcado
  // Gobernado por «Reducir animaciones» (Ajustes): si está activo, NO hace nada.
  // Las partículas viven en una capa fija a nivel de <body> (no las recorta el
  // overflow del botón) y se auto-limpian con la Web Animations API.
  (function () {
    var _layer = null;
    function fxLayer() {
      if (_layer && document.body && document.body.contains(_layer)) return _layer;
      _layer = document.createElement('div');
      _layer.id = 'pb-fx-layer';
      _layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;overflow:visible;';
      (document.body || document.documentElement).appendChild(_layer);
      return _layer;
    }
    var NEUTRAL = ['#ffffff', '#cfd6e6'];

    // "Pop" del botón: encoge (ease-in) y rebota. bounce=true → rebote mayor.
    function buttonPop(el, bounce) {
      try {
        el.animate(
          bounce
            ? [
                { transform: 'scale(1)',    easing: 'cubic-bezier(0.4,0,0.6,1)' },
                { transform: 'scale(0.88)', offset: 0.26, easing: 'cubic-bezier(0.18,0.7,0.3,1.5)' },
                { transform: 'scale(1.12)', offset: 0.58 },
                { transform: 'scale(0.97)', offset: 0.8 },
                { transform: 'scale(1)' }
              ]
            : [
                { transform: 'scale(1)',    easing: 'cubic-bezier(0.4,0,0.6,1)' },
                { transform: 'scale(0.92)', offset: 0.28, easing: 'cubic-bezier(0.2,0.7,0.3,1.4)' },
                { transform: 'scale(1.05)', offset: 0.62 },
                { transform: 'scale(1)' }
              ],
          { duration: bounce ? 440 : 380, easing: 'linear' }
        );
      } catch (e) {}
    }

    // Anillo/onda que se expande y se disuelve. cfg: {scale,band,opacity,dur,delay,rainbow,colors,blur}
    function spawnRing(lay, cx, cy, baseR, cfg) {
      var inner = 57, outer = Math.min(64, 57 + (cfg.band || 5));
      var bg = cfg.rainbow
        ? 'conic-gradient(from 0deg,' + cfg.colors.concat(cfg.colors[0]).join(',') + ')'
        : cfg.colors[0];
      var ring = document.createElement('div');
      ring.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;' +
        'width:' + (baseR * 2) + 'px;height:' + (baseR * 2) + 'px;margin:' + (-baseR) + 'px;' +
        'border-radius:50%;pointer-events:none;background:' + bg + ';' +
        '-webkit-mask:radial-gradient(circle,transparent ' + inner + '%,#000 ' + outer + '%);' +
        'mask:radial-gradient(circle,transparent ' + inner + '%,#000 ' + outer + '%);';
      if (cfg.blur) ring.style.filter = 'blur(' + cfg.blur + 'px)';   // halo más difuso
      lay.appendChild(ring);
      var ra = ring.animate(
        [
          { transform: 'scale(0.45)', opacity: cfg.opacity },
          { transform: 'scale(' + cfg.scale + ')', opacity: 0 }
        ],
        { duration: cfg.dur, delay: cfg.delay || 0, fill: 'backwards', easing: 'cubic-bezier(0.25,0.6,0.3,1)' }
      );
      ra.onfinish = function () { ring.remove(); };
    }

    window.pbJuicyBurst = function (el, opts) {
      if (!el || typeof el.getBoundingClientRect !== 'function') return;
      if (document.documentElement.classList.contains('pb-reduce-motion')) return;
      opts = opts || {};
      var rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      buttonPop(el, !!opts.bounce);

      // Modo "colocar evolución": clones con la forma del botón que caen encima.
      // Parámetros afinables (Fase 2 los sube un poco: más perceptible/lento/recorrido).
      if (opts.evolveStack) {
        var elay = fxLayer();
        var radius = (window.getComputedStyle ? getComputedStyle(el).borderRadius : '') || '10px';
        var evTravel = (opts.evolveTravel != null ? opts.evolveTravel : 13);
        var evDur    = (opts.evolveDur     != null ? opts.evolveDur     : 520);
        var evOpac   = (opts.evolveOpacity != null ? opts.evolveOpacity : 0.85);
        var evDelay  = (opts.evolveDelay   != null ? opts.evolveDelay   : 130);
        for (var k = 0; k < opts.evolveStack; k++) {
          var clone = document.createElement('div');
          clone.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
            'width:' + rect.width + 'px;height:' + rect.height + 'px;border-radius:' + radius + ';' +
            'pointer-events:none;background:rgba(255,255,255,0.16);border:1px solid rgba(255,255,255,0.28);' +
            'box-shadow:0 4px 12px rgba(0,0,0,0.28);';
          elay.appendChild(clone);
          var ca = clone.animate(
            [
              { transform: 'translateY(' + (-evTravel) + 'px) scale(1.04)', opacity: 0 },
              { transform: 'translateY(0) scale(1)', opacity: evOpac, offset: 0.55 },
              { transform: 'translateY(0) scale(1)', opacity: 0 }
            ],
            { duration: evDur, delay: k * evDelay, fill: 'backwards', easing: 'cubic-bezier(0.3,0.7,0.3,1)' }
          );
          (function (node) { ca.onfinish = function () { node.remove(); }; })(clone);
        }
        return;
      }
      if (opts.popOnly) return;   // solo el rebote (sin partículas)

      // Glitch: corte cromático (2 colores) sobre el botón + píxeles cuadrados que
      // saltan hacia FUERA (cruzan el borde). Estética "corrupto/extradimensional".
      if (opts.glitch) {
        var glay = fxLayer();
        var gcols = (opts.colors && opts.colors.length) ? opts.colors : ['#ff3355', '#38e1ff'];
        var gc1 = gcols[0], gc2 = gcols[1] || gcols[0];
        var gdur = opts.glitchDur || 460;
        var grad = (window.getComputedStyle ? getComputedStyle(el).borderRadius : '') || '20px';
        var gsx = opts.splitX || 3;
        [[gc1, gsx], [gc2, -gsx]].forEach(function (pr) {
          var s = document.createElement('div');
          s.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
            'width:' + rect.width + 'px;height:' + rect.height + 'px;border-radius:' + grad + ';' +
            'pointer-events:none;background:' + pr[0] + ';mix-blend-mode:screen;';
          glay.appendChild(s);
          var sa = s.animate(
            [{ transform: 'translateX(' + pr[1] + 'px)', opacity: 0.5 },
             { transform: 'translateX(' + (-pr[1]) + 'px)', opacity: 0 },
             { transform: 'translateX(' + pr[1] + 'px)', opacity: 0.4 },
             { transform: 'translateX(0)', opacity: 0 }],
            { duration: gdur, easing: 'steps(5)' }
          );
          sa.onfinish = function () { s.remove(); };
        });
        var gcx = rect.left + rect.width / 2, gcy = rect.top + rect.height / 2;
        var gn = opts.count || 7;
        var gspread = Math.max(opts.spread || 34, rect.height * 1.1);  // cruza el borde
        for (var gi = 0; gi < gn; gi++) {
          var sq = document.createElement('div');
          var gcol = (gi % 2) ? gc2 : gc1;
          var gsz = 3 + Math.random() * 2.5;
          sq.style.cssText = 'position:fixed;left:' + gcx + 'px;top:' + gcy + 'px;' +
            'width:' + gsz + 'px;height:' + gsz + 'px;background:' + gcol + ';' +
            'pointer-events:none;box-shadow:0 0 4px ' + gcol + ';';
          glay.appendChild(sq);
          var gang = (gi / gn) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
          var gdist = gspread * (0.75 + Math.random() * 0.6);
          var gdx = (Math.cos(gang) * gdist).toFixed(1);
          var gdy = (Math.sin(gang) * gdist).toFixed(1);
          var ga = sq.animate(
            [{ transform: 'translate(-50%,-50%) translate(0,0)', opacity: 1 },
             { transform: 'translate(-50%,-50%) translate(' + (gdx * 0.5) + 'px,' + (gdy * 0.5) + 'px)', opacity: 1, offset: 0.5 },
             { transform: 'translate(-50%,-50%) translate(' + gdx + 'px,' + gdy + 'px)', opacity: 0 }],
            { duration: gdur * (0.9 + Math.random() * 0.3), easing: 'steps(4)' }
          );
          (function (node) { ga.onfinish = function () { node.remove(); }; })(sq);
        }
        return;
      }

      // Etiqueta: copia del botón EN SU SITIO (pop+fade) con relleno/borde de color
      // y un brillo de radio PEQUEÑO (apenas sobresale). Para el filtro Habilidad.
      if (opts.tagClone) {
        var tlay = fxLayer();
        var trad = (window.getComputedStyle ? getComputedStyle(el).borderRadius : '') || '20px';
        var tglow = opts.tagGlowColor || 'rgba(224,68,60,0.55)';
        var tsp = (opts.tagGlow != null ? opts.tagGlow : 4);   // spread del brillo (pequeño)
        var tc = document.createElement('div');
        tc.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
          'width:' + rect.width + 'px;height:' + rect.height + 'px;border-radius:' + trad + ';box-sizing:border-box;' +
          'pointer-events:none;background:' + (opts.tagFill || 'rgba(208,58,58,0.28)') + ';' +
          'border:2px solid ' + (opts.tagBorder || '#e0443c') + ';';
        tlay.appendChild(tc);
        var ta = tc.animate(
          [
            { transform: 'scale(' + (opts.fromScale || 1.18) + ')', opacity: 0, boxShadow: '0 0 4px 0px ' + tglow },
            { transform: 'scale(1)', opacity: 1, boxShadow: '0 0 9px ' + tsp + 'px ' + tglow, offset: 0.4 },
            { transform: 'scale(1)', opacity: 0.92, boxShadow: '0 0 7px ' + (tsp * 0.6).toFixed(1) + 'px ' + tglow, offset: 0.66 },
            { transform: 'scale(1)', opacity: 0, boxShadow: '0 0 4px 0px ' + tglow }
          ],
          { duration: opts.tagDur || 640, easing: 'cubic-bezier(0.3,1.2,0.5,1)' }
        );
        ta.onfinish = function () { tc.remove(); };
        return;
      }

      var colors = (opts.colors && opts.colors.length) ? opts.colors : NEUTRAL;
      var count = (opts.count != null ? opts.count : 7);   // count:0 válido (halo solo)
      var cx = rect.left + rect.width / 2;
      var cy = rect.top + rect.height / 2;
      var lay = fxLayer();

      // Resplandor suave que se hincha y se disuelve (Pasado / Ámbar).
      if (opts.glow) {
        var gd = Math.max(rect.width, rect.height);
        var gl = document.createElement('div');
        gl.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;' +
          'width:' + gd + 'px;height:' + gd + 'px;border-radius:50%;pointer-events:none;' +
          'background:' + opts.glow + ';box-shadow:0 0 24px 8px ' + opts.glow + ';opacity:0;';
        lay.appendChild(gl);
        var gla = gl.animate(
          [{ transform: 'translate(-50%,-50%) scale(0.4)', opacity: 0 },
           { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 0.5, offset: 0.4 },
           { transform: 'translate(-50%,-50%) scale(1.7)', opacity: 0 }],
          { duration: opts.glowDur || 760, easing: 'cubic-bezier(0.3,0.6,0.3,1)' }
        );
        gla.onfinish = function () { gl.remove(); };
      }

      // Barrido de escaneo que recorre el BOTÓN de arriba abajo (Futuro / holograma).
      if (opts.scan) {
        var sl = document.createElement('div');
        sl.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
          'width:' + rect.width + 'px;height:2px;pointer-events:none;' +
          'background:' + opts.scan + ';box-shadow:0 0 8px ' + opts.scan + ';';
        lay.appendChild(sl);
        var sla = sl.animate(
          [{ transform: 'translateY(0)', opacity: 0 },
           { transform: 'translateY(' + (rect.height * 0.25) + 'px)', opacity: 0.95, offset: 0.25 },
           { transform: 'translateY(' + rect.height + 'px)', opacity: 0 }],
          { duration: opts.scanDur || 560, easing: 'ease-in-out' }
        );
        sla.onfinish = function () { sl.remove(); };
      }

      // Destello breve sobre el botón (glitch Futuro).
      if (opts.flash) {
        var radius2 = (window.getComputedStyle ? getComputedStyle(el).borderRadius : '') || '10px';
        var fl = document.createElement('div');
        fl.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
          'width:' + rect.width + 'px;height:' + rect.height + 'px;border-radius:' + radius2 + ';' +
          'pointer-events:none;background:' + opts.flash + ';mix-blend-mode:screen;';
        lay.appendChild(fl);
        var fa = fl.animate(
          [{ opacity: 0.55, transform: 'translateX(0)' },
           { opacity: 0, transform: 'translateX(2px)' },
           { opacity: 0.35, transform: 'translateX(-2px)' },
           { opacity: 0 }],
          { duration: 260, easing: 'steps(4)' }
        );
        fa.onfinish = function () { fl.remove(); };
      }

      // Logo de texto que aparece superpuesto y SE QUEDA un momento (EX).
      // logoDur largo + opacidad sostenida = se aprecia bien el logo.
      if (opts.logoText) {
        var lg = document.createElement('div');
        lg.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;pointer-events:none;' +
          'font:' + (opts.logoItalic === false ? 'normal' : 'italic') + ' 900 ' + (opts.logoSize || 28) +
          'px system-ui,sans-serif;letter-spacing:' + (opts.logoTrack != null ? opts.logoTrack : -1) + 'px;' +
          'background:' + (opts.logoGrad || 'linear-gradient(180deg,#eef4ff,#7fa8e8)') + ';' +
          '-webkit-background-clip:text;background-clip:text;color:transparent;' +
          'filter:drop-shadow(0 0 6px ' + (opts.logoGlow || 'rgba(120,180,255,0.7)') + ') drop-shadow(0 1px 1px rgba(0,0,0,0.5));' +
          'transform:translate(-50%,-50%);';
        lg.textContent = opts.logoText;
        lay.appendChild(lg);
        var la = lg.animate(
          [
            { transform: 'translate(-50%,-50%) scale(1.35)', opacity: 0, offset: 0 },
            { transform: 'translate(-50%,-50%) scale(0.96)', opacity: 1, offset: 0.18 },
            { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.72 },
            { transform: 'translate(-50%,-50%) scale(1.06)', opacity: 0, offset: 1 }
          ],
          { duration: opts.logoDur || 1200, easing: 'cubic-bezier(0.3,1.1,0.5,1)' }
        );
        la.onfinish = function () { lg.remove(); };
      }

      // Halo / ondas concéntricas.
      if (opts.ring || opts.rings) {
        var baseR = Math.max(rect.width, rect.height) * 0.55;
        var nrings = opts.rings || 1;
        for (var r = 0; r < nrings; r++) {
          spawnRing(lay, cx, cy, baseR, {
            scale:   opts.ringScale || (opts.rings ? 1.9 : 1.7),
            band:    opts.ringBand || 5,
            opacity: (opts.ringOpacity != null ? opts.ringOpacity : 0.5),
            dur:     opts.ringDuration || (opts.rings ? 1000 : 620),
            delay:   r * (opts.ringDelay || 180),
            rainbow: !!opts.ringRainbow,
            blur:    opts.ringBlur || 0,
            colors:  colors
          });
        }
      }

      for (var i = 0; i < count; i++) {
        var p = document.createElement('div');
        var col = colors[i % colors.length];
        if (opts.icon) {
          var isz = (opts.iconSize || 15) + Math.random() * 3;
          var base = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;' +
            'width:' + isz + 'px;height:' + isz + 'px;pointer-events:none;will-change:transform,opacity;';
          if (opts.iconTint) {
            // El icono como MÁSCARA → su silueta se rellena con el color de acento.
            p.style.cssText = base + 'background-color:' + opts.iconTint + ';' +
              '-webkit-mask:url(' + opts.icon + ') center/contain no-repeat;' +
              'mask:url(' + opts.icon + ') center/contain no-repeat;' +
              'filter:drop-shadow(0 0 3px ' + opts.iconTint + '66);';
          } else {
            p.style.cssText = base + 'background:url(' + opts.icon + ') center/contain no-repeat;' +
              'filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));';
          }
        } else {
          var sz = (opts.size || 5) + Math.random() * 3.5;
          p.style.cssText = 'position:fixed;left:' + cx + 'px;top:' + cy + 'px;' +
            'width:' + sz + 'px;height:' + sz + 'px;border-radius:50%;background:' + col + ';' +
            'pointer-events:none;will-change:transform,opacity;box-shadow:0 0 4px ' + col + '99;';
        }
        lay.appendChild(p);

        var dx, dy, dmx, dmy;
        if (opts.materialize) {
          // Aparece y se desvanece EN SU SITIO (disperso cerca del botón), sin viajar.
          var mang = Math.random() * Math.PI * 2;
          var mdist = (opts.spread || 14) * (0.4 + Math.random() * 0.8);
          p.style.left = (cx + Math.cos(mang) * mdist) + 'px';
          p.style.top = (cy + Math.sin(mang) * mdist) + 'px';
          var maa = (function (node) {
            var a = node.animate(
              [
                { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
                { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.5 },
                { transform: 'translate(-50%,-50%) scale(0.9)', opacity: 0 }
              ],
              { duration: 600 + Math.random() * 160, delay: 100 + i * 45, fill: 'backwards', easing: 'ease-out' }
            );
            a.onfinish = function () { node.remove(); };
          })(p);
          continue;
        }
        if (opts.swirl) {
          // Espiral: la partícula gira mientras sale hacia fuera (Mega).
          var wa0 = (i / count) * Math.PI * 2;
          var wdist = (opts.spread || 30) * (0.7 + Math.random() * 0.5);
          var wa1 = wa0 + 1.4;
          var wmx = (Math.cos(wa0 + 0.7) * wdist * 0.6).toFixed(1);
          var wmy = (Math.sin(wa0 + 0.7) * wdist * 0.6).toFixed(1);
          var wex = (Math.cos(wa1) * wdist).toFixed(1);
          var wey = (Math.sin(wa1) * wdist).toFixed(1);
          var swa = (function (node) {
            var a = node.animate(
              [
                { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
                { transform: 'translate(calc(-50% + ' + wmx + 'px),calc(-50% + ' + wmy + 'px)) scale(1)', opacity: 1, offset: 0.4 },
                { transform: 'translate(calc(-50% + ' + wex + 'px),calc(-50% + ' + wey + 'px)) scale(0.4)', opacity: 0 }
              ],
              { duration: (opts.dur || 760) + Math.random() * 160, easing: 'cubic-bezier(0.3,0.6,0.3,1)' }
            );
            a.onfinish = function () { node.remove(); };
          })(p);
          continue;
        }
        if (opts.upward) {
          // Abanico estrecho hacia ARRIBA (orbes de retirada que "popean").
          var fan = (count > 1 ? (i / (count - 1) - 0.5) : 0) * (opts.spread || 14) * 1.6;
          dx = fan.toFixed(1);
          dy = (-(opts.riseDist || 26) - Math.random() * 8).toFixed(1);
          var hapn = (function (node, dxv, dyv) {
            var a = node.animate(
              [
                { transform: 'translate(-50%,-50%) scale(0.5)', opacity: 0 },
                { transform: 'translate(calc(-50% + ' + dxv + 'px),calc(-50% + ' + (dyv * 0.5).toFixed(1) + 'px)) scale(1)', opacity: 0.95, offset: 0.4 },
                { transform: 'translate(calc(-50% + ' + dxv + 'px),calc(-50% + ' + dyv + 'px)) scale(0.8)', opacity: 0 }
              ],
              { duration: 720 + Math.random() * 140, delay: i * 45, fill: 'backwards', easing: 'cubic-bezier(0.25,0.7,0.3,1)' }
            );
            a.onfinish = function () { node.remove(); };
          })(p, dx, dy);
          continue;
        }

        var ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
        var dist = (opts.spread || 22) * (0.7 + Math.random() * 0.6);
        dx = (Math.cos(ang) * dist).toFixed(1);
        dy = (Math.sin(ang) * dist - (opts.rise || 0)).toFixed(1);

        var anim;
        if (opts.sharp) {
          // Chispa nítida: sale recta y rápida, sin "emerger".
          anim = p.animate(
            [
              { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
              { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(0.35)', opacity: 0 }
            ],
            { duration: 340 + Math.random() * 120, easing: 'cubic-bezier(0.15,0.85,0.2,1)' }
          );
        } else {
          dmx = (Math.cos(ang) * dist * 0.5).toFixed(1);
          dmy = (Math.sin(ang) * dist * 0.5 - (opts.rise || 0) * 0.5).toFixed(1);
          // Emerge SUAVE (ease-in: nace en 0 y crece), viaja y se FRENA, encoge.
          anim = p.animate(
            [
              { transform: 'translate(-50%,-50%) scale(0.2)', opacity: 0, offset: 0 },
              { transform: 'translate(calc(-50% + ' + dmx + 'px),calc(-50% + ' + dmy + 'px)) scale(1)', opacity: 1, offset: 0.32 },
              { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(0.85)', opacity: 1, offset: 0.74 },
              { transform: 'translate(calc(-50% + ' + dx + 'px),calc(-50% + ' + dy + 'px)) scale(0)', opacity: 0 }
            ],
            { duration: 660 + Math.random() * 200, easing: 'cubic-bezier(0.3,0.55,0.25,1)' }
          );
        }
        (function (node) { anim.onfinish = function () { node.remove(); }; })(p);
      }
    };
  })();
  window.pbSetFx = function (name, on) {
    window.PB_FX[name] = !!on;
    try { localStorage.setItem('pocketboard_fx_v1', JSON.stringify(window.PB_FX)); } catch (e) {}
    window.dispatchEvent(new CustomEvent('pbfxchange', { detail: { name: name, on: !!on } }));
  };
  // Reducir animaciones → clase global en <html> que el CSS consume.
  function applyReduceMotion() {
    document.documentElement.classList.toggle('pb-reduce-motion', window.PB_FX.reduceMotion === true);
  }
  applyReduceMotion();
  window.addEventListener('pbfxchange', function (e) { if (e.detail && e.detail.name === 'reduceMotion') applyReduceMotion(); });

  // ── Sets: nombre completo y orden canónico (viejo → nuevo) ──
  window.SET_NAMES = {
    'A1':  'Genetic Apex',          'A1A': 'Mythical Island',
    'A2':  'Space-Time Smackdown',  'A2A': 'Triumphant Light',
    'A2B': 'Shining Revelry',       'A3':  'Celestial Guardians',
    'A3A': 'Extradimensional Crisis','A3B': 'Eevee Grove',
    'A4':  'Wisdom of Sea and Sky', 'A4A': 'Secluded Springs',
    'A4B': 'Deluxe Pack',           'B1':  'Mega Evolved',
    'B1A': 'Crimson Blaze',         'B2':  'Fantastical Parade',
    'B2A': 'Paldean Wonders',       'B2B': 'Mega Shine',
    'B3':  'Pulsing Aura',          'B3A': 'Paradox Drive',
    'B3B': 'Everyday Wonders',      'B4':  'Ruler of the Skies',
    'B4A': "Team Rocket's Ambition",
    'PA':  'Promo-A',               'PB':  'Promo-B',
  };
  window.SET_ORDER = ['A1','PA','A1A','A2','A2A','A2B','A3','A3A','A3B','A4','A4A','A4B','B1','PB','B1A','B2','B2A','B2B','B3','B3A','B3B','B4','B4A'];
  window.SET_RANK  = Object.fromEntries(window.SET_ORDER.map((s, i) => [s, i]));

  // ── Elementos: color y nombre en español ──
  window.EL_COLORS = {
    grass: '#4a8',  fire: '#e54',     water: '#48e',    lightning: '#eb0',
    psychic: '#b4d', fighting: '#b74', darkness: '#446', metal: '#89a',
    dragon: '#66c', colorless: '#888',
  };
  window.EL_ES = {
    grass: 'Planta',   fire: 'Fuego',    water: 'Agua',      lightning: 'Rayo',
    psychic: 'Psíquico', fighting: 'Lucha', darkness: 'Oscuridad',
    metal: 'Metal',    dragon: 'Dragón', colorless: 'Incoloro',
  };
  // Nombres de elemento por idioma (JP = símbolos oficiales del TCG: 草炎水雷超闘悪鋼竜無)
  window.EL_EN = {
    grass: 'Grass',   fire: 'Fire',    water: 'Water',     lightning: 'Lightning',
    psychic: 'Psychic', fighting: 'Fighting', darkness: 'Darkness',
    metal: 'Metal',   dragon: 'Dragon', colorless: 'Colorless',
  };
  window.EL_JA = {
    grass: '草', fire: '炎', water: '水', lightning: '雷', psychic: '超',
    fighting: '闘', darkness: '悪', metal: '鋼', dragon: '竜', colorless: '無',
  };
  // Italiano (términos oficiales del GCC: Lampo=rayo, Lotta=lucha, Psico, Oscurità)
  window.EL_IT = {
    grass: 'Erba',   fire: 'Fuoco',   water: 'Acqua',     lightning: 'Lampo',
    psychic: 'Psico', fighting: 'Lotta', darkness: 'Oscurità',
    metal: 'Metallo', dragon: 'Drago', colorless: 'Incolore',
  };
  // Francés (términos oficiales del JCC: Psy, Combat, Obscurité)
  window.EL_FR = {
    grass: 'Plante', fire: 'Feu',     water: 'Eau',       lightning: 'Électrique',
    psychic: 'Psy',  fighting: 'Combat', darkness: 'Obscurité',
    metal: 'Métal',  dragon: 'Dragon', colorless: 'Incolore',
  };
  // Portugués (términos oficiales del TCG, vía TCGdex /pt/types)
  window.EL_PT = {
    grass: 'Planta', fire: 'Fogo',    water: 'Água',      lightning: 'Elétrico',
    psychic: 'Psíquico', fighting: 'Lutador', darkness: 'Sombrio',
    metal: 'Metal',  dragon: 'Dragão', colorless: 'Incolor',
  };
  // Coreano (símbolos oficiales del TCG coreano)
  window.EL_KO = {
    grass: '풀', fire: '불꽃', water: '물', lightning: '번개', psychic: '초',
    fighting: '격투', darkness: '악', metal: '강철', dragon: '드래곤', colorless: '무색',
  };

  // ── Fases ──
  window.STAGE_LABEL = { basic: 'Básico', 0: 'Básico', 1: 'Fase 1', 2: 'Fase 2' };
  window.STAGE_LABEL_EN = { basic: 'Basic', 0: 'Basic', 1: 'Stage 1', 2: 'Stage 2' };
  window.STAGE_LABEL_JA = { basic: 'たね', 0: 'たね', 1: '1進化', 2: '2進化' };
  window.STAGE_LABEL_IT = { basic: 'Base', 0: 'Base', 1: 'Fase 1', 2: 'Fase 2' };
  window.STAGE_LABEL_FR = { basic: 'Base', 0: 'Base', 1: 'Niveau 1', 2: 'Niveau 2' };
  window.STAGE_LABEL_PT = { basic: 'Básico', 0: 'Básico', 1: 'Estágio 1', 2: 'Estágio 2' };
  window.STAGE_LABEL_KO = { basic: '기본', 0: '기본', 1: '1진화', 2: '2진화' };

  // Mapa idioma → tabla (fallback al español, que es el original). Añadir idioma = 1 línea.
  window._EL_MAP    = { en: 'EL_EN', ja: 'EL_JA', it: 'EL_IT', fr: 'EL_FR', pt: 'EL_PT', ko: 'EL_KO' };
  window._STAGE_MAP = { en: 'STAGE_LABEL_EN', ja: 'STAGE_LABEL_JA', it: 'STAGE_LABEL_IT', fr: 'STAGE_LABEL_FR', pt: 'STAGE_LABEL_PT', ko: 'STAGE_LABEL_KO' };
  window._CT_MAP    = { en: 'CARD_TYPE_EN', ja: 'CARD_TYPE_JA', it: 'CARD_TYPE_IT', fr: 'CARD_TYPE_FR', pt: 'CARD_TYPE_PT', ko: 'CARD_TYPE_KO' };
  window.elName = function (type) {
    var lang = window.i18n ? window.i18n.getLang() : 'es';
    var m = window[window._EL_MAP[lang]] || window.EL_ES;
    return (m && m[type]) || window.EL_ES[type] || type;
  };
  window.stageLabel = function (stage) {
    var lang = window.i18n ? window.i18n.getLang() : 'es';
    var m = window[window._STAGE_MAP[lang]] || window.STAGE_LABEL;
    return (m && m[stage] != null) ? m[stage] : (window.STAGE_LABEL[stage] != null ? window.STAGE_LABEL[stage] : stage);
  };

  // ── Tipo de carta (categoría) por idioma (JP/IT/FR = términos oficiales del TCG) ──
  window.CARD_TYPE_ES = { pokemon: 'Pokémon', item: 'Objeto', tool: 'Herramienta', supporter: 'Partidario', stadium: 'Estadio', fossil: 'Fósil' };
  window.CARD_TYPE_EN = { pokemon: 'Pokémon', item: 'Item', tool: 'Tool', supporter: 'Supporter', stadium: 'Stadium', fossil: 'Fossil' };
  window.CARD_TYPE_JA = { pokemon: 'ポケモン', item: 'グッズ', tool: 'ポケモンのどうぐ', supporter: 'サポート', stadium: 'スタジアム', fossil: '化石' };
  window.CARD_TYPE_IT = { pokemon: 'Pokémon', item: 'Strumento', tool: 'Strumento Pokémon', supporter: 'Aiuto', stadium: 'Stadio', fossil: 'Fossile' };
  window.CARD_TYPE_FR = { pokemon: 'Pokémon', item: 'Objet', tool: 'Outil Pokémon', supporter: 'Supporter', stadium: 'Stade', fossil: 'Fossile' };
  window.CARD_TYPE_PT = { pokemon: 'Pokémon', item: 'Item', tool: 'Ferramenta Pokémon', supporter: 'Apoiador', stadium: 'Estádio', fossil: 'Fóssil' };
  window.CARD_TYPE_KO = { pokemon: '포켓몬', item: '아이템', tool: '포켓몬의 도구', supporter: '서포트', stadium: '스타디움', fossil: '화석' };
  window.typeName = function (ct) {
    var lang = window.i18n ? window.i18n.getLang() : 'es';
    var m = window[window._CT_MAP[lang]] || window.CARD_TYPE_ES;
    return (m && m[ct]) || window.CARD_TYPE_ES[ct] || ct;
  };

  // ── Nombres de expansión por idioma ──
  // ES = nombres oficiales (de las carpetas de Daniel). JA parcial (resto → EN). EN = SET_NAMES.
  window.SET_NAMES_ES = {
    'B3B': 'Maravillas Cotidianas',
    'A1': 'Genes Formidables', 'A1A': 'Isla singular', 'A2': 'Pugna espaciotemporal',
    'A2A': 'Luz triunfante', 'A2B': 'Festival brillante', 'A3': 'Guardianes Celestiales',
    'A3A': 'Crisis dimensional', 'A3B': 'Arboleda de Eevee', 'A4': 'Saber Marino y Celeste',
    'A4A': 'Manantial Oculto', 'A4B': 'High Class EX', 'B1': 'Megaascenso',
    'B1A': 'Fuego Carmesí', 'B2': 'Desfile de Ensueño', 'B2A': 'Encantos de Paldea',
    'B2B': 'Megavariocolor', 'B3': 'Aura Pulsante', 'B3A': 'Impulso Paradójico',
    'B4': 'Dominador de los Cielos',            // verificado 2026-08-06 (WikiDex + Centro Pokémon)
    // B4A: el nombre oficial en español NO se ha publicado todavía (el set sale el 30-08-2026).
    // Sin entrada cae al inglés, que es el fallback correcto — NO inventarlo.
    'PA': 'Promo-A', 'PB': 'Promo-B',
  };
  window.SET_NAMES_JA = { 'B3B': 'ミラクルデイズ', 'A1': '最強の遺伝子', 'A1A': '幻想のいる島', 'B4': '天空の支配者' }; // parcial; resto → EN (pendiente JP). B4 verificado en Bulbapedia (infobox Japanese) 2026-08-02.
  // IT/PT: lo que cubre TCGdex (verificado 2026-08-06, descartando su fallback al inglés); resto → EN.
  window.SET_NAMES_IT = {
    'A1': 'Geni Supremi', 'A1A': "L'Isola Misteriosa", 'A2': 'Scontro Spaziotemporale',
    'A2A': 'Luce Trionfale', 'A2B': 'Tripudio Splendente', 'A3': 'Guardiani Astrali',
    'A4A': 'Sorgenti Recondite', 'B1A': 'Fiamme Cremisi', 'B2': 'Parata Fantasmagorica',
    'PA': 'Promo-A',
  };
  // FR: completo desde flibustier sets.json (22/22, verificado 2026-08-06).
  window.SET_NAMES_FR = {
    'A1': 'Puissance Génétique', 'A1A': "L'Île Fabuleuse", 'A2': 'Choc Spatio-Temporel',
    'A2A': 'Lumière Triomphale', 'A2B': 'Réjouissances Rayonnantes', 'A3': 'Gardiens Célestes',
    'A3A': 'Crise Interdimensionnelle', 'A3B': "La Clairière d'Évoli", 'A4': 'Sagesse entre Ciel et Mer',
    'A4A': 'Source Secrète', 'A4B': 'Booster de Luxe ex', 'B1': 'Méga-Ascension',
    'B1A': 'Embrasement Écarlate', 'B2': 'Parade Onirique', 'B2A': 'Merveilles de Paldea',
    'B2B': 'Méga-Rayonnement', 'B3': 'Aura Palpitante', 'B3A': 'Propulsion Paradoxe',
    'B3B': 'Jours Heureux', 'B4': 'Domination Céleste', 'PA': 'Promo-A', 'PB': 'Promo-B',
  };
  window.SET_NAMES_PT = {
    'A1': 'Dominação Genética', 'A1A': 'Ilha Mítica', 'A2': 'Embate do Tempo e Espaço',
    'A2A': 'Luz Triunfante', 'A2B': 'Festival Brilhante', 'A3': 'Guardiões Celestiais',
    'A4A': 'Nascentes Reclusas', 'B1A': 'Chama Carmesim', 'B2': 'Desfile Onírico',
    'PA': 'Promo-A',
  };
  window.SET_NAMES_KO = { 'A1': '최강의유전자', 'A1A': '환상이있는섬' }; // flibustier; TCGdex no cubre Pocket en KO; resto → EN
  window._SETN_MAP = { es: 'SET_NAMES_ES', ja: 'SET_NAMES_JA', it: 'SET_NAMES_IT', fr: 'SET_NAMES_FR', pt: 'SET_NAMES_PT', ko: 'SET_NAMES_KO' };
  window.setName = function (code) {
    var c = (code || '').toUpperCase();
    // «CU» no es una expansión del juego: es la marca de las cartas custom de tcgmini.
    // Enseñar el código pelado las haría pasar por un set real numerado.
    if (c === 'CU') return 'TCGmini';
    var lang = window.i18n ? window.i18n.getLang() : 'es';
    var m = window[window._SETN_MAP[lang]];
    return (m && m[c]) || (window.SET_NAMES && window.SET_NAMES[c]) || code;
  };

  // ── SOBRES (packs) ────────────────────────────────────────────
  // El arte lo genera gen_pack_images.py → data/packs.js (window.PACK_ART,
  // clave '<SET>|<pack de cards.db>'). Aquí solo los resolvers.
  //   packArt(set, pack)  → URL del sobre grande (o null si no hay arte)
  //   packThumb(set,pack) → URL de la miniatura
  //   setPacks(set)       → [{pack, art, thumb}] en el orden del juego (solo los que tienen arte)
  //   cardPacks(card)     → sobres en los que sale ESA carta ('Shared(...)' = todos los del set)
  function _packKey(set, pack) { return String(set || '').toUpperCase() + '|' + String(pack || '').trim(); }
  function _packFile(set, pack, thumb) {
    var k = (window.PACK_ART || {})[_packKey(set, pack)];
    if (!k) return null;
    // _normImg = raíz-absoluta en http(s) (rutas profundas tipo /es/mazos/<slug>), relativa en file://
    return window._normImg((window.PACK_ART_BASE || 'images/packs/') + k + (thumb ? '-t' : '') + '.webp');
  }
  window.packArt   = function (set, pack) { return _packFile(set, pack, false); };
  window.packThumb = function (set, pack) { return _packFile(set, pack, true); };
  var _setPacksCache = null;
  window.setPacks = function (set) {
    if (!_setPacksCache) {
      _setPacksCache = {};
      var art = window.PACK_ART || {};
      Object.keys(art).forEach(function (k) {          // el orden de PACK_ART = el del juego
        var i = k.indexOf('|'), s = k.slice(0, i), p = k.slice(i + 1);
        (_setPacksCache[s] = _setPacksCache[s] || []).push(
          { pack: p, art: window.packArt(s, p), thumb: window.packThumb(s, p) });
      });
    }
    return _setPacksCache[String(set || '').toUpperCase()] || [];
  };
  // Una carta 'Shared(...)' cae en TODOS los sobres de su expansión (así funciona en Pocket).
  window.cardPacks = function (c) {
    if (!c) return [];
    var p = (c.pack || '').trim(), all = window.setPacks(c.set);
    if (!p || /^Shared\(/i.test(p)) return all;
    var one = all.filter(function (x) { return x.pack === p; });
    return one.length ? one : [];
  };

  // Valor del desplegable de expansión: '' = todas · 'A1' = expansión · 'A1|Mewtwo' = un sobre.
  // Predicado ÚNICO del filtro (lo usan el buscador de Cartas y el del constructor de mazos):
  // dentro de un sobre, una carta 'Shared(...)' sale en TODOS los sobres de su expansión.
  window.setValueParse = function (raw) {
    var v = String(raw == null ? '' : raw).trim(), i = v.indexOf('|');
    return i < 0 ? { set: v, pack: '' } : { set: v.slice(0, i), pack: v.slice(i + 1) };
  };
  window.cardInSetValue = function (card, raw) {
    var p = window.setValueParse(raw);
    if (!p.set) return true;
    if (!card || card.set !== p.set) return false;
    if (!p.pack) return true;
    return card.pack === p.pack || /^Shared\(/i.test(card.pack || '');
  };

  // ── Iconos de rareza (PNG base64 en data/rarity.icons.js) ──
  // Cada rareza = un icono base repetido N veces (como en Pocket). Promo → null (texto).
  window.RARITY_ICON_SPEC = {
    '◊': ['diamond', 1], '◊◊': ['diamond', 2], '◊◊◊': ['diamond', 3], '◊◊◊◊': ['diamond', 4],
    'AR': ['star', 1], 'SAR': ['star', 2], 'IM': ['star', 3],
    '✸': ['shiny', 1], '✸✸': ['shiny', 2],
    '♕': ['crown', 1],
  };
  window.rarityIconHTML = function (rar) {
    var spec = window.RARITY_ICON_SPEC[rar];
    var icons = window.RARITY_ICONS || {};
    if (!spec || !icons[spec[0]]) return null;   // Promo / sin icono → usar texto
    var src = icons[spec[0]], h = '';
    for (var i = 0; i < spec[1]; i++) h += '<img class="rar-ico" src="' + src + '" alt="" draggable="false">';
    return h;
  };

  // ── Imagen de carta según idioma ──
  // Imágenes localizadas en images/<lang>/<id>.png (planas; las copia build_es_images.py).
  // Viajan con el proyecto al publicar (mismo origen). Para un CDN: cambiar la base del idioma.
  window.ES_IMG_FLAT = true; // imágenes planas <id>.png
  // En LOCAL (dev) las imágenes traducidas salen de las carpetas del proyecto (completas);
  // en producción, del CDN. Así probar en local no depende de que el CDN esté 100% subido.
  var _imgLocal = (location.protocol === 'file:') ||
    /^(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
  // ── Flags de entorno ──
  // En LOCAL (dev) las features SIN TERMINAR y los diagnósticos están ON (para probar);
  // en producción (dominio real) OFF → no salen al público. Forzar a mano si hace falta.
  // PREVIEW = despliegue de prueba de Cloudflare Pages en una rama que NO es main
  // (p.ej. beta.tcgmini.pages.dev). URL no listada que se comparte a mano para probar
  // lo que aún no es público. `tcgmini.pages.dev` a secas ES producción → NO cuenta.
  var _preview = /\.pages\.dev$/i.test(location.hostname) &&
    location.hostname.toLowerCase() !== 'tcgmini.pages.dev';
  window.PB_PREVIEW = _preview;
  // ENTORNO de esta carga, para las ESTADÍSTICAS de partida: 'dev' (tu máquina/LAN),
  // 'preview' (despliegue de prueba) o 'prod'. Sin esto, las partidas que juegas contra
  // ti mismo probando entrarían en el meta como si fueran de jugadores reales.
  window.PB_ENV = _imgLocal ? 'dev' : (_preview ? 'preview' : 'prod');
  // Versión de la web servida (el `?v=mNNN` de los assets): permite separar series
  // históricas cuando un cambio de reglas/pesos altera el meta. '' en el dist single-file.
  window.PB_BUILD = (function () {
    try {
      var els = document.querySelectorAll('script[src*="?v="], link[href*="?v="]');
      var best = '', bestN = -1;
      Array.prototype.forEach.call(els, function (el) {
        var m = ((el.getAttribute('src') || el.getAttribute('href')) || '').match(/[?&]v=([A-Za-z0-9._-]{1,12})/);
        if (!m) return;
        var n = /^m(\d+)$/.test(m[1]) ? parseInt(m[1].slice(1), 10) : -1;
        if (n > bestN || (bestN < 0 && !best)) { best = m[1]; bestN = n; }
      });
      return best;
    } catch (e) { return ''; }
  })();
  window.PB_FLAGS = window.PB_FLAGS || {
    debug: _imgLocal,            // toasts/paneles de diagnóstico (sync, auth, draft-multi)
    draftMultiplayer: true,  // multijugador del Draft — PÚBLICO
    // Beta pública: Estándar y Avanzado comparten el flujo actual de cola/sala.
    // Este interruptor sigue siendo la salida rápida: `false` + deploy vuelve a
    // dejar el online del tablero oculto sin tocar partidas ni datos existentes.
    pvp: true,
    // Login con Discord: PÚBLICO desde 2026-08-27 (decisión de Daniel). El servidor tiene su
    // propio interruptor (`publicRelease` en el secreto DISCORD_OAUTH_CONFIG): los DOS tienen
    // que estar abiertos para que alguien pueda darse de alta con Discord en tcgmini.com.
    // Salida rápida: `false` + deploy esconde el acceso sin tocar las cuentas ya vinculadas.
    discordAuth: true
  };
  window.pbFlag = function (k) { return !!(window.PB_FLAGS && window.PB_FLAGS[k]); };
  window.IMG_LANGS = {
    es: { map: function () { return window.ES_IMAGE_MAP; }, base: _imgLocal ? 'images/es/' : 'https://img.tcgmini.com/es/' },
    ja: { map: function () { return window.JA_IMAGE_MAP; }, base: _imgLocal ? 'images/ja/' : 'https://img.tcgmini.com/ja/' },
    it: { map: function () { return window.IT_IMAGE_MAP; }, base: _imgLocal ? 'images/it/' : 'https://img.tcgmini.com/it/' },
    fr: { map: function () { return window.FR_IMAGE_MAP; }, base: _imgLocal ? 'images/fr/' : 'https://img.tcgmini.com/fr/' },
    pt: { map: function () { return window.PT_IMAGE_MAP; }, base: _imgLocal ? 'images/pt/' : 'https://img.tcgmini.com/pt/' },
    ko: { map: function () { return window.KO_IMAGE_MAP; }, base: _imgLocal ? 'images/ko/' : 'https://img.tcgmini.com/ko/' },
  };
  window._langImg = function (id, lang) {
    var L = window.IMG_LANGS[lang]; if (!L || !id) return null;
    var m = L.map(); if (!m || !m[id]) return null;
    if (window.ES_IMG_FLAT) return L.base + id + (_imgLocal ? '.png' : '.webp');  // R2 = WebP (~84% más ligero); local dev = PNG de las carpetas
    return L.base + m[id].split('/').map(encodeURIComponent).join('/');
  };
  // Las imágenes locales (es/ja/preview en dev) son RELATIVAS («images/…»). Con las
  // rutas por mazo la URL es «/mazos/<slug>» (2 segmentos) → una ruta relativa se
  // resuelve contra «/mazos/» y da 404 → la carta DESAPARECE (solo en la vista del
  // mazo, y solo en idiomas/preview que usan rutas relativas; el inglés es absoluto
  // → no falla). Fix: normalizar «images/…» a raíz-absoluta «/images/…» en http(s)
  // (en file:// se deja relativa, que es lo correcto al abrir el HTML directo).
  window._normImg = function (u) {
    if (u && location.protocol !== 'file:' && /^(images|assets)\//.test(u)) return '/' + u;
    return u;
  };
  window.cardImage = function (card) {
    if (!card) return '';
    var u = window._langImg(card.id, window.i18n ? window.i18n.getLang() : 'es');
    // Si no hay imagen para el idioma, manda la URL CANÓNICA de la DB (por id) sobre la
    // `image` que traiga el registro: los mazos/escenarios GUARDADOS llevan dentro la URL
    // que era válida el día que se guardaron, y si la fuente mueve sus rutas (pasó el
    // 2026-08-15) esa copia queda muerta. El id sí es estable → se auto-reparan solos.
    // Mismo criterio que localizeImg. Las cartas custom no están en la DB → su image manda.
    // Último recurso: resolver por ID en la DB. Hace falta porque hay vistas que pasan la
    // carta REDUCIDA a {id, count} (el layout de mazo de Mis Mazos / meta / imagen descargable):
    // ahí no hay `image`, y una carta CUSTOM tampoco está en la DB de Pocket → sin esto su
    // <img> salía con src vacío y la carta no se veía en el mazo (aunque sí contara).
    var byId = (!u && card.id && window.dbLookup) ? (window.dbLookup({ id: card.id }) || {}).image : '';
    return window._normImg(u || (card.id && window._enImg && window._enImg(card.id)) || card.image || byId || '');
  };

  // ── Nombre de carta según idioma ──
  // ES: oficiales (TCGdex) + relleno OCR (TCGdex prioritario). JA: solo OCR (TCGdex no tiene Pocket).
  // ES: OCR (trainers) < TCGdex (oficial, 7 sets) < PokeAPI (Pokémon por ESPECIE → cubre TODAS las
  // impresiones y los sets futuros). PokeAPI manda en Pokémon porque los otros dos van por ID y
  // dejaban hermanas sin traducir (buscar «Ferrosaco» solo encontraba 1 de las 4 cartas).
  if (window.CARD_NAMES_ES_OCR || window.CARD_NAMES_ES_POKEAPI)
    window.CARD_NAMES_ES = Object.assign({}, window.CARD_NAMES_ES_OCR, window.CARD_NAMES_ES || {}, window.CARD_NAMES_ES_POKEAPI);
  if (window.CARD_NAMES_IT_OCR || window.CARD_NAMES_IT_POKEAPI)   // IT: mismo caso que ES (Iron Bundle → Saccoferreo)
    window.CARD_NAMES_IT = Object.assign({}, window.CARD_NAMES_IT_OCR, window.CARD_NAMES_IT || {}, window.CARD_NAMES_IT_POKEAPI);
  // FR: TCGdex (exacto) > OCR (trainers + propagación por especie) > PokeAPI (Pokémon de sets nuevos).
  if (window.CARD_NAMES_FR_OCR || window.CARD_NAMES_FR_POKEAPI)
    window.CARD_NAMES_FR = Object.assign({}, window.CARD_NAMES_FR_POKEAPI, window.CARD_NAMES_FR_OCR, window.CARD_NAMES_FR || {});
  if (window.CARD_NAMES_PT_OCR) window.CARD_NAMES_PT = Object.assign({}, window.CARD_NAMES_PT_OCR, window.CARD_NAMES_PT || {});
  // KO: TCGdex no cubre → OCR (trainers) > PokeAPI (Pokémon).
  if (window.CARD_NAMES_KO_OCR || window.CARD_NAMES_KO_POKEAPI)
    window.CARD_NAMES_KO = Object.assign({}, window.CARD_NAMES_KO_POKEAPI, window.CARD_NAMES_KO_OCR, window.CARD_NAMES_KO || {});
  window.NAME_MAPS = { es: function () { return window.CARD_NAMES_ES; }, ja: function () { return window.CARD_NAMES_JA; }, it: function () { return window.CARD_NAMES_IT; }, fr: function () { return window.CARD_NAMES_FR; }, pt: function () { return window.CARD_NAMES_PT; }, ko: function () { return window.CARD_NAMES_KO; } };
  window.cardName = function (card) {
    if (!card) return '';
    // Las CUSTOM llevan su nombre por idioma en la propia carta (son cartas del TCG físico:
    // el nombre oficial se verificó en TCGdex/PokeAPI). Lo que no esté traducido cae al inglés.
    if (card.custom && card.names) {
      var _cl = window.i18n ? window.i18n.getLang() : 'es';
      if (card.names[_cl]) return card.names[_cl];
    }
    var mf = window.NAME_MAPS[window.i18n ? window.i18n.getLang() : 'es'];
    var m = mf && mf();
    if (m && card.id && m[card.id]) return m[card.id];
    return card.name || '';
  };
  // Todos los nombres de la carta (inglés + traducciones ES/JA) en minúsculas, para buscar
  // en cualquier idioma sin importar la UI activa (p.ej. "helio" encuentra a Cyrus). Cacheado por id.
  var _searchNameCache = {};
  // PLEGADO para buscar y comparar nombres: quita tildes Y apostrofos de cualquier tipo
  // («damian»=«Damian», «farfetchd»=«Farfetch'd»=«Farfetch’d», «team rockets»=«Team Rocket's»).
  // Comprobado sobre la base entera: NO hay dos cartas distintas cuyo nombre solo difiera en
  // eso, asi que plegar no junta cartas que no lo sean.
  window.pbFold = function (s) {
    return String(s == null ? '' : s)
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')          // tildes
      .replace(/[\u2019\u2018\u0027\u0060\u00b4]/g, '');      // ' ’ ‘ ` ´
  };

  window.cardSearchNames = function (card) {
    if (!card) return '';
    var id = card.id;
    if (id && _searchNameCache[id] != null) return _searchNameCache[id];
    var parts = [card.name || ''];
    if (card.custom && card.names) {                      // custom: buscar también por su nombre oficial traducido
      for (var _k in card.names) if (card.names[_k]) parts.push(card.names[_k]);
    }
    for (var lang in window.NAME_MAPS) {
      if (!window.NAME_MAPS.hasOwnProperty(lang)) continue;
      var m = window.NAME_MAPS[lang] && window.NAME_MAPS[lang]();
      if (m && id && m[id]) parts.push(m[id]);
    }
    // Se guarda PLEGADO (sin tildes ni apostrofos): la consulta se pliega igual, asi que
    // «team rockets mewtwo» o «Team Rocket’s Mewtwo» encuentran lo mismo.
    var out = window.pbFold(parts.join(' \n ').toLowerCase());
    if (id) _searchNameCache[id] = out;
    return out;
  };

  // ── Nombre de ATAQUE / HABILIDAD según idioma ──
  // Keyeado por el nombre INGLÉS (que es la LLAVE del motor de efectos, CARD_EFFECTS[id][atk.name]):
  // esto es SOLO una capa de display, nunca toca el dato. Fuente = PokeAPI/TCGdex + OCR (data/*_names_*.js).
  // Funde el relleno OCR con la capa gratis/exacta (esta última MANDA), como los nombres de carta.
  function _mergeNames(base, ocr) { return Object.assign({}, ocr || {}, base || {}); }
  window.ATTACK_NAMES_ES  = _mergeNames(window.ATTACK_NAMES_ES,  window.ATTACK_NAMES_ES_OCR);
  window.ATTACK_NAMES_JA  = _mergeNames(window.ATTACK_NAMES_JA,  window.ATTACK_NAMES_JA_OCR);
  window.ATTACK_NAMES_IT  = _mergeNames(window.ATTACK_NAMES_IT,  window.ATTACK_NAMES_IT_OCR);
  window.ABILITY_NAMES_ES = _mergeNames(window.ABILITY_NAMES_ES, window.ABILITY_NAMES_ES_OCR);
  window.ABILITY_NAMES_JA = _mergeNames(window.ABILITY_NAMES_JA, window.ABILITY_NAMES_JA_OCR);
  window.ABILITY_NAMES_IT = _mergeNames(window.ABILITY_NAMES_IT, window.ABILITY_NAMES_IT_OCR);
  window.ATTACK_NAMES_FR  = _mergeNames(window.ATTACK_NAMES_FR,  window.ATTACK_NAMES_FR_OCR);
  window.ABILITY_NAMES_FR = _mergeNames(window.ABILITY_NAMES_FR, window.ABILITY_NAMES_FR_OCR);
  window.ATTACK_NAMES_PT  = _mergeNames(window.ATTACK_NAMES_PT,  window.ATTACK_NAMES_PT_OCR);
  window.ABILITY_NAMES_PT = _mergeNames(window.ABILITY_NAMES_PT, window.ABILITY_NAMES_PT_OCR);
  window.ATTACK_NAMES_KO  = _mergeNames(window.ATTACK_NAMES_KO,  window.ATTACK_NAMES_KO_OCR);
  window.ABILITY_NAMES_KO = _mergeNames(window.ABILITY_NAMES_KO, window.ABILITY_NAMES_KO_OCR);
  window.ATTACK_NAME_MAPS = { es: function () { return window.ATTACK_NAMES_ES; }, ja: function () { return window.ATTACK_NAMES_JA; }, it: function () { return window.ATTACK_NAMES_IT; }, fr: function () { return window.ATTACK_NAMES_FR; }, pt: function () { return window.ATTACK_NAMES_PT; }, ko: function () { return window.ATTACK_NAMES_KO; } };
  window.ABILITY_NAME_MAPS = { es: function () { return window.ABILITY_NAMES_ES; }, ja: function () { return window.ABILITY_NAMES_JA; }, it: function () { return window.ABILITY_NAMES_IT; }, fr: function () { return window.ABILITY_NAMES_FR; }, pt: function () { return window.ABILITY_NAMES_PT; }, ko: function () { return window.ABILITY_NAMES_KO; } };
  function _translateName(maps, enName) {
    if (!enName) return enName || '';
    var lang = window.i18n ? window.i18n.getLang() : 'es';
    var mf = maps[lang]; var m = mf && mf();
    return (m && m[enName]) || enName;
  }
  window.attackName  = function (enName) { return _translateName(window.ATTACK_NAME_MAPS, enName); };
  window.abilityName = function (enName) { return _translateName(window.ABILITY_NAME_MAPS, enName); };

  // ── Cartas FAVORITAS ──
  // Lista de {id, savedAt} en localStorage; se sincroniza con la cuenta (cloud-sync, LIST_KEYS).
  var _favSet = null;
  window.pbFavorites = function () { try { return JSON.parse(localStorage.getItem('pocketboard_favorites_v1') || '[]'); } catch (e) { return []; } };
  window.pbFavSet = function () { if (!_favSet) _favSet = new Set(window.pbFavorites().map(function (f) { return f.id; })); return _favSet; };
  window.pbIsFav = function (id) { return window.pbFavSet().has(id); };
  window.pbFavInvalidate = function () { _favSet = null; };   // tras escritura externa (cloud)
  window.pbToggleFav = function (id) {
    var list = window.pbFavorites();
    var i = list.findIndex(function (f) { return f.id === id; });
    var now;
    if (i >= 0) { list.splice(i, 1); now = false; } else { list.push({ id: id, savedAt: Date.now() }); now = true; }
    localStorage.setItem('pocketboard_favorites_v1', JSON.stringify(list));
    _favSet = null;
    return now;   // true si ahora es favorita
  };

  // id desde una URL de imagen (EN .../a1-001.png o local images/<lang>/A1-001.png).
  // Identidad si la URL no es de una carta (custom/temp). Para tablero/draft (solo guardan URL).
  window.cardIdFromImage = function (url) {
    if (!url) return null;
    var u = url; try { u = decodeURIComponent(url); } catch (e) {}
    var m = u.match(/\/([A-Za-z0-9]+)-(\d+)\.(?:png|webp|jpe?g)(?:[?#]|$)/);
    if (m) return m[1].toUpperCase() + '-' + m[2];
    // …/cards/a1/001.webp — la fuente externa de arte reorganizó sus rutas el 2026-08-15
    // (antes .../images/cards/a1-001.png). Sin este patrón las cartas en inglés pierden su
    // id → dbLookup por imagen falla y con él todo lo que resuelve una carta desde el
    // tablero/descarte (efectos, localización, zoom).
    m = u.match(/\/cards\/([A-Za-z0-9]+)\/(\d+)\.(?:png|webp|jpe?g)(?:[?#]|$)/);
    if (m) return m[1].toUpperCase() + '-' + m[2];
    // Cartas CUSTOM: su fichero no lleva el id en el nombre (images/custom/custom_ultra-ball_en.webp)
    // → se resuelve por el mapa fichero→id. Sin esto, todo lo que identifica una carta por su
    // imagen (ficha del zoom, motor de efectos, localización) las da por desconocidas.
    if (u.indexOf('/images/custom/') !== -1) {
      var file = u.split('/images/custom/')[1].split(/[?#]/)[0];
      if (_customByFile === null) {
        _customByFile = {};
        (window.CUSTOM_CARDS || []).forEach(function (c) {
          var f = String(c.image || '').split('/').pop();
          if (f) _customByFile[f] = c.id;
        });
      }
      return _customByFile[file] || null;
    }
    return null;
  };
  var _customByFile = null;

  // Texto de una carta CUSTOM en el idioma activo (fallback: inglés). El arte solo existe en
  // inglés, así que la traducción vive en el dato y se enseña en la ficha del zoom.
  window.customCardText = function (card) {
    var t = card && card.text;
    if (!t) return '';
    if (typeof t === 'string') return t;
    var lang = (window.i18n && window.i18n.getLang) ? window.i18n.getLang() : 'en';
    return t[lang] || t.en || '';
  };
  window._enImg = function (id) {  // URL inglesa canónica por id (de la DB)
    if (!window._EN_IMG && window.CARDS_DB) { window._EN_IMG = {}; window.CARDS_DB.forEach(function (c) { if (c.id) window._EN_IMG[c.id] = c.image; }); }
    return window._EN_IMG ? window._EN_IMG[id] : null;
  };
  // URLs a probar para el arte de una carta, de mejor a peor. Las usa TODO lo que
  // dibuja cartas en un canvas (imagen de mazo, tierlist): ahí se carga con
  // crossOrigin (si no, el canvas queda «manchado» y no se puede descargar) y
  // cualquier fallo deja la carta en GRIS. Fallos reales vistos: entrada del CDN
  // cacheada sin cabecera CORS, y sets nuevos cuyo arte inglés es un fichero LOCAL
  // («images/en/B4-103.webp») que no existe si la página se abre desde el dist o
  // desde una ruta profunda. La cadena cierra los tres agujeros: idioma actual →
  // inglesa canónica (absoluta en los sets viejos) → copia de R2 en CUALQUIER
  // idioma (siempre absoluta y con CORS). Mejor la carta en otro idioma que gris.
  window.cardImageCandidates = function (card) {
    if (!card) return [];
    var out = [], seen = {};
    var add = function (u) { if (u && !seen[u]) { seen[u] = 1; out.push(u); } };
    var id = card.id || window.cardIdFromImage(card.image || '');
    add(window.cardImage(card));
    if (card.image) add(window._normImg(card.image));
    if (id) {
      var en = window._enImg(id); if (en) add(window._normImg(en));
      var cur = window.i18n ? window.i18n.getLang() : 'es';
      var langs = Object.keys(window.IMG_LANGS);
      if (langs.indexOf(cur) >= 0) langs = [cur].concat(langs.filter(function (l) { return l !== cur; }));
      langs.forEach(function (lang) {
        var m = window.IMG_LANGS[lang].map && window.IMG_LANGS[lang].map();
        if (m && m[id]) add('https://img.tcgmini.com/' + lang + '/' + id + '.webp');
      });
    }
    return out;
  };

  // imgThumb: antes generaba miniaturas vía Cloudflare Image Transformations
  // (/cdn-cgi/image/...). DESACTIVADO (2026-06-27): el plan gratis agota su cuota de
  // ~5.000 transformaciones ÚNICAS/mes y devuelve 429 "ERROR 9422" que Cloudflare
  // cachea 4 h → cartas aleatorias del grid que no cargaban NUNCA. Sustituido por WebP
  // a tamaño completo servido DIRECTO desde R2 (ver _langImg: en producción las cartas
  // es/ja se piden .webp, ~84% más ligeras que el PNG —34 KB vs 208 KB— y nítidas para
  // grid + zoom). imgThumb queda como passthrough (no-op) para no tocar sus llamadas.
  window.imgThumb = function (url) { return url; };

  // Pone un background-image de carta con RED DE SEGURIDAD: si la .webp de R2 no existe
  // todavía (un set recién metido aún sin convertir, o una subida a medias) cae solo a
  // la .png equivalente. Solo aplica a las URLs de R2 es/ja; el resto se asigna directo.
  window.setCardBg = function (el, url) {
    if (!el || !url) return;
    var fb = url.replace(/^(https:\/\/img\.tcgmini\.com\/(?:es|ja)\/.+)\.webp$/, '$1.png');
    if (fb === url) { el.style.backgroundImage = 'url("' + url + '")'; return; }
    var im = new Image();
    im.onload  = function () { el.style.backgroundImage = 'url("' + url + '")'; };
    im.onerror = function () { el.style.backgroundImage = 'url("' + fb  + '")'; };
    im.src = url;
  };
  window.localizeImg = function (url) {
    if (!url) return url;
    var id = window.cardIdFromImage(url);  // reconoce .png/.webp/cdn-cgi/local → mismo id
    return window._normImg(id ? (window._langImg(id, window.i18n ? window.i18n.getLang() : 'es') || window._enImg(id) || url) : url);
  };
  // Convierte un valor CSS url(...) (posiblemente RELATIVO) en uno ABSOLUTO contra el documento.
  // Imprescindible para --cimg: el overlay ::after que pone "del derecho" la mano del rival vive
  // en css/styles.css, así que una url RELATIVA dentro de una custom property se resuelve contra
  // la HOJA DE ESTILO (…/css/) → 404 → overlay vacío → la carta se ve VOLTEADA por el contenedor.
  // El fondo propio de la carta (estilo inline) sí resuelve contra el documento; por eso solo
  // fallaba el ::after, y solo en local/idioma con imágenes relativas (es/ja). Absoluto = siempre carga.
  window._absCssUrl = function (cssUrl) {
    if (!cssUrl) return cssUrl;
    var m = cssUrl.match(/url\(["']?(.*?)["']?\)/); if (!m || !m[1]) return cssUrl;
    try { return 'url("' + new URL(m[1], document.baseURI).href + '")'; } catch (e) { return cssUrl; }
  };
  // Re-localiza TODAS las imágenes de carta visibles (al cambiar idioma o al cargar).
  window.reskinCards = function (root) {
    (root || document).querySelectorAll('[style*="cards/"],[style*="img.tcgmini.com"],[style*="images/es/"],[style*="images/ja/"]').forEach(function (el) {
      var bg = el.style.backgroundImage; if (!bg || bg === 'none') return;
      var mm = bg.match(/url\(["']?(.*?)["']?\)/); if (!mm) return;
      var loc = window.localizeImg(mm[1]);
      if (loc && loc !== mm[1]) {
        el.style.backgroundImage = 'url("' + loc + '")';
        // Mano del rival (P2): el overlay ::after que voltea la carta del derecho usa --cimg.
        // Si no lo sincronizamos, queda apuntando a la imagen vieja (CDN incompleto → 404) y
        // se ve el fondo de la carta volteado por el contenedor = AL REVÉS. Mantenerlo en sync.
        if (el.classList.contains('card') || el.style.getPropertyValue('--cimg')) el.style.setProperty('--cimg', window._absCssUrl('url("' + loc + '")'));
      }
    });
  };

  // ── ¿Es una carta Pokémon? (criterio único para todo el proyecto) ──
  // cardType manda; si falta (saves antiguos), health>0 es la señal.
  window.isPokemonCard = function (c) {
    if (!c) return false;
    if (c.cardType === 'pokemon') return true;
    if (c.cardType && c.cardType !== 'trainer') return false; // item/tool/supporter/stadium/fossil
    return Number(c.health || c.hp || c.hpMax || 0) > 0;
  };

  // ── ¿Está el usuario escribiendo / dentro de un modal? ──
  // Guard único para TODOS los atajos de teclado del tablero: ninguna tecla
  // debe actuar como shortcut mientras se escribe (inputs, contenteditable
  // como los nombres de mazo/jugador) o con un modal abierto.
  window.isTypingContext = function () {
    const el = document.activeElement;
    if (el) {
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
    }
    // Modales propios abiertos (el foco puede estar en un botón del modal). Solo los VISIBLES:
    // el shell del online (`#pvp-overlay`) es un `.pb-modal-overlay` que vive oculto en el body,
    // y contarlo dejaba muertos los atajos de teclado del tablero para el resto de la sesión.
    if (Array.prototype.some.call(
          document.querySelectorAll('.pb-modal-overlay, #import-modal, #temp-card-modal, #deck-picker-modal'),
          function (el) { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; }
        )) return true;
    return false;
  };

  // ── Lookup de carta en la DB por id / imagen / nombre (lazy) ──
  // Para resolver metadatos (stage, evolvesFrom…) de cartas que vienen de
  // saves antiguos o colas serializadas sin todos los campos.
  let _dbById = null, _dbByImage = null, _dbByName = null;
  function _buildDbMaps() {
    _dbById = new Map(); _dbByImage = new Map(); _dbByName = new Map();
    // Las CUSTOM (data/custom.cards.js) se indexan igual que las oficiales para que se
    // resuelvan en mazos, guardados y efectos — pero NO están en CARDS_DB, así que no
    // aparecen en Cartas / Mazos / Draft / Tierlist ni en la búsqueda por defecto.
    (window.CARDS_DB || []).concat(window.CUSTOM_CARDS || []).forEach(c => {
      if (c.id && !_dbById.has(c.id)) _dbById.set(c.id, c);
      if (c.image && !_dbByImage.has(c.image)) _dbByImage.set(c.image, c);
      const n = (c.name || '').toLowerCase();
      if (n && !_dbByName.has(n)) _dbByName.set(n, c);
    });
  }
  // ¿Carta que no existe en Pocket? (`custom` = de nuestra DB propia; `_temp` = las viejas
  // subidas al navegador, que siguen funcionando hasta que se horneen en el proyecto)
  window.isCustomCard = function (c) { return !!(c && (c.custom || c._temp)); };
  window.dbLookup = function (cardLike) {
    if (!cardLike) return null;
    if (_dbById === null) _buildDbMaps();
    if (cardLike.id && _dbById.has(cardLike.id)) return _dbById.get(cardLike.id);
    if (cardLike.image) {
      if (_dbByImage.has(cardLike.image)) return _dbByImage.get(cardLike.image);
      // Imagen LOCALIZADA (es/ja: img.tcgmini.com/es/<ID>.png o images/es/<id>.png): no está en
      // _dbByImage (que solo tiene la canónica) → saca el id de la URL y busca por id.
      if (window.cardIdFromImage) { var _idfi = window.cardIdFromImage(cardLike.image); if (_idfi && _dbById.has(_idfi)) return _dbById.get(_idfi); }
    }
    const n = (cardLike.name || '').toLowerCase();
    if (n && _dbByName.has(n)) return _dbByName.get(n);
    return null;
  };

  /* ── Reparar una carta de un mazo GUARDADO ────────────────────────────────────────────
     Un mazo hornea el `name` de cada carta junto a su `id`. Los ids de una expansión en
     PREVIEW son PROVISIONALES: cuando llega el set oficial, ese id puede pasar a ser otra
     carta (los 15 ids del tráiler de B4a lo hicieron). A partir de ahí el mazo guardado
     enseña una carta y dice otra, y el tope de 2 copias —que va por NOMBRE— cuenta mal y
     deja meter cuatro.
     Al LEER se comprueba la coherencia id↔nombre. Si no cuadra manda el NOMBRE, que es lo que
     el usuario eligió y lo único estable (Pocket no renombra cartas). Una carta coherente NO
     se toca nunca: la impresión exacta importa (ver [[mazos-codigo-exacto-carta]]). */
  window.repairDeckCard = function (rec) {
    if (!rec || rec._temp || rec.custom) return rec;          // custom: no viven en la DB
    var guardado = String(rec.name || '').trim();
    if (!guardado) return rec;                                 // sin nombre no hay nada que cotejar
    var porId = rec.id ? window.dbLookup({ id: rec.id }) : null;
    if (porId && porId.name === guardado) return rec;          // coherente
    var porNombre = window.dbLookup({ name: guardado });
    if (!porNombre || (porId && porNombre.id === porId.id)) return rec;   // el nombre ya no existe: se deja
    return Object.assign({}, rec, {
      id: porNombre.id, name: porNombre.name, image: porNombre.image || '',
      health: porNombre.health || 0, cardType: porNombre.cardType || '',
      element: porNombre.element || '', stage: porNombre.stage != null ? porNombre.stage : '',
      evolvesFrom: porNombre.evolvesFrom || '', number: porNombre.number || '',
      rarity: porNombre.rarity || '',
      expansion: window.cardSetCode ? window.cardSetCode(porNombre) : (porNombre.set || '')
    });
  };
  /* Repara la lista de cartas de un mazo. Devuelve null si no hacía falta tocar nada, para
     que quien lo llame sepa si tiene que reescribir. */
  window.repairDeckCards = function (cards) {
    if (!Array.isArray(cards)) return null;
    var cambio = false;
    var out = cards.map(function (c) { var r = window.repairDeckCard(c); if (r !== c) cambio = true; return r; });
    return cambio ? out : null;
  };

  // ── Código de expansión y número de una carta (A1-089 → «A1» / «089») ──
  // El campo canónico de la DB es `set`, pero los objetos normalizados del buscador usan
  // `expansion`, y los registros SLIM que se guardan (biblioteca, partida) pueden traer los
  // DOS vacíos porque se serializaba `expansion` sin caer a `set`. El id SIEMPRE lleva el
  // código (verificado: los 3754 ids son «<SET>-<NNN>» y su prefijo coincide con `set`), así
  // que se deriva de ahí → los mazos YA guardados vuelven a exportarse con su expansión, sin
  // migrar nada. NUNCA se resuelve por nombre: elegiría otra impresión y el código exacto de
  // carta (que es lo que hace fiel la lista al re-importarla) dejaría de serlo.
  const _CARD_ID_RE = /^([A-Za-z][A-Za-z0-9]{0,5})-(\d{1,4})$/;   // hoy el código más largo son 3 (A1A/B2B); holgura para sets futuros
  function _cardIdParts(c) {
    const m = _CARD_ID_RE.exec(String((c && c.id) || ''));
    if (m) return m;
    const db = (c && c.image && !c._temp) ? window.dbLookup({ image: c.image }) : null;   // sin `name`: sin fallback por nombre
    return db ? _CARD_ID_RE.exec(String(db.id || '')) : null;
  }
  window.cardSetCode = function (c) {
    if (!c) return '';
    const direct = c.expansion || c.set || '';
    if (direct) return String(direct).toUpperCase();
    const p = _cardIdParts(c);
    return p ? p[1].toUpperCase() : '';
  };
  window.cardNumber = function (c) {
    if (!c) return '';
    if (c.number) return String(c.number);
    const p = _cardIdParts(c);
    return p ? p[2] : '';
  };

  // ── Lista de mazo en TEXTO (formato Limitless) ──
  // Un solo generador para los DOS sitios que exportan (pestaña Mazos y barra lateral del
  // tablero) — antes eran dos copias y cualquier arreglo había que hacerlo dos veces.
  // El formato es el que escribe Limitless, para poder pegar la lista allí tal cual:
  // bloque de Pokémon · línea en blanco · bloque de Entrenadores · línea en blanco ·
  // `Energy: <tipos>`. Sus códigos llevan el sufijo en minúscula (A1a, B2b) y las promos
  // con guion (P-A), y los números van SIN ceros a la izquierda. Convenciones verificadas
  // contra las 17.694 listas reales del cache del meta (data/_meta_cache.json).
  const _EN_ENERGY = { grass: 'Grass', fire: 'Fire', water: 'Water', lightning: 'Lightning',
    psychic: 'Psychic', fighting: 'Fighting', darkness: 'Darkness', metal: 'Metal',
    colorless: 'Colorless', dragon: 'Dragon' };
  window.setCodeLimitless = function (code) {
    const c = String(code || '').toUpperCase();
    if (/^P[A-Z]$/.test(c)) return 'P-' + c[1];              // PA → P-A
    return c.length > 2 ? c.slice(0, 2) + c.slice(2).toLowerCase() : c;   // A1A → A1a
  };
  window.deckListText = function (cards, energyTypes) {
    const list = cards || [];
    // Agrupa por IMPRESIÓN (id), no por nombre: el límite de 2 copias de Pocket es por
    // NOMBRE, así que un mazo puede llevar dos impresiones distintas de la misma carta y
    // cada una necesita su línea (si no, al re-importar se pierde una).
    const counts = {}, order = [];
    list.forEach(c => {
      const k = (c && c.id) || (c && c.name) || '';
      if (!counts[k]) { counts[k] = { card: c, n: 0 }; order.push(k); }
      counts[k].n++;
    });
    const line = k => {
      const c = counts[k].card;
      const set = window.setCodeLimitless(window.cardSetCode(c));
      const numRaw = window.cardNumber(c);
      const num = /^\d+$/.test(numRaw) ? String(parseInt(numRaw, 10)) : numRaw;   // 007 → 7
      return [counts[k].n, c.name, set, num].filter(x => x !== '' && x != null).join(' ');
    };
    const isPk = k => (counts[k].card || {}).cardType === 'pokemon';
    const blocks = [order.filter(isPk).map(line), order.filter(k => !isPk(k)).map(line)]
      .filter(b => b.length).map(b => b.join('\n'));
    const en = (energyTypes || []).map(t => _EN_ENERGY[t] || '').filter(Boolean);
    if (en.length) blocks.push('Energy: ' + en.join(', '));
    return blocks.join('\n\n');
  };

  // ── ¿Es un Pokémon básico? (criterio único, resolviendo stage vía DB) ──
  // En Pocket solo Fase 1/2 son evoluciones; EX/Mega/etc. son básicos.
  // Si el objeto no trae stage fiable (saves antiguos), se resuelve en la DB
  // y, como última señal, evolvesFrom ⇒ no es básico.
  window.isBasicPokemon = function (c) {
    if (!window.isPokemonCard(c)) return false;
    const db = window.dbLookup(c);
    const stage = (db && db.stage != null) ? db.stage : c.stage;
    if (stage === 1 || stage === 2 || stage === '1' || stage === '2'
        || (typeof stage === 'string' && /stage\s*[12]/i.test(stage))) return false;
    if (stage === 'basic' || stage === 0 || stage === '0' || stage === 'Basic') return true;
    // Stage desconocido: evolvesFrom es la señal definitiva
    const evoFrom = (db && db.evolvesFrom) || c.evolvesFrom;
    return !evoFrom;
  };

  // ── Inferir tipos de energía de un mazo por los COSTES de ataque ──
  // (no por el elemento de la carta: un Pokémon dragón puede atacar con agua+rayo).
  // Devuelve array de tipos ordenados por frecuencia, máx. maxTypes.
  // Fallback si ningún ataque tiene coste tipado: elemento más repetido del mazo.
  window.inferDeckEnergies = function (cards, maxTypes) {
    maxTypes = maxTypes || 3;
    const TYPED = new Set(['grass','fire','water','lightning','psychic','fighting','darkness','metal']);
    const counts = {};
    (cards || []).forEach(c => {
      if (!window.isPokemonCard(c)) return;
      const db = window.dbLookup(c) || c;
      (db.attacks || []).forEach(atk => {
        (atk.cost || []).forEach(t => {
          if (TYPED.has(t)) counts[t] = (counts[t] || 0) + 1;
        });
      });
    });
    let types = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    if (!types.length) {
      // Fallback: elemento más repetido entre los Pokémon del mazo
      const elCounts = {};
      (cards || []).forEach(c => {
        if (!window.isPokemonCard(c)) return;
        const db = window.dbLookup(c) || c;
        if (db.element && TYPED.has(db.element)) elCounts[db.element] = (elCounts[db.element] || 0) + 1;
      });
      types = Object.entries(elCounts).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    }
    return types.slice(0, maxTypes);
  };

  // ── Jugador activo del deck builder (J1/J2) ──
  window.activeDeckPlayer = function () {
    if (window._deckTabActive === 'p1' || window._deckTabActive === 'p2') return window._deckTabActive;
    const t2 = document.getElementById('deck-tab-p2');
    return (t2 && t2.classList.contains('active')) ? 'p2' : 'p1';
  };

  // ── Entrenadores con efecto automático en el tablero ──
  // (debe coincidir con el switch de staples del drag&drop de main.js)
  window.STAPLE_AUTO = new Set([
    'poké ball', 'poke ball',
    "professor's research", 'professors research',
    'copycat', 'copiona',
    'arven', 'damian',
    'lisia', 'ariana',
    'aura', 'may',
    'repeat ball', 'acopio ball',
    'ultra ball',
  ]);
  window.isAutoStaple = function (name) {
    return window.STAPLE_AUTO.has((name || '').toLowerCase().trim());
  };

  /* ══════════════════════════════════════════════════════════
     UI compartida: toast global + diálogos custom
     (sustituyen a alert/confirm/prompt nativos)
  ══════════════════════════════════════════════════════════ */

  let _toastEl = null, _toastTimer = null;
  window.pbToast = function (msg, duration) {
    if (!_toastEl) {
      _toastEl = document.createElement('div');
      _toastEl.id = 'pb-toast';
      document.body.appendChild(_toastEl);
    }
    _toastEl.textContent = msg;
    _toastEl.classList.add('visible');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => _toastEl.classList.remove('visible'), duration || 2400);
  };

  // Construye el esqueleto modal; devuelve {overlay, box, close(result)}
  function buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal';
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    let resolved = false;
    function close(cb) {
      if (resolved) return;
      resolved = true;
      overlay.classList.remove('open');
      setTimeout(() => { overlay.remove(); if (cb) cb(); }, 180);
    }
    return { overlay, box, close };
  }

  // Confirmación: pbConfirm({title, message, okLabel, cancelLabel, danger}) → Promise<boolean>
  window.pbConfirm = function (opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const { overlay, box, close } = buildModal();
      box.innerHTML =
        '<div class="pb-modal-title"></div>' +
        (opts.message ? '<div class="pb-modal-msg"></div>' : '') +
        '<div class="pb-modal-actions">' +
        '  <button class="pb-btn pb-cancel"></button>' +
        '  <button class="pb-btn pb-ok ' + (opts.danger ? 'pb-btn-danger' : 'pb-btn-primary') + '"></button>' +
        '</div>';
      box.querySelector('.pb-modal-title').textContent = opts.title || '¿Seguro?';
      if (opts.message) box.querySelector('.pb-modal-msg').textContent = opts.message;
      const okBtn = box.querySelector('.pb-ok');
      const cancelBtn = box.querySelector('.pb-cancel');
      okBtn.textContent = opts.okLabel || 'Aceptar';
      cancelBtn.textContent = opts.cancelLabel || 'Cancelar';
      okBtn.onclick = () => close(() => resolve(true));
      cancelBtn.onclick = () => close(() => resolve(false));
      // Un clic FUERA es un accidente, no una respuesta: la decisión se toma con los botones.
      // Y con `mandatory` (los dos botones son las OPCIONES de una carta ya jugada) tampoco
      // vale Escape — no hay «no elegir».
      if (opts.mandatory) box.classList.add('pb-modal-mandatory');
      else {
        const esc = e => {
          if (e.key === 'Escape') { e.stopPropagation(); close(() => resolve(false)); document.removeEventListener('keydown', esc, true); }
        };
        document.addEventListener('keydown', esc, true);
      }
      setTimeout(() => okBtn.focus(), 60);
    });
  };

  // Menú de opciones: pbChoose({title, message, options:[{value,label,desc,danger}], cancelLabel}) → Promise<value|null>
  // Lista vertical de acciones grandes; reutiliza el skin .pb-modal (estética Cartas).
  window.pbChoose = function (opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const { overlay, box, close } = buildModal();
      box.classList.add('pb-choose');
      let html = '<div class="pb-modal-title"></div>';
      if (opts.message) html += '<div class="pb-modal-msg"></div>';
      html += '<div class="pb-choose-list"></div>';
      if (opts.cancelLabel !== null) html += '<div class="pb-modal-actions"><button class="pb-btn pb-cancel"></button></div>';
      box.innerHTML = html;
      box.querySelector('.pb-modal-title').textContent = opts.title || '';
      if (opts.message) box.querySelector('.pb-modal-msg').textContent = opts.message;
      const list = box.querySelector('.pb-choose-list');
      if (opts.listClass) list.className += ' ' + opts.listClass;
      (opts.options || []).forEach(o => {
        // Opción RICA (o.html): el contenido lo pone quien llama — así se reutilizan componentes
        // que ya existen (p.ej. las bandas del selector de modos) sin replicar su markup aquí.
        // Va en un <div role="button"> porque ese markup puede traer botones dentro (la «i» de
        // las reglas), y un <button> dentro de otro <button> no es válido.
        const rich = !!o.html;
        const b = document.createElement(rich ? 'div' : 'button');
        if (rich) { b.setAttribute('role', 'button'); b.tabIndex = 0; }
        else b.type = 'button';
        b.className = 'pb-choose-opt' + (o.danger ? ' pb-choose-danger' : '') + (rich ? ' pb-choose-rich' : '');
        if (rich) {
          b.innerHTML = o.html;
          if (o.label) b.setAttribute('aria-label', o.label);
        } else {
          const lab = document.createElement('span');
          lab.className = 'pb-choose-label';
          lab.textContent = o.label || '';
          b.appendChild(lab);
          if (o.desc) {
            const d = document.createElement('span');
            d.className = 'pb-choose-desc';
            d.textContent = o.desc;
            b.appendChild(d);
          }
        }
        const pick = () => close(() => resolve(o.value));
        b.onclick = pick;
        if (rich) b.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
        list.appendChild(b);
        // Cableado extra del que llama (p.ej. un botón interno que NO debe elegir la opción:
        // basta con que su listener haga stopPropagation).
        if (typeof opts.onRender === 'function') opts.onRender(b, o);
      });
      const cancelBtn = box.querySelector('.pb-cancel');
      if (cancelBtn) {
        cancelBtn.textContent = opts.cancelLabel || (window.t ? window.t('common.cancel') : 'Cancelar');
        cancelBtn.onclick = () => close(() => resolve(null));
      }
      // Sin cierre por clic fuera (accidental): se elige una opción o se pulsa Cancelar.
      const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); close(() => resolve(null)); document.removeEventListener('keydown', esc, true); } };
      if (!opts.mandatory) document.addEventListener('keydown', esc, true);
    });
  };

  // Prompt de texto: pbPrompt({title, message, placeholder, value, okLabel}) → Promise<string|null>
  window.pbPrompt = function (opts) {
    opts = opts || {};
    return new Promise(resolve => {
      const { overlay, box, close } = buildModal();
      box.innerHTML =
        '<div class="pb-modal-title"></div>' +
        (opts.message ? '<div class="pb-modal-msg"></div>' : '') +
        '<input class="pb-input" type="text" maxlength="48" spellcheck="false">' +
        '<div class="pb-modal-actions">' +
        '  <button class="pb-btn pb-cancel">Cancelar</button>' +
        '  <button class="pb-btn pb-btn-primary pb-ok"></button>' +
        '</div>';
      box.querySelector('.pb-modal-title').textContent = opts.title || '';
      if (opts.message) box.querySelector('.pb-modal-msg').textContent = opts.message;
      const input = box.querySelector('.pb-input');
      input.placeholder = opts.placeholder || '';
      input.value = opts.value || '';
      const okBtn = box.querySelector('.pb-ok');
      okBtn.textContent = opts.okLabel || 'Guardar';
      const submit = () => close(() => resolve(input.value.trim() || null));
      const cancel = () => close(() => resolve(null));
      okBtn.onclick = submit;
      box.querySelector('.pb-cancel').onclick = cancel;
      // Sin cierre por clic fuera: perderías lo escrito por un despiste.
      input.addEventListener('keydown', e => {
        e.stopPropagation(); // no disparar atajos del tablero mientras se escribe
        if (e.key === 'Enter') submit();
        if (e.key === 'Escape') cancel();
      });
      setTimeout(() => { input.focus(); input.select(); }, 60);
    });
  };

  // Guardar mazo: nombre (opcional) + selector de ENERGÍA (siempre se confirma).
  // opts = {title, message, name, nameEditable, suggested:[types], okLabel}
  // → Promise<{name, energyTypes:[types]} | null>
  window.pbDeckSave = function (opts) {
    opts = opts || {};
    const tx = (k, d) => { const v = window.t ? window.t(k) : null; return (v && v !== k) ? v : d; };
    const TYPES = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'];
    const ICON  = { fire: 'R', water: 'W', grass: 'G', lightning: 'L', psychic: 'P', fighting: 'F', darkness: 'D', metal: 'M' };
    const MAX = 3;
    const sel = new Set((opts.suggested || []).filter(t => TYPES.includes(t)).slice(0, MAX));
    return new Promise(resolve => {
      const { overlay, box, close } = buildModal();
      box.innerHTML =
        '<div class="pb-modal-title"></div>' +
        (opts.message ? '<div class="pb-modal-msg"></div>' : '') +
        (opts.nameEditable ? '<input class="pb-input" type="text" maxlength="48" spellcheck="false">' : '') +
        '<div class="pb-en-label"></div>' +
        '<div class="pb-en-row"></div>' +
        '<div class="pb-en-hint"></div>' +
        '<div class="pb-modal-actions">' +
        '  <button class="pb-btn pb-cancel"></button>' +
        '  <button class="pb-btn pb-btn-primary pb-ok"></button>' +
        '</div>';
      box.querySelector('.pb-modal-title').textContent = opts.title || tx('deck.saveTitle', 'Guardar mazo');
      if (opts.message) box.querySelector('.pb-modal-msg').textContent = opts.message;
      box.querySelector('.pb-en-label').textContent = tx('deck.energyPick', 'Energía del mazo');
      box.querySelector('.pb-en-hint').textContent  = tx('deck.energyHint', 'Detectada por los costes de ataque · ajústala si hace falta');
      box.querySelector('.pb-cancel').textContent   = tx('common.cancel', 'Cancelar');
      box.querySelector('.pb-ok').textContent       = opts.okLabel || tx('common.save', 'Guardar');
      const input = box.querySelector('.pb-input');
      if (input) { input.placeholder = opts.name || ''; input.value = opts.name || ''; }

      const row = box.querySelector('.pb-en-row');
      function paint() {
        row.innerHTML = '';
        TYPES.forEach(type => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'pb-en-orb' + (sel.has(type) ? ' sel' : '') + (sel.size >= MAX && !sel.has(type) ? ' dim' : '');
          b.title = window.elName ? window.elName(type) : type;
          const src = window.ENERGY_ICONS && window.ENERGY_ICONS[ICON[type]];
          if (src) { const im = document.createElement('img'); im.src = src; im.draggable = false; b.appendChild(im); }
          else b.textContent = ICON[type];
          b.onclick = () => {
            if (sel.has(type)) sel.delete(type);
            else if (sel.size < MAX) sel.add(type);
            paint();
          };
          row.appendChild(b);
        });
      }
      paint();

      const done = ok => close(() => resolve(ok
        ? { name: (input ? input.value.trim() : '') || opts.name || '', energyTypes: TYPES.filter(t => sel.has(t)) }
        : null));
      box.querySelector('.pb-ok').onclick = () => done(true);
      box.querySelector('.pb-cancel').onclick = () => done(false);
      overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
      if (input) input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
      setTimeout(() => { if (input) { input.focus(); input.select(); } }, 60);
    });
  };

  /* ══════════════════════════════════════════════════════════
     Detección de táctil móvil + aviso del TABLERO.
     Ya hay versión móvil para el resto de la app; lo único que aún va
     mejor con ratón es el TABLERO (drag&drop de ratón, táctil en su tanda).
     Por eso el aviso NO bloquea la app al cargar: solo se muestra al abrir
     el Tablero en un dispositivo táctil, una vez por sesión.
  ══════════════════════════════════════════════════════════ */
  function pbIsTouchMobile() {
    const isSmall  = Math.min(window.screen.width, window.screen.height) < 700;
    const isCoarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    return isSmall && isCoarse;
  }
  window.pbIsTouchMobile = pbIsTouchMobile;

  window.pbBoardMobileNotice = function () {
    if (!pbIsTouchMobile()) return;
    if (sessionStorage.getItem('pb_board_notice_dismissed')) return;
    if (document.getElementById('pb-mobile-notice')) return;

    const ov = document.createElement('div');
    ov.id = 'pb-mobile-notice';
    ov.innerHTML =
      '<div class="pbmn-box">' +
      '  <div class="pbmn-icon">🖥️</div>' +
      '  <div class="pbmn-title">El tablero va mejor en escritorio</div>' +
      '  <div class="pbmn-msg">El tablero todavía usa arrastrar con ratón y aún no ' +
      'funciona bien con el dedo (su versión táctil está en camino). ' +
      'El resto de la app ya está adaptada a móvil.</div>' +
      '  <button class="pbmn-btn">Continuar igualmente</button>' +
      '</div>';
    ov.querySelector('.pbmn-btn').onclick = () => {
      sessionStorage.setItem('pb_board_notice_dismissed', '1');
      ov.classList.remove('open');
      setTimeout(() => ov.remove(), 250);
    };
    document.body.appendChild(ov);
    requestAnimationFrame(() => ov.classList.add('open'));
  };

  // ── Compartir mazos por URL ──────────────────────────────────
  // El mazo viaja en el hash (#deck=...) como base64-url de {v,n,c:[ids]}.
  // Solo ids de la DB: las cartas custom (sin id) no se pueden compartir.
  window.encodeDeckShare = function (deck) {
    const ids = (deck && deck.cards || []).map(c => c.id).filter(Boolean);
    if (!ids.length) return null;
    const json = JSON.stringify({ v: 1, n: (deck.name || '').slice(0, 60), c: ids });
    return btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  window.decodeDeckShare = function (code) {
    try {
      let b = String(code || '').replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      const obj = JSON.parse(decodeURIComponent(escape(atob(b))));
      if (!obj || obj.v !== 1 || !Array.isArray(obj.c) || !obj.c.length) return null;
      return obj;
    } catch (e) { return null; }
  };

  // Copiar al portapapeles con fallback (file:// no siempre tiene clipboard API)
  window.pbCopyText = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => _copyFallback(text));
    }
    return Promise.resolve(_copyFallback(text));
  };
  function _copyFallback(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) {}
    ta.remove();
  }

})();

/* ══ Accesibilidad: alt="" por defecto en imágenes sin alt (WCAG 1.1.1) ══
   Casi todas las <img> de la app son ICONOS decorativos (energía/tipo) o ARTE de
   carta cuyo NOMBRE ya aparece como texto al lado → alt="" (decorativa) es lo
   correcto y evita duplicar el anuncio del lector de pantalla. Un observador
   global lo aplica a lo ya existente y a lo que se cree después, en un único
   sitio (hay decenas de puntos de creación de <img> repartidos por el código). */
(function () {
  function fixImg(node) {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName === 'IMG') { if (!node.hasAttribute('alt')) node.setAttribute('alt', ''); return; }
    if (!node.querySelectorAll) return;
    var imgs = node.querySelectorAll('img:not([alt])');
    for (var i = 0; i < imgs.length; i++) imgs[i].setAttribute('alt', '');
  }
  function boot() {
    fixImg(document.body);
    try {
      // Solo reacciona a nodos AÑADIDOS (no a cambios de estilo/transform de las
      // animaciones) → coste despreciable: se dispara en altas de DOM puntuales.
      new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var added = muts[i].addedNodes;
          for (var j = 0; j < added.length; j++) fixImg(added[j]);
        }
      }).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

