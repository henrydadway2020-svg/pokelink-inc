/* js/formats.js — Sistema de formatos de tcgmini (Fase 0 del modo Advanced).
 *
 * Un FORMATO = reglas de mazo (tamaño, copias por nombre, puntos para ganar,
 *             mano inicial, mulligan) + ban list + set de cartas custom que añade al pool.
 *
 * Estándar = formato #1 (20 / 2 copias / 3 puntos, mano 5, sin mulligan; pool = reales, sin bans).
 * Advanced = formato #2 (30 / 2 copias / 4 puntos, mano 6, mulligan opcional).
 *            Sus bans y customs se rellenan en fases posteriores (Fase 2: bans; Fase 3: customs).
 *
 * Un mazo LLEVA su formato en `deck.format`. Los mazos antiguos no lo tienen →
 * se infiere por tamaño (20→standard, 30→advanced) y, si no cuadra, cae a Estándar.
 * Así NO hace falta migrar el localStorage: se resuelve al leer (patrón del proyecto).
 *
 * Todo se expone en window.*, sin dependencias, JSON-safe. Cargar DESPUÉS de
 * shared.js / i18n.js / cards.db (solo se usan en RUNTIME, no al cargar).
 *
 * MÓDULO AISLADO: de momento nadie lo llama. La integración (contador del pill,
 * validación del builder/online, mano inicial, mulligan, marcador del tablero)
 * va en tandas siguientes.
 */
(function () {
  'use strict';

  // --- Registro de formatos -------------------------------------------------
  // Datos puros. `banList` y `customSet` son ids de carta (p.ej. 'A1-089').
  // Vacíos de momento; se rellenan en Fase 2/3 (y en el futuro, en vivo).
  var FORMATS = {
    standard: {
      id: 'standard',
      nameKey: 'format.standard',
      nameFallback: 'Estándar',
      deckSize: 20,
      maxCopies: 2,
      points: 3,
      initialHand: 5,   // como el Pocket real
      mulligan: null,   // Estándar = fiel al juego real, sin mulligan
      banList: [],
      customSet: [],   // Estándar = solo cartas reales de Pocket (fiel al juego)
      // RELOJES de la partida online (ms). Viven en el FORMATO porque una partida de
      // Advanced (30 cartas, 4 puntos) dura bastante más que una Estándar.
      //   setup  = fase de colocación (poner básicos antes de empezar) → agotarlo = derrota
      //   turn   = tiempo por turno (Pocket real: 90s → fin de turno automático)
      //   match  = tope TOTAL por jugador (Pocket real: 20 min → se comparan puntos; empate si van iguales)
      clock: { setup: 45000, turn: 90000, match: 20 * 60000 },
    },
    advanced: {
      id: 'advanced',
      nameKey: 'format.advanced',
      nameFallback: 'Advanced',
      deckSize: 30,
      maxCopies: 2,
      points: 4,
      initialHand: 6,   // 1 más que Estándar (más consistencia con 30 cartas)
      // Mulligan opcional. Config CONFIRMADA (2026-08-13, Opción A + cap 1 + sin reveal):
      //   always=true  -> se puede mulligan con CUALQUIER mano (sin regla de nº de básicos)
      //   maxPerPlayer=1 -> un solo mulligan por jugador (cap duro)
      //   opponentDraws=1 -> por cada mulligan, el rival roba +1 carta inicial (tope de mano 10)
      //   keepBasicGuarantee=true -> la mano rebarajada sigue garantizando ≥1 básico
      //   reveal=false -> NO se enseña la mano al rival (evita fuga de info)
      mulligan: {
        always: true,
        maxPerPlayer: 1,
        opponentDraws: 1,
        handCap: 10,
        keepBasicGuarantee: true,
        reveal: false,
      },
      // Ban list de Advanced. Filosofía: «fiel de base, pero mejor donde Pocket es malo» —
      // fuera lo que se decide por un azar que no se juega. La fidelidad pura vive en el Sandbox.
      // OJO: se banea POR IMPRESIÓN (id), NUNCA por nombre: hay cartas distintas que comparten
      // nombre (el Darkrai de «Aura de Pesadilla» NO es el de «Malos Sueños» y sí se juega).
      // Si un set futuro reimprime una baneada, hay que añadir su id aquí.
      banList: [
        'B2-145',    // Lucky Ice Pop  — cura 20 y, a cara, vuelve a la mano: lotería pura
        'B2B-040',   // Darkrai «Malos Sueños» — 20 por turno al Activo dormido, sin interacción
      ],
      // Cartas CUSTOM (las que no existen en Pocket: data/custom.cards.js). 'all' = todas las
      // horneadas; también admite una lista de ids ['CU-001','CU-003'] si algún día hay
      // alguna que NO deba ser legal aquí. Con 'all' no hay dos listas que mantener a la vez.
      customSet: 'all',
      // Advanced dura más: mano de 6, 30 cartas y 4 puntos → colocación y tope global más largos.
      clock: { setup: 60000, turn: 90000, match: 30 * 60000 },
    },
  };

  var DEFAULT_FORMAT = 'standard';
  var ORDER = ['standard', 'advanced']; // orden de presentación

  function formatDef(id) {
    return FORMATS[id] || FORMATS[DEFAULT_FORMAT];
  }

  // --- Resolución del formato de un mazo ------------------------------------
  // Un mazo de 20 no puede ser Advanced y uno de 30 no puede ser Estándar: el
  // tamaño casi decide el formato. Pero `deck.format` explícito manda siempre
  // (p.ej. un Advanced a medias con 15 cartas ya sabe que va camino de 30).
  function inferBySize(deck) {
    var n = (deck && deck.cards) ? deck.cards.length : 0;
    if (!n) return null;
    for (var i = 0; i < ORDER.length; i++) {
      if (FORMATS[ORDER[i]].deckSize === n) return ORDER[i];
    }
    return null;
  }
  function formatIdOf(deck) {
    if (deck && deck.format && FORMATS[deck.format]) return deck.format;
    return inferBySize(deck) || DEFAULT_FORMAT;
  }
  function formatOf(deck) {
    return formatDef(formatIdOf(deck));
  }

  // Nombre por idioma (fallback interno). Si algún día data/i18n.js trae format.* mandan esas.
  // El nombre del formato #2 es «Advanced» / «Avanzado» (NO «Evolved»).
  var NAME_FALLBACK = {
    standard: { en: 'Standard', es: 'Estándar', it: 'Standard', fr: 'Standard', pt: 'Padrão', ja: 'スタンダード', ko: '스탠더드' },
    advanced: { en: 'Advanced', es: 'Avanzado', it: 'Avanzato', fr: 'Avancé', pt: 'Avançado', ja: 'アドバンス', ko: '어드밴스드' },
  };
  function formatName(id) {
    var f = formatDef(id);
    if (typeof window.t === 'function') {
      var s = window.t(f.nameKey);
      if (s && s !== f.nameKey) return s;   // i18n manda si existe la clave
    }
    var lang = (window.i18n && window.i18n.getLang) ? window.i18n.getLang() : 'en';
    var m = NAME_FALLBACK[id];
    return (m && (m[lang] || m.en)) || f.nameFallback;
  }

  // --- Reglas por formato (para el pill, el builder y el tablero) -----------
  // Aceptan un id de formato ('advanced') o un objeto mazo (resuelve su formato).
  function ruleOf(fmtOrDeck) {
    return typeof fmtOrDeck === 'string' ? formatDef(fmtOrDeck) : formatOf(fmtOrDeck);
  }
  function deckSizeFor(fmtOrDeck) { return ruleOf(fmtOrDeck).deckSize; }
  function maxCopiesFor(fmtOrDeck) { return ruleOf(fmtOrDeck).maxCopies; }
  function pointsFor(fmtOrDeck) { return ruleOf(fmtOrDeck).points; }
  function initialHandFor(fmtOrDeck) { return ruleOf(fmtOrDeck).initialHand; }
  function mulliganFor(fmtOrDeck) { return ruleOf(fmtOrDeck).mulligan; }
  // Relojes del formato, con fallback a los de Estándar (un formato futuro sin `clock`
  // no deja la partida sin reloj).
  var CLOCK_FALLBACK = { setup: 45000, turn: 90000, match: 20 * 60000 };
  function clockFor(fmtOrDeck) {
    var c = ruleOf(fmtOrDeck).clock || {};
    return {
      setup: c.setup || CLOCK_FALLBACK.setup,
      turn: c.turn || CLOCK_FALLBACK.turn,
      match: c.match || CLOCK_FALLBACK.match,
    };
  }

  // ¿Está baneada esta carta en el formato? (por id de carta)
  function isBanned(card, fmtId) {
    var f = formatDef(fmtId);
    if (!f.banList || !f.banList.length) return false;
    var id = (card && typeof card === 'object') ? (card.id || '') : (card || '');
    return f.banList.indexOf(id) !== -1;
  }

  // ¿Puede jugarse esta carta CUSTOM en el formato? (las reales no pasan por aquí)
  // `_temp` = cartas viejas subidas al navegador de un solo usuario: NUNCA son legales
  // (el rival no las tiene; solo valen en el Tablero libre, que no valida nada).
  function isCustomAllowed(card, fmtId) {
    if (!card) return false;
    if (card._temp) return false;
    var f = formatDef(fmtId);
    var cs = f.customSet;
    if (cs === 'all') return true;
    if (!cs || !cs.length) return false;
    return cs.indexOf(card.id || '') !== -1;
  }

  // --- Validación de mazo por formato ---------------------------------------
  // Generaliza el validateDeck de pvp.js (que hoy hardcodea 20 y 2). Devuelve
  // { ok, reasons:[{k,vars}] } con las MISMAS claves i18n que pvp (pvp.deck*)
  // para reutilizar textos, más `format.banned` para cartas en la ban list.
  // `deck` puede ser un objeto mazo {cards:[...]} o directamente un array de cartas.
  function validateDeck(deck, fmtId) {
    var cards = (deck && deck.cards) ? deck.cards : (Array.isArray(deck) ? deck : []);
    var id = fmtId || formatIdOf(deck);
    var f = formatDef(id);
    var reasons = [];

    if (cards.length !== f.deckSize) {
      reasons.push({ k: 'pvp.deckCount', vars: { n: cards.length, size: f.deckSize } });
    }

    var counts = {}, firstByKey = {};
    var hasCustom = false, hasBasic = false, unknown = 0, banned = null, badCustom = null;
    for (var i = 0; i < cards.length; i++) {
      var c = cards[i];
      if (c._temp || !c.id) { hasCustom = true; continue; }
      var db = window.dbLookup ? window.dbLookup(c) : null;
      if (!db) { unknown++; continue; }
      // Custom horneada (CU-00N): legal solo si el formato la admite.
      if (db.custom && !isCustomAllowed(db, id)) { if (!badCustom) badCustom = db; continue; }
      if (!banned && isBanned(c, id)) banned = c;
      var key = String(c.name || c.id).toLowerCase();
      counts[key] = (counts[key] || 0) + 1;
      if (!firstByKey[key]) firstByKey[key] = c;
      if (!hasBasic && window.isBasicPokemon && window.isBasicPokemon(c)) hasBasic = true;
    }
    if (hasCustom) reasons.push({ k: 'pvp.deckCustom', vars: null });
    if (badCustom) {
      var cn = (window.cardName ? window.cardName(badCustom) : badCustom.name) || '';
      reasons.push({ k: 'format.customNotAllowed', vars: { name: cn } });
    }
    if (unknown) reasons.push({ k: 'pvp.deckUnknown', vars: null });
    for (var k2 in counts) {
      if (counts[k2] > f.maxCopies) {
        var card = firstByKey[k2];
        var nm = (window.cardName && card) ? window.cardName(card) : (card && card.name) || k2;
        reasons.push({ k: 'pvp.deckCopies', vars: { name: nm, max: f.maxCopies } });
        break; // con señalar la primera basta
      }
    }
    if (!hasBasic) reasons.push({ k: 'pvp.deckNoBasic', vars: null });
    if (banned) {
      var bn = (window.cardName ? window.cardName(banned) : banned.name) || '';
      reasons.push({ k: 'format.banned', vars: { name: bn } });
    }
    return { ok: reasons.length === 0, reasons: reasons };
  }

  // --- Export ---------------------------------------------------------------
  window.PB_FORMATS = FORMATS;
  window.PB_FORMAT_ORDER = ORDER;
  window.PB_DEFAULT_FORMAT = DEFAULT_FORMAT;
  window.formatDef = formatDef;
  window.formatIdOf = formatIdOf;
  window.formatOf = formatOf;
  window.formatName = formatName;
  window.deckSizeFor = deckSizeFor;
  window.maxCopiesFor = maxCopiesFor;
  window.pointsFor = pointsFor;
  window.initialHandFor = initialHandFor;
  window.mulliganFor = mulliganFor;
  window.formatClock = clockFor;
  window.isCardBanned = isBanned;
  window.isCustomAllowedIn = isCustomAllowed;
  window.validateDeckForFormat = validateDeck;
})();
