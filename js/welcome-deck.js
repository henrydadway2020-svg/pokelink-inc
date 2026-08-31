/* ══════════════════════════════════════════════════════════════
   welcome-deck.js — primera baraja para una cuenta nueva.

   Solo decide DESPUÉS de `pb-sync-ready`: para entonces la biblioteca local
   ya está fusionada con Firestore y no podemos regalar encima de un mazo real.
   La marca sincronizada impide que el regalo reaparezca si se borra la baraja.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var LIBRARY_KEY = 'pocketboard_library_v1';
  var MARKER_KEY = 'pocketboard_welcome_deck_v1';
  var state = 'idle'; // idle | syncing | ready
  var inFlightUid = '';
  var inFlightDone = null;

  function T(key, vars) { return window.t ? window.t(key, vars) : key; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function readLibrary() {
    try {
      var value = JSON.parse(localStorage.getItem(LIBRARY_KEY));
      return Array.isArray(value) ? value : [];
    } catch (e) { return []; }
  }
  function markerValue(uid) { return 'done:' + String(uid || ''); }
  function markerDone(uid) {
    try { return localStorage.getItem(MARKER_KEY) === markerValue(uid); } catch (e) { return false; }
  }
  function markDone(uid) {
    try { localStorage.setItem(MARKER_KEY, markerValue(uid)); } catch (e) {}
    if (window.pbClearWelcomePending) window.pbClearWelcomePending(uid);
  }
  function realUser() {
    var u = (window.pbAuth && window.pbAuth.user) || null;
    return (u && !u.isAnonymous) ? u : null;
  }
  function setState(next) {
    state = next;
    try { window.dispatchEvent(new CustomEvent('pb-welcome-state', { detail: { state: state } })); } catch (e) {}
    if (window._jugarRefresh) try { window._jugarRefresh(); } catch (e) {}
  }

  function shuffledTopTen(random) {
    var rows = (window.META_DECKS && window.META_DECKS.decks) || [];
    rows = rows.slice(0, 10);
    for (var i = rows.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = rows[i]; rows[i] = rows[j]; rows[j] = tmp;
    }
    return rows;
  }

  function pickLegalDeck(random) {
    if (!window._mazosBuildMetaDeck || !window.validateDeckForFormat) return null;
    var rows = shuffledTopTen(random || Math.random);
    for (var i = 0; i < rows.length; i++) {
      var deck = null;
      try { deck = window._mazosBuildMetaDeck(rows[i]); } catch (e) {}
      if (!deck || !deck.cards || deck.cards.length !== 20) continue;
      var result = null;
      try { result = window.validateDeckForFormat(deck, 'standard'); } catch (e) {}
      if (result && result.ok) return deck;
    }
    return null;
  }

  function welcomeId(uid) {
    return 'tcgmini-welcome-v1-' + String(uid || 'account').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  }

  function closeReadyModal(overlay, previousFocus) {
    if (!overlay || !overlay.parentNode) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 220);
    var focusTarget = (previousFocus && previousFocus !== document.body && previousFocus.isConnected)
      ? previousFocus : document.getElementById('jv-deckstage');
    if (focusTarget && focusTarget.focus) try { focusTarget.focus(); } catch (e) {}
  }

  function openSavedDeck(deck) {
    if (window._mazosOpenMine) window._mazosOpenMine({ grid: true });
    else if (window.switchAppTab) window.switchAppTab('mazos');
    if (window._mazosOpenById) {
      setTimeout(function () { window._mazosOpenById('m-' + deck.id); }, 0);
    }
  }

  function watchStackCover(stackHost, deck) {
    if (!stackHost) return;
    var src = (deck && deck.firstCardImg) || '';
    if (src && window.localizeImg) try { src = window.localizeImg(src); } catch (e) {}
    if (!src) { stackHost.classList.add('pb-welcome-stack-fallback'); return; }
    var probe = new Image();
    probe.onload = function () { stackHost.classList.remove('pb-welcome-stack-fallback'); };
    probe.onerror = function () { stackHost.classList.add('pb-welcome-stack-fallback'); };
    probe.src = src;
  }

  function showReadyModal(deck) {
    var old = document.getElementById('welcome-deck-overlay');
    if (old) old.remove();
    var previousFocus = document.activeElement;
    var overlay = document.createElement('div');
    overlay.id = 'welcome-deck-overlay';
    overlay.className = 'pb-modal-overlay pb-welcome-overlay';
    overlay.innerHTML =
      '<div class="pb-modal pb-welcome-modal" role="dialog" aria-modal="true" aria-labelledby="welcome-deck-title" aria-describedby="welcome-deck-desc">' +
        '<div class="pb-welcome-stack" aria-hidden="true"></div>' +
        '<div class="pb-welcome-content">' +
          '<div class="pb-modal-title" id="welcome-deck-title">' + esc(T('welcome.readyTitle')) + '</div>' +
          '<div class="pb-welcome-deckname">' + esc(deck.name || T('jugar.deck')) + '</div>' +
          '<div class="pb-modal-msg" id="welcome-deck-desc">' + esc(T('welcome.readyBody', { name: deck.name || T('jugar.deck') })) +
            '<br>' + esc(T('welcome.readyHint')) + '</div>' +
          '<div class="pb-modal-actions">' +
            '<button type="button" class="pb-btn" data-welcome-close>' + esc(T('welcome.keepBrowsing')) + '</button>' +
            '<button type="button" class="pb-btn pb-btn-primary" data-welcome-open>' + esc(T('welcome.viewDeck')) + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var stackHost = overlay.querySelector('.pb-welcome-stack');
    if (stackHost && window._mazosDeckStack) {
      stackHost.appendChild(window._mazosDeckStack(deck));
      watchStackCover(stackHost, deck);
    }
    var close = function () { closeReadyModal(overlay, previousFocus); };
    overlay.querySelector('[data-welcome-close]').addEventListener('click', close);
    overlay.querySelector('[data-welcome-open]').addEventListener('click', function () {
      closeReadyModal(overlay, null);
      openSavedDeck(deck);
    });
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab') return;
      var focusable = Array.prototype.slice.call(overlay.querySelectorAll('button:not([disabled])'));
      if (!focusable.length) { e.preventDefault(); return; }
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !overlay.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(function () {
      overlay.classList.add('open');
      var primary = overlay.querySelector('[data-welcome-open]');
      if (primary) primary.focus();
    });
  }

  // Devuelve un resultado estructurado para que la suite compruebe todos los caminos.
  function tryWelcome(detail, opts) {
    detail = detail || {};
    opts = opts || {};
    var uid = detail.uid;
    var current = realUser();
    if (!uid || !current || detail.error || current.uid !== uid) {
      setState('idle');
      return { status: detail.error ? 'sync-error' : 'ignored' };
    }
    if (inFlightUid === uid && inFlightDone) return { status: 'saving', done: inFlightDone };
    if (markerDone(uid)) {
      if (window.pbClearWelcomePending) window.pbClearWelcomePending(uid);
      setState('ready');
      return { status: 'already-decided' };
    }

    var library = readLibrary();
    // Esta cuenta ya existía, o ya hay contenido local/nube: no invade ni cambia
    // el mazo activo. Sí deja la decisión sellada para que borrar no active el regalo.
    if (!detail.isNew || library.length) {
      markDone(uid);
      setState('ready');
      return { status: library.length ? 'has-decks' : 'existing-account' };
    }

    var metaDeck = pickLegalDeck(opts.random || Math.random);
    if (!metaDeck || !window._mazosMetaLibraryRecord) {
      setState('idle');
      return { status: 'no-legal-meta' };
    }

    var id = welcomeId(uid);
    var record = window._mazosMetaLibraryRecord(metaDeck, {
      id: id,
      name: metaDeck.name,
      energyTypes: metaDeck.energyTypes || [],
      format: 'standard',
      source: 'meta',
      welcome: true,
    });

    // Relee justo antes del commit: otra pestaña pudo haber creado un mazo mientras
    // construíamos/validábamos el meta elegido.
    if (readLibrary().length) {
      markDone(uid);
      setState('ready');
      return { status: 'has-decks' };
    }
    var commit = opts.commit || window.pbCloudCommitWelcome;
    if (!commit) {
      setState('idle');
      return { status: 'sync-unavailable' };
    }

    setState('syncing');
    inFlightUid = uid;
    inFlightDone = Promise.resolve().then(function () {
      return commit(uid, record, id, markerValue(uid));
    }).then(function (result) {
      inFlightUid = ''; inFlightDone = null;
      if (result && result.created === false) {
        if (result.retrying) {
          setState('syncing');
          return { status: 'retrying' };
        }
        markDone(uid);
        setState('ready');
        return { status: 'has-decks' };
      }
      var now = realUser();
      if (!now || now.uid !== uid || (result && result.stale)) {
        setState('idle');
        return { status: 'session-changed', deck: record };
      }
      setState('ready');
      if (window._mazosRefreshIfOpen) try { window._mazosRefreshIfOpen(); } catch (e) {}
      try { window.dispatchEvent(new CustomEvent('pb-welcome-deck', { detail: { deck: record } })); } catch (e) {}
      if (!opts.silent) showReadyModal(record);
      return { status: 'gifted', deck: record };
    }).catch(function (error) {
      inFlightUid = ''; inFlightDone = null;
      setState('idle');
      if (window.console) console.warn('[welcome-deck]', error);
      return { status: 'save-error', error: error };
    });
    return { status: 'saving', deck: record, done: inFlightDone };
  }

  window.pbWelcomeDeckState = function () { return state; };
  window._pbWelcomeDeckTry = tryWelcome; // hook de prueba

  window.addEventListener('pb-auth', function (e) {
    var u = e.detail;
    if (u && !u.isAnonymous) setState('syncing');
    else setState('idle');
  });
  window.addEventListener('pb-sync-ready', function (e) { tryWelcome((e && e.detail) || {}); });
})();
