/* ══════════════════════════════════════════════════════════════
   draft-multi.js — Multijugador del modo Draft
   TANDA 1 (sala + conexión): lobby en tiempo real sobre Firestore.
   Objetivo: dos dispositivos se ven en una sala y el anfitrión "empieza".
   El draft sincronizado de verdad llega en la Tanda 2.

   Depende de:
     · window.pbRooms      (index.html, módulo Firebase: create/get/set/remove/watch)
     · window.pbAuth        (signInAnonymous para el invitado, current() para el uid)
     · window.pbAccount     (auth.js: {uid, anon, name, friendCode} o null)
     · window.t / pbToast / pbOpenLogin / sfx (shared.js, auth.js, main.js)

   Decisión de diseño (Daniel): el CREADOR necesita cuenta; el INVITADO entra
   solo con código + nombre (sesión anónima por debajo). Estética: pestaña Cartas.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var T = function (k, v) { return window.t ? window.t(k, v) : k; };
  var ROOM_KEY = 'pocketboard_draft_room_v1';   // {code, role, name} para reconectar

  var state = {
    code: null,        // código de la sala
    role: null,        // 'host' | 'guest'
    name: '',          // mi nombre en esta sala
    room: null,        // último snapshot
    unsub: null,       // cancelar el listener de Firestore
    _hadOpp: false,    // para detectar que el rival se va (solo relevante al anfitrión)
    _gen: 0,           // generación de sesión: cleanup la incrementa → invalida el join async en vuelo
    _surrenderPending: false,
    _surrenderAck: false
  };

  function roomsReady() { return !!(window.pbRooms); }
  function myUid() { var u = window.pbAuth && window.pbAuth.current && window.pbAuth.current(); return u ? u.uid : null; }
  function hasAccount() { var a = window.pbAccount && window.pbAccount(); return !!(a && !a.anon); }

  // Código legible: 4 letras + 2 dígitos, sin caracteres ambiguos (O/0/I/1).
  function genCode() {
    var L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', N = '23456789', s = '';
    for (var i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
    for (var j = 0; j < 2; j++) s += N[Math.floor(Math.random() * N.length)];
    return s;
  }

  // Asegura una sesión (la del invitado es anónima). Devuelve el user de Firebase.
  function ensureAuth() {
    var u = window.pbAuth && window.pbAuth.current && window.pbAuth.current();
    if (u) return Promise.resolve(u);
    if (window.pbAuth && window.pbAuth.signInAnonymous)
      return window.pbAuth.signInAnonymous().then(function (c) { return c && c.user; });
    return Promise.reject(new Error('no-auth'));
  }

  function remember() {
    try { localStorage.setItem(ROOM_KEY, JSON.stringify({ code: state.code, role: state.role, name: state.name })); } catch (e) {}
  }
  function forget() { try { localStorage.removeItem(ROOM_KEY); } catch (e) {} }

  var dlog = function () {};
  function wrote(p, label) {                         // envuelve una escritura y reporta fallos
    return (p && p.catch) ? p.catch(function (e) { dlog('✗ ESCRITURA ' + label + ': ' + (e && (e.code || e.message) || e)); }) : p;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── Perfil del jugador en el draft (avatar + nombre + código de amigo) ──
  var SVG_COPY = '<svg viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  // "?" de info (sin círculo propio: el botón ya hace de círculo).
  var SVG_QMARK = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9.4 9.2a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.2-2.6 4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="17.4" r="1.3" fill="currentColor"/></svg>';
  // Título "Jugar con un amigo" con un "?" que explica cómo funciona el draft sincronizado.
  function lobbyTitle() {
    return '<div class="dr-lobby-h dr-lobby-h--info">' + esc(T('draft.mpTitle')) +
      '<span class="dr-mp-info-wrap">' +
        '<button class="dr-mp-info-btn" type="button" aria-label="' + esc(T('draft.mpInfo')) + '">' + SVG_QMARK + '</button>' +
        '<div class="dr-mp-info-pop">' + esc(T('draft.mpInfoText')) + '</div>' +
      '</span>' +
    '</div>';
  }
  function copyToClipboard(txt, toastKey) {
    if (!txt) return;
    var done = function () { window.pbToast && window.pbToast(T(toastKey || 'draft.mpCopied')); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
      } catch (e) {}
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(done, fallback); return; } } catch (e2) {}
    fallback();
  }
  // Avatar (icono de cuenta) con aro de color p1/p2; si no hay, inicial del nombre.
  // `src` = URL del avatar (icono propio o foto de Google), igual en ambos dispositivos.
  function avatarChip(src, cls, name) {
    if (src) return '<span class="dr-mp-av ' + cls + '"><img src="' + esc(src) + '" alt="" referrerpolicy="no-referrer"></span>';
    var ini = ((name || '').trim().charAt(0) || '?').toUpperCase();
    return '<span class="dr-mp-av letter ' + cls + '">' + esc(ini) + '</span>';
  }
  // Línea de código de amigo con botón de copiar (el copiar se gestiona por delegación).
  function fcLine(fc) {
    if (!fc) return '';
    return '<span class="dr-mp-fc"><span class="dr-mp-fc-code">' + esc(fc) + '</span>' +
      '<button class="dr-mp-fc-copy" type="button" data-fc="' + esc(fc) + '" title="' + esc(T('draft.mpCopyFc')) + '" aria-label="' + esc(T('draft.mpCopyFc')) + '">' + SVG_COPY + '</button></span>';
  }
  // Mi propio perfil (live) para mostrarme en el lobby.
  function myProfile() {
    var a = window.pbAccount && window.pbAccount();
    return { avatar: (a && a.avatar) || '', name: (a && a.name) || '', friendCode: (a && !a.anon && a.friendCode) || '' };
  }

  // ════════════════════════ OVERLAY ════════════════════════
  function open() {
    var ov = $('dr-lobby'); if (!ov) return;
    ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false');
  }
  function close() {
    // Cierre suave mientras se crea/une (state.code aún null): invalida el create/join async en vuelo
    // → al resolver NO revive la sesión cerrada. Con code activo (drafting) no se toca _gen.
    if (!state.code) state._gen = (state._gen || 0) + 1;
    var ov = $('dr-lobby'); if (!ov) return;
    ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true');
  }
  function renderContent(html) { var c = $('dr-lobby-content'); if (c) c.innerHTML = html; }
  function errBox(msg) {
    return '<div class="dr-lobby-h">' + esc(msg) + '</div>' +
      '<button id="dr-lobby-back" class="dr-lobby-btn subtle">' + esc(T('draft.mpBack')) + '</button>';
  }

  // ════════════════════════ SELECTOR (Crear / Unirse) ════════════════════════
  function openChooser() {
    if (state.code) { open(); return; }   // ya estás en una sala → mostrarla
    resetForNewSession();                  // sesión anterior entregada/abandonada → sobre limpio, sin #dr-mp-end colgando
    open();
    state._lobbyView = 'chooser';
    renderContent(
      lobbyTitle() +
      '<div class="dr-lobby-note" style="margin:0 4px 16px">' + esc(T('draft.mpChooseHint')) + '</div>' +
      '<button id="dr-lobby-create" class="dr-lobby-btn primary" type="button">' + esc(T('draft.mpCreate')) + '</button>' +
      '<button id="dr-lobby-join" class="dr-lobby-btn" type="button">' + esc(T('draft.mpJoin')) + '</button>'
    );
    var c = $('dr-lobby-create'); if (c) c.addEventListener('click', openCreate);
    var j = $('dr-lobby-join'); if (j) j.addEventListener('click', openJoin);
  }

  // ════════════════════════ CREAR ════════════════════════
  function openCreate() {
    if (!roomsReady()) { window.pbToast && window.pbToast(T('draft.mpError')); return; }
    if (!hasAccount()) {     // el creador necesita cuenta → abrir login
      window.pbToast && window.pbToast(T('draft.mpLoginNeeded'));
      window.pbOpenLogin && window.pbOpenLogin();
      return;
    }
    open();
    renderContent('<div class="dr-lobby-h">' + esc(T('draft.mpCreating')) + '</div><div class="dr-lobby-spin big"></div>');
    var acct = window.pbAccount();
    var gen = state._gen;   // si cierras «Creando…» (close bumpea _gen), el create async no revive la sesión
    var code = genCode();
    var data = {
      status: 'waiting',
      pool: (window._draftPoolVariant ? window._draftPoolVariant() : 'full'),
      host: { uid: acct.uid, name: acct.name || T('draft.mpYou'), friendCode: acct.friendCode || '', avatar: acct.avatar || '' },
      guest: null,
      expireAt: ttl()
    };
    window.pbRooms.create(code, data).then(function () {
      if (state._gen !== gen) { window.pbRooms.remove(code).catch(function () {}); return; }   // cerrado durante la creación → borrar sala huérfana
      state.code = code; state.role = 'host'; state.name = data.host.name; state._hadOpp = false;
      remember();
      dlog('sala creada ' + code + ' (host)');
      watch(code);
    }).catch(function (e) { dlog('✗ crear: ' + (e && (e.code || e.message) || e)); renderContent(errBox(T('draft.mpError'))); });
  }

  // ════════════════════════ UNIRSE ════════════════════════
  function openJoin() {
    if (!roomsReady()) { window.pbToast && window.pbToast(T('draft.mpError')); return; }
    open();
    state._lobbyView = 'join';
    var acct = window.pbAccount && window.pbAccount();
    var defName = (acct && !acct.anon && acct.name) ? acct.name : '';
    renderContent(
      '<div class="dr-lobby-h">' + esc(T('draft.mpJoin')) + '</div>' +
      '<div class="dr-lobby-form">' +
        '<input id="dr-lobby-code" class="dr-lobby-in code" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="' + esc(T('draft.mpEnterCode')) + '">' +
        '<input id="dr-lobby-name" class="dr-lobby-in" maxlength="20" autocomplete="off" placeholder="' + esc(T('draft.mpYourName')) + '" value="' + esc(defName) + '">' +
        '<button id="dr-lobby-join-go" class="dr-lobby-btn primary">' + esc(T('draft.mpJoinBtn')) + '</button>' +
        '<div id="dr-lobby-join-err" class="dr-lobby-err"></div>' +
      '</div>' +
      '<button id="dr-lobby-cancel" class="dr-lobby-btn subtle">' + esc(T('draft.mpBack')) + '</button>'
    );
    var codeI = $('dr-lobby-code');
    if (codeI) {
      try { codeI.focus(); } catch (e) {}
      codeI.addEventListener('input', function () { codeI.value = codeI.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
      codeI.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    }
    var nameI = $('dr-lobby-name');
    if (nameI) nameI.addEventListener('keydown', function (e) { if (e.key === 'Enter') doJoin(); });
    var go = $('dr-lobby-join-go'); if (go) go.addEventListener('click', doJoin);
    var cx = $('dr-lobby-cancel'); if (cx) cx.addEventListener('click', close);
  }

  function doJoin() {
    var code = (($('dr-lobby-code') && $('dr-lobby-code').value) || '').trim().toUpperCase();
    var name = (($('dr-lobby-name') && $('dr-lobby-name').value) || '').trim().slice(0, 20) || T('draft.mpGuest');
    var errEl = $('dr-lobby-join-err');
    var setErr = function (m) { if (errEl) errEl.textContent = m; };
    var go = $('dr-lobby-join-go');
    if (code.length < 4) { setErr(T('draft.mpNotFound')); return; }
    setErr(''); if (go) go.classList.add('busy');
    window._pbUnlockAudio && window._pbUnlockAudio();   // gesto del invitado → desbloquea su audio (si el sobre se auto-abre)
    warmTick();                                          // prepara el bip del timer (AudioContext) con el gesto
    var gen = state._gen;   // si cierras/vuelves atrás durante el join (close bumpea _gen), no revivir la sesión
    ensureAuth()
      .then(function () { return window.pbRooms.get(code); })
      .then(function (room) {
        if (state._gen !== gen) return;   // cerrado durante el join → abortar
        if (!room) { setErr(T('draft.mpNotFound')); if (go) go.classList.remove('busy'); return; }
        if (room.status !== 'waiting') { setErr(T('draft.mpClosed')); if (go) go.classList.remove('busy'); return; }
        if (room.guest && room.guest.uid && room.guest.uid !== myUid()) { setErr(T('draft.mpFull')); if (go) go.classList.remove('busy'); return; }
        // Si el invitado está logueado (no anónimo), lleva también su avatar y código de amigo.
        var gacct = window.pbAccount && window.pbAccount(), gReal = gacct && !gacct.anon;
        var guestObj = { uid: myUid(), name: name, avatar: (gReal && gacct.avatar) || '', friendCode: (gReal && gacct.friendCode) || '' };
        return window.pbRooms.set(code, { guest: guestObj }).then(function () {
          if (state._gen !== gen) { window.pbRooms.set(code, { guest: null, status: 'waiting' }).catch(function () {}); return; }   // cerrado tras despachar el guest → soltar el hueco + no revivir
          state.code = code; state.role = 'guest'; state.name = name; state._hadOpp = true;
          remember();
          dlog('unido a ' + code + ' (guest)');
          watch(code);
        });
      })
      .catch(function (e) { dlog('✗ unirse: ' + (e && (e.code || e.message) || e)); setErr(T('draft.mpError')); if (go) go.classList.remove('busy'); });
  }

  // ════════════════════ COLA ONLINE (matchmaking aleatorio) ════════════════════
  // Draft ONLINE = cola pública en draftGames/_QUEUE (claim de sala, modelo de la de Estándar).
  // Pool SIEMPRE completo (Daniel: el meta crearía más colas). Al emparejar, el host AUTO-arranca
  // el drafteo (sin botón "Empezar"). Todo gateado en state._queueMode → el flujo por-código intacto.
  var DQUEUE = '_QUEUE', DQUEUE_FRESH_MS = 60000;
  function queueAcct() { var a = window.pbAccount && window.pbAccount(); return (a && !a.anon) ? a : null; }
  function qCounters() {
    if (window.pbPresenceVals) return window.pbPresenceVals();
    var pr = window._pbPresence;
    return (pr && pr.online != null) ? {
      online: pr.online,
      inMatch: pr.inMatch == null ? 0 : pr.inMatch,
      real: true
    } : null;
  }
  function qCounterHtml(c) {
    if (!c) return '';
    return '<div class="dr-qonline"><span class="dr-qdot"></span><b id="dr-q-online">' + c.online + '</b> ' + esc(T('jugar.online')) +
      ' <span class="dr-qsep">·</span> <b id="dr-q-match">' + c.inMatch + '</b> ' + esc(T('jugar.inMatch')) + '</div>';
  }
  function renderQueueSearching() {
    if (window.pbPresenceRefresh) window.pbPresenceRefresh();
    var c = qCounters();
    renderContent(
      '<div class="dr-qsearch">' +
        '<div class="dr-lobby-spin big"></div>' +
        '<div class="dr-lobby-h">Buscando rival de draft…</div>' +
        qCounterHtml(c) +
        '<button id="dr-q-cancel" class="dr-lobby-btn subtle">' + esc(T('common.cancel')) + '</button>' +
      '</div>'
    );
    var cx = $('dr-q-cancel'); if (cx) cx.addEventListener('click', cancelQueue);
  }
  function paintQCounters() {
    if (!state._queueMode || !state._searching) return;
    var c = qCounters();
    var content = $('dr-lobby-content');
    var pill = content && content.querySelector('.dr-qonline');
    if (!c) { if (pill) pill.remove(); return; }
    var o = $('dr-q-online'); if (o) o.textContent = c.online;
    var m = $('dr-q-match'); if (m) m.textContent = c.inMatch;
    if (!pill) {
      var cancel = $('dr-q-cancel'), html = qCounterHtml(c);
      if (cancel && html) cancel.insertAdjacentHTML('beforebegin', html);
    }
  }
  // Limpia CUALQUIER estilo inline que la transición dejó en el hub (evita el «negro» al cancelar).
  function _resetHub(hub) {
    if (!hub) return;
    if (hub._drAnim) { try { hub._drAnim.cancel(); } catch (e) {} hub._drAnim = null; }
    hub.style.display = ''; hub.style.opacity = ''; hub.style.zIndex = ''; hub.style.pointerEvents = ''; hub.style.transform = '';
  }
  // Muestra la vista del draft (#view-draft) pero deja la URL/sección lógica en el HUB «Jugar»:
  // al recargar se aterriza en el hub (nunca en el draft en solitario) y allí se reanuda/limpia.
  // El cambio de vista va SIN empujar historial (_pbViewOnly) → sin /draft transitorio ni «Atrás» muerto.
  function showDraftView() {
    if (!window.switchAppTab) return;
    if (window._pbViewOnly) window._pbViewOnly(function () { window.switchAppTab('draft'); });
    else window.switchAppTab('draft');
    if (window._pbReplaceRoute) window._pbReplaceRoute('jugar');
  }
  // Transición hub → buscador (cohesionada): color del sobre = el del hub + SONIDO «selecting a pack»
  // + el buscador entra (fundido + acelerón + sobre bajando) + el hub REAL se DESLIZA hacia abajo y se
  // desvanece como una unidad (el sobre nunca se ve suelto/cortado; se va con toda la UI). Rápido y snappy.
  function _draftOnlineEnter(sourceEl) {
    if (window._draftSetPackColor && sourceEl)
      window._draftSetPackColor(sourceEl.style.getPropertyValue('--h'), sourceEl.style.getPropertyValue('--h2'));
    window.sfx && window.sfx('draft.selectPack');
    showDraftView();   // vista de draft, URL en el hub (recargar → hub)
    if (window._draftOnlineSearchShow) window._draftOnlineSearchShow(cancelQueue);
    var hub = document.getElementById('view-jugar');
    if (hub) {
      _resetHub(hub);
      hub.style.display = 'flex'; hub.style.opacity = '1'; hub.style.zIndex = '9060'; hub.style.pointerEvents = 'none';
      hub._drAnim = hub.animate(
        [{ opacity: 1, transform: 'translateY(0) scale(1)' }, { opacity: 0, transform: 'translateY(64px) scale(0.965)' }],
        { duration: 520, easing: 'cubic-bezier(0.45,0,0.5,1)', fill: 'forwards' });
      hub._drAnim.onfinish = function () { _resetHub(hub); };
    }
  }
  window._draftOnlineEnter = _draftOnlineEnter;   // hook de test (headless salta el check de cuenta)
  // Hook de test de la pantalla de PREPARACIÓN (el flujo real necesita 2 clientes + Firebase).
  window._draftPrepTest = function (room) {
    state.role = state.role || 'host'; state.code = state.code || 'TEST'; state.room = room; state.drafting = true;
    renderDraftEnd(room);
  };

  window._draftMpQueue = function (opts) {
    if (!roomsReady()) { window.pbToast && window.pbToast(T('draft.mpError')); return; }
    var a = queueAcct();
    if (!a) { window.pbToast && window.pbToast(T('draft.mpLoginNeeded')); window.pbOpenLogin && window.pbOpenLogin(); return; }
    window._pbUnlockAudio && window._pbUnlockAudio(); warmTick();
    resetForNewSession();   // barre cualquier resto de un draft anterior (p.ej. #dr-mp-end tras el hand-off)
    state._searching = true; state._queueMode = true;
    state._searchOpen = !!(opts && opts.sourceEl);   // venimos del RADAR con el sobre flotando → apertura sin costuras
    var startMatch = function () {
      ensureAuth().then(function () { return window.pbRooms.get(DQUEUE); }).then(function (q) {
        if (!state._searching) return;
        var openE = q && q.open, fresh = openE && openE.ts && (Date.now() - openE.ts) < DQUEUE_FRESH_MS;
        if (openE && fresh && openE.hostUid !== a.uid) {
          wrote(window.pbRooms.set(DQUEUE, { open: null }), 'dq-claim').catch(function () {});
          queueJoin(openE.code, a);
        } else queueHost(a);
      }).catch(function () { if (state._searching) queueHost(a); });
    };
    var sourceEl = opts && opts.sourceEl;
    if (sourceEl) {
      _draftOnlineEnter(sourceEl);   // transición cohesionada (color + sonido + fundido del hub + buscador)
      startMatch();
    } else {
      showDraftView();   // vista de draft, URL en el hub (recargar → hub)
      open(); renderQueueSearching();   // flujo antiguo (sin sobre): spinner del lobby
      startMatch();
    }
  };
  function queueHost(a) {
    if (!state._searching) return;
    var gen = state._gen;   // si CANCELAS la cola mientras esta sala se crea (cleanup bumpea _gen),
    var code = genCode();   // el create async NO revive la sesión (te arrastraría a un draft) ni deja sala/cola huérfanas.
    var data = { status: 'waiting', pool: 'full', isQueue: true, expireAt: ttl(),
      host: { uid: a.uid, name: a.name || T('draft.mpYou'), avatar: a.avatar || '', friendCode: a.friendCode || '' }, guest: null };
    window.pbRooms.create(code, data).then(function () {
      if (state._gen !== gen) { window.pbRooms.remove(code).catch(function () {}); return; }   // cancelado → borrar sala huérfana y no revivir
      state.code = code; state.role = 'host'; state.name = data.host.name; state._hadOpp = false; state._queueMode = true;
      remember(); watch(code); announceQueueOpen(a, code); startQRefresh(a);
      dlog('cola: sala creada ' + code + ' (host, esperando)');
    }).catch(function () { state._searching = false; renderContent(errBox(T('draft.mpError'))); });
  }
  function queueJoin(code, a) {
    var gen = state._gen;   // token: si cancelas mientras el join async está en vuelo (cleanup incrementa _gen), aborta
    window.pbRooms.get(code).then(function (room) {
      if (state._gen !== gen) return;   // cancelado leyendo la sala → no escribir guest ni entrar
      if (!room || room.status !== 'waiting' || (room.guest && room.guest.uid && room.guest.uid !== a.uid)) {
        if (state._searching) queueHost(a); return;
      }
      var guest = { uid: a.uid, name: a.name || T('draft.mpGuest'), avatar: a.avatar || '', friendCode: a.friendCode || '' };
      wrote(window.pbRooms.set(code, { guest: guest }), 'dq-join').then(function () {
        if (state._gen !== gen) { window.pbRooms.set(code, { guest: null, status: 'waiting' }).catch(function () {}); return; }   // cancelado tras despachar el guest → soltar el hueco + no revivir
        state.code = code; state.role = 'guest'; state.name = guest.name; state._hadOpp = true; state._queueMode = true;
        remember(); watch(code); dlog('cola: unido a ' + code + ' (guest)');
      }).catch(function () { if (state._searching) queueHost(a); });
    }).catch(function () { if (state._searching) queueHost(a); });
  }
  function announceQueueOpen(a, code) {
    wrote(window.pbRooms.set(DQUEUE, { open: { code: code, hostUid: a.uid, hostName: String(a.name || '').slice(0, 20), ts: Date.now() } }), 'dq-open').catch(function () {});
  }
  function startQRefresh(a) {
    stopQRefresh();
    state._qRefresh = setInterval(function () {
      if (!state._searching || !state.code) { stopQRefresh(); return; }
      paintQCounters();
      window.pbRooms.get(DQUEUE).then(function (q) {
        if (state._searching && (!q || !q.open || q.open.code === state.code)) announceQueueOpen(a, state.code);
      }).catch(function () {});
    }, 20000);
  }
  function stopQRefresh() { if (state._qRefresh) { clearInterval(state._qRefresh); state._qRefresh = null; } }
  function clearMyQueue() {
    var myCode = state.code; if (!myCode || !window.pbRooms) return;
    window.pbRooms.get(DQUEUE).then(function (q) { if (q && q.open && q.open.code === myCode) window.pbRooms.set(DQUEUE, { open: null }).catch(function () {}); }).catch(function () {});
  }
  function cancelQueue() {
    state._searching = false; state._queueMode = false;
    stopQRefresh(); clearMyQueue();
    if (window.pbRooms && state.code && state.role === 'host') wrote(window.pbRooms.remove(state.code), 'dq-cancel').catch(function () {});
    else if (window.pbRooms && state.code && state.role === 'guest') wrote(window.pbRooms.set(state.code, { guest: null, status: 'waiting' }), 'dq-cancel-guest').catch(function () {});   // libera el hueco → el host no draftea contra un fantasma
    window._draftOnlineSearchHide && window._draftOnlineSearchHide();
    _resetHub(document.getElementById('view-jugar'));   // limpia el fundido → sin pantalla en negro
    cleanup(); close();
    if (window.switchAppTab) window.switchAppTab('jugar');   // volver al hub
  }

  // ════════════════════════ TIEMPO REAL ════════════════════════
  function watch(code) {
    if (state.unsub) { try { state.unsub(); } catch (e) {} state.unsub = null; }
    state.unsub = window.pbRooms.watch(code, onRoom);
  }

  function onRoom(room) {
    if (room === undefined) { dlog('✗ snapshot error (red/permisos)'); renderContent(errBox(T('draft.mpError'))); return; }
    if (room === null) {                                                             // la partida desapareció
      dlog('partida null/cerrada');
      if (state.drafting && window._draftMpReset) window._draftMpReset();
      cleanup(); close();
      window.pbToast && window.pbToast(T('draft.mpCancelled'));
      toHub(); return;
    }
    var hadOpp = state._hadOpp;
    var hasOpp = !!(room.guest && room.guest.uid);
    state.room = room;
    state._hadOpp = hasOpp;
    // DIAGNÓSTICO: snapshot recibido (estado, oleada, nº de oleadas elegidas por cada uno).
    // Deduplicado: el poll re-lee cada 1,6s; solo logueo cuando algo CAMBIA (si no, inunda).
    var hN = Object.keys(((room.picks || {}).host) || {}).length;
    var gN = Object.keys(((room.picks || {}).guest) || {}).length;
    var key = (room.status || '?') + '|' + room.wave + '|' + hN + '|' + gN;
    if (key !== state._lastSnapKey) {
      state._lastSnapKey = key;
      dlog('◆ ' + (room.status || '?') + ' w' + room.wave + ' h' + hN + ' g' + gN + ' (' + state.role + ')');
    }
    // El invitado se fue (solo lo nota el anfitrión; al invitado, irse el host = sala borrada)
    if (state.role === 'host' && hadOpp && !hasOpp && room.status === 'waiting')
      window.pbToast && window.pbToast(T('draft.mpOppLeft'));

    // La rendición es un resultado de partida, no el borrado de la sesión. El cliente que
    // acaba de escribirla espera el ACK del servidor: Firestore emite antes el snapshot local
    // optimista y no debemos limpiar la partida si esa escritura acaba siendo denegada.
    if (room.status === 'over' && room.over && room.over.reason === 'surrender') {
      if (state._surrenderPending && !state._surrenderAck && room.over.by === state.role) return;
      finishSurrender(room); return;
    }
    if (room.status === 'finished') { window._draftOnlineSearchHide && window._draftOnlineSearchHide(); renderDraftEnd(room); return; }
    if (room.status === 'drafting') {
      // En la ruta de RADAR el radar NO se quita de golpe: lo funde la apertura sin
      // costuras (_draftMpOpenFromSearch) para no revelar el chrome ni parpadear el sobre.
      if (!state._searchOpen) window._draftOnlineSearchHide && window._draftOnlineSearchHide();
      syncDrafting(room); return;
    }
    // COLA ONLINE: durante 'waiting' NO se muestra el lobby por-código. El host AUTO-arranca el
    // drafteo al llegar el rival; el invitado espera (la pantalla de búsqueda ya está puesta).
    if (state._queueMode) {
      if (state.role === 'host' && hasOpp && state.code) {
        state._searching = false; stopQRefresh(); clearMyQueue();
        dlog('cola: rival encontrado → auto-arranque del drafteo');
        startDraft();
      }
      return;
    }
    renderLobby(room);
  }

  // ════════════════════ EMPEZAR (anfitrión) → arranca el draft sincronizado ════════════════════
  function startDraft() {
    if (state.role !== 'host' || !state.code) return;
    if (!(state.room && state.room.guest && state.room.guest.uid)) return;   // hace falta rival
    dlog('▶ start drafting (host)');
    // Sin campo `done` compartido: "ha elegido la oleada W" se DERIVA de la longitud
    // de picks[role] (cada cliente escribe SOLO su propio array → cero contención).
    wrote(window.pbRooms.set(state.code, {
      status: 'drafting',
      wave: 0,
      picks: { host: {}, guest: {} },   // MAPA por oleada {"0":[ids]} — Firestore PROHÍBE arrays anidados
      finished: { host: false, guest: false },
      opened: { host: false, guest: false }   // sobre de "listo" (cada uno abre el suyo para empezar)
    }), 'start');
    window._pbUnlockAudio && window._pbUnlockAudio();   // gesto del host → desbloquea su audio
    warmTick();   // prepara el bip del timer (AudioContext) con el gesto
  }

  // ════════════════════════ SALIR / CANCELAR ════════════════════════
  function draftMatchInProgress() { return !!(state.drafting || (state._prepBuilt && !state._matchStarting)); }

  function leave() {
    var code = state.code, role = state.role;
    if (draftMatchInProgress()) { surrender(); return; }
    if (code) {
      dlog('salir (' + role + ') ' + code);
      // Antes de empezar, sigue siendo una sala privada: el anfitrión la borra y el
      // invitado libera su hueco. Una partida empezada se resuelve por rendición arriba.
      if (role === 'host') wrote(window.pbRooms.remove(code), 'remove');
      else wrote(window.pbRooms.set(code, { guest: null, status: 'waiting' }), 'leave');
    }
    if (window._draftMpReset) window._draftMpReset();
    cleanup();
    close();
    toHub();
  }

  function surrender(skipConfirm) {
    if (!draftMatchInProgress() || !state.code || !state.role || !window.pbRooms || state._surrenderPending) return false;
    var confirm = function () {
      var code = state.code, role = state.role;
      if (!code || !role || state._surrenderPending) return;
      var winner = role === 'host' ? 'guest' : 'host';
      var surrendered = {}; surrendered[role] = true;
      var over = { winner: winner, reason: 'surrender', by: role };
      state._surrenderPending = true; state._surrenderAck = false;
      window.pbRooms.set(code, { status: 'over', over: over, surrendered: surrendered })
        .then(function () {
          // Confirmación de servidor: el escritor ya puede cerrar aunque el listener tarde.
          if (state.code !== code) return;
          state._surrenderPending = false; state._surrenderAck = true;
          var game = Object.assign({}, state.room || {}, { status: 'over', over: over, surrendered: surrendered });
          onRoom(game);
        })
        .catch(function (e) {
          state._surrenderPending = false; state._surrenderAck = false;
          dlog('✗ rendición: ' + (e && (e.code || e.message) || e));
          window.pbToast && window.pbToast(T('draft.mpSurrenderError'));
        });
    };
    if (skipConfirm || !window.pbConfirm) { confirm(); return true; }
    window.pbConfirm({
      title: T('pvp.surrender'), message: T('draft.mpSurrenderQ'),
      okLabel: T('pvp.surrender'), danger: true
    }).then(function (yes) { if (yes) confirm(); });
    return true;
  }

  // La rendición no necesita una segunda pantalla distinta al resto del producto:
  // confirma, registra el resultado, avisa brevemente a ambos y vuelve al hub.
  function finishSurrender(room) {
    var iWon = room.over && room.over.winner === state.role;
    cleanup();
    if (window._draftMpReset) window._draftMpReset();
    close();
    toHub();
    window.pbToast && window.pbToast(T(iWon ? 'draft.mpSurrenderWon' : 'draft.mpSurrenderLost'));
  }

  // Red de seguridad: re-leer la sala periódicamente durante el draft, por si la
  // escucha en tiempo real de Firestore pierde un cambio. onRoom es idempotente.
  function startPoll() {
    if (state._pollInt) return;
    state._pollInt = setInterval(function () {
      if (!state.code || !state.drafting || !window.pbRooms) return;
      window.pbRooms.get(state.code).then(function (r) { if (r !== undefined && state.drafting) onRoom(r); }).catch(function () {});
    }, 1600);
  }
  function stopPoll() { if (state._pollInt) { clearInterval(state._pollInt); state._pollInt = null; } }

  // ── Presencia: latido cada 5s + cancelar si el rival no da señal en 30s ──
  var DISCONNECT_MS = 30000;
  function startHeartbeat() {
    if (state._hbInt) return;
    var beat = function () {
      if (!state.code || !state.drafting || !window.pbRooms) return;
      var p = {}; p.seen = {}; p.seen[state.role] = Date.now();
      window.pbRooms.set(state.code, p).catch(function () {});
    };
    beat();
    state._hbInt = setInterval(beat, 5000);
  }
  function stopHeartbeat() { if (state._hbInt) { clearInterval(state._hbInt); state._hbInt = null; } }
  // Detecta el cambio del latido del rival con MI reloj (inmune al desfase entre dispositivos).
  function checkPresence(room) {
    if (!state.drafting) return false;
    var v = (room.seen || {})[oppRole()];
    if (v !== state._oppSeenVal) { state._oppSeenVal = v; state._oppSeenAt = Date.now(); return false; }
    if (state._oppSeenAt && (Date.now() - state._oppSeenAt) > DISCONNECT_MS) {
      dlog('rival sin señal >30s → cancelar');
      // Una partida iniciada ya no se borra desde el cliente: si el rival vuelve a tiempo
      // sigue teniendo su estado, y si no, el TTL la retira. Así nadie puede esquivar una
      // rendición borrando el documento compartido.
      if (window._draftMpReset) window._draftMpReset();
      cleanup(); open(); renderContent(errBox(T('draft.mpOppDisconnect')));
      return true;
    }
    return false;
  }

  function cleanup() {
    state._gen = (state._gen || 0) + 1;   // invalida el join async en vuelo → cancelar no revive la sesión
    clearWaveTimer();
    clearPackTimers();
    if (state._endDeferTimer) { clearTimeout(state._endDeferTimer); state._endDeferTimer = null; }   // defer de «Mazo completo»
    stopPrepCountdown(); state._prepBuilt = false; state._iReady = false; state._matchStarting = false; state._myEnergy = null;
    state.packPhase = false; state.packOppOpened = false;
    state.roundsStarted = false; state.packOpenedLocal = false; state.iOpened = false;
    stopPoll();
    stopHeartbeat();
    if (state._queueMode) clearMyQueue();   // host de cola abandonando (onRoom-null / × del lobby): soltar la entrada _QUEUE (si no, queda rancia hasta el TTL de 60s)
    if (state.unsub) { try { state.unsub(); } catch (e) {} }
    state.unsub = null; state.code = null; state.role = null; state.room = null; state.name = ''; state._hadOpp = false;
    state.drafting = false; state.dwave = -1; state.submitted = false; state._advanceReqWave = -1;
    state._surrenderPending = false; state._surrenderAck = false;
    state._queueMode = false; state._searching = false; state._searchOpen = false; stopQRefresh();   // cola online
    if (window.pbPresenceSetMatch) try { window.pbPresenceSetMatch(false); } catch (e) {}   // presencia: fin
    var oppA = $('dr-mp-opp-area'); if (oppA) oppA.remove();
    var tmr = $('dr-mp-timer'); if (tmr) tmr.remove();
    var wait = $('dr-mp-wait'); if (wait) wait.remove();
    var end = $('dr-mp-end'); if (end) { end.style.display = 'none'; end.innerHTML = ''; }
    var opts = $('dr-options'); if (opts) opts.style.opacity = '';
    clearSnapshot();
    forget();
  }

  // ════════════════════════ RENDER ════════════════════════
  function renderLobby(room) {
    var iAmHost = state.role === 'host';
    var hostName = (room.host && room.host.name) || T('draft.mpYou');
    var guestName = (room.guest && room.guest.name) || '';
    var meName = iAmHost ? hostName : guestName;
    var oppName = iAmHost ? guestName : hostName;
    var hasOpp = !!(room.guest && room.guest.uid);

    var codeBlock = iAmHost
      ? '<div class="dr-lobby-codewrap">' +
          '<div class="dr-lobby-codelabel">' + esc(T('draft.mpYourCode')) + '</div>' +
          '<div class="dr-lobby-coderow">' +
            '<span class="dr-lobby-code">' + esc(state.code || '') + '</span>' +
            '<button id="dr-lobby-copy" class="dr-lobby-copy" type="button" title="' + esc(T('draft.mpCopy')) + '" aria-label="' + esc(T('draft.mpCopy')) + '">' + SVG_COPY + '</button>' +
          '</div>' +
          '<div class="dr-lobby-sharehint">' + esc(T('draft.mpShareHint')) + '</div>' +
        '</div>'
      : '';

    var mine = myProfile();
    var oppAv = iAmHost ? ((room.guest && room.guest.avatar) || '') : ((room.host && room.host.avatar) || '');
    var oppFc = iAmHost ? ((room.guest && room.guest.friendCode) || '') : ((room.host && room.host.friendCode) || '');
    var rows =
      '<div class="dr-lobby-player">' +
        avatarChip(mine.avatar, 'p1', meName) +
        '<div class="dr-lobby-pinfo">' +
          '<span class="dr-lobby-pname">' + esc(meName || T('draft.mpYou')) + '</span>' +
          fcLine(mine.friendCode) +
        '</div>' +
        '<span class="dr-lobby-tag">' + esc(T('draft.mpYou')) + '</span>' +
      '</div>' +
      '<div class="dr-lobby-player' + (hasOpp ? '' : ' empty') + '">' +
        avatarChip(hasOpp ? oppAv : '', 'p2', hasOpp ? oppName : '') +
        '<div class="dr-lobby-pinfo">' +
          '<span class="dr-lobby-pname">' + (hasOpp ? esc(oppName || T('draft.mpOpponent')) : esc(T('draft.mpWaiting'))) + '</span>' +
          (hasOpp ? fcLine(oppFc) : '') +
        '</div>' +
        (hasOpp ? '<span class="dr-lobby-tag">' + esc(T('draft.mpOpponent')) + '</span>' : '<span class="dr-lobby-spin"></span>') +
      '</div>';

    var action = iAmHost
      ? '<button id="dr-lobby-start" class="dr-lobby-btn primary' + (hasOpp ? '' : ' disabled') + '" type="button">' + esc(T('draft.mpStart')) + '</button>'
      : '<div class="dr-lobby-note">' + esc(T('draft.mpHostStarts')) + '</div>';

    state._lobbyView = 'room';
    renderContent(
      '<div class="dr-lobby-h">' + esc(T('draft.mpTitle')) + '</div>' +
      codeBlock +
      '<div class="dr-lobby-players">' + rows + '</div>' +
      action +
      '<button id="dr-lobby-leave" class="dr-lobby-btn subtle" type="button">' + esc(T('draft.mpLeave')) + '</button>'
    );
    wireLobby();
  }

  function wireLobby() {
    var copy = $('dr-lobby-copy');
    if (copy) copy.addEventListener('click', function () {
      try { if (navigator.clipboard) navigator.clipboard.writeText(state.code); } catch (e) {}
      window.pbToast && window.pbToast(T('draft.mpCopied'));
    });
    var start = $('dr-lobby-start');
    if (start) start.addEventListener('click', function () { if (!start.classList.contains('disabled')) startDraft(); });
    var leaveB = $('dr-lobby-leave');
    if (leaveB) leaveB.addEventListener('click', leave);
  }

  function renderConnected(room) {
    var iAmHost = state.role === 'host';
    var hostName = (room.host && room.host.name) || '';
    var guestName = (room.guest && room.guest.name) || '';
    renderContent(
      '<div class="dr-lobby-h">' + esc(T('draft.mpConnected')) + '</div>' +
      '<div class="dr-lobby-vs">' +
        '<span class="dr-lobby-vs-name p1">' + esc((iAmHost ? hostName : guestName) || T('draft.mpYou')) + '</span>' +
        '<span class="dr-lobby-vs-x">VS</span>' +
        '<span class="dr-lobby-vs-name p2">' + esc((iAmHost ? guestName : hostName) || T('draft.mpOpponent')) + '</span>' +
      '</div>' +
      '<div class="dr-lobby-note">' + esc(T('draft.mpComingSoon')) + '</div>' +
      '<button id="dr-lobby-leave" class="dr-lobby-btn subtle" type="button">' + esc(T('draft.mpLeave')) + '</button>'
    );
    var leaveB = $('dr-lobby-leave'); if (leaveB) leaveB.addEventListener('click', leave);
    window.sfx && window.sfx('draft.complete');
  }

  // ════════════════════════ DRAFT SINCRONIZADO ════════════════════════
  // Cada cliente corre SU propio motor de draft (ofertas locales). La sala solo
  // coordina: oleada actual, reloj, los picks de cada uno y quién terminó. El
  // anfitrión es autoritativo para AVANZAR de oleada (cuando los dos resuelven).
  var WAVE_MS = 20000;          // duración de la ronda (era 10s: demasiado agobiante; el draft también se comenta y se pregunta)
  var PREP_MS = 45000;           // Tanda C: preparación tras el draft (timer + «Listo»)
  var PACK_AUTO_MS = 1300;       // Tanda B: al encontrar rival, el sobre se abre SOLO tras un beat corto
  var PACK_GRACE_MS = 10000;     // si el rival abre el sobre, tienes 10s antes de auto-abrirse
  var PACK_SAFETY_MS = 120000;   // red de seguridad: si NADIE abrió (p.ej. app en 2º plano), auto-abrir a 120s
  var SNAP_KEY = 'pocketboard_draft_snap_v1';
  function oppRole() { return state.role === 'host' ? 'guest' : 'host'; }

  function syncDrafting(room) {
    state.room = room;   // autosuficiente (onRoom ya lo hace; necesario para maybeStartRounds/bothOpened)
    // Entrada al draft (primera vez que vemos status 'drafting')
    if (!state.drafting) {
      state.drafting = true; state.dwave = -1; state.submitted = false; state._advanceReqWave = -1;
      state.packPhase = false; state.packOppOpened = false;
      state.roundsStarted = false; state.packOpenedLocal = false; state.iOpened = false;
      if (window.pbPresenceSetMatch) try { window.pbPresenceSetMatch(true); } catch (e) {}   // presencia: «en partida»
      close();                                  // cerrar el lobby → se ve el tablero del draft
      var snap = readSnapshot();
      if (snap && window._draftMpRestore) {
        window._draftMpRestore(snap); dlog('▶ drafting: RESTORE (' + state.role + ')');   // reconexión: el sobre ya se abrió
        state.roundsStarted = true; state.packOpenedLocal = true;   // las rondas ya iban
      } else if (state._searchOpen && window._draftMpOpenFromSearch) {
        // ONLINE (cola): venimos del RADAR con EL MISMO sobre flotando bajo él. No hay
        // «sobre de listo» ni espera: se funde el radar y ESE sobre se abre tal cual
        // (rip). La coordinación (opened / arranque de rondas) sigue igual vía myOpenPack.
        dlog('▶ sobre online: abrir EL MISMO sobre del radar (' + state.role + ')');
        state.packPhase = true;
        myOpenPack();
      } else if (window._draftMpPrepare) {
        // Amigo por código (sin radar): mostrar el SOBRE como botón de "listo" y auto-abrir tras un beat.
        window._draftMpPrepare(room.pool || 'full', myOpenPack); state.packPhase = true;
        dlog('▶ sobre de inicio (' + state.role + ') pool=' + (room.pool || 'full'));
        // Tanda B: se abre SOLO (Daniel: «cuando encuentra partida, el sobre se abre solo»). Un beat
        // corto para verlo y abre; el toque sigue valiendo (abre antes). Ocultamos la pista de «tocar».
        var _hh = document.getElementById('dr-mp-ready-hint'); if (_hh) _hh.style.display = 'none';
        state.packAuto = setTimeout(function () { dlog('sobre: auto-abrir (rival encontrado)'); myOpenPack(); }, PACK_AUTO_MS);
        state.packSafety = setTimeout(function () { dlog('sobre: auto-abrir 120s (red de seguridad)'); myOpenPack(); }, PACK_SAFETY_MS);
      }
      buildDraftHud();
      startPoll();          // red de seguridad por si la escucha en tiempo real falla
      startHeartbeat();     // presencia: cancela si el rival desaparece >30s
      state._oppSeenVal = (room.seen || {})[oppRole()]; state._oppSeenAt = Date.now();
    }
    if (checkPresence(room)) return;   // rival desconectado >30s → partida cancelada
    if (state.iOpened && room) { room.opened = room.opened || {}; room.opened[state.role] = true; }   // mi "abierto" optimista (hasta que propague el write)
    if (state.packPhase) { watchOpened(room); return; }   // sin oleadas ni reloj hasta abrir el sobre
    // Cambio de oleada (lo escribe el anfitrión; ambos reaccionan)
    if (room.wave !== state.dwave) {
      dlog('oleada → ' + room.wave + ' (' + state.role + ')');
      state.dwave = room.wave;
      state.submitted = false;
      revealOpp(room);                          // mazo del rival hasta la oleada anterior
      if (window._draftMpFinished && window._draftMpFinished()) {
        showDraftWaiting(true, T('draft.mpYouDone'));
      } else {
        if (room.wave > 0 && window._draftMpAdvance) window._draftMpAdvance();  // wave 0 ya la hizo begin
        showDraftWaiting(false);
        saveSnapshot();
      }
      startWaveTimer();
    }
    if (state.role === 'host') maybeAdvance(room);
    maybeStartRounds();   // ronda 1: arranca el reloj cuando AMBOS han abierto su sobre (no antes)
  }

  // Anfitrión: avanza cuando los DOS han elegido esta oleada (o ya tienen el mazo
  // completo). "Ha elegido la oleada W" = picks[role].length > W (o finished[role]).
  // Derivado de los arrays → sin campo compartido → sin carreras de merge.
  // "Ha elegido la oleada W" = su mapa de picks tiene la clave W (o ya terminó).
  function done(picks, role, wave, fin) { return !!(fin && fin[role]) || !!((picks && picks[role]) || {})[wave]; }
  function maybeAdvance(room) {
    var picks = room.picks || {}, fin = room.finished || {};
    var hostDone = done(picks, 'host', room.wave, fin), guestDone = done(picks, 'guest', room.wave, fin);
    var ck = 'chk w' + room.wave + ' h=' + hostDone + ' g=' + guestDone;
    if (ck !== state._lastChk) { state._lastChk = ck; dlog(ck); }   // deduplicado (el poll repite)
    if (!(hostDone && guestDone)) return;
    if (state._advanceReqWave === room.wave) return;   // ya pedí el avance de esta oleada
    state._advanceReqWave = room.wave;
    if (fin.host && fin.guest) { dlog('✔ ambos completos → fin'); wrote(window.pbRooms.set(state.code, { status: 'finished' }), 'finish'); return; }
    dlog('avanzar ' + room.wave + '→' + (room.wave + 1));
    wrote(window.pbRooms.set(state.code, { wave: room.wave + 1 }), 'advance');   // solo el host escribe `wave`
  }

  // ── SOBRE de "listo" (cada jugador abre el suyo para empezar las rondas) ──
  function clearPackTimers() {
    if (state.packAuto)   { clearTimeout(state.packAuto);   state.packAuto = null; }
    if (state.packSafety) { clearTimeout(state.packSafety); state.packSafety = null; }
    if (state.packGrace)  { clearTimeout(state.packGrace);  state.packGrace = null; }
  }
  // Vigila si el RIVAL ya abrió su sobre → te quedan 10s antes de auto-abrirse el tuyo.
  function watchOpened(room) {
    if ((room.opened || {})[oppRole()] && !state.packOppOpened) {
      state.packOppOpened = true;
      dlog('sobre: el rival abrió → 10s de gracia');
      if (window._draftMpReadyHint) window._draftMpReadyHint('draft.mpReadyOppReady');
      if (!state.packGrace) state.packGrace = setTimeout(function () { dlog('sobre: auto-abrir (gracia 10s)'); myOpenPack(); }, PACK_GRACE_MS);
    }
  }
  function bothOpened(room) { return !!(room && room.opened && room.opened.host && room.opened.guest); }
  // Arranca la RONDA 1 (cartas jugables + reloj) SOLO cuando AMBOS abrieron su sobre
  // Y mi propia apertura terminó. Para oleadas 2+ no aplica (roundsStarted ya true).
  function maybeStartRounds() {
    if (state.roundsStarted || !state.packOpenedLocal || !bothOpened(state.room)) return;
    state.roundsStarted = true;
    showDraftWaiting(false);
    startWaveTimer();
  }
  // Abre MI sobre: avisa al rival, hace la apertura. Las rondas (reloj) arrancan
  // cuando AMBOS han abierto (maybeStartRounds), no en cuanto uno abre.
  function myOpenPack() {
    if (!state.packPhase) return;
    state.packPhase = false; state.iOpened = true;
    clearPackTimers();
    warmTick();   // por si se abre con clic (gesto): prepara el bip del timer
    state.dwave = (state.room ? state.room.wave : 0);   // marca la oleada actual → el wave-handler no re-dispara la oleada 0
    if (state.room) { state.room.opened = state.room.opened || {}; state.room.opened[state.role] = true; }   // optimista
    var patch = { opened: {} }; patch.opened[state.role] = true;
    wrote(window.pbRooms.set(state.code, patch), 'opened');
    var onOpened = function () {
      if (state.room) revealOpp(state.room);
      saveSnapshot();
      state.packOpenedLocal = true;
      if (bothOpened(state.room)) maybeStartRounds();                 // el rival ya estaba listo → empiezan ya
      else showDraftWaiting(true, T('draft.mpWaitOpen'));             // esperar a que el rival abra (sin reloj)
    };
    if (state._searchOpen && window._draftMpOpenFromSearch) {
      // abre EL MISMO sobre que estaba bajo el radar (sin reconstruirlo ni «sobre de listo»)
      window._draftMpOpenFromSearch(state.room ? (state.room.pool || 'full') : 'full', onOpened);
    } else if (window._draftMpOpenPack) {
      window._draftMpOpenPack(onOpened);
    } else { state.packOpenedLocal = true; maybeStartRounds(); }
  }

  // Pick local (lo llama el motor del draft tras aplicar la carta a MI mazo)
  function afterLocalPick(ids) {
    if (!state.drafting || !state.code || state.submitted) return;
    state.submitted = true;
    // NO paramos el reloj: sigue contando mientras el rival no elija (la autoelección
    // ya está gateada por state.submitted, así que no vuelve a elegir por ti).
    saveSnapshot();
    var me = state.role;
    var fin = !!(window._draftMpDone && window._draftMpDone());
    if (fin) state._finishedAt = Date.now();   // para que el ÚLTIMO en terminar vea «¡Mazo completo!» antes del resultado
    dlog('✦ pick w' + state.dwave + ' n=' + ids.length + (fin ? ' (mazo COMPLETO)' : '') + ' (' + me + ')');
    // Escribo SOLO la entrada de ESTA oleada en mi mapa (merge la añade sin tocar el resto).
    // Mapa por oleada (no array de arrays) → válido en Firestore.
    var entry = {}; entry[String(state.dwave)] = ids;
    var patch = {}; patch.picks = {}; patch.picks[me] = entry;
    // ESTADÍSTICAS del draft: las 5 opciones de cada oleada (no solo la elegida) — sin
    // ellas no existe el «% de pickeo cuando aparece». Se escribe el historial COMPLETO
    // en cada pick, no el incremento: incluye las oleadas RECHAZADAS por reroll (que no
    // pasan por aquí) y una escritura fallida la repone la siguiente.
    try {
      var sl = window._draftStatLog ? window._draftStatLog() : null;
      if (sl && sl.length) {
        patch.stats = {};
        patch.stats[me] = { env: window.PB_ENV || 'prod', build: window.PB_BUILD || '', waves: sl.slice(0, 40) };
      }
    } catch (eS) {}
    if (fin) { patch.finished = {}; patch.finished[me] = true; }
    wrote(window.pbRooms.set(state.code, patch).then(function () { dlog('pick escrito ✓ w' + state.dwave); }), 'pick');
    showDraftWaiting(true, fin ? T('draft.mpYouDone') : T('draft.mpWaiting'));
  }

  function revealOpp(room) {
    var picks = (room.picks && room.picks[oppRole()]) || {};
    var ids = [];
    for (var w = 0; w < room.wave; w++) if (picks[w]) ids = ids.concat(picks[w]);   // hasta la oleada anterior (mapa por oleada)
    renderOppStrip(ids);
  }

  // ── HUD provisional (Tanda 3 lo convierte en el estilo Clash Royale) ──
  function buildDraftHud() {
    var play = $('dr-play'); if (!play || $('dr-mp-opp-area')) return;
    // Mazo del rival ARRIBA, en 2 filas (como el tuyo propio)
    var opp = document.createElement('div'); opp.id = 'dr-mp-opp-area';
    opp.innerHTML = '<div id="dr-mp-opplabel"></div><div id="dr-mp-opp"></div>';
    play.insertBefore(opp, play.firstChild);
    // Ver mejor las cartas del rival: hover = preview (como tu mazo), clic = zoom
    var grid = opp.querySelector('#dr-mp-opp');
    if (grid) {
      grid.addEventListener('mouseover', function (e) {
        var s = e.target.closest && e.target.closest('.dr-mp-opp-slot.filled');
        if (s && s.dataset.img && window._draftCardPreview) window._draftCardPreview(s.dataset.img, s);
      });
      grid.addEventListener('mouseout', function (e) {
        if (e.target.closest && e.target.closest('.dr-mp-opp-slot') && window._draftHideCardPreview) window._draftHideCardPreview();
      });
      grid.addEventListener('click', function (e) {
        var s = e.target.closest && e.target.closest('.dr-mp-opp-slot.filled');
        if (s && s.dataset.img && window.openZoomFromImage) window.openZoomFromImage(s.dataset.img, s.querySelector('img') || s);
      });
    }
    // Timer ENTRE las opciones y tu barra de mazo (sin chocar con nada)
    var timer = document.createElement('div'); timer.id = 'dr-mp-timer'; timer.className = 'dr-mp-timerbar';
    timer.innerHTML = '<div id="dr-mp-timer-fill"></div><span id="dr-mp-timer-num">' + Math.round(WAVE_MS / 1000) + '</span>';
    var deckbar = $('dr-deckbar-wrap');
    if (deckbar && deckbar.parentNode) deckbar.parentNode.insertBefore(timer, deckbar);
    else play.appendChild(timer);
    var wait = document.createElement('div'); wait.id = 'dr-mp-wait'; wait.style.display = 'none';
    wait.innerHTML = '<div class="dr-mp-wait-inner"></div>';
    play.appendChild(wait);
  }
  // Mazo del rival = 20 huecos en 2 filas (los revelados con carta, el resto vacíos), como tu barra de mazo
  function renderOppStrip(ids) {
    var el = $('dr-mp-opp'); if (!el) return;
    var byId = new Map((window.CARDS_DB || []).map(function (c) { return [c.id, c]; }));
    var html = '';
    for (var i = 0; i < 20; i++) {
      var c = ids[i] ? byId.get(ids[i]) : null;
      var src = c ? window.localizeImg(c.image) : '';
      html += '<div class="dr-mp-opp-slot' + (c ? ' filled' : '') + '"' + (src ? ' data-img="' + src + '"' : '') + '>' +
        (c ? '<img draggable="false" src="' + src + '" alt="">' : '') + '</div>';
    }
    el.innerHTML = html;
    // Durante el draft NO mostramos avatar/nombre del rival (apretaba la UI): solo
    // el texto del mazo. El perfil completo va en el lobby y en la pantalla final.
    var lab = $('dr-mp-opplabel'); if (lab) lab.textContent = T('draft.mpOppDeck') + ' · ' + ids.length + '/20';
  }
  function showDraftWaiting(on, msg) {
    var w = $('dr-mp-wait'); if (w) { w.style.display = on ? 'flex' : 'none'; var inner = w.querySelector('.dr-mp-wait-inner'); if (inner && msg) inner.textContent = msg; }
    var opts = $('dr-options'); if (opts) { opts.style.opacity = on ? '0.22' : ''; opts.style.pointerEvents = on ? 'none' : ''; }
  }

  // ── Bip del timer SINTETIZADO (Web Audio, NO un sonido del juego) ──
  // Tono corto y limpio en los últimos segundos; el último (rem=1) más agudo.
  var _tickAC = null;
  function warmTick() {   // crear/reanudar el AudioContext desde un gesto (clic) para que suene luego
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      _tickAC = _tickAC || new AC();
      if (_tickAC.state === 'suspended') _tickAC.resume();
    } catch (e) {}
  }
  function tickBeep(rem) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      _tickAC = _tickAC || new AC();
      if (_tickAC.state === 'suspended') { _tickAC.resume(); }
      var t = _tickAC.currentTime;
      var o = _tickAC.createOscillator(), g = _tickAC.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(rem <= 1 ? 1180 : 760, t);
      o.connect(g); g.connect(_tickAC.destination);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(rem <= 1 ? 0.16 : 0.1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.start(t); o.stop(t + 0.17);
    } catch (e) {}
  }

  // ── Reloj de oleada (WAVE_MS, tope) + autoelección al agotarse ──
  // El contador es LOCAL (desde que ESTE cliente recibe la oleada), NO desde el
  // waveStartedAt del anfitrión: así no hay desincronización por relojes de
  // dispositivos distintos (que podían dar tiempo negativo → autoelección instantánea).
  function startWaveTimer() {
    clearWaveTimer();
    var fill = $('dr-mp-timer-fill');
    if (window._draftMpFinished && window._draftMpFinished()) {
      updateTimerLabel(null);
      if (fill) { fill.style.transition = 'none'; fill.style.width = '0%'; }
      return;
    }
    state._timerEnds = Date.now() + WAVE_MS;
    // Barra que se vacía de llena a 0 en lo que dura la oleada (CSS transition lineal).
    if (fill) {
      fill.style.transition = 'none'; fill.style.width = '100%';
      void fill.offsetWidth;   // reflow para reiniciar la animación
      fill.style.transition = 'width ' + WAVE_MS + 'ms linear, background 0.4s ease';
      fill.style.width = '0%';
    }
    state._timerInt = setInterval(function () {
      var rem = Math.max(0, Math.ceil((state._timerEnds - Date.now()) / 1000));
      updateTimerLabel(rem);
      if (rem <= 0) { clearInterval(state._timerInt); state._timerInt = null; }
    }, 250);
    updateTimerLabel(Math.max(0, Math.ceil((state._timerEnds - Date.now()) / 1000)));
    state.waveTimer = setTimeout(function () {
      if (!state.submitted && window._draftMpAutoPick) window._draftMpAutoPick();
    }, Math.max(0, state._timerEnds - Date.now()));
  }
  function clearWaveTimer() {
    if (state.waveTimer) { clearTimeout(state.waveTimer); state.waveTimer = null; }
    if (state._timerInt) { clearInterval(state._timerInt); state._timerInt = null; }
  }
  function updateTimerLabel(rem) {
    var t = $('dr-mp-timer'), num = $('dr-mp-timer-num'), fill = $('dr-mp-timer-fill'); if (!t) return;
    if (rem == null) { if (num) num.textContent = '✓'; t.classList.remove('low'); return; }
    if (num) num.textContent = rem;
    t.classList.toggle('low', rem <= 3);
    // Color del relleno: VERDE lleno → ROJO al acabarse (repartido por toda la ronda).
    if (fill) {
      var hue = Math.max(0, Math.min(142, (rem / (WAVE_MS / 1000)) * 142));
      fill.style.background = 'linear-gradient(90deg, hsl(' + hue + ',60%,48%), hsl(' + Math.min(142, hue + 14) + ',66%,58%))';
    }
    // Pop por segundo — sutil.
    t.classList.remove('tick'); void t.offsetWidth; t.classList.add('tick');
    // Cuenta atrás: bip SINTETIZADO por segundo en los últimos 3s (no un sonido del juego).
    if (rem <= 3 && rem >= 1 && rem !== state._lastTickRem) tickBeep(rem);
    state._lastTickRem = rem;
  }

  // ── Snapshot local (reconexión: el cliente conserva SU estado; la sala coordina) ──
  // CADUCIDAD de la sala (política TTL de Firestore sobre `expireAt`). Sin esto las salas
  // de draft se quedaban para siempre: al añadirlo había 283 acumuladas desde junio, la
  // mayoría terminadas. La partida (pvpGames) ya lo tenía; el draft se quedó sin ello.
  function ttl() { return new Date(Date.now() + 24 * 3600 * 1000); }

  function saveSnapshot() {
    try { var s = window._draftMpSnapshot && window._draftMpSnapshot(); if (s) localStorage.setItem(SNAP_KEY, JSON.stringify({ code: state.code, snap: s })); } catch (e) {}
  }
  function readSnapshot() {
    try { var o = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); return (o && o.code === state.code) ? o.snap : null; } catch (e) { return null; }
  }
  function clearSnapshot() { try { localStorage.removeItem(SNAP_KEY); } catch (e) {} }

  // ── Fin del draft: pantalla VS con LOS DOS MAZOS visibles (anti-trampas) ──
  function flattenPicks(map) {                 // mapa por oleada {"0":[ids]} → lista ordenada de ids
    var ids = []; if (!map) return ids;
    Object.keys(map).map(Number).sort(function (a, b) { return a - b; })
      .forEach(function (w) { (map[w] || []).forEach(function (id) { ids.push(id); }); });
    return ids;
  }
  // Iconos (mismo estilo que la web): guardar (disquete), compartir, check.
  var SVG_SAVE = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.2 2.2h7.4l3.2 3.2v7.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.8 13.7V8.8h6.4v4.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.7 2.6V5.3H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var SVG_SHARE = '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.5v7M5.2 5.3 8 2.5l2.8 2.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 8.5V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var SVG_QR = '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M9.5 9.5h2.2v2.2H9.5zM12.8 12.8h1.2M9.5 13.6v.4M14 9.5v1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  var SVG_CHECK = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Un bloque de mazo (formato Mis Mazos: 2 filas, badge ×2) con cabecera + iconos guardar/compartir
  function endDeckBlock(player, cards, cls, mine) {
    var b = document.createElement('div'); b.className = 'dr-mp-end-deck';
    var name = (player && player.name) || (mine ? T('draft.mpYou') : T('draft.mpOpponent'));
    var fc = player && player.friendCode;
    var head = document.createElement('div'); head.className = 'dr-mp-end-pl';
    head.innerHTML = avatarChip((player && player.avatar) || '', cls, name) +
      '<div class="dr-mp-end-info">' +
        '<span class="dr-mp-end-name">' + esc(name) + '</span>' +
        fcLine(fc) +
      '</div>' +
      '<span class="dr-mp-end-tag">' + esc(mine ? T('draft.mpYou') : T('draft.mpOpponent')) + '</span>';
    var tools = document.createElement('span'); tools.className = 'dr-mp-end-tools';
    var sv = document.createElement('button'); sv.className = 'dr-mp-iconbtn'; sv.type = 'button';
    sv.title = T('draft.mpSaveOne'); sv.setAttribute('aria-label', T('draft.mpSaveOne')); sv.innerHTML = SVG_SAVE;
    var sh = document.createElement('button'); sh.className = 'dr-mp-iconbtn'; sh.type = 'button';
    sh.title = T('mazos.share'); sh.setAttribute('aria-label', T('mazos.share')); sh.innerHTML = SVG_SHARE;
    tools.appendChild(sv); tools.appendChild(sh);
    // Código 2D compatible con Pocket (mismo botón que el fin de draft de un jugador)
    var qr = null;
    if (window.pbDeckQR) {
      qr = document.createElement('button'); qr.className = 'dr-mp-iconbtn'; qr.type = 'button';
      qr.title = T('mazos.qrBtn'); qr.setAttribute('aria-label', T('mazos.qrBtn')); qr.innerHTML = SVG_QR;
      tools.appendChild(qr);
    }
    head.appendChild(tools);
    b.appendChild(head);
    var layout = (window._mazosDeckLayoutFromCards)
      ? window._mazosDeckLayoutFromCards(cards, { big: false }) : document.createElement('div');
    b.appendChild(layout);
    return { block: b, saveBtn: sv, shareBtn: sh, qrBtn: qr, cards: cards, name: name };
  }
  function renderDraftEnd(room) {
    // Idempotente: si la pantalla de preparación ya está montada, solo actualiza el estado «listo»
    // (los writes de `ready` disparan nuevos snapshots → NO reconstruir, si no se resetea timer/botones).
    if (state._prepBuilt && $('dr-mp-end') && $('dr-mp-end').style.display !== 'none') { updatePrepReady(room); return; }
    clearWaveTimer(); stopPoll(); stopHeartbeat();
    // Punto 1: si ACABO de terminar, deja ver «¡Mazo completo!» un momento antes del resultado.
    var since = state._finishedAt ? (Date.now() - state._finishedAt) : 9999;
    if (since < 1900) {
      // Diferido para ver «¡Mazo completo!»: guardar el id (lo limpian cleanup/closeResult) y atar el
      // callback a la MISMA sesión por código — sin esto, un leave+re-unirse en <1,9s repintaba la
      // pantalla de fin vieja sobre la sesión nueva y le tiraba stopPoll/stopHeartbeat/drafting=false.
      var _endCode = state.code;
      if (state._endDeferTimer) clearTimeout(state._endDeferTimer);
      state._endDeferTimer = setTimeout(function () {
        state._endDeferTimer = null;
        if (state.code && state.code === _endCode) renderDraftEnd(room);
      }, 1900 - since);
      state._finishedAt = 0; return;
    }
    state.drafting = false; clearSnapshot();
    showDraftWaiting(false);
    close();
    var iAmHost = state.role === 'host';
    var me = iAmHost ? (room.host || {}) : (room.guest || {});
    var op = iAmHost ? (room.guest || {}) : (room.host || {});
    var byId = new Map((window.CARDS_DB || []).map(function (c) { return [c.id, c]; }));
    var resolve = function (ids) { return (ids || []).map(function (id) { return byId.get(id); }).filter(Boolean); };
    // Mi mazo: del motor local (D.deck); si al RECONECTAR el motor está vacío (recarga en la
    // preparación/resultado), cae a mis picks guardados en la sala → sigue mostrando mi mazo.
    var myIds = (window._draftMpDeckIds && window._draftMpDeckIds()) || [];
    if (!myIds.length) myIds = flattenPicks((room.picks || {})[state.role]);
    var myCards = resolve(myIds);
    var opCards = resolve(flattenPicks((room.picks || {})[oppRole()]));

    var ov = $('dr-mp-end');
    if (!ov) { ov = document.createElement('div'); ov.id = 'dr-mp-end'; (document.getElementById('view-draft') || document.body).appendChild(ov); }
    ov.innerHTML = '';
    var scroll = document.createElement('div'); scroll.id = 'dr-mp-end-scroll';
    var ttl = document.createElement('div'); ttl.id = 'dr-mp-end-title'; ttl.textContent = T('draft.mpDraftDone'); scroll.appendChild(ttl);
    var mineB = endDeckBlock(me, myCards, 'p1', true);
    var opB = endDeckBlock(op, opCards, 'p2', false);
    scroll.appendChild(mineB.block);
    scroll.appendChild(opB.block);
    // ── PREPARACIÓN (Tanda C): elige la ENERGÍA de tu mazo (idea de Daniel: la pantalla de
    // «listo» prepara qué energías usarás) + «Listo» compacto + timer. Al dar Listo se fija tu
    // energía (la lee el arranque de la partida). Sin botones de guardar-ambos/salir (Daniel).
    var prep = document.createElement('div'); prep.id = 'dr-mp-prep';
    prep.innerHTML =
      '<div id="dr-mp-energy-pick">' +
        '<span class="dr-mp-energy-label">Tu energía</span>' +
        '<div id="dr-mp-energy-orbs" class="dr-mp-energy-orbs"></div>' +
      '</div>' +
      '<div class="dr-mp-prep-row">' +
        '<button id="dr-mp-ready" class="dr-lobby-btn primary" type="button">Listo</button>' +
        '<div id="dr-mp-prep-timer"><span id="dr-mp-prep-count">' + Math.round(PREP_MS / 1000) + '</span>s</div>' +
      '</div>' +
      '<div id="dr-mp-ready-state"></div>';
    scroll.appendChild(prep);
    ov.appendChild(scroll);
    ov.style.display = 'block';   // bloque + scroll interno centrado (flex centraba a la izquierda)
    ov.scrollTop = 0;

    // ── Guardar (icono → ✓ verde, sin salir de la pantalla) y compartir (menú de Mazos) ──
    function markSaved(btn) { if (!btn) return; btn.innerHTML = SVG_CHECK; btn.disabled = true; btn.classList.add('dr-saved'); }
    function saveOne(b) {
      if (b.saveBtn.disabled || !b.cards.length || !window._draftSaveCards) return false;
      window._draftSaveCards(b.cards, b.name + ' · ' + T('draft.mpDraftLabel'));
      markSaved(b.saveBtn);
      window.pbToast && window.pbToast(T('draft.mpSavedToast', { name: b.name }));
      return true;
    }
    function shareOne(b) { if (window._mazosShareDeck && b.cards.length) window._mazosShareDeck({ name: b.name + ' · ' + T('draft.mpDraftLabel'), cards: b.cards }); }
    mineB.saveBtn.addEventListener('click', function () { saveOne(mineB); });
    opB.saveBtn.addEventListener('click', function () { saveOne(opB); });
    mineB.shareBtn.addEventListener('click', function () { shareOne(mineB); });
    opB.shareBtn.addEventListener('click', function () { shareOne(opB); });
    function qrOne(b) {
      if (!window.pbDeckQR || !b.cards.length) return;
      window.pbDeckQR.show({
        name: b.name + ' · ' + T('draft.mpDraftLabel'), cards: b.cards,
        energyTypes: window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(b.cards)) : [],
      });
    }
    if (mineB.qrBtn) mineB.qrBtn.addEventListener('click', function () { qrOne(mineB); });
    if (opB.qrBtn) opB.qrBtn.addEventListener('click', function () { qrOne(opB); });
    window.sfx && window.sfx('draft.complete');
    // Preparación: cablear «Listo» + arrancar cuenta atrás + reflejar el estado actual del rival.
    state._prepBuilt = true; state._matchStarting = false;
    // Energía del mazo: si ya la elegí (o al reconectar viene en la sala) la respeto; si no,
    // la infiero de las cartas (tope 3, regla de la web). Si ya di «Listo» → todo bloqueado.
    state._iReady = !!(room.ready && room.ready[state.role]);
    if (!state._myEnergy || !state._myEnergy.length) {
      var pre = (room.energy && room.energy[state.role]) ||
                (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(myCards, 3)) : []);
      state._myEnergy = _EN_TYPES.filter(function (t) { return (pre || []).indexOf(t) !== -1; }).slice(0, 3);
    }
    renderEnergyPicker();
    var readyBtn = $('dr-mp-ready'); if (readyBtn) readyBtn.addEventListener('click', function () { markReady(false); });
    if (state._iReady && readyBtn) {   // reconexión estando ya listo
      readyBtn.disabled = true; readyBtn.classList.add('dr-saved'); readyBtn.textContent = '✓ Listo';
      var stR = $('dr-mp-ready-state'); if (stR) stR.textContent = 'Esperando al rival…';
    }
    startPrepCountdown();
    updatePrepReady(room);
  }
  // ── Selector de ENERGÍA del mazo (mío) en la pantalla de preparación ──
  var _EN_TYPES = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'];
  function elOrbHTML(el) {
    var k = window.ORB_ICON_KEY && window.ORB_ICON_KEY[el];
    var src = k && ((window.ENERGY_ICONS && window.ENERGY_ICONS[k]) || (window.ORB_ICONS && window.ORB_ICONS[k]));
    return src ? '<img class="dr-mp-en-orb" src="' + src + '" alt="">'
               : '<span class="dr-mp-en-dot" style="background:' + ((window.EL_COLORS && window.EL_COLORS[el]) || '#888') + '"></span>';
  }
  function renderEnergyPicker() {
    var host = $('dr-mp-energy-orbs'); if (!host) return;
    var active = new Set(state._myEnergy || []);
    host.innerHTML = '';
    _EN_TYPES.forEach(function (el) {
      var b = document.createElement('button'); b.type = 'button';
      b.className = 'dr-mp-en-toggle' + (active.has(el) ? ' on' : '');
      b.title = window.elName ? window.elName(el) : el;
      b.innerHTML = elOrbHTML(el);
      if (state._iReady) { b.disabled = true; b.classList.add('locked'); }   // ya listo → energía fijada
      else b.addEventListener('click', function () {
        var on = b.classList.contains('on');
        if (!on && active.size >= 3) { window.pbToast && window.pbToast(T('mazos.energyMax3')); return; }
        if (on) { active.delete(el); b.classList.remove('on'); }
        else { active.add(el); b.classList.add('on'); }
        state._myEnergy = _EN_TYPES.filter(function (t) { return active.has(t); });
        window.sfx && window.sfx('mazos.edit');
      });
      host.appendChild(b);
    });
  }
  // ── PREPARACIÓN tras el draft (Tanda C): «Listo» de ambos → partida con los mazos drafteados ──
  function bothReady(room) { return !!(room && room.ready && room.ready.host && room.ready.guest); }
  function markReady(auto) {
    if (state._iReady) return;
    // Hace falta AL MENOS una energía (un mazo necesita zona de energía). En el auto-listo del
    // timeout no bloqueamos: caemos a la energía inferida del mazo.
    if (!state._myEnergy || !state._myEnergy.length) {
      if (auto) {
        try { var mc = resolveMyCards(); state._myEnergy = window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(mc, 3)).slice(0, 3) : []; } catch (e) {}
      } else { window.pbToast && window.pbToast('Elige al menos una energía para tu mazo'); return; }
    }
    state._iReady = true;
    var en = state._myEnergy || [];
    if (state.room) {
      state.room.ready = state.room.ready || {}; state.room.ready[state.role] = true;
      state.room.energy = state.room.energy || {}; state.room.energy[state.role] = en;
    }
    var patch = { ready: {}, energy: {} }; patch.ready[state.role] = true; patch.energy[state.role] = en;
    if (state.code && window.pbRooms) wrote(window.pbRooms.set(state.code, patch), 'ready');
    var btn = $('dr-mp-ready'); if (btn) { btn.disabled = true; btn.classList.add('dr-saved'); btn.textContent = '✓ Listo'; }
    var st = $('dr-mp-ready-state'); if (st) st.textContent = 'Esperando al rival…';
    renderEnergyPicker();   // re-render → orbes bloqueados
    updatePrepReady(state.room);
  }
  // Mis cartas drafteadas (motor local, o mis picks de la sala tras recargar).
  function resolveMyCards() {
    var byId = new Map((window.CARDS_DB || []).map(function (c) { return [c.id, c]; }));
    var ids = (window._draftMpDeckIds && window._draftMpDeckIds()) || [];
    if (!ids.length && state.room) ids = flattenPicks((state.room.picks || {})[state.role]);
    return ids.map(function (id) { return byId.get(id); }).filter(Boolean);
  }
  function updatePrepReady(room) {
    if (!room) return;
    var r = room.ready || {};
    var st = $('dr-mp-ready-state');
    if (bothReady(room)) {
      stopPrepCountdown();
      if (st) st.textContent = '¡Preparados! Empezando…';
      _draftMpStartMatch(room);
    } else if (r[oppRole()] && st && !state._iReady) {
      st.textContent = 'El rival está listo';
    }
  }
  function startPrepCountdown() {
    stopPrepCountdown();
    state._prepEnds = Date.now() + PREP_MS;
    state._prepInt = setInterval(function () {
      var left = Math.max(0, Math.ceil((state._prepEnds - Date.now()) / 1000));
      var c = $('dr-mp-prep-count'); if (c) c.textContent = left;
      if (left <= 0) { stopPrepCountdown(); if (!state._iReady) markReady(true); }   // timeout → listo automático
    }, 250);
  }
  function stopPrepCountdown() { if (state._prepInt) { clearInterval(state._prepInt); state._prepInt = null; } }
  // C.2 — PUENTE a la partida estándar: al dar «Listo» los dos, se arranca una partida REAL con
  // los mazos drafteados, REUSANDO el motor del estándar (pvp.js/pvp-sync sobre la colección
  // pvpGames). El HOST crea el doc de partida (mismo code, ambos mazos con su energía pública,
  // moneda, mode:'draft' para ranking/ELO por formato); cada cliente entra vía _pvpEnterFromDraft
  // → onRoom ve 'playing' → enterMatch (VS → moneda → reparto) con el mazo drafteado. Solo se
  // valida de verdad con 2 clientes + Firebase.
  function _draftMpStartMatch(room) {
    if (state._matchStarting) return;
    state._matchStarting = true;
    var st = $('dr-mp-ready-state');
    var myCards = resolveMyCards();
    if (myCards.length !== 20) { if (st) st.textContent = 'Mazo incompleto'; state._matchStarting = false; return; }
    if (!window.pbPvp || !window._pvpEnterFromDraft) {   // el motor de partida no está cargado
      if (st) st.textContent = 'La partida en vivo no está disponible aquí'; return;
    }
    // Energía ELEGIDA en la preparación (no la inferida): la que guardé al dar «Listo» (en la
    // sala) o la que tengo en curso; sólo si faltara del todo, se infiere.
    var myEnergy = (room.energy && room.energy[state.role]) || state._myEnergy ||
                   (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(myCards, 3)) : []);
    var code = state.code, role = state.role;
    if (st) st.textContent = '¡Preparados! Empezando…';
    // Mi lado con la MISMA forma que el estándar (uid/name/avatar + deck {name,cover,n,energyTypes})
    // → los writes son idénticos a los del estándar, así que valen con tus reglas de Firestore actuales.
    var cover = '';
    try { cover = (window._mazosDeckCover && window._mazosDeckCover({ cards: myCards })) || (myCards[0] && myCards[0].image) || ''; }
    catch (e) { cover = (myCards[0] && myCards[0].image) || ''; }
    var mySide = function (info) {
      info = info || {};
      return { uid: info.uid || '', name: info.name || '', avatar: info.avatar || '', friendCode: info.friendCode || '',
               deck: { name: info.name || 'Draft', cover: cover, n: myCards.length, energyTypes: (myEnergy || []).slice(0, 3) } };
    };
    var enter = function () {
      window._pvpEnterFromDraft(code, role, { cards: myCards, energyTypes: myEnergy });
      _draftHandoff();   // la partida la lleva ya PvP: soltamos el draft (watch + ROOM_KEY)
    };
    if (role === 'host') {
      // Crear la sala de partida IGUAL que el estándar (status:'waiting', guest:null) + etiqueta
      // draft. El invitado se UNE (escribe su guest) y el host AUTO-ARRANCA (status:'playing' + coin)
      // al verlo — reusa TODO el lobby→partida del estándar (mismos writes → mismas reglas).
      var doc = { status: 'waiting', mode: 'draft', isDraft: true, host: mySide(room.host), guest: null };
      dlog('▶ [C.2] crear sala de partida draft ' + code);
      window.pbPvp.create(code, doc).then(enter).catch(function (e) {
        dlog('✗ crear partida: ' + (e && (e.code || e.message) || e));
        if (st) st.textContent = 'No se pudo crear la partida';
        state._matchStarting = false;
      });
    } else {
      // Invitado: esperar a que el host cree la sala, UNIRSE (escribir mi guest con mi energía) y
      // entrar. El host, al ver mi mazo, tira la moneda y arranca la partida automáticamente.
      var guestSide = mySide(room.guest);
      var tries = 0;
      var joinLoop = function () {
        window.pbPvp.get(code).then(function (pd) {
          if (pd && pd.status === 'playing') { enter(); return; }             // ya arrancó
          if (pd && (!pd.status || pd.status === 'waiting')) {                 // sala lista → unirme
            window.pbPvp.set(code, { guest: guestSide }).then(enter).catch(retry); return;
          }
          retry();                                                            // aún no existe
        }).catch(retry);
        function retry() { if (++tries <= 25) setTimeout(joinLoop, 400); else { if (st) st.textContent = 'No se pudo unir a la partida'; state._matchStarting = false; } }
      };
      joinLoop();
    }
  }
  // Soltar el draft cuando la partida arranca: parar su escucha/timers y OLVIDAR su sala, para que
  // al recargar reconecte la PARTIDA (PvP), no el draft. NO resetea el motor (el tablero toma el
  // relevo). NO ocultamos #dr-mp-end aquí: sigue mostrando «Empezando…» (opaco, tapa el draft) hasta
  // que enterMatch pase al tablero y oculte #view-draft entero; showSection lo limpia al reentrar.
  function _draftHandoff() {
    clearWaveTimer(); stopPrepCountdown(); stopPoll(); stopHeartbeat();
    if (state.unsub) { try { state.unsub(); } catch (e) {} state.unsub = null; }
    forget(); clearSnapshot();
    state.drafting = false; state._prepBuilt = false; state._searching = false; state._queueMode = false;
    // La partida la lleva ya PvP: soltar la IDENTIDAD de la sesión de draft para que no confunda a
    // openChooser («si state.code → reanuda la sala vieja») ni a una reconexión posterior.
    state.code = null; state.role = null; state.room = null; state.name = ''; state._hadOpp = false;
  }
  function closeResult() {
    var ov = $('dr-mp-end'); if (ov) { ov.style.display = 'none'; ov.innerHTML = ''; }
    stopPrepCountdown(); state._prepBuilt = false; state._iReady = false; state._matchStarting = false; state._myEnergy = null;
    if (window._draftMpReset) window._draftMpReset();   // motor → pantalla de inicio
    cleanup();                                          // suelta la sala (no la borra: el rival sigue viendo su fin)
  }
  // Barre el resto VISUAL de un draft anterior antes de arrancar una sesión NUEVA (cola/amigo). Tras
  // el hand-off a la partida, #dr-mp-end se deja EN PIE a propósito (cubre la transición al tablero) y
  // el motor queda finalizado; si no se barre aquí, la búsqueda nueva se APILA sobre la pantalla de
  // fin vieja (bug de Daniel: «¡Elección terminada!» + «Buscando rival…» a la vez). No cancela salas
  // (la sesión ya fue entregada/abandonada) — solo limpia lo que quedó en pantalla y el motor.
  function resetForNewSession() {
    if (state._endDeferTimer) { clearTimeout(state._endDeferTimer); state._endDeferTimer = null; }
    stopPrepCountdown();
    state._prepBuilt = false; state._iReady = false; state._matchStarting = false; state._myEnergy = null;
    var end = $('dr-mp-end'); if (end) { end.style.display = 'none'; end.innerHTML = ''; }
    if (window._draftMpReset) window._draftMpReset();   // motor → sobre nuevo (showSection('start') re-limpia #dr-mp-end)
  }
  // ¿Hay una sesión de draft VIVA que NO debe barrerse al re-entrar a la pestaña? Cubre: eligiendo
  // cartas, esperando al rival tras terminar, en la pantalla de preparación, o buscando rival. Tras
  // el hand-off/abandono todas quedan en false → el re-entrar puede resetear al sobre limpio.
  function draftMpActive() { return !!(state.drafting || state._prepBuilt || state._searching); }

  // Una partida de draft en curso no puede quedar escondida mientras su reloj sigue corriendo.
  // Cualquier navegación intenta rendirse explícitamente; cancelar la confirmación mantiene la
  // partida en pantalla y también restaura la ruta lógica del hub tras un botón Atrás.
  function guardNavigation(tab) {
    if (tab === 'draft' || !draftMatchInProgress()) return false;
    if (window._pbReplaceRoute) window._pbReplaceRoute('jugar');
    surrender();
    return true;
  }

  // ════════════════════════ RECONEXIÓN ════════════════════════
  // Al recargar NO se pregunta nada (Daniel): o SIGUES en la partida tal y como estaba,
  // o —si ya no hay partida (cancelada/expirada, o solo estabas buscando)— vuelves a la
  // pantalla de MODOS (el hub). Una partida por matchmaking es una PARTIDA, no una «sala»
  // con prompt de reanudar. «Buscando» no es un estado: reaparecer buscando = volver al hub.
  // El draft online conserva la ruta lógica «jugar» mientras muestra la vista del draft.
  // Por eso hay que pedir el cambio de vista SIEMPRE al terminar: mirar solo la ruta deja
  // detrás el selector solitario aunque el estado lógico ya diga «jugar».
  function toHub() { if (window.switchAppTab) window.switchAppTab('jugar'); }
  function reconnect() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.code || !roomsReady()) return;
    ensureAuth()
      .then(function () { return window.pbRooms.get(saved.code); })
      .then(function (room) {
        // Carrera: si el usuario inició OTRA sesión (crear/unirse/cola) mientras este get async
        // resolvía, NO pisar su estado con la sala vieja guardada.
        if (state.code && state.code !== saved.code) { dlog('reconnect: ya hay otra sesión activa → abortar'); return; }
        if (!room) {   // la partida ya no existe (se canceló o expiró por tiempo) → pantalla de modos
          dlog('reconnect: partida ya no existe → hub');
          forget(); clearSnapshot(); state.code = null; state.role = null;
          toHub(); return;
        }
        state.code = saved.code; state.role = saved.role; state.name = saved.name || '';
        if (room.status === 'over' && room.over && room.over.reason === 'surrender') {
          // Resultado pendiente de mostrar (p.ej. recargaste justo tras rendirte).
          showDraftView();
          watch(saved.code);
        } else if (room.status === 'drafting' || room.status === 'finished') {
          // Partida VIVA (drafteando o en la pantalla de preparación/resultado): REANUDAR tal
          // cual, sin preguntar. onRoom→syncDrafting restaura desde el snapshot local; si estaba
          // en finished, renderDraftEnd re-muestra la preparación/resultado.
          dlog('reconnect: reanudar partida ' + saved.code + ' (' + room.status + ')');
          state._searchOpen = false;                       // el sobre ya se abrió (no venimos del radar)
          state._queueMode = !!room.isQueue;
          state._hadOpp = !!(room.guest && room.guest.uid);
          showDraftView();                                 // vista de draft, URL en el hub (otra recarga vuelve aquí)
          watch(saved.code);
        } else {
          // status 'waiting': no hay partida todavía (solo estabas buscando / sala sin empezar).
          // → pantalla de modos, soltando la sala: el HOST la borra; el INVITADO libera su hueco
          // (escribe guest:null, como leave()) para que el host no crea que sigue ahí (si no, podría
          // pulsar «Empezar» y draftear contra un rival fantasma hasta el timeout de presencia).
          dlog('reconnect: waiting → hub + soltar la partida');
          if (myUid() && room.host && room.host.uid === myUid())
            wrote(window.pbRooms.remove(saved.code), 'reconnect-drop');
          else if (myUid() && room.guest && room.guest.uid === myUid())
            wrote(window.pbRooms.set(saved.code, { guest: null, status: 'waiting' }), 'reconnect-release');
          clearMyQueue(); forget(); clearSnapshot(); state.code = null; state.role = null;
          toHub();
        }
      })
      .catch(function (e) { dlog('✗ reconnect: ' + (e && (e.code || e.message) || e)); toHub(); });
  }

  // ════════════════════════ INIT ════════════════════════
  function init() {
    // Versión cargada (para verificar que el navegador NO sirve caché vieja) en el log verde.
    try {
      var s = document.querySelector('script[src*="draft-multi.js"]');
      var m = s && s.src.match(/v=(m\d+)/);
      dlog('▣ versión ' + (m ? m[1] : '?') + ' + sobre de "listo"');
    } catch (e) {}
    // Multijugador SIN TERMINAR: en producción se oculta el botón (flag draftMultiplayer).
    var fab = $('dr-mp-fab');
    if (fab) {
      if (window.pbFlag && !window.pbFlag('draftMultiplayer')) fab.style.display = 'none';
      else fab.addEventListener('click', openChooser);
    }
    var cx = $('dr-lobby-close');
    if (cx) cx.addEventListener('click', function () { if (state.code) leave(); else close(); });
    // El botón "Volver" de las cajas de error sale por delegación (contenido dinámico)
    document.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'dr-lobby-back') { cleanup(); close(); }
      // Copiar código de amigo (lobby / HUD / pantalla final) por delegación.
      var fcBtn = e.target.closest && e.target.closest('.dr-mp-fc-copy');
      if (fcBtn) { e.stopPropagation(); copyToClipboard(fcBtn.getAttribute('data-fc'), 'draft.mpFcCopied'); return; }
      // "?" de info del lobby: abrir/cerrar; clic fuera lo cierra.
      var infoBtn = e.target.closest && e.target.closest('.dr-mp-info-btn');
      if (infoBtn) { e.stopPropagation(); infoBtn.closest('.dr-mp-info-wrap').classList.toggle('open'); return; }
      var openInfo = document.querySelector('.dr-mp-info-wrap.open');
      if (openInfo && !(e.target.closest && e.target.closest('.dr-mp-info-wrap'))) openInfo.classList.remove('open');
    });
    // Cambio de idioma EN VIVO: el lobby se pinta con innerHTML (sin data-i18n), así
    // que hay que re-renderizar la pantalla actual al cambiar de idioma.
    window.addEventListener('langchange', function () {
      var ov = $('dr-lobby');
      if (!ov || !ov.classList.contains('open') || state.drafting) return;
      if (state._lobbyView === 'room' && state.room) renderLobby(state.room);
      else if (state._lobbyView === 'chooser') openChooser();
      // 'join': no re-render para no borrar el código que esté escribiendo
    });
    // Reconexión al cargar: en cuanto haya sesión (Google o anónima previa).
    // ANTES (síncrono), si hay una partida guardada y la ruta aterrizó en el draft en solitario,
    // saltamos ya al hub para no ENSEÑAR el draft-solo mientras reconnect resuelve (async). El
    // draft online no es una pantalla propia: siempre se aterriza en la elección de modos y allí
    // se reanuda o se limpia. (Con la URL ya en el hub esto no dispara; es un seguro.)
    var _savedRoom = null; try { _savedRoom = JSON.parse(localStorage.getItem(ROOM_KEY) || 'null'); } catch (e) {}
    if (_savedRoom && _savedRoom.code && window._pbCurrentTab === 'draft' && window.switchAppTab) window.switchAppTab('jugar');
    if (window.pbAuth && window.pbAuth.current && window.pbAuth.current()) reconnect();
    else window.addEventListener('pb-auth', function once() { window.removeEventListener('pb-auth', once); reconnect(); });
    // BLOQUEO DE PANTALLA / cambiar de app: el navegador móvil congela los timers, así
    // que el rival se quedaría esperando. Al OCULTAR la página, autoelegimos YA (síncrono)
    // para no bloquearlo. (En móvil no hay forma fiable de seguir corriendo en background.)
    var onHide = function () {
      if (document.hidden && state.drafting && !state.submitted && window._draftMpAutoPickNow) {
        dlog('app oculta → autoelegir (no bloquear al rival)');
        window._draftMpAutoPickNow();
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // El motor del draft (draft-view.js) llama aquí tras aplicar un pick local
  window._draftMpAfterPick = afterLocalPick;

  // Hooks (test / acceso externo)
  window._draftMpOpen = openChooser;
  window._draftMpCreate = openCreate;
  window._draftMpSync = syncDrafting;       // test: forzar reacción a un snapshot de sala
  window._draftMpAfterPickFn = afterLocalPick;
  window._draftMpReconnect = reconnect;     // test: simular la reconexión al recargar
  window._draftMpJoin = openJoin;
  window._draftMpStart = startDraft;
  window._draftMpLeave = leave;
  window._draftMpSurrender = surrender;
  window._draftMpGuardNavigation = guardNavigation;
  window._draftMpState = function () { return state; };
  window._draftMpCancelQueue = cancelQueue;   // test: verificar liberación del hueco de invitado + _gen
  window._draftMpFriendly = openChooser;    // «jugar con un amigo» del draft (crear/unirse por código)
  window._draftMpActive = draftMpActive;    // draft-view lo consulta al re-entrar (¿preservar o resetear?)
  // Repinta los contadores de la búsqueda de cola cuando llega presencia real.
  window.addEventListener('pb-presence', function () { paintQCounters(); });
})();
