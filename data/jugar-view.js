/* ══════════════════════════════════════════════════════════════
   jugar-view.js — Hub «Jugar» (dirección lateral · hextech sobre pokéballs).
   Composición en columnas: MEJORES MAZOS (izq) · MAZO + JUGAR (centro) ·
   ÚLTIMA EXPANSIÓN (der). Paneles con doble marco de oro + brackets sobre
   el fondo de pokéballs; el cluster de acción del centro (Jugar/online/
   partida privada) en redondeado suave. Aditivo: solo jugar-view.js/css,
   reutiliza los window.* ya expuestos (mazos/draft/auth). i18n HECHA
   (claves «jugar.» y «pvp.» en data/i18n.js; se re-monta en 'langchange').
   ══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LIB_KEY = 'pocketboard_library_v1';
  var ACTIVE_KEY = 'pocketboard_active_deck_v1';
  var MODE_KEY = 'pocketboard_play_mode_v1';

  function loadLib() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]') || []; } catch (e) { return []; } }
  function activeDeck() {
    // Resolver ÚNICO (mazos-view.js): mismo criterio que el online. El cuerpo de abajo queda
    // como red por si mazos-view aún no cargó.
    if (window._pbActiveDeck) { try { return window._pbActiveDeck(); } catch (e) {} }
    var lib = loadLib();
    if (!lib.length) return null;
    var id = localStorage.getItem(ACTIVE_KEY), d = null;
    if (id) { for (var i = 0; i < lib.length; i++) { if (String(lib[i].id) === String(id)) { d = lib[i]; break; } } }
    return d || lib[0];
  }
  function coverUrl(deck) {
    if (!deck) return null;
    if (window._mazosDeckCover) { try { var c = window._mazosDeckCover(deck); if (c) return c; } catch (e) {} }
    var u = deck.firstCardImg || (deck.cards && deck.cards[0] && (deck.cards[0].image || deck.cards[0].img)) || '';
    return u ? (window.localizeImg ? window.localizeImg(u) : u) : null;
  }

  function pvpOn() { return !!(window.pbFlag && window.pbFlag('pvp')); }
  var PVP_ON = pvpOn();
  function T(k, v) { return window.t ? window.t(k, v) : k; }

  // Textos por CLAVE i18n (data/i18n.js, bloque «Hub Jugar»); se resuelven al PINTAR
  // (bandHTML/cardHTML/setMode) y el hub entero se re-monta en 'langchange'.
  function fmtAdvanced() { return window.formatName ? window.formatName('advanced') : 'Advanced'; }
  var MODES = [
    PVP_ON
      ? { key: 'estandar', fmt: 'standard', nameK: 'jugar.modeStandard', acc: 'var(--jv-a-std)', descK: 'jugar.descStandard', statK: 'jugar.statRealtime', action: 'pvp',  labelK: 'pvp.title', beta: true }
      : { key: 'estandar', fmt: 'standard', nameK: 'jugar.modeStandard', acc: 'var(--jv-a-std)', descK: 'jugar.descStandard', statK: 'pvp.soon',           action: null,   labelK: 'pvp.soon', soon: true },
    // Advanced: con el online activo, cola + partida privada dentro del flujo compartido;
    // sin online, se juega en local. Daniel mantiene juntos ambos formatos a propósito.
    PVP_ON
      ? { key: 'advanced', fmt: 'advanced', nameFn: fmtAdvanced, nameK: 'jugar.modeEvolved', acc: 'var(--jv-a-evo)', descK: 'jugar.descEvolved',        statK: 'jugar.statRealtime', action: 'pvpAdvanced',   labelK: 'pvp.title', beta: true }
      : { key: 'advanced', fmt: 'advanced', nameFn: fmtAdvanced, nameK: 'jugar.modeEvolved', acc: 'var(--jv-a-evo)', descK: 'jugar.descAdvancedLocal', statK: 'jugar.statLocal',    action: 'advancedLocal', labelK: 'jugar.startMatch' },
    PVP_ON
      ? { key: 'draft', nameK: 'nav.draft', acc: 'var(--jv-a-draft)', descK: 'jugar.descDraftOnline', statK: 'jugar.statRealtime',    action: 'draftQueue', labelK: 'pvp.title' }
      : { key: 'draft', nameK: 'nav.draft', acc: 'var(--jv-a-draft)', descK: 'jugar.descDraftLocal',  statK: 'jugar.statSoloFriends', action: 'draft',      labelK: 'jugar.startDraft' },
    { key: 'libre',    nameK: 'jugar.modeFree', acc: 'var(--jv-a-libre)', descK: 'jugar.descFree',  statK: 'jugar.statLocal',    action: 'board', labelK: 'jugar.openBoard' },
  ];
  // Nombre visible del modo: `nameFn` (p.ej. formato Advanced) manda sobre la clave i18n.
  function modeName(m) { return (m && m.nameFn) ? m.nameFn() : T(m.nameK); }
  function modeByKey(k) { for (var i = 0; i < MODES.length; i++) if (MODES[i].key === k) return MODES[i]; return MODES[0]; }
  function modeByKeyExact(k) { for (var i = 0; i < MODES.length; i++) if (MODES[i].key === k) return MODES[i]; return null; }
  function loadMode() { try { var k = localStorage.getItem(MODE_KEY); return (k && modeByKeyExact(k)) ? k : 'estandar'; } catch (e) { return 'estandar'; } }
  var cur = loadMode();

  var root;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function cardDesc(m) {
    // La desc termina con el stat en TODOS los idiomas (invariante del dict) → se recorta el sufijo.
    var d = (m.descK ? T(m.descK) : '') || '', s = (m.statK ? T(m.statK) : '').toLowerCase();
    if (!s) return d;
    var e = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return d.replace(new RegExp('\\s*[·\\-]\\s*' + e + '\\s*$', 'i'), '');
  }

  // ── Racha de victorias: componente visual compartido por Inicio + Fin PvP ──
  // El dato REAL llegará del servidor en la siguiente tanda. Esta capa no inventa rachas:
  // por defecto recibe 0 y queda oculta. `pbStreakUI.setHome/setFin` son el puente estable
  // para conectar después el resultado verificado sin volver a tocar la animación.
  var STREAK_MODES = { estandar: 'standard', advanced: 'advanced', draft: 'draft' };
  var streakFlameSeq = 0;
  var streakHome = { standard: 0, advanced: 0, draft: 0 };
  var streakFinResult = null;
  var streakFinHost = null;
  var streakTimers = [];

  function streakText(key, fallback, vars) {
    var s = T(key, vars);
    return (!s || s === key) ? fallback : s;
  }
  function streakValue(v) {
    v = Math.floor(Number(v) || 0);
    return Math.max(0, Math.min(999, v));
  }
  function clearStreakTimers() {
    while (streakTimers.length) clearTimeout(streakTimers.pop());
  }
  function streakLater(fn, ms) {
    var id = setTimeout(fn, ms);
    streakTimers.push(id);
    return id;
  }
  function reduceStreakMotion() {
    return document.documentElement.classList.contains('pb-reduce-motion') ||
      !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  function streakPillMarkup(value, opts) {
    opts = opts || {};
    value = streakValue(value);
    var blue = opts.blue != null ? !!opts.blue : value >= 10;
    var label = streakText('streak.label', 'Racha de victorias');
    var aria = streakText('streak.aria', 'Racha de {n} victorias').replace('{n}', value);
    return '<span class="pb-streak is-enter' + (blue ? ' is-blue' : '') + '"' +
      ' role="img" aria-label="' + esc(aria) + '" data-pb-streak>' +
        '<span class="pb-streak-cap">' + esc(label) + '</span>' +
        '<span class="pb-streak-num"><span data-pb-streak-digit>' + value + '</span></span>' +
      '</span>';
  }

  // Subida de una victoria: el dígito viejo sale hacia arriba y el nuevo entra desde abajo,
  // con un único latido del resplandor. Nada de rebotes ni escalones (petición de Daniel).
  function swapStreakNumber(pill, value) {
    var box = pill && pill.querySelector('.pb-streak-num');
    if (!box) return;
    value = streakValue(value);
    pill.classList.remove('is-bump');
    void pill.offsetWidth;
    pill.classList.add('is-bump');
    var old = box.querySelector('[data-pb-streak-digit]:last-child');
    if (old && old.textContent === String(value)) return;
    var next = document.createElement('span');
    next.setAttribute('data-pb-streak-digit', '');
    next.className = 'is-in';
    next.textContent = value;
    if (old) old.classList.add('is-out');
    box.appendChild(next);
    streakLater(function () {
      if (!box.isConnected) return;
      box.innerHTML = '<span data-pb-streak-digit>' + value + '</span>';
    }, 440);
  }

  function paintHomeStreak(m) {
    var host = root && root.querySelector('#jv-streak');
    if (!host) return;
    var center = root.querySelector('.jv2-center');
    var mode = m && STREAK_MODES[m.key];
    var value = mode ? streakValue(streakHome[mode]) : 0;
    if (value < 3) {
      host.hidden = true;
      host.innerHTML = '';
      host.removeAttribute('aria-label');
      if (center) center.classList.remove('jv2-has-streak');
      return;
    }
    host.hidden = false;
    host.removeAttribute('aria-label');   // lo lleva la propia píldora
    host.innerHTML = streakPillMarkup(value);
    if (center) center.classList.add('jv2-has-streak');
    // El pad del final reserva EXACTAMENTE lo que ocupa la píldora (medido, no un número
    // fijo): con y sin racha el bloque central mide igual → el hub no se recoloca.
    try {
      var mt = parseFloat(getComputedStyle(host).marginTop) || 0;
      var alto = Math.round(host.getBoundingClientRect().height + mt);
      if (alto > 0) root.style.setProperty('--jv-streak-space', alto + 'px');
    } catch (e) {}
  }

  function normaliseFinStreak(result) {
    if (!result || typeof result !== 'object') return null;
    var after = streakValue(result.after);
    if (after < 3) return null;
    return {
      mode: result.mode || 'standard',
      before: streakValue(result.before),
      after: after
    };
  }

  function playFinStreak(host, result) {
    clearStreakTimers();
    result = normaliseFinStreak(result);
    if (!host || !result) {
      if (host) { host.innerHTML = ''; host.classList.remove('is-active'); }
      return;
    }
    // 'enter' = la racha empieza a contar (no había) · 'upgrade' = cruza el 10 (maestría ×2)
    var kind = result.before < 3 ? 'enter' : (result.before < 10 && result.after >= 10 ? 'upgrade' : 'increment');
    var initial = kind === 'enter' ? result.after : Math.max(3, result.before);
    var initiallyBlue = initial >= 10 && kind !== 'upgrade';
    var bonus = streakText('streak.mastery2x', 'Maestría ×2 activada');
    host.classList.add('is-active');
    host.innerHTML = streakPillMarkup(initial, { blue: initiallyBlue }) +
      '<span class="pb-streak-x2" data-pb-streak-bonus' + (result.after >= 10 && initiallyBlue ? '' : ' hidden') + '>' +
        esc(bonus) + '</span>';
    var pill = host.querySelector('[data-pb-streak]');
    var bonusEl = host.querySelector('[data-pb-streak-bonus]');
    if (!pill) return;

    function settleFinal() {
      if (result.after >= 10) {
        pill.classList.add('is-blue');
        if (bonusEl) bonusEl.hidden = false;
      }
      var box = pill.querySelector('.pb-streak-num');
      if (box) box.innerHTML = '<span data-pb-streak-digit>' + result.after + '</span>';
      pill.setAttribute('aria-label',
        streakText('streak.aria', 'Racha de {n} victorias').replace('{n}', result.after));
    }
    if (reduceStreakMotion()) { pill.classList.remove('is-enter'); settleFinal(); return; }
    // la píldora entra, se lee un instante y ENTONCES sube el número
    streakLater(function () {
      if (!pill.isConnected) return;
      if (kind === 'upgrade') {
        pill.classList.add('is-blue');
        if (bonusEl) bonusEl.hidden = false;
      }
      if (kind !== 'enter') swapStreakNumber(pill, result.after);
      else { pill.classList.remove('is-bump'); void pill.offsetWidth; pill.classList.add('is-bump'); }
      pill.setAttribute('aria-label',
        streakText('streak.aria', 'Racha de {n} victorias').replace('{n}', result.after));
    }, kind === 'enter' ? 380 : 560);
  }

  // ── Puente con el dato REAL ──────────────────────────────────────────────
  // Las rachas las lleva la Cloud Function (users/{uid}/pvpStats/derived); el cliente
  // solo las LEE. Nada de contarlas aquí: una racha inventada en local rompería el ×2.
  // La Cloud Function tarda ~1,5-3 s en el caso bueno, pero ESPERA hasta 8 s al claim del
  // rival (y con arranque en frío se va a más): con la ventana corta de antes la subida
  // llegaba después de dejar de mirar y no se celebraba nunca.
  var STREAK_PULL = [1500, 3000, 5000, 8000, 13000, 21000];
  function streakModeOf(fmt, mode) {
    if (mode === 'draft') return 'draft';
    return fmt === 'advanced' ? 'advanced' : 'standard';
  }
  function readStreaks(force) {
    var M = window.PB_EMOTES;
    if (!M || !M.loadMine) return Promise.resolve(null);
    return M.loadMine(force).then(function (v) { return (v && v.streaks) || null; })
      .catch(function () { return null; });
  }
  function pullStreaks(force) {
    return readStreaks(force).then(function (st) {
      if (st) window.pbStreakUI.setHome(st);
      return st;
    });
  }
  // Tras ganar online: la racha la confirma el servidor, así que se espera a que el dato
  // CAMBIE y solo entonces se celebra. Si no llega (partida que no contó: corta, tope
  // diario…), no se enseña nada — mejor callar que celebrar una racha falsa.
  function pullFinStreak(mode) {
    mode = STREAK_MODES[mode] ? STREAK_MODES[mode] : (mode || 'standard');
    var before = streakValue(streakHome[mode]);
    var i = 0;
    (function next() {
      // Agotada la ventana sin ver el cambio: puede que la función aún esté por procesar la
      // sala (a veces la difiere minutos). Se olvida la caché para que la próxima lectura
      // —al volver al hub— traiga el dato REAL en vez del que quedó guardado aquí.
      if (i >= STREAK_PULL.length) {
        var M = window.PB_EMOTES;
        if (M && M.forgetMine) { try { M.forgetMine(); } catch (e) {} }
        return;
      }
      var wait = STREAK_PULL[i++];
      streakLater(function () {
        readStreaks(true).then(function (st) {
          var after = st ? streakValue(st[mode]) : before;
          if (!st || after === before) { next(); return; }
          window.pbStreakUI.setHome(st);
          if (after > before) window.pbStreakUI.setFin({ mode: mode, before: before, after: after });
        });
      }, wait);
    })();
  }

  window.pbStreakUI = {
    modeOf: streakModeOf,
    pull: pullStreaks,
    pullFin: pullFinStreak,
    pillMarkup: streakPillMarkup,
    flameMarkup: streakPillMarkup,   // alias: el icono se retiró, el puente sigue igual
    setHome: function (state) {
      state = state || {};
      ['standard', 'advanced', 'draft'].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(state, k)) streakHome[k] = streakValue(state[k]);
      });
      paintHomeStreak(modeByKey(cur));
    },
    getHome: function () { return Object.assign({}, streakHome); },
    setFin: function (result) {
      streakFinResult = normaliseFinStreak(result);
      if (streakFinHost && streakFinHost.isConnected) playFinStreak(streakFinHost, streakFinResult);
    },
    mountFin: function (host) {
      streakFinHost = host || null;
      if (streakFinHost && streakFinResult) playFinStreak(streakFinHost, streakFinResult);
    },
    replayFin: function () {
      if (streakFinHost && streakFinHost.isConnected && streakFinResult) playFinStreak(streakFinHost, streakFinResult);
    },
    clearFin: function () {
      clearStreakTimers();
      if (streakFinHost) { streakFinHost.innerHTML = ''; streakFinHost.classList.remove('is-active'); }
      streakFinHost = null;
      streakFinResult = null;
    }
  };
  window.addEventListener('pb-streaks', function (e) {
    if (e && e.detail && window.pbStreakUI) window.pbStreakUI.setHome(e.detail);
  });
  // sesión nueva (o cierre): las rachas son de la cuenta, no del dispositivo
  window.addEventListener('pb-auth', function () {
    var a = window.pbAccount && window.pbAccount();
    if (a && a.uid) pullStreaks(true);
    else window.pbStreakUI.setHome({ standard: 0, advanced: 0, draft: 0 });
  });

  // ── Banners del selector de modos (arte de carta ambiental) ──
  // Ilustraciones INMERSIVAS elegidas por Daniel (2026-08-21): Pikachu ex (A1-281) y
  // Charizard ex (A1-280) de Genes Formidables, Palkia ex (A2-204) para el tablero libre
  // y el Pikachu ex del Deluxe Pack (A4B-376) para Elección.
  // Ajuste POR MODO (opcional) y TOTALMENTE separado entre escritorio y móvil: lo único
  // que comparten es la carta (`id`).
  //   escritorio (tarjeta): dx/dy = desplazamiento en PÍXELES sobre el anclaje del CSS (sin
  //     tope: se puede sacar la ilustración fuera del hueco para que no asome su borde) ·
  //     z = zoom en % del ALTO · cs/cw = velo (opacidad de la base y a qué altura empieza) ·
  //     f = voltear
  //   móvil (banda):       bdx/bdy = desplazamiento en píxeles · bz = zoom en % del ANCHO ·
  //     bs/bw/bfd/bfr = velo (opacidad izquierda, ancho de la zona opaca, fin del fundido y
  //     opacidad a la derecha — con bfr:0 la ilustración se ve limpia en su lado) · bf = voltear
  // Con la izquierda opaca (bs alto + bw ancho) se puede encoger la ilustración (bz < 100)
  // y dejarla solo en la mitad derecha de la banda.
  // Lo que no se declare usa lo general de css/jugar-view.css.
  // Se ajusta en banners_tuner.html; lo definitivo se pega AQUÍ con «Copiar para el código».
  // Horneado desde banners_tuner.html (encuadre, zoom y velo por modo; los ajustó Daniel).
  // El localStorage del tuner sigue mandando sobre esto, pero solo en su navegador.
  var BANNER = {
    estandar: { id: 'A1-282', x: 73.48, y: 22.43, z: 148, dx: -4, dy: 12, bx: 0, by: 29.49, bz: 96, bdx: 30, bdy: 45, bs: 1, bw: 10, bfd: 40, bfr: 0 },
    advanced: { id: 'A1-280', x: 54.9, y: 36.32, z: 170, bx: 100, by: 45.45, bz: 106, bdx: 5, bdy: -26, bs: 1, bw: 10, bfd: 40, bfr: 0 },
    draft:    { id: 'A4B-376', x: 46.41, y: 26.93, z: 148, bx: 0, by: 41.01, bdx: 29, bdy: 90, bs: 1, bw: 10, bfd: 40, bfr: 0 },
    libre:    { id: 'A2-204', x: 32.31, y: 31.13, z: 174, f: 0, bx: 0, by: 44.05, bz: 120, bdx: 14, bdy: -9, bs: 1, bw: 10, bfd: 40, bfr: 0 },
  };
  var BANNER_G_DEF = { bandH: 114 };   // alto de las bandas de móvil

  // Ajustes del tuner: mandan sobre lo de arriba, pero SOLO en este navegador y origen
  // (son para calibrar; lo bueno se hornea en el bloque BANNER).
  var BANNER_G = Object.assign({}, BANNER_G_DEF);   // ajustes globales (hoy: alto de las bandas de móvil)
  try {
    var _bt = JSON.parse(localStorage.getItem('pocketboard_banner_tune_v1') || 'null');
    if (_bt) {
      Object.keys(BANNER).forEach(function (k) { if (_bt[k]) BANNER[k] = Object.assign({}, BANNER[k], _bt[k]); });
      if (_bt._g) BANNER_G = _bt._g;
    }
  } catch (e) {}
  // Encuadre y velo → variables CSS en el CONTENEDOR (las hereda el banner y el velo).
  var _BVARS = {
    card: [['dx', '--jvb-dx', 'px'], ['dy', '--jvb-dy', 'px'], ['z', '--jvb-z', '%'],
           ['cs', '--jvcs-op', ''], ['cw', '--jvcs-start', '%']],
    band: [['bdx', '--jvbb-dx', 'px'], ['bdy', '--jvbb-dy', 'px'], ['bz', '--jvbb-z', '%'],
           ['bs', '--jvbs-op', ''], ['bw', '--jvbs-w', '%'], ['bfd', '--jvbs-fade', '%'],
           ['bfr', '--jvbs-far', '']],
  };
  function bannerVars(key, band) {
    var b = BANNER[key] || {}, st = '';
    _BVARS[band ? 'band' : 'card'].forEach(function (p) {
      var v = parseFloat(b[p[0]]);
      if (isFinite(v)) st += p[1] + ':' + v + p[2] + ';';   // nada de valores raros en el style
    });
    return st;
  }
  function bannerHTML(key, band) {
    var b = BANNER[key] || {}, url = bannerUrl(key);
    var flip = band ? b.bf : b.f;   // el volteo también es independiente por pantalla
    return '<div class="' + (band ? 'jv-bbanner' : 'jv-banner') + (flip ? ' jv-flip' : '') + '"' +
      (url ? ' style="background-image:url(' + esc(url) + ')"' : '') + '></div>';
  }
  var PLAYERS = { estandar: 2, libre: 1, draft: 2, advanced: 2 };
  function bannerUrl(key) {
    var id = (BANNER[key] || {}).id; if (!id) return '';
    var c = window.dbLookup ? window.dbLookup({ id: id }) : null;
    if (!c && window.CARDS_DB) { for (var i = 0; i < window.CARDS_DB.length; i++) { if (window.CARDS_DB[i].id === id) { c = window.CARDS_DB[i]; break; } } }
    return (c && c.image) ? (window.localizeImg ? window.localizeImg(c.image) : c.image) : '';
  }
  var _SIL = '<svg viewBox="0 0 24 24" class="jv-sil" aria-hidden="true"><circle cx="12" cy="7.6" r="4.1"/><path d="M3.6 21c0-4.7 3.8-7.9 8.4-7.9s8.4 3.2 8.4 7.9z"/></svg>';
  function peopleSVG(n) { return (n >= 2) ? ('<span class="jv-ppl-2">' + _SIL + _SIL + '</span>') : ('<span class="jv-ppl-1">' + _SIL + '</span>'); }
  var LOCK_SVG = '<svg viewBox="0 0 24 24" class="jv-lock-svg" aria-hidden="true"><rect x="5" y="10.6" width="14" height="9.4" rx="2.2"/><path d="M8 10.6V8a4 4 0 0 1 8 0v2.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  // Botón «i» de un modo con FORMATO (Estándar/Avanzado) → reglas + ban list (pbFormatInfo).
  function infoBtn(m) {
    if (!m.fmt || !window.pbFormatInfo) return '';
    return '<button class="jv-i" data-fmt="' + m.fmt + '" title="' + esc(T('format.infoTip')) + '" aria-label="' + esc(T('format.infoTip')) + '">i</button>';
  }
  // `o` = retoques para reutilizar la banda FUERA del hub (ver window.pbModeBand): texto,
  // resaltado y siluetas. Sin `o` se comporta exactamente como siempre.
  function bandHTML(m, o) {
    o = (o && typeof o === 'object') ? o : {};
    var sel = (o.sel != null) ? o.sel : (m.key === cur);
    var cls = 'jv-band' + (m.locked ? ' jv-lock' : '') + (sel ? ' jv-sel' : '');
    var ppl = (o.ppl === false) ? '' :
      '<div class="jv-ppl">' + (m.locked ? LOCK_SVG : peopleSVG(PLAYERS[m.key])) + '</div>';
    return '<div class="' + cls + '" style="--a:' + m.acc + ';' + bannerVars(m.key, true) + '" data-mode="' + m.key + '">' +
      bannerHTML(m.key, true) + '<div class="jv-bscrim"></div>' +
      infoBtn(o.fmt ? Object.assign({}, m, { fmt: o.fmt }) : m) +
      '<div class="jv-bcontent"><div class="jv-info"><div class="jv-t">' + esc(o.name || modeName(m)) + '</div><div class="jv-d">' + esc(o.desc != null ? o.desc : cardDesc(m)) + '</div></div>' +
      ppl + '</div></div>';
  }
  // La banda de modo, disponible para el resto de la web (hoy: el selector de formato al crear
  // un mazo en Barajas). MISMO markup y MISMO CSS que el selector de modos del hub — el CSS de
  // las bandas está scopeado a `.jv-bands`, así que basta con montarlas dentro de un contenedor
  // con esa clase. Devuelve HTML: quien la use decide qué hace al pulsarla (aquí NO cambia el
  // modo de juego elegido en «Jugar»: es solo un componente visual).
  window.pbModeBand = function (key, o) {
    var m = null;
    for (var i = 0; i < MODES.length; i++) if (MODES[i].key === key) m = MODES[i];
    if (!m) m = { key: key, acc: 'var(--jv-a-std)' };
    return bandHTML(Object.assign({}, m, { locked: false }), o || {});
  };
  function cardHTML(m) {
    var cls = 'jv-card' + (m.locked ? ' jv-lock' : '') + (m.key === cur ? ' jv-sel' : '');
    return '<div class="' + cls + '" style="--a:' + m.acc + ';' + bannerVars(m.key, false) + '" data-mode="' + m.key + '">' +
      bannerHTML(m.key, false) + '<div class="jv-cscrim"></div>' +
      infoBtn(m) +
      '<div class="jv-cbar"><div class="jv-clbl"><div class="jv-cnm">' + esc(modeName(m)) + '</div><div class="jv-cds">' + esc(cardDesc(m)) + '</div></div>' +
      '<div class="jv-ppl">' + (m.locked ? LOCK_SVG : peopleSVG(PLAYERS[m.key])) + '</div></div></div>';
  }

  var FRIEND_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 11.4a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8Zm0 1.5c-3 0-5.6 1.6-5.6 4.2V19h11.2v-1.9c0-2.6-2.6-4.2-5.6-4.2Z"/><path d="M16.4 11.2a2.9 2.9 0 1 0 0-5.8 2.9 2.9 0 0 0 0 5.8Zm.2 1.5c-.7 0-1.4.1-2 .3 1 .9 1.6 2.1 1.6 3.6V19h5.4v-1.7c0-2.4-2.3-3.6-5-3.6Z" opacity=".72"/></svg>';
  var SOLO_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 11.6a3.8 3.8 0 1 0 0-7.6 3.8 3.8 0 0 0 0 7.6Zm0 1.6c-3.5 0-6.4 1.8-6.4 4.8V20h12.8v-2c0-3-2.9-4.8-6.4-4.8Z"/></svg>';
  var WELCOME_SVG = '<svg viewBox="0 0 56 56" aria-hidden="true"><rect x="15" y="12" width="29" height="39" rx="4"/><path d="M11 17v30a4 4 0 0 0 4 4"/><path d="M30 23v17M21.5 31.5h17"/></svg>';

  function openMineGrid() {
    if (window._mazosOpenMine) window._mazosOpenMine({ grid: true });
    else if (window.switchAppTab) window.switchAppTab('mazos');
  }
  function startLocalDeck() {
    openMineGrid();
    // La acción promete «crear», así que abre también el selector ya existente
    // (desde cero / importar / QR) después de montar la vista de Mis barajas.
    setTimeout(function () {
      if (window._mazosNewDeck) window._mazosNewDeck();
    }, 0);
  }
  function runDeckAction(action) {
    if (action === 'signin') {
      if (window.pbOpenLogin) window.pbOpenLogin();
      return;
    }
    if (action === 'create') { startLocalDeck(); return; }
    openMineGrid();
  }
  function deckAreaClick(e) {
    var actionEl = e.target.closest && e.target.closest('[data-jv-deck-action]');
    if (actionEl) { e.stopPropagation(); runDeckAction(actionEl.dataset.jvDeckAction); return; }
    var stage = root && root.querySelector('#jv-deckstage');
    var state = stage && stage.dataset.jvDeckState;
    if (state === 'syncing') return;
    runDeckAction(state === 'welcome' ? 'signin' : (state === 'empty' ? 'create' : 'open'));
  }

  function build() {
    root = document.getElementById('view-jugar');
    if (!root) return;
    if (BANNER_G.bandH) root.style.setProperty('--jv-band-h', BANNER_G.bandH + 'px');
    var bands = MODES.map(function (m) { return bandHTML(m); }).join(''), cards = MODES.map(cardHTML).join('');
    root.innerHTML =
      '<div class="jv-bg"><span class="jv-pokeballs"></span><span class="jv-vig"></span></div>' +
      '<div class="jv2-stage" id="jv2-stage">' +
        // los dos paneles viven en un carrusel: en escritorio es `display:contents` (siguen
        // siendo las columnas 1 y 3 de la rejilla) y en móvil se pasan swipeando, en bucle.
        '<section class="jv2-panel jv2-colmeta" id="jv-meta"></section>' +
        '<section class="jv2-center">' +
          // corebox = caja de la MISMA altura que los paneles laterales → el borde inferior
          // del botón JUGAR queda alineado con el de los paneles; online/privada por debajo.
          '<div class="jv2-corebox">' +
          // nombre ARRIBA del mazo (Daniel 2026-08-08) + icono sutil «cambiar mazo» (no texto)
          '<div class="jv2-dn" id="jv-name"></div>' +
          '<div class="jv2-hero" id="jv-hero">' +
            '<div class="jv2-dwrap" id="jv-deckstage"><span class="jv2-halo"></span><div class="jv-deck-wrap" id="jv-deck-wrap"></div></div>' +
            '<div class="jv-pack-stage jv-hide" id="jv-pack-stage"></div>' +
          '</div>' +
          '<div class="jv2-shell">' +
            '<div class="jv2-mode" id="jv-mrow"><span class="jv2-mdot"></span><span id="jv-mname"></span><span class="jv2-chev">▾</span></div>' +
            '<div class="jv2-play" id="jv-arow"></div>' +
          '</div>' +
          '</div>' +
          // La racha va FUERA del corebox: dentro se comía el hueco flexible y SUBÍA el
          // botón hasta pegarlo al mazo. Las piezas centrales (mazo + botón) tienen posición
          // FIJA; lo que aparece empuja hacia ABAJO (regla dura de Daniel, 2026-08-28).
          '<div class="jv2-streak-host" id="jv-streak" hidden></div>' +
          '<div class="jv2-online jv-hide" id="jv-online"></div>' +
          '<div class="jv2-secrow">' +
          '<button class="jv2-friend jv-hide" id="jv-friendbtn">' + FRIEND_SVG + '<span>' + esc(T('jugar.privateMatch')) + '</span></button>' +
          '<button class="jv2-friend jv-hide" id="jv-solobtn">' + SOLO_SVG + '<span>' + esc(T('jugar.solo')) + '</span></button>' +
        '</div>' +
        '<div class="jv2-streak-pad" aria-hidden="true"></div>' +
        '</section>' +
        '<section class="jv2-panel jv2-colexp" id="jv-sobre"></section>' +
        // aviso legal: al FINAL DEL CONTENIDO (dentro del scroll), sin franja ni borde —
        // texto tenue sobre el fondo del hub. Se toca para leerlo entero en «Acerca de».
        '<footer class="jv2-legal" id="jv-legal">' +
          '<span class="jv2-legal-t">' + esc(T('jugar.legal')) + '</span></footer>' +
      '</div>' +
      '<div class="jv-scrim" id="jv-scrim"></div>' +
      '<div class="jv-drawer" id="jv-drawer"><div class="jv-grip"></div>' +
        '<div class="jv-dhead"><h3>' + esc(T('jugar.modesTitle')) + '</h3><div class="jv-x" id="jv-x1">✕</div></div><div class="jv-bands">' + bands + '</div></div>' +
      '<div class="jv-cards" id="jv-cards"><div class="jv-cards-head"><h3>' + esc(T('jugar.chooseMode')) + '</h3><div class="jv-x" id="jv-x2">✕</div></div>' +
        '<div class="jv-cardrow">' + cards + '</div></div>';

    root.querySelector('#jv-deckstage').addEventListener('click', deckAreaClick);
    // el nombre (con su icono ⇄) es la misma affordance que el mazo → Mis Mazos
    root.querySelector('#jv-name').addEventListener('click', deckAreaClick);
    root.querySelector('#jv-name').addEventListener('keydown', function (e) {
      if (e.target !== this || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); deckAreaClick(e);
    });
    root.querySelector('#jv-deckstage').addEventListener('keydown', function (e) {
      if (e.target !== this || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); deckAreaClick(e);
    });
    root.querySelector('#jv-mrow').addEventListener('click', openMenu);
    root.querySelector('#jv-arow').addEventListener('click', doAction);
    root.querySelector('#jv-friendbtn').addEventListener('click', doFriend);
    root.querySelector('#jv-solobtn').addEventListener('click', function () { if (window.switchAppTab) window.switchAppTab('draft'); });
    root.querySelector('#jv-scrim').addEventListener('click', closeMenu);
    root.querySelector('#jv-x1').addEventListener('click', closeMenu);
    root.querySelector('#jv-x2').addEventListener('click', closeMenu);
    root.addEventListener('click', function (e) {
      // El «i» abre las reglas del formato SIN elegir el modo (va antes que el data-mode)
      var fi = e.target.closest && e.target.closest('[data-fmt]');
      if (fi) { e.stopPropagation(); window.pbFormatInfo && window.pbFormatInfo(fi.dataset.fmt); return; }
      var el = e.target.closest && e.target.closest('[data-mode]'); if (!el) return;
      var m = modeByKey(el.dataset.mode);
      if (m.locked) { if (window.pbToast) window.pbToast(T('jugar.soonToast', { name: modeName(m) })); return; }
      setMode(m.key); closeMenu();
    });

    // tocarlo lo despliega AQUÍ (en móvil se recorta a dos líneas). «Acerca de» tiene otro
    // aviso distinto, así que mandar allí no dejaba leer este.
    root.querySelector('#jv-legal').addEventListener('click', function () {
      this.classList.toggle('jv2-legal-open');
    });

    setMode(cur);
    paintDeck();
    renderMeta();
    buildSobre();
  }

  function paintDeck() {
    if (!root) return;
    var info = window.pbProfileInfo ? window.pbProfileInfo() : { logged: false };
    var syncing = !!(info.logged && window.pbWelcomeDeckState && window.pbWelcomeDeckState() === 'syncing');
    // Mientras se resuelve la cuenta no enseñes durante un instante la biblioteca
    // materializada por la cuenta anterior en este mismo navegador.
    var d = syncing ? null : activeDeck(), wrap = root.querySelector('#jv-deck-wrap'), nameHost = root.querySelector('#jv-name');
    var stage = root.querySelector('#jv-deckstage'), core = root.querySelector('.jv2-corebox');
    if (wrap) wrap.innerHTML = '';
    if (wrap) wrap.setAttribute('aria-live', 'polite');
    if (core) core.classList.toggle('jv2-corebox-empty', !d);
    if (stage) {
      stage.classList.toggle('is-empty', !d);
      stage.removeAttribute('role'); stage.removeAttribute('tabindex'); stage.removeAttribute('aria-label');
    }
    if (nameHost) {
      nameHost.classList.remove('jv2-dn-welcome');
      nameHost.removeAttribute('role'); nameHost.removeAttribute('tabindex'); nameHost.removeAttribute('aria-label');
    }
    if (!d) {
      var welcome = !info.logged;
      if (stage) stage.dataset.jvDeckState = syncing ? 'syncing' : (welcome ? 'welcome' : 'empty');

      if (welcome) {
        if (nameHost) {
          nameHost.classList.add('jv2-dn-welcome');
          nameHost.innerHTML = '';
        }
        if (wrap) {
          var w = document.createElement('div');
          w.className = 'jv-empty-deck jv-welcome-deck';
          w.setAttribute('role', 'group');
          w.setAttribute('aria-labelledby', 'jv-welcome-title');
          w.innerHTML = '<button type="button" class="jv-welcome-face" data-jv-deck-action="signin" aria-labelledby="jv-welcome-title" aria-describedby="jv-welcome-body">' +
              '<span class="jv-welcome-icon">' + WELCOME_SVG + '</span>' +
              '<span class="jv-welcome-title" id="jv-welcome-title">' + esc(T('welcome.emptyTitle')) + '</span>' +
              '<span class="jv-welcome-body" id="jv-welcome-body">' + esc(T('welcome.emptyBody')) + '</span>' +
            '</button>' +
            '<button type="button" class="jv-welcome-local" data-jv-deck-action="create">' + esc(T('welcome.createLocal')) + '</button>';
          wrap.appendChild(w);
        }
      } else if (syncing) {
        if (nameHost) nameHost.innerHTML = '<span class="jv-welcome-preparing">' + esc(T('welcome.preparing')) + '</span>';
        if (wrap) {
          var wait = document.createElement('div'); wait.className = 'jv-empty-deck jv-welcome-wait';
          wait.innerHTML = '<span class="jv-welcome-spinner" aria-hidden="true"></span><span>' + esc(T('welcome.preparing')) + '</span>';
          wrap.appendChild(wait);
        }
      } else {
        if (nameHost) nameHost.innerHTML = '';
        if (wrap) {
          var e = document.createElement('button'); e.type = 'button'; e.className = 'jv-empty-deck jv-empty-plain';
          e.dataset.jvDeckAction = 'create'; e.textContent = T('jugar.noDecks'); wrap.appendChild(e);
        }
      }
      return;
    }
    if (stage) {
      stage.dataset.jvDeckState = 'deck'; stage.setAttribute('role', 'button'); stage.tabIndex = 0;
      stage.setAttribute('aria-label', d.name || T('jugar.deck'));
    }
    if (wrap) {
      if (window._mazosDeckStack) wrap.appendChild(window._mazosDeckStack(d));
      else { var f = document.createElement('div'); f.className = 'jv-face-fallback'; var cov = coverUrl(d); if (cov) f.style.backgroundImage = 'url(' + cov + ')'; wrap.appendChild(f); }
    }
    if (nameHost) {
      nameHost.setAttribute('role', 'button'); nameHost.tabIndex = 0; nameHost.setAttribute('aria-label', d.name || T('jugar.deck'));
      nameHost.innerHTML = '<span id="jv-name-txt">' + esc(d.name || T('jugar.deck')) + '</span>' +
        '<span class="jv2-dnic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M7 8h10.2l-2.4-2.4L16.2 4 21 8.8l-4.8 4.8-1.4-1.6 2.4-2.4H7V8Zm10 8H6.8l2.4 2.4L7.8 20 3 15.2l4.8-4.8 1.4 1.6-2.4 2.4H17V16Z"/></svg></span>';
    }
  }

  // ── MEJORES MAZOS (A v2 aprobada 2026-08-08: bandas-banner estilo selector de modos,
  //    SIN «Activar» — la banda abre el mazo en la pestaña Meta) ──
  function metaRows() { return (window.META_DECKS && window.META_DECKS.decks) ? window.META_DECKS.decks.slice(0, 3) : []; }
  function protImg(id) {
    if (!id) return '';
    var c = window.dbLookup ? window.dbLookup({ id: id }) : null;
    return (c && c.image) ? (window.localizeImg ? window.localizeImg(c.image) : c.image) : '';
  }
  // acento por energía del mazo (EL_COLORS de shared.js, aclarado para leerse como franja)
  function rowAccent(row) {
    var e = (row.energy && row.energy[0]) || (row.types && row.types[0]) || '';
    var base = (window.EL_COLORS && window.EL_COLORS[e]) || '#9aa0b4';
    return base;
  }
  // Última actualización real del meta. El texto dice SIEMPRE «Actualizado …»
  // (Daniel 2026-08-13): hoy / hace N h / ayer / hace N días / la fecha.
  function metaUpdated() {
    var g = window.META_DECKS && (window.META_DECKS.generated || window.META_DECKS.date_newest);
    if (!g) return T('jugar.updated');
    var t = Date.parse(g); if (isNaN(t)) return T('jugar.updated');
    var d = new Date(t), now = new Date();
    if (d.toDateString() === now.toDateString()) return T('jugar.updToday');   // mismo día natural
    var mins = Math.max(0, Math.floor((now - t) / 60000));
    if (mins < 60) return T('jugar.agoMin', { n: Math.max(1, mins) });
    var h = Math.floor(mins / 60); if (h < 24) return T('jugar.agoH', { n: h });
    var days = Math.floor(h / 24); if (days === 1) return T('jugar.yesterday');
    if (days < 7) return T('jugar.agoD', { n: days });
    try { return T('jugar.updDate', { d: d.toLocaleDateString(window.uiLocale ? window.uiLocale() : 'es', { day: 'numeric', month: 'short' }) }); }
    catch (e) { return T('jugar.agoD', { n: days }); }
  }

  function renderMeta() {
    var host = root && root.querySelector('#jv-meta'); if (!host) return;
    var rows = metaRows();
    if (!rows.length) { host.innerHTML = ''; host.classList.add('jv-hide'); return; }
    host.classList.remove('jv-hide');
    // cabecera: título con peso + frescura tenue + «Ver todo ›» a la derecha (sin botón inferior)
    var out = '<div class="jv2-ph"><span class="jv2-k">' + esc(T('start.metaDecks')) + '</span>' +
      '<button class="jv2-vt" id="jv-metaall">' + esc(T('jugar.viewAll')) + ' <span class="jv2-vtc">›</span></button></div><div class="jv2-bands">';
    rows.forEach(function (row, i) {
      var prot = row.protagonists || [];
      var art = protImg(prot[0]);
      var use = (row.share != null) ? T('jugar.pctUse', { n: Math.round(row.share * 1000) / 10 }) : '';
      var wr = (row.winrate != null) ? T('jugar.pctWin', { n: Math.round(row.winrate * 100) }) : '';
      var stats = [use, wr].filter(Boolean).join(' · ');
      out += '<div class="jv2-band" data-i="' + i + '" style="--a:' + esc(rowAccent(row)) + '" title="' + esc(row.name || '') + '">' +
        '<div class="jv2-bart"' + (art ? ' style="background-image:url(' + esc(art) + ')"' : '') + '></div>' +
        '<div class="jv2-bscrim"></div>' +
        '<div class="jv2-bin"><span class="jv2-brk' + (i === 0 ? ' t' : '') + '">' + (i + 1) + '</span>' +
        '<span class="jv2-binfo"><span class="jv2-bt">' + esc(row.name || '') + '</span>' +
        (stats ? '<span class="jv2-bs">' + esc(stats) + '</span>' : '') + '</span></div></div>';
    });
    // frescura del meta = pill pequeñita ABAJO (estilo pill online), no en la cabecera
    out += '</div><div class="jv2-freshrow"><span class="jv2-fresh">' + esc(metaUpdated()) + '</span></div>';
    host.innerHTML = out;
    // banda = abrir ESE mazo en la pestaña Meta (deep-link a-<id>, mismo camino que el router)
    Array.prototype.forEach.call(host.querySelectorAll('.jv2-band'), function (el) {
      el.addEventListener('click', function () {
        var row = metaRows()[+el.getAttribute('data-i')]; if (!row) return;
        if (window._mazosOpenMeta) window._mazosOpenMeta();
        if (row.id && window._mazosOpenById) window._mazosOpenById('a-' + row.id);
      });
    });
    var all = host.querySelector('#jv-metaall');
    if (all) all.addEventListener('click', function (e) { e.stopPropagation(); if (window._mazosOpenMeta) window._mazosOpenMeta({ grid: true }); else if (window.switchAppTab) window.switchAppTab('meta'); });
  }

  // ── ÚLTIMA EXPANSIÓN (bocadillo con cartas moviéndose + sobre REAL completo) ──
  // El arte del sobre sale de data/packs.js (lo genera gen_pack_images.py desde
  // assets/packs). Si la expansión trae varios sobres se usa el primero.
  function packArtOf(code) { var p = (window.setPacks ? window.setPacks(code) : [])[0]; return (p && p.art) || null; }
  // La expansión que se enseña es la ÚLTIMA que existe en la web, no la del meta: los datos de
  // Limitless tardan semanas en traer un set recién salido y hasta entonces el hub se quedaba
  // enseñando el sobre anterior. Se recorre SET_ORDER de atrás hacia delante y se coge la
  // primera que tenga arte de sobre y cartas suficientes para el bocadillo (los promos PA/PB no
  // son expansiones). Así se actualiza sola con cada set nuevo, sin tocar nada.
  var PROMO_SETS = { PA: 1, PB: 1 };
  function expansion() {
    var orden = (window.SET_ORDER || []).slice().reverse();
    for (var i = 0; i < orden.length; i++) {
      var c = orden[i];
      if (PROMO_SETS[c]) continue;
      var a = packArtOf(c);
      if (a && expansionPeekCards(c).length) return { code: c, name: (window.setName ? window.setName(c) : '') || c, pack: a };
    }
    // Red: el meta y, si tampoco, la última con arte conocida.
    var code = (window.META_DECKS && window.META_DECKS.expansion && window.META_DECKS.expansion.code) || 'B4';
    var art = packArtOf(code);
    if (!art) { code = 'B4'; art = packArtOf('B4'); }
    var name = (window.setName ? window.setName(code) : '') || (window.META_DECKS && window.META_DECKS.expansion && window.META_DECKS.expansion.name) || code;
    return { code: code, name: name, pack: art };
  }
  // Cartas del bocadillo = de la última expansión, por RAREZA (petición de Daniel):
  // 75% «premium» = 2★ (SAR) + doradas (♕);  25% = 1★ (AR) + 3◊ (◊◊◊).
  // Se EXCLUYEN shinies (✸/✸✸), inmersivas (IM) y el resto de diamantes. Sin toggle de pool.
  function shuffleArr(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function expansionPeekCards(code) {
    var db = window.CARDS_DB || [], premium = [], common = [];
    for (var i = 0; i < db.length; i++) {
      var c = db[i]; if (c.set !== code || !c.image) continue;
      var r = c.rarity;
      if (r === 'SAR' || r === '♕') premium.push(c);          // 2★ + dorada
      else if (r === 'AR' || r === '◊◊◊') common.push(c);      // 1★ + 3 diamantes
    }
    shuffleArr(premium); shuffleArr(common);
    var N = 16, pick = premium.slice(0, Math.round(N * 0.75));  // 75% premium
    pick = pick.concat(common.slice(0, N - pick.length));       // resto (25%) común
    if (pick.length < N) pick = pick.concat(premium.slice(pick.length)); // relleno si el pool premium era corto
    return shuffleArr(pick);
  }
  function buildSobre() {
    var host = root && root.querySelector('#jv-sobre'); if (!host) return;
    var exp = expansion(), cards = expansionPeekCards(exp.code);
    if (!cards.length) { host.innerHTML = ''; host.classList.add('jv-hide'); return; }
    host.classList.remove('jv-hide');
    // Bocadillo REAL del draft (clases .dr-peek / .dr-peek-reel → mismo look/CSS), sin toggle de pool.
    host.innerHTML =
      '<div class="jv2-ph"><span class="jv2-k">' + esc(T('jugar.latestExpansion')) + '</span>' +
      '<button class="jv2-vt" id="jv-sobre-go">' + esc(T('jugar.viewAll')) + ' <span class="jv2-vtc">›</span></button></div>' +
      '<div class="dr-peek jv-exp-peek"><div class="dr-peek-reel" id="jv-exp-reel"></div></div>' +
      // glint = el brillo que recorre la línea de rotura (como el sobre del draft), alineado
      // a la soldadura REAL de la imagen (--seam-y, medida del png). holo = banda foil sutil.
      (exp.pack ? '<div class="jv2-packarea"><div class="jv2-mpack" style="background-image:url(' + esc(exp.pack) + ')">' +
        '<span class="jv2-seamglint"></span></div></div>' : '');
    var reel = host.querySelector('#jv-exp-reel');
    if (reel && window._draftPeekMount) window._draftPeekMount(reel, cards);   // auto-scroll + arrastre + zoom, del draft
    var go = host.querySelector('#jv-sobre-go');
    // ⚠ la clave interna es 'cards' ('cartas' NO existe → caía a la rama else = tablero; bug cazado por Daniel)
    if (go) go.addEventListener('click', function () { if (window.switchAppTab) window.switchAppTab('cards'); });
  }

  function setMode(key) {
    cur = key;
    try { localStorage.setItem(MODE_KEY, key); } catch (e) {}
    var m = modeByKey(key); if (!root) return;
    root.querySelector('#jv-mname').textContent = modeName(m);
    root.querySelector('#jv-mrow').style.setProperty('--jv-acc', m.acc);
    var arow = root.querySelector('#jv-arow');
    arow.innerHTML = '<span class="jv2-play-label">' + esc(T(m.labelK)) + '</span>' +
      (m.beta ? '<span class="jv2-beta">' + esc(T('jugar.beta')) + '</span>' : '');
    arow.classList.toggle('jv2-soon', !!m.soon);
    var isDraft = (m.key === 'draft');
    var packStage = root.querySelector('#jv-pack-stage'), deckStage = root.querySelector('#jv-deckstage'), nameEl = root.querySelector('#jv-name');
    if (isDraft) {
      if (deckStage) deckStage.classList.add('jv-hide');
      if (nameEl) nameEl.classList.add('jv-hide');
      if (packStage) { if (window._draftPackMarkup && !packStage.querySelector('.dr-pack')) packStage.innerHTML = window._draftPackMarkup(); packStage.classList.remove('jv-hide'); }
    } else {
      if (packStage) packStage.classList.add('jv-hide');
      if (deckStage) deckStage.classList.remove('jv-hide');
      if (nameEl) nameEl.classList.remove('jv-hide');
    }
    // en Elección (draft) los laterales no aplican (el centro ya muestra el sobre del draft)
    var stage = root.querySelector('#jv2-stage'); if (stage) stage.classList.toggle('jv2-draft', isDraft);
    var fbtn = root.querySelector('#jv-friendbtn'); if (fbtn) fbtn.classList.toggle('jv-hide', !(m.key === 'estandar' || m.key === 'draft' || m.key === 'advanced'));
    // «En solitario» SOLO en Elección con online (con el flag apagado el botón principal YA es el draft solo)
    var sbtn = root.querySelector('#jv-solobtn'); if (sbtn) sbtn.classList.toggle('jv-hide', !(m.key === 'draft' && m.action === 'draftQueue'));
    Array.prototype.forEach.call(root.querySelectorAll('[data-mode]'), function (el) { el.classList.toggle('jv-sel', el.dataset.mode === key); });
    paintHomeStreak(m);
    paintOnline();
  }

  function paintOnline() {
    var el = root && root.querySelector('#jv-online'); if (!el) return;
    var m = modeByKey(cur), isOnline = ((m.action === 'pvp' || m.action === 'pvpAdvanced' || m.action === 'draftQueue') && pvpOn());
    el.classList.toggle('jv-hide', !isOnline);
    if (!isOnline) return;
    // píldora COMPARTIDA con la cola de búsqueda (presence.js es el dueño del dato y del markup)
    el.innerHTML = window.pbPresencePill ? window.pbPresencePill('jv') : '';
  }

  // Advanced en LOCAL: al tablero y selector de inicio atado al formato (solo mazos de 30).
  function startAdvancedLocal() {
    // Pedir Advanced local YA es pedir partida nueva → directo al selector (trae su «Cancelar»).
    if (window._pbEnterBoard) { window._pbEnterBoard({ format: 'advanced', newMatch: true }); return; }
    if (window.switchAppTab) window.switchAppTab('board');
    setTimeout(function () { if (window._openStartSelector) window._openStartSelector({ format: 'advanced' }); }, 280);
  }
  function doAction() {
    var m = modeByKey(cur);
    if (m.action === 'pvp') { if (pvpOn() && window._pvpStartQueue) window._pvpStartQueue(); else if (window.pbToast) window.pbToast(T('jugar.onlineSoonToast')); return; }
    if (m.action === 'draftQueue') {
      if (pvpOn() && window._draftMpQueue) { var pk = root && root.querySelector('#jv-pack-stage .dr-pack'); window._draftMpQueue(pk ? { sourceEl: pk } : undefined); }
      else if (window.switchAppTab) window.switchAppTab('draft');
      return;
    }
    if (m.action === 'advancedLocal') { startAdvancedLocal(); return; }
    if (m.action === 'pvpAdvanced') {   // misma entrada de cola; `fmt` identifica Avanzado
      if (pvpOn() && window._pvpStartQueue) window._pvpStartQueue({ format: 'advanced' });
      else if (window.pbToast) window.pbToast(T('jugar.onlineSoonToast'));
      return;
    }
    if (!m.action) { if (window.pbToast) window.pbToast(T('jugar.onlineSoonToast')); return; }
    // «Tablero libre»: entra por la PUERTA del tablero (si hay una partida a medias, pregunta
    // continuar o empezar otra). El resto de modos son navegación normal.
    if (m.action === 'board' && window._pbEnterBoard) { window._pbEnterBoard(); return; }
    if (window.switchAppTab) window.switchAppTab(m.action);
  }
  function doFriend() {
    var m = modeByKey(cur);
    if (m.key === 'estandar' || m.key === 'advanced') {
      if (pvpOn() && window._pvpOpenFriendly) window._pvpOpenFriendly({ format: m.fmt || 'standard' });
      else if (window.pbToast) window.pbToast(T('jugar.privateSoonToast'));
      return;
    }
    if (m.key === 'draft') { if (pvpOn() && window._draftMpFriendly) window._draftMpFriendly(); else if (window.switchAppTab) window.switchAppTab('draft'); }
  }

  function openMenu() { if (root) root.classList.add('jv-menu-open'); }
  function closeMenu() { if (root) root.classList.remove('jv-menu-open'); }

  window._jugarInit = function () { build(); window._jugarInitialised = true; pullStreaks(); };
  window._jugarRefresh = function () {
    if (!window._jugarInitialised) return;
    closeMenu();
    if (root) root.classList.remove('jv-exiting');
    paintDeck();
    renderMeta();
    setMode(cur);
    if (window.pbPresenceRefresh) window.pbPresenceRefresh();
    paintOnline();
    pullStreaks();   // por si se ganó una partida desde la última vez
  };
  window.addEventListener('pb-presence', function () { paintOnline(); });
  // Auth pinta primero; el timeout deja que welcome-deck.js marque «sincronizando»
  // en el mismo evento antes de decidir qué estado vacío mostrar.
  window.addEventListener('pb-auth', function () { setTimeout(paintDeck, 0); });
  window.addEventListener('pb-welcome-state', function () { paintDeck(); });
  window.addEventListener('pb-welcome-deck', function () { paintDeck(); });
  // Cambio de idioma → re-montar el hub entero (los textos se resuelven al pintar).
  window.addEventListener('langchange', function () { if (window._jugarInitialised && root) build(); });

})();
