/* ══════════════════════════════════════════════════════════════
   TURN FX  (js/turn-fx.js)
   Barrido hexagonal del cambio de turno, calcado del de Pokémon TCG Pocket
   (medido fotograma a fotograma sobre un clip del juego, 2026-08-21).

   CÓMO ES
     · Malla de hexágonos de punta arriba que se enciende y se apaga en onda.
     · Va SOBRE EL TAPETE y POR DEBAJO de huecos y cartas: el canvas se cuelga
       de `.board` (que es quien pinta el tapete) con z-index 0, y las zonas de
       juego viven en z-index 1. Decisión de Daniel: en Pocket va por encima
       porque es un móvil; en una pantalla ancha ensucia la lectura.
     · El sentido se invierte cada turno: se EXPANDE desde el centro cuando el
       turno se va al rival, y CONVERGE hacia el centro cuando vuelve a ti.
     · Píldora «Tu turno» / «Turno de tu rival» que se abre y se cierra desde
       el centro, para que acompañe al barrido.

   ES UNA PAUSA
     Mientras dura, la partida se detiene: ni robo, ni orbe de energía, ni
     habilidades de inicio de turno. Quien lo necesite usa `after(cb)`.
     Lo que NO se pausa es el aviso al rival en online: eso sale al instante
     (main.js dispara `_pvpOnTurnAdvanced` antes de nada).

   POR QUÉ UN CANVAS Y NO NODOS
     Un solo elemento y cero mutaciones de clase durante la animación: el
     observador de publicación del online tiene un debounce que se reinicia
     con cada mutación, y 200 hexágonos animándose lo retrasarían en bucle.

   TUNEO
     Todo vive en CFG. `window.pbTurnFx.cfg` es el mismo objeto, así que se
     puede tocar en caliente desde la consola para probar valores.
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CFG = {
    cols:  17,        // hexágonos a lo ancho del tapete
    dur:   1050,      // duración total (ms) — lo medido en Pocket
    sweep: 420,       // cuánto tarda la onda en recorrer el tapete
    life:  200,       // cuánto se queda encendido cada hexágono
    fill:  65,        // % de celdas que participan
    edge:  0.5,       // grosor del borde, en px sobre un tapete de 1280
    alpha: 30,        // % de opacidad del relleno
    tint:  25,        // % de tinte del color del jugador que entra
    dir:   'c',       // 'c' centro · 'tr' diagonal · 'r' lateral
    alt:   true,      // invertir el sentido según de quién sea el turno
    pill:  true,      // mostrar el aviso de turno
    light: '#eceef4', // gama de las teselas encendidas: blanco frío…
    dark:  '#0b0c12', // …y casi negro
    tail:  120,       // margen tras el barrido antes de reanudar la partida
    // ── el tapete ES un campo de hexágonos ──
    // Teselas con su tono y su relieve, fundidas con el fieltro. El barrido enciende esas
    // MISMAS teselas (un pelín más grandes, sin junta) y por eso parecen elevarse.
    // Valores fijados por Daniel con turn_fx_tuner.html (2026-08-21).
    bg:       true,
    bgStyle: 'field',     // 'field' = teselas con tono y volumen · 'outline' = solo el contorno
    bgAlpha:  18,     // % de intensidad del campo entero
    bgTone:   0,      // % de variación de tono entre teselas
    bgDepth:  15,     // % de relieve: luz arriba y sombra abajo en cada tesela
    bgGap:    2,      // % de junta entre teselas
    bgEdge:   5.5,    // grosor del trazo (solo en 'outline')
    bgColor: '#ffffff',   // color del trazo (solo en 'outline')
    bgBlend: 'overlay',   // cómo se funde con la mesa: soft-light · overlay · normal
    // ── sonido (BATTLE/OTHER/turn.mp3, evento board.turnChange) ──
    vol:   0.35,      // multiplicador sobre el volumen del panel de sonidos
    rate:  1,         // velocidad de reproducción
    pitch: 0          // tono, en semitonos (±12). Comparte motor con la velocidad:
                      // con pitch 0 la velocidad NO altera el tono; con pitch ≠ 0 sí.
  };
  var DEFAULTS = JSON.parse(JSON.stringify(CFG));

  // Ajustes guardados desde turn_fx_tuner.html (mismo origen → mismo localStorage)
  var STORE = 'pocketboard_turnfx_v1';
  try {
    var _saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (_saved && typeof _saved === 'object') {
      Object.keys(_saved).forEach(function (k) { if (k in CFG) CFG[k] = _saved[k]; });
    }
  } catch (e) {}

  var S = {
    epoch: 0, raf: 0, t0: 0, running: false,
    cv: null, ctx: null, pill: null, pillB: null,
    bg: null, bgKey: '',            // malla en reposo, cacheada fuera de pantalla
    W: 0, H: 0, cells: [], side: 'p2', queue: [], guard: 0
  };

  /**
   * El mp3 y su volumen base salen del panel de sonidos (SOUND_MAP/SOUND_DATA), así que
   * cambiarlo allí sigue funcionando; el CFG solo ajusta volumen, velocidad y tono.
   */
  function playTurnSound() {
    if (window.pbSoundOn && !window.pbSoundOn()) return;          // interruptor de Ajustes
    var m = window.SOUND_MAP && window.SOUND_MAP['board.turnChange'];
    var src = m && m.sound && window.SOUND_DATA && window.SOUND_DATA[m.sound];
    if (!src || m.enabled === false) {                             // sin mp3 asignado: camino normal
      if (window.sfx) { try { window.sfx('board.turnChange'); } catch (e) {} }
      return;
    }
    try {
      var base = (m.volume == null ? 0.8 : +m.volume);
      var vol = Math.max(0, Math.min(1, base * (CFG.vol == null ? 1 : CFG.vol)));
      var rate = Math.max(0.25, Math.min(4, (CFG.rate || 1) * Math.pow(2, (CFG.pitch || 0) / 12)));
      // Web Audio primero: un <audio> le quitaría el foco de medios al móvil y le pausaría
      // la música al usuario en CADA cambio de turno.
      if (window.pbPlaySample && window.pbPlaySample(m.sound, { vol: vol, rate: rate })) return;
      var a = new Audio(src);
      a.volume = vol;
      // Velocidad y tono comparten `playbackRate`: con pitch 0 se conserva el tono
      // (preservesPitch), y con pitch ≠ 0 se deja que el rate lo mueva, como un sampler.
      var keep = !CFG.pitch;
      a.preservesPitch = keep; a.mozPreservesPitch = keep; a.webkitPreservesPitch = keep;
      a.playbackRate = rate;
      var pr = a.play(); if (pr && pr.catch) pr.catch(function () {});
    } catch (e) {}
  }

  function reduced() {
    return document.documentElement.classList.contains('pb-reduce-motion');
  }
  function boardEl() {
    var b = document.querySelector('.board');
    // el tablero puede estar montado pero oculto (otra sección abierta)
    if (!b || !b.offsetParent) return null;
    return b;
  }

  // ── malla ───────────────────────────────────────────────────
  function rnd(a, b) { var x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); }

  function build() {
    var W = S.W, H = S.H;
    var hw = W / CFG.cols, R = hw / Math.sqrt(3), vs = R * 1.5;
    // TU turno se EXPANDE desde el centro; el del rival CONVERGE (decisión de Daniel)
    var outward = CFG.alt ? (S.side === 'p1') : true;
    var cells = [];
    for (var row = -1; row * vs < H + vs; row++) {
      for (var col = -1; col * hw < W + hw; col++) {
        var cx = col * hw + ((row & 1) ? hw / 2 : 0), cy = row * vs;
        if (rnd(col, row) > CFG.fill / 100) continue;
        var d;                                   // d = 0 → esta celda se enciende la primera
        if (CFG.dir === 'r') d = cx / W;
        else if (CFG.dir === 'c') d = Math.hypot(cx - W / 2, cy - H / 2) / Math.hypot(W / 2, H / 2);
        else d = (cx / W) * 0.62 + (1 - cy / H) * 0.38;
        if (!outward) d = 1 - d;
        cells.push({ cx: cx, cy: cy, R: R, d: Math.max(0, Math.min(1, d)),
                     dark: rnd(row, col) < 0.55, j: rnd(col * 3.1, row * 7.7) * 0.34 });
      }
    }
    S.cells = cells;
  }

  function hexPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (var i = 0; i < 6; i++) {
      var a = Math.PI / 180 * (60 * i - 90);
      var x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  }

  // ── montaje ─────────────────────────────────────────────────
  /**
   * Deja el lienzo montado y la malla en reposo pintada. Es PERMANENTE: montarlo y
   * desmontarlo en cada turno generaba dos mutaciones del tablero por turno (que el
   * observador de publicación del online cuenta), y además impedía el patrón de fondo.
   * Se puede llamar tantas veces como haga falta: solo reconstruye si algo cambió.
   */
  function ensure() {
    var board = document.querySelector('.board');
    if (!board) return null;
    if (!S.cv || !S.cv.parentNode) {
      var cv = document.createElement('canvas');
      cv.id = 'pb-turn-fx';
      cv.setAttribute('aria-hidden', 'true');
      board.insertBefore(cv, board.firstChild);
      S.cv = cv; S.ctx = cv.getContext('2d'); S.bgKey = '';
    }
    var W = S.cv.clientWidth, H = S.cv.clientHeight;
    if (!W || !H) return board;                 // el tablero aún no tiene tamaño (vista oculta)
    var key = [W, H, CFG.cols].join('|');   // el campo se regenera con el tamaño del tapete
    if (key !== S.bgKey) {
      sizeCanvas();
      buildBg();
      S.bgKey = key;
      refreshFelt();                 // el mosaico del fondo se recalcula con el ancho nuevo
      if (!S.running) paintIdle();
    }
    return board;
  }

  /** silueta de un hexágono de punta arriba, como path de SVG */
  function hexD(cx, cy, r) {
    var half = r * Math.sqrt(3) / 2, h2 = r / 2;
    var p = [[cx, cy - r], [cx + half, cy - h2], [cx + half, cy + h2],
             [cx, cy + r], [cx - half, cy + h2], [cx - half, cy - h2]];
    return 'M' + p.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L') + 'Z';
  }

  /**
   * CAMPO DE HEXÁGONOS para usarlo como CAPA DEL FONDO de la mesa (no como algo pintado
   * encima). No es un contorno: son TESELAS, cada una con su tono y con luz arriba y sombra
   * abajo, de modo que la mesa parece un panal en relieve. El barrido del turno enciende
   * esas mismas teselas —un pelín más grandes— y por eso se leen como si se elevaran.
   *
   * Se genera del tamaño exacto del tapete (no es un mosaico repetido: la variación de tono
   * entre teselas delataría la repetición) y con las MISMAS fórmulas que el barrido, así que
   * ambas retículas coinciden al píxel: el lienzo (`position:absolute; inset:0`) y el fondo
   * (`background-origin: padding-box`) comparten origen y tamaño.
   */
  function hexField(width, height) {
    var W = width || (S.cv && S.cv.clientWidth) || 0;
    var H = height || (S.cv && S.cv.clientHeight) || 0;
    if (!W || !H || !CFG.bg || !CFG.bgAlpha) return null;
    var hw = W / CFG.cols, R = hw / Math.sqrt(3), vs = R * 1.5;
    var outline = CFG.bgStyle === 'outline';
    var rr = R * (1 - (outline ? 0 : (CFG.bgGap || 0) / 100));
    var tone = (CFG.bgTone || 0) / 100, depth = (CFG.bgDepth || 0) / 100;
    var body = [];
    for (var row = -1; row * vs < H + vs; row++) {
      for (var col = -1; col * hw < W + hw; col++) {
        var cx = col * hw + ((row & 1) ? hw / 2 : 0), cy = row * vs;
        var d = hexD(cx, cy, rr);
        if (outline) {
          body.push("<path d='" + d + "' fill='none'/>");
        } else {
          // tono propio de la tesela + el degradado de volumen, compartido por todas
          var t = (0.30 + rnd(col, row) * tone).toFixed(3);
          body.push("<path d='" + d + "' fill='#ffffff' fill-opacity='" + t + "'/>" +
                    "<path d='" + d + "' fill='url(#pbv)'/>");
        }
      }
    }
    var defs = outline ? '' :
      "<defs><linearGradient id='pbv' x1='0.25' y1='0' x2='0.75' y2='1'>" +
        "<stop offset='0' stop-color='#ffffff' stop-opacity='" + depth.toFixed(3) + "'/>" +
        "<stop offset='0.45' stop-color='#ffffff' stop-opacity='0'/>" +
        "<stop offset='0.55' stop-color='#000000' stop-opacity='0'/>" +
        "<stop offset='1' stop-color='#000000' stop-opacity='" + (depth * 1.15).toFixed(3) + "'/>" +
      "</linearGradient></defs>";
    var stroke = outline
      ? " stroke='" + CFG.bgColor + "' stroke-width='" + Math.max(0.4, CFG.bgEdge * (W / 1280)).toFixed(2) + "' fill='none'"
      : '';
    var svg = "<svg xmlns='http://www.w3.org/2000/svg' width='" + Math.round(W) + "' height='" + Math.round(H) +
              "' viewBox='0 0 " + Math.round(W) + ' ' + Math.round(H) + "'>" + defs +
              "<g id='pbhex' opacity='" + (CFG.bgAlpha / 100).toFixed(3) + "'" + stroke + ">" +
              body.join('') + "</g></svg>";
    return {
      url: 'url("data:image/svg+xml,' + encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22') + '")',
      size: Math.round(W) + 'px ' + Math.round(H) + 'px',
      blend: CFG.bgBlend || 'normal'
    };
  }

  /** re-pinta la mesa para que recoja el patrón (lo compone updateFelt en main.js) */
  function refreshFelt() {
    if (window._pbRefreshFelt) { try { window._pbRefreshFelt(); } catch (e) {} }
  }

  /** (sin uso desde que el patrón vive en el fondo de la mesa) */
  function buildBg() {
    var W = S.W, H = S.H;
    var c = S.bg || (S.bg = document.createElement('canvas'));
    c.width = S.cv.width; c.height = S.cv.height;
    var g = c.getContext('2d');
    var dpr = c.width / Math.max(1, W);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);   // el patrón en reposo lo pinta la MESA, no este lienzo
  }

  /** estado en reposo: solo la malla tenue */
  function paintIdle() {
    if (!S.ctx) return;
    S.ctx.setTransform(S.cv.width / Math.max(1, S.W), 0, 0, S.cv.height / Math.max(1, S.H), 0, 0);
    S.ctx.clearRect(0, 0, S.W, S.H);
    S.ctx.globalAlpha = 1;
    if (S.bg && CFG.bg) S.ctx.drawImage(S.bg, 0, 0, S.W, S.H);
  }

  function mountPill() {
    if (!CFG.pill || S.pill) return;
    var p = document.createElement('div');
    p.id = 'pb-turn-pill';
    p.setAttribute('aria-hidden', 'true');
    p.innerHTML = '<b></b>';
    document.body.appendChild(p);
    S.pill = p; S.pillB = p.querySelector('b');
    placePill();
  }

  function unmountPill() {
    if (S.pill && S.pill.parentNode) S.pill.parentNode.removeChild(S.pill);
    S.pill = null; S.pillB = null;
  }

  function sizeCanvas() {
    var cv = S.cv; if (!cv) return;
    // clientWidth/Height = tamaño de LAYOUT: el tablero puede llevar un transform:scale
    // del ajuste de pantalla, y el rect visual daría medidas ya escaladas.
    var W = cv.clientWidth || cv.parentElement.clientWidth;
    var H = cv.clientHeight || cv.parentElement.clientHeight;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    S.W = W; S.H = H;
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
    S.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function placePill() {
    if (!S.pill) return;
    var host = document.getElementById('main-content');
    var r = host ? host.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    S.pill.style.left = (r.left + r.width / 2) + 'px';
    S.pill.style.top = (r.top + r.height / 2) + 'px';
  }


  // ── reproducción ────────────────────────────────────────────
  function frame(now) {
    if (!S.running || !S.ctx) return;
    var t = now - S.t0, ctx = S.ctx, W = S.W, H = S.H, total = CFG.dur;

    ctx.clearRect(0, 0, W, H);
    if (S.bg && CFG.bg) { ctx.globalAlpha = 1; ctx.drawImage(S.bg, 0, 0, W, H); }   // la malla de siempre, debajo

    // tinte del jugador que entra (entra y se va con la onda)
    if (CFG.tint > 0) {
      var tk = Math.max(0, Math.sin(Math.PI * Math.min(1, t / total)));
      ctx.globalAlpha = tk * CFG.tint / 100;
      ctx.fillStyle = S.side === 'p1' ? '#4dabff' : '#ff6b6b';
      ctx.fillRect(0, 0, W, H);
    }

    for (var i = 0; i < S.cells.length; i++) {
      var c = S.cells[i];
      var age = t - (c.d * CFG.sweep + c.j * CFG.sweep);
      if (age < 0) continue;
      var k;
      if (age < 90) k = age / 90;
      else if (age < CFG.life) k = 1;
      else if (age < CFG.life + 200) k = 1 - (age - CFG.life) / 200;
      else continue;
      k = k * k * (3 - 2 * k);
      hexPath(ctx, c.cx, c.cy, c.R * (0.86 + 0.14 * k));
      ctx.globalAlpha = Math.max(0, (k - 0.28) / 0.72) * CFG.alpha / 100;   // el borde entra antes que el relleno
      ctx.fillStyle = c.dark ? CFG.dark : CFG.light;
      ctx.fill();
      if (CFG.edge > 0) {
        ctx.globalAlpha = k * 0.85;
        ctx.strokeStyle = CFG.light;
        ctx.lineWidth = CFG.edge * (W / 1280);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // la píldora se abre y se cierra desde el centro, como el barrido
    if (S.pillB) {
      var openMs = 200, closeMs = 240, closeAt = total - closeMs, o;
      if (t < openMs) o = t / openMs;
      else if (t > closeAt) o = Math.max(0, (total - t) / closeMs);
      else o = 1;
      var e = o * o * (3 - 2 * o);
      S.pill.style.opacity = Math.min(1, e * 1.6).toFixed(3);
      S.pillB.style.clipPath = 'inset(0 ' + ((1 - e) * 50).toFixed(2) + '% 0 ' + ((1 - e) * 50).toFixed(2) + '% round 999px)';
      S.pillB.style.transform = 'scale(' + (0.94 + 0.06 * e).toFixed(3) + ')';
    }

    if (t < total) S.raf = requestAnimationFrame(frame);
    else finish(true);
  }

  function drainQueue(run) {
    var q = S.queue; S.queue = [];
    if (!run) return;
    for (var i = 0; i < q.length; i++) { try { q[i](); } catch (e) { console.warn('[turn-fx]', e); } }
  }

  function finish(run) {
    if (!S.running) return;
    S.running = false;
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = 0;
    if (S.guard) clearTimeout(S.guard);
    S.guard = 0;
    unmountPill();
    paintIdle();                    // el lienzo NO se retira: vuelve a la malla tenue
    S.cells = [];
    drainQueue(run !== false);
  }

  // ── API ─────────────────────────────────────────────────────
  var api = {
    cfg: CFG,

    /** ¿hay un barrido en curso? */
    active: function () { return !!S.running; },

    /** ms que faltan para que la partida pueda reanudarse (0 si no hay barrido) */
    hold: function () {
      if (!S.running) return 0;
      return Math.max(0, CFG.dur + CFG.tail - (performance.now() - S.t0));
    },

    /** ejecuta cb cuando el barrido acabe (o ya mismo si no hay ninguno) */
    after: function (cb) {
      if (typeof cb !== 'function') return;
      if (!S.running) { setTimeout(cb, 0); return; }
      S.queue.push(cb);
    },

    /**
     * Arranca el barrido. `side` = quién RECIBE el turno ('p1' = tú).
     * Devuelve los ms de pausa que impone (0 si no se anima).
     */
    play: function (side) {
      var board = boardEl();   // null si el tablero no está a la vista
      S.side = side === 'p1' ? 'p1' : 'p2';
      var txt = (window.t ? window.t(S.side === 'p1' ? 'board.turnYours' : 'board.turnRival')
                          : (S.side === 'p1' ? 'Tu turno' : 'Turno de tu rival'));

      if (S.running) finish(true);          // encadenado: cierra el anterior sin perder su cola

      playTurnSound();

      // Sin tablero a la vista o con las animaciones reducidas: ni barrido ni pausa
      // (el patrón del tapete se queda: no es una animación).
      if (!board || reduced()) {
        if (board && CFG.pill && reduced()) {
          mountPill();
          S.pillB.textContent = txt;
          S.pill.className = S.side === 'p1' ? 'mine' : '';
          S.pill.style.opacity = '1';
          // por referencia: si entra otro cambio de turno en estos 700 ms, un unmountPill()
          // a secas se llevaría por delante el aviso NUEVO.
          var _pl = S.pill;
          setTimeout(function () {
            if (_pl && _pl.parentNode) _pl.parentNode.removeChild(_pl);
            if (S.pill === _pl) { S.pill = null; S.pillB = null; }
          }, 700);
        }
        return 0;
      }

      S.epoch++;
      ensure();
      mountPill();
      placePill();
      S.pillB && (S.pillB.textContent = txt);
      S.pill && (S.pill.className = S.side === 'p1' ? 'mine' : '');
      build();
      S.running = true;
      S.t0 = performance.now();
      S.raf = requestAnimationFrame(frame);
      // Red de seguridad: pase lo que pase, la partida se reanuda.
      S.guard = setTimeout(function () { finish(true); }, CFG.dur + 3000);
      return CFG.dur + CFG.tail;
    },

    /**
     * Corta el barrido. `runPending` decide qué pasa con lo que estaba en pausa:
     * en un restore (deshacer / escenario / recarga) se DESCARTA, porque el
     * estado que entra ya trae lo que toque.
     */
    cancel: function (runPending) {
      S.epoch++;
      finish(runPending === true);
    },

    /** ── para turn_fx_tuner.html ── */
    defaults: DEFAULTS,
    /** aplica un puñado de ajustes en caliente (solo claves conocidas) */
    apply: function (patch) {
      if (!patch) return CFG;
      Object.keys(patch).forEach(function (k) { if (k in CFG) CFG[k] = patch[k]; });
      ensure();
      refreshFelt();            // el patrón de la mesa recoge los valores nuevos
      if (S.running) build();
      return CFG;
    },
    /** deja los ajustes actuales guardados para toda la web */
    save: function () { try { localStorage.setItem(STORE, JSON.stringify(CFG)); return true; } catch (e) { return false; } },
    /** vuelve a los valores del código */
    reset: function () {
      try { localStorage.removeItem(STORE); } catch (e) {}
      Object.keys(DEFAULTS).forEach(function (k) { CFG[k] = DEFAULTS[k]; });
      ensure();
      refreshFelt();
      return CFG;
    },
    /** prueba solo el sonido */
    sound: function () { playTurnSound(); },

    /** vuelve a medir el tapete (cambio de tamaño / de escala del tablero) */
    resize: function () {
      ensure();
      if (!S.running) return;
      placePill(); build();
    },

    /** monta el lienzo (idempotente) */
    ensure: ensure,

    /** capa de fondo con el campo de hexágonos, para que la componga updateFelt (main.js) */
    tile: hexField,

    /** hook de test: la primera celda en encenderse, para comprobar el sentido */
    _probe: function (side) {
      S.side = side === 'p1' ? 'p1' : 'p2';
      if (!ensure() || !S.W) return null;
      build();
      var first = null;
      for (var i = 0; i < S.cells.length; i++) if (!first || S.cells[i].d < first.d) first = S.cells[i];
      if (!first) return null;
      return { x: first.cx, y: first.cy, d: first.d, W: S.W, H: S.H,
               fromCenter: Math.hypot(first.cx - S.W / 2, first.cy - S.H / 2) / Math.hypot(S.W / 2, S.H / 2) };
    }
  };

  window.addEventListener('resize', function () { api.resize(); });

  // El tapete lleva la malla SIEMPRE. Se monta en cuanto el tablero existe y tiene tamaño;
  // el ResizeObserver cubre el caso de entrar al tablero desde otra sección (pasa de 0 a N)
  // y el reajuste de escala del tablero, sin necesidad de sondear cada poco.
  function boot() {
    var board = document.querySelector('.board');
    if (!board) { setTimeout(boot, 300); return; }
    ensure();
    if (typeof ResizeObserver !== 'undefined') {
      try { new ResizeObserver(function () { ensure(); }).observe(board); } catch (e) {}
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.pbTurnFx = api;
})();
