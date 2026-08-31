/* ══════════════════════════════════════════════════════════════
   DRAFT CONFIG  (data/draft.config.js)
   Configuración del modo Draft: tabla de oleadas (probabilidad POR
   SLOT — cada uno de los 5 slots tira su propio dado), pesos
   condicionales y categorización de cartas.

   `cards` se rellenará desde el panel admin (tanda B). Mientras esté
   vacío, draft-view.js categoriza el pool con heurísticas
   provisionales para poder probar la experiencia completa.

   Roles pokémon: win | lead | secundario | utilidad (tech splashable,
   cualquier color) | typesupport (tech ligado a su color: Baxcalibur,
   Flutter Mane ex…). Roles trainer: robo | consistencia | tech.
   Bundle: 'linea' (2-2-2 ó 2-2 según fase) | 2 | 1
══════════════════════════════════════════════════════════════ */
window.DRAFT_CONFIG = {
  v: 1,

  // Variante «Pool meta» del draft: nº de arquetipos del meta (ordenados por
  // cuota de juego, window.META_DECKS) cuyas cartas se conservan en el pool.
  // El filtro es POR IDENTIDAD de carta (nombre + ataques): de Absol/Darkrai
  // con varias cartas distintas, solo deja las que el meta realmente juega.
  metaTopArchetypes: 120,

  // Oleadas con guion (1-6). A partir de ahí se usa `filler` hasta 20.
  // Cada slot de la oleada elige categoría según estos pesos.
  // Filosofía de Daniel: leads protagonistas al principio (tu apertura de
  // partida); los secundarios son relleno por naturaleza → peso bajo.
  waves: [
    { slots: { win: 1 } },                                                              // 1 · win condition
    { slots: { lead: 0.50, utilidad: 0.30, secundario: 0.10, win: 0.10 } },             // 2 · tu inicio de partida
    { slots: { robo: 1 }, roboLucky: true },                                            // 3 · robo: ×1, con suerte ×2 (≈1 opción doble)
    { slots: { tech: 0.50, typesupport: 0.15, utilidad: 0.15, secundario: 0.15, win: 0.05 } }, // 4 · mixta
    { slots: { robo: 0.70, consistencia: 0.30 } },                                      // 5 · robo + consistencia
    { slots: { tech: 1 }, maxNicho: 1 },                                                // 6 · tech/soporte
  ],

  // Oleadas extra hasta cerrar el mazo. 'pokemon' se sub-reparte según
  // fillerPokemon; 'basicos' = básicos sueltos.
  filler: { consistencia: 0.30, tech: 0.25, pokemon: 0.25, robo: 0.10, basicos: 0.10 },
  fillerPokemon: { secundario: 0.30, lead: 0.25, typesupport: 0.20, utilidad: 0.20, win: 0.05 },

  // Pesos condicionales (multiplicadores suaves, nunca reglas duras)
  // Filosofía de bundles (Daniel 2026-06-11): casi todo a UNA copia (1-1 /
  // 1-1-1 en líneas) para drafts más largos y combinaciones más locas; el
  // bundle doble es un golpe de suerte reservado a wincons evolutivas.
  weights: {
    doubleLineChance: 0.2, // prob. de que una línea WINCON salga doble (2-2 / 2-2-2)
    // (la oferta de «Evolución» suelta ya no es aleatoria: sale solo cuando la
    // línea completa no cabe — p.ej. la base ya está a 2 copias)
    dualTypeWeight: 0.5,   // peso de un candidato de SEGUNDO tipo (mazos doble energía)
    speculativeWeight: 0.12, // peso de un SOPORTE de arquetipo (tipo/mega) cuya condición aún NO se cumple:
                             // sale raro, como pick especulativo para construir hacia ese arquetipo más tarde
    winSaturatedAt: 8,     // si las wincons ya ocupan ≥8 slots del mazo, los soportes de Mega NO se ofrecen
    roboLuckyChance: 0.35, // en la 1ª oleada de robo, prob. POR OPCIÓN de salir ×2 (capado a 1/ronda → ≈1 doble)
    roboSoftCapAt: 4,      // con ≥4 cartas de robo en el mazo…
    roboSoftCapMult: 0.4,  // …el peso de robo se multiplica por esto (el resto va a consistencia)
    leadSoftCapAt: 2,      // con ≥2 cartas lead en el mazo…
    leadSoftCapMult: 0.4,  // …su peso baja y el resto va a WIN (segunda amenaza, más combos)
    colorlessWeight: 0.55, // penalti a pokémon incoloros (entran en todo y saturaban el pool)
    offColorWeight: 0.4,   // penalti a un pokémon de OTRO tipo que sí puede atacar con incoloras
                           // (Marshadow [P] en mazo de fuego): entra, pero raro — no aporta arquetipo
    rampLeanWeight: 1.5,   // por cada motor de energía de un tipo en el mazo (Mantyke [W]), los
    rampLeanCap: 2.2,      // pokémon de ESE tipo pesan ×1.5 (tope ×2.2): inclinación, no garantía
    seenDecay: 0.6,        // cada vez que una carta se ofrece y NO se elige, su peso ×0.6…
    seenFloor: 0.25,       // …con este suelo (sigue siendo una opción posible, solo menos repetitiva)
    requiereWeight: 0.35,  // peso de un condicional de carta NOMBRADA cuando se cumple (Blaine…)
    // los trainers de CLASE (Lusamine, Sada, Turo…) llevan su propio
    // requierePeso alto en draft.cards.js: son el pegamento de su arquetipo
    rareCandyBase: 0.5,    // peso de Rare Candy sin Fase 2 en el mazo
    rareCandyFase2: 3,     // … con línea de Fase 2
    rareCandyOneof: 6,     // … con Fase 2 a 1 copia (lo normal ahora)
    basicsLowBoost: 4,     // boost a básicos sueltos en relleno si el mazo tiene <4 básicos
    basicsLowAt: 4,
    basicsSoftMax: 10,     // a partir de 10 básicos, peso ~0 para básicos sueltos
  },

  // id → { rol, bundle, subtipo?, splash?, oneofViable?, color?, requiere?,
  //        requierePeso?, linea?, combo?, comboChance? }  (lo rellena el admin)
  cards: {},
};
