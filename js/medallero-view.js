// ═══════════════════════════════════════════════════════════════════════════
// PERFIL / MAESTRÍA POKÉMON — tanda 3 (v2 tras el feedback de Daniel).
// Pestaña «Perfil» de la nav. Héroe con avatar/nombre/stats + la Maestría:
// SOLO los Pokémon con progreso (victorias online ≥ 1), ordenados de más a
// menos, con el emblema del diseño A (marco metálico por rango, corona desde
// rango III, numeral, barra tipo PS). Sin filtros: esta sección es pura estética.
// Datos: users/{uid}/pvpStats/derived (solo los escribe la Cloud Function).
// Rangos/curva compartidos en window.PB_MEDAL (los reutiliza la tanda 4).
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // La escalera de rangos (window.PB_MEDAL) y el catálogo de emotes/misiones
  // (window.PB_EMOTES) viven en js/mastery.js (fuente única, la comparte la partida).
  var TIERS = window.PB_MEDAL.tiers;

  var D = { stats: null, loaded: false, logged: false, names: null, winsByName: null };

  function T2(k, v) { return window.t ? window.t(k, v) : k; }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); }

  // ── catálogo: un Pokémon por NOMBRE, arte = impresión de rareza más baja ──
  var RAR = { '◊': 0, '◊◊': 1, '◊◊◊': 2, '◊◊◊◊': 3 };
  function buildNames() {
    if (D.names) return D.names;
    var by = {};
    (window.CARDS_DB || []).forEach(function (c) {
      if (!c || c.cardType !== 'pokemon' || !c.name || !c.image) return;
      var k = c.name.toLowerCase();
      var e = by[k];
      if (!e) { e = by[k] = { name: c.name, base: c }; }
      var curR = RAR[e.base.rarity] != null ? RAR[e.base.rarity] : 9;
      var newR = RAR[c.rarity] != null ? RAR[c.rarity] : 9;
      if (newR < curR) e.base = c;
    });
    D.names = Object.keys(by).map(function (k) { return by[k]; });
    return D.names;
  }

  // wins del doc de stats van POR IMPRESIÓN (id) → agrupar por nombre
  function computeWins() {
    var m = {};
    var w = (D.stats && D.stats.wins) || {};
    Object.keys(w).forEach(function (id) {
      var db = window.dbLookup ? window.dbLookup({ id: id }) : null;
      if (!db || db.cardType !== 'pokemon' || !db.name) return;   // trainers: registrados en datos, fuera de la rejilla v1
      var k = db.name.toLowerCase();
      m[k] = (m[k] | 0) + (w[id] | 0);
    });
    D.winsByName = m;
  }
  function winsOf(e) { return (D.winsByName && D.winsByName[e.name.toLowerCase()]) | 0; }

  // ── persistencia REAL: misiones reclamadas + emblemas elegidos (claves añadidas
  //    a APPLIERS de cloud-sync → viajan con la cuenta entre dispositivos) ──
  var MIS_KEY = 'pocketboard_missions_v1', EMB_KEY = 'pocketboard_emblems_v1';
  function claimedSet() {
    try {
      return (JSON.parse(localStorage.getItem(MIS_KEY) || '{}') || {}).claimed || {};
    } catch (e) { return {}; }
  }
  function claimMission(id) {
    try {
      var d = JSON.parse(localStorage.getItem(MIS_KEY) || '{}') || {};
      d.claimed = d.claimed || {}; d.claimed[id] = Date.now();
      localStorage.setItem(MIS_KEY, JSON.stringify(d));
    } catch (e) {}
  }
  function getEquip() {
    try { var a = JSON.parse(localStorage.getItem(EMB_KEY) || '[]'); return Array.isArray(a) ? a.slice(0, 3) : []; } catch (e) { return []; }
  }
  function setEquip(names) { try { localStorage.setItem(EMB_KEY, JSON.stringify(names.slice(0, 3))); } catch (e) {} }

  // racha y forma reciente desde el historial de partidas (sincronizado por cloud-sync);
  // cuando la Cloud Function calcule la racha VERIFICADA, se lee de las stats y ya
  function historyStats() {
    try {
      var h = JSON.parse(localStorage.getItem('pocketboard_pvp_history_v1') || '[]') || [];
      var best = 0, cur = 0;
      h.forEach(function (m) {
        if (m && m.result === 'win') { cur += 1; if (cur > best) best = cur; }
        else cur = 0;
      });
      return { best: best, form: h.slice(-10).map(function (m) { return !!(m && m.result === 'win'); }) };
    } catch (e) { return { best: 0, form: [] }; }
  }


  // ── carga de stats ──
  function loadStats() {
    var share = function () { try { window.PB_EMOTES.setMyStats(D.stats, (window.pbAccount && window.pbAccount() || {}).uid); } catch (e) {} };   // el menú de partida usa la misma vista
    var a = window.pbAccount && window.pbAccount();
    D.logged = !!(a && a.uid);
    if (!D.logged || !(window.pbDB && window.pbDB.loadPvpStats)) {
      D.stats = null; D.loaded = true; computeWins(); share(); render(); return;
    }
    window.pbDB.loadPvpStats(a.uid)
      .then(function (s) { D.stats = s || null; D.loaded = true; computeWins(); share(); render(); })
      .catch(function () { D.loaded = true; computeWins(); render(); });
  }

  // ── carga perezosa de artes + animación SOLO en los marcos visibles ──
  //    (.md-live enciende el destello/prisma; fuera de pantalla no se pinta ni se anima:
  //    con 30 marcos animando a la vez el rasterizador de Chrome se resentía)
  var io = null, ioLive = null;
  function armLazy(host) {
    if (io) { try { io.disconnect(); } catch (e) {} }
    if (ioLive) { try { ioLive.disconnect(); } catch (e) {} }
    io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target;
        if (el.dataset.bg) { el.style.backgroundImage = 'url("' + el.dataset.bg + '")'; delete el.dataset.bg; }
        io.unobserve(el);
      });
    }, { root: host, rootMargin: '600px' });
    host.querySelectorAll('.md-img[data-bg]').forEach(function (el) { io.observe(el); });
    ioLive = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { en.target.classList.toggle('md-live', en.isIntersecting); });
    }, { root: host, rootMargin: '80px' });
    host.querySelectorAll('.md-cell, .pf-emb').forEach(function (el) { ioLive.observe(el); });
    startGlintLoop(host);
  }
  // Destello del metal: cada ~1.2 s UN marco visible al azar recibe .md-glow (barrido CSS
  // de 1.4 s). Un solo elemento animando a la vez — con la rejilla entera en animación
  // continua el rasterizador de Chrome se resentía al hacer scroll. Se para con la vista
  // oculta / pestaña en segundo plano / Reducir animaciones.
  var glintTimer = null;
  function startGlintLoop(host) {
    if (glintTimer) return;
    glintTimer = setInterval(function () {
      if (document.hidden || !host.isConnected || getComputedStyle(host).display === 'none') return;
      if (document.documentElement.classList.contains('pb-reduce-motion')) return;
      var pool = host.querySelectorAll('.md-live .md-fr:not(.md-t5):not(.md-pre):not(.md-glow)');
      if (!pool.length) return;
      var el = pool[Math.floor(Math.random() * pool.length)];
      el.classList.add('md-glow');
      setTimeout(function () { el.classList.remove('md-glow'); }, 1500);
    }, 1200);
  }

  // barra tipo XP con los números DENTRO (a Daniel no le gustaban aparte debajo)
  function xpHtml(w, r) {
    var prev = window.PB_MEDAL.prevAt(r), next = window.PB_MEDAL.nextAt(r);
    if (next == null) {
      return '<div class="md-xp md-xpmax"><i style="width:100%"></i><span>' + w + ' · ' + esc(T2('medal.max')) + '</span></div>';
    }
    var pct = Math.max(4, Math.round(((w - prev) / (next - prev)) * 100));
    return '<div class="md-xp"><i style="width:' + pct + '%"></i><span>' + w + ' / ' + next + '</span></div>';
  }

  function cellHtml(e) {
    var w = winsOf(e);
    var r = window.PB_MEDAL.rankFor(w);
    var title = e.name + (r ? ' · ' + window.PB_MEDAL.name(r) : '') + ' · ' + w;
    return '<div class="md-cell" title="' + esc(title) + '">' +
      frameHtml(e, r) + xpHtml(w, r) + '</div>';
  }

  // marco + placa + corona-tallada, compartido por rejilla y emblemas.
  // La corona NO es una pieza: el canto superior del marco se hace alto (md-cr)
  // y la silueta de la corona se TALLA en él (recorte en negativo del mismo metal).
  function frameHtml(e, r, direct) {
    var img = (window.cardImage ? window.cardImage(e.base) : e.base.image) || '';
    var t = window.PB_MEDAL.tier(r);
    // direct = arte puesto ya (fuera de la vista no hay observador perezoso: VS, etc.)
    var art = direct ? '<div class="md-img" style="background-image:url(&quot;' + esc(img) + '&quot;)"></div>'
                     : '<div class="md-img" data-bg="' + esc(img) + '"></div>';
    if (!t) return '<div class="md-fr md-pre">' + art + '</div>';
    return '<div class="md-fr md-t' + t.metal + (t.crown ? ' md-cr' : '') + '">' + art +
      '<span class="md-plate">' + esc(window.PB_MEDAL.name(r)) + '</span>' +
    '</div>';
  }
  // Emblema por NOMBRE de Pokémon + rango, para pintarlo fuera del Perfil (pantalla VS del
  // online, futuros usos). Reusa el arte base (rareza más baja) y las clases md-*.
  window.pbEmblemHtml = function (name, rank) {
    var k = String(name || '').toLowerCase();
    var e = null, names = buildNames();
    for (var i = 0; i < names.length; i++) if (names[i].name.toLowerCase() === k) { e = names[i]; break; }
    if (!e) return '';
    return frameHtml(e, rank | 0, true);
  };

  // emblema compacto para la fila de equipados (marco+placa, sin barra)
  function emblemHtml(e) {
    var w = winsOf(e);
    var r = window.PB_MEDAL.rankFor(w);
    return '<div class="pf-emb" title="' + esc(e.name + (r ? ' · ' + window.PB_MEDAL.name(r) : '') + ' · ' + w) + '">' +
      frameHtml(e, r) + '</div>';
  }

  function render() {
    var host = document.getElementById('view-perfil');
    if (!host) return;
    var names = buildNames();
    var info = window.pbProfileInfo ? window.pbProfileInfo() : { logged: false, name: '', avatar: '', initial: '?' };
    var list = names.filter(function (e) { return winsOf(e) > 0; });
    var rank = window.SET_RANK || {};
    list.sort(function (a, b) {
      var wa = winsOf(a), wb = winsOf(b);
      if (wb !== wa) return wb - wa;
      var ra = rank[a.base.set] | 0, rb = rank[b.base.set] | 0;
      if (ra !== rb) return ra - rb;
      return String(a.base.number).localeCompare(String(b.base.number), undefined, { numeric: true });
    });
    var tw = (D.stats && D.stats.totalWins) | 0, tg = (D.stats && D.stats.totalGames) | 0;
    var pct = tg ? Math.round((tw / tg) * 100) : 0;
    var hs = historyStats();
    var simLine = '';

    // ── héroe vertical estilo Pocket: identidad → stats → forma reciente ──
    // La IDENTIDAD (avatar editable, nombre editable, correo) la monta js/auth.js en
    // #pf-account: la cuenta es suya y así no se duplica su lógica aquí.
    var h = '<div class="pf-wrap">';
    h += '<div class="pf-hero">' +
      '<div id="pf-account" class="pf-account"></div>' +
      simLine +
      '<div class="pf-stats">' +
        '<div><b>' + tw + '</b><span>' + esc(T2('medal.wins')) + '</span></div>' +
        '<div><b>' + tg + '</b><span>' + esc(T2('medal.games')) + '</span></div>' +
        '<div><b>' + pct + '%</b><span>' + esc(T2('medal.winrate')) + '</span></div>' +
        '<div><b>' + hs.best + '</b><span>' + esc(T2('medal.streak')) + '</span></div>' +
      '</div>' +
      (hs.form.length ? '<div class="pf-form"><span class="pf-form-lb">' + esc(T2('medal.recent')) + '</span>' +
        hs.form.map(function (w) { return '<i class="' + (w ? 'w' : 'l') + '"></i>'; }).join('') + '</div>' : '') +
      // El código de amigo, apartado de la identidad y con sus botones de copiar y editar.
      '<div id="pf-friendcode" class="pf-friendcode"></div>' +
    '</div>';

    if (!D.logged) h += '<div class="pf-note">' + esc(T2('medal.login')) + '</div>';
    else if (D.loaded && !list.length) h += '<div class="pf-note">' + esc(T2('medal.empty')) + '</div>';

    // ── emblemas equipados: SOLO tu selección (persistida + sincronizada). Sin selección
    //    quedan los tres huecos vacíos — los emblemas no se ponen solos (Daniel 2026-08-28).
    //    Solo se equipa lo que ya tiene RANGO (el pre-rango aún no es un emblema). ──
    var ranked = list.filter(function (e) { return window.PB_MEDAL.rankFor(winsOf(e)) >= 1; });
    var selNames = getEquip().filter(function (n) {
      return ranked.some(function (e) { return e.name.toLowerCase() === String(n).toLowerCase(); });
    });
    var equipped = selNames.map(function (n) {
      for (var qi = 0; qi < ranked.length; qi++) if (ranked[qi].name.toLowerCase() === String(n).toLowerCase()) return ranked[qi];
      return null;
    }).filter(Boolean);
    h += '<div class="pf-sect"><span>' + esc(T2('medal.emblems')) + '</span>' +
      (ranked.length ? '<button type="button" id="pf-emb-edit" title="' + esc(T2('medal.editEmblems')) + '"><svg viewBox="0 0 16 16" fill="none"><path d="M11.4 2.5l2.1 2.1-7.2 7.2-2.7.6.6-2.7 7.2-7.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>' : '') +
      '</div>';
    h += '<div class="pf-emblems">';
    for (var s = 0; s < 3; s++) {
      h += equipped[s] ? emblemHtml(equipped[s]) : '<div class="pf-slot"' + (ranked.length ? ' data-open-pick="1" role="button"' : '') + '>+</div>';
    }
    h += '</div>';

    // ── EMOTES DE PARTIDA: el mazo de hasta 10 (los 7 por defecto + los desbloqueados
    //    en misiones). Bocadillos con la CLASE REAL de partida; lápiz → selector. ──
    var view = window.PB_EMOTES.statsView(D.stats);
    var unlocked = window.PB_EMOTES.unlockedFor(view);
    var deck = window.PB_EMOTES.deckFor(view);
    h += '<div class="pf-sect"><span>' + esc(T2('medal.emotes')) + '</span>' +
      '<button type="button" id="pf-emo-edit" title="' + esc(T2('medal.editEmotes')) + '"><svg viewBox="0 0 16 16" fill="none"><path d="M11.4 2.5l2.1 2.1-7.2 7.2-2.7.6.6-2.7 7.2-7.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg></button>' +
      '</div>';
    h += '<div class="pf-emodeck">' + deck.map(function (id) {
      return '<div class="pvp-emote-bubble mine pf-emote pf-emo-chip">' + esc(window.PB_EMOTES.emoteText(id)) + '</div>';
    }).join('') + '</div>';

    // ── MISIONES: fórmulas sobre las stats VERIFICADAS (catálogo en js/mastery.js).
    //    Recompensa = EL EMOTE tal cual se ve en partida (bocadillo real). Se enseñan
    //    las reclamables + las 5 más cercanas; «Ver todas» despliega el resto. ──
    if (D.logged) {
      var claimed = claimedSet();
      var evals = window.PB_EMOTES.evalMissions(view).map(function (r) {
        var got = r.done && !!claimed[r.m.id];
        r.state = got ? 'got' : (r.done ? 'rdy' : 'lk');
        return r;
      });
      var rdy = evals.filter(function (r) { return r.state === 'rdy'; }).sort(function (a, b) { return a.target - b.target; });
      var lk = evals.filter(function (r) { return r.state === 'lk'; }).sort(function (a, b) { return (b.frac - a.frac) || (a.target - b.target); });
      var got = evals.filter(function (r) { return r.state === 'got'; });
      var NEAR = 5;
      // Reclamables SIEMPRE + las bloqueadas más cercanas hasta ~5 (mínimo 1: la próxima).
      // A propósito NO hay «ver todas» (decisión de Daniel): que no se sepa cuánto queda;
      // los emotes que existen sí se ven todos (bloqueados) en el selector del mazo.
      var shown = rdy.concat(lk.slice(0, Math.max(1, NEAR - rdy.length)));
      h += '<div class="pf-sect"><span>' + esc(T2('medal.missions')) + '</span></div>';
      if (!shown.length) h += '<div class="pf-note pf-note-done">' + esc(T2('medal.allDone')) + '</div>';
      h += '<div class="pf-missions">' + shown.map(function (r) {
        var m = r.m, state = r.state;
        var pct = Math.max(4, Math.min(100, Math.round((r.cur / r.target) * 100)));
        var hint = '';
        if (r.hint) hint = (r.hint.nth > 1 ? T2('medal.yourNth', { n: r.hint.nth }) : T2('medal.yourBest')) + ': ' + r.hint.name;
        var icon = m.type === 'wins' || m.type === 'heads'
          ? (m.type === 'heads'
              ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="M12 8v8M9.5 10.2h3.2a1.7 1.7 0 0 1 0 3.4H9.5"/></svg>'
              : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5.5a1 1 0 0 0-1 1.1C4.7 9.6 6 11 8 11.3M16 6h2.5a1 1 0 0 1 1 1.1c-.2 2.5-1.5 3.9-3.5 4.2"/><path d="M12 13v3M9 20h6M10 16h4l1 4H9l1-4z"/></svg>')
          : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5l4.2 3.3L12 6l3.8 5.8L20 8.5 18.4 17H5.6L4 8.5z"/><path d="M6 19.5h12"/></svg>';
        return '<div class="pf-mi ' + state + '" data-mission="' + esc(m.id) + '">' +
          '<div class="pf-mi-ic">' + icon + '</div>' +
          '<div class="pf-mi-body">' +
            '<div class="pf-mi-t">' + esc(window.PB_EMOTES.missionTitle(m)) + '</div>' +
            '<div class="pf-mi-xp"><i style="width:' + pct + '%"></i><span>' + r.cur + ' / ' + r.target + '</span></div>' +
            (hint ? '<div class="pf-mi-n">' + esc(hint) + '</div>' : '') +
          '</div>' +
          '<div class="pf-rw ' + state + '"' + (state === 'rdy' ? ' role="button" tabindex="0" data-mid="' + m.id + '"' : '') + '>' +
            '<div class="pf-rw-in">' +
              '<div class="pvp-emote-bubble mine pf-emote">' + esc(window.PB_EMOTES.emoteText(m.emote)) + '</div>' +
              (state === 'rdy' ? '<span class="pf-rw-claim">' + esc(T2('medal.claim')) + '</span>' : '') +
            '</div>' +
            (state === 'lk' ? '<span class="pf-rw-badge pf-rw-lock" title="' + esc(T2('medal.locked')) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg></span>' : '') +
            (state === 'got' ? '<span class="pf-rw-badge pf-rw-check" title="' + esc(T2('medal.claimed')) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 12.5l4.8 4.8L19.5 7"/></svg></span>' : '') +
          '</div>' +
        '</div>';
      }).join('') + '</div>';
    }

    // ── progreso: la rejilla de maestría, de más a menos ──
    h += '<div class="pf-sect"><span>' + esc(T2('medal.title')) + '</span></div>';
    if (list.length) h += '<div class="md-grid">' + list.map(cellHtml).join('') + '</div>';
    h += '</div>';

    // Gestión de la cuenta, al final del todo: descargar datos, cerrar sesión, borrar cuenta.
    h += '<div id="pf-account-actions" class="pf-account-actions"></div>';


    host.innerHTML = h;
    // La pestaña se re-pinta entera → hay que volver a montar el panel de cuenta.
    if (window.pbRenderProfilePanel) window.pbRenderProfilePanel();

    // reclamar misión: marca persistida + celebración
    host.querySelectorAll('.pf-rw.rdy').forEach(function (rw) {
      var claim = function () {
        var mid = rw.dataset.mid;
        claimMission(mid);
        // el emote recién ganado se EQUIPA solo si el mazo tiene hueco (no hace falta pasar
        // por el selector); con el mazo lleno se queda fuera y se cambia a mano.
        try {
          var E = window.PB_EMOTES;
          var eid = E && E.emoteOfMission ? E.emoteOfMission(mid) : '';
          if (eid) E.equipEmote(eid, E.statsView(D.stats));
        } catch (eE) {}
        try { if (window.pbJuicyBurst) window.pbJuicyBurst(rw); } catch (eJ) {}
        render();
      };
      rw.addEventListener('click', claim);
      rw.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); claim(); } });
    });

    // selector de emotes de partida
    var emoEdit = host.querySelector('#pf-emo-edit');
    if (emoEdit) emoEdit.addEventListener('click', openEmotePick);
    // selector de emblemas
    var embEdit = host.querySelector('#pf-emb-edit');
    if (embEdit) embEdit.addEventListener('click', function () { openPick(list); });
    host.querySelectorAll('[data-open-pick]').forEach(function (b) { b.addEventListener('click', function () { openPick(list); }); });
    armLazy(host);
  }

  // ── Selector de emblemas = LA MISMA mecánica y estética que «Cartas destacadas» de
  //    Mis Mazos (hoja inferior, tocar = numerar 1·2·3, tocar de nuevo = quitar, la X /
  //    fuera / Escape GUARDAN y cierran). Reusa sus clases reales (mz-feat-*, en
  //    mazos-view.css); solo cambia la celda: el emblema (marco+placa) en vez del arte.
  //    Elegibles = Pokémon con rango (≥ Novato); el pre-rango aún no tiene emblema.
  function openPick(list) {
    closePick();
    var pool = (list || []).filter(function (e) { return window.PB_MEDAL.rankFor(winsOf(e)) >= 1; });
    if (!pool.length) return;
    // arranca con LO QUE HAYA EQUIPADO: sin selección, ninguno marcado (los emblemas no se
    // ponen solos — Daniel 2026-08-28). Los eliges tú aquí.
    var sel = getEquip().filter(function (n) { return pool.some(function (e) { return e.name === n; }); });

    var modal = document.createElement('div');
    modal.id = 'pf-pick-ov'; modal.className = 'mz-feat-modal pf-pick-modal';
    var sheet = document.createElement('div');
    sheet.className = 'mz-feat-sheet';
    var title = document.createElement('div');
    title.className = 'mz-feat-title';
    title.textContent = T2('medal.pick');
    var grid = document.createElement('div');
    grid.className = 'mz-feat-grid pf-pick-grid';

    function renderNums() {
      grid.querySelectorAll('.pf-pick-c').forEach(function (cell) {
        var n = sel.indexOf(cell.dataset.pick);
        cell.classList.toggle('sel', n >= 0);
        var badge = cell.querySelector('.mz-feat-num');
        if (n >= 0) { badge.textContent = (n + 1); badge.style.display = 'flex'; }
        else badge.style.display = 'none';
      });
    }
    pool.forEach(function (e) {
      var cell = document.createElement('div');
      cell.className = 'mz-feat-card pf-pick-c'; cell.dataset.pick = e.name;
      cell.innerHTML = frameHtml(e, window.PB_MEDAL.rankFor(winsOf(e))) + '<div class="mz-feat-num" style="display:none"></div>';
      cell.addEventListener('click', function () {
        var at = sel.indexOf(e.name);
        if (at >= 0) sel.splice(at, 1);            // quitar (renumera)
        else if (sel.length < 3) sel.push(e.name);
        else return;                               // ya hay 3
        renderNums();
      });
      grid.appendChild(cell);
    });
    renderNums();
    // artes directas: el observador perezoso de la vista no ve un overlay fijo en body
    grid.querySelectorAll('.md-img[data-bg]').forEach(function (el) {
      el.style.backgroundImage = 'url("' + el.dataset.bg + '")'; delete el.dataset.bg;
    });

    var done = document.createElement('button');
    done.className = 'mz-feat-done'; done.type = 'button'; done.id = 'pf-pick-done';
    done.setAttribute('aria-label', T2('medal.ok'));
    done.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    function save() { setEquip(sel); closePick(); render(); }
    done.addEventListener('click', save);
    sheet.appendChild(title); sheet.appendChild(grid);
    modal.appendChild(sheet); modal.appendChild(done);
    modal.addEventListener('pointerdown', function (ev) { if (ev.target === modal) save(); });
    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('open'); });
    modal._esc = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); save(); } };
    document.addEventListener('keydown', modal._esc, true);
  }
  function closePick() {
    var m = document.getElementById('pf-pick-ov');
    if (!m) return;
    if (m._esc) document.removeEventListener('keydown', m._esc, true);
    m.remove();
  }

  // ── Selector del MAZO DE EMOTES: la MISMA mecánica que las cartas destacadas / los
  //    emblemas (hoja inferior, tocar = numerar 1…10, tocar de nuevo = quitar, X/fuera/Esc
  //    GUARDAN). Celdas = el bocadillo real; los no desbloqueados salen atenuados con
  //    candado (no se pueden elegir). El orden elegido = el orden del menú en partida. ──
  function openEmotePick() {
    closeEmotePick();
    var E = window.PB_EMOTES;
    var view = E.statsView(D.stats), unlocked = E.unlockedFor(view);
    var sel = E.deckFor(view).slice();
    var modal = document.createElement('div');
    modal.id = 'pf-emo-ov'; modal.className = 'mz-feat-modal pf-pick-modal';
    var sheet = document.createElement('div');
    sheet.className = 'mz-feat-sheet';
    var title = document.createElement('div');
    title.className = 'mz-feat-title';
    title.textContent = T2('medal.pickEmotes');
    var count = document.createElement('div');
    count.className = 'pf-emo-count';
    var grid = document.createElement('div');
    grid.className = 'mz-feat-grid pf-emo-grid';
    function paint() {
      count.textContent = T2('medal.emoteCount', { n: sel.length, max: E.DECK_SIZE });
      grid.querySelectorAll('.pf-emo-c').forEach(function (cell) {
        var n = sel.indexOf(cell.dataset.emote);
        cell.classList.toggle('sel', n >= 0);
        var badge = cell.querySelector('.mz-feat-num');
        if (n >= 0) { badge.textContent = (n + 1); badge.style.display = 'flex'; }
        else badge.style.display = 'none';
      });
    }
    E.CATALOG.forEach(function (id) {
      var can = E.isDefault(id) || !!unlocked[id];
      var cell = document.createElement('div');
      cell.className = 'mz-feat-card pf-emo-c' + (can ? '' : ' locked'); cell.dataset.emote = id;
      cell.innerHTML = '<div class="pvp-emote-bubble mine pf-emote">' + esc(E.emoteText(id)) + '</div>' +
        (can ? '' : '<span class="pf-rw-badge pf-rw-lock" title="' + esc(T2('medal.locked')) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg></span>') +
        '<div class="mz-feat-num" style="display:none"></div>';
      cell.addEventListener('click', function () {
        if (!can) return;
        var at = sel.indexOf(id);
        if (at >= 0) sel.splice(at, 1);
        else if (sel.length < E.DECK_SIZE) sel.push(id);
        else return;
        paint();
      });
      grid.appendChild(cell);
    });
    paint();
    var done = document.createElement('button');
    done.className = 'mz-feat-done'; done.type = 'button'; done.id = 'pf-emo-done';
    done.setAttribute('aria-label', T2('medal.ok'));
    done.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    function save() { E.saveDeck(sel); closeEmotePick(); render(); }
    done.addEventListener('click', save);
    sheet.appendChild(title); sheet.appendChild(count); sheet.appendChild(grid);
    modal.appendChild(sheet); modal.appendChild(done);
    modal.addEventListener('pointerdown', function (ev) { if (ev.target === modal) save(); });
    document.body.appendChild(modal);
    requestAnimationFrame(function () { modal.classList.add('open'); });
    modal._esc = function (ev) { if (ev.key === 'Escape') { ev.stopPropagation(); save(); } };
    document.addEventListener('keydown', modal._esc, true);
  }
  function closeEmotePick() {
    var m = document.getElementById('pf-emo-ov');
    if (!m) return;
    if (m._esc) document.removeEventListener('keydown', m._esc, true);
    m.remove();
  }

  // ── integración con la app ──
  window._perfilInit = function () {
    window._perfilInitialised = true;
    render();       // pinta ya el héroe mientras llegan las stats
    loadStats();
  };
  window._perfilRefresh = function () { loadStats(); };

  window.addEventListener('langchange', function () { if (window._perfilInitialised) render(); });
  window.addEventListener('pb-auth', function () { if (window._perfilInitialised) loadStats(); });
})();
