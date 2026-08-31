/* ===========================================================================
 * board-engine.js — Motor de ESTADO del tablero (Pokémon TCG Pocket).
 *
 * TANDA 1 del "motor de reglas del tablero" (ver memoria motor-reglas-tablero).
 *
 * Esto es el SUSTRATO: un modelo de datos puro, SIN DOM, sobre el que operarán
 * los efectos de carta (tandas siguientes). No toca el tablero actual (sigue en
 * modo sandbox manual); se carga inerte y se expone como window.PBEngine para
 * que el wiring posterior y los tests lo usen.
 *
 * Reglas de Pocket codificadas (verificadas en web 2026-06-18):
 *  - 5 condiciones especiales: envenenado, quemado, dormido, paralizado, confuso.
 *    · Dormido/Paralizado/Confuso = mutuamente excluyentes (se reemplazan).
 *    · Envenenado y Quemado conviven con cualquiera.
 *  - Pokémon Checkup (fase neutra entre turnos): veneno 10, quemadura 20 + moneda
 *    (cara = se cura), sueño moneda (cara = despierta), paralización se retira en
 *    el Checkup que sigue al turno de SU dueño (cuesta exactamente 1 turno).
 *  - Confusión: moneda AL INTENTAR atacar; cruz = el ataque falla y acaba el turno.
 *  - Evolución: solo sobre la preevo correcta; no el turno que entró en juego ni
 *    en el 1er turno de la partida; Caramelo Raro salta Fase 1 (Básico→Fase 2);
 *    Eevee con "Boosted Evolution" en el activo se salta esas restricciones.
 *    Evolucionar RETIRA las condiciones especiales (conserva daño/energía/tools).
 *  - Un solo estadio global; al poner otro, el anterior va al descarte de su dueño.
 *
 * El modelo es JSON-serializable (sin refs a DOM) para encajar con save/load.
 * =========================================================================== */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.PBEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---- constantes ---- */
  var VERSION = 1;
  var STATUS_GROUP = ['asleep', 'paralyzed', 'confused']; // el grupo "rotar carta": excluyentes
  var POISON_DMG = 10;        // 1 contador de daño
  var BURN_DMG = 20;
  var DAMAGE_COUNTER = 10;
  var MAX_TOOLS = 1;          // Pocket: 1 herramienta por Pokémon

  /* ---- utilidades ---- */
  var _uidSeq = 0;
  function nextUid() { return 'inst-' + (++_uidSeq); }
  function _resetUid(n) { _uidSeq = n || 0; }   // solo para tests deterministas

  function toInt(v) { var n = parseInt(v, 10); return isNaN(n) ? 0 : n; }

  function nameEq(a, b) {
    return String(a == null ? '' : a).trim().toLowerCase() ===
           String(b == null ? '' : b).trim().toLowerCase();
  }

  function normStage(s) {
    if (s === 1 || s === '1') return 1;
    if (s === 2 || s === '2') return 2;
    if (s == null || s === 'basic' || s === 'Basic') return 'basic';
    return s;
  }

  /* ---- moneda (RNG inyectable para tests) ---- */
  function flipCoin(rng) {
    var r = (typeof rng === 'function') ? rng() : Math.random();
    return r < 0.5 ? 'heads' : 'tails';
  }
  // Secuencia determinista para tests: seqRng(['heads','tails',...]) o números.
  function seqRng(values) {
    var i = 0;
    return function () {
      var v = values[i % values.length]; i++;
      if (v === 'heads') return 0.0;
      if (v === 'tails') return 0.99;
      return v;
    };
  }

  /* ===================== MODELO DE INSTANCIA ===================== */
  function freshConditions() {
    return {
      poisoned: false,
      poisonDamage: POISON_DMG,  // override por carta (Nihilego / Toxicroak…)
      burned: false,
      asleep: false,
      paralyzed: false,
      confused: false
    };
  }

  /* makeInstance(card, owner) — crea el estado por copia individual en juego.
   * `card` = objeto de datos de la DB (name, cardType, stage, element, health,
   * evolvesFrom, hasAbility, image, id…). NO depende de la DB: el wiring le pasa
   * el objeto; los tests le pasan objetos planos. */
  function makeInstance(card, owner) {
    card = card || {};
    return {
      uid: nextUid(),
      cardId: card.id || card.cardId || null,
      name: card.name || '',
      cardType: card.cardType || 'pokemon',
      owner: owner || 'p1',
      image: card.image || null,

      /* stats de Pokémon */
      stage: normStage(card.stage),
      element: card.element != null ? card.element : null,
      evolvesFrom: card.evolvesFrom || null,
      baseMaxHp: toInt(card.health != null ? card.health : card.hp),
      hpModifier: 0,            // modificadores planos (no de tool); p.ej. efectos
      damage: 0,               // daño acumulado (en unidades de PS, múltiplos de 10)

      energies: [],            // tipos de energía equipada: ['fire','colorless',…]
      tools: [],               // herramientas equipadas: [{cardId,name,hpBonus}]
      conditions: freshConditions(),
      evoStack: [],            // preevos enterradas, recientes primero (viajan con la instancia)

      /* flags de evento (mareo de invocación, Iron Bundle, etc.) */
      enteredPlayTurn: null,           // turno global en que entró en juego
      enteredOwnerTurn: null,          // nº de turno propio del dueño al entrar
      evolvedThisTurn: null,           // turno en que evolucionó (no evoluciona 2 veces/turno)
      hasAttackedSinceEnteringPlay: false,

      /* habilidades (data-driven; el wiring marca los flags) */
      hasAbility: !!card.hasAbility,
      abilityName: card.abilityName || null,
      boostedEvolution: !!card.boostedEvolution  // Eevee "Boosted Evolution"
    };
  }

  /* ===================== PS / DAÑO / KO ===================== */
  function effectiveMaxHp(inst) {
    var m = (inst.baseMaxHp || 0) + (inst.hpModifier || 0);
    for (var i = 0; i < (inst.tools || []).length; i++) m += (inst.tools[i].hpBonus || 0);
    return Math.max(0, m);
  }
  function remainingHp(inst) { return Math.max(0, effectiveMaxHp(inst) - (inst.damage || 0)); }
  function isKnockedOut(inst) {
    return effectiveMaxHp(inst) > 0 ? remainingHp(inst) <= 0 : false;
  }
  function applyDamage(inst, amount) {
    inst.damage = Math.max(0, (inst.damage || 0) + (amount || 0));
    return isKnockedOut(inst);
  }
  function heal(inst, amount) {
    inst.damage = Math.max(0, (inst.damage || 0) - (amount || 0));
    return inst.damage;
  }

  /* ===================== CONDICIONES ESPECIALES ===================== */
  function applyCondition(inst, cond, opts) {
    opts = opts || {};
    var c = inst.conditions;
    if (cond === 'poisoned') {
      c.poisoned = true;
      if (opts.damage) c.poisonDamage = opts.damage;
      return inst;
    }
    if (cond === 'burned') { c.burned = true; return inst; }
    if (STATUS_GROUP.indexOf(cond) >= 0) {
      // grupo excluyente: el nuevo reemplaza a dormido/paralizado/confuso
      for (var i = 0; i < STATUS_GROUP.length; i++) c[STATUS_GROUP[i]] = false;
      c[cond] = true;
      return inst;
    }
    return inst;
  }
  function clearCondition(inst, cond) {
    if (cond === 'poisoned') {
      inst.conditions.poisoned = false;
      inst.conditions.poisonDamage = POISON_DMG;
      return inst;
    }
    if (inst.conditions.hasOwnProperty(cond)) inst.conditions[cond] = false;
    return inst;
  }
  function clearAllConditions(inst) { inst.conditions = freshConditions(); return inst; }
  function hasCondition(inst, cond) { return !!(inst.conditions && inst.conditions[cond]); }

  /* ===================== CHECKUP (entre turnos) ===================== */
  /* runCheckup(state, actives, opts)
   *   actives = { p1: inst|null, p2: inst|null }  (se revisan AMBOS activos)
   *   opts.justEndedTurnOf = 'p1'|'p2'  (de quién acaba de terminar el turno)
   *   opts.rng inyectable. Devuelve un log de eventos (para UI/tests). */
  function runCheckup(state, actives, opts) {
    opts = opts || {};
    var rng = opts.rng || (state && state.rng);
    var justEnded = opts.justEndedTurnOf || (state && state.activePlayer) || null;
    var events = [];
    // el activo del jugador que acaba de jugar se revisa primero
    var order = [];
    if (justEnded === 'p2') { order = [actives.p2, actives.p1]; }
    else { order = [actives.p1, actives.p2]; }
    for (var i = 0; i < order.length; i++) {
      if (order[i]) _checkupOne(order[i], justEnded, rng, events);
    }
    return events;
  }
  function _checkupOne(inst, justEnded, rng, events) {
    var c = inst.conditions;
    // 1) Veneno
    if (c.poisoned) {
      var d = c.poisonDamage || POISON_DMG;
      applyDamage(inst, d);
      events.push({ type: 'poison', uid: inst.uid, owner: inst.owner, damage: d });
      if (isKnockedOut(inst)) { events.push({ type: 'ko', uid: inst.uid, owner: inst.owner, cause: 'poison' }); return; }
    }
    // 2) Quemadura: 20 + moneda (cara = se cura)
    if (c.burned) {
      applyDamage(inst, BURN_DMG);
      events.push({ type: 'burn', uid: inst.uid, owner: inst.owner, damage: BURN_DMG });
      if (isKnockedOut(inst)) { events.push({ type: 'ko', uid: inst.uid, owner: inst.owner, cause: 'burn' }); return; }
      var bc = flipCoin(rng);
      events.push({ type: 'burnCoin', uid: inst.uid, result: bc });
      if (bc === 'heads') { c.burned = false; events.push({ type: 'cure', uid: inst.uid, cond: 'burned' }); }
    }
    // 3) Sueño: moneda (cara = despierta)
    if (c.asleep) {
      var sc = flipCoin(rng);
      events.push({ type: 'sleepCoin', uid: inst.uid, result: sc });
      if (sc === 'heads') { c.asleep = false; events.push({ type: 'cure', uid: inst.uid, cond: 'asleep' }); }
    }
    // 4) Paralización: se retira en el Checkup que sigue al turno de su DUEÑO
    if (c.paralyzed && inst.owner === justEnded) {
      c.paralyzed = false;
      events.push({ type: 'cure', uid: inst.uid, cond: 'paralyzed' });
    }
  }

  /* ===================== TURNOS / GAME STATE ===================== */
  function newGameState(opts) {
    opts = opts || {};
    return {
      turnNumber: opts.turnNumber || 0,      // turno global (espejo de globalTurnNumber)
      activePlayer: opts.activePlayer || 'p1',
      ownerTurnCount: { p1: 0, p2: 0 },      // nº de turnos jugados por cada jugador
      stadium: null,                          // único estadio global
      playedThisTurn: freshTurnPlays(),       // límites por turno (partidario/estadio)
      rng: opts.rng || null
    };
  }
  function freshTurnPlays() { return { supporter: false, stadium: false }; }
  // beginTurn: arranca el turno de `player` (incrementa contadores y resetea los
  // límites por turno). El Checkup se ejecuta ENTRE turnos por el caller (runCheckup
  // con justEndedTurnOf del saliente).
  function beginTurn(state, player) {
    state.activePlayer = player;
    state.turnNumber++;
    state.ownerTurnCount[player] = (state.ownerTurnCount[player] || 0) + 1;
    state.playedThisTurn = freshTurnPlays();
    return state;
  }

  /* ===================== LÍMITES POR TURNO / JUGAR CARTA ===================== */
  /* canPlayCard(card, state, ctx) — el "juez" de si una carta de la mano se puede
   * jugar AHORA. Es el predicado que gatea el "deslizar fuera de la mano" (igual
   * que la regla de evoluciones). Devuelve { ok } o { ok:false, reason }.
   *   - Partidario (supporter): solo 1 por turno.
   *   - Estadio (stadium): solo 1 por turno (independiente del único estadio global).
   *   - Herramienta (tool): máx 1 por Pokémon (necesita ctx.target = la instancia objetivo).
   *   - Objeto (item) / Fósil: sin límite.
   *   - Pokémon: la colocación de básicos (hueco en banca) y las evoluciones se
   *     resuelven aparte (canEvolve + búsqueda de objetivo a nivel de tablero).
   * `card` = datos de la carta (cardType…). ctx.target = instancia objetivo (tools). */
  function canPlayCard(card, state, ctx) {
    ctx = ctx || {};
    var plays = (state && state.playedThisTurn) || freshTurnPlays();
    var type = (card && card.cardType) || 'pokemon';
    if (type === 'supporter') {
      if (plays.supporter) return { ok: false, reason: 'supporterUsed' };
      return { ok: true };
    }
    if (type === 'stadium') {
      if (plays.stadium) return { ok: false, reason: 'stadiumUsed' };
      return { ok: true };
    }
    if (type === 'tool') {
      if (ctx.target && (ctx.target.tools || []).length >= MAX_TOOLS)
        return { ok: false, reason: 'toolLimit' };
      return { ok: true };
    }
    // objeto, fósil y pokémon: sin límite por turno aquí
    return { ok: true };
  }
  // recordPlay: el tablero lo llama tras jugar con éxito una carta, para marcar el
  // gasto del límite por turno (partidario / estadio). (playStadium ya marca estadio.)
  function recordPlay(state, card) {
    if (!state) return state;
    state.playedThisTurn = state.playedThisTurn || freshTurnPlays();
    var type = (card && card.cardType) || '';
    if (type === 'supporter') state.playedThisTurn.supporter = true;
    if (type === 'stadium') state.playedThisTurn.stadium = true;
    return state;
  }

  /* ===================== ENTRAR EN JUEGO / MAREO ===================== */
  // enterPlay: poner un Pokémon en juego desde mano/descarte/mazo (entra "por 1ª vez").
  // Resetea flags de evento y limpia condiciones (entra fresco).
  function enterPlay(inst, state) {
    inst.enteredPlayTurn = state ? state.turnNumber : null;
    inst.enteredOwnerTurn = (state && state.ownerTurnCount) ? state.ownerTurnCount[inst.owner] : null;
    inst.hasAttackedSinceEnteringPlay = false;
    inst.evolvedThisTurn = null;
    clearAllConditions(inst);
    return inst;
  }
  // leaveActive: al retirarse / pasar a banca, el activo pierde sus condiciones.
  function leaveActive(inst) { clearAllConditions(inst); return inst; }

  /* ===================== EVOLUCIÓN ===================== */
  /* canEvolve(evoCard, targetInst, state, opts)
   *   opts.targetIsActive  → necesario para la excepción Boosted Evolution
   *   opts.viaRareCandy    → Caramelo Raro (Básico→Fase 2)
   *   opts.rareCandyBasic  → nombre del Básico del que sale esa Fase 2 (para validar la línea)
   * Devuelve { ok:true } o { ok:false, reason }. */
  function canEvolve(evoCard, targetInst, state, opts) {
    opts = opts || {};
    if (!targetInst) return { ok: false, reason: 'noTarget' };
    if (targetInst.cardType !== 'pokemon') return { ok: false, reason: 'targetNotPokemon' };
    var owner = targetInst.owner;
    var curTurn = state ? state.turnNumber : null;
    var boosted = !!(targetInst.boostedEvolution && opts.targetIsActive);

    // 1er turno de la partida del dueño (salvo Boosted Evolution en activo)
    if (!boosted && state && state.ownerTurnCount && (state.ownerTurnCount[owner] || 0) <= 1)
      return { ok: false, reason: 'firstTurn' };
    // entró en juego este turno o ya evolucionó este turno (salvo Boosted)
    if (!boosted && (targetInst.enteredPlayTurn === curTurn || targetInst.evolvedThisTurn === curTurn))
      return { ok: false, reason: 'justEntered' };

    // Validez de la línea evolutiva
    if (opts.viaRareCandy) {
      if (normStage(evoCard.stage) !== 2) return { ok: false, reason: 'rareCandyNeedsStage2' };
      if (targetInst.stage !== 'basic') return { ok: false, reason: 'rareCandyNeedsBasic' };
      if (!opts.rareCandyBasic) return { ok: false, reason: 'rareCandyUnknownLine' };
      if (!nameEq(opts.rareCandyBasic, targetInst.name)) return { ok: false, reason: 'rareCandyWrongLine' };
      return { ok: true, rareCandy: true };
    }
    if (!evoCard.evolvesFrom) return { ok: false, reason: 'evoHasNoPreevo' };
    if (!nameEq(evoCard.evolvesFrom, targetInst.name)) return { ok: false, reason: 'wrongPreevo' };
    return { ok: true };
  }

  function _snapshot(inst) {
    return {
      cardId: inst.cardId, name: inst.name, cardType: inst.cardType || 'pokemon',
      stage: inst.stage, element: inst.element, evolvesFrom: inst.evolvesFrom,
      baseMaxHp: inst.baseMaxHp, image: inst.image
    };
  }

  /* evolve(targetInst, evoCard, state) — muta targetInst para que SE CONVIERTA en la
   * evolución (conserva uid = misma instancia/slot). Entierra la preevo (+ su stack),
   * conserva daño/energía/tools, RETIRA condiciones, marca evolvedThisTurn. */
  function evolve(targetInst, evoCard, state) {
    var under = [_snapshot(targetInst)].concat(targetInst.evoStack || []);
    targetInst.cardId = evoCard.id || evoCard.cardId || null;
    targetInst.name = evoCard.name || '';
    targetInst.stage = normStage(evoCard.stage);
    if (evoCard.element != null) targetInst.element = evoCard.element;
    targetInst.evolvesFrom = evoCard.evolvesFrom || null;
    if (evoCard.image) targetInst.image = evoCard.image;
    targetInst.hasAbility = !!evoCard.hasAbility;
    targetInst.abilityName = evoCard.abilityName || null;
    targetInst.boostedEvolution = !!evoCard.boostedEvolution;
    var newMax = toInt(evoCard.health != null ? evoCard.health : evoCard.hp);
    if (newMax) targetInst.baseMaxHp = newMax;   // el daño (counters) se conserva
    clearAllConditions(targetInst);              // evolucionar cura las condiciones
    targetInst.evolvedThisTurn = state ? state.turnNumber : null;
    targetInst.evoStack = under;
    return targetInst;
  }

  /* popEvolution(inst) — des-evoluciona: la forma actual (evolucionada) "sale"
   * (se devuelve para ir a la mano) y la preevo de arriba del stack vuelve a estar
   * en juego en la misma instancia. Conserva daño/energía/tools. */
  function popEvolution(inst) {
    if (!inst.evoStack || !inst.evoStack.length) return null;
    var removed = _snapshot(inst);
    var under = inst.evoStack.shift();
    inst.cardId = under.cardId; inst.name = under.name;
    inst.cardType = under.cardType || 'pokemon';
    inst.stage = under.stage; inst.element = under.element;
    inst.evolvesFrom = under.evolvesFrom; inst.baseMaxHp = under.baseMaxHp;
    if (under.image) inst.image = under.image;
    return removed; // la carta evolucionada que vuelve a la mano
  }

  /* ===================== ESTADIO ÚNICO ===================== */
  // playStadium(state, stadiumInst) — coloca un estadio; si había otro, lo devuelve
  // para el descarte de SU dueño (el que lo colocó).
  function playStadium(state, stadiumInst) {
    var prev = state.stadium || null;
    state.stadium = stadiumInst;
    if (state.playedThisTurn) state.playedThisTurn.stadium = true; // 1 estadio por turno
    return { discarded: prev, discardedOwner: prev ? prev.owner : null };
  }
  function clearStadium(state) { var p = state.stadium; state.stadium = null; return p; }

  /* ===================== HERRAMIENTAS ===================== */
  function _normTool(tool) {
    tool = tool || {};
    return { cardId: tool.id || tool.cardId || null, name: tool.name || '', hpBonus: tool.hpBonus || 0 };
  }
  function attachTool(inst, tool) {
    inst.tools = inst.tools || [];
    if (inst.tools.length >= MAX_TOOLS)
      return { ok: false, reason: 'toolLimit', current: inst.tools[0] };
    inst.tools.push(_normTool(tool));
    return { ok: true };
  }
  function detachTool(inst, idx) {
    idx = idx || 0;
    if (!inst.tools || idx >= inst.tools.length) return null;
    return inst.tools.splice(idx, 1)[0];   // devuelve la tool (para el descarte)
  }

  /* ===================== ENERGÍA (lado datos) ===================== */
  function attachEnergy(inst, type) { inst.energies.push(type); return inst.energies.slice(); }
  function detachEnergy(inst, type) {
    var i = inst.energies.indexOf(type);
    if (i >= 0) inst.energies.splice(i, 1);
    return inst.energies.slice();
  }
  function discardAllEnergy(inst) {   // Retirada en Pocket: descarta TODAS las energías
    var e = inst.energies.slice();
    inst.energies = [];
    return e;
  }

  /* ===================== ATAQUE / RETIRADA ===================== */
  function canAttack(inst) {
    if (inst.conditions.asleep) return { ok: false, reason: 'asleep' };
    if (inst.conditions.paralyzed) return { ok: false, reason: 'paralyzed' };
    return { ok: true };
  }
  // attemptAttack: resuelve el bloqueo por estado + la moneda de Confusión.
  // Devuelve {ok:false, reason, endTurn?} o {ok:true} (y marca hasAttacked…).
  function attemptAttack(inst, state, opts) {
    opts = opts || {};
    var rng = opts.rng || (state && state.rng);
    var pre = canAttack(inst);
    if (!pre.ok) return pre;
    if (inst.conditions.confused) {
      var coin = flipCoin(rng);
      if (coin === 'tails') return { ok: false, reason: 'confused', endTurn: true, coin: coin };
      // cara: el ataque procede, pero SE TIRÓ moneda: quien llama la necesita para enseñarla
      inst.hasAttackedSinceEnteringPlay = true;
      return { ok: true, coin: coin };
    }
    inst.hasAttackedSinceEnteringPlay = true;
    return { ok: true };
  }
  function canRetreat(inst) {
    // Confuso SÍ puede retirarse; Dormido/Paralizado no.
    if (inst.conditions.asleep) return { ok: false, reason: 'asleep' };
    if (inst.conditions.paralyzed) return { ok: false, reason: 'paralyzed' };
    return { ok: true };
  }

  /* ===================== COSTE / DAÑO DE ATAQUE ===================== */
  // canPayCost(energies, cost): ¿las energías equipadas cubren el coste?
  //   energies: ['fire','water',…]  ·  cost: ['fire','colorless',…]
  //   'colorless' = cualquier energía sobrante.
  function canPayCost(energies, cost) {
    var pool = (energies || []).slice();
    var colorless = 0;
    for (var i = 0; i < (cost || []).length; i++) {
      var c = cost[i];
      if (c === 'colorless') { colorless++; continue; }
      var idx = pool.indexOf(c);
      if (idx < 0) return false;     // falta una energía tipada
      pool.splice(idx, 1);
    }
    return pool.length >= colorless;  // las sobrantes cubren las incoloras
  }
  // parseDamage(str): extrae el daño base; vanilla = entero puro; mult = "N×" (el
  // daño es N×algo → la base NO es aditiva, vale 0 y el efecto aporta el total).
  function parseDamage(str) {
    str = String(str == null ? '' : str).trim();
    if (/^\d+$/.test(str)) return { base: parseInt(str, 10), vanilla: true, mult: false };
    var mult = /^\d+\s*[×x*]/.test(str);   // "50x" / "50×"
    var m = str.match(/^(\d+)/);           // "30+" → base 30 aditivo
    return { base: m ? parseInt(m[1], 10) : 0, vanilla: false, mult: mult };
  }
  // attackDamage(base, atkElement, defWeakness): +20 por debilidad (Pocket, solo si
  // el ataque hace daño y la debilidad coincide con el elemento del atacante).
  function attackDamage(base, attackerElement, defenderWeakness) {
    base = base || 0;
    if (base > 0 && defenderWeakness && attackerElement && defenderWeakness === attackerElement)
      return base + 20;
    return base;
  }
  // isVanillaAttack(atk): solo coste + daño entero, sin texto de efecto.
  function isVanillaAttack(atk) {
    if (!atk || atk.effect) return false;
    return parseDamage(atk.damage).vanilla;
  }

  /* ===================== API ===================== */
  return {
    VERSION: VERSION,
    STATUS_GROUP: STATUS_GROUP,
    POISON_DMG: POISON_DMG,
    BURN_DMG: BURN_DMG,
    DAMAGE_COUNTER: DAMAGE_COUNTER,
    MAX_TOOLS: MAX_TOOLS,

    // utilidades / RNG
    flipCoin: flipCoin,
    seqRng: seqRng,
    nameEq: nameEq,
    normStage: normStage,
    _resetUid: _resetUid,

    // instancia
    makeInstance: makeInstance,
    freshConditions: freshConditions,

    // PS / daño
    effectiveMaxHp: effectiveMaxHp,
    remainingHp: remainingHp,
    isKnockedOut: isKnockedOut,
    applyDamage: applyDamage,
    heal: heal,

    // condiciones
    applyCondition: applyCondition,
    clearCondition: clearCondition,
    clearAllConditions: clearAllConditions,
    hasCondition: hasCondition,
    runCheckup: runCheckup,

    // game state / turnos
    newGameState: newGameState,
    beginTurn: beginTurn,

    // límites por turno / jugar carta
    canPlayCard: canPlayCard,
    recordPlay: recordPlay,

    // entrar en juego / mareo
    enterPlay: enterPlay,
    leaveActive: leaveActive,

    // evolución
    canEvolve: canEvolve,
    evolve: evolve,
    popEvolution: popEvolution,

    // estadio
    playStadium: playStadium,
    clearStadium: clearStadium,

    // tools
    attachTool: attachTool,
    detachTool: detachTool,

    // energía
    attachEnergy: attachEnergy,
    detachEnergy: detachEnergy,
    discardAllEnergy: discardAllEnergy,

    // ataque / retirada
    canAttack: canAttack,
    attemptAttack: attemptAttack,
    canRetreat: canRetreat,

    // coste / daño de ataque
    canPayCost: canPayCost,
    parseDamage: parseDamage,
    attackDamage: attackDamage,
    isVanillaAttack: isVanillaAttack
  };
});
