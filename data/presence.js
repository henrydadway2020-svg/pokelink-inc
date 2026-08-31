/* ══════════════════════════════════════════════════════════════════════════
   presence.js — Contadores «en línea / en partida» del online (Estándar + Draft).
   Cliente ligero sobre window.pbPresence (módulo Firebase inline en index.html).

   CADENCIA ADAPTATIVA (2026-08-13): un ÚNICO timer de 1s decide cuándo tocan
   latido y conteo, según si el usuario está MIRANDO los contadores:
     · MIRANDO (hub «Jugar» visible, cola de búsqueda del PvP o del draft, o en
       partida) → latido 15s / conteo 20s ⇒ dato fresco sin martillear Firestore.
     · EN EL RESTO de la web (Cartas, Mazos…) → latido 25s / conteo 120s.
   La ventana de «sigue en línea» vive en index.html (PRESENCE_WINDOW_MS = 45s):
   debe ser MAYOR que el latido lento, si no la gente se auto-excluye del conteo.
   Al cerrar la pestaña se borra la presencia (leave) → el rival lo ve al instante.

   KNOBS de coste: POLL_FAST (lecturas) y BEAT_FAST (escrituras). Con mucha gente
   simultánea, subir POLL_FAST es lo primero que hay que tocar.

   API: window._pbPresence = {online, inMatch} + evento 'pb-presence'
        window.pbPresenceSetMatch(bool)  — marca «en partida» (pvp-sync / draft)
        window.pbPresenceRefresh()       — fuerza latido + conteo YA
        window.pbPresenceVals()          — valores reales a pintar, o null sin medición
        window.pbPresencePill(prefix)    — HTML de la píldora, o '' sin medición real
   ══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var BEAT_FAST = 15000, BEAT_SLOW = 25000;
  var POLL_FAST = 20000, POLL_SLOW = 120000;
  var TICK_MS = 1000, RETRY_MS = 2500;

  var timer = null, inMatch = false, started = false;
  var lastBeat = 0, lastPoll = 0, polling = false, retryAt = 0;

  function acct() { return window.pbAccount ? window.pbAccount() : null; }
  function uid() { var a = acct(); return (a && !a.anon) ? a.uid : null; }
  function visible() { return document.visibilityState !== 'hidden'; }
  function api() { return window.pbPresence || null; }

  // ¿Está el usuario en una pantalla donde SE VEN los contadores? (auto-detección:
  // sin registro manual no hay fugas de estado si una vista se cierra por otro camino)
  function looking() {
    if (inMatch) return true;
    var v = document.getElementById('view-jugar');
    if (v && v.offsetWidth > 0) return true;                            // hub «Jugar»
    if (document.querySelector('#pvp-content .pvp-searching-wrap')) return true;  // cola PvP
    var d = document.getElementById('dr-online-search');
    if (d && d.offsetWidth > 0) return true;                            // cola del draft
    return false;
  }

  function beat() {
    var u = uid(), p = api();
    lastBeat = Date.now();
    if (!u || !p || !visible()) return;
    try { p.beat(u, inMatch); } catch (e) {}
  }
  function poll() {
    var p = api();
    lastPoll = Date.now();
    if (!p || !uid() || !visible() || polling) return;
    polling = true;
    p.counts().then(function (c) {
      polling = false;
      if (!c || c.online == null || c.inMatch == null) {
        retryAt = Date.now() + RETRY_MS;
        // Una lectura parcial no es «cero». Retiramos también cualquier dato
        // anterior para no dejar una cifra rancia con apariencia de tiempo real.
        if (window._pbPresence != null) {
          window._pbPresence = null;
          window.dispatchEvent(new CustomEvent('pb-presence', { detail: null }));
        }
        return;
      }
      retryAt = 0;
      window._pbPresence = c;
      window.dispatchEvent(new CustomEvent('pb-presence', { detail: c }));
    }).catch(function () { polling = false; retryAt = Date.now() + RETRY_MS; });
  }

  function tick() {
    var now = Date.now(), fast = looking();
    if (now - lastBeat >= (fast ? BEAT_FAST : BEAT_SLOW)) beat();
    if (retryAt && now >= retryAt) { retryAt = 0; poll(); return; }
    if (now - lastPoll >= (fast ? POLL_FAST : POLL_SLOW)) poll();
  }

  function start() {
    if (started) return; started = true;
    beat(); poll();
    timer = setInterval(tick, TICK_MS);
  }
  function stop() {
    started = false;
    if (timer) { clearInterval(timer); timer = null; }
    var hadPublishedCounts = window._pbPresence != null;
    window._pbPresence = null;
    if (hadPublishedCounts) window.dispatchEvent(new CustomEvent('pb-presence', { detail: null }));
  }
  function sync() { if (uid() && visible()) start(); else stop(); }

  // ── API pública ──
  window.pbPresenceSetMatch = function (on) {
    var was = inMatch; inMatch = !!on;
    if (was !== inMatch) { beat(); poll(); }   // propaga el cambio de estado y relee YA
  };
  window.pbPresenceRefresh = function () { sync(); if (started) { beat(); poll(); } };

  // Valores a pintar: solo una lectura REAL. Sin Firebase, sin sesión o antes de
  // que termine la consulta devolvemos null para que la UI oculte la píldora.
  window.pbPresenceVals = function () {
    var pr = window._pbPresence;
    if (pr && pr.online != null) return {
      online: pr.online,
      inMatch: pr.inMatch == null ? 0 : pr.inMatch,
      real: true
    };
    return null;
  };

  // Píldora compartida (hub «Jugar» y cola de búsqueda = EXACTAMENTE la misma).
  // prefix → ids «<prefix>-cnt-online» / «<prefix>-cnt-match» para repintar sin re-montar.
  window.pbPresencePill = function (prefix, vals) {
    var v = vals || window.pbPresenceVals(), p = prefix || 'pb';
    if (!v || v.real !== true || v.online == null) return '';
    var T = window.t || function (k) { return k; };
    return '<span class="pb-onpill">' +
        '<span class="pb-onpill-dot"></span>' +
        '<span class="pb-onpill-i"><b id="' + p + '-cnt-online">' + v.online + '</b>' + esc(T('jugar.online')) + '</span>' +
        '<span class="pb-onpill-div"></span>' +
        '<span class="pb-onpill-i"><b id="' + p + '-cnt-match">' + v.inMatch + '</b>' + esc(T('jugar.inMatch')) + '</span>' +
      '</span>';
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  window.addEventListener('pb-auth', sync);
  document.addEventListener('visibilitychange', function () {
    if (visible()) { sync(); if (started) { beat(); poll(); } }
  });
  window.addEventListener('focus', function () { if (started) poll(); });
  // Al cerrar/ocultar, suelta la presencia (best-effort; la ventana la limpia igual).
  window.addEventListener('pagehide', function () { var u = uid(), p = api(); if (u && p) try { p.leave(u); } catch (e) {} });

  if (document.readyState !== 'loading') sync();
  else document.addEventListener('DOMContentLoaded', sync);
})();
