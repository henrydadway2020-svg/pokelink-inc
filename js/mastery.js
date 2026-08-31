// ═══════════════════════════════════════════════════════════════════════════
// MAESTRÍA POKÉMON — escalera de rangos, catálogo de EMOTES y MISIONES.
// Fuente ÚNICA de verdad que comparten el Perfil (medallero-view.js), la partida
// online (pvp-sync.js: menú de emotes + validación de los del rival) y el resto.
// Sin DOM. Carga temprano (tras formats.js). Ver memoria maestrias-pokedex-victorias.
//
// Anti-fake: las MISIONES son fórmulas sobre las stats VERIFICADAS (las escribe la
// Cloud Function; el cliente solo lee). «Desbloqueado» = la misión está cumplida
// según esas stats — reclamarla en el Perfil es ceremonia. El rival valida cada
// emote que recibe contra la PROYECCIÓN PÚBLICA del emisor (users/{uid}/public/
// profile, también escrita solo por la función) con ESTE MISMO código, así que
// un cliente modificado no puede enseñar un emote que no se ha ganado.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Escalera de 8 rangos (números de Daniel, 2026-08-14). El NOMBRE va grabado en
  //    la placa del marco (i18n medal.r1..r8); metal: 1 acero · 2 bronce · 3 plata ·
  //    4 oro · 5 prisma; la corona es el paso intermedio de cada metal. ──
  var TIERS = [
    { at: 5,   k: 'r1', metal: 1, crown: false },
    { at: 15,  k: 'r2', metal: 2, crown: false },
    { at: 40,  k: 'r3', metal: 3, crown: false },
    { at: 50,  k: 'r4', metal: 3, crown: true  },
    { at: 80,  k: 'r5', metal: 4, crown: false },
    { at: 100, k: 'r6', metal: 4, crown: true  },
    { at: 200, k: 'r7', metal: 5, crown: false },
    { at: 300, k: 'r8', metal: 5, crown: true  }
  ];
  window.PB_MEDAL = {
    tiers: TIERS,
    rankFor: function (w) { var r = 0; for (var i = 0; i < TIERS.length; i++) if (w >= TIERS[i].at) r = i + 1; return r; },
    prevAt: function (rank) { return rank <= 0 ? 0 : TIERS[rank - 1].at; },
    nextAt: function (rank) { return rank >= TIERS.length ? null : TIERS[rank].at; },
    tier: function (rank) { return rank > 0 ? TIERS[rank - 1] : null; },
    name: function (rank) { return rank > 0 ? (window.t ? window.t('medal.' + TIERS[rank - 1].k) : TIERS[rank - 1].k) : ''; }
  };

  function T2(k, v) { return window.t ? window.t(k, v) : k; }

  // ── CATÁLOGO DE EMOTES (lista de Daniel, 2026-08-15). El ID es lo que viaja por la
  //    sala; cada cliente lo pinta en SU idioma (i18n emote.<id>). Máx ~15 caracteres. ──
  var DEFAULTS = ['hi', 'gl', 'gg', 'nice', 'thanks', 'wow', 'oops'];
  var UNLOCKABLE = ['sure', 'calc', 'topdeck', 'thinking', 'zzz', 'norush', 'gg2', 'nope', 'qqq',
                    'greatdeck', 'thisisfine', 'energy', 'skill', 'unrivaled',
                    'gotcyrus', 'getoverhere', 'boss', 'allheads', 'mindbench', 'outtahere'];
  var CATALOG = DEFAULTS.concat(UNLOCKABLE);
  var DECK_SIZE = 10;

  // ── MISIONES → cada una desbloquea UN emote. Tipos:
  //    wins  {n}            victorias en línea totales
  //    rank  {rank, count}  «count» Pokémon (SOLO Pokémon) con rango ≥ rank
  //    card  {name, rank}   una carta concreta (por NOMBRE inglés; reimpresiones suman) a ese rango
  //    heads {n}            caras (monedas ganadas) acumuladas en partida ──
  var MISSIONS = [
    { id: 'w10',  type: 'wins', n: 10,  emote: 'sure' },
    { id: 'w25',  type: 'wins', n: 25,  emote: 'calc' },
    { id: 'w50',  type: 'wins', n: 50,  emote: 'topdeck' },
    { id: 'w75',  type: 'wins', n: 75,  emote: 'thinking' },
    { id: 'w100', type: 'wins', n: 100, emote: 'zzz' },
    { id: 'w150', type: 'wins', n: 150, emote: 'norush' },
    { id: 'w200', type: 'wins', n: 200, emote: 'gg2' },
    { id: 'w300', type: 'wins', n: 300, emote: 'nope' },
    { id: 'w400', type: 'wins', n: 400, emote: 'qqq' },
    { id: 'rv1',  type: 'rank', rank: 3, count: 1, emote: 'greatdeck' },
    { id: 're1',  type: 'rank', rank: 6, count: 1, emote: 'thisisfine' },
    { id: 're3',  type: 'rank', rank: 6, count: 3, emote: 'energy' },
    { id: 'rm1',  type: 'rank', rank: 8, count: 1, emote: 'skill' },
    { id: 'rm3',  type: 'rank', rank: 8, count: 3, emote: 'unrivaled' },
    { id: 'cy5',  type: 'card', name: 'Cyrus',   rank: 5, emote: 'gotcyrus' },
    { id: 'cy7',  type: 'card', name: 'Cyrus',   rank: 7, emote: 'getoverhere' },
    { id: 'cy8',  type: 'card', name: 'Cyrus',   rank: 8, emote: 'boss' },
    { id: 'sa5',  type: 'card', name: 'Sabrina', rank: 5, emote: 'mindbench' },
    { id: 'sa7',  type: 'card', name: 'Sabrina', rank: 7, emote: 'outtahere' },
    { id: 'h1000', type: 'heads', n: 1000, emote: 'allheads' }
  ];

  // ── VISTA de stats: agrupa las victorias por-impresión del doc en NOMBRES (las
  //    reimpresiones suman) y separa Pokémon de Entrenadores. Vale igual para MIS stats
  //    (users/{uid}/pvpStats/derived) que para la proyección pública de otro jugador. ──
  function statsView(stats) {
    var v = { totalWins: 0, totalGames: 0, heads: 0, byName: {}, pokemon: [], trainers: [],
              streaks: { standard: 0, advanced: 0, draft: 0 }, bestStreaks: { standard: 0, advanced: 0, draft: 0 } };
    if (!stats || typeof stats !== 'object') return v;
    v.totalWins = stats.totalWins | 0; v.totalGames = stats.totalGames | 0; v.heads = stats.heads | 0;
    // rachas VERIFICADAS por el servidor (las escribe la Cloud Function; el cliente no las inventa)
    ['streaks', 'bestStreaks'].forEach(function (key) {
      var src = stats[key];
      if (!src || typeof src !== 'object') return;
      Object.keys(v[key]).forEach(function (m) {
        var n = src[m];
        v[key][m] = (typeof n === 'number' && isFinite(n) && n > 0) ? Math.floor(n) : 0;
      });
    });
    var w = stats.wins || {};
    Object.keys(w).forEach(function (id) {
      var db = window.dbLookup ? window.dbLookup({ id: id }) : null;
      if (!db || !db.name) return;
      var k = db.name.toLowerCase();
      var e = v.byName[k];
      if (!e) e = v.byName[k] = { name: db.name, wins: 0, isPokemon: db.cardType === 'pokemon' };
      e.wins += (w[id] | 0);
    });
    Object.keys(v.byName).forEach(function (k) {
      var e = v.byName[k];
      e.rank = window.PB_MEDAL.rankFor(e.wins);
      (e.isPokemon ? v.pokemon : v.trainers).push(e);
    });
    v.pokemon.sort(function (a, b) { return b.wins - a.wins; });
    v.trainers.sort(function (a, b) { return b.wins - a.wins; });
    return v;
  }

  // ── EVALUAR las misiones contra una vista → [{m, cur, target, done, hint}] ──
  //    Las de rango miden en VICTORIAS del Pokémon que decide (el mejor / el n-ésimo
  //    mejor), así todas las barras son «victorias» y se comparan entre sí.
  function evalMissions(view) {
    var v = view || statsView(null);
    return MISSIONS.map(function (m) {
      var cur = 0, target = 1, hint = null;
      if (m.type === 'wins') { cur = v.totalWins; target = m.n; }
      else if (m.type === 'heads') { cur = v.heads; target = m.n; }
      else if (m.type === 'rank') {
        target = TIERS[m.rank - 1].at;
        var nth = v.pokemon[m.count - 1];   // el «count»-ésimo mejor Pokémon decide
        cur = nth ? nth.wins : 0;
        if (nth && nth.wins < target) hint = { name: nth.name, nth: m.count };
      } else if (m.type === 'card') {
        target = TIERS[m.rank - 1].at;
        var e = v.byName[m.name.toLowerCase()];
        cur = e ? e.wins : 0;
      }
      cur = Math.min(cur, target);
      return { m: m, cur: cur, target: target, done: cur >= target, frac: target ? cur / target : 0, hint: hint };
    });
  }
  function unlockedFor(view) {
    var set = {};
    evalMissions(view).forEach(function (r) { if (r.done) set[r.m.emote] = true; });
    return set;
  }
  function isDefault(id) { return DEFAULTS.indexOf(id) >= 0; }
  function isKnown(id) { return CATALOG.indexOf(id) >= 0; }
  // ¿puede ESTE jugador (según una vista de stats) usar este emote?
  function allowed(id, view) { return isDefault(id) || (isKnown(id) && !!unlockedFor(view)[id]); }
  // la misión NO cumplida más cercana (para el teaser en partida y el orden del Perfil)
  function nearestLocked(view) {
    var best = null;
    evalMissions(view).forEach(function (r) {
      if (r.done) return;
      if (!best || r.frac > best.frac || (r.frac === best.frac && r.target < best.target)) best = r;
    });
    return best;
  }

  // ── Título de una misión (localizado; las de carta usan el nombre localizado de la carta) ──
  function missionTitle(m) {
    if (m.type === 'wins') return T2('medal.mWins', { n: m.n });
    if (m.type === 'heads') return T2('medal.mHeads', { n: m.n });
    var r = window.PB_MEDAL.name(m.rank);
    if (m.type === 'rank') return m.count > 1 ? T2('medal.mRankN', { n: m.count, r: r }) : T2('medal.mRank', { r: r });
    if (m.type === 'card') {
      var name = m.name;
      if (window.cardName && window.CARDS_DB) {
        for (var i = 0; i < window.CARDS_DB.length; i++) { var c = window.CARDS_DB[i]; if (c && c.name === m.name) { name = window.cardName(c) || m.name; break; } }
      }
      return T2('medal.mCard', { name: name, r: r });
    }
    return m.id;
  }
  function emoteText(id) { return isKnown(id) ? T2('emote.' + id) : null; }

  // ── MAZO de emotes de partida: hasta 10 elegidos por el jugador (persistido y
  //    sincronizado); sin elección → los 7 por defecto + desbloqueados en orden del
  //    catálogo. Nunca contiene emotes que no estén desbloqueados para esta vista. ──
  var DECK_KEY = 'pocketboard_emote_deck_v1';
  function savedDeck() {
    try { var a = JSON.parse(localStorage.getItem(DECK_KEY) || '[]'); return Array.isArray(a) ? a.filter(isKnown) : []; } catch (e) { return []; }
  }
  function saveDeck(ids) { try { localStorage.setItem(DECK_KEY, JSON.stringify(ids.slice(0, DECK_SIZE))); } catch (e) {} }
  function deckFor(view) {
    var unl = unlockedFor(view);
    var ok = function (id) { return isDefault(id) || !!unl[id]; };
    var chosen = savedDeck().filter(ok).slice(0, DECK_SIZE);
    if (chosen.length) return chosen;
    return CATALOG.filter(ok).slice(0, DECK_SIZE);
  }
  function hasSavedDeck() { return savedDeck().length > 0; }
  // Emote que desbloquea una misión (por id de misión)
  function emoteOfMission(id) {
    for (var i = 0; i < MISSIONS.length; i++) if (MISSIONS[i].id === id) return MISSIONS[i].emote || '';
    return '';
  }
  // Al RECLAMAR una misión su emote entra SOLO en el mazo si queda hueco (Daniel 2026-08-28):
  // el mazo trae huecos libres de fábrica (7 por defecto de 10) y no tiene sentido obligar a
  // ir al selector. Con el mazo lleno NO se toca nada: una elección hecha no se pisa.
  function equipEmote(id, view) {
    if (!id) return false;
    var deck = deckFor(view);
    if (deck.indexOf(id) >= 0) return false;
    if (deck.length >= DECK_SIZE) return false;
    deck.push(id);
    saveDeck(deck);
    return true;
  }

  // El build público conserva implementaciones nulas; la fuente local las sustituye
  // dentro del bloque que build_public.py elimina físicamente.
  var devLoose = function () { return false; };
  var devSim = function () { return null; };

  // ── MIS stats en caché (para el menú de partida): las carga quien las tenga a mano ──
  var mine = { view: null, uid: null, loading: null };
  function setMyStats(stats, uid) { mine.view = statsView(stats); mine.uid = uid || null; }
  function myView() { return mine.view || statsView(null); }
  // Tras una partida online mis stats CAMBIAN en el servidor (racha, victorias, misiones) y
  // la función tarda de 1 s a varios minutos en escribirlas. Olvidar la caché al terminar es
  // lo que hace que el hub y el Perfil enseñen el dato nuevo sin recargar la página.
  function forgetMine() { mine.view = null; mine.loading = null; }
  function loadMine(force) {
    var a = window.pbAccount && window.pbAccount();
    var uid = a && a.uid;
    var sim = devSim();
    if (sim) { mine.view = statsView(sim); mine.uid = uid || null; return Promise.resolve(mine.view); }
    if (!uid || !(window.pbDB && window.pbDB.loadPvpStats)) return Promise.resolve(myView());
    if (!force && mine.view && mine.uid === uid) return Promise.resolve(mine.view);
    if (mine.loading && mine.uid === uid) return mine.loading;
    mine.uid = uid;
    mine.loading = window.pbDB.loadPvpStats(uid).then(function (s) { mine.view = statsView(s); mine.loading = null; return mine.view; })
      .catch(function () { mine.loading = null; return myView(); });
    return mine.loading;
  }
  // ── Proyección PÚBLICA de otro jugador (users/{uid}/public/profile): caché por uid ──
  var pub = {};
  function loadPublic(uid) {
    if (!uid) return Promise.resolve(null);
    if (pub[uid] && pub[uid].view !== undefined) return Promise.resolve(pub[uid].view);
    if (pub[uid] && pub[uid].p) return pub[uid].p;
    if (!(window.pbDB && window.pbDB.loadPublic)) return Promise.resolve(null);
    var entry = pub[uid] = {};
    entry.p = window.pbDB.loadPublic(uid).then(function (s) { entry.view = s ? statsView(s) : null; entry.p = null; return entry.view; })
      .catch(function () { entry.view = null; entry.p = null; return null; });
    return entry.p;
  }
  function publicView(uid) { return (pub[uid] && pub[uid].view) || null; }
  function forgetPublic(uid) { if (uid) delete pub[uid]; }

  // ── EMBLEMAS EQUIPADOS (hasta 3, misma clave que el Perfil): SOLO mi selección guardada,
  //    filtrada a los que tienen rango en esta vista. Sin selección NO se equipa nada: los
  //    emblemas los elige el jugador (Daniel, 2026-08-28 — al revés que los emotes, que sí
  //    entran solos al reclamarlos). ──
  var EMB_KEY = 'pocketboard_emblems_v1';
  function equipped(view) {
    var v = view || statsView(null);
    var saved = [];
    try { var a = JSON.parse(localStorage.getItem(EMB_KEY) || '[]'); saved = Array.isArray(a) ? a.slice(0, 3) : []; } catch (e) {}
    var out = [];
    saved.forEach(function (n) { var e = v.byName[String(n).toLowerCase()]; if (e && e.isPokemon && e.rank >= 1) out.push({ name: e.name, rank: e.rank }); });
    return out.slice(0, 3);
  }
  // Rango de un Pokémon (por nombre) según una vista — para VALIDAR los emblemas del rival
  function rankOf(view, name) { var e = view && view.byName[String(name || '').toLowerCase()]; return e && e.isPokemon ? e.rank : 0; }

  window.PB_EMOTES = {
    devLoose: devLoose, equipped: equipped, rankOf: rankOf,   // receptor en local/LAN sin proyección del rival → acepta los conocidos (solo pruebas)
    DEFAULTS: DEFAULTS, UNLOCKABLE: UNLOCKABLE, CATALOG: CATALOG, DECK_SIZE: DECK_SIZE, MISSIONS: MISSIONS,
    statsView: statsView, evalMissions: evalMissions, unlockedFor: unlockedFor, allowed: allowed,
    isDefault: isDefault, isKnown: isKnown, nearestLocked: nearestLocked,
    missionTitle: missionTitle, emoteText: emoteText,
    savedDeck: savedDeck, saveDeck: saveDeck, deckFor: deckFor, hasSavedDeck: hasSavedDeck, DECK_KEY: DECK_KEY,
    emoteOfMission: emoteOfMission, equipEmote: equipEmote,
    setMyStats: setMyStats, myView: myView, loadMine: loadMine, forgetMine: forgetMine,
    loadPublic: loadPublic, publicView: publicView, forgetPublic: forgetPublic
  };
})();
