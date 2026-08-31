// ═══════════════════════════════════════════════════════════════
// PVP ONLINE DEL TABLERO — Tanda 1: lobby + mazos.
// Sala privada por código (patrón heredado de draft-multi.js) sobre
// /pvpGames/{code} vía window.pbPvp (módulo Firebase inline de index.html).
// Requiere cuenta real (Google o Discord) en AMBOS jugadores (spec pvp-tablero-spec).
// Beta pública tras pbFlag('pvp'): Estándar y Avanzado comparten la misma
// infraestructura, con el formato identificado dentro de cada anuncio/sala.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var ROOM_KEY = 'pocketboard_pvp_room_v1';
  var LIBRARY_KEY = 'pocketboard_library_v1';
  // Red de seguridad, NO la señal primaria (esa es el watch/onSnapshot en tiempo real).
  // A 1,6s costaba ~2.250 lecturas/hora/jugador en Firestore; a 4,5s el peor caso de
  // un cambio perdido se recupera en <5s y el coste baja a un tercio.
  var POLL_MS = 4500;

  var state = {
    code: null, role: null, room: null,
    unsub: null, poll: null,
    view: null,          // 'menu' | 'join' | 'lobby' | 'picker' | 'connected' | 'error' | 'loading'
    deckKey: null,       // clave local del mazo elegido (id de biblioteca)
    fmt: 'standard',     // FORMATO de esta sesión online (js/formats.js); el match nunca cruza formatos
    _renderKey: null,    // dedupe de re-renders del poll
    _leaving: false,
    _gen: 0              // generación de sesión: resetState la incrementa → invalida callbacks async en vuelo (join)
  };
  // Vista de Fin sintética usada por el simulador de rachas de dev. Vive FUERA de
  // `state`: no es una sala, no debe tocar presencia, listeners ni el autosave PvP.
  var streakPreviewActive = false;
  var reconnectPending = 0;

  // ── Utilidades base ──
  function T(k, v) { return window.t ? window.t(k, v) : k; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function rooms() { return window.pbPvp || null; }
  function acct() { return window.pbAccount ? window.pbAccount() : null; }
  // Cuenta REAL (no anónima): el PvP exige cuenta a los dos jugadores.
  function realAcct() { var a = acct(); return (a && !a.anon) ? a : null; }
  function myUid() { var a = acct(); return a ? a.uid : null; }
  function oppRole() { return state.role === 'host' ? 'guest' : 'host'; }

  var dlog = function () {};
  // Toda escritura Firestore pasa por aquí: los fallos NO se tragan en silencio.
  function wrote(p, label) {
    return p.catch(function (e) {
      dlog('✗ ESCRITURA ' + label + ': ' + ((e && e.code) || e));
      throw e;
    });
  }

  function genCode() {
    var L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', D = '23456789', out = '';
    for (var i = 0; i < 4; i++) out += L[Math.floor(Math.random() * L.length)];
    for (var j = 0; j < 2; j++) out += D[Math.floor(Math.random() * D.length)];
    return out;
  }
  function remember() {
    try { localStorage.setItem(ROOM_KEY, JSON.stringify({ code: state.code, role: state.role })); } catch (e) {}
  }
  function forget() { try { localStorage.removeItem(ROOM_KEY); } catch (e) {} }

  // ── Guard de DOBLE PESTAÑA ──
  // Id de ESTA pestaña. La sala guarda en `tabs.{rol}` la pestaña DUEÑA del asiento: la última
  // que reclama JUEGA y la anterior se silencia con un aviso (con opción de recuperar). Cubre
  // también la misma cuenta en dos dispositivos.
  // Vive en sessionStorage a propósito: sobrevive a RECARGAR la misma pestaña (que debe volver
  // a SU partida sin pelearse consigo misma) pero NO se comparte con otras pestañas (cada una
  // estrena el suyo). Es lo que distingue «me he recargado» de «hay otra pestaña jugando».
  var TAB_ID = (function () {
    var k = 'pocketboard_pvp_tab_v1', v = null;
    try { v = sessionStorage.getItem(k); } catch (e) {}
    if (!v) {
      v = 't' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
      try { sessionStorage.setItem(k, v); } catch (e) {}
    }
    return v;
  })();
  // ¿El asiento de `role` lo tiene OTRA pestaña que sigue viva? El latido (seen.{rol}, cada 8s
  // mientras se juega) es la prueba de vida; sin latido reciente el asiento está abandonado.
  var SEAT_FRESH_MS = 25000;   // 3 latidos
  function seatBusy(room, role) {
    var seat = room && room.tabs && room.tabs[role];
    if (!seat || seat === TAB_ID) return false;
    var beat = Number((room.seen || {})[role]) || 0;
    return beat > 0 && (Date.now() - beat) < SEAT_FRESH_MS;
  }
  // El usuario ARRANCA una sesión nueva (crear / unirse / buscar): sube la generación para que
  // cualquier callback async en vuelo (la reconexión, un create/join anterior) se aborte en vez
  // de revivir por debajo y pisar la sesión nueva.
  function newIntent() { state._gen = (state._gen || 0) + 1; }
  function claimSeat() {
    var r = rooms();
    if (!r || !state.code || !state.role) return;
    var patch = { tabs: {} };
    patch.tabs[state.role] = TAB_ID;
    wrote(r.set(state.code, patch), 'claim-tab').catch(function () {});
  }

  // TTL de salas: las políticas TTL de Firestore (consola) borran el doc al pasar
  // `expireAt` (el SDK convierte Date → Timestamp). 24h desde la última transición de
  // estado → una sala abandonada cerrando el navegador deja de vivir para siempre.
  function ttl() { return new Date(Date.now() + 24 * 3600 * 1000); }

  function copyText(txt, toastKey) {
    function done() { window.pbToast && window.pbToast(T(toastKey)); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done, function () { fallback(); });
    } else fallback();
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = txt; ta.style.cssText = 'position:fixed;opacity:0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove(); done();
      } catch (e) {}
    }
  }

  // ── Biblioteca + validación de legalidad ──
  function loadLibrary() {
    try { return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '[]') || []; }
    catch (e) { return []; }
  }
  function deckKeyOf(d, i) { return d && d.id != null ? String(d.id) : '#' + i; }

  // Validador de mazo PvP: 20 cartas exactas, máx 2 por NOMBRE, ≥1 Básico,
  // sin cartas custom (_temp) ni cartas no resolubles en la DB.
  // Devuelve { ok, reasons: [{ k, vars }] } (claves i18n; se traducen al pintar).
  function validateDeck(deck, fmt) {
    // Con formats.js cargado, las reglas (tamaño, copias, ban list) las pone el FORMATO.
    // El bloque de abajo queda como red por si el módulo no estuviera.
    if (window.validateDeckForFormat) return window.validateDeckForFormat(deck, fmt || state.fmt || 'standard');
    var reasons = [];
    var cards = (deck && deck.cards) || [];
    if (cards.length !== 20) reasons.push({ k: 'pvp.deckCount', vars: { n: cards.length, size: 20 } });
    var counts = {}, firstByKey = {};
    var hasCustom = false, hasBasic = false, unknown = 0;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c._temp || !c.id) { hasCustom = true; continue; }
      var db = window.dbLookup ? window.dbLookup(c) : null;
      if (!db) { unknown++; continue; }
      var key = String(c.name || c.id).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
      if (!firstByKey[key]) firstByKey[key] = c;
      if (!hasBasic && window.isBasicPokemon && window.isBasicPokemon(c)) hasBasic = true;
    }
    if (hasCustom) reasons.push({ k: 'pvp.deckCustom', vars: null });
    if (unknown) reasons.push({ k: 'pvp.deckUnknown', vars: null });
    for (var k2 in counts) {
      if (counts[k2] > 2) {
        var card = firstByKey[k2];
        var nm = (window.cardName && card) ? window.cardName(card) : (card && card.name) || k2;
        reasons.push({ k: 'pvp.deckCopies', vars: { name: nm, max: 2 } });
        break; // con señalar la primera basta
      }
    }
    if (!hasBasic) reasons.push({ k: 'pvp.deckNoBasic', vars: null });
    return { ok: reasons.length === 0, reasons: reasons };
  }

  // Portada del mazo (heurística slim de mazos-view: thumbnail > featured >
  // protagonista EX/fase/PS > primera carta). Devuelve URL CANÓNICA (se
  // localiza al pintar: la sala es compartida entre idiomas).
  function deckCoverImg(deck) {
    if (!deck) return '';
    var img = deck.thumbnailImg || (deck.featured && deck.featured[0]) || null;
    if (!img) {
      var best = null, score = -1;
      (deck.cards || []).forEach(function (c) {
        if (!c || !c.image) return;
        if (window.isPokemonCard && !window.isPokemonCard(c)) return;
        var db = (window.dbLookup && window.dbLookup(c)) || c;
        var s = (/\bex\b/i.test(db.name || '') ? 100 : 0);
        var st = db.stage;
        if (st === 2 || st === '2') s += 20; else if (st === 1 || st === '1') s += 10;
        s += (parseInt(db.health, 10) || 0) / 10;
        if (s > score) { score = s; best = c; }
      });
      img = (best && best.image) || deck.firstCardImg ||
            (deck.cards && deck.cards[0] && deck.cards[0].image) || '';
    }
    return img || '';
  }
  function locImg(url) { return url ? (window.localizeImg ? window.localizeImg(url) : url) : ''; }

  // ── Mazo ACTIVO (elegido en el hub «Jugar», pocketboard_active_deck_v1) ──
  // El online usa SIEMPRE el mazo activo (no se elige tras emparejar). Espeja la
  // lógica del hub: id guardado si resuelve, si no el primero de la biblioteca.
  function activeDeckKey() {
    var lib = loadLibrary();
    if (!lib.length) return null;
    var id = null;
    try { id = localStorage.getItem('pocketboard_active_deck_v1'); } catch (e) {}
    if (id) { for (var i = 0; i < lib.length; i++) { if (deckKeyOf(lib[i], i) === String(id)) return deckKeyOf(lib[i], i); } }
    return deckKeyOf(lib[0], 0);
  }
  function deckByKey(key) {
    var lib = loadLibrary();
    for (var i = 0; i < lib.length; i++) if (deckKeyOf(lib[i], i) === key) return lib[i];
    return null;
  }
  // Payload PÚBLICO del mazo para la sala (nombre/portada/nº/energía; sin la lista).
  function deckPayload(deck) {
    return {
      name: String(deck.name || '').slice(0, 40),
      cover: deckCoverImg(deck),   // canónica; se localiza al pintar
      n: (deck.cards || []).length,
      energyTypes: (deck.energyTypes && deck.energyTypes.slice(0, 3)) || []
    };
  }
  // ¿El mazo activo vale para online? { ok, key, deck, reasons }. Fija state.deckKey si ok.
  function activeDeckReady() {
    var key = activeDeckKey();
    var deck = key ? deckByKey(key) : null;
    if (!deck) return { ok: false, key: null, deck: null, reasons: [{ k: 'pvp.noDecks' }] };
    var v = validateDeck(deck, state.fmt);
    if (v.ok) state.deckKey = key;
    return { ok: v.ok, key: key, deck: deck, reasons: v.reasons };
  }
  function nm(a) { return String((a && a.name) || '').slice(0, 20); }

  // ── Overlay (shell reutiliza el skin .pb-modal → liquid glass + allowlist) ──
  function ensureOverlay() {
    if (document.getElementById('pvp-overlay')) return;
    var ov = document.createElement('div');
    ov.className = 'pb-modal-overlay';
    ov.id = 'pvp-overlay';
    ov.style.display = 'none';
    ov.innerHTML = '<div class="pb-modal pvp-modal"><button id="pvp-close" type="button" aria-label="Cerrar">×</button><div id="pvp-content"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      // Clic fuera solo cierra si NO estás en una sala (evita salidas accidentales).
      if (e.target === ov && !state.code) {
        if (streakPreviewActive) closeStreakPreview();
        else exitToHub();
      }
    });
    document.getElementById('pvp-close').addEventListener('click', function () {
      if (streakPreviewActive) closeStreakPreview();
      else if (state.code) leave();
      else exitToHub();
    });
  }
  var _closeTimer = null;
  function openOverlay() {
    ensureOverlay();
    // Mis stats de maestría (emblemas equipados / mazo de emotes) se precargan al abrir el
    // online → listas cuando se crea/entra en la sala (viajan en mi bloque host/guest).
    if (window.PB_EMOTES) try { window.PB_EMOTES.loadMine(); } catch (e) {}
    // Mata el timer de cierre pendiente: si no, reabrir en <190ms deja el
    // overlay oculto por el timeout rancio (clase de bug ya documentada).
    if (_closeTimer) { clearTimeout(_closeTimer); _closeTimer = null; }
    var ov = document.getElementById('pvp-overlay');
    ov.style.display = 'flex';
    requestAnimationFrame(function () { ov.classList.add('open'); });
  }
  function closeOverlay(opts) {
    opts = opts || {};
    // Cierre SUAVE mientras se crea/une una sala (state.code aún null): invalida el callback async
    // en vuelo (create/join) para que al resolver NO reviva la sesión que el usuario acaba de cerrar.
    // Con code activo (partida/cortina) NO se toca _gen (no hay create/join en vuelo).
    // La preview DEV no inició ninguna operación: cerrarla tampoco puede mutar la generación PvP.
    if (!state.code && !opts.keepGeneration) state._gen = (state._gen || 0) + 1;
    var ov = document.getElementById('pvp-overlay');
    if (!ov) return;
    ov.classList.remove('open');
    setImmersive(false);
    if (_closeTimer) clearTimeout(_closeTimer);
    _closeTimer = setTimeout(function () { ov.style.display = 'none'; _closeTimer = null; }, 190);
  }
  // SALIDA del flujo online. closeOverlay() a secas solo levanta el telón y deja a la vista lo
  // que hubiera debajo: si el online se estaba jugando (o acababa de terminar) eso es EL TABLERO
  // con la posición final de esa partida — y como la sesión ya está cerrada, se comporta como una
  // partida local que nadie ha empezado. Toda salida definitiva vuelve al hub, igual que «Salir»
  // del Fin. Si el usuario está en otra sección (Cartas/Mazos), no se le mueve de ahí.
  function exitToHub() {
    var onBoard = window._pbCurrentTab === 'board';
    closeOverlay();
    if (onBoard && window.switchAppTab) window.switchAppTab('jugar');
  }
  function canPreviewGameOver() {
    var localPreview = false;
    if (!localPreview) return false;
    // Nada de montar una partida ficticia por encima de una sala, cola, reconexión o
    // transición real. El simulador debe ser una lente visual, nunca estado de juego.
    if (reconnectPending || state.code || state.unsub || state.poll || state._searching || state._matchStarted ||
        state._vsActive || state._draftBridge || state._bridgeTimer || state._leaving) return false;
    if (streakPreviewActive) return true;
    var ov = document.getElementById('pvp-overlay');
    if (ov && ov.style.display !== 'none' && ov.classList.contains('open')) return false;
    return true;
  }
  function closeStreakPreview() {
    if (!streakPreviewActive) return false;
    if (window.pbStreakUI) window.pbStreakUI.clearFin();
    streakPreviewActive = false;
    closeOverlay({ keepGeneration: true });
    if (window.switchAppTab) window.switchAppTab('jugar');
    return true;
  }
  // Modo INMERSIVO: las pantallas de FLUJO (buscando/VS/fin) son a pantalla completa
  // con la barra oculta (como en la maqueta), NO el card modal. Las elecciones rápidas
  // (menú/amistosa/código/gate) siguen siendo pop-up. CSS en jugar-view.css.
  function setImmersive(on) {
    var ov = document.getElementById('pvp-overlay');
    if (ov) ov.classList.toggle('pvp-immersive', !!on);
    document.documentElement.classList.toggle('pvp-immersive', !!on);
  }
  function renderContent(html) {
    ensureOverlay();
    setImmersive(false);   // por defecto pop-up; las vistas de flujo lo reactivan
    var c = document.getElementById('pvp-content');
    if (c) c.innerHTML = html;
  }
  function on(id, fn) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  }

  // ── Vistas ──
  function avatarHtml(av, name) {
    if (av) return '<img class="pvp-ava" src="' + esc(av) + '" alt="" referrerpolicy="no-referrer">';
    var ini = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return '<span class="pvp-ava pvp-ava-ini">' + esc(ini) + '</span>';
  }

  function renderMenu() {
    state._gen = (state._gen || 0) + 1;   // volver al menú (p.ej. «atrás» durante un join) invalida el join async en vuelo
    state.view = 'menu';
    var a = realAcct();
    var html = '<div class="pvp-h">' + esc(T('pvp.title')) + '</div>' +
      '<p class="pvp-sub">' + esc(T('pvp.chooseHint')) + '</p>';
    if (!a) {
      html += '<p class="pvp-note">' + esc(T('pvp.loginNeeded')) + '</p>' +
        '<button id="pvp-login" class="pvp-opt primary">' + esc(T('pvp.loginBtn')) + '</button>';
    } else {
      html +=
        '<button id="pvp-find" class="pvp-opt primary">' + esc(T('pvp.find')) + '</button>' +
        '<button id="pvp-create" class="pvp-opt">' + esc(T('pvp.create')) + '</button>' +
        '<button id="pvp-join" class="pvp-opt">' + esc(T('pvp.join')) + '</button>';
    }
    renderContent(html);
    on('pvp-login', function () { window.pbOpenLogin && window.pbOpenLogin(); });
    on('pvp-find', function () {
      window._pbUnlockAudio && window._pbUnlockAudio();
      startSearch();
    });
    on('pvp-create', function () {
      window._pbUnlockAudio && window._pbUnlockAudio();
      doCreate();
    });
    on('pvp-join', function () {
      window._pbUnlockAudio && window._pbUnlockAudio();
      renderJoin();
    });
  }

  // ── Vistas nuevas del flujo directo (Fase 1b) ──
  // NOTA i18n: los textos NUEVOS van en ES hardcodeado (feature dev-only tras el flag;
  // la i18n del hub/PvP se cierra en la pasada de idiomas). Reutilizan las claves T() ya
  // existentes donde las hay (crear/unirse/leave/goMazos).

  // «Partida amistosa»: crear sala o unirse por código (sin la opción de buscar).
  // Etiqueta del formato en las pantallas del online (solo si NO es Estándar)
  function fmtSuffix() {
    var f = state.fmt || 'standard';
    if (f === 'standard' || !window.formatName) return '';
    return ' · ' + esc(window.formatName(f));
  }
  function fmtRulesTxt() {
    var f = state.fmt || 'standard';
    var sz = window.deckSizeFor ? window.deckSizeFor(f) : 20;
    var cp = window.maxCopiesFor ? window.maxCopiesFor(f) : 2;
    return sz + ' cartas, máx ' + cp + ' por nombre';
  }
  function renderFriendly() {
    state.view = 'friendly';
    renderContent(
      '<div class="pvp-h">Partida amistosa' + fmtSuffix() + '</div>' +
      '<p class="pvp-sub">Crea una sala y comparte el código, o únete con el de un amigo. Juegas con tu mazo activo.</p>' +
      '<button id="pvp-create" class="pvp-opt primary">' + esc(T('pvp.create')) + '</button>' +
      '<button id="pvp-join" class="pvp-opt">' + esc(T('pvp.join')) + '</button>' +
      '<button id="pvp-close2" class="pvp-opt subtle">' + esc(T('common.cancel')) + '</button>'
    );
    on('pvp-create', function () { window._pbUnlockAudio && window._pbUnlockAudio(); doCreate(); });
    on('pvp-join', function () { window._pbUnlockAudio && window._pbUnlockAudio(); renderJoin(); });
    on('pvp-close2', function () { exitToHub(); });
  }

  // Gate: el mazo activo no vale para online (necesita 20, ≤2 por nombre, 1 básico…).
  function renderDeckGate(ready) {
    state.view = 'deckgate';
    var reasonsTxt = (ready && ready.reasons || []).map(function (r) { return T(r.k, r.vars || undefined); }).join(' · ');
    renderContent(
      '<div class="pvp-h">Tu mazo no vale para online' + fmtSuffix() + '</div>' +
      '<p class="pvp-sub">Para jugar online tu mazo activo debe ser legal (' + esc(fmtRulesTxt()) + ', al menos 1 Básico).' +
        (reasonsTxt ? ' <b>' + esc(reasonsTxt) + '</b>' : '') + '</p>' +
      '<p class="pvp-note dim">Elígelo o arréglalo en Mis Mazos.</p>' +
      '<button id="pvp-gomazos" class="pvp-opt primary">' + esc(T('pvp.goMazos')) + '</button>' +
      '<button id="pvp-close2" class="pvp-opt subtle">' + esc(T('common.cancel')) + '</button>'
    );
    on('pvp-gomazos', function () { closeOverlay(); window.switchAppTab && window.switchAppTab('mazos'); });
    on('pvp-close2', function () { exitToHub(); });
  }

  // Acelera el fondo de pokéballs de la BÚSQUEDA (zoom-in + brillo) como transición CONTINUA
  // hacia el VS (petición de Daniel: aceleración real, sin jump-cut). Idempotente.
  function accelerateSearchBg() {
    var pk = document.querySelector('#pvp-content .pvp-pokeballs');
    if (pk) pk.classList.add('pvp-warp');
  }
  // Emparejado por cola: rival encontrado, la partida arranca sola (host tira la moneda).
  function renderStarting() {
    state.view = 'starting';
    state._flowShown = 'starting';
    stopSearchTimer();
    // Si YA estamos en «buscando», NO re-renderizar (evita el jump-cut del fondo de pokéballs):
    // solo cambiar el título. El «aceleron» (warp) lo hace renderVs tras el min-delay (así el
    // fondo ha terminado su entrada `pvpAccelIn` y no hay discontinuidad).
    var wrap = document.querySelector('#pvp-content .pvp-searching-wrap');
    if (wrap) {
      var title = wrap.querySelector('.pvp-search-title'); if (title) title.textContent = T('pvp.foundOpp');
      var el = document.getElementById('pvp-elapsed'); if (el) el.textContent = T('pvp.startingMatch');
      var online = wrap.querySelector('.pb-onpill'); if (online) online.style.display = 'none';
      var cbtn = document.getElementById('pvp-cancel-search'); if (cbtn) cbtn.style.display = 'none';
      return;
    }
    renderContent(
      '<span class="pvp-pokeballs"></span>' +
      '<div class="pvp-searching-wrap">' + radarHtml() +
        '<h2 class="pvp-search-title">' + esc(T('pvp.foundOpp')) + '</h2>' +
        '<div class="pvp-elapsed">' + esc(T('pvp.startingMatch')) + '</div>' +
      '</div>'
    );
    setImmersive(true);
  }

  // VS = CORTINA de transición REAL (no overlay-pantalla). Dos mitades HORIZONTALES
  // (rival arriba/rojo, yo abajo/azul = zonas del tablero) que CIERRAN sobre la búsqueda,
  // sostienen avatares+«VS», y ABREN revelando el tablero YA cargado debajo (el tablero se
  // montó en enterMatch con deferCoin). La MONEDA va DESPUÉS, ya en el tablero (spec Daniel:
  // «el lanzamiento empieza en el tablero cuando ha terminado la animación del VS»). Bajo la nav.
  // Mis EMBLEMAS equipados (Maestría Pokémon) → viajan en mi bloque de la sala (host/guest)
  // como [{n:nombre, r:rango}]; el rival los pinta en el VS validando el rango contra MI
  // proyección pública (no se puede enseñar un rango que no se tiene). Cap 3.
  function myEmblemsPayload() {
    var E = window.PB_EMOTES;
    state._embSent = false;
    if (!E) return [];
    try {
      var list = E.equipped(E.myView()).map(function (e) { return { n: String(e.name).slice(0, 40), r: e.rank | 0 }; });
      state._embSent = list.length > 0;   // si salió vacío puede ser que las stats sigan cargando → publishEmblems
      return list;
    } catch (e) { return []; }
  }
  // Los emblemas salen de MIS stats de maestría, que se leen de Firestore al abrir el online:
  // crear/entrar en la sala puede ganarle la carrera a esa lectura y el bloque viajaría VACÍO
  // (y el bloque host/guest no se vuelve a escribir → el rival no vería nada en el VS, aunque
  // en mi pantalla sí salgan porque el VS los recalcula al pintar). Tras asentar el asiento,
  // si mi bloque fue vacío se re-publican por merge en cuanto llegan las stats. Cubre también
  // el puente del DRAFT (draft-multi crea el bloque de jugador sin emblemas).
  function publishEmblems() {
    var E = window.PB_EMOTES;
    if (!E || !E.loadMine || state._embSent) return;
    var gen = state._gen, code = state.code, role = state.role;
    if (!code || !role) return;
    E.loadMine().then(function () {
      if (state._gen !== gen || state.code !== code || state.role !== role) return;
      var list = myEmblemsPayload();
      if (!list.length) return;
      var r = rooms();
      if (!r) return;
      var patch = {}; patch[role] = { emblems: list };
      wrote(r.set(code, patch), 'emblems').catch(function () {});
      if (state.room && state.room[role]) state.room[role].emblems = list;
    }).catch(function () {});
  }
  function vsEmbsHtml(list) {
    if (!window.pbEmblemHtml || !list || !list.length) return '';
    return list.slice(0, 3).map(function (e) {
      var html = window.pbEmblemHtml(e.n || e.name, e.r != null ? e.r : e.rank);
      return html ? '<div class="pvp-vs-emb">' + html + '</div>' : '';
    }).join('');
  }
  function vsSideHtml(av, name, embs) {
    var ini = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return '<div class="pvp-vs-in">' +
      (av ? '<img class="pvp-vs-ava" src="' + esc(av) + '" referrerpolicy="no-referrer" alt="">'
          : '<span class="pvp-vs-ava ini">' + esc(ini) + '</span>') +
      '<div class="pvp-vs-name">' + esc(name) + '</div>' +
      '<div class="pvp-vs-embs">' + vsEmbsHtml(embs) + '</div></div>';
  }
  function renderVs(room) {
    state.view = 'vs';
    state._flowShown = 'vs';
    var meFirst = !!(room && room.coin === state.role);
    var meP = room[state.role] || {}, oppP = room[oppRole()] || {};
    var a = realAcct() || {};
    var myName  = meP.name  || a.name || T('pvp.you');
    var myAva   = meP.avatar || a.avatar || '';
    var oppName = oppP.name || window._pvpOppName || T('pvp.opponent');
    var oppAva  = oppP.avatar || '';
    var reduce = !!(window.pbFx && window.pbFx('reduceMotion'));

    // EMBLEMAS: los míos según mis stats; los del rival como los envió pero con el RANGO
    // recalculado contra su proyección pública (anti-fake) — llega async, se rellenan al llegar.
    var E = window.PB_EMOTES;
    var myEmbs = E ? E.equipped(E.myView()) : [];
    var oppSent = Array.isArray(oppP.emblems) ? oppP.emblems.slice(0, 3) : [];
    var prev = document.getElementById('pvp-vs-curtain'); if (prev) prev.remove();
    var cur = document.createElement('div');
    cur.id = 'pvp-vs-curtain';
    cur.innerHTML =
      '<div class="cur-half top">' + vsSideHtml(oppAva, oppName, []) + '</div>' +
      '<div class="cur-half bottom">' + vsSideHtml(myAva, myName, myEmbs) + '</div>' +
      '<div class="cur-vs">VS</div>';
    document.body.appendChild(cur);
    // Un emblema que se inserta TARDE heredaría el retardo de entrada de la cortina (~1,25s) y
    // aparecería cuando ya se ha abierto: pasado ese momento entran sin retardo (se ven igual).
    var curT0 = Date.now();
    function paintEmbs(host, html) {
      host.innerHTML = html;
      if (Date.now() - curT0 < 900) return;
      host.querySelectorAll('.pvp-vs-emb').forEach(function (el, i) {
        el.style.animationDelay = (i * 0.09) + 's';
        var fr = el.querySelector('.md-fr'); if (fr) fr.style.animationDelay = (0.5 + i * 0.12) + 's';
      });
    }
    // Los del rival pueden llegar TARDE (su re-publicación cruza con la cortina) → el relleno se
    // deja armado y cada snapshot de la sala lo reintenta mientras la cortina siga viva.
    state._vsFillOpp = function (r2) {
      if (!cur.isConnected) { state._vsFillOpp = null; return; }
      if (cur._embDone) return;
      var op = (r2 && r2[oppRole()]) || oppP;
      var sent = Array.isArray(op.emblems) ? op.emblems.slice(0, 3) : [];
      var uid = op.uid || oppP.uid;
      if (!E || !sent.length || !uid) return;
      cur._embDone = true;
      E.loadPublic(uid).then(function (view) {
        var host = cur.querySelector('.cur-half.top .pvp-vs-embs');
        if (!host || !cur.isConnected) return;
        var list = [];
        sent.forEach(function (e) {
          if (!e || !e.n) return;
          var r = view ? E.rankOf(view, e.n) : ((E.devLoose && E.devLoose()) ? (e.r | 0) : 0);   // sin proyección: solo en local/LAN se cree el rango enviado
          if (r >= 1) list.push({ n: e.n, r: r });
        });
        if (!list.length) { cur._embDone = false; return; }   // nada válido: que un snapshot posterior pueda reintentar
        paintEmbs(host, vsEmbsHtml(list));
      }).catch(function () { cur._embDone = false; });
    };
    state._vsFillOpp(room);
    // …y los MÍOS igual: si el VS se pinta antes de que lleguen mis stats, se rellenan al llegar.
    if (E && !myEmbs.length && E.loadMine) {
      E.loadMine().then(function () {
        var mine = cur.querySelector('.cur-half.bottom .pvp-vs-embs');
        if (!mine || !cur.isConnected) return;
        paintEmbs(mine, vsEmbsHtml(E.equipped(E.myView())));
      }).catch(function () {});
    }
    if (state._flowSuspended) cur.classList.add('pvp-suspended');   // creada tras navegar fuera → no tapa esa vista
    // Guarda: si sales de la sesión a mitad del VS (leave/reset), aborta la secuencia y limpia
    // (si no, un setTimeout rancio abriría la moneda sobre un tablero ya sin partida).
    state._vsActive = true;
    function vsAlive() { return state._vsActive; }

    // La moneda ya EN EL TABLERO (tras abrirse la cortina) → luego el reparto animado.
    function afterCurtain() {
      if (!vsAlive()) return;
      state._vsActive = false;
      pvpBoardCoin(meFirst, function () {
        if (window._pvpRunDeal) { try { window._pvpRunDeal(); } catch (e) {} }
      });
    }

    if (reduce) {
      // sin animación: la cortina no aporta → cerrar búsqueda, revelar tablero y a la moneda
      closeOverlay();
      cur.remove();
      afterCurtain();
      return;
    }

    // SINCRONÍA CON `vs battle start.mp3` (2,9s; picos medidos: ~780ms 1er impacto, ~1460ms
    // clash principal/el más fuerte). Una sola animación de cortina (cierra→settle→hold→abre);
    // el «VS» estalla + shake en el clash de 1460ms; la moneda ya en el tablero tras abrir.
    accelerateSearchBg();                          // el fondo de pokéballs acelera (transición continua)
    if (window.playSound) window.playSound('vsStart');
    requestAnimationFrame(function () { cur.classList.add('run'); });   // arranca la animación de la cortina
    // t≈820: cortina cerrada del todo (tapa la búsqueda) → quitar la búsqueda por debajo
    setTimeout(function () { if (vsAlive()) closeOverlay(); }, 820);
    // t≈1460: el «VS» estalla + shake sutil (el clash más fuerte del sonido)
    setTimeout(function () {
      if (!vsAlive()) return;
      var vs = cur.querySelector('.cur-vs'); if (vs) vs.classList.add('burst');
      cur.classList.add('shake');
      setTimeout(function () { if (cur) cur.classList.remove('shake'); }, 280);
    }, 1460);
    // El «VS» SOSTIENE tras estallar; luego se FUNDE SUAVE (fade + leve scale-down, no de golpe)
    // justo antes de que las mitades ABRAN (más rápidas ahora: 84-100% de 2,7s ≈ 2270-2700ms).
    // t≈2150: fundir el «VS» limpio (Daniel: «desaparecía repentinamente»)
    // (+1 s de sostén desde 2026-08-15 para que dé tiempo a ver los EMBLEMAS: la cortina dura 3,7 s)
    setTimeout(function () { if (!vsAlive()) return; var vs = cur.querySelector('.cur-vs'); if (vs) { vs.style.transition = 'opacity .32s ease,transform .32s ease'; vs.style.opacity = '0'; vs.style.transform = 'translate(-50%,-50%) scale(.9)'; } }, 3150);
    // t≈3700: las mitades han ABIERTO (tablero revelado) → retirar la cortina. La moneda entra
    // DIRECTA tras un pequeño respiro (300ms) — SIN solaparse con las mitades saliendo (Daniel).
    setTimeout(function () {
      if (cur) cur.remove();
      setTimeout(afterCurtain, 300);
    }, 3700);
  }

  // Moneda «quién empieza» YA en el TABLERO (tras el VS): 50% más grande, y le dice a CADA
  // jugador si va PRIMERO (azul) o SEGUNDO (rojo) desde su punto de vista.
  function pvpBoardCoin(meFirst, cb) {
    var reduce = !!(window.pbFx && window.pbFx('reduceMotion'));
    // Token de vida: la moneda gira ~3s; si la sesión TERMINA (Salir / blip de red onRoom(undefined)
    // / evento del peer → resetState) o arranca OTRA partida en esa ventana, aborta antes de sonar la
    // decisión de turno o de repartir la mano (cb → _pvpRunDeal) sobre un tablero sin partida.
    var myCode = state.code;
    function alive() { return state.code != null && state.code === myCode; }
    var ov = document.createElement('div');
    ov.id = 'pvp-board-coin';
    var col = document.createElement('div'); col.className = 'pbc-col';
    var holder = document.createElement('div'); holder.className = 'pbc-holder';
    var label = document.createElement('div'); label.className = 'pbc-label';
    col.appendChild(holder); col.appendChild(label);
    ov.appendChild(col);
    document.body.appendChild(ov);
    if (state._flowSuspended) ov.classList.add('pvp-suspended');   // creada tras navegar a Cartas/Mazos → no tapa esa vista
    requestAnimationFrame(function () { ov.classList.add('show'); });
    if (window.playSound) window.playSound('coinFlip');
    function result() {
      if (!alive()) { try { ov.remove(); } catch (e) {} return; }   // sesión terminada durante el giro → ni sonido ni reparto
      if (window.playSound) window.playSound('turnDecision');
      label.textContent = meFirst ? T('pvp.goFirst') : T('pvp.goSecond');
      label.style.color = meFirst ? '#4dabff' : '#ff6b6b';   // primero=azul, segundo=rojo
      label.classList.add('show');
      setTimeout(function () {
        ov.style.transition = 'opacity .3s'; ov.style.opacity = '0';
        setTimeout(function () { try { ov.remove(); } catch (e) {} if (alive()) cb && cb(); }, 320);
      }, reduce ? 500 : 1500);
    }
    if (window.pbCoinFlip) {
      window.pbCoinFlip(meFirst ? 'heads' : 'tails', { host: holder, size: 160, keep: true, dur: 1250, hold: 120, bounce: true })
        .then(result, result);
    } else { result(); }
  }

  // Pantalla FIN a pantalla completa (maqueta «flujo»): rayos + resultado + resumen +
  // «Jugar otra» / «Salir». SUSTITUYE el pop-up _showGameOverOverlay SOLO en PvP (override
  // del hook global window._pvpShowGameOver más abajo; el fin de partida LOCAL no se toca).
  function domScore(player) { return document.querySelectorAll('.sdot[data-player="' + player + '"].on').length; }
  // Daño de ATAQUE hecho por 'mine' = daño recibido por el rival (del registro _pbLog).
  function damageBy(mine) {
    var opp = mine === 'p1' ? 'p2' : 'p1';
    var log = window._pbLog || [], sum = 0;
    for (var i = 0; i < log.length; i++) {
      var e = log[i];
      if (e && e.meta && e.meta.kind === 'damaged' && e.meta.source === 'attack' && e.player === opp) sum += (e.vars && e.vars.dmg) || 0;
    }
    return sum;
  }
  function renderFin(winner, previewModel) {
    var preview = !!previewModel;
    // La pantalla de Fin YA NO es «en partida»: soltar la presencia ahora. (endMatchOver en pvp-sync
    // no llama a pbPresenceSetMatch(false), y navegar a Cartas tras el fin NO dispara resetState → sin
    // esto el contador «en partida» quedaría inflado por este cliente hasta cerrar la pestaña.)
    // Una preview DEV no es una partida: ni siquiera emite el evento de presencia.
    if (!preview && window.pbPresenceSetMatch) { try { window.pbPresenceSetMatch(false); } catch (e) {} }
    var isDraw = winner === 'draw';                 // tope global con puntos iguales / nadie colocó
    var iWon = !isDraw && winner === 'p1';         // en PvP siempre soy p1 localmente
    if (!iWon && window.pbStreakUI) window.pbStreakUI.clearFin();
    // La partida ha cambiado mis stats en el servidor (racha arriba o rota, victorias,
    // misiones): la caché local queda RANCIA. Sin esto, volver al hub seguía enseñando la
    // racha vieja hasta recargar la página (Daniel, 2026-08-28).
    if (!preview && window.PB_EMOTES && window.PB_EMOTES.forgetMine) {
      try { window.PB_EMOTES.forgetMine(); } catch (eFm) {}
    }
    function finInt(v, fallback) {
      var n = Number(v);
      return isFinite(n) ? Math.max(0, Math.min(999999, Math.floor(n))) : fallback;
    }
    var defaultMy = isDraw ? 2 : (iWon ? 3 : 1);
    var defaultOpp = isDraw ? 2 : (iWon ? 1 : 3);
    var my = preview ? finInt(previewModel.myScore, defaultMy) : domScore('p1');
    var opp = preview ? finInt(previewModel.oppScore, defaultOpp) : domScore('p2');
    var turns = preview
      ? finInt(previewModel.turns, null)
      : ((typeof window.globalTurnNumber === 'number' && window.globalTurnNumber > 0) ? window.globalTurnNumber : null);
    var room = preview ? {} : (state.room || {});
    var meP = preview ? {} : (room[state.role] || {});
    var oppP = preview ? {} : (room[oppRole()] || {});
    var myCover = preview ? (previewModel.myCard || (previewModel.myDeck && previewModel.myDeck.cover) || '') : ((meP.deck && meP.deck.cover) || '');
    var oppCover = preview ? (previewModel.oppCard || (previewModel.oppDeck && previewModel.oppDeck.cover) || '') : ((oppP.deck && oppP.deck.cover) || '');
    var myCard = locImg(myCover);
    var oppCard = locImg(oppCover);
    var meName = preview ? (previewModel.meName || T('pvp.you')) : T('pvp.you');
    var oppName = preview ? (previewModel.oppName || T('pvp.opponent')) : (oppP.name || window._pvpOppName || T('pvp.opponent'));
    var coins = preview
      ? { p1: finInt(previewModel.myCoins, 0), p2: finInt(previewModel.oppCoins, 0) }
      : (window._pbCoinsWon || { p1: 0, p2: 0 });
    var damage = preview
      ? { p1: finInt(previewModel.myDamage, 0), p2: finInt(previewModel.oppDamage, 0) }
      : { p1: damageBy('p1'), p2: damageBy('p2') };
    // Panel de cada jugador: carta principal (portada del mazo) + daño + monedas ganadas.
    function side(cls, card, name, dmg, cn) {
      return '<div class="pvp-fin-side ' + cls + '">' +
        (card ? '<img class="pvp-fin-card" src="' + esc(card) + '" alt="">' : '<span class="pvp-fin-card ph"></span>') +
        '<div class="pvp-fin-pname">' + esc(name) + '</div>' +
        '<div class="pvp-fin-stats">' +
          '<div class="st"><span>' + esc(T('pvp.finDamage')) + '</span><b>' + dmg + '</b></div>' +
          '<div class="st"><span>' + esc(T('pvp.finCoins')) + '</span><b>' + cn + '</b></div>' +
        '</div>' +
      '</div>';
    }
    openOverlay();
    if (preview) {
      var _ovPreview = document.getElementById('pvp-overlay');
      if (_ovPreview) _ovPreview.classList.remove('pvp-suspended');
    }
    // Si el flujo PvP está suspendido (navegaste a Cartas/Mazos), el Fin nace suspendido también:
    // no debe taparte esa vista cuando el rival gana mientras navegas (como la cortina/moneda).
    if (!preview && state._flowSuspended) { var _ovf = document.getElementById('pvp-overlay'); if (_ovf) _ovf.classList.add('pvp-suspended'); }
    // Fin MINIMALISTA (decisión de Daniel) + cartas y stats de cada jugador (idea TCG Live).
    renderContent(
      '<div class="pvp-fin' + (isDraw ? ' draw' : (iWon ? ' win' : ' lose')) + '">' +
        '<div class="pvp-fin-tag">' + esc(T(isDraw ? 'pvp.finTagDraw' : (iWon ? 'pvp.finTagWin' : 'pvp.finTagLose'))) + '</div>' +
        '<div class="pvp-fin-res">' + esc(T(isDraw ? 'pvp.finDraw' : (iWon ? 'pvp.finWin' : 'pvp.finLose'))) + '</div>' +
        '<div class="pvp-fin-score">' + my + '<span>–</span>' + opp + '</div>' +
        (iWon ? '<div class="pvp-fin-streak-slot" id="pvp-fin-streak-slot" aria-live="polite"></div>' : '') +
        '<div class="pvp-fin-body">' +
          side('me', myCard, meName, damage.p1, coins.p1 || 0) +
          side('opp', oppCard, oppName, damage.p2, coins.p2 || 0) +
        '</div>' +
        (turns != null ? '<div class="pvp-fin-meta">' + esc(T('pvp.finTurns', { n: turns })) + '</div>' : '') +
        '<div class="pvp-fin-btns">' +
          '<button id="pvp-again" class="pvp-opt primary">' + esc(T('pvp.playAgain')) + '</button>' +
          '<button id="pvp-exit" class="pvp-opt subtle">' + esc(T('pvp.leave')) + '</button>' +
        '</div>' +
        '<a class="pvp-fin-support" href="https://ko-fi.com/danielcmini" target="_blank" rel="noopener noreferrer">' +
          '<span>' + esc(T('support.matchLead')) + '</span>' +
          '<b>' + esc(T('support.cta')) + ' →</b>' +
        '</a>' +
      '</div>'
    );
    if (iWon && window.pbStreakUI) {
      window.pbStreakUI.mountFin(document.getElementById('pvp-fin-streak-slot'));
      // La racha la confirma el servidor (Cloud Function): se pide el dato y, si sube, la
      // ceremonia se monta sola sobre este mismo slot. En la preview DEV no se pide nada:
      // ahí manda lo que haya inyectado el simulador.
      if (!preview && window.pbStreakUI.pullFin) {
        window.pbStreakUI.pullFin(window.pbStreakUI.modeOf(
          (state.room && state.room.fmt) || state.fmt, (state.room && state.room.mode) || state.mode));
      }
    }
    setImmersive(true);
    // SFX de fin (Daniel): victoria = «pull crown rare», derrota = «defeat».
    if (window.playSound) window.playSound(iWon ? 'pullCrownRare' : 'defeat');
    // En el laboratorio ambos botones solo desmontan la maqueta. Nada de cola, resetState,
    // presence o disconnect: el estado PvP antes y después debe ser idéntico.
    if (preview) {
      on('pvp-again', closeStreakPreview);
      on('pvp-exit', closeStreakPreview);
      return true;
    }
    // Al salir del Fin: limpiar el cierre de partida ONLINE para que NO se cuele en el autosave
    // local (si no, al recargar sin PvP activo reaparecía el pop-up viejo «Ver el tablero»).
    function finExit() {
      if (window.pbStreakUI) window.pbStreakUI.clearFin();
      window._pbGameOver = null;
      var g = document.getElementById('board-gameover'); if (g) g.remove();
      resetState();
    }
    // «Jugar otra» = volver a la cola DEL MISMO FORMATO (venías de una de Avanzado → otra de
    // Avanzado). Hay que capturarlo AHORA: finExit() llama a resetState(), que devuelve
    // state.fmt a 'standard' — sin esto, tras una de Avanzado te metía en la cola de Estándar
    // y tu mazo de 30 fallaba la validación con «Tu mazo no vale para online».
    var finFmt = room.fmt || state.fmt || 'standard';
    // «Salir» = al hub.
    on('pvp-again', function () { finExit(); if (window._pvpStartQueue) window._pvpStartQueue({ format: finFmt }); });
    on('pvp-exit', function () { finExit(); closeOverlay(); if (window.switchAppTab) window.switchAppTab('jugar'); });
    // La partida ha terminado: nada remoto vuelve a hablar con esta pantalla.
    state._finished = true;
    quietDisconnect();
    return true;
  }
  // Override del hook: pvp.js carga DESPUÉS de main.js (index.html) → esta versión gana, así
  // el fin de partida ONLINE usa el Fin a pantalla completa; el LOCAL sigue con su overlay.
  window._pvpShowGameOver = function (winner) { return renderFin(winner); };

  function renderJoin() {
    state.view = 'join';
    renderContent(
      '<div class="pvp-h">' + esc(T('pvp.join')) + '</div>' +
      '<label class="pvp-label" for="pvp-code-input">' + esc(T('pvp.enterCode')) + '</label>' +
      '<input id="pvp-code-input" class="pvp-input" maxlength="8" autocomplete="off" spellcheck="false">' +
      '<div id="pvp-join-err" class="pvp-err"></div>' +
      '<button id="pvp-join-go" class="pvp-opt primary">' + esc(T('pvp.joinBtn')) + '</button>' +
      '<button id="pvp-back" class="pvp-opt subtle">' + esc(T('pvp.back')) + '</button>'
    );
    var input = document.getElementById('pvp-code-input');
    if (input) {
      input.focus();
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') doJoin();
        e.stopPropagation();
      });
    }
    on('pvp-join-go', doJoin);
    on('pvp-back', renderMenu);
  }

  function renderLoading(msg) {
    state.view = 'loading';
    renderContent('<div class="pvp-h">' + esc(T('pvp.title')) + '</div><p class="pvp-sub">' + esc(msg) + '</p>');
  }

  function renderError(msg) {
    state.view = 'error';
    renderContent(
      '<div class="pvp-h">' + esc(T('pvp.title')) + '</div>' +
      '<p class="pvp-note">' + esc(msg) + '</p>' +
      '<button id="pvp-back" class="pvp-opt subtle">' + esc(T('pvp.back')) + '</button>'
    );
    on('pvp-back', renderMenu);
  }

  function playerRow(p, isMe, room) {
    var who = isMe ? T('pvp.you') : T('pvp.opponent');
    if (!p) {
      return '<div class="pvp-player empty"><span class="pvp-ava pvp-ava-ini">?</span>' +
        '<div class="pvp-pcol"><span class="pvp-pname dim">' + esc(who) + '</span>' +
        '<span class="pvp-pdeck dim">' + esc(T('pvp.waitingOpp')) + '</span></div></div>';
    }
    var deckHtml;
    if (p.deck) {
      deckHtml = '<span class="pvp-pdeck ok">' +
        (p.deck.cover ? '<img class="pvp-cover" src="' + esc(locImg(p.deck.cover)) + '" alt="">' : '') +
        '<span>' + esc(p.deck.name) + '</span>' +
        '<span class="pvp-check">✓</span></span>';
    } else {
      deckHtml = '<span class="pvp-pdeck dim">' + esc(T('pvp.choosingDeck')) + '</span>';
    }
    return '<div class="pvp-player' + (isMe ? ' me' : '') + '">' +
      avatarHtml(p.avatar, p.name) +
      '<div class="pvp-pcol"><span class="pvp-pname">' + esc(p.name || who) +
      (isMe ? ' <span class="pvp-metag">' + esc(who) + '</span>' : '') + '</span>' +
      deckHtml + '</div></div>';
  }

  // Sala AMISTOSA en espera: compartir código + jugadores. Sin picker ni «Empezar»:
  // el mazo es el activo (ya fijado) y el host arranca solo al llegar el rival.
  function renderLobby(room) {
    state.view = 'lobby';
    var me = room[state.role] || null;
    var opp = room[oppRole()] || null;
    var html =
      '<div class="pvp-h">' + esc(T('pvp.title')) + '</div>' +
      '<div class="pvp-codebox"><span class="pvp-codelabel">' + esc(T('pvp.yourCode')) + '</span>' +
      '<span class="pvp-code">' + esc(state.code) + '</span>' +
      '<button id="pvp-copy" class="pvp-mini-btn">' + esc(T('pvp.copy')) + '</button></div>' +
      '<p class="pvp-sub">' + esc(opp ? 'Rival conectado. Empezando…' : T('pvp.shareHint')) + '</p>' +
      playerRow(me, true, room) +
      playerRow(opp, false, room) +
      '<button id="pvp-leave" class="pvp-opt subtle">' + esc(T('pvp.leave')) + '</button>';
    renderContent(html);
    on('pvp-copy', function () { copyText(state.code, 'pvp.copied'); });
    on('pvp-leave', leave);
  }

  function renderPicker() {
    state.view = 'picker';
    var lib = loadLibrary();
    var html = '<div class="pvp-h">' + esc(T('pvp.pickTitle')) + '</div>' +
      '<p class="pvp-sub">' + esc(T('pvp.pickHint')) + '</p>';
    if (!lib.length) {
      html += '<p class="pvp-note">' + esc(T('pvp.noDecks')) + '</p>' +
        '<button id="pvp-gomazos" class="pvp-opt">' + esc(T('pvp.goMazos')) + '</button>';
    } else {
      html += '<div class="pvp-decklist">';
      lib.forEach(function (deck, i) {
        var key = deckKeyOf(deck, i);
        var v = validateDeck(deck);
        var cover = locImg(deckCoverImg(deck));
        var reasonsTxt = v.reasons.map(function (r) { return T(r.k, r.vars || undefined); }).join(' · ');
        html += '<button class="pvp-deckrow' + (v.ok ? '' : ' invalid') + '" data-key="' + esc(key) + '"' +
          (v.ok ? '' : ' disabled') + '>' +
          (cover ? '<img class="pvp-cover" src="' + esc(cover) + '" alt="">' : '<span class="pvp-cover ph"></span>') +
          '<span class="pvp-drcol"><span class="pvp-drname">' + esc(deck.name || '—') + '</span>' +
          '<span class="pvp-drsub">' + (v.ok
            ? esc(T('pvp.cardsN', { n: (deck.cards || []).length }))
            : esc(reasonsTxt)) + '</span></span>' +
          (v.ok ? '<span class="pvp-check">✓</span>' : '') +
          '</button>';
      });
      html += '</div>';
    }
    html += '<button id="pvp-back" class="pvp-opt subtle">' + esc(T('pvp.back')) + '</button>';
    renderContent(html);
    on('pvp-gomazos', function () {
      closeOverlay();
      window.switchAppTab && window.switchAppTab('mazos');
    });
    on('pvp-back', function () { if (state.room) renderLobby(state.room); else renderMenu(); });
    var rows = document.querySelectorAll('#pvp-content .pvp-deckrow:not(.invalid)');
    Array.prototype.forEach.call(rows, function (row) {
      row.addEventListener('click', function () { pickDeck(row.getAttribute('data-key')); });
    });
  }

  function renderConnected(room) {
    state.view = 'connected';
    var me = room[state.role] || {};
    var opp = room[oppRole()] || {};
    function side(p, cls) {
      return '<div class="pvp-vs-side ' + cls + '">' +
        (p.deck && p.deck.cover
          ? '<img class="pvp-vs-cover" src="' + esc(locImg(p.deck.cover)) + '" alt="">'
          : '<span class="pvp-vs-cover"></span>') +
        '<span class="pvp-vs-name">' + esc(p.name || '') + '</span>' +
        '<span class="pvp-vs-deck">' + esc((p.deck && p.deck.name) || '') + '</span></div>';
    }
    renderContent(
      '<div class="pvp-h">' + esc(T('pvp.connected')) + '</div>' +
      '<div class="pvp-vs">' + side(me, 'me') + '<span class="pvp-vs-badge">VS</span>' + side(opp, 'opp') + '</div>' +
      '<p class="pvp-sub">' + esc(T('pvp.connectedHint')) + '</p>' +
      '<button id="pvp-leave" class="pvp-opt subtle">' + esc(T('pvp.leave')) + '</button>'
    );
    on('pvp-leave', leave);
  }

  // Soltar una sala guardada SIN pop-ups (camino de la reconexión). `kill` = la sala DEJA DE
  // EXISTIR (partida muerta: no queda nadie dentro); si no, el HOST la borra y el INVITADO solo
  // libera su hueco (el host puede seguir esperando en su lobby).
  function dropRoom(r, code, role, kill) {
    if (r && code) {
      if (kill || role === 'host') wrote(r.remove(code), 'drop-remove').catch(function () {});
      else wrote(r.set(code, { guest: null }), 'drop-free').catch(function () {});
    }
    forget();
  }

  // ── Acciones de sala ──
  function doCreate() {
    var a = realAcct();
    if (!a) { renderMenu(); return; }
    newIntent();   // sesión NUEVA: invalida la reconexión (u otro create/join) que siguiera en vuelo
    var ready = activeDeckReady();   // el mazo = el activo del hub (sin picker); gate si no vale
    if (!ready.ok) { renderDeckGate(ready); return; }
    var r = rooms();
    if (!r) { renderError(T('pvp.error')); return; }
    renderLoading(T('pvp.creating'));
    var gen = state._gen;   // si cierras «Creando…» (closeOverlay bumpea _gen), el create async NO revive la sesión
    var code = genCode();
    var docData = {
      status: 'waiting', fmt: state.fmt, expireAt: ttl(), tabs: { host: TAB_ID },
      host: { uid: a.uid, name: nm(a), avatar: a.avatar || '', deck: deckPayload(ready.deck), emblems: myEmblemsPayload() },
      guest: null
    };
    wrote(r.create(code, docData), 'create').then(function () {
      if (state._gen !== gen) { r.remove(code).catch(function () {}); return; }   // cerrado durante la creación → borrar la sala huérfana y no revivir
      state.code = code; state.role = 'host'; state.deckKey = ready.key;
      remember();
      watch(code);
      publishEmblems();
    }).catch(function () { renderError(T('pvp.error')); });
  }

  // Unión a una sala concreta (la usan el join por código Y la cola pública).
  // onErr recibe 'notFound' | 'closed' | 'full' | 'error'.
  function joinRoomByCode(code, a, onErr) {
    var r = rooms();
    if (!r) { onErr && onErr('error'); return; }
    var gen = state._gen;   // token de sesión: si CANCELAS mientras el join async está en vuelo (resetState
    r.get(code).then(function (room) {     // incrementa _gen), el callback aborta en vez de revivir la sesión.
      if (state._gen !== gen) return;   // cancelado leyendo la sala → NO escribir guest ni entrar
      if (!room) { onErr && onErr('notFound'); return; }
      if (room.status !== 'waiting') { onErr && onErr('closed'); return; }
      if (room.guest && room.guest.uid && room.guest.uid !== a.uid) { onErr && onErr('full'); return; }
      // El FORMATO lo manda la sala: el invitado valida su mazo activo contra ÉL (un 20 no
      // entra en una sala de 30 y viceversa) → si no vale, se explica en vez de entrar roto.
      state.fmt = room.fmt || 'standard';
      var ready = activeDeckReady();
      if (!ready.ok) { onErr && onErr('deck', ready); return; }
      var guest = { uid: a.uid, name: nm(a), avatar: a.avatar || '', deck: deckPayload(ready.deck), emblems: myEmblemsPayload() };
      wrote(r.set(code, { guest: guest, tabs: { guest: TAB_ID } }), 'join').then(function () {
        if (state._gen !== gen) { r.set(code, { guest: null }).catch(function () {}); return; }   // cancelado tras despachar el guest → soltar el hueco (host sin rival fantasma) + no revivir
        state.code = code; state.role = 'guest'; state.deckKey = ready.key;
        remember();
        watch(code);
        publishEmblems();
        renderLoading(T('pvp.joining'));
      }).catch(function () { onErr && onErr('error'); });
    }).catch(function () { onErr && onErr('error'); });
  }

  function doJoin() {
    newIntent();
    var input = document.getElementById('pvp-code-input');
    var errBox = document.getElementById('pvp-join-err');
    function setErr(m) { if (errBox) errBox.textContent = m; }
    var code = String((input && input.value) || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length < 4) { setErr(T('pvp.notFound')); return; }
    var a = realAcct();
    if (!a) { setErr(T('pvp.loginNeeded')); return; }
    setErr('');
    joinRoomByCode(code, a, function (why, ready) {
      // 'deck' = la sala es de OTRO formato (o tu mazo activo no vale para el suyo) → pantalla
      // de mazo con el motivo, en vez de un error genérico que no dice qué pasa.
      if (why === 'deck') { renderDeckGate(ready); return; }
      setErr(T(why === 'notFound' ? 'pvp.notFound' : why === 'closed' ? 'pvp.closed' : why === 'full' ? 'pvp.full' : 'pvp.error'));
    });
  }

  // ═══ TANDA 5: cola pública «Buscar partida» (claim de sala, sin servidor) ═══
  // Doc de cola /pvpGames/_QUEUE = { open: {code, hostUid, hostName, ts, fmt} | null }.
  // Buscar: si hay entrada FRESCA de otro → la reclamo (vacío la cola + me uno a su sala);
  // si no (o está rancia >60s) → creo sala pública y me anuncio en la cola.
  var QUEUE = '_QUEUE';
  var QUEUE_FRESH_MS = 60000;
  var QUEUE_TICK_MS = 5000;         // cada cuánto se mira la cola mientras esperas
  var QUEUE_REANNOUNCE_MS = 20000;  // …y cada cuánto se refresca MI entrada (no en cada tick)
  var QUEUE_GHOST_MS = 15000;       // sala pública que no arranca = anfitrión que ya no está
  // El `ts` lo escribe el anfitrión con SU reloj. Con el reloj adelantado su entrada parecía
  // RECIÉN PUESTA para siempre (te emparejaba una y otra vez con la misma sala, viva o no) y con
  // el atrasado nacía rancia. Solo vale una hora que encaje en mi ventana POR LOS DOS LADOS.
  function queueFresh(ts) { return !!(ts && Math.abs(Date.now() - ts) < QUEUE_FRESH_MS); }
  window._pvpQueueFresh = queueFresh;   // hook de test
  // Radar de la maqueta «flujo»: 2 anillos que laten + pokéball dorada. CSS en jugar-view.css.
  // Pokéball SVG nítido (el viejo de pseudo-elementos salía «amorfo»).
  function pokeballSvg() {
    return '<svg class="pvp-pk-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><clipPath id="pvppkc"><circle cx="50" cy="50" r="46"/></clipPath></defs>' +
      '<g clip-path="url(#pvppkc)">' +
        '<rect x="0" y="0" width="100" height="50" fill="#e2535a"/>' +
        '<rect x="0" y="50" width="100" height="50" fill="#f7f7fa"/>' +
        '<rect x="0" y="43" width="100" height="14" fill="#17171d"/>' +
      '</g>' +
      '<circle cx="50" cy="50" r="46" fill="none" stroke="#17171d" stroke-width="5"/>' +
      '<circle cx="50" cy="50" r="16" fill="#17171d"/>' +
      '<circle cx="50" cy="50" r="9" fill="#f7f7fa"/>' +
      '<circle cx="50" cy="50" r="9" fill="none" stroke="#17171d" stroke-width="2.5"/>' +
    '</svg>';
  }
  function radarHtml() {
    return '<div class="pvp-radar"><span class="pvp-ring"></span><span class="pvp-ring r2"></span>' +
      '<div class="pvp-core">' + pokeballSvg() + '</div></div>';
  }
  // Contadores online: solo una lectura REAL de presence.js. Hasta que llegue,
  // la búsqueda funciona igual pero no enseña ninguna cifra.
  function counterVals() {
    if (window.pbPresenceVals) return window.pbPresenceVals();
    var pr = window._pbPresence;
    if (pr && pr.online != null) return {
      online: pr.online,
      inMatch: pr.inMatch == null ? 0 : pr.inMatch,
      real: true
    };
    return null;
  }
  // La píldora es la MISMA que la del hub (presence.js la genera); ids «pvp-cnt-*» para repintar.
  function onlinePillHtml(v) {
    if (!v) return '';
    if (window.pbPresencePill) return window.pbPresencePill('pvp', v);
    return '<span class="pb-onpill"><span class="pb-onpill-dot"></span>' +
      '<span class="pb-onpill-i"><b id="pvp-cnt-online">' + v.online + '</b>' + esc(T('jugar.online')) + '</span>' +
      '<span class="pb-onpill-div"></span>' +
      '<span class="pb-onpill-i"><b id="pvp-cnt-match">' + v.inMatch + '</b>' + esc(T('jugar.inMatch')) + '</span></span>';
  }
  function paintCounters() {
    var c = counterVals();
    var wrap = document.querySelector('#pvp-content .pvp-searching-wrap');
    if (!wrap) return;
    var pill = wrap.querySelector('.pb-onpill');
    if (!c) { if (pill) pill.remove(); return; }
    var co = document.getElementById('pvp-cnt-online'); if (co) co.textContent = c.online;
    var cm = document.getElementById('pvp-cnt-match'); if (cm) cm.textContent = c.inMatch;
    if (!pill) {
      var title = wrap.querySelector('.pvp-search-title'), html = onlinePillHtml(c);
      if (title && html) title.insertAdjacentHTML('afterend', html);
    }
  }
  function renderSearching() {
    state.view = 'searching';
    state._flowShown = 'searching';
    state._searchStart = Date.now();
    if (window.pbPresenceRefresh) window.pbPresenceRefresh();   // presencia real (presence.js)
    var c0 = counterVals();
    if (window.playSound) window.playSound('unlock');   // «launch» al arrancar la cola (SFX Pocket)
    renderContent(
      '<span class="pvp-pokeballs"></span>' +   // fondo con «warp» de aceleración (CSS en jugar-view.css)
      '<div class="pvp-searching-wrap">' + radarHtml() +
        '<h2 class="pvp-search-title">' + esc(T('pvp.searching')) + '</h2>' +
        onlinePillHtml(c0) +
        '<div class="pvp-elapsed" id="pvp-elapsed">' + esc(T('pvp.searchMode')) + ' · 0:00</div>' +
        '<button id="pvp-cancel-search" class="pb-cancelbtn">' + esc(T('common.cancel')) + '</button>' +
      '</div>'
    );
    setImmersive(true);
    on('pvp-cancel-search', cancelSearch);
    startSearchTimer();
  }
  // Cronómetro de búsqueda (no necesita backend). La presencia se repinta si
  // durante la espera llega o desaparece una medición real.
  function startSearchTimer() {
    stopSearchTimer();
    state._searchTimer = setInterval(function () {
      var el = document.getElementById('pvp-elapsed');
      if (!el) { stopSearchTimer(); return; }
      var s = Math.max(0, Math.floor((Date.now() - (state._searchStart || Date.now())) / 1000));
      el.textContent = T('pvp.searchMode') + ' · ' + Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
      paintCounters();
    }, 1000);
  }
  function stopSearchTimer() {
    if (state._searchTimer) { clearInterval(state._searchTimer); state._searchTimer = null; }
  }
  function startSearch() {
    var a = realAcct();
    if (!a) { renderMenu(); return; }
    newIntent();
    var r = rooms();
    if (!r) { renderError(T('pvp.error')); return; }
    state._searching = true;
    renderSearching();
    r.get(QUEUE).then(function (q) {
      if (!state._searching) return;
      var open = q && q.open;
      var sameFmt = open && (open.fmt || 'standard') === (state.fmt || 'standard');   // no cruzar formatos en la cola
      // El `ts` es solo una pista: la VERDAD de si alguien espera es que su sala siga abierta,
      // y eso ya lo comprueba el join (notFound / closed / full → me hago anfitrión). Si el
      // anuncio se descartaba por viejo, el que llevaba rato esperando se volvía invisible
      // justo para quien acababa de llegar — el caso que reportó Daniel.
      if (open && sameFmt && open.hostUid !== a.uid) {
        claimQueueRoom(r, a, open);
      } else {
        hostSearch(a, r);
      }
    }).catch(function () { if (state._searching) hostSearch(a, r); });
  }
  function hostSearch(a, r) {
    if (!state._searching) return;
    var gen = state._gen;   // si CANCELAS la búsqueda mientras esta sala se crea (resetState bumpea _gen),
    var ready = activeDeckReady();   // el create async NO revive la sesión ni deja sala/watch/entrada de cola huérfanos.
    var code = genCode();
    var docData = {
      status: 'waiting', isPublic: true, fmt: state.fmt, expireAt: ttl(), tabs: { host: TAB_ID },
      host: { uid: a.uid, name: nm(a), avatar: a.avatar || '', deck: ready.ok ? deckPayload(ready.deck) : null, emblems: myEmblemsPayload() },
      guest: null
    };
    wrote(r.create(code, docData), 'create-public').then(function () {
      if (state._gen !== gen) { r.remove(code).catch(function () {}); return; }   // cancelado durante la creación → borrar sala huérfana y no revivir
      state.code = code; state.role = 'host'; state.deckKey = ready.ok ? ready.key : null;
      remember();
      watch(code);
      publishEmblems();
      announceQueue(r, a, code);
      startQueueRefresh(r, a);
    }).catch(function () { state._searching = false; renderError(T('pvp.error')); });
  }
  function announceQueue(r, a, code) {
    wrote(r.set(QUEUE, { open: { code: code, hostUid: a.uid, hostName: String(a.name || '').slice(0, 20), ts: Date.now(), fmt: state.fmt } }), 'queue-open')
      .catch(function () {});
  }
  // Ciclo de emparejamiento COMPLETO mientras esperas (leer la cola + reclamar o anunciarse),
  // no solo un refresco de mi entrada. Antes, el que ya era anfitrión NO volvía a leer la cola
  // en toda la espera: bastaba con que dos personas acabaran esperando a la vez —se pisan la
  // ranura única, o una entrada caduca porque el navegador estrangula los temporizadores de una
  // pestaña de fondo— para que ninguna reclamara a la otra y las dos esperaran eternamente.
  // Es el «llevo un rato buscando y ya no encuentra; cancelo, vuelvo a darle y entro enseguida»
  // (cancelar y volver era lo único que hacía leer la cola otra vez). Con el ciclo converge
  // solo: en la ranura únicamente cabe UNO, así que el que no está anunciado da el paso.
  function queueTick(r, a) {
    if (!state._searching || !state.code) { stopQueueRefresh(); return; }
    var myCode = state.code;
    r.get(QUEUE).then(function (q) {
      if (!state._searching || state.code !== myCode) return;
      var open = q && q.open;
      var mine = !!(open && open.code === myCode);
      var fresh = queueFresh(open && open.ts);
      var sameFmt = !!(open && (open.fmt || 'standard') === (state.fmt || 'standard'));
      if (open && !mine && sameFmt && open.hostUid !== a.uid) { claimQueueRoom(r, a, open); return; }
      // Ranura libre, mía y caducando, o con basura rancia de alguien que ya no está → me anuncio.
      if (!open || (mine && Date.now() - (open.ts || 0) > QUEUE_REANNOUNCE_MS) || (!mine && !fresh)) {
        announceQueue(r, a, myCode);
      }
    }).catch(function () {});
  }
  // Dejo de esperar y me uno a la sala de quien estaba anunciado. Si YO ya era anfitrión hay que
  // soltar mi sala (si no, queda huérfana esperando a nadie) y dejar de vigilarla ANTES de
  // borrarla: el watch vería el borrado como «sala cancelada» y me echaría de la cola con error.
  function claimQueueRoom(r, a, open) {
    var myCode = state.code;
    stopQueueRefresh();
    wrote(r.set(QUEUE, { open: null }), 'queue-claim').catch(function () {});
    if (myCode && state.role === 'host') {
      if (state.unsub) { try { state.unsub(); } catch (e) {} state.unsub = null; }
      stopPoll();
      state.code = null; state.role = null; state.room = null;
      wrote(r.remove(myCode), 'queue-swap').catch(function () {});
    }
    joinRoomByCode(open.code, a, function () {
      if (state._searching) hostSearch(a, r);   // la sala ya no valía → vuelvo a montar la mía
    });
    // Anfitrión FANTASMA: una sala pública sigue en pie aunque quien la creó cerrara la
    // pestaña, y como el arranque lo da el anfitrión, unirse a una de esas te dejaba
    // esperando para siempre. Si en QUEUE_GHOST_MS no ha arrancado, suelto el hueco, quito
    // su anuncio para que no caiga nadie más, y vuelvo a buscar.
    if (state._qJoinT) clearTimeout(state._qJoinT);
    state._qJoinT = setTimeout(function () {
      state._qJoinT = 0;
      if (state._matchStarted || state.role !== 'guest' || state.code !== open.code) return;
      if (state.room && state.room.status !== 'waiting') return;
      dlog('◆ cola: la sala ' + open.code + ' no arranca → anfitrión fantasma, vuelvo a buscar');
      if (state.unsub) { try { state.unsub(); } catch (e) {} state.unsub = null; }
      stopPoll();
      wrote(r.set(open.code, { guest: null }), 'queue-ghost').catch(function () {});
      r.get(QUEUE).then(function (q2) {
        if (q2 && q2.open && q2.open.code === open.code) r.set(QUEUE, { open: null }).catch(function () {});
      }).catch(function () {});
      state.code = null; state.role = null; state.room = null;
      state._searching = true;
      renderSearching();
      hostSearch(a, r);
    }, QUEUE_GHOST_MS);
  }
  function startQueueRefresh(r, a) {
    stopQueueRefresh();
    state._qRefresh = setInterval(function () { queueTick(r, a); }, QUEUE_TICK_MS);
    // Al volver a la pestaña: en segundo plano los temporizadores se estrangulan y mi entrada
    // puede haber caducado sin que yo lo sepa → un ciclo inmediato en cuanto se vuelve a mirar.
    state._qWake = function () { if (!document.hidden) queueTick(r, a); };
    document.addEventListener('visibilitychange', state._qWake);
  }
  function stopQueueRefresh() {
    if (state._qRefresh) { clearInterval(state._qRefresh); state._qRefresh = null; }
    if (state._qWake) { document.removeEventListener('visibilitychange', state._qWake); state._qWake = null; }
  }
  function clearMyQueueEntry() {
    var r = rooms(), myCode = state.code;
    if (!r || !myCode) return;
    r.get(QUEUE).then(function (q) {
      if (q && q.open && q.open.code === myCode) r.set(QUEUE, { open: null }).catch(function () {});
    }).catch(function () {});
  }
  function cancelSearch() {
    state._searching = false;
    stopQueueRefresh();
    clearMyQueueEntry();
    var r = rooms();
    if (r && state.code && state.role === 'host') wrote(r.remove(state.code), 'queue-cancel').catch(function () {});
    resetState();
    exitToHub();   // volver al hub (NO el menú viejo de crear/unirse, ni el tablero de debajo)
  }

  function pickDeck(key) {
    var lib = loadLibrary();
    var deck = null;
    for (var i = 0; i < lib.length; i++) {
      if (deckKeyOf(lib[i], i) === key) { deck = lib[i]; break; }
    }
    if (!deck) return;
    var v = validateDeck(deck);
    if (!v.ok) return; // defensa: solo mazos legales
    var r = rooms();
    if (!r || !state.code || !state.role) return;
    state.deckKey = key;
    var patch = {};
    // Cada cliente escribe SOLO su subárbol (merge de mapas anidados → no pisa al rival).
    patch[state.role] = {
      deck: {
        name: String(deck.name || '').slice(0, 40),
        cover: deckCoverImg(deck),   // canónica; se localiza al pintar
        n: (deck.cards || []).length,
        energyTypes: (deck.energyTypes && deck.energyTypes.slice(0, 3)) || []   // pública (zona de energía)
      }
    };
    wrote(r.set(state.code, patch), 'pickDeck').catch(function () {
      window.pbToast && window.pbToast(T('pvp.error'));
    });
    // Optimista: pinta ya el lobby con mi mazo (el snapshot lo confirmará).
    if (state.room) {
      state.room[state.role] = state.room[state.role] || {};
      state.room[state.role].deck = patch[state.role].deck;
      renderLobby(state.room);
    } else {
      renderLoading(T('pvp.joining'));
    }
  }

  function startMatch() {
    if (state.role !== 'host') return;
    var room = state.room;
    if (!room || !room.host || !room.host.deck || !room.guest || !room.guest.deck) return;
    // IDEMPOTENTE: una segunda llamada con la partida ya en marcha RE-TIRARÍA la moneda y la
    // reescribiría en la sala — pero los clientes ya arrancaron con la anterior, así que cada
    // uno creería que empieza el otro. La sala solo arranca desde 'waiting'.
    if (room.status && room.status !== 'waiting') return;
    var r = rooms();
    if (!r) return;
    // El host tira la moneda compartida (suerte v1 en cliente, spec pvp-tablero-spec)
    var coin = Math.random() < 0.5 ? 'host' : 'guest';
    wrote(r.set(state.code, { status: 'playing', coin: coin, expireAt: ttl() }), 'start').catch(function () {
      window.pbToast && window.pbToast(T('pvp.error'));
    });
  }

  function findMyDeck() {
    if (!state.deckKey) return null;
    var lib = loadLibrary();
    for (var i = 0; i < lib.length; i++) {
      if (deckKeyOf(lib[i], i) === state.deckKey) return lib[i];
    }
    return null;
  }

  // Entrada a la PARTIDA (status 'playing'): cerrar overlay, ir al tablero y arrancar
  // el lado propio (pvp-sync). Los snapshots siguientes se le reenvían a pvp-sync.
  function enterMatch(room) {
    if (state._matchStarted) return;
    state._matchStarted = true;
    if (state._bridgeTimer) { clearTimeout(state._bridgeTimer); state._bridgeTimer = null; }   // el doc apareció → cancelar el aborto del puente
    var opp = room[state.role === 'host' ? 'guest' : 'host'];
    window._pvpOppName = (opp && opp.name) || '';   // para el historial
    // FORMATO de la partida online = el de la sala (puntos para ganar, mano inicial…).
    // Explícito y por sala: así una partida online NUNCA hereda el formato de la última local.
    state.fmt = room.fmt || 'standard';
    window._pvpFormat = state.fmt;
    window._pbSetGameFormat && window._pbSetGameFormat(state.fmt);
    if (state._resuming) {
      // Reconexión: sin pantalla VS — reconstruir desde pub (compartido) + priv (mi mano/cola)
      state._resuming = false;
      closeOverlay();
      window._pbBoardOnlineDirty = false;   // volvemos a la partida online: no sanear el tablero
      window.switchAppTab && window.switchAppTab('board');
      window._pvpResumeMatch && window._pvpResumeMatch(state.code, state.role, room);
      return;
    }
    // MIN de «buscando» (Daniel: el emparejamiento INSTANTÁNEO daba un salto sin delay). Garantiza
    // ~1,2s de búsqueda para que la animación de entrada del fondo (`pvpAccelIn`, 1s) TERMINE antes
    // de acelerar → sin discontinuidad. El «aceleron» (warp) lo hace SOLO renderVs (tras la espera).
    var since = state._searchStart ? (Date.now() - state._searchStart) : 9999;
    var wait = Math.max(0, 1200 - since);
    if (wait > 0 && document.querySelector('#pvp-content .pvp-searching-wrap')) {
      var t = document.querySelector('#pvp-content .pvp-search-title'); if (t) t.textContent = T('pvp.foundOpp');
      var e = document.getElementById('pvp-elapsed'); if (e) e.textContent = T('pvp.startingMatch');
    }
    setTimeout(function () {
      if (state._leaving || !state._matchStarted) return;
      // Arranque normal: VS (cortina) → moneda «quién empieza» en el tablero → reparto.
      // El tablero se monta DEBAJO (tapado por la cortina) y el reparto se difiere (deferCoin).
      // El mazo drafteado SOLO si ESTA partida es de draft (por el doc, no por un flag rancio):
      // así una partida estándar nunca usa un _draftDeck colgado de un puente que no cuajó.
      var deck = (room && (room.mode === 'draft' || room.isDraft)) ? (state._draftDeck || findMyDeck()) : findMyDeck();
      // Entramos a una partida online: el tablero lo monta _pvpStartMatch de cero, así que
      // NO hay que restaurar aquí la partida local (el saneado es para volver al tablero libre).
      window._pbBoardOnlineDirty = false;
      window.switchAppTab && window.switchAppTab('board');
      window._pvpStartMatch && window._pvpStartMatch(state.code, state.role, room, {
        cards: (deck && deck.cards) || [],
        energyTypes: (deck && deck.energyTypes) || []
      }, { deferCoin: true });
      renderVs(room);
    }, wait);
  }

  function leave() {
    var r = rooms();
    state._leaving = true;
    if (state._searching) { state._searching = false; stopQueueRefresh(); clearMyQueueEntry(); }
    // Partida ya terminada: la sala NO se toca (la limpia el servidor al procesar el
    // resultado). Borrarla aquí dejaría al rival sin su pantalla de fin.
    if (state._finished) { resetState(); state._leaving = false; exitToHub(); return; }
    if (r && state.code) {
      if (state.role === 'guest' && state.room && state.room.status === 'waiting') {
        // Invitado en lobby: libera el hueco, la sala sigue esperando.
        wrote(r.set(state.code, { guest: null }), 'leave-free').catch(function () {});
      } else {
        // Anfitrión, o partida ya conectada: la sala se cierra para ambos.
        wrote(r.remove(state.code), 'leave-remove').catch(function () {});
      }
    }
    resetState();
    state._leaving = false;
    exitToHub();
  }

  function resetState() {
    state._gen = (state._gen || 0) + 1;   // invalida los callbacks async en vuelo (join) → cancelar no revive la sesión
    stopPoll();
    stopSearchTimer();
    // Teardown de BÚSQUEDA (resetState también es la salida de las rutas de ERROR de onRoom, que NO
    // pasan por el bloque _searching): parar el refresco de cola, soltar la entrada _QUEUE si eras
    // host buscando, y limpiar los flags de flujo. Sin esto: _searching rancio deja colgado el lobby
    // de la siguiente sala amistosa; _resuming rancio hace que la siguiente partida se trate como
    // reconexión (sin VS/moneda); la entrada _QUEUE queda apuntando a una sala muerta hasta el TTL.
    stopQueueRefresh();
    if (state._qJoinT) { clearTimeout(state._qJoinT); state._qJoinT = 0; }
    state.fmt = 'standard'; window._pvpFormat = 'standard';
    if (state._searching) clearMyQueueEntry();
    state._searching = false;
    state._resuming = false;
    if (state.unsub) { try { state.unsub(); } catch (e) {} }
    state.unsub = null;
    state.code = null; state.role = null; state.room = null;
    state.deckKey = null; state._renderKey = null;
    state._matchStarted = false;
    state._finished = false;
    state._claimed = false; state._seatConfirmed = false; state._superseded = false; state._claimAt = 0;   // guard doble pestaña
    state._draftDeck = null; state._draftBridge = false;   // puente del draft
    if (state._bridgeTimer) { clearTimeout(state._bridgeTimer); state._bridgeTimer = null; }
    // Abortar y limpiar la transición VS / moneda si se sale a mitad (evita elementos colgados).
    state._vsActive = false;
    state._vsFillOpp = null;
    state._flowSuspended = false;
    ['pvp-vs-curtain', 'pvp-board-coin'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
    window._pvpMatchEnd && window._pvpMatchEnd();
    window._pvpRunDeal = null;   // el reparto lo re-expone pvp-sync en cada partida; sin sesión, no debe quedar vivo
    forget();
  }

  // Corta la conexión con la sala SIN tocar la UI: se usa al terminar la partida (el Fin ya
  // está pintado y no debe llegar nada más). CLAVE: la sala la borra el servidor poco después
  // del final → sin esto, ese borrado llegaba como snapshot null y pintaba «La sala se ha
  // cerrado» ENCIMA de la pantalla de victoria/derrota, en los dos jugadores.
  function quietDisconnect() {
    stopPoll();
    stopSearchTimer();
    stopQueueRefresh();
    if (state.unsub) { try { state.unsub(); } catch (e) {} state.unsub = null; }
    forget();
  }

  // ── Sincronización (watch + poll de seguridad, patrón draft-multi) ──
  function watch(code) {
    if (state.unsub) { try { state.unsub(); } catch (e) {} }
    var r = rooms();
    if (!r) return;
    state.unsub = r.watch(code, onRoom);
    startPoll();
  }
  function startPoll() {
    stopPoll();
    state.poll = setInterval(function () {
      var r = rooms();
      if (!r || !state.code) return;
      r.get(state.code).then(function (room) {
        if (room !== undefined) onRoom(room);
      }).catch(function () {});
    }, POLL_MS);
  }
  function stopPoll() {
    if (state.poll) { clearInterval(state.poll); state.poll = null; }
  }

  function roomKeyOf(room) {
    // Solo los campos que se pintan (excluye timestamps: cambian en cada write).
    function slim(p) { return p ? { u: p.uid, n: p.name, a: p.avatar, d: p.deck || null } : null; }
    return JSON.stringify({ s: room.status, h: slim(room.host), g: slim(room.guest) });
  }

  function onRoom(room) {
    if (state._leaving) return;
    // Partida terminada (Fin ya pintado): la sala puede desaparecer o cambiar por su cuenta —
    // eso NUNCA debe pintar nada encima del resultado.
    if (state._finished) return;
    if (room === undefined) { // error de red/permisos
      dlog('◆ watch error');
      // Ya en partida: un fallo de red se resuelve solo (reconexión/presencia). Sacar aquí un
      // pop-up de error tapaba el tablero a mitad de partida.
      if (state._matchStarted) { dlog('◆ error de red en partida: silencio'); return; }
      resetState();
      renderError(T('pvp.error'));
      return;
    }
    if (room === null) {      // la sala ya no existe = cancelada
      // Puente del DRAFT: el invitado puede empezar a vigilar el doc de partida ANTES de que el
      // host lo cree → el primer snapshot es null. No es cancelación: esperamos a que aparezca.
      if (state._draftBridge && !state._matchStarted) { dlog('◆ puente draft: esperando doc de partida'); return; }
      dlog('◆ sala borrada');
      // Con la partida EN MARCHA (o recién terminada) la sala desaparece por sí sola: el
      // servidor la borra al procesar el resultado. No es una acción del usuario → se corta
      // la conexión en silencio, sin pop-ups. (Una partida que quedara colgada la cierra la
      // presencia: sin latidos del rival, victoria a los 60s.)
      if (state._matchStarted) { state._finished = true; quietDisconnect(); return; }
      resetState();
      renderError(T('pvp.cancelled'));
      return;
    }
    state.room = room;
    // ── Guard de doble pestaña: el asiento (tabs.{rol}) es de UNA pestaña ──
    // Confirmado = he visto MI id en la sala. Ventana de gracia de 5s tras reclamar
    // (mi escritura puede estar en vuelo y el snapshot traer el id viejo — eso no es
    // un takeover). Pasada la gracia, un id ajeno = otra pestaña juega → me silencio.
    if (state.role && !state._superseded) {
      var seat = room.tabs ? room.tabs[state.role] : null;
      if (seat === TAB_ID) { state._seatConfirmed = true; state._claimed = true; }
      else if (seat && (state._seatConfirmed || (state._claimed && Date.now() - (state._claimAt || 0) > 5000))) { supersede(); return; }
      else if (!state._claimed) { state._claimed = true; state._claimAt = Date.now(); claimSeat(); }
    }
    // Buscando partida: mantener la vista de búsqueda hasta que entre un rival
    if (state._searching) {
      if (room.status === 'waiting' && !(room.guest && room.guest.uid)) return;
      state._searching = false;
      stopSearchTimer();   // la búsqueda cede a la partida (auto-arranque del host) → parar el cronómetro
      stopQueueRefresh();  // (si no, el setInterval de 1s corre TODA la partida sobre un #pvp-elapsed oculto)
      clearMyQueueEntry();
    }
    // Partida en marcha: entrar (una vez) y reenviar cada snapshot al motor de sync
    if (room.status === 'playing') {
      if (state._vsFillOpp) state._vsFillOpp(room);   // emblemas del rival que llegaron con la cortina ya en pantalla
      enterMatch(room);
      window._pvpOnRoom && window._pvpOnRoom(room);
      return;
    }
    // Partida TERMINADA: si estoy dentro, el sync muestra el overlay; si llego de nuevas, sala cerrada
    if (room.status === 'over') {
      if (state._matchStarted) { window._pvpOnRoom && window._pvpOnRoom(room); }
      else { resetState(); renderError(T('pvp.cancelled')); }
      return;
    }
    // Auto-arranque: el host, con AMBOS mazos ya en la sala (el activo de cada uno),
    // tira la moneda y arranca la partida — sin botón «Empezar».
    if (state.role === 'host' && room.status === 'waiting' &&
        room.host && room.host.deck && room.guest && room.guest.deck) {
      startMatch();
      return;
    }
    // Puente del DRAFT: mientras la sala está en 'waiting' (host creado / invitado uniéndose) NO
    // mostramos el lobby estándar (código, «esperando rival»…) — el arranque es automático y va
    // por debajo del handoff. Solo suprime la UI de espera; el auto-arranque de arriba SÍ corre.
    if (state._draftBridge && !state._matchStarted && room.status === 'waiting') return;
    var key = roomKeyOf(room);
    if (key === state._renderKey) return;
    state._renderKey = key;
    dlog('◆ ' + room.status + ' h:' + !!(room.host && room.host.deck) + ' g:' + !!(room.guest && room.guest.deck));
    if (room.status === 'connected') { renderConnected(room); return; }
    // Emparejado por cola (sala pública) → «empezando»; sala amistosa → lobby con código.
    if (room.isPublic) renderStarting(room);
    else renderLobby(room);
  }

  // ── Doble pestaña: silenciar ESTA pestaña (la otra juega) ──
  function supersede() {
    if (state._superseded) return;
    state._superseded = true;
    dlog('◆ asiento reclamado por otra pestaña');
    stopPoll();
    stopSearchTimer();
    stopQueueRefresh();
    if (state.unsub) { try { state.unsub(); } catch (e) {} state.unsub = null; }
    // Abortar VS/moneda si estaban a mitad (como resetState), SIN tocar la sala.
    state._vsActive = false;
    state._vsFillOpp = null;
    ['pvp-vs-curtain', 'pvp-board-coin'].forEach(function (id) { var el = document.getElementById(id); if (el) el.remove(); });
    // Parar TODO el sync (latido/publicación/reloj) — esta pestaña ya no escribe nada.
    window._pvpMatchEnd && window._pvpMatchEnd();
    renderSuperseded();
  }
  function renderSuperseded() {
    state.view = 'superseded';
    openOverlay();
    setImmersive(false);
    renderContent(
      '<div class="pvp-h">' + esc(T('pvp.otherTab')) + '</div>' +
      '<p class="pvp-sub">' + esc(T('pvp.otherTabHint')) + '</p>' +
      '<button id="pvp-usehere" class="pvp-opt primary">' + esc(T('pvp.useHere')) + '</button>' +
      '<button id="pvp-ot-exit" class="pvp-opt subtle">' + esc(T('pvp.leave')) + '</button>'
    );
    on('pvp-usehere', reclaimHere);
    on('pvp-ot-exit', supersededExit);
  }
  function reclaimHere() {
    // Re-reclamar el asiento AQUÍ: la otra pestaña verá el cambio y se silenciará ella.
    var wasPlaying = !!(state.room && state.room.status === 'playing' && state.room.pub);
    state._superseded = false;
    state._seatConfirmed = false;
    state._claimed = true;
    state._claimAt = Date.now();
    state._matchStarted = false;
    state._resuming = wasPlaying;   // partida en marcha → reconstruir desde pub+priv
    claimSeat();
    watch(state.code);
    renderLoading(T('pvp.joining'));
  }
  function supersededExit() {
    // Salir SIN tocar la sala (la otra pestaña sigue jugando) y SIN forget():
    // el ROOM_KEY es localStorage COMPARTIDO — la pestaña que juega lo necesita si recarga.
    state._superseded = false;
    state._claimed = false; state._seatConfirmed = false; state._claimAt = 0;
    state.code = null; state.role = null; state.room = null;
    state.deckKey = null; state._renderKey = null;
    state._matchStarted = false; state._resuming = false;
    exitToHub();
  }

  // ── Reconexión: volver SOLO a la partida, o soltarla en silencio ──
  // REGLA DURA (Daniel, 2026-08-13): entrar a la web NO saca pop-ups. Nada de «¿reanudar la
  // sala?» (y menos el menú online detrás al decir que no): si la partida sigue viva se vuelve
  // a ella automáticamente; si no, la sala deja de existir sin preguntar nada.
  // Ventana de una partida en marcha. GENEROSA a propósito (5 min ≫ LOSS_MS 60s): dentro de
  // ella se vuelve a la partida y decide el propio motor (juegas, o ganas por desconexión a los
  // 60s); solo se borra lo que ya es un cadáver seguro. Ser tacaño aquí borraría salas donde el
  // rival SIGUE dentro (una pestaña de fondo puede tener el latido congelado).
  var ALIVE_MS = 300000;
  function roomAlive(room) {
    var s = (room && room.seen) || {};
    var last = Math.max(Number(s.host) || 0, Number(s.guest) || 0);
    // Sin latido puede ser una partida RECIÉN empezada (aún no ha latido nadie) o una sala
    // vieja abandonada. Se distinguen por la EDAD de la sala (expireAt se escribe al crearla,
    // +TTL): una sala sin latidos y con horas encima NO se reanuda. Antes cualquier sala sin
    // latido se daba por viva, y al abrir la web se reanudaba sola una partida de hace días.
    if (!last) { var born = expireMs(room) - TTL_MS; return !born || (Date.now() - born) < ALIVE_MS; }
    return (Date.now() - last) < ALIVE_MS;
  }
  // Edad de una sala que aún no ha empezado. No hay latidos en el lobby, pero `expireAt` se
  // escribe al crearla (+TTL_MS) → la resta da cuándo se creó. Un lobby privado se considera
  // «en curso» durante LOBBY_MAX_MS; más viejo = lo creaste y lo olvidaste.
  var TTL_MS = 24 * 3600 * 1000, LOBBY_MAX_MS = 3600000;   // 1 h
  function expireMs(room) {
    var e = room && room.expireAt;
    if (!e) return 0;
    if (typeof e.toMillis === 'function') return e.toMillis();          // Firestore Timestamp
    if (typeof e.seconds === 'number') return e.seconds * 1000;         // Timestamp serializado
    if (typeof e === 'number') return e;
    var t = Date.parse(e);                                              // Date → ISO (JSON)
    return isNaN(t) ? 0 : t;
  }
  function lobbyRecent(room) {
    var exp = expireMs(room);
    if (!exp) return true;   // sin dato → no la matamos
    return (exp - TTL_MS) > (Date.now() - LOBBY_MAX_MS);
  }
  // Retomar una sesión guardada: estado de sala limpio (incluido el guard de doble pestaña, que
  // arranca de cero: ya hemos decidido arriba que el asiento es nuestro o está abandonado) y
  // _renderKey a null para que el primer snapshot SÍ pinte.
  function beginSession(code, role) {
    state.code = code; state.role = role;
    state._renderKey = null;
    state._superseded = false; state._seatConfirmed = false; state._claimed = false; state._claimAt = 0;
    openOverlay();
    remember();
  }
  function reconnect() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null'); } catch (e) {}
    if (!saved || !saved.code) return;
    // Cuenta CUALQUIERA (incl. anónima): una partida venida del DRAFT puede tener invitado anónimo
    // (por código). Su uid anónimo persiste tras recargar y casa con guest.uid del doc → puede
    // reanudar. En estándar los uid del doc son siempre reales, así que un anónimo no casa (role=null).
    var a = acct();
    if (!a) { return; } // sin sesión no hay nada que reanudar
    var r = rooms();
    if (!r) return;
    var gen = state._gen;
    var reconnectLookup;
    try { reconnectLookup = r.get(saved.code); } catch (e) { return; }
    reconnectPending++;
    Promise.resolve(reconnectLookup).then(function (room) {
      // Si el usuario ya inició OTRA sesión mientras este get async resolvía (p.ej. «Jugar online»,
      // que tarda lo mismo en resolver su create), NO pisar su estado con la sala vieja: ni `code`
      // ni `_resuming`, o la partida NUEVA se trataría como reconexión y entraría sin `pub`.
      if (state.code || state._searching || state._gen !== gen) return;
      if (!room) { forget(); return; }
      // Sala TERMINADA: no ofrecer reanudar — solo olvidarla. El BORRADO ya no lo hace
      // el cliente: la sala terminada es la EVIDENCIA de las maestrías (claims en priv +
      // pub) y la borra la Cloud Function tras procesarla (o el TTL de 24h como red).
      // Borrarla aquí destruía la partida si la función estaba caída en ese momento.
      if (room.status === 'over') { forget(); return; }
      var role = (room.host && room.host.uid === a.uid) ? 'host'
        : (room.guest && room.guest.uid === a.uid) ? 'guest' : null;
      if (!role) { forget(); return; }
      // OTRA pestaña está jugando MI lado ahora mismo (asiento ajeno + latido fresco): esta
      // pestaña NO se mete — ni entra, ni escribe, ni suelta la sala. Antes esto no podía pasar
      // (el aviso de reanudar no vigilaba la sala); ahora que se vuelve solo, sin este guard una
      // segunda pestaña le robaría el asiento a la que está jugando y la echaría a mitad de
      // partida. Recargar la MISMA pestaña conserva TAB_ID (sessionStorage) → sí vuelve.
      if (seatBusy(room, role)) return;
      // Repone el mazo ACTIVO (state.deckKey se pierde al recargar). Lo necesitan el arranque
      // desde el lobby Y «Usar esta pestaña» del guard de doble pestaña, que entra por la vía
      // normal de enterMatch y busca el mazo con findMyDeck().
      var ready = activeDeckReady();
      // Partida EN MARCHA y con señal reciente → volver a ella AUTOMÁTICAMENTE (recargar no debe
      // sacarte de la partida; para salir está Rendirse dentro).
      if (room.status === 'playing' && roomAlive(room)) {
        beginSession(saved.code, role);
        state._resuming = true;   // reconstruir desde pub+priv, no re-arrancar
        renderLoading(T('pvp.joining'));   // PRIMERO pintar, LUEGO suscribir: si no, el 1er snapshot
        watch(state.code);                 // pinta y el «Conectando…» lo tapa (y el dedupe por firma lo deja clavado)
        return;
      }
      // ── EXCEPCIÓN: sala PRIVADA (por código) que aún no ha empezado ──
      // Es una partida con un amigo EN CURSO: la sala NO se toca y vuelves a ella sola. Soltarla
      // sería matar el código que ya has compartido, y además dejaría un lobby zombi: quien
      // entrase con el código se quedaría esperando para siempre (el arranque lo dispara el
      // host DESDE el lobby, así que si nadie vigila la sala no empieza nunca).
      if (room.status === 'waiting' && !room.isPublic && room.mode !== 'draft' && lobbyRecent(room)) {
        if (ready.ok) {
          beginSession(saved.code, role);
          renderLoading(T('pvp.joining'));
          watch(state.code);   // onRoom pinta el lobby (y auto-arranca si el rival ya está listo)
          // El mazo activo puede haber cambiado desde que creaste la sala → refresca el tuyo en
          // el doc (si no, el rival vería uno y jugarías con otro). Va DESPUÉS de watch para que
          // el snapshot que provoca esta escritura ya lo reciba esta sesión.
          var patch = {}; patch[role] = { deck: deckPayload(ready.deck) };
          wrote(r.set(saved.code, patch), 'lobby-deck').catch(function () {});
          return;
        }
        // Sin mazo activo válido no puedes jugar → cae a soltarla (no dejamos un lobby inservible).
      }
      // Sala de COLA pública sin empezar (nadie tiene tu código), lobby privado abandonado, o
      // partida sin señal desde hace rato → soltarla en SILENCIO: ni overlay, ni menú, ni aviso.
      // Una partida muerta se borra entera; un lobby lo borra el host y el invitado solo libera
      // su hueco (el host puede seguir esperando en el suyo).
      dropRoom(r, saved.code, role, room.status === 'playing');
    }).catch(function () {}).then(function () {
      reconnectPending = Math.max(0, reconnectPending - 1);
    });
  }

  // ── Entrada pública ──
  function openPvp() {
    if (window.pbFlag && !window.pbFlag('pvp')) return;
    if (state._draftBridge && !state._matchStarted) resetState();   // soltar un puente de draft colgado
    window._pbUnlockAudio && window._pbUnlockAudio();
    openOverlay();
    if (state.code && state.room) {
      if (state.room.status === 'connected') renderConnected(state.room);
      else renderLobby(state.room);
    } else {
      renderMenu();
    }
  }
  window._pbOpenPvp = openPvp;

  // «Jugar online» del hub → cola directa (sin menú ni picker). Gate de cuenta y de mazo.
  function startQueue() {
    if (window.pbFlag && !window.pbFlag('pvp')) return;
    if (state._draftBridge && !state._matchStarted) resetState();   // soltar un puente de draft colgado
    window._pbUnlockAudio && window._pbUnlockAudio();
    openOverlay();
    // Reconexión: si ya hay sala/partida en curso, respétala (no arrancar otra cola).
    if (state.code && state.room) { openPvp(); return; }
    if (!realAcct()) { renderMenu(); return; }        // pide iniciar sesión
    var ready = activeDeckReady();
    if (!ready.ok) { renderDeckGate(ready); return; } // mazo activo no legal
    startSearch();
  }
  window._pvpStartQueue = function (opts) { state.fmt = (opts && opts.format) || 'standard'; window._pvpFormat = state.fmt; return startQueue(); };

  // «Partida amistosa» del hub → crear sala / unirse por código. Mismo gate.
  function openFriendly() {
    if (window.pbFlag && !window.pbFlag('pvp')) return;
    if (state._draftBridge && !state._matchStarted) resetState();   // soltar un puente de draft colgado (como openPvp/startQueue)
    window._pbUnlockAudio && window._pbUnlockAudio();
    openOverlay();
    if (state.code && state.room) { openPvp(); return; }
    if (!realAcct()) { renderMenu(); return; }
    var ready = activeDeckReady();
    if (!ready.ok) { renderDeckGate(ready); return; }
    renderFriendly();
  }
  window._pvpOpenFriendly = function (opts) { state.fmt = (opts && opts.format) || 'standard'; window._pvpFormat = state.fmt; return openFriendly(); };

  // ── Init ──
  function init() {
    var flagOn = !(window.pbFlag && !window.pbFlag('pvp'));
    if (!flagOn) return;
    // Reconexión cuando la sesión esté resuelta (el módulo Firebase carga diferido).
    if (window.pbAuth && window.pbAuth.user) reconnect();
    else {
      var once = function () { window.removeEventListener('pb-auth', once); reconnect(); };
      window.addEventListener('pb-auth', once);
    }
    // Cambios de sesión: si pierdo la cuenta estando en sala, salgo limpio.
    window.addEventListener('pb-auth', function () {
      if (state.code && !realAcct()) { leave(); }
      else if (state.view === 'menu') renderMenu();
    });
    // Cambio de idioma: re-pinta la vista actual (menos 'join', que tiene texto escrito).
    window.addEventListener('langchange', function () {
      var ov = document.getElementById('pvp-overlay');
      if (!ov || ov.style.display === 'none') return;
      if (state.view === 'join') return;
      if (state.view === 'menu') renderMenu();
      else if (state.view === 'picker') renderPicker();
      else if (state.view === 'lobby' && state.room) renderLobby(state.room);
      else if (state.view === 'connected' && state.room) renderConnected(state.room);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // Hooks de test (patrón draft-multi)
  window._pvpState = function () { return state; };
  window._pvpBoardCoinTest = pvpBoardCoin;   // test: verificar alive-guard + nace-suspendido de la moneda
  window._pvpOpen = openPvp;
  window._pvpCreate = doCreate;
  window._pvpJoinView = renderJoin;
  window._pvpJoin = doJoin;
  window._pvpPickDeck = pickDeck;
  window._pvpRenderPicker = renderPicker;   // hook de test (la lista de mazos ya no cuelga del lobby)
  window._pvpStart = startMatch;
  window._pvpLeave = leave;
  window._pvpSync = onRoom;
  window._pvpValidate = validateDeck;
  // ── PUENTE desde el DRAFT online: arranca una partida estándar con el mazo drafteado ──
  // El draft (draft-multi.js) llama aquí cuando ambos dan «Listo». El HOST ya creó el doc de
  // partida (pvpGames, mismo code, status:'playing', coin, mode:'draft', energía de cada lado);
  // aquí solo fijamos el estado + el mazo drafteado y VIGILAMOS el doc → onRoom verá 'playing'
  // y entrará a la partida (VS → moneda → reparto) REUSANDO enterMatch, sin duplicar nada.
  window._pvpEnterFromDraft = function (code, role, myDeck) {
    if (!rooms()) { window.pbToast && window.pbToast(T('pvp.error')); return false; }
    resetState();                        // limpia cualquier sesión PvP previa (unsub, flags…)
    state.code = code; state.role = role;
    state._draftDeck = myDeck || null;   // enterMatch usará ESTE mazo (no la biblioteca)
    state._draftBridge = true;           // tolera el null inicial mientras el host crea el doc
    state._searchStart = 0;              // sin pantalla de «buscando» (enterMatch entra directo al VS)
    remember();                          // la reconexión la OWNea ya PvP (doc pvpGames)
    watch(code);
    state._embSent = false;              // draft-multi crea el bloque de jugador SIN emblemas
    publishEmblems();
    // Red de seguridad: si el doc de partida NUNCA aparece (el host falló al crearlo), no colgar
    // en silencio → tras 15s abortamos con aviso y volvemos al hub (esto también limpia los flags).
    if (state._bridgeTimer) clearTimeout(state._bridgeTimer);
    state._bridgeTimer = setTimeout(function () {
      if (state._matchStarted) return;
      dlog('◆ puente draft: el doc de partida no apareció en 15s → abortar');
      resetState();
      window.pbToast && window.pbToast(T('pvp.error'));
      if (window.switchAppTab) window.switchAppTab('jugar');
    }, 15000);
    return true;
  };
  window._pvpReconnect = reconnect;
  // Hook de test: foto del estado de la sesión (la cola necesita ver quién espera y en qué sala).
  window._pvpDbgState = function () {
    return { view: state.view, code: state.code, role: state.role, fmt: state.fmt,
             searching: !!state._searching, matchStarted: !!state._matchStarted };
  };
  window._pvpSearch = startSearch;
  window._pvpCancelSearch = cancelSearch;
  // Hook de test: pinta la pantalla de búsqueda tal cual (sin tocar Firebase).
  window._pvpRenderSearching = function () { openOverlay(); renderSearching(); };
  // Fin de partida: olvidar la reconexión YA (no hay nada que reanudar de una partida
  // terminada → sin prompts fantasma al recargar). La sala la borra quien sale.
  window._pvpMatchOverCleanup = function () { forget(); };

  // ── Navegabilidad en partida (petición de Daniel): la nav queda visible y funcional;
  // al ir a Cartas/Mazos el flujo PvP (búsqueda/VS/fin) se SUSPENDE (oculta) pero la sesión
  // sigue viva, y al volver a «Jugar» se RESTAURA. switchAppTab (cards-view.js) lo llama.
  var FLOW_IDS = ['pvp-overlay', 'pvp-vs-curtain', 'pvp-board-coin'];
  window._pvpFlowSuspend = function () {
    state._flowSuspended = true;   // persistente: los overlays creados DESPUÉS (moneda/cortina) nacen suspendidos
    FLOW_IDS.forEach(function (id) { var el = document.getElementById(id); if (el) el.classList.add('pvp-suspended'); });
  };
  window._pvpFlowRestore = function () {
    state._flowSuspended = false;
    FLOW_IDS.forEach(function (id) { var el = document.getElementById(id); if (el) el.classList.remove('pvp-suspended'); });
  };
  // ¿Hay sesión PvP viva (búsqueda o partida)? → «Jugar» debe mostrar la partida, no el hub.
  window._pvpSessionLive = function () { return !!state.code; };
  // Repinta los contadores de la búsqueda cuando llega presencia real (presence.js).
  window.addEventListener('pb-presence', function () { if (state.view === 'searching') paintCounters(); });
})();
