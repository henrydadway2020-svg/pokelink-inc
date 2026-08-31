/* ══════════════════════════════════════════════
   DRAFT VIEW  (js/draft-view.js)
   Modo Draft single-player: oleadas de 5 opciones por bundles
   (líneas evolutivas completas, trainers ×2/×1) hasta cerrar un
   mazo de exactamente 20 cartas.
   Depende de: window.CARDS_DB, window.DRAFT_CONFIG, js/shared.js.

   Mientras DRAFT_CONFIG.cards esté vacío, el pool se categoriza con
   heurísticas provisionales (la categorización real vendrá del
   panel admin en la siguiente tanda).
══════════════════════════════════════════════ */
(function () {
  'use strict';

  const CFG = window.DRAFT_CONFIG || { waves: [], filler: {}, weights: {}, cards: {} };
  const LIBRARY_KEY = 'pocketboard_library_v1';

  const TYPED = new Set(['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal']);
  const RAR_ORDER = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '♕', 'Promo'];
  const RAR_RANK = Object.fromEntries(RAR_ORDER.map((r, i) => [r, i]));

  // ── Heurísticas provisionales de rol para trainers ──
  // (hasta que el admin categorice; la DB no guarda el texto de los trainers)
  const ROBO_NAMES = new Set([
    "professor's research", 'professors research', 'poké ball', 'poke ball',
    'copycat', 'iono', 'clemont', 'ariana', 'ultra ball', 'repeat ball', 'may',
  ]);
  const CONSIST_NAMES = new Set([
    'pokémon communication', 'pokemon communication', 'area zero',
    'hiking trail', 'mythical slab', 'aura', 'arven', 'rare candy',
  ]);

  // ── Estado ─────────────────────────────────────────────────────
  let _pool = null;   // unidades ofertables (1 por nombre)
  let D = null;       // draft en curso: {deck, counts, colors, wave, offers, finished}
  let _rerollNoLuck = false; // true mientras se rebaraja por reroll (la suerte no triggea)
  let _rerollBan = null;     // nombres de la oleada anterior: el reroll NUNCA los repite
  let _rerollMode = false;   // true → renderWave usa el «snap» mecánico (sin escalonado)
  let _rerollPreload = null; // promesa: imágenes de la nueva oleada ya descargadas/decodificadas

  // ── i18n ──────────────────────────────────────────────────────
  // Atajo (i18n.js carga antes; fallback a la clave por si fallara).
  const T = (k, v) => (window.t ? window.t(k, v) : k);
  // El flag interno de oferta (`o.sub`, en español) se usa TAMBIÉN como lógica
  // (`o.sub.includes('doble')` etc.) → NO se traduce; aquí se mapea SOLO para mostrar.
  const SUB_KEY = {
    '¡Combo doble!': 'draft.comboDouble',
    'Combo': 'draft.combo',
    '¡Línea doble!': 'draft.lineDouble',
    'Evolución': 'draft.evolution',
    '¡Robo doble!': 'draft.roboDouble',
  };
  const subText = (sub) => (sub ? T(SUB_KEY[sub] || sub) : '');
  // Locale para fechas (nombre por defecto del mazo) según idioma de UI
  const LOCALES = { es: 'es-ES', en: 'en-US', ja: 'ja-JP' };
  const draftLocale = () => LOCALES[window.i18n ? window.i18n.getLang() : 'es'] || 'es-ES';

  // ════════════════════════════════════════════════════════════
  //  POOL
  // ════════════════════════════════════════════════════════════
  // Categorización del admin (data/draft.cards.js), resuelta por NOMBRE:
  // el admin categoriza un id concreto (eso elige el arte), pero el límite
  // y el pool funcionan por nombre como en Pocket.
  function draftCfgByName() {
    const src = (window.DRAFT_CARDS && window.DRAFT_CARDS.cards) || CFG.cards || {};
    const byId = new Map((window.CARDS_DB || []).map(c => [c.id, c]));
    const map = new Map();
    Object.keys(src).forEach(id => {
      const card = byId.get(id);
      if (!card) return;
      const k = card.name.toLowerCase();
      const prev = map.get(k);
      // Si un nombre tiene dos entradas (printings distintos), la manual manda
      if (!prev || (prev.cfg.auto && !src[id].auto)) {
        map.set(k, { cfg: src[id], card });
      }
    });
    return map;
  }
  function draftMode() {
    return (window.DRAFT_CARDS && window.DRAFT_CARDS.mode) === 'curado' ? 'curado' : 'auto';
  }

  // ── Variante del pool curado: completo vs solo meta ─────────────
  // 'full'  = todas las cartas categorizadas (lo de siempre).
  // 'meta'  = el MISMO pool curado, pero filtrado a solo los nombres que aparecen
  //           en los mazos del meta actual (window.META_DECKS, todos los arquetipos).
  const POOL_VARIANT_KEY = 'pocketboard_draft_pool_v1';
  let _poolVariant = null;     // 'full' | 'meta'
  let _metaIdxCache = null;    // {names:Set, sigs:Set} de los top-N arquetipos
  let _ambigCache = null;      // nombres con 2+ cartas distintas (mismo nombre)
  let _metaDecksCache = null;  // [{sigs:Set, byName:Map}] de los top-N (preevos meta)
  function poolVariant() {
    if (_poolVariant === null) {
      try { _poolVariant = localStorage.getItem(POOL_VARIANT_KEY) === 'meta' ? 'meta' : 'full'; }
      catch (e) { _poolVariant = 'full'; }
    }
    return _poolVariant;
  }
  function setPoolVariant(v) {
    _poolVariant = (v === 'meta') ? 'meta' : 'full';
    try { localStorage.setItem(POOL_VARIANT_KEY, _poolVariant); } catch (e) {}
    _pool = null; // forzar reconstrucción del pool
  }
  function metaAvailable() {
    const md = window.META_DECKS;
    return !!(md && Array.isArray(md.decks) && md.decks.length);
  }
  // Firma de identidad de una carta: nombre + ataques. Distingue cartas
  // GENUINAMENTE distintas con el mismo nombre (Absol «Unseen Claw» vs «Leap
  // Over») pero IGUALA reimpresiones (misma carta, otra rareza/arte/id).
  function cardSig(c) {
    const atks = (c.attacks || []).map(a => a.name || '').sort().join('|');
    return c.name.toLowerCase() + '##' + atks;
  }
  // Nombres con 2+ cartas distintas (firmas con ataques no vacías) → hay que
  // afinar por identidad. El resto (un solo cartón, o promos sin ataques en la
  // DB cuya firma saldría vacía) basta con el nombre.
  function ambiguousNames() {
    if (_ambigCache) return _ambigCache;
    const sigsByName = new Map();
    (window.CARDS_DB || []).forEach(c => {
      if (!c.name || !(c.attacks && c.attacks.length)) return;
      const k = c.name.toLowerCase();
      if (!sigsByName.has(k)) sigsByName.set(k, new Set());
      sigsByName.get(k).add(cardSig(c));
    });
    const amb = new Set();
    sigsByName.forEach((sigs, k) => { if (sigs.size > 1) amb.add(k); });
    _ambigCache = amb;
    return amb;
  }
  // Índice del meta: nombres + identidades de carta de los TOP-N arquetipos
  // (ordenados por cuota de juego), listas representativas + variantes. Las
  // preevoluciones NO hacen falta aquí: buildLine las trae solas por printings.
  function metaCardIndex() {
    if (_metaIdxCache) return _metaIdxCache;
    const names = new Set(), sigs = new Set();
    if (metaAvailable()) {
      const byId = new Map((window.CARDS_DB || []).map(c => [c.id, c]));
      const topN = (CFG.metaTopArchetypes && CFG.metaTopArchetypes > 0) ? CFG.metaTopArchetypes : 9999;
      const decks = window.META_DECKS.decks.slice()
        .sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, topN);
      const add = (cards) => cards && cards.forEach(c => {
        const card = byId.get(c.id);
        if (!card || !card.name) return;
        names.add(card.name.toLowerCase());
        sigs.add(cardSig(card));
      });
      decks.forEach(d => { add(d.cards); (d.variants || []).forEach(v => add(v.cards)); });
    }
    _metaIdxCache = { names, sigs };
    return _metaIdxCache;
  }
  // Top-N arquetipos parseados para elegir preevos meta: por mazo, las
  // identidades que juega (sigs) y un índice nombre→[ids] de sus cartas.
  function metaDecksParsed() {
    if (_metaDecksCache) return _metaDecksCache;
    const out = [];
    if (metaAvailable()) {
      const byId = new Map((window.CARDS_DB || []).map(c => [c.id, c]));
      const topN = (CFG.metaTopArchetypes && CFG.metaTopArchetypes > 0) ? CFG.metaTopArchetypes : 9999;
      const decks = window.META_DECKS.decks.slice()
        .sort((a, b) => (b.share || 0) - (a.share || 0)).slice(0, topN);
      decks.forEach(d => {
        const ids = [];
        (d.cards || []).forEach(c => ids.push(c.id));
        (d.variants || []).forEach(v => (v.cards || []).forEach(c => ids.push(c.id)));
        const sigs = new Set(), byName = new Map();
        ids.forEach(id => {
          const card = byId.get(id);
          if (!card) return;
          sigs.add(cardSig(card));
          const k = card.name.toLowerCase();
          if (!byName.has(k)) byName.set(k, []);
          byName.get(k).push(id);
        });
        out.push({ sigs, byName });
      });
    }
    _metaDecksCache = out;
    return out;
  }

  function buildPool() {
    const db = window.CARDS_DB || [];
    // Carta canónica por nombre: la de rareza más baja (◊ antes que full arts/promos)
    const canon = new Map();
    // …y todos los printings pokémon por nombre, para elegir preevos del MISMO set
    const printings = new Map();
    db.forEach(c => {
      if (!c.name) return;
      const k = c.name.toLowerCase();
      const prev = canon.get(k);
      const rank = RAR_RANK[c.rarity] !== undefined ? RAR_RANK[c.rarity] : 99;
      const prevRank = prev ? (RAR_RANK[prev.rarity] !== undefined ? RAR_RANK[prev.rarity] : 99) : 999;
      if (rank < prevRank) canon.set(k, c);
      if (c.cardType === 'pokemon' || c.cardType === 'fossil') {
        if (!printings.has(k)) printings.set(k, []);
        printings.get(k).push(c);
      }
    });
    _printings = printings;
    _children = new Map();
    _familyCache = null;
    printings.forEach((prints, k) => prints.forEach(p => {
      if (!p.evolvesFrom) return;
      const up = p.evolvesFrom.toLowerCase();
      if (!_children.has(up)) _children.set(up, []);
      if (!_children.get(up).includes(k)) _children.get(up).push(k);
    }));

    const cfgMap = draftCfgByName();
    const units = [];
    const unitIds = new Set();
    _byId = new Map(db.map(c => [c.id, c]));
    // A ~179 promos les faltan los ataques en la DB y sin ellos pasaban TODOS
    // los filtros como si fueran gratis (caso Zygarde ex promo en mazo agua):
    // se toman prestados de otro printing del mismo nombre y elemento.
    function withAttackData(c) {
      if (c.cardType !== 'pokemon' || (c.attacks && c.attacks.length)) return c;
      const prints = printings.get(c.name.toLowerCase()) || [];
      const donor = prints.find(p => p.attacks && p.attacks.length &&
        (!c.element || p.element === c.element)) ||
        prints.find(p => p.attacks && p.attacks.length);
      return donor
        ? Object.assign({}, c, { attacks: donor.attacks,
                                 hasAbility: c.hasAbility || donor.hasAbility })
        : c;
    }
    function pushUnit(raw, cfg) {
      if (unitIds.has(raw.id)) return;
      const c = withAttackData(raw);
      if (c.cardType === 'pokemon') {
        const line = buildLine(c, cfg);
        if (!line) return; // línea rota
        units.push(makePokemonUnit(c, line, cfg));
      } else {
        units.push(makeTrainerUnit(c, cfg));
      }
      unitIds.add(raw.id);
    }

    if (draftMode() === 'curado') {
      // Pool curado: TODAS las entradas del admin. Dos variantes del mismo
      // nombre pueden convivir (cada una es una carta distinta); el límite de
      // 2 copias por NOMBRE lo aplica makeOffer vía owned(), y dentro de una
      // misma oleada no se repite nombre (usedNames en categoryOffers).
      const byId = new Map(db.map(c => [c.id, c]));
      const src = (window.DRAFT_CARDS && window.DRAFT_CARDS.cards) || CFG.cards || {};
      // Variante meta: misma curación, pero solo las CARTAS (no solo el nombre)
      // que juegan los top-N arquetipos. Para nombres ambiguos (Absol/Darkrai
      // con varias cartas distintas) afina por identidad; el resto, por nombre.
      const metaFilter = poolVariant() === 'meta' && metaAvailable();
      const mIdx = metaFilter ? metaCardIndex() : null;
      const ambig = metaFilter ? ambiguousNames() : null;
      Object.keys(src).forEach(id => {
        const card = byId.get(id);
        if (!card || !card.cardType) return;
        const cfg = src[id];
        if (cfg.rol === 'excluir' || card.cardType === 'fossil') return;
        if (mIdx) {
          const nm = card.name.toLowerCase();
          if (!mIdx.names.has(nm)) return;                          // nombre no meta
          if (ambig.has(nm) && !mIdx.sigs.has(cardSig(card))) return; // carta concreta no meta
        }
        pushUnit(card, cfg);
      });
      return units;
    }

    // Pool auto: heurísticas + overrides del admin
    // Nombres con evolución: no se ofrecen sueltos (solo como parte de línea)
    const hasChild = new Set();
    canon.forEach(c => {
      if (c.cardType === 'pokemon' && c.evolvesFrom) hasChild.add(c.evolvesFrom.toLowerCase());
    });

    canon.forEach(c => {
      const k = c.name.toLowerCase();
      const entry = cfgMap.get(k);
      if (entry && entry.cfg.rol === 'excluir') return;
      if (c.cardType === 'fossil') return; // los fósiles necesitan trato especial (futuro)
      if (c.cardType === 'pokemon' && hasChild.has(k) && !entry) return;
      pushUnit(entry ? entry.card : c, entry && entry.cfg);
    });
    return units;
  }

  let _printings = null;
  let _children = null;      // nombre → [nombres que evolucionan de él]
  let _familyCache = null;   // nombre → Set(nombres de toda su línea evolutiva)

  // Familia evolutiva completa de un nombre (ancestros + descendientes),
  // para los trainers condicionales: «Blaine» se ofrece si el mazo tiene
  // Ninetales O cualquier fase de su línea (Vulpix).
  function lineFamily(name) {
    const key = name.toLowerCase();
    if (!_familyCache) _familyCache = new Map();
    if (_familyCache.has(key)) return _familyCache.get(key);
    const fam = new Set();
    const queue = [key];
    while (queue.length) {
      const n = queue.pop();
      if (fam.has(n)) continue;
      fam.add(n);
      const prints = _printings && _printings.get(n);
      if (prints) prints.forEach(p => {
        if (p.evolvesFrom) {
          const up = p.evolvesFrom.toLowerCase();
          if (!fam.has(up)) queue.push(up);
        }
      });
      const kids = _children && _children.get(n);
      if (kids) kids.forEach(k => { if (!fam.has(k)) queue.push(k); });
    }
    _familyCache.set(key, fam);
    return fam;
  }

  // ¿El mazo contiene la carta requerida (o cualquier fase de su línea)?
  function requireMet(u) {
    if (!u.requiere || !u.requiere.length) return true;
    return u.requiere.some(name =>
      [...lineFamily(name)].some(n => (D.counts[n] || 0) > 0));
  }

  // Preevolución coherente: mismo set que la evo (Magnezone metal A2a →
  // Magneton metal A2a) > mismo elemento > la de rareza más baja.
  // Para elegir printings concretos de preevo, el admin fija cfg.linea.
  function parentFor(child, parentName) {
    const opts = _printings && _printings.get(parentName.toLowerCase());
    if (!opts || !opts.length) return null;
    const lowest = arr => arr.reduce((a, b) =>
      (RAR_RANK[b.rarity] !== undefined ? RAR_RANK[b.rarity] : 99) <
      (RAR_RANK[a.rarity] !== undefined ? RAR_RANK[a.rarity] : 99) ? b : a);
    const sameSet = opts.filter(p => p.set === child.set);
    if (sameSet.length) return lowest(sameSet);
    const sameEl = opts.filter(p => p.element === child.element);
    if (sameEl.length) return lowest(sameEl);
    return lowest(opts);
  }

  let _byId = null;

  // SOLO en modo meta: impresión de la preevo `parentName` que usan los mazos
  // meta que juegan ESTE `top` (emparejando por identidad). Devuelve null si no
  // hay dato → buildLine cae a parentFor. Nunca rompe la línea: el printing
  // elegido tiene el nombre correcto y es pokémon/fósil, así que la cadena
  // evolvesFrom sigue siendo válida.
  function metaParentFor(top, parentName) {
    const pn = parentName.toLowerCase();
    const topSig = cardSig(top);
    const tally = new Map();
    metaDecksParsed().forEach(d => {
      if (!d.sigs.has(topSig)) return;
      (d.byName.get(pn) || []).forEach(id => {
        const c = _byId && _byId.get(id);
        if (!c || (c.cardType !== 'pokemon' && c.cardType !== 'fossil')) return;
        tally.set(id, (tally.get(id) || 0) + 1);
      });
    });
    if (!tally.size) return null;
    const rank = id => {
      const c = _byId.get(id);
      return c && RAR_RANK[c.rarity] !== undefined ? RAR_RANK[c.rarity] : 99;
    };
    // más usada en el meta → rareza más baja (arte limpio) → id estable
    const best = [...tally.entries()].sort((a, b) =>
      b[1] - a[1] || rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : 1))[0][0];
    return _byId.get(best) || null;
  }

  function buildLine(top, adminCfg) {
    const metaMode = poolVariant() === 'meta' && metaAvailable();
    // Printings de preevo fijados en el admin (cfg.linea): cada uno ocupa el
    // hueco de su nombre y el resto de la cadena se completa solo — fijar el
    // Magneton A1 en el Magnezone A2 arrastra al Magnemite por mismo-set.
    const pinned = new Map();
    if (adminCfg && Array.isArray(adminCfg.linea) && _byId) {
      adminCfg.linea.forEach(id => {
        const c = _byId.get(id);
        if (c) pinned.set(c.name.toLowerCase(), c);
      });
    }
    const line = [top];
    let cur = top, guard = 0;
    while (cur.evolvesFrom && guard++ < 4) {
      const p = pinned.get(cur.evolvesFrom.toLowerCase()) ||
                (metaMode ? metaParentFor(top, cur.evolvesFrom) : null) ||
                parentFor(cur, cur.evolvesFrom);
      if (!p) return null;
      // Los fósiles son el "básico" de su línea (Old Amber → Aerodactyl)
      if (p.cardType === 'fossil') { line.unshift(p); break; }
      if (p.cardType !== 'pokemon') return null;
      line.unshift(p);
      cur = p;
    }
    return line;
  }

  function maxDmg(c) {
    let m = 0;
    (c.attacks || []).forEach(a => { const d = parseInt(a.damage, 10); if (d > m) m = d; });
    return m;
  }

  // ── RAMP DE ENERGÍA: ¿esta carta genera energía de algún tipo? ──
  // (Mantyke pone [W], Volkner [L], Flame Patch [R]…). Los tipos que rampea
  // inclinan LIGERAMENTE el mazo hacia ellos: al haber pickeado un motor de agua,
  // los Pokémon de agua se vuelven algo más probables — sin gate ni garantía
  // (petición de Daniel 2026-08-15). NO toca D.types: no abre el soporte de tipo.
  const _RAMP_OPS = /^(attachEnergy|abilityAttach|distributeEnergy|attachRandomEnergy|attachDiscardEnergy)/;
  const _rampCache = new Map();
  function rampTypesFor(card) {
    if (!card || !card.id) return null;
    if (_rampCache.has(card.id)) return _rampCache.get(card.id);
    const out = new Set();
    const eat = op => {
      if (!op || !op.op || !_RAMP_OPS.test(op.op)) return;
      [op.etype, op.benchEtype, op.activeType, op.filterType].forEach(t => { if (TYPED.has(t)) out.add(t); });
      (op.types || []).forEach(t => { if (TYPED.has(t)) out.add(t); });
    };
    const fx = (window.CARD_EFFECTS || {})[card.id];
    if (fx) Object.keys(fx).forEach(k => ((fx[k] && fx[k].ops) || []).forEach(eat));
    const ab = (window.CARD_ABILITIES || {})[card.id];
    if (ab) ab.forEach(a => (a.ops || []).forEach(eat));
    const tr = (window.CARD_TRAINER_EFFECTS || {})[card.id];
    if (tr) (tr.ops || []).forEach(eat);
    const arr = out.size ? [...out] : null;
    _rampCache.set(card.id, arr);
    return arr;
  }

  function makePokemonUnit(top, line, adminCfg) {
    let rol;
    if (adminCfg && adminCfg.rol) {
      // el combo hereda el rol del ancla (win, tech, lead… — Unown GUARD+POWER
      // es un combo tech; Latias+Latios podría ser lead)
      rol = adminCfg.rol;
    } else {
      // Heurística provisional (modo auto sin categorizar)
      const stage = line.length; // 1 básico · 2 línea F1 · 3 línea F2
      const dmg = maxDmg(top);
      if (top.ex) rol = 'win';
      else if (stage === 3) rol = (dmg >= 110 || top.health >= 150) ? 'win' : 'secundario';
      else if (stage === 2) rol = (dmg >= 100) ? 'win' : 'secundario';
      else rol = ((top.hasAbility && dmg <= 40) || !(top.attacks || []).length) ? 'utilidad'
               : (dmg >= 90 ? 'win' : 'secundario');
    }
    return { kind: 'pokemon', top, line, rol, name: top.name,
             rampTypes: rampTypesFor(top),   // tipos de energía que genera (inclinación suave)
             splash: adminCfg ? adminCfg.splash : undefined,
             bundleOverride: adminCfg && adminCfg.bundle,
             // Pokémon ligado a un color (robo condicional de tipo: perros
             // legendarios A4 = robo solo en mazos de SU tipo, como Sylveon ex).
             color: adminCfg && adminCfg.color,
             requiere: adminCfg && adminCfg.requiere, // condicional (Uxie ← Mesprit/Azelf)
             requierePeso: adminCfg && adminCfg.requierePeso,
             combo: adminCfg && adminCfg.combo,       // bundle manual (Buzzwole ex + Celesteela)
             comboChance: adminCfg && adminCfg.comboChance,
             // multiplicador de rareza dentro de su categoría (perros legendarios
             // = robo fuerte, pero NO casi-garantizado: peso bajo para ~40%)
             weight: adminCfg && adminCfg.weight,
             requiereMega: !!(adminCfg && adminCfg.requiereMega), // payoff de Megas (Calem/Serena)
             oneofViable: !!(adminCfg && adminCfg.oneofViable) };
  }

  function makeTrainerUnit(c, adminCfg) {
    const n = c.name.toLowerCase();
    const rol = (adminCfg && adminCfg.rol) ? adminCfg.rol
      : (ROBO_NAMES.has(n) ? 'robo' : (CONSIST_NAMES.has(n) ? 'consistencia' : 'tech'));
    return { kind: 'trainer', top: c, line: null, rol, name: c.name,
             rampTypes: rampTypesFor(c),   // Misty/Volkner/Flame Patch… también inclinan
             bundleOverride: adminCfg && adminCfg.bundle,
             color: adminCfg && adminCfg.color, // trainer ligado a un color (Misty → agua)
             requiere: adminCfg && adminCfg.requiere, // condicional: solo si su carta está en el mazo
             requierePeso: adminCfg && adminCfg.requierePeso, // los de clase (Lusamine…) van altos
             weight: adminCfg && adminCfg.weight, // multiplicador de rareza dentro de su categoría
             requiereMega: !!(adminCfg && adminCfg.requiereMega), // payoff de Megas (Calem/Serena)
             subtipo: adminCfg && adminCfg.subtipo };
  }

  // ════════════════════════════════════════════════════════════
  //  REGLAS: colores, copias, bundles
  // ════════════════════════════════════════════════════════════
  function typedCosts(card) {
    const s = new Set();
    (card.attacks || []).forEach(a => (a.cost || []).forEach(t => { if (TYPED.has(t)) s.add(t); }));
    return s;
  }

  // ¿Puede atacar pagando solo con los colores del arquetipo + incoloro?
  // (un ataque sin coste o todo incoloro = splashable en cualquier mazo)
  function payable(card, colors) {
    if (colors === null) return true; // aún no hay arquetipo
    const atks = card.attacks || [];
    // Sin datos de ataque (en Pocket TODO pokémon ataca, así que es un hueco
    // de datos): regla conservadora por elemento — nunca tratar como "gratis"
    if (!atks.length) return colors.has(card.element);
    return atks.some(a => (a.cost || []).every(t => t === 'colorless' || colors.has(t)));
  }

  // Igual, pero respetando el override `splash` del admin
  function unitPayable(u) {
    if (D.colors === null) return true;
    if (u.splash === true) return true;
    // forzado no-splash: pertenece a su elemento (aunque el coste sea incoloro,
    // escala con su propia energía) → solo en mazos de ese tipo
    if (u.splash === false) return D.colors.has(u.top.element);
    return payable(u.top, D.colors);
  }

  // ── Doble tipo (regla de Daniel) ──
  // Un mazo es apto para segundo tipo SOLO si su wincon cuesta 1 energía
  // tipada + resto incoloras (la energía de zona alterna cada 1-2 turnos:
  // [P,C,C] es tolerable, [F,F,F] no). Y el candidato de segundo tipo debe
  // cumplir el mismo requisito (Oricorio [L], Greninja [W,C], Sylveon [P,C]).
  function typedSymbols(cost) {
    return (cost || []).filter(t => t !== 'colorless');
  }
  // Daño de un ataque, contando el escrito en el TEXTO ("does 140 damage")
  // — los snipers tipo Mega Heracross llevan el daño en el efecto
  function attackDamage(a) {
    const d = parseInt(a.damage, 10);
    if (d) return d;
    const m = /does (\d+)(?: more)? damage/i.exec(a.effect || '');
    return m ? parseInt(m[1], 10) : 0;
  }
  // El ataque que define a la carta: el de mayor daño (último en empates)
  function definingAttack(card) {
    const atks = card.attacks || [];
    let best = null, bestD = -1;
    atks.forEach(a => {
      const d = attackDamage(a);
      if (d >= bestD) { best = a; bestD = d; }
    });
    return best;
  }
  // ¿Su ataque DEFINITORIO cuesta ≤1 energía tipada (+ incoloras)?
  // Se usa tanto para la wincon (¿abre el mazo a doble tipo?) como para los
  // candidatos de segundo tipo (Mega Heracross [G,G,G,C] queda fuera aunque
  // tenga un ataque pequeño barato: lo que importa es con qué gana).
  function isLight(card) {
    const def = definingAttack(card);
    if (!def) return false; // sin datos de ataque: no apto como segundo tipo
    return typedSymbols(def.cost).length <= 1;
  }
  // Apto para MULTIENERGÍA (regla de Daniel, 2026-06-16): además de ser ligero
  // (≤1 tipada), su ataque PRINCIPAL debe llevar al menos UNA incolora — esa
  // ranura flexible es la señal de que la carta encaja en un 2º color. Un coste
  // 100% de su tipo (Zoroark ex [oscuro]) la ata a su tipo aunque sea de 1 coste;
  // con incolora (Oricorio [L,C]) sí. Ataque sin coste = splashable (no necesita
  // energía). Por consistencia: los de 1-tipada-sin-incolora salen a chance bajo.
  function isSplashApt(card) {
    const def = definingAttack(card);
    if (!def) return false;
    const cost = def.cost || [];
    if (typedSymbols(cost).length > 1) return false;
    return cost.length === 0 || cost.some(t => t === 'colorless');
  }

  function owned(name) { return D.counts[name.toLowerCase()] || 0; }
  function slotsLeft() { return 20 - D.deck.length; }
  function deckBasics() {
    // OJO: los fósiles NO cuentan. Este número existe para saber si el mazo puede ABRIR
    // partida, y un fósil en la mano es un Objeto: no vale como Pokémon inicial (la garantía
    // de básico de `drawInitialHand` usa el mismo criterio, `isBasicPokemon`).
    return D.deck.filter(c => window.isBasicPokemon && window.isBasicPokemon(c)).length;
  }
  // Nº de fósiles del mazo (los cuenta la regla de apertura: una línea fósil no abre sola).
  function deckFossils() { return D.deck.filter(c => c.cardType === 'fossil').length; }
  function deckHasFase2() { return D.deck.some(c => c.stage === 2 || c.stage === '2'); }

  // Construye la oferta concreta de una unidad (o null si no cabe).
  // Invariante anti-callejón: tamaño efectivo = min(definido, huecos, 2−copias).
  // Combo manual del admin (dependencias de diseño: Magnezone metal + Arceus
  // ex 1-1-1-1, Buzzwole ex + Celesteela 1-1…). El ancla arrastra su línea y
  // la de cada socio, todo a 1 copia; doble con la misma suerte que las líneas.
  function makeComboOffer(u, left, noDouble) {
    const src = (window.DRAFT_CARDS && window.DRAFT_CARDS.cards) || {};
    const cards = [];
    // Los socios pokémon de un combo son TOPS de sus propias líneas (no preevos):
    // cuentan para D.types (pack de perritos multi-tipo → soporte de cada tipo)
    const tops = [];
    cards.push(...(u.kind === 'pokemon' ? u.line : [u.top]));
    for (const id of u.combo) {
      const c = _byId && _byId.get(id);
      if (!c) return null;
      if (c.cardType === 'pokemon') {
        const pl = buildLine(c, src[id]);
        if (!pl) return null;
        cards.push(...pl);
        tops.push(c);
      } else {
        cards.push(c);
      }
    }
    // Conteo por NOMBRE dentro de la oferta (un combo puede traer dos cartas
    // del mismo nombre, p.ej. Unown GUARD + Unown POWER)
    const inOffer = {};
    cards.forEach(c => {
      const k = c.name.toLowerCase();
      inOffer[k] = (inOffer[k] || 0) + 1;
    });
    const fits = copies =>
      cards.length * copies <= left &&
      Object.keys(inOffer).every(k => (D.counts[k] || 0) + inOffer[k] * copies <= 2);
    let copies;
    if (u.bundleOverride === 2) {
      // bundle 2 = combo SIEMPRE doble, sin degradar (Wishiwashi 2-2): cabe o no sale
      if (!fits(2)) return null;
      copies = 2;
    } else if (u.bundleOverride !== 1 && !noDouble && u.rol === 'win' && fits(2) &&
               Math.random() < (CFG.weights.doubleLineChance || 0.2)) {
      // bundleOverride:1 = combo que NUNCA dobla (línea-excepción pesada tipo
      // Nidoqueen+Nidoking: 6 cartas, se ofrece como cualquier wincon suelta)
      copies = 2;
    } else if (fits(1)) {
      copies = 1;
    } else {
      return null;
    }
    const final = [];
    cards.forEach(c => { for (let i = 0; i < copies; i++) final.push(c); });
    return { u, cards: final, count: final.length, badge: '×' + final.length,
             tops, sub: copies === 2 ? '¡Combo doble!' : 'Combo' };
  }

  // ── Base de Eevee para una línea de eeveelution (se elige POR OFERTA) ──
  // Variedad: Sylveon arrastra siempre el Eevee de evolución potenciada (B1);
  // el resto, uno al azar de los 3 buenos. Eevee EX es una preevo MÁS (distinto
  // nombre → caben 2 + 2 normales = 4 eevees): solo entra cuando ya tienes 2
  // Eevees no-ex (los normales agotados), hasta 2 copias. La eeveelution que lo
  // acompaña la decide el filtro de color normal (no hace falta lógica extra).
  const EEVEE_GOOD = ['B1-184', 'A4-134', 'A1A-061']; // boosted / find-a-friend / continuous-steps
  const EEVEE_BOOSTED = 'B1-184';
  const EEVEE_EX = 'A3B-056';
  function eeveeBaseFor(top) {
    const tn = (top.name || '').toLowerCase();
    if (owned('eevee') < 2) {
      const id = tn.indexOf('sylveon') === 0 ? EEVEE_BOOSTED
        : EEVEE_GOOD[Math.floor(Math.random() * EEVEE_GOOD.length)];
      return _byId.get(id) || _byId.get(EEVEE_BOOSTED);
    }
    if (owned('eevee ex') < 2) return _byId.get(EEVEE_EX);
    return null; // 2 normales + 2 ex ya en el mazo: no caben más eevees
  }

  function makeOffer(u, opts) {
    opts = opts || {};
    const left = slotsLeft();
    // Al rerollear la suerte NO triggea: ni líneas dobles, ni combos dobles, ni robo ×2.
    const noDouble = opts.noDouble || _rerollNoLuck;
    if (u.combo && u.combo.length &&
        Math.random() < (u.comboChance != null ? u.comboChance : 1)) {
      // ESTRICTO: el combo sale completo o no sale (un Unown GUARD suelto es
      // carta muerta). Solo con comboChance<1 (combos meta) el roll fallido
      // cae a la oferta normal del ancla.
      return makeComboOffer(u, left, noDouble);
    }
    if (u.kind === 'pokemon' && u.line.length > 1) {
      // Línea de eeveelution: la base de Eevee se elige aquí, por oferta
      // (variedad + Eevee EX condicional). El resto de líneas usan su base fija.
      let line = u.line;
      if (line[0].name && line[0].name.toLowerCase() === 'eevee') {
        const base = eeveeBaseFor(u.top);
        if (!base) return null; // sin Eevee disponible (2 normales + 2 ex ya)
        line = line.slice(); line[0] = base;
      }
      const L = line.length;
      // Por defecto las líneas van a UNA copia (1-1 / 1-1-1); la versión
      // doble (2-2 / 2-2-2) es un golpe de suerte solo para wincons
      // evolutivas (o si el admin forzó bundle 2).
      const canDouble = L * 2 <= left && !line.some(m => owned(m.name) + 2 > 2);
      const canSingle = L <= left && !line.some(m => owned(m.name) + 1 > 2);
      const wantDouble = canDouble && u.bundleOverride !== 1 &&
        (u.bundleOverride === 2 ||
         (!noDouble && u.rol === 'win' &&
          Math.random() < (CFG.weights.doubleLineChance || 0.2)));
      if (wantDouble) {
        const cards = [];
        line.forEach(m => { cards.push(m, m); });
        return { u, cards, count: L * 2, badge: '×' + (L * 2),
                 sub: '¡Línea doble!' };
      }
      // bundle 2 = línea SIEMPRE doble (Maushold 2-2): si no cabe, no sale
      if (u.bundleOverride === 2) return null;
      if (canSingle) {
        // sub null: el abanico inferior ya refleja el nº de cartas (no repetir «1-1»)
        return { u, cards: line.slice(), count: L, badge: '×' + L, sub: null };
      }
      // FALLBACK — oferta de evolución: la línea completa no cabe (base al
      // máximo de copias, p.ej. ya llevas 2 Riolu, o falta espacio) pero el
      // tramo que falta sí: se ofrece solo la evolución (Lucario ×1).
      let ownedPrefix = 0;
      while (ownedPrefix < L && owned(line[ownedPrefix].name) >= 1) ownedPrefix++;
      if (ownedPrefix >= 1 && ownedPrefix < L) {
        const tail = line.slice(ownedPrefix);
        if (tail.length <= left && !tail.some(m => owned(m.name) + 1 > 2)) {
          return { u, cards: tail.slice(), count: tail.length,
                   badge: '×' + tail.length, sub: 'Evolución' };
        }
      }
      return null;
    }
    // Básico suelto o trainer: 1 copia por defecto. El ROBO va siempre ×1, SALVO
    // en la 1ª oleada de robo (`roboLucky`): ahí cada opción de robo tira la misma
    // suerte que una línea doble para salir ×2. Con el cap de «1 doble por ronda»
    // suele aparecer UNA opción ×2 (carta aleatoria) — épico cuando sale Research ×2.
    let base = u.bundleOverride || 1;
    let roboLucky = false;
    if (!u.bundleOverride && u.kind === 'trainer' && u.rol === 'robo' &&
        opts.roboLucky && !noDouble &&
        Math.random() < (CFG.weights.roboLuckyChance || 0.35)) {
      base = 2; roboLucky = true;
    }
    let eff = Math.min(base, 2 - owned(u.name), left);
    if (eff < 1) return null;
    // Parejas con auto-sinergia (Falinks, Passimian…): SIEMPRE las 2 copias
    // de la MISMA carta — si no caben las dos, la oferta no aparece
    if (u.kind === 'pokemon' && u.bundleOverride === 2 && eff < 2) return null;
    const cards = [];
    for (let i = 0; i < eff; i++) cards.push(u.top);
    const isRoboDouble = roboLucky && eff === 2;
    return { u, cards, count: eff, badge: '×' + eff,
             sub: isRoboDouble ? '¡Robo doble!' : null };
  }

  // ¿Hay en el mazo una línea one-of (Fase 2 con 1 sola copia)?
  function deckHasOneofF2() {
    const counts = {};
    D.deck.forEach(c => {
      if (c.stage === 2 || c.stage === '2') {
        const k = c.name.toLowerCase();
        counts[k] = (counts[k] || 0) + 1;
      }
    });
    return Object.values(counts).some(v => v === 1);
  }

  // Peso de una unidad dentro de su categoría (multiplicadores suaves)
  function unitWeight(u) {
    const W = CFG.weights;
    // Condicionales cumplidos: los de carta nombrada van bajos (no regalar el
    // soporte perfecto); los de CLASE traen su requierePeso alto (pegamento
    // del arquetipo: Lusamine, Sada, Turo…)
    if (u.requiere && u.requiere.length) return u.requierePeso || W.requiereWeight || 0.35;
    if (u.name.toLowerCase() === 'rare candy') {
      if (!deckHasFase2()) return W.rareCandyBase || 0.5;
      if (deckHasOneofF2()) return W.rareCandyOneof || 6;
      return W.rareCandyFase2 || 3;
    }
    let w = 1;
    // Los incoloros entran en cualquier arquetipo: sin penalti saturan el pool
    if (u.kind === 'pokemon' && u.top.element === 'colorless') {
      w *= (W.colorlessWeight || 0.55);
    }
    // Rareza manual por carta (perros legendarios robo, etc.)
    if (u.weight != null) w *= u.weight;
    return w;
  }

  // ── Variedad entre oleadas (feedback de Daniel 2026-08-15) ──
  // Una carta que YA se ofreció y no se eligió pierde un poco de peso cada vez
  // que vuelve a salir: se notaba muy repetitivo. Es un descuento SUAVE con
  // suelo — puede que quisieras las dos y la rechazada siga siendo una opción.
  // Inclinación por RAMP: si el mazo ya trae motores de energía de un tipo (Mantyke [W]),
  // los Pokémon de ESE tipo salen algo más a menudo. Suave y con tope: no cambia ningún
  // gate (siguen teniendo que ser jugables), solo el peso dentro de su categoría.
  function leanBonus(u) {
    if (!D || !D.lean || u.kind !== 'pokemon' || !u.top) return 1;
    const n = D.lean[u.top.element] || 0;
    if (!n) return 1;
    const W = CFG.weights || {};
    return Math.min(W.rampLeanCap != null ? W.rampLeanCap : 2.2,
                    Math.pow(W.rampLeanWeight != null ? W.rampLeanWeight : 1.5, n));
  }

  function seenPenalty(u) {
    const n = (D && D.seen && D.seen[u.name.toLowerCase()]) || 0;
    if (!n) return 1;
    const W = CFG.weights || {};
    const dec = W.seenDecay != null ? W.seenDecay : 0.72;
    const floor = W.seenFloor != null ? W.seenFloor : 0.3;
    return Math.max(floor, Math.pow(dec, n));
  }

  // ════════════════════════════════════════════════════════════
  //  GENERACIÓN DE OLEADAS
  // ════════════════════════════════════════════════════════════
  function rollFrom(dist) {
    let total = 0;
    for (const k in dist) total += dist[k];
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const k in dist) { r -= dist[k]; if (r <= 0) return k; }
    return Object.keys(dist)[0];
  }

  // Cartas del mazo por rol (se acumula en cada pick, en applyPick)
  function deckRolCount(rol) {
    return (D && D.rolCards && D.rolCards[rol]) || 0;
  }

  // ── Soportes de arquetipo: tipo / typesupport / Mega ──
  function deckHasMega() { return D.deck.some(c => /\bmega\b/i.test(c.name || '')); }
  function winSaturated() { return deckRolCount('win') >= (CFG.weights.winSaturatedAt || 8); }
  // Roles de SOPORTE (admiten oferta especulativa a peso bajo si su condición aún
  // no se cumple). Los payoffs (win/robo/lead, p.ej. los perros) NO: hard-gate.
  const SPEC_ROLES = { tech: 1, consistencia: 1, typesupport: 1, utilidad: 1 };
  // ¿La unidad es un soporte de arquetipo cuya condición NO se cumple todavía?
  // Devuelve 'mega' | 'color' | 'type' (motivo) o null (cumple / no aplica).
  function condUnmet(u) {
    if (u.requiereMega && !deckHasMega()) return 'mega';
    // Perros legendarios (robo ligado a un tipo): por ENERGÍA — su motor necesita
    // su propia energía, así que miran D.colors (coste), no el tipo de Pokémon.
    if (u.color && u.rol === 'robo' && u.kind === 'pokemon')
      return (D.colors && !D.colors.has(u.color)) ? 'color' : null;
    // Soporte de TIPO (Korrina, Fisher, Misty, typesupport…): mencionan «Pokémon
    // de tipo X» → miran el TIPO de los Pokémon del mazo (D.types), NO la energía.
    // Caso Flygon ex: usa energía de lucha pero es DRAGÓN → sin Pokémon de lucha,
    // no sale soporte de lucha.
    if (u.color && D.types && !D.types.has(u.color)) return 'color';
    if (u.rol === 'typesupport' && D.types && !D.types.has(u.top.element)) return 'type';
    return null;
  }

  // Distribución efectiva de la oleada actual (con modificadores suaves)
  function waveDist(waveDef) {
    const dist = Object.assign({}, waveDef.slots);
    const W = CFG.weights;
    if (waveDef.filler) {
      const b = deckBasics();
      if ('basicos' in dist) {
        if (b >= (W.basicsSoftMax || 10)) dist.basicos = 0;
        else if (b < (W.basicsLowAt || 4)) dist.basicos *= (W.basicsLowBoost || 4);
      }
    }
    // Soft cap de motor: con el robo cubierto, el hueco se lo lleva consistencia
    if ('robo' in dist && !waveDef.roboLucky &&
        deckRolCount('robo') >= (W.roboSoftCapAt || 4)) {
      const moved = dist.robo * (1 - (W.roboSoftCapMult || 0.4));
      dist.robo -= moved;
      dist.consistencia = (dist.consistencia || 0) + moved;
    }
    // Soft cap de leads: con la apertura cubierta, el hueco va a WIN
    // (segunda amenaza → combos con sentido, más ex en el draft)
    if ('lead' in dist && deckRolCount('lead') >= (W.leadSoftCapAt || 2)) {
      const moved = dist.lead * (1 - (W.leadSoftCapMult || 0.4));
      dist.lead -= moved;
      dist.win = (dist.win || 0) + moved;
    }
    return dist;
  }

  function rollCategory(waveDef) {
    let cat = rollFrom(waveDist(waveDef));
    if (cat === 'pokemon') cat = rollFrom(CFG.fillerPokemon || { secundario: 0.6, utilidad: 0.3, win: 0.1 }) || 'secundario';
    return cat;
  }

  // Candidatos de una categoría que caben ahora mismo
  function categoryOffers(cat, usedNames, waveDef) {
    // Atacantes filtran por coste pagable; el soporte de tipo por ELEMENTO
    // (Baxcalibur no ataca: su función está ligada a su color sí o sí).
    // Utilidad = tech splashable, entra en cualquier color.
    const colorCats = { win: 1, secundario: 1, lead: 1, basicos: 1 };
    const out = [];
    _pool.forEach(u => {
      if (usedNames.has(u.name.toLowerCase())) return;
      // REROLL: las 5 de la oleada anterior NO pueden repetirse (garantía de Daniel)
      if (_rerollBan && _rerollBan.has(u.name.toLowerCase())) return;
      if (cat === 'basicos') {
        if (!(u.kind === 'pokemon' && u.line.length === 1)) return;
      } else if (u.rol !== cat) return;
      let dualOnly = false, speculative = false, dogShare = false, dogWeight = 0, offColor = false;
      if (u.splash === false && colorCats[cat]) {
        // splash:false = atado a SU elemento (escala con su propia energía aunque
        // el coste sea incoloro: Miraidon ex, Wailord). Nunca splash ni 2º color.
        if (D.colors && !D.colors.has(u.top.element)) return;
      } else if (colorCats[cat] && !unitPayable(u)) {
        // Candidato de SEGUNDO tipo: solo si el mazo es apto (wincon splash-apta)
        // y este pokémon también es "ligero" (≤1 energía tipada en su ataque ppal.)
        if (!(D.dualApt && u.kind === 'pokemon' && isLight(u.top))) return;
        // Regla de Daniel: si su ataque principal lleva ≥1 incolora encaja como 2º
        // color (peso de doble tipo); si es 100% de su tipo (Zoroark ex [oscuro])
        // está atado a su tipo → chance muy bajo (peso especulativo), no normal.
        if (isSplashApt(u.top)) dualOnly = true; else speculative = true;
      } else if (colorCats[cat] && u.kind === 'pokemon' && D.colors && D.colors.size &&
                 TYPED.has(u.top.element) && !D.colors.has(u.top.element)) {
        // Paga con incoloras (por eso llega aquí) pero su TIPO no es el del mazo:
        // Marshadow [P] en un mazo de fuego. Sigue siendo jugable, pero no aporta
        // arquetipo → sale a chance reducido (feedback de Daniel 2026-08-15).
        offColor = true;
      }
      // Soporte de arquetipo (tipo / typesupport / Mega) cuya condición aún NO se
      // cumple: los PAYOFFS (perros robo, win) = hard-gate; el SOPORTE puede salir
      // raro como pick especulativo, pero solo si el mazo sigue apto a multi-energía
      // (y los de Mega, además, solo si aún hay hueco de wincon).
      const unmet = condUnmet(u);
      if (unmet) {
        if (unmet === 'color' && u.rol === 'robo' && u.kind === 'pokemon') {
          // Robo ligado a un tipo (perros legendarios) FUERA de su tipo: aun así
          // pueden salir en robo, pero los 3 COMBINADOS = el chance de 1 (se
          // reparte en weightedPick). Mazo aún incoloro → chance normal (deciden
          // el tipo al pickarse). Mazo de OTRO tipo → chance baja especulativa,
          // solo si sigue apto a multi-energía (como Korrina).
          const undecided = D.colors && D.colors.size === 0;
          if (!undecided && !D.dualApt) return;
          dogShare = true;
          dogWeight = undecided ? (u.weight != null ? u.weight : 1)
                                : (CFG.weights.speculativeWeight || 0.12);
        } else {
          if (!SPEC_ROLES[u.rol] || !D.dualApt) return;
          if (unmet === 'mega' && winSaturated()) return;
          speculative = true;
        }
      }
      if (!requireMet(u)) return; // condicional: su carta nombrada no está en el mazo
      const offer = makeOffer(u, waveDef);
      if (offer) {
        offer.dualOnly = dualOnly;
        offer.speculative = speculative;
        offer.dogShare = dogShare;
        offer.dogWeight = dogWeight;
        offer.offColor = offColor;
        out.push(offer);
      }
    });
    return out;
  }

  function weightedPick(offers) {
    let total = 0;
    // Perros legendarios fuera de su tipo: los que coexisten reparten un único
    // "peso de 1 carta" (los 3 combinados = el chance de uno, no el triple).
    const nShare = offers.filter(o => o.dogShare).length || 1;
    offers.forEach(o => {
      o._w = (o.dogShare
        ? (o.dogWeight / nShare)
        : unitWeight(o.u) *
            (o.dualOnly ? (CFG.weights.dualTypeWeight || 0.5) : 1) *
            (o.speculative ? (CFG.weights.speculativeWeight || 0.12) : 1) *
            (o.offColor ? (CFG.weights.offColorWeight || 0.4) : 1)) * seenPenalty(o.u) * leanBonus(o.u);
      total += o._w;
    });
    let r = Math.random() * total;
    for (const o of offers) { r -= o._w; if (r <= 0) return o; }
    return offers[offers.length - 1];
  }

  function buildWave() {
    const scripted = D.wave < (CFG.waves || []).length;
    const waveDef = scripted ? CFG.waves[D.wave] : Object.assign({ filler: true }, { slots: CFG.filler });
    const offers = [];
    const usedNames = new Set();
    let nichoCount = 0;

    for (let i = 0; i < 5; i++) {
      let offer = null;
      // 1º la categoría que toca; si está vacía, fallback por pesos del relleno; último recurso: cualquiera
      const tried = new Set();
      let cat = rollCategory(waveDef);
      for (let attempt = 0; attempt < 8 && !offer; attempt++) {
        if (cat && !tried.has(cat)) {
          tried.add(cat);
          let cands = categoryOffers(cat, usedNames, waveDef);
          if (waveDef.maxNicho != null && nichoCount >= waveDef.maxNicho) {
            cands = cands.filter(o => o.u.subtipo !== 'nicho');
          }
          if (cands.length) offer = weightedPick(cands);
        }
        if (!offer) cat = rollFrom(CFG.filler) === 'pokemon' ? rollFrom(CFG.fillerPokemon) : rollFrom(CFG.filler);
      }
      if (!offer) { // red de seguridad: cualquier unidad que quepa
        // 1ª pasada respetando el ban del reroll; si el pool no da, se relaja
        // (mejor repetir una que dejar la oleada con menos de 5 opciones).
        for (const pass of [1, 0]) {
          for (const u of _pool) {
            const k = u.name.toLowerCase();
            if (usedNames.has(k)) continue;
            if (pass && _rerollBan && _rerollBan.has(k)) continue;
            const o = makeOffer(u, {});
            if (o) { offer = o; break; }
          }
          if (offer) break;
        }
      }
      if (offer) {
        offers.push(offer);
        usedNames.add(offer.u.name.toLowerCase());
        if (offer.u.subtipo === 'nicho') nichoCount++;
      }
    }
    // La suerte tiene que SER rara: como mucho 1 «doble» por suerte por ronda.
    // Los garantizados por bundle ×2 (Wishiwashi, Maushold) están exentos —
    // son diseño, no suerte. Las extra se rehacen sin doble (1-1-1).
    let lucky = 0;
    for (let i = 0; i < offers.length; i++) {
      const o = offers[i];
      if (!o.sub || !o.sub.includes('doble') || o.u.bundleOverride === 2) continue;
      lucky++;
      if (lucky > 1) {
        const redo = makeOffer(o.u, { noDouble: true });
        if (redo) offers[i] = redo;
      }
    }
    // Registro de «ya se ofreció»: baja un poco su peso en oleadas futuras
    if (D.seen) offers.forEach(o => {
      const k = o.u.name.toLowerCase();
      D.seen[k] = (D.seen[k] || 0) + 1;
    });
    D.offers = offers;
  }

  // ════════════════════════════════════════════════════════════
  //  FLUJO DEL DRAFT
  // ════════════════════════════════════════════════════════════
  // El pool curado necesita un mínimo para que el draft funcione:
  // 5 win conditions distintas (oleada 1) y volumen para llenar oleadas.
  function poolProblems(pool) {
    if (draftMode() !== 'curado') return null;
    const wins = pool.filter(u => u.rol === 'win').length;
    const probs = [];
    if (wins < 5) probs.push(wins ? T('draft.probWinsSome', { n: wins }) : T('draft.probWinsNone'));
    if (pool.length < 20) probs.push(T('draft.probTotal', { n: pool.length }));
    return probs.length ? probs : null;
  }

  // ── El sobre: color/diseño aleatorio cada vez que se entra a la pestaña ──
  let _packTheme = null;
  function randomPackTheme() {
    const hue = Math.floor(Math.random() * 360);
    _packTheme = { hue, hue2: (hue + 28) % 360 };
    return _packTheme;
  }
  // Emblema del sobre (estilo badge oficial PROMO-A): cartas en abanico con la
  // del frente «elegida» (gesto de draft) + cápsula cromada con «DRAFT».
  // OJO: ids de degradado ÚNICOS por instancia — si el idle y el overlay
  // comparten ids, al ocultarse el idle (display:none) el del overlay se queda
  // sin relleno (el azul «desaparecía» al hacer clic).
  let _emblemUid = 0;
  function draftEmblem() {
    const u = 'e' + (++_emblemUid);
    return '<svg viewBox="0 0 220 96" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<defs>' +
        '<linearGradient id="c' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc3ff"/><stop offset="1" stop-color="#2f6cd2"/></linearGradient>' +
        '<linearGradient id="cl' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#bce6ff"/><stop offset="1" stop-color="#4f93e8"/></linearGradient>' +
        '<linearGradient id="cap' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4a8cf0"/><stop offset="0.5" stop-color="#2b5bbf"/><stop offset="1" stop-color="#1b3a8c"/></linearGradient>' +
        '<linearGradient id="chr' + u + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.42" stop-color="#cdd5e3"/><stop offset="0.56" stop-color="#959fb3"/><stop offset="1" stop-color="#eef2f8"/></linearGradient>' +
      '</defs>' +
      // CÁPSULA: marco cromado biselado + relleno azul + gloss + texto embossed
      '<rect x="74" y="24" width="142" height="48" rx="24" fill="url(#chr' + u + ')"/>' +
      '<rect x="78" y="28" width="134" height="40" rx="20" fill="url(#cap' + u + ')"/>' +
      '<rect x="83" y="31" width="124" height="15" rx="7.5" fill="#fff" opacity="0.24"/>' +
      '<text x="148" y="56" text-anchor="middle" font-family="system-ui,Arial,sans-serif" font-weight="800" font-size="26" letter-spacing="1.5" paint-order="stroke" stroke="#11306e" stroke-width="1" fill="#fff">DRAFT</text>' +
      // CARTAS en abanico (traseras)
      '<g stroke="#eef4fd" stroke-width="3" stroke-linejoin="round">' +
        '<rect x="6" y="26" width="40" height="54" rx="6" fill="url(#c' + u + ')" transform="rotate(-18 26 53)"/>' +
        '<rect x="40" y="24" width="40" height="54" rx="6" fill="url(#c' + u + ')" transform="rotate(10 60 51)"/>' +
      '</g>' +
      // carta «elegida» al frente (levantada, con pokéball)
      '<g transform="rotate(-3 42 42)">' +
        '<rect x="21" y="11" width="42" height="58" rx="6.5" fill="url(#cl' + u + ')" stroke="#fff" stroke-width="3.4"/>' +
        '<circle cx="42" cy="40" r="12" fill="#fff" stroke="#1b3a7a" stroke-width="2.2"/>' +
        '<path d="M30 40 H54" stroke="#1b3a7a" stroke-width="2.2"/>' +
        '<circle cx="42" cy="40" r="3.6" fill="#ec4940" stroke="#1b3a7a" stroke-width="1.6"/>' +
      '</g>' +
      '</svg>';
  }
  function packMarkup() {
    const t = _packTheme || randomPackTheme();
    // .dr-pack = raíz (posición/sombra) · .dr-pack-skin = piel recortada a la
    // silueta de bolsa (reloj de arena) · el glow y el hint quedan FUERA de la
    // piel para no recortarse.
    return '<div class="dr-pack" style="--h:' + t.hue + ';--h2:' + t.hue2 + '">' +
      '<div class="dr-pack-glow"></div>' +
      '<div class="dr-pack-skin">' +
        '<div class="dr-pack-pattern"></div>' +
        '<div class="dr-pack-shine"></div>' +
        '<div class="dr-pack-crimp"></div>' +
        '<div class="dr-pack-seam"></div>' +
        '<div class="dr-pack-seam-shine"></div>' +
        '<div class="dr-pack-crack"></div>' +
        '<div class="dr-pack-badge">' + draftEmblem() + '</div>' +
      '</div>' +
      '<div class="dr-cut-hint">' + T('draft.tapToOpen') + '</div>' +
      '</div>';
  }

  // Pantalla inicial fusionada: explicación + sobre (clic para abrir)
  // Solo el texto de estado del pool (sin tocar el sobre): reutilizable al cambiar idioma
  function updatePoolInfo() {
    const info = $('dr-pool-info');
    if (!info) return null;
    _pool = _pool || buildPool();
    const probs = draftMode() === 'curado' ? poolProblems(_pool) : null;
    // El conteo del pool («1029 cartas») se quitó (el tagline ya dice «+1000 cartas»);
    // solo se muestra un AVISO si el pool curado no da para draftear.
    if (draftMode() === 'curado') {
      info.innerHTML = probs
        ? '<span class="dr-pool-warn">' + T('draft.poolWarn', { probs: probs.join(T('draft.probJoin')) }) + '</span>'
        : '';
    } else {
      info.textContent = T('draft.poolAuto');
    }
    return probs;
  }
  // Selector de variante del pool (completo / meta): marca el activo y oculta
  // el control si no procede (modo auto, o sin datos de meta cargados).
  function syncPoolToggle() {
    const wrap = $('dr-pool-toggle');
    if (!wrap) return;
    const show = draftMode() === 'curado' && metaAvailable();
    wrap.classList.toggle('hidden', !show);
    if (!show) return;
    const v = poolVariant();
    wrap.querySelectorAll('.dr-pool-opt').forEach(b => {
      const on = b.dataset.variant === v;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  // ── "Peek" del pool: bocadillo encima del sobre con cartas de ejemplo (win
  //    conditions + algún lead/typesupport) de lo que contiene CADA pool. ──
  let _peekSets = null;        // {full:[cards], meta:[cards]} — fijo por carga de página
  let _peekRAF = null, _peekX = 0, _peekVar = null, _peekDrag = false;

  // Muestra un sample del pool (variante): 6-8 win + 2-4 lead/typesupport, al azar.
  function peekCards(variant) {
    const src = (window.DRAFT_CARDS && window.DRAFT_CARDS.cards) || {};
    const byId = new Map((window.CARDS_DB || []).map(c => [c.id, c]));
    const meta = variant === 'meta' && metaAvailable();
    const mIdx = meta ? metaCardIndex() : null;
    const ambig = meta ? ambiguousNames() : null;
    const wins = [], leads = [];
    Object.keys(src).forEach(id => {
      const cfg = src[id], card = byId.get(id);
      if (!card || !card.cardType || card.cardType === 'fossil') return;
      if (!cfg || cfg.rol === 'excluir') return;
      if (mIdx) {
        const nm = card.name.toLowerCase();
        if (!mIdx.names.has(nm)) return;
        if (ambig.has(nm) && !mIdx.sigs.has(cardSig(card))) return;
      }
      if (cfg.rol === 'win') wins.push(card);
      else if (cfg.rol === 'lead' || cfg.rol === 'typesupport') leads.push(card);
    });
    const shuf = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; };
    const nWin = 12 + Math.floor(Math.random() * 5);   // 12-16 (×2)
    const nLead = 4 + Math.floor(Math.random() * 5);   // 4-8 (×2)
    return shuf(shuf(wins).slice(0, nWin).concat(shuf(leads).slice(0, nLead)));
  }
  function buildPeekSets() {
    if (_peekSets) return _peekSets;
    _peekSets = { full: peekCards('full'), meta: peekCards('meta') };
    return _peekSets;
  }
  function peekVisible() { const r = $('dr-pool-reel'); return !!(r && r.offsetParent !== null); }
  function stopPeekAuto() { if (_peekRAF) { cancelAnimationFrame(_peekRAF); _peekRAF = null; } }
  function startPeekAuto() {
    stopPeekAuto();
    const reel = $('dr-pool-reel'); const track = reel && reel.querySelector('.dr-peek-track');
    if (!track) return;
    const SPEED = 13;   // px/s (lenta)
    let last = null;
    const frame = (t) => {
      if (!document.body.contains(track)) { _peekRAF = null; return; }
      if (last == null) last = t;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!_peekDrag && peekVisible()) _peekX -= SPEED * dt;
      const half = track.scrollWidth / 2;
      if (half > 0) { while (_peekX <= -half) _peekX += half; while (_peekX > 0) _peekX -= half; }
      track.style.transform = 'translateX(' + _peekX + 'px)';
      _peekRAF = requestAnimationFrame(frame);
    };
    _peekRAF = requestAnimationFrame(frame);
  }
  function renderPoolPeek() {
    const reel = $('dr-pool-reel'); if (!reel) return;
    const variant = (draftMode() === 'curado' && metaAvailable()) ? poolVariant() : 'full';
    const sets = buildPeekSets();
    const cards = (sets[variant] && sets[variant].length) ? sets[variant] : sets.full;
    if (!cards || !cards.length) { reel.innerHTML = ''; const pk = $('dr-pool-peek'); if (pk) pk.style.display = 'none'; return; }
    const imgHtml = cards.map(c => {
      const src = window.localizeImg ? window.localizeImg(c.image) : c.image;
      // Sin lazy (son pocas): si no cargan, el hueco colapsaría y quedarían vacíos.
      return '<div class="dr-peek-card"><img draggable="false" src="' + src + '" alt=""></div>';
    }).join('');
    const build = () => {
      // Duplicado para bucle continuo.
      reel.innerHTML = '<div class="dr-peek-track">' + imgHtml + imgHtml + '</div>';
      _peekX = 0; _peekVar = variant;
      wirePeekDrag();
      startPeekAuto();
      reel.style.opacity = '1';
    };
    // Al CAMBIAR de pool: fundido suave; en el primer pintado, directo.
    if (_peekVar !== null && _peekVar !== variant) {
      reel.style.transition = 'opacity .16s ease';
      reel.style.opacity = '0';
      setTimeout(build, 160);
    } else build();
  }
  function wirePeekDrag() {
    const reel = $('dr-pool-reel'); if (!reel || reel._peekWired) return; reel._peekWired = true;
    let startX = 0, baseX = 0, moved = false;
    const apply = () => {
      const track = reel.querySelector('.dr-peek-track'); if (!track) return;
      const half = track.scrollWidth / 2;
      if (half > 0) { while (_peekX <= -half) _peekX += half; while (_peekX > 0) _peekX -= half; }
      track.style.transform = 'translateX(' + _peekX + 'px)';
    };
    reel.addEventListener('pointerdown', e => { _peekDrag = true; startX = e.clientX; baseX = _peekX; moved = false; try { reel.setPointerCapture(e.pointerId); } catch (er) {} });
    reel.addEventListener('pointermove', e => { if (!_peekDrag) return; const dx = e.clientX - startX; if (Math.abs(dx) > 4) moved = true; _peekX = baseX + dx; apply(); });
    const end = () => { _peekDrag = false; };
    reel.addEventListener('pointerup', end);
    reel.addEventListener('pointercancel', end);
    // Tocar una carta (sin arrastrar) = zoom.
    reel.addEventListener('click', e => {
      if (moved) return;
      const img = e.target.closest('.dr-peek-card img');
      if (img && window.openZoomFromImage) window.openZoomFromImage(img.src, img);
    });
  }
  // Coloca el bocadillo encima del sobre (medido en vivo → robusto al escalado
  // móvil y al tamaño del sobre). Si no hay sobre, lo oculta. Deja margen amplio:
  // el sobre FLOTA (±9px) y la cola NO debe llegar a tocarlo.
  function positionPeek() {
    const peek = $('dr-pool-peek'), start = $('dr-start'); if (!peek || !start) return;
    if ($('dr-start') && $('dr-start').classList.contains('mp-ready')) { peek.style.display = 'none'; return; }
    const pack = document.querySelector('#dr-pack-stage .dr-pack');
    if (!pack) { peek.style.display = 'none'; return; }
    peek.style.display = '';
    const sr = start.getBoundingClientRect();
    // Referencia: el hint "toca para abrir" (top:-38px sobre el sobre, oscila) si está
    // visible → el bocadillo queda POR ENCIMA de él sin taparlo; si no, sobre el sobre.
    const hint = document.querySelector('#dr-pack-stage .dr-cut-hint');
    let refTop, gap;
    if (hint && hint.offsetParent !== null) { refTop = hint.getBoundingClientRect().top; gap = 34; }
    else { refTop = pack.getBoundingClientRect().top; gap = 38; }
    let bottom = Math.max(8, sr.bottom - refTop + gap);
    // CLAMP anti-solape del botón "Jugar con un amigo": en pantallas de poca altura el
    // bocadillo (anclado sobre el sobre) subía hasta TAPAR el botón (y la tagline). El
    // botón vive en flujo desde arriba; el bocadillo/sobre se anclan abajo → chocan en el
    // medio. Aquí se BAJA el bocadillo lo justo para que su borde superior quede por
    // debajo del botón (se pega más al sobre; su cola sigue apuntando al sobre). Así el
    // botón —y todo lo de arriba— queda siempre visible y clicable.
    const fab = $('dr-mp-fab');
    if (fab && fab.offsetParent !== null) {
      const fr = fab.getBoundingClientRect();
      const ph = peek.getBoundingClientRect().height || peek.offsetHeight || 140;
      const maxBottom = sr.bottom - (fr.bottom + 14) - ph;   // deja el top del bocadillo 14px bajo el botón
      if (bottom > maxBottom) bottom = Math.max(8, maxBottom);
    }
    peek.style.bottom = bottom + 'px';
  }
  let _peekResizeT = null;
  window.addEventListener('resize', () => { clearTimeout(_peekResizeT); _peekResizeT = setTimeout(positionPeek, 160); });

  function refreshStartInfo() {
    if (D && D.mp) { positionPeek(); return; }   // sobre de "listo" del multijugador: no clobber
    const stage = $('dr-pack-stage');
    if (!stage) return;
    syncPoolToggle();
    const probs = updatePoolInfo();
    if (probs) { stage.innerHTML = ''; positionPeek(); return; }
    // Sobre listo — clic para abrir. El COLOR es estable dentro de la sesión: NO se re-randomiza
    // en cada refresco (antes cambiaba al alternar pool completo/meta). Solo se genera si no hay.
    if (!_packTheme) randomPackTheme();
    stage.innerHTML = packMarkup();
    const pack = stage.querySelector('.dr-pack');
    pack.addEventListener('click', () => beginDraft(true), { once: true });
    renderPoolPeek();
    positionPeek();
    setTimeout(positionPeek, 60);   // re-medir tras asentar el layout
  }
  // Chispa limpia: punto de luz con resplandor que se eleva y cae (gravedad).
  // up=true → brota hacia arriba en abanico; up=false → estallido radial.
  function drawSpark(x, y, hue, up) {
    const p = document.createElement('div');
    p.className = 'dr-spark';
    const s = 3 + Math.random() * 6;
    const light = 66 + Math.random() * 20;
    p.style.cssText = 'left:' + x + 'px;top:' + y + 'px;width:' + s + 'px;height:' + s +
      'px;background:radial-gradient(circle, hsl(' + hue + ',96%,' + light.toFixed(0) +
      '%) 0%, hsla(' + hue + ',96%,60%,0) 72%);';
    document.body.appendChild(p);
    const ang = up ? (-Math.PI / 2 + (Math.random() - 0.5) * 1.7) : (Math.random() * Math.PI * 2);
    const dist = 24 + Math.random() * 76;
    const grav = 26 + Math.random() * 48;
    p.animate(
      [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 0.95 },
       { transform: 'translate(calc(-50% + ' + (Math.cos(ang) * dist).toFixed(0) +
         'px), calc(-50% + ' + (Math.sin(ang) * dist + grav).toFixed(0) + 'px)) scale(0)', opacity: 0 }],
      { duration: 640 + Math.random() * 520, easing: 'cubic-bezier(0.12,0.6,0.3,1)' }
    ).onfinish = () => p.remove();
  }
  function burstSparks(x, y, n, hue, up, spreadW) {
    for (let i = 0; i < n; i++) {
      setTimeout(() => drawSpark(x + (spreadW ? (Math.random() - 0.5) * spreadW : 0), y, hue, up), i * 12);
    }
  }
  const EL_HUE = {
    grass: 130, fire: 14, water: 205, lightning: 50, psychic: 290,
    fighting: 28, darkness: 250, metal: 210, dragon: 45, colorless: 210,
  };
  function elHue(el) { return EL_HUE[el] != null ? EL_HUE[el] : 210; }

  // Anillo de impacto limpio (haptic): se expande desde un punto y se desvanece.
  // Sustituye a las chispas dispersas — sensación de pulsar/aterrizar más nítida.
  function pulseRing(x, y, color, size) {
    const s = size || 26;
    const ring = document.createElement('div');
    ring.style.cssText = 'position:fixed;left:' + x + 'px;top:' + y + 'px;width:' + s + 'px;height:' +
      s + 'px;margin:' + (-s / 2) + 'px 0 0 ' + (-s / 2) + 'px;border-radius:50%;border:2.5px solid ' +
      color + ';box-shadow:0 0 12px ' + color + ',inset 0 0 6px ' + color +
      ';z-index:9600;pointer-events:none;';
    document.body.appendChild(ring);
    ring.animate(
      [{ transform: 'scale(0.45)', opacity: 0.95, borderWidth: '3px' },
       { transform: 'scale(2.4)', opacity: 0, borderWidth: '0.5px' }],
      { duration: 470, easing: 'cubic-bezier(0.2,0.7,0.3,1)' }).onfinish = () => ring.remove();
  }

  // Silueta de la piel YA CORTADA a la altura de la soldadura (~y45): el borde
  // superior es plano (el corte) y no queda nada de sobre por encima.
  const SKIN_CUT = "path('M0 45 L222 45 L222 58 C222 71 218 80 217 92 L217 400 " +
    "C217 418 220 430 222 436 Q222 452 206 452 L16 452 Q0 452 0 436 C2 430 5 418 5 400 " +
    "L5 92 C4 80 0 71 0 58 L0 45 Z')";

  // El SELLO superior arrancado: una pieza de plástico que se separa LIMPIA del
  // sobre y se va hacia arriba (leve despegue → acelera y se desvanece con un
  // toque de motion blur). Lleva su media línea de soldadura en el borde inferior.
  function spawnPlasticStrip(r) {
    const strip = document.createElement('div');
    strip.className = 'dr-plastic-strip';
    strip.style.setProperty('--h', (_packTheme && _packTheme.hue) || 210);
    strip.style.cssText += ';left:' + r.left + 'px;top:' + r.top + 'px;width:' +
      r.width.toFixed(0) + 'px;height:50px;';
    document.body.appendChild(strip);
    strip.animate(
      [{ transform: 'translateY(0) rotate(0deg)', opacity: 1, filter: 'blur(0px)',
         easing: 'cubic-bezier(0.45,0,0.25,1)' },
       { transform: 'translateY(-9px) rotate(0.6deg)', opacity: 1, filter: 'blur(0px)', offset: 0.22 },
       { transform: 'translateY(-184px) translateX(11px) rotate(2.4deg)', opacity: 0, filter: 'blur(3px)', offset: 1 }],
      { duration: 540, fill: 'forwards' }).onfinish = () => strip.remove();
  }

  // Apertura por CLIC: el sobre (en la posición donde estaba) se abre, y las 5
  // cartas salen DE CARA emergiendo del sobre hasta su posición real. Sin
  // jump-cut: el fondo se aclara durante el vuelo y las cartas destapan la opción
  // al aterrizar.
  function openPack(idleRect, floatY, done) {
    renderWave(true, true); // ronda 1 oculta (reveal-pending) → conocer destinos
    const gold = D.offers.some(o => o.sub && o.sub.includes('doble'));
    const hue = (_packTheme && _packTheme.hue) || 210;
    const sparkHue = gold ? 45 : hue;

    const ov = document.createElement('div');
    ov.className = 'dr-intro opening';
    ov.innerHTML = packMarkup();
    $('view-draft').appendChild(ov);
    const pack = ov.querySelector('.dr-pack');
    if (gold) pack.classList.add('lucky');
    // Colocar el sobre EXACTAMENTE donde estaba el idle. OJO: el overlay tiene
    // backdrop-filter, que lo convierte en bloque contenedor de los hijos fixed
    // → hay que restar su offset (si no, el clon cae +48px ≈ altura del nav).
    if (idleRect) {
      const ovRect = ov.getBoundingClientRect();
      pack.style.cssText += ';position:fixed;margin:0;left:' + (idleRect.left - ovRect.left) +
        'px;top:' + (idleRect.top - (floatY || 0) - ovRect.top) + 'px;width:' + idleRect.width +
        'px;height:' + idleRect.height + 'px;';
      // asentamiento SUAVE desde la posición flotante actual hasta el reposo (sin jump)
      pack.animate(
        [{ transform: 'translateY(' + (floatY || 0).toFixed(1) + 'px)' }, { transform: 'translateY(0)' }],
        { duration: 440, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    }
    const crimp = pack.querySelector('.dr-pack-crimp');
    const seamShine = pack.querySelector('.dr-pack-seam-shine');
    if (seamShine) seamShine.style.display = 'none'; // el glint idle no molesta al abrir
    const hint = pack.querySelector('.dr-cut-hint');
    if (hint) hint.remove();

    window.sfx && window.sfx('draft.openPack');

    setTimeout(rip, 240);
    setTimeout(burst, 560);

    // ── 2) CORTE limpio: el sello se separa de UNA pieza y se va; la piel se
    // recorta a la altura de la soldadura (nada de sobre por ENCIMA del corte) ──
    function rip() {
      const r = pack.getBoundingClientRect();
      const skin = pack.querySelector('.dr-pack-skin');
      if (skin) skin.style.clipPath = SKIN_CUT;
      // resplandor LIMPIO del ancho de la soldadura, emana del corte hacia arriba
      const glow = pack.querySelector('.dr-pack-glow');
      if (glow) glow.animate(
        [{ opacity: 0, transform: 'scaleY(0.4)' },
         { opacity: 1, transform: 'scaleY(1.08)', offset: 0.5 },
         { opacity: 0.85, transform: 'scaleY(1)' }],
        { duration: 540, easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'forwards' });
      // chispas a lo ancho del corte
      burstSparks(r.left + r.width / 2, r.top + 47, 24, sparkHue, true, r.width * 0.82);
      // el plástico se levanta LIMPIO y se va (su media soldadura con él; la otra
      // mitad queda en el sobre = .dr-pack-seam)
      spawnPlasticStrip({ left: r.left, top: r.top, width: r.width });
      if (crimp) crimp.style.opacity = '0';
    }

    // ── 3) las 5 cartas salen del sobre CON sus stacks agrupados → despliegan ──
    function burst() {
      window.sfx && window.sfx('draft.cardsOut');
      const packR = pack.getBoundingClientRect();
      const options = [...document.querySelectorAll('#dr-options .dr-option')].slice(0, 5);
      const cx = window.innerWidth / 2, cy = window.innerHeight * 0.44;
      const mouthX = packR.left + packR.width / 2, mouthY = packR.top + 42;
      const DUR = 1180, STAG = 42, lastDelay = STAG * 4;
      options.forEach((opt, i) => {
        const stack = opt.querySelector('.dr-stack');
        if (!stack) return;
        const sr = stack.getBoundingClientRect();
        const scx = sr.left + sr.width / 2, scy = sr.top + sr.height / 2;
        const ox = (i - 2) * 9, oy = (i - 2) * -4, orot = (i - 2) * 2.4;
        const mouth = 'translate(' + (mouthX - scx).toFixed(0) + 'px,' + (mouthY - scy).toFixed(0) + 'px) scale(0.3)';
        const center = 'translate(' + (cx + ox - scx).toFixed(0) + 'px,' + (cy + oy - scy).toFixed(0) +
          'px) rotate(' + orot + 'deg) scale(1)';
        // Volamos un CLON de la opción REAL (stack con sus traseras agrupadas y
        // el mismo glow) → al aterrizar no hay pop ni cambio de brillo.
        const clone = opt.cloneNode(true);
        const cf = clone.querySelector('.dr-opt-foot'); if (cf) cf.style.display = 'none';
        clone.classList.remove('reveal-pending');
        clone.style.cssText = 'position:fixed;margin:0;left:' + sr.left + 'px;top:' + sr.top +
          'px;width:' + sr.width + 'px;z-index:9520;pointer-events:none;';
        document.body.appendChild(clone);
        clone.animate(
          [{ transform: mouth, opacity: 0, easing: 'cubic-bezier(0.2,0.7,0.3,1)' },
           { transform: center, opacity: 1, offset: 0.40, easing: 'cubic-bezier(0.5,0,0.2,1)' },
           { transform: center, opacity: 1, offset: 0.56, easing: 'cubic-bezier(0.4,0.05,0.25,1)' },
           { transform: 'none', opacity: 1, offset: 1 }],
          { duration: DUR, delay: i * STAG, fill: 'both' }
        ).onfinish = () => {
          opt.classList.remove('reveal-pending'); // destapa la opción real (idéntica)
          clone.remove();
        };
      });
      // al soltar las cartas el sobre se asienta y sale; el fondo se aclara
      setTimeout(() => {
        ov.classList.add('clearing');
        pack.animate(
          [{ opacity: 1, transform: 'translateY(0) scale(1)', filter: 'brightness(1)' },
           { opacity: 1, transform: 'translateY(10px) scale(0.99)', offset: 0.18 },
           { opacity: 0, transform: 'translateY(42vh) scale(0.9)', filter: 'brightness(0.55)' }],
          { duration: 640, easing: 'cubic-bezier(0.4,0,0.9,1)', fill: 'forwards' });
      }, DUR * 0.56);
      setTimeout(() => {
        ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' })
          .onfinish = () => { ov.remove(); done(); };
      }, DUR + lastDelay);
    }
  }

  // Vuelve a la pantalla inicial con un sobre nuevo (color aleatorio)
  function backToStart() {
    D = null;
    showSection('start');
    refreshStartInfo();
  }

  // animate=true → apertura del sobre (clic real); false → directo (tests)
  function beginDraft(animate) {
    _pool = buildPool(); // siempre fresco (la categorización pudo cambiar)
    const probs = poolProblems(_pool);
    if (probs) {
      refreshStartInfo();
      showSection('start');
      window.pbToast && window.pbToast(T('draft.poolNotEnough'));
      return;
    }
    D = { deck: [], counts: {}, rolCards: {}, colors: null, types: new Set(), seen: {}, lean: {}, wave: 0, offers: [], finished: false, rerolls: 1, statLog: [] };
    buildWave();
    // medir el sobre idle ANTES de cambiar de sección (continuidad de posición),
    // incluyendo su desfase actual del FLOAT para asentarlo suave (sin jump)
    const idle = document.querySelector('#dr-pack-stage .dr-pack');
    const idleRect = idle ? idle.getBoundingClientRect() : null;
    let floatY = 0;
    if (idle) {
      const tr = getComputedStyle(idle).transform;
      if (tr && tr !== 'none') { try { floatY = new DOMMatrixReadOnly(tr).m42; } catch (e) {} }
    }
    showSection('play');
    renderDeckBar();
    if (animate) {
      _interactReady = false; // nada de hover/clicks hasta acabar la apertura +0.35s
      openPack(idleRect, floatY, () => {
        document.querySelectorAll('#dr-options .reveal-pending')
          .forEach(el => el.classList.remove('reveal-pending'));
        setTimeout(() => { _interactReady = true; }, 350);
      });
    } else {
      _interactReady = true;
      renderWave(true); // tests / sin animación: opciones ya visibles
    }
  }
  const startDraft = () => beginDraft(false); // alias para hooks de test

  // ¿Este Pokémon aporta su TIPO al mazo (y con él, todo el soporte de ese tipo)?
  // Feedback de Daniel (2026-08-15): coger un básico de relleno que ataca con
  // incoloras (Marshadow [P], Carbink [F]) hacía que empezara a salir soporte de
  // psíquico/lucha en un mazo que no usa esa energía — cartas muertas que además
  // ocupaban huecos útiles. Ahora el tipo solo cuenta si está respaldado:
  //   · primer pick (es la wincon, define el arquetipo)
  //   · el mazo usa esa energía (D.colors)
  //   · o es una pieza de arquetipo elegida a propósito (win / soporte de tipo)
  function typeCountsForDeck(u) {
    const el = u.top && u.top.element;
    if (!el || !TYPED.has(el)) return false;
    if (D.colors === null) return true;
    if (D.colors.has(el)) return true;
    return u.rol === 'win' || u.rol === 'typesupport';
  }

  /* ── ESTADÍSTICAS del draft (meta interno) ──────────────────────────────────
     Lo valioso de un draft NO es el mazo final (lo eligió el jugador entre lo que le
     ofrecimos): es la DECISIÓN. Para el «% de pickeo cuando aparece» hay que guardar
     las 5 opciones, no solo la elegida — un 20% no significa «carta mala» si siempre
     compite contra bombas; con las 5 se puede saber CONTRA QUIÉN pierde.
     Solo se envía en el draft ONLINE (draft-multi lo escribe en la sala). */
  var _STATW_CAP = 40;
  function statOffers() {
    return (D.offers || []).map(o => {
      const t = o && o.u && o.u.top;
      return { id: (t && t.id) || '', n: o.count | 0, r: (o.u && o.u.rol) || '' };
    }).filter(x => x.id);
  }
  function statPushWave(pickIdx, rerolled) {
    if (!D || !D.statLog || D.statLog.length >= _STATW_CAP) return;
    const opts = statOffers();
    if (!opts.length) return;
    D.statLog.push({
      w: D.wave | 0,
      pick: (pickIdx == null || !opts[pickIdx]) ? null : opts[pickIdx].id,   // null = oleada rerolleada
      rr: rerolled ? 1 : 0,
      opts: opts,
      // contexto del mazo EN ESE MOMENTO: sin él, un pick rate global mezcla peras y
      // manzanas (una carta puede ser top en mazos de agua e ignorada en el resto)
      dn: (D.deck || []).length,
      col: D.colors ? Array.from(D.colors) : []
    });
  }
  window._draftStatLog = function () { return (D && D.statLog) || []; };

  function applyPick(idx) {
    const offer = D.offers[idx];
    if (!offer || D.finished) return;
    statPushWave(idx, false);   // ANTES de tocar D: las 5 opciones + cuál se eligió
    offer.cards.forEach(c => {
      D.deck.push(c);
      const k = c.name.toLowerCase();
      D.counts[k] = (D.counts[k] || 0) + 1;
    });
    D.rolCards[offer.u.rol] = (D.rolCards[offer.u.rol] || 0) + offer.cards.length;
    // El primer pick (win condition) fija el arquetipo de colores
    if (D.colors === null && offer.u.kind === 'pokemon') {
      const tc = typedCosts(offer.u.top);
      if (!tc.size && TYPED.has(offer.u.top.element)) tc.add(offer.u.top.element);
      D.colors = tc; // puede ser bicolor; vacío = wincon incolora (solo splashables)
      // ¿Apto para segundo tipo? Solo si la wincon es monocolor y "ligera"
      // (1 tipada + incoloras). Lucario ex [F,F,F] cierra el mazo a su color.
      // El mazo se abre a 2º color solo si la wincon es splash-apta (≤1 tipada +
      // incolora). Wincon 100% de su tipo (Zoroark ex [oscuro]) → mono, por consistencia.
      D.dualApt = tc.size <= 1 && isSplashApt(offer.u.top);
    } else if (D.colors && D.colors.size === 0 && offer.u.color) {
      // Mazo aún sin tipo (wincon incolora): un pick CON color lo decide
      // (un perro legendario robo elegido en un mazo incoloro fija el arquetipo).
      D.colors.add(offer.u.color);
    }
    // TIPO(s) de Pokémon del mazo (para el SOPORTE DE TIPO: cartas que mencionan
    // «Pokémon de tipo X»). SOLO la carta top (atacante/wincon), NUNCA las preevos:
    // Trapinch (lucha) no convierte un mazo Flygon (dragón) en mazo de lucha.
    if (offer.u.kind === 'pokemon' && offer.u.top && typeCountsForDeck(offer.u))
      D.types.add(offer.u.top.element);
    // Motores de energía picados (Mantyke [W], Volkner [L]…): inclinan un poco el mazo
    // hacia ese tipo en las ofertas siguientes (peso, nunca gate).
    if (D.lean) {
      const _r = new Set();   // por CARTA distinta (una línea doble no cuenta el doble)
      const bump = c => {
        if (!c || !c.id || _r.has(c.id)) return;
        _r.add(c.id);
        (rampTypesFor(c) || []).forEach(t => { D.lean[t] = (D.lean[t] || 0) + 1; });
      };
      bump(offer.u.top);
      (offer.cards || []).forEach(bump);
    }
    // Packs combo (perritos…): cada socio aporta su tipo con el MISMO criterio —
    // un pack de wincon multi-tipo sí abre el soporte de cada tipo (es su gracia);
    // un combo de utilidad (Unown) no cuela el suyo en un mazo de otro color.
    if (offer.tops)
      offer.tops.forEach(t => {
        if (typeCountsForDeck({ top: t, rol: offer.u.rol })) D.types.add(t.element);
      });
    D.wave++;
    // MULTIJUGADOR: NO se auto-avanza ni se cierra solo. Se aplica el pick a MI mazo,
    // se entra en "esperando" y la coordinación (draft-multi) decide cuándo avanzar.
    if (D.mp) {
      D.awaiting = true;
      renderDeckBar();
      if (window._draftMpAfterPick) window._draftMpAfterPick(offer.cards.map(c => c.id));
      return;
    }
    if (slotsLeft() <= 0) {
      D.finished = true;
      renderDeckBar();
      window.sfx && window.sfx('draft.deckFull');
      const thisDraft = D; // si se reinicia antes de los 420ms, no pisar el draft nuevo
      setTimeout(() => { if (D === thisDraft && D.finished) renderEnd(); }, 420);
    } else {
      buildWave();
      renderDeckBar();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════
  function $(id) { return document.getElementById(id); }

  function showSection(which) {
    $('dr-start').style.display = which === 'start' ? 'flex' : 'none';
    $('dr-play').style.display = which === 'play' ? 'flex' : 'none';
    $('dr-end').style.display = which === 'end' ? 'flex' : 'none';
    // El overlay de fin/preparación del multijugador (#dr-mp-end) NO es una sección: si quedó
    // visible (p.ej. tras el hand-off a la partida) lo limpiamos al mostrar cualquier sección.
    var mpe = document.getElementById('dr-mp-end');
    if (mpe && mpe.style.display !== 'none') { mpe.style.display = 'none'; mpe.innerHTML = ''; }
  }

  // El mismo hueco de la esquina sirve al draft local y a una partida online, pero
  // sus consecuencias son distintas: local = salir de la elección; online = rendirse.
  function syncDraftExitButton() {
    const btn = $('dr-abandon-btn'); if (!btn) return;
    const online = !!(D && D.mp);
    btn.textContent = T(online ? 'pvp.surrender' : 'draft.abandon');
    btn.classList.toggle('is-surrender', online);
  }

  // Roles con etiqueta y color para el resumen en vivo
  const ROL_UI = {
    win: ['WIN', '#f7a'], lead: ['LEAD', '#fa6'], secundario: ['SEC', '#7ad'],
    utilidad: ['UTI', '#3ecf6e'], typesupport: ['TIPO', '#5dd'],
    robo: ['ROBO', '#fd5'], consistencia: ['CONS', '#aaf'], tech: ['TECH', '#c9e'],
  };

  function renderProgress() {
    $('dr-pick-count').textContent = D.deck.length + '/20';
    const pct = D.deck.length / 20;
    const fill = $('dr-progress-fill');
    fill.style.width = (pct * 100) + '%';
    // De rojo a verde según el progreso
    const hue = Math.round(pct * 130);
    fill.style.background = 'linear-gradient(90deg, hsl(' + hue + ',72%,50%), hsl(' +
      Math.min(hue + 16, 140) + ',76%,58%))';
    // Colores del arquetipo junto al contador
    const dots = $('dr-colors');
    dots.innerHTML = (D.colors && D.colors.size)
      ? [...D.colors].map(c =>
          '<span class="dr-color-dot" title="' + (window.EL_ES[c] || c) + '" style="background:' +
          (window.EL_COLORS[c] || '#888') + '"></span>').join('')
      : '';
  }

  // Flash central «Ronda N» al cambiar de ronda (gamificación, breve y limpio)
  function rondaFlash(n) {
    const old = document.querySelector('.dr-ronda-flash');
    if (old) old.remove();
    const f = document.createElement('div');
    f.className = 'dr-ronda-flash';
    f.textContent = T('draft.round', { n: n });
    $('dr-play').appendChild(f);
    window.sfx && window.sfx('draft.round');
    // entrada con SPRING (snappy, con overshoot) + sube y se desvanece al salir
    // (el brillo holográfico que cruza el texto lo pone la animación CSS)
    f.animate(
      [{ opacity: 0, transform: 'translate(-50%,-44%) scale(0.6)', filter: 'blur(7px)' },
       { opacity: 1, transform: 'translate(-50%,-50%) scale(1.07)', filter: 'blur(0)', offset: 0.3 },
       { opacity: 1, transform: 'translate(-50%,-50%) scale(1)', offset: 0.42 },
       { opacity: 1, transform: 'translate(-50%,-53%) scale(1)', offset: 0.72 },
       { opacity: 0, transform: 'translate(-50%,-62%) scale(1.04)', filter: 'blur(2px)' }],
      { duration: 760, easing: 'cubic-bezier(0.34,1.4,0.5,1)' }
    ).onfinish = () => f.remove();
  }

  function renderWave(first, hidden) {
    syncDraftExitButton();
    const wn = $('dr-wave-num');
    const label = T('draft.round', { n: D.wave + 1 });
    if (wn.textContent !== label) {
      wn.textContent = label;
      wn.animate(
        [{ opacity: 0, transform: 'translateY(-10px) scale(0.92)' },
         { opacity: 1, transform: 'translateY(0) scale(1)' }],
        { duration: 340, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    }
    renderProgress();
    const row = $('dr-options');
    row.innerHTML = '';
    clearOptionSel();   // nueva oleada → sin selección táctil pendiente
    if (window.pbCue) window.pbCue.dismiss('draftPick');   // la cue de la oleada anterior sobra
    D.offers.forEach((o, i) => {
      const el = document.createElement('div');
      el.className = 'dr-option';
      el.dataset.sub = o.sub || ''; // flag interno (ES); para re-traducir la píldora al cambiar idioma
      // El stack enseña las cartas DE LA OFERTA (una «Evolución» suelta no
      // muestra la base que ya llevas); al hover se despliega en cascada.
      // El ANCLA va siempre delante: en un combo, los socios quedan detrás
      // (si no, 8 combos con Arceus ex enseñaban 8 Arceus de portada).
      let uniq = [...new Map(o.cards.map(c => [c.id, c])).values()];
      uniq = uniq.filter(c => c.id !== o.u.top.id).concat([o.u.top]);
      // Stack a mostrar: línea/combo → cartas ÚNICAS (al hover cascadean). Doble
      // de la MISMA carta (robo doble / 2 copias iguales) → 2 copias (al hover
      // asoma la segunda). NO se muestran las 6 de una línea doble.
      const stackCards = (uniq.length === 1 && o.count > 1) ? [o.u.top, o.u.top] : uniq;
      const backs = stackCards.length > 1
        ? stackCards.slice(0, -1).map((m, j) =>
            '<img class="dr-card-img st-back b' + (stackCards.length - 1 - j) +
            '" draggable="false" src="' + window.localizeImg(m.image) + '" alt="">').join('')
        : '';
      // Dos niveles: ORO solo para las dobles (la suerte de verdad, con pulso
      // y aura); los combos normales tienen su tier CIAN propio, más calmado
      // (son diseño, no suerte, y el usuario tiene muchos).
      const special = !!(o.sub && o.sub.includes('doble'));
      const comboTier = !special && !!(o.sub && o.sub.includes('Combo'));
      if (special) el.classList.add('special-offer');
      if (comboTier) el.classList.add('combo-offer');
      if (hidden) el.classList.add('reveal-pending'); // la intro las destapa
      const tierCls = special ? ' special' : (comboTier ? ' combo' : '');
      // Píldora "premio" SOLO en casos especiales (línea/robo doble, combo,
      // evolución): icono (★ doble · 🧩 combo) + texto de sabor.
      const pillIcon = special ? '★ ' : (comboTier ? '🧩 ' : '');
      const pillHtml = o.sub
        ? '<div class="dr-pill' + tierCls + '">' + pillIcon + subText(o.sub) + '</div>' : '';
      // Abanico SIEMPRE que haya >1 carta, DEBAJO del nombre: indicador claro de
      // que la oferta trae varias (neutro; la píldora ya lleva el color de premio).
      let fanHtml = '';
      if (o.count > 1) {
        const fanN = Math.min(o.count, 6);
        const step = fanN > 4 ? 9 : 13;
        const cards2 = [];
        for (let j = 0; j < fanN; j++) {
          const a = (j - (fanN - 1) / 2) * step;
          cards2.push('<i class="dr-fan-c" style="--a:' + a.toFixed(1) + 'deg"></i>');
        }
        fanHtml = '<div class="dr-fan">' + cards2.join('') + '</div>';
      }
      // El nombre/píldora/abanico van en un PIE ABSOLUTO: así NO empujan la carta
      // delantera (su posición queda FIJA, solo depende del stack; los backs y el
      // pie son hijos que no influyen).
      el.innerHTML =
        '<div class="dr-stack n' + Math.min(stackCards.length, 4) + '">' +
        backs +
        '  <img class="dr-card-img st-top" draggable="false" src="' + window.localizeImg(o.u.top.image) + '" alt="">' +
        '</div>' +
        '<div class="dr-opt-foot">' +
        pillHtml +
        '<div class="dr-opt-name">' + (window.cardName ? window.cardName(o.u.top) : o.u.name) + '</div>' +
        fanHtml +
        '</div>';
      const stack = el.querySelector('.dr-stack');
      // ── ESCRITORIO: clic = pick directo; hover = abanico + tilt 3D (gated !drTouch) ──
      el.addEventListener('click', () => { if (!drTouch()) pickWithAnimation(i); });
      el.addEventListener('mouseenter', () => { if (drTouch() || !_interactReady) return; window.sfx && window.sfx('draft.hover'); });
      if (stack && stack.querySelector('.st-back')) {
        el.addEventListener('mouseenter', () => {
          if (drTouch() || !_interactReady) return;
          el._fanT = setTimeout(() => stack.classList.add('fanned'), 330);
        });
        el.addEventListener('mouseleave', () => {
          if (drTouch()) return;
          clearTimeout(el._fanT); stack.classList.remove('fanned');
        });
      }
      el.addEventListener('pointermove', e => {
        if (!_interactReady || drTouch()) return;
        const r = el.getBoundingClientRect();
        const dx = (e.clientX - r.left) / r.width - 0.5;
        const dy = (e.clientY - r.top) / r.height - 0.5;
        if (stack) stack.style.transform =
          'rotateY(' + (dx * 13).toFixed(2) + 'deg) rotateX(' + (-dy * 10).toFixed(2) + 'deg)';
      });
      el.addEventListener('pointerleave', () => { if (!drTouch() && stack) stack.style.transform = ''; });
      // ── MÓVIL: gestos (swipe↑ abrir · swipe↓ elegir · tap = zoom · tap trasera = adelantar) ──
      attachDraftGestures(el, i, stack);
      row.appendChild(el);
      if (!hidden && _rerollMode) {
        // SWAP del reroll: las 5 CAEN desde arriba inclinadas y se CLAVAN a la
        // vez (como cartas golpeando la mesa). Opacidad ya al 100%, freno seco,
        // sin escalonado. (#dr-options tiene perspective para el rotateX.)
        el.animate(
          [{ opacity: 1, transform: 'translateY(-18px) rotateX(34deg) scale(1.06)' },
           { opacity: 1, transform: 'translateY(0) rotateX(0deg) scale(1)' }],
          { duration: 240, easing: 'cubic-bezier(0.2,1,0.3,1)' } // más perceptible, sigue snappy
        );
      } else if (!hidden) {
        // Pop-in escalonado normal (tras el flash de ronda)
        el.animate(
          [{ opacity: 0, transform: 'translateY(26px) scale(0.92)' },
           { opacity: 1, transform: 'translateY(0) scale(1)' }],
          { duration: 320, delay: (first ? 0 : 170) + i * 55,
            easing: 'cubic-bezier(0.22,1,0.36,1)', fill: 'backwards' }
        );
      }
    });
    // Brillo de sobre SOLO cuando hay oro de verdad (una doble por suerte)
    if (!hidden && D.offers.some(o => o.sub && o.sub.includes('doble'))) {
      setTimeout(() => window.sfx && window.sfx('draft.lucky'), first ? 250 : 420);
    }
    // Tick sutil del contador
    const pc = $('dr-pick-count');
    pc.animate([{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
      { duration: 240, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    updateRerollBtn();
    // Cue «primera vez» SOLO táctil: cómo elegir en móvil (swipe↓ elegir · swipe↑ desplegar).
    // El modelo C (máx 2 veces, 1/sesión, «hecha» al hacer el gesto) lo gestiona pbCue.
    if (!hidden && drTouch() && window.pbCue && window.pbCue.eligible && window.pbCue.eligible('draftPick')) {
      setTimeout(function () {
        // El draft pudo terminar durante la espera (pick rápido de la última carta) →
        // no mostrar la cue de gesto sobre el mazo final.
        if (!D || D.finished) return;
        var opts = $('dr-options');
        var mid = opts && (opts.children[1] || opts.children[0]);
        if (mid) window.pbCue.maybe('draftPick', { anchor: mid, place: 'above' });
      }, 520);
    }
  }

  // ════════════════════════════════════════════════════════════
  //  TÁCTIL (móvil): gestos sobre las opciones + zoom-carrusel
  //  swipe↑ = abrir stack · swipe↓ = elegir · tap carta = zoom carrusel ·
  //  tap trasera (stack abierto) = adelantar. (drTouch() = pbIsTouchMobile)
  // ════════════════════════════════════════════════════════════
  function drTouch() { return !!(window.pbIsTouchMobile && window.pbIsTouchMobile()); }
  let _selIdx = null;
  let _lastTapT = 0, _lastTapEl = null;   // detección de doble-tap por opción
  let _outsideWired = false;              // handler «tocar fuera» registrado una vez

  // Pliega un stack abierto: vuelve a la principal delante y sin desplegar
  function foldStack(el, stack) {
    if (stack) { stack.classList.remove('fanned'); stack.querySelectorAll('.st-fwd').forEach(c => c.classList.remove('st-fwd')); }
    if (el) el.classList.remove('dr-fanned-opt');
  }
  // Tocar FUERA de un stack desplegado lo pliega (y deja la principal delante).
  // Se registra una sola vez a nivel documento (fase de burbuja → corre tras los
  // handlers por opción, así abrir otra opción ya cerró esta).
  function wireOutsideTap() {
    if (_outsideWired) return;
    _outsideWired = true;
    document.addEventListener('pointerup', e => {
      if (!drTouch() || e.pointerType === 'mouse') return;
      document.querySelectorAll('#dr-options .dr-fanned-opt').forEach(o => {
        if (!o.contains(e.target)) foldStack(o, o.querySelector('.dr-stack'));
      });
    });
  }

  // Abre/cierra el abanico de la línea en su sitio (swipe up)
  function openStack(el, stack) {
    if (!stack || !stack.querySelector('.st-back')) return; // carta suelta: nada que abrir
    document.querySelectorAll('#dr-options .dr-fanned-opt').forEach(o => {
      if (o === el) return;
      o.classList.remove('dr-fanned-opt');
      const s = o.querySelector('.dr-stack');
      if (s) { s.classList.remove('fanned'); s.querySelectorAll('.st-fwd').forEach(c => c.classList.remove('st-fwd')); }
    });
    const open = !stack.classList.contains('fanned');
    stack.classList.toggle('fanned', open);
    el.classList.toggle('dr-fanned-opt', open);
    if (!open) stack.querySelectorAll('.st-fwd').forEach(c => c.classList.remove('st-fwd'));
    window.sfx && window.sfx('draft.hover');
  }
  // Tap en una carta trasera (stack abierto) = adelantarla/superponerla
  function bringForward(stack, card) {
    stack.querySelectorAll('.st-fwd').forEach(c => { if (c !== card) c.classList.remove('st-fwd'); });
    card.classList.toggle('st-fwd');
  }
  // Cierra cualquier stack abierto (al cambiar de oleada / pickear)
  function closeAllStacks() {
    document.querySelectorAll('#dr-options .dr-fanned-opt').forEach(o => {
      o.classList.remove('dr-fanned-opt');
      const s = o.querySelector('.dr-stack');
      if (s) { s.classList.remove('fanned'); s.querySelectorAll('.st-fwd').forEach(c => c.classList.remove('st-fwd')); }
    });
  }

  // ── Mapa de gestos móvil ──────────────────────────────────────────────────
  //  long-press        → zoom-carrusel (menú de «Elegir»)
  //  doble-tap         → zoom-carrusel (zoom in; doble-tap dentro = zoom out)
  //  swipe ↑           → desplegar la línea (fan)
  //  swipe ↓           → elegir directo
  //  tap (línea plegada, multi)   → desplegar la línea
  //  tap (carta suelta)           → zoom-carrusel
  //  tap (línea desplegada):
  //     trasera         → adelantarla
  //     principal       → volver a poner la principal delante
  //     fuera de carta  → plegar
  //  tocar FUERA del stack → plegar (handler de documento)
  function attachDraftGestures(el, i, stack) {
    wireOutsideTap();
    let sx = 0, sy = 0, moved = false, pid = null, startCard = null, lpT = null, lpFired = false;
    const clrLp = () => { if (lpT) { clearTimeout(lpT); lpT = null; } };
    el.addEventListener('pointerdown', e => {
      if (!drTouch() || e.pointerType === 'mouse') return;
      if (!_interactReady || _picking || (D && D.finished)) return;
      sx = e.clientX; sy = e.clientY; moved = false; pid = e.pointerId; lpFired = false;
      startCard = e.target.closest && e.target.closest('.dr-card-img');
      clrLp();
      lpT = setTimeout(() => {                                    // LONG-PRESS = zoom
        lpFired = true;
        window.pbHaptic ? window.pbHaptic('light') : (navigator.vibrate && navigator.vibrate(12));
        openZoom(i);
      }, 450);
    });
    el.addEventListener('pointermove', e => {
      if (pid == null || e.pointerId !== pid) return;
      if (Math.abs(e.clientX - sx) > 8 || Math.abs(e.clientY - sy) > 8) { moved = true; clrLp(); }
    });
    el.addEventListener('pointerup', e => {
      if (pid == null || e.pointerId !== pid) return;
      pid = null; clrLp();
      if (lpFired) return;                                        // el long-press ya abrió el zoom
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dy) > 24 && Math.abs(dy) > Math.abs(dx)) {     // gesto vertical claro
        _lastTapT = 0;
        if (window.pbCue) window.pbCue.done('draftPick');        // hizo el gesto → cue aprendida, no vuelve
        if (dy < 0) openStack(el, stack);                        // swipe up = abrir línea
        else pickWithAnimation(i);                               // swipe down = elegir directo
        return;
      }
      if (moved) return;                                          // arrastre sin clasificar
      // ── TAP ──
      const now = Date.now();
      if (_lastTapEl === el && now - _lastTapT < 300) {           // DOBLE-TAP = zoom
        _lastTapT = 0; _lastTapEl = null;
        openZoom(i);
        return;
      }
      _lastTapT = now; _lastTapEl = el;
      // single-tap contextual (inmediato; el doble-tap solo AÑADE el zoom encima)
      const fanned = stack && stack.classList.contains('fanned');
      const hasBacks = stack && stack.querySelector('.st-back');
      if (fanned) {
        if (startCard && startCard.classList.contains('st-back')) {
          bringForward(stack, startCard);                        // adelantar trasera
        } else if (startCard && startCard.classList.contains('st-top')) {
          const fwd = stack.querySelectorAll('.st-fwd');
          if (fwd.length) fwd.forEach(c => c.classList.remove('st-fwd')); // principal delante
        } else {
          foldStack(el, stack);                                  // tap dentro pero no en carta = plegar
        }
      } else if (hasBacks) {
        openStack(el, stack);                                    // línea plegada → desplegar
      } else {
        openZoom(i);                                             // carta suelta → zoom
      }
    });
    el.addEventListener('pointercancel', () => { pid = null; clrLp(); });
  }

  // ── Overlay ZOOM-CARRUSEL: la carta/línea grande, deslizable con flechas;
  //    poco opaco y SOLO sobre las elecciones (el mazo sigue visible). ──
  function buildZoom() {
    let ov = $('dr-mp');
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = 'dr-mp';
    ov.innerHTML =
      '<div class="dr-mp-stage">' +
      '  <button class="dr-mp-arrow dr-mp-prev" type="button" aria-label="prev"><svg viewBox="0 0 24 24" fill="none"><path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '  <div class="dr-mp-reel"></div>' +
      '  <button class="dr-mp-arrow dr-mp-next" type="button" aria-label="next"><svg viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</div>' +
      '<div class="dr-mp-pill"></div>' +
      '<div class="dr-mp-name"></div>' +
      '<button class="dr-mp-choose" type="button"><span data-i18n="draft.choose">Elegir</span></button>' +
      '<div class="dr-mp-hint" data-i18n="draft.tapClose">Toca fuera para cerrar</div>';
    $('dr-play').appendChild(ov);
    ov.addEventListener('click', e => { if (e.target === ov) closeZoom(); });   // fondo = cerrar
    ov.querySelector('.dr-mp-prev').addEventListener('click', () => zoomGo(-1));
    ov.querySelector('.dr-mp-next').addEventListener('click', () => zoomGo(1));
    ov.querySelector('.dr-mp-choose').addEventListener('click', () => {
      const i = _selIdx; if (i == null || !D || D.finished) return;
      closeZoom(); pickWithAnimation(i);
    });
    // Swipe lateral en el reel = mover el coverflow (re-apila en la otra dirección)
    const reel = ov.querySelector('.dr-mp-reel');
    let sx = 0, drag = false;
    reel.addEventListener('pointerdown', e => { sx = e.clientX; drag = true; try { reel.setPointerCapture(e.pointerId); } catch (_) {} });
    reel.addEventListener('pointerup', e => { if (!drag) return; drag = false; const dx = e.clientX - sx; if (Math.abs(dx) > 26) zoomGo(dx < 0 ? 1 : -1); });
    reel.addEventListener('pointercancel', () => { drag = false; });
    // DOBLE-TAP (zoom out): dos toques QUIETOS en el MISMO sitio cierran el zoom
    // (no interfiere con tocar cartas distintas para navegar el coverflow).
    let zsx = 0, zsy = 0, zLastTap = 0, zPrevX = 0, zPrevY = 0;
    ov.addEventListener('pointerdown', e => { zsx = e.clientX; zsy = e.clientY; });
    ov.addEventListener('pointerup', e => {
      if (e.pointerType === 'mouse') return;
      if (Math.abs(e.clientX - zsx) > 10 || Math.abs(e.clientY - zsy) > 10) { zLastTap = 0; return; } // fue swipe
      const now = Date.now();
      if (now - zLastTap < 300 && Math.abs(e.clientX - zPrevX) < 40 && Math.abs(e.clientY - zPrevY) < 40) {
        zLastTap = 0; closeZoom(); return;
      }
      zLastTap = now; zPrevX = e.clientX; zPrevY = e.clientY;
    });
    return ov;
  }
  // Coverflow: misma idea que layoutCards del tablero — cartas absolutas,
  // translateX(d·STEP)+scale por distancia, z e opacidad por distancia; al mover
  // currentIdx se re-apilan suavemente en la otra dirección.
  function zoomLayout(animated) {
    const ov = $('dr-mp'); if (!ov || !ov._cards) return;
    const cards = ov._cards, cur = ov._cur;
    const cw = (cards[0] && cards[0].offsetWidth) || 180;
    const step = cw * 0.16;   // asomo MUY corto, como el carrusel de ver-mazo del tablero (antes 0.5)
    cards.forEach((c, i) => {
      const d = i - cur, ad = Math.abs(d);
      const scale = Math.max(0.6, 1 - ad * 0.08);   // escalado suave como el tablero (antes 0.12)
      c.style.transition = animated ? 'transform .3s cubic-bezier(.25,1,.5,1), opacity .25s ease' : 'none';
      c.style.transform = 'translateX(calc(-50% + ' + (d * step).toFixed(1) + 'px)) scale(' + scale.toFixed(3) + ')';
      c.style.zIndex = String(60 - ad);
      c.style.opacity = ad > 3 ? '0' : '1';
    });
    const cc = ov._uniq && ov._uniq[cur];
    if (cc) ov.querySelector('.dr-mp-name').textContent = window.cardName ? window.cardName(cc) : cc.name;
  }
  function zoomGo(delta) {
    const ov = $('dr-mp'); if (!ov || !ov._cards) return;
    ov._cur = Math.max(0, Math.min(ov._cards.length - 1, ov._cur + delta));
    zoomLayout(true);
  }
  function closeZoom() { _selIdx = null; const ov = $('dr-mp'); if (ov) ov.classList.remove('open'); }
  function clearOptionSel() { closeZoom(); closeAllStacks(); }   // al cambiar de oleada

  function openZoom(i) {
    if (!_interactReady || _picking || D.finished) return;
    const o = D.offers[i]; if (!o) return;
    _selIdx = i;
    const ov = buildZoom();
    // Cartas de la oferta base→evolución (igual orden que el stack)
    let uniq = [...new Map(o.cards.map(c => [c.id, c])).values()];
    uniq = uniq.filter(c => c.id !== o.u.top.id).concat([o.u.top]);
    ov._uniq = uniq;
    const reel = ov.querySelector('.dr-mp-reel');
    reel.innerHTML = uniq.map(c =>
      '<img class="dr-mp-card" draggable="false" src="' + window.localizeImg(c.image) + '" alt="">').join('');
    ov._cards = [...reel.querySelectorAll('.dr-mp-card')];
    ov._cur = uniq.length - 1;   // empezar centrado en la carta PRINCIPAL (top); las preevos asoman a la izquierda
    // tap en una carta no-central = centrarla (como el click del carrusel del tablero)
    ov._cards.forEach((c, k) => c.onclick = () => { if (k !== ov._cur) { ov._cur = k; zoomLayout(true); } });
    const multi = uniq.length > 1;
    ov.querySelector('.dr-mp-prev').hidden = !multi;
    ov.querySelector('.dr-mp-next').hidden = !multi;
    // Píldora de premio
    const pill = ov.querySelector('.dr-mp-pill');
    const special = !!(o.sub && o.sub.includes('doble'));
    const comboTier = !special && !!(o.sub && o.sub.includes('Combo'));
    if (o.sub) {
      pill.textContent = (special ? '★ ' : comboTier ? '🧩 ' : '') + subText(o.sub);
      pill.className = 'dr-mp-pill show' + (special ? ' special' : comboTier ? ' combo' : '');
    } else { pill.className = 'dr-mp-pill'; pill.textContent = ''; }
    ov.querySelector('.dr-mp-name').textContent = window.cardName ? window.cardName(o.u.top) : o.u.name;
    if (window.i18n && window.i18n.applyI18n) window.i18n.applyI18n(ov);
    // Solo tapar las elecciones, no el mazo: el bottom = alto del mazo
    const dw = $('dr-deckbar-wrap');
    ov.style.bottom = (dw ? dw.offsetHeight : 120) + 'px';
    ov.classList.add('open');
    // Medir tras mostrar: fijar alto del reel = alto de carta y colocar el coverflow
    requestAnimationFrame(() => {
      const ch = ov._cards[0] ? ov._cards[0].offsetHeight : 0;
      if (ch) reel.style.height = ch + 'px';
      zoomLayout(false);
    });
    window.sfx && window.sfx('draft.hover');
  }

  // Estallido de chispas al pickear (doradas si especial, blancas si no)
  let _picking = false;
  let _interactReady = true; // false durante la intro (+0.5s tras acabar)
  function pickWithAnimation(idx) {
    if (!_interactReady || _picking || D.finished) return;
    if (D.mp && D.awaiting) return;   // multijugador: ya elegiste esta oleada, esperando al rival
    _picking = true;
    const _offer = D.offers[idx];
    const _isSpecial = _offer && _offer.sub && _offer.sub.includes('doble');
    // pick especial = pull raro; pick de un ex = colocar rara; resto = agarre
    window.sfx && window.sfx(
      _isSpecial ? 'draft.pickRare' : (_offer && _offer.u.top.ex ? 'draft.pickEx' : 'draft.pick'));
    const row = $('dr-options');
    const options = [...row.children];
    const chosen = options[idx];
    const img = chosen.querySelector('.st-top');
    const from = img.getBoundingClientRect();
    // Las demás se desvanecen
    options.forEach((el, i) => {
      if (i === idx) return;
      el.animate(
        [{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(0.88)' }],
        { duration: 200, easing: 'ease-out', fill: 'forwards' }
      );
    });
    // HÁPTICO al pulsar: anillo de impacto limpio + press de la carta elegida
    pulseRing(from.left + from.width / 2, from.top + from.height / 2,
      _isSpecial ? 'rgba(248,206,96,0.95)' : 'rgba(255,255,255,0.9)', 36);
    const cstack = chosen.querySelector('.dr-stack');
    if (cstack) cstack.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(0.9)' }],
      { duration: 85, easing: 'cubic-bezier(0.4,0,0.6,1)', fill: 'forwards' });
    // al SOLTAR (tras el press): CADA carta de la oferta vuela INDEPENDIENTE a su
    // hueco con un mini-delay escalonado (como robar la mano inicial). En líneas
    // dobles se duplica la imagen de cada carta (ya cacheada → sin descarga extra).
    setTimeout(() => {
      const bar = $('dr-deckbar');
      const startLen = D.deck.length;
      // rect de cada carta TAL CUAL está en el stack (top + backs)
      const imgs = [...chosen.querySelectorAll('.dr-card-img')];
      const uniqRect = new Map();
      let uniq = [...new Map(_offer.cards.map(c => [c.id, c])).values()];
      uniq = uniq.filter(c => c.id !== _offer.u.top.id).concat([_offer.u.top]);
      uniq.forEach((c, k) => { if (imgs[k]) uniqRect.set(c.id, imgs[k].getBoundingClientRect()); });
      chosen.style.opacity = '0';
      const cards = _offer.cards;
      let done = 0;
      const flys = [];
      // Los flys NO se borran al terminar cada uno (eso dejaba un FLASH negro: el
      // hueco quedaba vacío hasta el render final). Se quedan clavados en su hueco
      // (fill:forwards, opacidad 1) y solo al acabar TODOS: applyPick → render
      // (los huecos reales ya tienen la imagen) → recién entonces se quitan.
      const finish = () => {
        applyPick(idx);
        // En multijugador NO se re-renderiza aquí: draft-multi renderiza la oleada
        // siguiente al coordinar el avance (la opción elegida queda atenuada mientras tanto).
        if (!D.mp && !D.finished) renderWave(false);
        flys.forEach(f => f.remove());
        _picking = false;
      };
      cards.forEach((c, j) => {
        const src = uniqRect.get(c.id) || from;
        const slot = bar.children[Math.min(startLen + j, 19)];
        const to = slot ? slot.getBoundingClientRect() : from;
        const fly = document.createElement('img');
        fly.src = window.localizeImg(c.image); fly.className = 'dr-fly'; fly.draggable = false;
        fly.style.cssText = 'position:fixed;left:' + src.left + 'px;top:' + src.top +
          'px;width:' + src.width + 'px;height:' + src.height + 'px;z-index:9999;border-radius:6px;pointer-events:none;';
        document.body.appendChild(fly);
        flys.push(fly);
        const dx = to.left + to.width / 2 - (src.left + src.width / 2);
        const dy = to.top + to.height / 2 - (src.top + src.height / 2);
        const scale = to.width / src.width;
        fly.animate(
          [{ transform: 'translate(0,0) scale(1)', opacity: 1 },
           { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(' + scale + ')', opacity: 1 }],
          { duration: 330, delay: j * 60, easing: 'cubic-bezier(0.5,0,0.3,1)', fill: 'forwards' }
        ).onfinish = () => { if (++done === cards.length) finish(); };
      });
      if (!cards.length) finish();
    }, 85);
  }

  // Preview grande al pasar por las miniaturas del mazo (consultar lo que llevas)
  // Ver la carta de un hueco del mazo (el tuyo abajo, el del rival ARRIBA) = el MISMO
  // componente que el tablero (`pbCardPeek`): lateral libre si cabe y, si no, pegada al
  // hueco POR EL LADO CON MÁS SITIO. Antes salía siempre hacia arriba y en el mazo del
  // rival se metía por encima de la ventana y no se veía.
  function showCardPreview(img, slot) {
    if (drTouch() || !window.pbCardPeek) return;   // en táctil manda el gesto (tap = zoom)
    window.pbCardPeek.showFor(slot, {
      src: 'url("' + window.localizeImg(img) + '")',
      anchor: slot,
      delay: window.pbCardPeek.hoverDelay,
    });
  }
  function hideCardPreview() {
    // con gracia: recorrer la barra de huecos no debe apagar y re-encender a cada paso
    if (window.pbCardPeek) window.pbCardPeek.hide(true);
  }

  function renderDeckBar() {
    if (D) renderProgress();
    const bar = $('dr-deckbar');
    const prev = bar.children.length ? null : 0;
    bar.innerHTML = '';
    for (let i = 0; i < 20; i++) {
      const slot = document.createElement('div');
      slot.className = 'dr-slot' + (D.deck[i] ? ' filled' : '');
      if (D.deck[i]) {
        slot.innerHTML = '<img draggable="false" src="' + window.localizeImg(D.deck[i].image) + '" alt="">';
        const img = D.deck[i].image;
        slot.addEventListener('mouseenter', () => showCardPreview(img, slot));
        slot.addEventListener('mouseleave', hideCardPreview);
      }
      bar.appendChild(slot);
    }
    // Aterrizaje HÁPTICO en el hueco: rebote (squash→overshoot) + anillo de
    // impacto del color del tipo. Sin chispas dispersas (más limpio y placentero).
    const last = bar.children[D.deck.length - 1];
    if (last && last.classList.contains('filled')) {
      const lc = D.deck[D.deck.length - 1];
      const col = (window.EL_COLORS && window.EL_COLORS[lc.element]) || '#cfd2ff';
      last.animate(
        [{ transform: 'scale(1.5)', boxShadow: '0 0 2px 1px ' + col, offset: 0 },
         { transform: 'scale(0.9)', boxShadow: '0 0 18px 6px ' + col, offset: 0.38 },
         { transform: 'scale(1.08)', boxShadow: '0 0 8px 2px ' + col, offset: 0.66 },
         { transform: 'scale(1)', boxShadow: '0 0 0 0 transparent', offset: 1 }],
        { duration: 480, easing: 'cubic-bezier(0.34,1.56,0.64,1)' }
      );
      const r = last.getBoundingClientRect();
      pulseRing(r.left + r.width / 2, r.top + r.height / 2, col, r.width * 1.15);
      window.sfx && window.sfx('draft.land'); // [potencial] sonido al asentar
    }
    updateRerollBtn();
    void prev;
  }

  // ── Celebración de mazo completo (3 efectos MODULARES) ───────────────────
  // Para quitar alguno: poner su flag en false (o borrar su línea en endCelebration).
  const END_FX = { flourish: true, holo: true, shower: true };
  function endCelebration() {
    if (END_FX.flourish) endFlourish();
    if (END_FX.holo) endHoloSweep();
    if (END_FX.shower) endShower();
  }
  // B) Flourish con punch: el título entra con spring+glow y las cartas rebotan
  function endFlourish() {
    const title = $('dr-end-title');
    if (title) title.animate(
      [{ transform: 'scale(0.82)', opacity: 0.5, filter: 'brightness(1)' },
       { transform: 'scale(1.07)', opacity: 1, filter: 'brightness(1.35)', offset: 0.5 },
       { transform: 'scale(1)', opacity: 1, filter: 'brightness(1)' }],
      { duration: 580, easing: 'cubic-bezier(0.34,1.5,0.5,1)' });
    document.querySelectorAll('#dr-end-grid .mz-dl-card').forEach((el, i) => {
      el.animate(
        [{ transform: 'scale(1)' }, { transform: 'scale(1.06)', offset: 0.4 }, { transform: 'scale(1)' }],
        { duration: 360, delay: i * 20, easing: 'cubic-bezier(0.34,1.56,0.64,1)' });
    });
  }
  // A) Destello holo: el brillo barre el mazo como UNA ola, pero recortado a la
  // superficie de CADA carta (no pilla el fondo) y traslúcido. El delay por
  // posición horizontal hace que la ola cruce de izquierda a derecha.
  function endHoloSweep() {
    const grid = $('dr-end-grid');
    if (!grid) return;
    const gr = grid.getBoundingClientRect();
    grid.querySelectorAll('.mz-dl-card').forEach(card => {
      const cr = card.getBoundingClientRect();
      const t = (cr.left + cr.width / 2 - gr.left) / Math.max(1, gr.width); // 0..1
      const shine = document.createElement('div');
      shine.className = 'dr-end-shine';
      shine.innerHTML = '<div class="dr-end-shine-band"></div>';
      card.appendChild(shine);
      shine.firstChild.animate(
        [{ transform: 'translateX(-170%) skewX(-14deg)' },
         { transform: 'translateX(170%) skewX(-14deg)' }],
        { duration: 520, delay: t * 520, easing: 'cubic-bezier(0.3,0,0.2,1)', fill: 'backwards' }
      ).onfinish = () => shine.remove();
    });
  }
  // C) Lluvia de chispas doradas sobre el mazo (visible pero limpia). Brota
  // sobre todo del borde SUPERIOR (fondo oscuro = más contraste) y cae.
  function endShower() {
    const grid = $('dr-end-grid');
    if (!grid) return;
    const r = grid.getBoundingClientRect();
    for (let k = 0; k < 12; k++) {
      const px = r.left + r.width * (0.04 + Math.random() * 0.92);
      const py = r.top + r.height * (-0.08 + Math.random() * 0.34);
      setTimeout(() => burstSparks(px, py, 6, (k % 3) ? 46 : 50, true, 38,
        { spread: 1.7, distMul: 1.4, sizeMul: 1.9 }), k * 60);
    }
  }

  // ── REROLL: volver a mezclar las 5 opciones (botón 3D minimalista) ─────────
  let _rerollBusy = false;
  const RR_UP = 'rotateX(14deg)', RR_DOWN = 'rotateX(14deg) translateY(6px)',
        RR_SPENT = 'rotateX(14deg) translateY(3px)'; // gastado = hundido PARCIAL
  function updateRerollBtn() {
    const wrap = $('dr-reroll'); if (!wrap) return;
    const show = !!(D && !D.finished);
    wrap.style.display = show ? 'flex' : 'none';
    if (!show) return;
    const btn = wrap.querySelector('.dr-rr-btn');
    // gastado = queda HUNDIDO (sin contador); con usos = arriba
    if (btn && !_rerollBusy) btn.classList.toggle('spent', (D.rerolls || 0) <= 0);
  }
  function rerollError(btn) {
    // ya está hundido parcial: MICRO-hundimiento de «atascado» (no se puede)
    btn.animate(
      [{ transform: RR_SPENT }, { transform: 'rotateX(14deg) translateY(5px)', offset: 0.4 },
       { transform: RR_SPENT }],
      { duration: 220, easing: 'cubic-bezier(0.3,0.7,0.4,1)' });
    if (navigator.vibrate) navigator.vibrate(16);
    window.sfx && window.sfx('draft.rerollBlocked');
  }
  // Destello que barre la fila de opciones (limpio; enmascara el cambio)
  function rerollShine() {
    const row = $('dr-options'); if (!row) return;
    const r = row.getBoundingClientRect();
    const sh = document.createElement('div');
    sh.style.cssText = 'position:fixed;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width +
      'px;height:' + r.height + 'px;z-index:45;pointer-events:none;overflow:hidden;';
    sh.innerHTML = '<div class="dr-rr-shine"></div>';
    document.body.appendChild(sh);
    sh.firstChild.animate(
      [{ transform: 'translateX(-45%) skewX(-12deg)' }, { transform: 'translateX(165%) skewX(-12deg)' }],
      { duration: 380, easing: 'cubic-bezier(0.3,0,0.2,1)' }).onfinish = () => sh.remove();
  }
  // Pre-descarga las imágenes de una oleada (las cartas vienen de CDN remoto): así
  // al hacer el flip del reroll las portadas ya están pintables y no se ven negras
  // un instante mientras cargan. Resuelve cuando todas cargaron (o fallaron).
  function preloadOffers(offers) {
    const urls = new Set();
    (offers || []).forEach(o => {
      if (o.u && o.u.top) urls.add(window.localizeImg(o.u.top.image));
      (o.cards || []).forEach(c => urls.add(window.localizeImg(c.image)));
    });
    return Promise.all([...urls].filter(Boolean).map(src => new Promise(res => {
      const im = new Image();
      im.onload = () => { (im.decode ? im.decode().catch(() => {}) : Promise.resolve()).then(res); };
      im.onerror = res;
      im.src = src;
    })));
  }
  // Rehace la oleada del reroll: la suerte NO triggea y ninguna de las 5 que
  // había puede repetirse (garantía pedida por Daniel).
  function rerollBuild() {
    statPushWave(null, true);   // oleada DESCARTADA: se ofreció y no se eligió nada
    _rerollBan = new Set((D.offers || []).map(o => o.u.name.toLowerCase()));
    _rerollNoLuck = true;
    try { buildWave(); } finally { _rerollNoLuck = false; _rerollBan = null; }
  }

  function wireReroll() {
    const wrap = $('dr-reroll'); if (!wrap) return;
    const btn = wrap.querySelector('.dr-rr-btn');
    if (!btn || btn._wired) return; btn._wired = true;
    btn.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (_rerollBusy || _picking || !D || D.finished || !_interactReady) return;
      if ((D.rerolls || 0) <= 0) { rerollError(btn); return; }
      _rerollBusy = true;
      btn.classList.add('pressing'); // se HUNDE (anticipación)
      window.sfx && window.sfx('draft.rerollPress');
      if (navigator.vibrate) navigator.vibrate(12);
      // prepara las nuevas opciones YA (la suerte NO triggea)
      D.rerolls--;
      rerollBuild();
      // arranca la pre-descarga YA (mientras se mantiene la pulsación): le da ventaja
      _rerollPreload = preloadOffers(D.offers);
    });
    const release = () => {
      if (!_rerollBusy) return;
      _rerollBusy = false;
      const spent = (D.rerolls || 0) <= 0;
      if (spent) {
        btn.classList.add('spent'); btn.classList.remove('pressing');
        // bote PLACENTERO: sube casi arriba y asienta en el hundido PARCIAL
        btn.animate(
          [{ transform: RR_DOWN }, { transform: 'rotateX(14deg) translateY(-1px)', offset: 0.42 },
           { transform: RR_SPENT }], { duration: 360, easing: 'cubic-bezier(0.3,1.45,0.5,1)' });
      } else {
        btn.classList.remove('pressing'); // rebote completo si quedan usos
        btn.animate([{ transform: RR_DOWN }, { transform: RR_UP + ' translateY(-3px)', offset: 0.5 },
                     { transform: RR_UP }], { duration: 320, easing: 'cubic-bezier(0.3,1.5,0.5,1)' });
      }
      const wave = wrap.querySelector('.dr-rr-wave');
      if (wave) wave.animate(
        [{ opacity: 0.8, transform: 'scale(0.3)' }, { opacity: 0, transform: 'scale(1.9)' }],
        { duration: 340, easing: 'cubic-bezier(0.2,0.7,0.3,1)' });
      window.sfx && window.sfx('draft.rerollGo');
      // SWAP cuando las imágenes nuevas ya estén pintables (evita el flash negro),
      // con un mínimo de 150ms (que se perciba el botón) y un tope de 420ms para
      // no perder agilidad si el CDN va lento.
      const doSwap = () => {
        _rerollMode = true; renderWave(false); _rerollMode = false;
        rerollShine();
      };
      const minWait = new Promise(r => setTimeout(r, 150));
      const ready = Promise.race([
        _rerollPreload || Promise.resolve(),
        new Promise(r => setTimeout(r, 420)),
      ]);
      Promise.all([minWait, ready]).then(doSwap);
    };
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('pointerleave', () => { if (_rerollBusy) release(); });
  }

  function renderEnd() {
    showSection('end');
    if (window.pbCue) window.pbCue.dismiss('draftPick');   // no dejar la cue de gesto sobre el mazo final
    // Vista del mazo = MISMO componente que Mis Mazos / detalle meta (deckLayout):
    // únicas + badge de copias unificado, zoom al clic, y en MÓVIL rejilla vertical
    // grande (formato «descargar imagen» vertical). Antes era una fila propia de
    // cartas diminutas — ahora es universal y consistente con las demás vistas de mazo.
    const grid = $('dr-end-grid');
    grid.innerHTML = '';
    // Alto disponible del marco (pantalla del mazo final menos los botones) → la vista se
    // ajusta para que TODO el mazo quepa sin scroll, como la imagen descargable vertical.
    const getAvailH = () => {
      const end = $('dr-end'); if (!end) return 0;
      const actions = $('dr-end-actions');
      const cs = getComputedStyle(end);
      const padV = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
      const gap = parseFloat(cs.rowGap || cs.gap) || 22;
      const actH = actions ? actions.offsetHeight : 90;
      return end.clientHeight - padV - gap - actH - 6;
    };
    if (window._mazosDeckLayoutFromCards) {
      grid.appendChild(window._mazosDeckLayoutFromCards(D.deck, { big: true, getAvailH }));
    } else {
      // Fallback mínimo (mazos-view siempre carga; esto es defensivo)
      D.deck.forEach(c => {
        const el = document.createElement('div');
        el.className = 'mz-dl-card';
        el.innerHTML = '<img draggable="false" src="' + window.localizeImg(c.image) + '" alt="">';
        grid.appendChild(el);
      });
    }
    // Entrada en cascada + celebración de mazo completo (sobre las cartas reales del
    // deckLayout). Sustituye al vuelo-desde-la-barra, que dependía de la fila 2×10 vieja.
    const cardEls = [...grid.querySelectorAll('.mz-dl-card')];
    requestAnimationFrame(() => {
      cardEls.forEach((el, i) => {
        el.animate(
          [{ opacity: 0, transform: 'translateY(16px) scale(0.9)' },
           { opacity: 1, transform: 'translateY(0) scale(1)' }],
          { duration: 300, delay: i * 42, easing: 'cubic-bezier(0.34,1.45,0.5,1)', fill: 'backwards' });
      });
      setTimeout(() => {
        window.sfx && window.sfx('draft.complete');
        endCelebration();
      }, Math.min(cardEls.length * 42 + 300, 900));
    });
  }

  // ── Guardar en biblioteca (mismo formato que saveDeckToLibrary) ──
  function loadLibrary() {
    try { return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || []; } catch (e) { return []; }
  }
  // Cartas del mazo drafteado en el formato limpio de la biblioteca (reusado por
  // guardar y por compartir).
  function draftDeckCards() {
    return D.deck.map(c => ({
      id: c.id || '', name: c.name || '', image: c.image || '',
      health: c.health || 0, cardType: c.cardType || '', element: c.element || '',
      stage: c.stage || '', evolvesFrom: c.evolvesFrom || '',
      expansion: window.cardSetCode ? window.cardSetCode(c) : (c.expansion || c.set || ''), number: c.number || '',
      rarity: c.rarity || '', _temp: false,
    }));
  }
  function saveDraftDeck() {
    if (!D || !D.deck.length) return;
    const defaultName = 'Draft ' + new Date().toLocaleDateString(draftLocale());
    window.pbPrompt({
      title: T('draft.saveTitle'),
      message: T('draft.saveMsg', { n: D.deck.length }),
      placeholder: defaultName,
      value: defaultName,
      okLabel: T('draft.saveBtn'),
    }).then(name => {
      if (name === null) return;
      const lib = loadLibrary();
      lib.push({
        id: Date.now(),
        name: name || defaultName,
        cards: draftDeckCards(),
        energyTypes: window.inferDeckEnergies ? window.inferDeckEnergies(D.deck) : [],
        firstCardImg: D.deck[0] ? D.deck[0].image : '',
        source: 'draft',
        savedAt: Date.now(),
      });
      try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch (e) {}
      if (window._mazosRefreshIfOpen) window._mazosRefreshIfOpen();
      window.sfx && window.sfx('draft.save');
      window.pbToast && window.pbToast(T('draft.savedToast', { name: name || defaultName }));
    });
  }

  // ── Compartir el mazo drafteado (imagen / link / texto) ──
  // Reutiliza el menú de compartir de la pestaña Mazos (mismo que ya usa el fin del
  // draft multijugador): así el draft ofrece las mismas opciones que la vista de mazo.
  function shareDraftDeck() {
    if (!D || !D.deck.length || !window._mazosShareDeck) return;
    window._mazosShareDeck({
      name: 'Draft ' + new Date().toLocaleDateString(draftLocale()),
      cards: draftDeckCards(),
      energyTypes: window.inferDeckEnergies ? window.inferDeckEnergies(D.deck) : [],
    });
  }

  // Código 2D compatible con Pocket del mazo drafteado (botón propio junto a Compartir)
  function qrDraftDeck() {
    if (!D || !D.deck.length || !window.pbDeckQR) return;
    window.pbDeckQR.show({
      name: 'Draft ' + new Date().toLocaleDateString(draftLocale()),
      cards: draftDeckCards(),
      energyTypes: window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(D.deck)) : [],
    });
  }

  function abandonDraft() {
    var mp = !!(D && D.mp);
    if (mp && window._draftMpSurrender) { window._draftMpSurrender(); return; }
    window.pbConfirm({
      title: T('draft.abandonTitle'),
      message: T('draft.abandonMsg', { n: D ? D.deck.length : 0 }),
      okLabel: T('draft.quit'), danger: true,
    }).then(ok => {
      if (!ok) return;
      window.sfx && window.sfx('draft.abandon');
      backToStart();
    });
  }

  // ════════════════════════════════════════════════════════════
  //  INIT + exports
  // ════════════════════════════════════════════════════════════
  function initDraftView() {
    window._draftInitialised = true;
    $('dr-abandon-btn').addEventListener('click', abandonDraft);
    $('dr-save-btn').addEventListener('click', saveDraftDeck);
    $('dr-end-share-btn').addEventListener('click', shareDraftDeck);
    var _qrEndBtn = $('dr-end-qr-btn');
    if (_qrEndBtn) _qrEndBtn.addEventListener('click', qrDraftDeck);
    $('dr-again-btn').addEventListener('click', backToStart);
    // El overlay zoom-carrusel táctil (móvil) se construye al vuelo (buildZoom).
    // Botón info (móvil): abre/cierra el texto descriptivo en un pop translúcido.
    // "?" de info: el pop es PERMANENTE en el DOM y se muestra por CSS en hover
    // (escritorio). En táctil no hay hover → el clic togglea la clase .open.
    const infoBtn = $('dr-info-btn');
    if (infoBtn) {
      infoBtn.addEventListener('click', e => {
        e.stopPropagation();
        const wrap = infoBtn.closest('.dr-info-wrap'); if (!wrap) return;
        wrap.classList.toggle('open');
      });
      document.addEventListener('click', e => {
        const wrap = document.querySelector('.dr-info-wrap.open');
        if (wrap && !e.target.closest('.dr-info-wrap')) wrap.classList.remove('open');
      });
    }
    const ptog = $('dr-pool-toggle');
    if (ptog) ptog.querySelectorAll('.dr-pool-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        if (poolVariant() === btn.dataset.variant) return;
        setPoolVariant(btn.dataset.variant);
        syncPoolToggle();
        refreshStartInfo();
      });
    });
    wireReroll();
    // Cambiar idioma: lo estático lo reaplica i18n.js; aquí solo lo dinámico del draft
    // (sin re-animar ni re-sonar). El sobre de inicio NO se rebaraja.
    window.addEventListener('langchange', () => {
      const startVis = $('dr-start') && $('dr-start').style.display !== 'none';
      if (startVis) {
        if (D && D.mp) {            // sobre de "listo" del multijugador
          const rh = $('dr-mp-ready-hint');
          if (rh && rh.dataset.k) rh.textContent = T(rh.dataset.k);
          return;
        }
        updatePoolInfo();
        const hint = document.querySelector('#dr-pack-stage .dr-cut-hint');
        if (hint) hint.textContent = T('draft.tapToOpen');
        return;
      }
      if ($('dr-wave-num') && D && !D.finished) {
        $('dr-wave-num').textContent = T('draft.round', { n: D.wave + 1 });
      }
      syncDraftExitButton();
      document.querySelectorAll('#dr-options .dr-option').forEach(el => {
        const sub = el.dataset.sub, pill = el.querySelector('.dr-pill');
        if (!sub || !pill) return;
        const sp = sub.includes('doble'), ct = !sp && sub.includes('Combo');
        pill.textContent = (sp ? '★ ' : ct ? '🧩 ' : '') + subText(sub);
      });
    });
    // Teclas 1-5 para pickear (solo con la pestaña Draft visible y sin escribir)
    document.addEventListener('keydown', e => {
      if (e.key < '1' || e.key > '5') return;
      const view = document.getElementById('view-draft');
      if (!view || view.style.display === 'none') return;
      if (!D || D.finished || _picking) return;
      if (window.isTypingContext && window.isTypingContext()) return;
      const i = +e.key - 1;
      if (D.offers[i]) pickWithAnimation(i);
    });
    showSection(D ? (D.finished ? 'end' : 'play') : 'start');
    if (!D) refreshStartInfo();
  }

  window._draftInit = initDraftView;
  // Al re-entrar a la pestaña sin draft en curso: sobre nuevo (color aleatorio)
  window._draftReveal = function () {
    if (!D) { backToStart(); return; }
    // Un draft MP FINALIZADO que ya se entregó a la partida (o quedó huérfano) deja el motor en pie:
    // al re-entrar la pestaña hay que volver al sobre y limpiar #dr-mp-end (showSection). Una sesión
    // VIVA (eligiendo, esperando al rival, en preparación o buscando) se PRESERVA — la delata
    // _draftMpActive() en draft-multi. Los drafts de un jugador (no D.mp) no se tocan.
    if (D.mp && D.finished && !(window._draftMpActive && window._draftMpActive())) backToStart();
  };
  // Hooks para verificación headless
  window._draftPick = function (i) { if (D && D.offers[i]) applyPick(i); if (D && !D.finished) renderWave(false); };
  window._draftStart = startDraft;
  window._draftState = function () { return D; };
  window._draftPool = function () { return _pool; };
  window._draftSetPool = function (v) { setPoolVariant(v); }; // 'full' | 'meta'
  window._draftRerollBuild = rerollBuild;   // hook de test: reroll sin animación
  window._draftLeanBonus = leanBonus;      // hook de test: inclinación por motores de energía
  window._draftSeenPenalty = seenPenalty;  // hook de test: descuento de las ya rechazadas
  window._draftRampTypes = rampTypesFor;   // hook de test: qué tipo genera una carta de ramp
  window._draftPoolVariant = function () { return poolVariant(); }; // getter para el multijugador

  // ══════════════ DRAFT ONLINE — sobre viaja desde el hub + radar (Tanda A) ══════════════
  // El sobre se muestra en el hub «Jugar»; al pulsar «Jugar online» viaja hasta su reposo
  // en la vista de draft (sonido «selecting a pack») y encima gira el radar de matchmaking
  // (mismo look que el online estándar). Al encontrar rival, draft-multi abre el sobre solo.
  window._draftPackMarkup = packMarkup;   // el hub construye el sobre con el mismo color/tema
  // Monta el MISMO bocadillo/carrusel del draft (auto-scroll + arrastre + zoom) en un reel
  // arbitrario con una lista de cartas dada. Reutilizado por el hub «Jugar» (panel «Última
  // expansión»), con las MISMAS clases (.dr-peek-track/.dr-peek-card) y CSS. Estado por-elemento
  // → no colisiona con el reel del propio draft. Idempotente (guard _peekMounted).
  window._draftPeekMount = function (reel, cards) {
    if (!reel || !cards || !cards.length) return;
    const imgHtml = cards.map(c => {
      const src = window.localizeImg ? window.localizeImg(c.image) : c.image;
      return '<div class="dr-peek-card"><img draggable="false" src="' + src + '" alt=""></div>';
    }).join('');
    reel.innerHTML = '<div class="dr-peek-track">' + imgHtml + imgHtml + '</div>';
    const track = reel.querySelector('.dr-peek-track');
    let x = 0, dragging = false, startX = 0, baseX = 0, moved = false, last = null;
    const clamp = () => { const half = track.scrollWidth / 2; if (half > 0) { while (x <= -half) x += half; while (x > 0) x -= half; } };
    const apply = () => { clamp(); track.style.transform = 'translateX(' + x + 'px)'; };
    if (reel._peekRAF) cancelAnimationFrame(reel._peekRAF);
    const frame = (t) => {
      if (!document.body.contains(track)) { reel._peekRAF = null; return; }
      if (last == null) last = t;
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      if (!dragging && reel.offsetParent !== null) x -= 13 * dt;   // 13px/s = misma velocidad que el draft
      apply();
      reel._peekRAF = requestAnimationFrame(frame);
    };
    if (!reel._peekMounted) {
      reel._peekMounted = true;
      reel.addEventListener('pointerdown', e => { dragging = true; startX = e.clientX; baseX = x; moved = false; try { reel.setPointerCapture(e.pointerId); } catch (er) {} });
      reel.addEventListener('pointermove', e => { if (!dragging) return; const dx = e.clientX - startX; if (Math.abs(dx) > 4) moved = true; x = baseX + dx; apply(); });
      const end = () => { dragging = false; };
      reel.addEventListener('pointerup', end);
      reel.addEventListener('pointercancel', end);
      reel.addEventListener('click', e => { if (moved) return; const img = e.target.closest('.dr-peek-card img'); if (img && window.openZoomFromImage) window.openZoomFromImage(img.src, img); });
    }
    reel._peekRAF = requestAnimationFrame(frame);
  };
  // Fija el color del sobre (para que el buscador use EXACTAMENTE el color del hub → sin cambio).
  window._draftSetPackColor = function (h, h2) {
    const hue = parseInt(h, 10);
    if (!isNaN(hue)) _packTheme = { hue: hue, hue2: isNaN(parseInt(h2, 10)) ? (hue + 28) % 360 : parseInt(h2, 10) };
  };

  // Pokéball + radar: copiados de pvp.js (helpers puros; las clases .pvp-* viven en jugar-view.css).
  function _drPokeball() {
    return '<svg class="pvp-pk-svg" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      '<defs><clipPath id="drpkc"><circle cx="50" cy="50" r="46"/></clipPath></defs>' +
      '<g clip-path="url(#drpkc)"><rect x="0" y="0" width="100" height="50" fill="#e2535a"/>' +
      '<rect x="0" y="50" width="100" height="50" fill="#f7f7fa"/><rect x="0" y="43" width="100" height="14" fill="#17171d"/></g>' +
      '<circle cx="50" cy="50" r="46" fill="none" stroke="#17171d" stroke-width="5"/>' +
      '<circle cx="50" cy="50" r="16" fill="#17171d"/><circle cx="50" cy="50" r="9" fill="#f7f7fa"/>' +
      '<circle cx="50" cy="50" r="9" fill="none" stroke="#17171d" stroke-width="2.5"/></svg>';
  }
  function _drRadar() {
    return '<div class="pvp-radar"><span class="pvp-ring"></span><span class="pvp-ring r2"></span>' +
      '<div class="pvp-core">' + _drPokeball() + '</div></div>';
  }

  // Vuela el sobre desde `fromRect` (su caja en el hub) hasta el reposo del draft, imitando la
  // selección de sobre de Pocket (salto adelante + crece + asienta), con el sonido del juego.
  // Clona `sourceEl` (el sobre del hub) para conservar EXACTAMENTE su color/patrón.
  window._draftPackFlyIn = function (fromRect, done, sourceEl) {
    const stage = $('dr-pack-stage');
    if (!stage || !fromRect) { if (done) done(); return; }
    // Conservar el color del sobre del hub. RECONSTRUIR con packMarkup (NO cloneNode): así el
    // emblema recibe ids de degradado FRESCOS por instancia → arregla el «sin relleno» (cloneNode
    // duplicaba los ids y el navegador dejaba las cartas del emblema sin color hasta un repintado).
    const hHub = sourceEl && parseInt(sourceEl.style.getPropertyValue('--h'), 10);
    const h2Hub = sourceEl && parseInt(sourceEl.style.getPropertyValue('--h2'), 10);
    if (!isNaN(hHub)) _packTheme = { hue: hHub, hue2: isNaN(h2Hub) ? (hHub + 28) % 360 : h2Hub };
    // Sobre de reposo (packMarkup reusa _packTheme = mismo color), oculto hasta aterrizar.
    stage.innerHTML = packMarkup();
    const rest = stage.querySelector('.dr-pack');
    const rh = rest && rest.querySelector('.dr-cut-hint'); if (rh) rh.remove();
    if (!rest) { if (done) done(); return; }
    rest.style.visibility = 'hidden';
    const r1 = rest.getBoundingClientRect();
    // Clon volador = OTRA instancia de packMarkup (ids frescos), a tamaño de reposo escalado abajo
    // al origen (transform-origin top-left → el box mapea EXACTO de fromRect a r1). En body = viewport.
    const holder = document.createElement('div');
    holder.innerHTML = packMarkup();
    const fly = holder.firstElementChild;
    const fh = fly.querySelector('.dr-cut-hint'); if (fh) fh.remove();
    fly.style.cssText = 'position:fixed;margin:0;left:' + r1.left + 'px;top:' + r1.top + 'px;width:' +
      r1.width + 'px;height:' + r1.height + 'px;z-index:9600;pointer-events:none;transform-origin:top left;';
    document.body.appendChild(fly);
    window.sfx && window.sfx('draft.selectPack');
    const s0 = fromRect.width / r1.width;
    const tx0 = fromRect.left - r1.left, ty0 = fromRect.top - r1.top;
    const a = fly.animate([
      // Arranque SUAVE: ease-in (empieza despacio, sin tirón) + «pick up» sutil → planeo hasta el reposo.
      { transform: 'translate(' + tx0.toFixed(1) + 'px,' + ty0.toFixed(1) + 'px) scale(' + s0.toFixed(3) + ')', offset: 0, easing: 'cubic-bezier(0.4,0,0.5,1)' },
      { transform: 'translate(' + (tx0 * 0.95).toFixed(1) + 'px,' + (ty0 - 9).toFixed(1) + 'px) scale(' + (s0 * 1.04).toFixed(3) + ')', offset: 0.16, easing: 'cubic-bezier(0.25,0.5,0.25,1)' },
      { transform: 'translate(0px,0px) scale(1)', offset: 1, easing: 'cubic-bezier(0.3,0,0.15,1)' }
    ], { duration: 1800, fill: 'forwards' });
    a.onfinish = () => {
      try { fly.remove(); } catch (e) {}
      rest.style.visibility = 'visible';
      rest.animate([{ transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }],
        { duration: 260, easing: 'cubic-bezier(0.34,1.3,0.5,1)' });
      if (done) done();
    };
  };

  function _draftOnlinePaintPresence() {
    const inner = document.querySelector('#dr-online-search .dr-os-inner');
    if (!inner || !window.pbPresencePill) return;
    const html = window.pbPresencePill('dr');
    const pill = inner.querySelector('.pb-onpill');
    if (!html) { if (pill) pill.remove(); return; }
    if (pill) { pill.outerHTML = html; return; }
    const sub = inner.querySelector('.dr-os-sub');
    if (sub) sub.insertAdjacentHTML('afterend', html);
  }

  // Radar de «buscando rival» sobre el sobre asentado (el chrome del start se oculta).
  window._draftOnlineSearchShow = function (onCancel) {
    window._draftOnlineSearchHide();
    const vd = $('view-draft'); if (!vd) return;
    const st = $('dr-start'); if (st) st.classList.add('dr-online-wait');
    const bg = $('dr-bg'); if (bg) bg.style.display = 'none';   // solo el acelerón (evita doble campo de pokéballs)
    const ov = document.createElement('div');
    ov.id = 'dr-online-search';
    ov.innerHTML = '<span class="pvp-pokeballs"></span>' +   // warp de aceleración (como el estándar)
      '<div class="dr-os-inner">' + _drRadar() +
      '<div class="dr-os-title">Buscando rival…</div>' +
      '<div class="dr-os-sub">Modo Elección · en tiempo real</div>' +
      (window.pbPresencePill ? window.pbPresencePill('dr') : '') +
      '<button id="dr-os-cancel" class="pb-cancelbtn" type="button">Cancelar</button></div>';
    vd.appendChild(ov);
    const cx = ov.querySelector('#dr-os-cancel');
    if (cx) cx.addEventListener('click', () => { if (onCancel) onCancel(); });
    // Asentamiento sutil del sobre (entra desde un pelín arriba) → sensación de «baja a su sitio»
    // dentro del fundido, sin un vuelo que revele el sobre entero. No choca con el float (va en el contenedor).
    const st2 = $('dr-pack-stage');
    if (st2 && !document.documentElement.classList.contains('pb-reduce-motion'))
      st2.animate([{ transform: 'translateY(-64px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
        { duration: 520, easing: 'cubic-bezier(0.3,0.85,0.3,1)' });
  };
  window._draftOnlineSearchHide = function () {
    const ov = $('dr-online-search'); if (ov) ov.remove();
    const st = $('dr-start'); if (st) st.classList.remove('dr-online-wait');
    const bg = $('dr-bg'); if (bg) bg.style.display = '';   // restaurar el fondo propio del draft
  };
  window.addEventListener('pb-presence', _draftOnlinePaintPresence);

  // ════════════════════════════════════════════════════════════
  //  HOOKS MULTIJUGADOR (draft-multi.js conduce la coordinación)
  //  El draft de un jugador queda intacto: todo va guardado por D.mp.
  // ════════════════════════════════════════════════════════════
  window._draftMpBegin = function (variant) {       // arranca un draft en modo MP (sin sobre; tests)
    if (variant) setPoolVariant(variant);
    _pool = buildPool();
    if (poolProblems(_pool)) return false;
    D = { deck: [], counts: {}, rolCards: {}, colors: null, types: new Set(), seen: {}, lean: {},
          wave: 0, offers: [], finished: false, rerolls: 1, mp: true, awaiting: false };
    buildWave();
    showSection('play');
    renderDeckBar();
    _interactReady = true;
    renderWave(true);
    return true;
  };

  // ── MULTIJUGADOR: el SOBRE como botón de "listo" (antes de las rondas) ──
  // _draftMpPrepare prepara el motor (ofertas listas) pero NO renderiza la oleada:
  // muestra el sobre. Al abrirlo (clic / auto), _draftMpOpenPack hace la apertura
  // real y revela la oleada 1. La coordinación (draft-multi) decide cuándo abrir.
  let _mpReadyOnOpen = null;
  function showMpReadyPack(onReady) {
    _mpReadyOnOpen = onReady || null;
    showSection('start');
    const st = $('dr-start'); if (st) st.classList.add('mp-ready');
    let hint = $('dr-mp-ready-hint');
    if (!hint) {
      hint = document.createElement('div'); hint.id = 'dr-mp-ready-hint';
      const txt = $('dr-start-text'); (txt || st || document.body).appendChild(hint);
    }
    hint.dataset.k = 'draft.mpReadyHint'; hint.textContent = T('draft.mpReadyHint');
    if (!_packTheme) randomPackTheme();   // color estable (no re-randomizar en cada muestra del sobre)
    const stage = $('dr-pack-stage');
    if (stage) {
      stage.innerHTML = packMarkup();
      const pack = stage.querySelector('.dr-pack');
      if (pack) pack.addEventListener('click', () => {
        window._pbUnlockAudio && window._pbUnlockAudio();   // gesto → desbloquea el audio del invitado
        const cb = _mpReadyOnOpen; _mpReadyOnOpen = null;
        if (cb) cb();
      }, { once: true });
    }
  }
  function _exitMpReady() {
    const st = $('dr-start'); if (st) st.classList.remove('mp-ready');
    const hint = $('dr-mp-ready-hint'); if (hint) hint.remove();
    _mpReadyOnOpen = null;
  }
  window._draftMpPrepare = function (variant, onReady) {
    if (variant) setPoolVariant(variant);
    _pool = buildPool();
    if (poolProblems(_pool)) return false;
    D = { deck: [], counts: {}, rolCards: {}, colors: null, types: new Set(), seen: {}, lean: {},
          wave: 0, offers: [], finished: false, rerolls: 1, mp: true, awaiting: false };
    buildWave();
    showMpReadyPack(onReady);
    return true;
  };
  window._draftMpReadyHint = function (key) {
    const hint = $('dr-mp-ready-hint'); if (hint) { hint.dataset.k = key; hint.textContent = T(key); }
  };
  // Abre el sobre (animación real) y revela la oleada 1; done() al terminar.
  window._draftMpOpenPack = function (done) {
    _exitMpReady();
    if (!D || !D.mp) { if (done) done(); return; }
    const idle = document.querySelector('#dr-pack-stage .dr-pack');
    const idleRect = idle ? idle.getBoundingClientRect() : null;
    let floatY = 0;
    if (idle) { const tr = getComputedStyle(idle).transform; if (tr && tr !== 'none') { try { floatY = new DOMMatrixReadOnly(tr).m42; } catch (e) {} } }
    showSection('play');
    renderDeckBar();
    if (idleRect) {
      _interactReady = false;
      openPack(idleRect, floatY, () => {
        document.querySelectorAll('#dr-options .reveal-pending').forEach(el => el.classList.remove('reveal-pending'));
        setTimeout(() => { _interactReady = true; }, 350);
        if (done) done();
      });
    } else {
      _interactReady = true; renderWave(true); if (done) done();
    }
  };
  // ── ONLINE (cola): abrir EL MISMO sobre que asomaba bajo el radar, tal cual ──
  // No hay «sobre de listo» ni reconstrucción. Al encontrar rival: (1) se funde el
  // radar; (2) el sobre —que durante la búsqueda ASOMA bajo el radar (margin-bottom
  // -250px)— se ELEVA suavemente hasta su posición de apertura del draft; (3) ESE
  // mismo sobre se abre (openPack) EN ESA posición → sin salto (el sobre subía más
  // abajo en matchmaking que donde abría el draft; ahora coinciden por la elevación).
  window._draftMpOpenFromSearch = function (variant, done) {
    if (variant) setPoolVariant(variant);
    _pool = buildPool();
    if (poolProblems(_pool)) { if (done) done(); return false; }
    D = { deck: [], counts: {}, rolCards: {}, colors: null, types: new Set(), seen: {}, lean: {},
          wave: 0, offers: [], finished: false, rerolls: 1, mp: true, awaiting: false };
    buildWave();

    const st = $('dr-start');
    const stage = $('dr-pack-stage');
    const pack = stage && stage.querySelector('.dr-pack');
    const reduce = document.documentElement.classList.contains('pb-reduce-motion');

    // Delta de elevación: cuánto sube el sobre al pasar de «asomando» (con la clase
    // .dr-online-wait) a su posición de apertura (sin la clase). Se mide toggleando la
    // clase con getBoundingClientRect (fuerza layout, NO paint) → sin parpadeo.
    let riseDy = 0;
    if (pack && st && st.classList.contains('dr-online-wait') && !reduce) {
      const r0 = pack.getBoundingClientRect();
      st.classList.remove('dr-online-wait');
      const r1 = pack.getBoundingClientRect();
      st.classList.add('dr-online-wait');
      riseDy = r1.top - r0.top;   // negativo (sube)
    }

    const go = () => {
      // La clase ya no hace falta (openPack pasa a 'play' y oculta #dr-start entero);
      // se quita AQUÍ, sincronía con la medición de openPack → el sobre-overlay nace en
      // la posición de apertura, justo donde acabó la elevación (sin salto).
      if (st) st.classList.remove('dr-online-wait');
      if (stage) stage.style.transform = '';
      const bg = $('dr-bg'); if (bg) bg.style.display = '';
      window._draftMpOpenPack(done);
    };

    // (1) fundir el radar (el sobre queda a la vista mientras sube)
    const ov = $('dr-online-search');
    if (ov) {
      ov.style.pointerEvents = 'none';
      if (reduce) { try { ov.remove(); } catch (e) {} }
      else ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-out', fill: 'forwards' })
             .onfinish = () => { try { ov.remove(); } catch (e) {} };
    }

    // (2) elevar el sobre a su posición de apertura y ENTONCES (3) abrirlo ahí
    if (stage && riseDy && !reduce) {
      const a = stage.animate(
        [{ transform: 'translateY(0)' }, { transform: 'translateY(' + riseDy.toFixed(1) + 'px)' }],
        { duration: 480, easing: 'cubic-bezier(0.34,1.02,0.4,1)', fill: 'forwards' });
      a.onfinish = () => { try { a.cancel(); } catch (e) {} go(); };
    } else {
      go();
    }
    return true;
  };
  window._draftMpAdvance = function () {             // construye y muestra la oleada siguiente
    if (!D || !D.mp) return;
    D.awaiting = false;
    if (slotsLeft() <= 0) { if (!D.finished) { D.finished = true; renderDeckBar(); } return; }
    buildWave();
    renderDeckBar();
    _interactReady = true;
    renderWave(false);
    window.sfx && window.sfx('draft.round');   // sonido de revelar la nueva ronda (se había dejado de llamar)
  };
  window._draftMpAutoPick = function () {            // autoelección al agotarse el tiempo
    if (!D || !D.mp || D.awaiting || D.finished || !D.offers.length) return;
    pickWithAnimation(Math.floor(Math.random() * D.offers.length));
  };
  // Autoelección SÍNCRONA (sin animación): al ocultar/bloquear la página, para que el
  // pick se aplique YA (la animación WAAPI no termina si la pestaña se congela).
  window._draftMpAutoPickNow = function () {
    if (!D || !D.mp || D.awaiting || D.finished || !D.offers.length) return;
    applyPick(Math.floor(Math.random() * D.offers.length));
  };
  window._draftMpDone = function () { return !!(D && D.deck.length >= 20); };
  window._draftMpAwaiting = function () { return !!(D && D.awaiting); };
  window._draftMpFinished = function () { return !!(D && D.finished); };
  window._draftMpDeckIds = function () { return D ? D.deck.map(c => c.id) : []; };
  window._draftMpWave = function () { return D ? D.wave : 0; };
  // Reconexión a media partida: el cliente persiste SU estado (draft-multi lo guarda
  // en localStorage); la sala solo coordina. Snapshot serializable / restauración.
  window._draftMpSnapshot = function () {
    if (!D || !D.mp) return null;
    return { deck: D.deck.map(c => c.id), counts: D.counts, rolCards: D.rolCards,
             colors: D.colors ? [...D.colors] : null, types: [...D.types],
             wave: D.wave, finished: D.finished, awaiting: D.awaiting, dualApt: D.dualApt,
             seen: D.seen || {},
             lean: D.lean || {},
             statLog: D.statLog || [],   // ESTADÍSTICAS: recargar a mitad no puede borrar las oleadas ya decididas
             rerolls: D.rerolls, variant: poolVariant() };
  };
  window._draftMpReset = function () { _exitMpReady(); D = null; showSection('start'); refreshStartInfo(); };
  window._draftCardPreview = showCardPreview;       // hover-preview reusable (mazo del rival)
  window._draftHideCardPreview = hideCardPreview;
  window._draftSaveDeck = saveDraftDeck;   // guardar MI mazo drafteado (usa D.deck) — fin del MP
  // Guardar una lista de cartas como mazo (sin prompt) — fin del MP: guardar cada mazo / ambos.
  window._draftSaveCards = function (cards, name) {
    if (!cards || !cards.length) return false;
    var def = name || ('Draft ' + new Date().toLocaleDateString(draftLocale()));
    var lib = loadLibrary();
    lib.push({
      id: Date.now() + Math.floor(Math.random() * 100000),
      name: def,
      cards: cards.map(function (c) {
        return { id: c.id || '', name: c.name || '', image: c.image || '', health: c.health || 0,
          cardType: c.cardType || '', element: c.element || '', stage: c.stage || '',
          evolvesFrom: c.evolvesFrom || '', expansion: window.cardSetCode ? window.cardSetCode(c) : (c.expansion || c.set || ''),
          number: c.number || '', rarity: c.rarity || '', _temp: false };
      }),
      energyTypes: window.inferDeckEnergies ? window.inferDeckEnergies(cards) : [],
      firstCardImg: cards[0] ? cards[0].image : '',
      source: 'draft',
      savedAt: Date.now(),
    });
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch (e) {}
    if (window._mazosRefreshIfOpen) window._mazosRefreshIfOpen();
    window.sfx && window.sfx('draft.save');
    return true;
  };
  window._draftMpRestore = function (snap) {
    if (!snap) return false;
    if (snap.variant) setPoolVariant(snap.variant);
    _pool = buildPool();
    const byId = new Map((window.CARDS_DB || []).map(c => [c.id, c]));
    D = { deck: (snap.deck || []).map(id => byId.get(id)).filter(Boolean),
          counts: snap.counts || {}, rolCards: snap.rolCards || {},
          colors: snap.colors ? new Set(snap.colors) : null, types: new Set(snap.types || []),
          seen: snap.seen || {},
          lean: snap.lean || {},
          wave: snap.wave || 0, offers: [], finished: !!snap.finished, awaiting: !!snap.awaiting,
          statLog: snap.statLog || [],
          dualApt: snap.dualApt, rerolls: (snap.rerolls != null ? snap.rerolls : 1), mp: true };
    showSection('play');
    renderDeckBar();
    if (!D.finished && !D.awaiting) { buildWave(); _interactReady = true; renderWave(true); }
    return true;
  };
  window._draftRenderEnd = function () { if (D) renderEnd(); }; // test: pantalla de mazo completo
})();
