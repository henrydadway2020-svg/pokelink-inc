/* ══════════════════════════════════════════════
   TIERLIST VIEW  (js/tierlist-view.js)
   Pestaña Tierlist — TANDA 1 (esqueleto visual).
   - Filas S/A/B/C/D/F con color atado a la POSICIÓN.
   - Añadir / quitar filas (máx 10, mín 1). Renombrar y drag&drop = tanda 3.
   - Fila "Clasifica esto:" con pills (inertes en tanda 1; se cablean en tanda 2).
   - Sub-pestañas Búsqueda / Pool / Mis tierlists (cambio de panel; contenido en tandas 2-4).
   Depende de: window.t (i18n), switchAppTab.
══════════════════════════════════════════════ */
(function () {
  'use strict';

  const T = (k, v) => (window.t ? window.t(k, v) : k);

  // Colores de tier atados a la POSICIÓN (no recolorables → exports universales).
  // Rampa clásica S→F, desaturada (se sirven como cristal tintado) hasta 10 filas.
  const TIER_COLORS = [
    '#d65f5f', '#d68440', '#d4ab35', '#5fb06e', '#4f93d6',
    '#9583d8', '#cf6f97', '#45a3b3', '#86b83a', '#9097a0',
  ];
  const DEFAULT_LABELS = ['S', 'A', 'B', 'C', 'D', 'F', 'E', 'G', 'H', 'I'];
  const MAX_ROWS = 10;

  // Pills de pools predefinidos (atajos = queries de filtro). Inertes en tanda 1.
  const PILLS = [
    { id: 'metaDecks', key: 'tierlist.preset.metaDecks', icon: 'trophy' },
    { id: 'ex',        key: 'tierlist.preset.ex' },
    { id: 'megaEx',    key: 'tierlist.preset.megaEx' },
    { id: 'fullArt',   key: 'tierlist.preset.fullArt', stars: 2 },
    { id: 'latest',    key: 'tierlist.preset.latest' },
    { id: 'crown',     key: 'tierlist.preset.crown', icon: 'crown' },
    { id: 'immersive', key: 'tierlist.preset.immersive', stars: 3 },
  ];

  // ── Meta-mazos (sugerencia «Mejores mazos actualizados») ────────
  // Los ítems de mazo viven en el pool/tiers como ids 'deck:<deckId>' (junto a los
  // ids de carta). Top 50 de window.META_DECKS (ya vienen ordenados por meta share).
  const META_TOP = 50;
  let _deckMap = null;
  function metaDeckList() {
    const md = window.META_DECKS && window.META_DECKS.decks;
    return Array.isArray(md) ? md.filter(d => d && d.id && (d.protagonists || d.cards)) : [];
  }
  function metaDeckItems() { return metaDeckList().slice(0, META_TOP).map(d => 'deck:' + d.id); }
  function isDeckItem(id) { return typeof id === 'string' && id.indexOf('deck:') === 0; }
  function deckById(deckId) {
    if (!_deckMap) { _deckMap = {}; metaDeckList().forEach(d => { _deckMap[d.id] = d; }); }
    return _deckMap[deckId] || null;
  }

  // `deck.icons` (nombres-slug de los protagonistas) es la FUENTE de verdad: su nº
  // dice cuántos protagonistas tiene el arquetipo (1 = MONO → carta completa; 2 = 50/50).
  // A veces `deck.protagonists` (ids resueltos) viene incompleto → resolvemos cada icon
  // casándolo por NOMBRE contra las cartas del propio mazo (token-set, sin orden).
  function tokenSet(s) {
    return new Set(String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && w !== 'ex'));
  }
  function setEq(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }
  function resolveIcon(icon, deck) {
    const want = tokenSet(icon);
    for (const id of (deck.protagonists || [])) { const c = lookupCard(id); if (c && setEq(tokenSet(c.name), want)) return id; }
    for (const e of (deck.cards || [])) {
      const c = lookupCard(e.id); if (!c) continue;
      const isPk = window.isPokemonCard ? window.isPokemonCard(c) : c.cardType === 'pokemon';
      if (isPk && setEq(tokenSet(c.name), want)) return e.id;
    }
    return null;
  }
  // Devuelve 1 id (mono) o 2 (dual). Con 2 iconos pero uno sin resolver, completa con el
  // primer Pokémon del mazo de OTRA línea evolutiva (no preevo del ya elegido, no entrenador).
  function deckProtIds(deck) {
    const icons = deck.icons || [];
    const want = Math.min(2, icons.length || (deck.protagonists || []).length || 1);
    const ids = [], roots = new Set();
    const add = id => { const c = lookupCard(id); if (!c || ids.includes(id)) return; ids.push(id); roots.add(lineRootOf(c)); };
    icons.forEach(ic => { if (ids.length >= 2) return; const id = resolveIcon(ic, deck); if (id) add(id); });
    (deck.protagonists || []).forEach(id => { if (ids.length < want) add(id); });
    if (ids.length < want) {
      for (const e of (deck.cards || [])) {
        if (ids.length >= want) break;
        const c = lookupCard(e.id); if (!c) continue;
        const isPk = window.isPokemonCard ? window.isPokemonCard(c) : c.cardType === 'pokemon';
        if (!isPk || roots.has(lineRootOf(c))) continue;
        add(e.id);
      }
    }
    return ids.slice(0, 2);
  }
  // Portada del arquetipo: 1 protagonista (MONO) = carta COMPLETA sin dividir;
  // 2 = 50/50 horizontal (mitad superior de cada carta).
  function deckCover50(deck) {
    const wrap = document.createElement('div');
    wrap.className = 'tl-deck-cover';
    const ids = deckProtIds(deck);
    const art = id => { const c = id && (window.dbLookup ? window.dbLookup({ id: id }) : null); return c ? (window.cardImage ? window.cardImage(c) : c.image) : ''; };
    if (ids.length <= 1) {
      wrap.classList.add('tl-deck-mono');
      const full = document.createElement('div');
      full.className = 'tl-deck-full';
      const a = art(ids[0]); if (a) full.style.backgroundImage = 'url(' + a + ')';
      wrap.appendChild(full);
      return wrap;
    }
    ids.forEach(cid => {
      const half = document.createElement('div');
      half.className = 'tl-deck-half';
      const a = art(cid); if (a) half.style.backgroundImage = 'url(' + a + ')';
      wrap.appendChild(half);
    });
    return wrap;
  }
  // Visual de un ítem del pool/tier: <img> para cartas, portada 50/50 para mazos.
  function itemVisual(id) {
    if (isDeckItem(id)) { const d = deckById(id.slice(5)); return d ? deckCover50(d) : null; }
    const card = window.dbLookup ? window.dbLookup({ id: id }) : null;
    if (!card) return null;
    const img = document.createElement('img');
    img.src = window.cardImage ? window.cardImage(card) : card.image;
    img.alt = ''; img.draggable = false; img.loading = 'lazy';
    return img;
  }

  // Orden canónico de un mazo (copiado de mazos-view.js sortDeckCards):
  // Pokémon (por tipo de la línea → línea junta → fase MÁS ALTA primero) · Partidario · Objeto · Herramienta · Estadio
  const DECK_EL_ORDER = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'dragon', 'colorless'];
  const DECK_CT_ORDER = { pokemon: 0, supporter: 1, item: 2, fossil: 2, tool: 3, stadium: 4 };
  const stageRankOf = c => { const s = c && c.stage; return s === 2 ? 2 : (s === 1 ? 1 : 0); };
  let _nameIdx = null;
  function nameIdx() {
    if (!_nameIdx) { _nameIdx = {}; (window.CARDS_DB || []).forEach(c => { if (c && c.name && !_nameIdx[c.name]) _nameIdx[c.name] = c; }); }
    return _nameIdx;
  }
  function lineRootOf(card) {
    const idx = nameIdx();
    let cur = card, guard = 0;
    while (cur && cur.evolvesFrom && guard++ < 6) { const pre = idx[cur.evolvesFrom]; if (!pre) break; cur = pre; }
    return cur ? cur.name : (card ? card.name : '');
  }
  function sortDeckEntries(entries) {
    const info = (entries || []).map(e => {
      const card = (window.dbLookup ? window.dbLookup({ id: e.id }) : null) || {};
      const isPk = window.isPokemonCard ? window.isPokemonCard(card) : card.cardType === 'pokemon';
      return { e, card, isPk, root: isPk ? lineRootOf(card) : null };
    });
    const lineEl = {};
    info.forEach(it => { if (!it.isPk) return; const st = stageRankOf(it.card), cur = lineEl[it.root]; if (!cur || st > cur.st) lineEl[it.root] = { st, el: it.card.element || 'colorless' }; });
    const elRank = el => { const i = DECK_EL_ORDER.indexOf(el); return i < 0 ? 99 : i; };
    const key = it => {
      const ct = DECK_CT_ORDER[it.card.cardType] != null ? DECK_CT_ORDER[it.card.cardType] : 8;
      if (it.isPk) { const le = lineEl[it.root] ? lineEl[it.root].el : 'colorless'; return [0, elRank(le), it.root || '', -stageRankOf(it.card), it.card.name || '']; }
      return [ct, 0, '', 0, it.card.name || ''];
    };
    return info.map(it => ({ it, k: key(it) }))
      .sort((a, b) => { for (let i = 0; i < a.k.length; i++) { if (a.k[i] < b.k[i]) return -1; if (a.k[i] > b.k[i]) return 1; } return 0; })
      .map(x => x.it.e);
  }

  // ── Ver el mazo completo — MISMA vista que «Mis mazos» (deckLayout de mazos-view:
  //    distribución en dos líneas + badge ×N idéntico) con pestañitas de las TOP 3 variantes.
  function openDeckView(itemId) {
    const deck = deckById(itemId.slice(5));
    if (!deck) return;
    const variants = (deck.variants && deck.variants.length)
      ? deck.variants.slice(0, 3)
      : [{ cards: deck.cards || [], share: deck.share, winrate: deck.winrate, games: deck.games }];
    let active = 0;
    let modal = document.getElementById('tl-deck-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'tl-deck-modal';
      modal.addEventListener('pointerdown', e => { if (e.target === modal) closeDeckView(); });
      document.body.appendChild(modal);
    }
    modal.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'tl-deck-panel';
    const head = document.createElement('div');
    head.className = 'tl-deck-modal-head';
    const title = document.createElement('div'); title.className = 'tl-deck-modal-title'; title.textContent = deck.name || '';
    const sub = document.createElement('div'); sub.className = 'tl-deck-modal-sub';
    head.appendChild(title); head.appendChild(sub);
    const close = document.createElement('button');
    close.className = 'tl-deck-modal-close'; close.type = 'button'; close.textContent = '✕';
    close.setAttribute('aria-label', T('common.cancel'));
    close.addEventListener('click', closeDeckView);
    head.appendChild(close);

    // Pestañas de variante (solo si hay más de una). Etiqueta = % de uso de esa versión.
    const tabs = document.createElement('div'); tabs.className = 'tl-deck-tabs';
    if (variants.length > 1) {
      variants.forEach((v, i) => {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'tl-deck-tab' + (i === 0 ? ' active' : '');
        const sh = v.share != null ? Math.round(v.share * 100) : null;
        b.textContent = sh != null ? sh + '%' : (T('tierlist.variant') + ' ' + (i + 1));
        b.addEventListener('click', () => { if (active === i) return; active = i; renderVariant(); if (window.playSound) try { window.playSound('tab'); } catch (e) {} });
        tabs.appendChild(b);
      });
    }

    const body = document.createElement('div'); body.className = 'tl-deck-body';

    function renderVariant() {
      const v = variants[active] || variants[0];
      const pct = x => (x == null ? null : Math.round(x * 1000) / 10);
      const share = pct(v.share), wr = pct(v.winrate);
      const stats = [];
      if (share != null) stats.push(T('tierlist.deckMeta') + ' ' + share + '%');
      if (wr != null) stats.push(wr + '% ' + T('tierlist.deckWr'));
      sub.textContent = stats.join('  ·  ');
      sub.style.display = stats.length ? '' : 'none';
      Array.prototype.forEach.call(tabs.children, (b, i) => b.classList.toggle('active', i === active));
      body.innerHTML = '';
      // Mismo componente que «Mis mazos» (2 líneas + badge ×N idéntico). Las entradas del
      // meta ya vienen como {id,count} → se pasan directas a deckLayout (NO a la variante
      // «FromCards», que asume 1 carta por entrada y perdería el contador).
      if (window._mazosDeckLayout) {
        try { body.appendChild(window._mazosDeckLayout(v.cards || [], { big: true })); fitDeck(); return; }
        catch (e) {}
      }
      // Fallback simple si mazos-view no está disponible.
      const grid = document.createElement('div'); grid.className = 'tl-deck-grid';
      sortDeckEntries((v.cards && v.cards.length ? v.cards : deck.cards) || []).forEach(c => {
        const card = window.dbLookup ? window.dbLookup({ id: c.id }) : null; if (!card) return;
        const cell = document.createElement('div'); cell.className = 'tl-deck-card';
        const im = document.createElement('img'); im.src = window.cardImage ? window.cardImage(card) : card.image; im.draggable = false; im.loading = 'lazy';
        cell.appendChild(im);
        if ((c.count || 1) > 1) { const bb = document.createElement('span'); bb.className = 'tl-deck-count'; bb.textContent = '×' + c.count; cell.appendChild(bb); }
        cell.addEventListener('click', () => { if (window.openZoomFromImage) window.openZoomFromImage(im.src, cell, { rarity: card.rarity }); });
        grid.appendChild(cell);
      });
      body.appendChild(grid);
    }

    // Escala las cartas para que la fila más ancha (2 líneas apaisadas) quepa en el panel.
    // El mazo usa el componente compartido «fit-to-frame» (deckLayout) → se auto-ajusta
    // solo (ResizeObserver + resize global). Aquí solo forzamos un re-ajuste tras abrir/
    // cambiar de variante, por si el modal aún no tenía tamaño al construirse.
    function fitDeck() {
      const fit = body.querySelector('.mz-dl-fit');
      if (fit && window._mazosFitDeck) window._mazosFitDeck(fit);
    }
    modal._tlFitDeck = fitDeck;

    panel.appendChild(head);
    if (variants.length > 1) panel.appendChild(tabs);
    panel.appendChild(body);
    modal.appendChild(panel);
    renderVariant();
    modal.classList.add('open');
    // Medir con el modal ya visible (clientWidth real).
    requestAnimationFrame(fitDeck);
    window.addEventListener('resize', fitDeck);
    modal._tlFitCleanup = () => window.removeEventListener('resize', fitDeck);
    document.addEventListener('keydown', _deckEsc, true);
    if (window.playSound) try { window.playSound('cardGrab'); } catch (e) {}
  }
  function _deckEsc(e) { if (e.key === 'Escape') { e.stopPropagation(); closeDeckView(); } }
  function closeDeckView() {
    const modal = document.getElementById('tl-deck-modal');
    if (modal) { modal.classList.remove('open'); if (modal._tlFitCleanup) { modal._tlFitCleanup(); modal._tlFitCleanup = null; } }
    document.removeEventListener('keydown', _deckEsc, true);
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  // Estado de la tierlist en curso. En tanda 1 las cartas van vacías.
  // Filas por defecto: 5 (S–D, sin F) en escritorio y móvil. La F se puede añadir
  // igual con el ＋ (pedido de Daniel: la F no sale por defecto en ningún formato).
  const _DEFAULT_ROW_N = 5;
  const TL = {
    title: '',
    rows: DEFAULT_LABELS.slice(0, _DEFAULT_ROW_N).map(l => ({ label: l, cards: [] })),
    pool: [],              // ids de cartas en el pool (bandeja de "sin clasificar")
    activeSuggestion: null, // id de la pill cargada actualmente (o null si el pool es manual)
  };

  let _inited = false;

  // ════════════════════════════════════════════════════════════════
  //  TANDA 3 — Clasificar arrastrando + zoom al mantener pulsado.
  //  Gestos con POINTER events (el drag HTML5 no es fiable, ver CLAUDE.md).
  // ════════════════════════════════════════════════════════════════
  const HOLD_MS = 250;        // mantener pulsado SIN mover = abre el zoom
  const DRAG_THRESHOLD = 6;   // px de movimiento para iniciar arrastre (no zoom)

  // Aterrizaje "drop-slam" para TODAS las tiers (tuneable). La carta cae de golpe,
  // se aplasta al impactar; + un halo geométrico (onda de gota) MUY sutil del color
  // del tier. Para que no se recorte contra el #tl-card (overflow:hidden), la caída
  // se pinta con un CLON position:fixed por encima de todo, y la carta real aparece
  // al aterrizar (sin recorte en ningún tier, incluida la S+ de arriba del todo).
  const LAND = {
    dur: 360,       // ms de la caída/aplastado
    drop: 30,       // px de caída desde arriba
    ring: 460,      // ms de la onda
    ringAlpha: 0.3, // opacidad máx de la onda (sutil)
    ringScale: 1.5, // expansión final de la onda
  };

  // «Reducir animaciones» (Ajustes): desactiva las animaciones JS del tierlist
  // (aterrizaje drop-slam, onda, etc.). Las transiciones CSS ya las calma la clase global.
  function reduceMotion() { return document.documentElement.classList.contains('pb-reduce-motion'); }
  // Sonido de arrastrar/soltar: se silencia con «Reducir animaciones» (sin la animación,
  // el «golpe» de sonido no pega — pedido de Daniel).
  function dragSound(name) { if (!reduceMotion() && window.playSound) try { window.playSound(name); } catch (e) {} }

  // ── Encoger la tierlist al bajar («superposición») — OPCIONAL (switch). Por
  //    defecto DESACTIVADO; cuando se activa, solo actúa si la tierlist cubre casi
  //    toda la página (pool grande), y lo hace tarde y muy gradual. Persistido. ──
  const TL_COLLAPSE_KEY = 'pocketboard_tl_collapse_v1';
  let _tlCollapseOn = false;
  try { _tlCollapseOn = localStorage.getItem(TL_COLLAPSE_KEY) === '1'; } catch (e) {}
  function syncCollapseSwitch() {
    const sw = document.getElementById('tl-collapse-switch');
    if (sw) sw.classList.toggle('on', _tlCollapseOn);
    // La clase gobierna el «anclado» (sticky + superposición) vía CSS.
    const view = document.getElementById('view-tierlist');
    if (view) view.classList.toggle('tl-collapse-on', _tlCollapseOn);
  }
  // Fija el estado (persiste + refleja UI). Lo usa el toggle y la sincronización de cuenta.
  window._tlSetCollapse = function (on) {
    _tlCollapseOn = !!on;
    try { localStorage.setItem(TL_COLLAPSE_KEY, _tlCollapseOn ? '1' : '0'); } catch (e) {}
    syncCollapseSwitch();
    // Al apagarlo, restaurar tamaño normal al instante.
    if (!_tlCollapseOn) { const c = document.getElementById('tl-card'); if (c) c.style.setProperty('--tl-scale', '1'); }
  };
  window._tlToggleCollapse = function () {
    window._tlSetCollapse(!_tlCollapseOn);
    if (window.playSound) try { window.playSound('tab'); } catch (e) {}
  };
  window._tlOpenDeckView = function (id) { openDeckView(id); };   // hook de test (modal ver-mazo)

  function lookupCard(id) { return window.dbLookup ? window.dbLookup({ id: id }) : null; }
  function cardArt(card) { return window.cardImage ? window.cardImage(card) : ((card && card.image) || ''); }
  function hexToRgba(hex, a) {
    const h = (hex || '#888').replace('#', '');
    const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const n = parseInt(f, 16) || 0;
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // Color del tier por POSICIÓN entre las filas NORMALES (la especial S+ no consume
  // color de la rampa → S sigue siendo roja esté o no la S+ encima). Especial = null.
  function tierColorAt(row) {
    if (TL.rows[row] && TL.rows[row].special) return null;
    let normalIdx = 0;
    for (let i = 0; i < row; i++) if (!(TL.rows[i] && TL.rows[i].special)) normalIdx++;
    return TIER_COLORS[normalIdx] || '#9097a0';
  }

  // ── Zoom (reutiliza el del tablero/Cartas: flip + tilt + holo) ──
  function openZoom(card, fromEl) {
    if (!card) return;
    const src = cardArt(card);
    if (src && typeof window.openZoomFromImage === 'function') {
      window.openZoomFromImage(src, fromEl || null, { rarity: card.rarity });
    }
  }

  // ── Aterrizaje: drop-slam para todas las tiers (clon sin recorte) ──
  let _pendingLand = null;   // { id, row } — carta recién soltada en un tier
  function playLanding(cell, row) {
    if (reduceMotion()) return;   // sin drop-slam ni onda con «Reducir animaciones»
    const color = tierColorAt(row) || '#e9e3ff';   // S+ (RGB) → halo neutro claro
    const img = cell.querySelector('img');
    const r = cell.getBoundingClientRect();
    if (!r.width) return;
    // Clon fixed que cae por encima de todo (no lo recorta el #tl-card).
    const clone = document.createElement('div');
    clone.className = 'tl-slam-clone';
    clone.style.left = r.left + 'px'; clone.style.top = r.top + 'px';
    clone.style.width = r.width + 'px'; clone.style.height = r.height + 'px';
    if (img) clone.style.backgroundImage = 'url(' + img.src + ')';
    else clone.innerHTML = cell.innerHTML;   // mazo: clonar la portada 50/50
    document.body.appendChild(clone);
    cell.style.opacity = '0';
    let done = false;
    const finish = () => { if (done) return; done = true; clone.remove(); cell.style.opacity = ''; };
    try {
      const a = clone.animate([
        { transform: 'translateY(-' + LAND.drop + 'px) scale(1.03)', offset: 0, easing: 'cubic-bezier(.5,0,.9,.4)' },
        { transform: 'translateY(0) scale(1.12,.84)', offset: 0.42, easing: 'cubic-bezier(.2,.8,.3,1)' },
        { transform: 'translateY(0) scale(.96,1.06)', offset: 0.66 },
        { transform: 'translateY(0) scale(1.02,.99)', offset: 0.83 },
        { transform: 'translateY(0) scale(1)', offset: 1 },
      ], { duration: LAND.dur, fill: 'none' });
      a.onfinish = finish;
      setTimeout(finish, LAND.dur + 120);   // red de seguridad si onfinish no llega
    } catch (e) { finish(); }
    slamRing(r, color);
  }

  // Halo/onda geométrica de gota al caer: anillo nítido (sin bloom) que se expande.
  function slamRing(r, color) {
    const ring = document.createElement('div');
    ring.className = 'tl-slam-ring';
    const base = Math.max(r.width, r.height);
    ring.style.left = (r.left + r.width / 2) + 'px';
    ring.style.top = (r.top + r.height / 2) + 'px';
    ring.style.width = base + 'px'; ring.style.height = base + 'px';
    ring.style.setProperty('--ring-color', color);
    document.body.appendChild(ring);
    try {
      const a = ring.animate([
        { transform: 'translate(-50%,-50%) scale(.42)', opacity: LAND.ringAlpha, offset: 0 },
        { transform: 'translate(-50%,-50%) scale(' + LAND.ringScale + ')', opacity: 0, offset: 1 },
      ], { duration: LAND.ring, easing: 'cubic-bezier(.2,.6,.2,1)' });
      a.onfinish = () => ring.remove();
      setTimeout(() => ring.remove(), LAND.ring + 120);
    } catch (e) { ring.remove(); }
  }

  // ── Feedback de soltado (resaltes + caret de inserción) ─────────
  function clearDropFeedback() {
    document.querySelectorAll('#view-tierlist .tl-drop-active, #view-tierlist .tl-drop-over')
      .forEach(el => el.classList.remove('tl-drop-active', 'tl-drop-over'));
    const caret = document.getElementById('tl-drop-caret');
    if (caret) caret.remove();
  }
  // Posición de inserción dentro de un tier (izquierda/arriba = mejor).
  // Excluye la carta arrastrada → el índice es relativo a las cartas RESTANTES.
  function dropIndexAt(container, x, y, exclude) {
    const cells = [...container.querySelectorAll('.tl-tier-card')].filter(c => c !== exclude);
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i].getBoundingClientRect();
      if (y < r.top - 2) return i;                       // el cursor está en una fila superior
      if (y <= r.bottom && x < r.left + r.width / 2) return i;
    }
    return cells.length;
  }
  function placeCaret(container, index, exclude) {
    let caret = document.getElementById('tl-drop-caret');
    if (!caret) { caret = document.createElement('div'); caret.id = 'tl-drop-caret'; caret.className = 'tl-drop-caret'; }
    const cells = [...container.querySelectorAll('.tl-tier-card')].filter(c => c !== exclude);
    if (index >= cells.length) container.appendChild(caret);
    else container.insertBefore(caret, cells[index]);
  }
  // Posición de inserción dentro de la selección (rejilla) — reordenar simple.
  function poolDropIndex(grid, x, y, exclude) {
    const cells = [...grid.querySelectorAll('.tl-pool-card')].filter(c => c !== exclude);
    for (let i = 0; i < cells.length; i++) {
      const r = cells[i].getBoundingClientRect();
      if (y < r.top - 2) return i;
      if (y <= r.bottom && x < r.left + r.width / 2) return i;
    }
    return cells.length;
  }
  // Aparta las cartas para abrir hueco (estilo reordenar apps en la home del iPhone):
  // las que quedan a la derecha del punto de inserción se desplazan suavemente.
  // Recorrido GRANDE (las cartas son grandes y la arrastrada las tapa) — tuneable.
  const PUSH_GAP = 58;   // px que se separan las cartas
  function applyPushAside(container, index, exclude) {
    const cells = [...container.querySelectorAll('.tl-tier-card')].filter(c => c !== exclude);
    cells.forEach((c, i) => { c.style.transform = i >= index ? 'translateX(' + PUSH_GAP + 'px)' : 'translateX(0)'; });
  }
  function clearPushAside() {
    document.querySelectorAll('#tl-rows .tl-tier-card').forEach(c => { c.style.transform = ''; });
  }
  // El push se RETARDA: las cartas permanecen en su sitio (solo el caret como mínimo
  // offset) y se desplazan tras ~0.5 s sobre el mismo hueco → sin stutter al barrer rápido.
  const PUSH_DELAY = 300;   // ms de espera sobre un hueco antes de abrirlo (tuneable)
  let _pushTimer = null, _pushKey = null;
  function schedulePush(container, index, exclude, rowN) {
    const key = rowN + ':' + index;
    if (key === _pushKey) return;        // mismo hueco: deja el push/timer en curso
    clearTimeout(_pushTimer);
    clearPushAside();                    // vuelven a su sitio mientras decides el hueco
    _pushKey = key;
    _pushTimer = setTimeout(() => { applyPushAside(container, index, exclude); }, PUSH_DELAY);
  }
  function cancelPush() {
    clearTimeout(_pushTimer); _pushTimer = null; _pushKey = null;
    clearPushAside();
  }

  // ── Mover una carta entre orígenes/destinos + re-render ─────────
  // source/dest = { kind:'pool' } | { kind:'row', row:i[, index:n] }
  function moveCard(id, source, dest) {
    let srcIdx = -1;
    if (source.kind === 'pool') {
      srcIdx = TL.pool.indexOf(id);
      if (srcIdx < 0) return;
      TL.pool.splice(srcIdx, 1);
    } else {
      const arr = TL.rows[source.row] && TL.rows[source.row].cards;
      if (!arr) return;
      srcIdx = arr.indexOf(id);
      if (srcIdx < 0) return;
      arr.splice(srcIdx, 1);
    }
    if (dest.kind === 'pool') {
      // Insertar en la POSICIÓN de soltado (reordenar la selección), no al final.
      // dest.index viene excluyendo la arrastrada y aquí ya se quitó del origen.
      if (!TL.pool.includes(id)) {
        let idx = dest.index == null ? TL.pool.length : dest.index;
        idx = Math.max(0, Math.min(idx, TL.pool.length));
        TL.pool.splice(idx, 0, id);
      }
      dragSound('goBack');
    } else {
      const destArr = TL.rows[dest.row] && TL.rows[dest.row].cards;
      if (!destArr) return;
      // dest.index ya viene relativo a las cartas SIN la arrastrada (dropIndexAt la excluye),
      // y aquí la carta ya se ha quitado del origen → se inserta directamente en ese índice.
      let idx = dest.index == null ? destArr.length : dest.index;
      idx = Math.max(0, Math.min(idx, destArr.length));
      destArr.splice(idx, 0, id);
      _pendingLand = { id: id, row: dest.row };
      dragSound('nextCard');
    }
    markPoolManual();
    renderRows();
    renderPool();
  }

  // ── Gesto por carta: press-hold = zoom · press+mover = arrastrar ──
  function makeCardDraggable(cell, cardId, source) {
    cell.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;          // solo botón principal
      if (e.target.closest && e.target.closest('.tl-pool-remove')) return;  // la ✕ tiene lo suyo
      const isDeck = isDeckItem(cardId);
      const card = isDeck ? null : lookupCard(cardId);
      const startX = e.clientX, startY = e.clientY;
      const poolMode = document.getElementById('view-tierlist').classList.contains('tl-pool-mode');
      let dragging = false, zoomed = false, target = null, ghost = null;

      // Mantener pulsado: carta = zoom; mazo = ver mazo completo.
      const holdTimer = setTimeout(() => {
        if (dragging) return;
        zoomed = true;
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        if (isDeck) openDeckView(cardId); else openZoom(card, cell);
      }, HOLD_MS);

      function begin() {
        dragging = true;
        clearTimeout(holdTimer);
        _pushKey = null;            // arranque limpio del push retardado
        cell.classList.add('tl-dragging');
        ghost = document.createElement('div');
        ghost.className = 'tl-drag-ghost' + (isDeck ? ' tl-drag-ghost-deck' : '');
        const vis = itemVisual(cardId);    // <img> (carta) o portada 50/50 (mazo)
        if (vis) ghost.appendChild(vis);
        document.body.appendChild(ghost);
        try { ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'forwards' }); } catch (er) {}
        // Resaltar destinos: todas las filas (+ la zona de selección si está visible).
        document.getElementById('view-tierlist').classList.add('tl-dragging-active');
        document.querySelectorAll('#tl-rows .tl-row').forEach(r => r.classList.add('tl-drop-active'));
        if (poolMode) { const pz = document.getElementById('tl-pane-pool'); if (pz) pz.classList.add('tl-drop-active'); }
        dragSound('cardGrab');
      }

      function onMove(ev) {
        if (!dragging) {
          if (zoomed) return;
          if (!poolMode) return;   // arrastre solo en «Mi selección»
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > DRAG_THRESHOLD) begin();
          else return;
        }
        if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
        document.querySelectorAll('#view-tierlist .tl-drop-over').forEach(el => el.classList.remove('tl-drop-over'));
        const oldCaret = document.getElementById('tl-drop-caret'); if (oldCaret) oldCaret.remove();
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        target = null;
        const row = under && under.closest && under.closest('#tl-rows .tl-row');
        const pool = under && under.closest && under.closest('#tl-pane-pool');
        if (row) {
          row.classList.add('tl-drop-over');
          const cards = row.querySelector('.tl-row-cards');
          const idx = dropIndexAt(cards, ev.clientX, ev.clientY, cell);
          placeCaret(cards, idx, cell);                       // caret inmediato (mínimo offset)
          schedulePush(cards, idx, cell, +row.dataset.row);   // las cartas se apartan tras ~0.5 s
          target = { kind: 'row', row: +row.dataset.row, index: idx };
        } else if (pool && poolMode) {
          cancelPush();
          pool.classList.add('tl-drop-over');
          // Reordenar la selección: índice de inserción simple por posición (sin push/caret).
          const grid = document.querySelector('#tl-pool-content .tl-pool-grid');
          const idx = grid ? poolDropIndex(grid, ev.clientX, ev.clientY, cell) : null;
          target = { kind: 'pool', index: idx };
        } else {
          cancelPush();
        }
      }

      function onUp() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        clearTimeout(holdTimer);
        if (!dragging) {
          if (!zoomed && isDeck) openDeckView(cardId);   // clic en un mazo = ver mazo completo
          return;
        }
        if (ghost) ghost.remove();
        cell.classList.remove('tl-dragging');
        document.getElementById('view-tierlist').classList.remove('tl-dragging-active');
        const t = target;
        cancelPush();
        clearDropFeedback();
        if (t) moveCard(cardId, source, t);
      }

      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }

  // ── Render de las filas ─────────────────────────────────────────
  function renderRows() {
    const host = document.getElementById('tl-rows');
    if (!host) return;
    host.innerHTML = '';
    let landCell = null, landRow = -1;   // la carta a animar se reproduce TRAS adjuntar (rect real)
    TL.rows.forEach((row, i) => {
      const el = document.createElement('div');
      el.className = 'tl-row' + (row.special ? ' tl-row--splus' : '');
      el.dataset.row = String(i);
      // --tier-color en la fila → lo heredan la etiqueta, el resalte y el caret.
      // La fila especial S+ no usa color de la rampa (fondo RGB animado por CSS).
      const col = tierColorAt(i);
      if (col) el.style.setProperty('--tier-color', col);

      const label = document.createElement('div');
      label.className = 'tl-row-label';
      label.textContent = row.label;
      makeLabelEditable(label, i);

      const cards = document.createElement('div');
      cards.className = 'tl-row-cards';
      row.cards.forEach(id => {
        const vis = itemVisual(id);
        if (!vis) return;
        const cell = document.createElement('div');
        cell.className = 'tl-tier-card' + (isDeckItem(id) ? ' tl-deck-item' : '');
        cell.dataset.id = id;
        cell.appendChild(vis);
        makeItemGesture(cell, id, { kind: 'row', row: i });   // táctil: swipe=scroll · mantener=reordenar
        cards.appendChild(cell);
        if (_pendingLand && _pendingLand.id === id && _pendingLand.row === i) { landCell = cell; landRow = i; }
      });

      const rm = document.createElement('button');
      rm.className = 'tl-row-remove';
      rm.type = 'button';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', 'remove row');
      rm.addEventListener('click', () => removeRow(i));

      el.appendChild(label);
      el.appendChild(cards);
      el.appendChild(rm);
      host.appendChild(el);
    });
    syncAddBtn();
    updateResetVisibility();
    // Re-ajustar las etiquetas YA en el DOM (para que las renombradas largas no desborden).
    host.querySelectorAll('.tl-row-label').forEach(fitLabel);
    // El aterrizaje se reproduce con la carta YA en el DOM (rect real, sin recorte).
    if (landCell) { playLanding(landCell, landRow); _pendingLand = null; }
  }

  // Botón Reset: vacía la tierlist (las cartas vuelven a «Mi selección»). Sutil:
  // solo se muestra cuando hay cartas clasificadas.
  function tierCardCount() { return TL.rows.reduce((n, r) => n + r.cards.length, 0); }
  function updateResetVisibility() {
    const btn = document.getElementById('tl-reset');
    if (btn) btn.style.display = tierCardCount() ? '' : 'none';
  }
  async function resetTierlist() {
    if (!tierCardCount()) return;
    const ok = window.pbConfirm
      ? await window.pbConfirm({
          title: T('tierlist.resetTitle'),
          message: T('tierlist.resetMsg'),
          okLabel: T('tierlist.resetOk'),
          cancelLabel: T('common.cancel'),
          danger: true,
        })
      : true;
    if (!ok) return;
    TL.rows.forEach(r => {
      r.cards.forEach(id => { if (!TL.pool.includes(id)) TL.pool.push(id); });
      r.cards = [];
    });
    markPoolManual();
    renderRows();
    renderPool();
    if (window.playSound) try { window.playSound('goBack'); } catch (e) {}
  }

  // ── Renombrar tiers (inline, como los nombres de jugador del tablero) ──
  const LABEL_MAX = 24;   // límite de caracteres (un poco más alto que antes)
  // El tamaño del texto se adapta: primero por nº de caracteres y luego se encoge
  // hasta que NO desborde la etiqueta (ni ancho ni alto). Así una tier renombrada
  // no se sale de su sitio y las palabras nunca se parten (word-break: normal).
  function fitLabel(el) {
    const len = (el.textContent || '').trim().length || 1;
    let size = Math.max(11, Math.min(30, 32 - len * 1.05));
    el.style.fontSize = size.toFixed(1) + 'px';
    // Solo si está en el DOM (scrollWidth/clientWidth reales); si no, con el tamaño por longitud basta.
    let guard = 0;
    while (size > 8 && el.clientWidth > 0 &&
           (el.scrollWidth > el.clientWidth + 0.5 || el.scrollHeight > el.clientHeight + 0.5) &&
           guard++ < 40) {
      size -= 0.75;
      el.style.fontSize = size.toFixed(2) + 'px';
    }
  }
  function makeLabelEditable(label, i) {
    fitLabel(label);
    label.contentEditable = 'true';
    label.spellcheck = false;
    label.setAttribute('role', 'textbox');
    label.setAttribute('aria-label', (window.t ? window.t('tierlist.rowName') : 'Nombre del nivel'));
    label.addEventListener('input', () => {
      let txt = label.textContent || '';
      if (txt.length > LABEL_MAX) {                  // recortar a 20 chars (sin maxlength en CE)
        txt = txt.slice(0, LABEL_MAX);
        label.textContent = txt;
        const sel = window.getSelection();
        if (sel) { sel.selectAllChildren(label); sel.collapseToEnd(); }
      }
      if (TL.rows[i]) TL.rows[i].label = txt;
      fitLabel(label);
    });
    label.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    label.addEventListener('focus', () => {
      const sel = window.getSelection();
      if (sel) sel.selectAllChildren(label);
    });
    // Evitar que el gesto de la etiqueta arranque nada raro al hacer foco.
    label.addEventListener('pointerdown', e => e.stopPropagation());
  }

  function syncAddBtn() {
    const full = TL.rows.length >= MAX_ROWS;
    const btn = document.getElementById('tl-add-row');
    if (btn) btn.classList.toggle('disabled', full);
    // El botón de añadir ARRIBA (S+) solo si NO existe ya la S+ y hay hueco.
    const top = document.getElementById('tl-add-row-top');
    const hasSplus = !!(TL.rows[0] && TL.rows[0].special);
    if (top) top.classList.toggle('disabled', full || hasSplus);
    const view = document.getElementById('view-tierlist');
    if (view) view.classList.toggle('tl-has-splus', hasSplus);
    // No mostrar el botón de quitar si solo queda una fila.
    document.querySelectorAll('#tl-rows .tl-row-remove').forEach(b => {
      b.style.display = TL.rows.length <= 1 ? 'none' : '';
    });
  }

  // Etiqueta por defecto de la siguiente fila NORMAL (cuenta solo las no especiales).
  function nextNormalLabel() {
    const n = TL.rows.filter(r => !r.special).length;
    return DEFAULT_LABELS[n] || '•';
  }

  function addRow() {            // añade una fila DEBAJO (al final)
    if (TL.rows.length >= MAX_ROWS) return;
    TL.rows.push({ label: nextNormalLabel(), cards: [] });
    renderRows();
    if (window.playSound) try { window.playSound('tab'); } catch (e) {}
  }

  // Añade la tier especial S+ ENCIMA de la más alta (solo una, factor épico).
  function addRowAbove() {
    if (TL.rows.length >= MAX_ROWS) return;
    if (TL.rows[0] && TL.rows[0].special) return;   // ya hay S+
    TL.rows.unshift({ label: 'S+', cards: [], special: true });
    renderRows();
    if (window.playSound) try { window.playSound('tab'); } catch (e) {}
  }

  function removeRow(i) {
    if (TL.rows.length <= 1) return;
    TL.rows.splice(i, 1);
    renderRows();
  }

  // ── Render de las pills ─────────────────────────────────────────
  const CROWN_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 5.2l2.6 2.2L8 3l3.4 4.4L14 5.2l-1 6.3H3L2 5.2z"/></svg>';
  const TROPHY_SVG = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2h8v2.5a4 4 0 0 1-8 0V2zm-1 1H2v1.2A2 2 0 0 0 4 6.4M13 3h1v1.2A2 2 0 0 1 12 6.4M7 8.6h2V11H7zM5 11h6v1.4H5zM4.5 13h7V14h-7z"/></svg>';

  function renderPills() {
    const host = document.getElementById('tl-pills');
    if (!host) return;
    host.innerHTML = '';
    PILLS.forEach(p => {
      const el = document.createElement('button');
      el.className = 'tl-pill' + (p.id === TL.activeSuggestion ? ' active' : '') + (p.icon === 'trophy' ? ' tl-pill-meta' : '');
      el.type = 'button';
      el.dataset.preset = p.id;
      let inner = '';
      if (p.icon === 'crown') inner += CROWN_SVG;
      if (p.icon === 'trophy') inner += TROPHY_SVG;
      if (p.stars) inner += '<span style="opacity:.8;letter-spacing:-1px">' + '✦'.repeat(p.stars) + '</span>';
      inner += '<span>' + T(p.key) + '</span>';
      el.innerHTML = inner;
      el.addEventListener('click', () => applyPill(p.id));
      host.appendChild(el);
    });
  }

  // ── Pools predefinidos: resolver query → cartas ─────────────────
  const RAR_ORDER = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '✸', '✸✸', '♕', 'Promo'];
  const rarRank = c => { const i = RAR_ORDER.indexOf(c.rarity); return i < 0 ? 99 : i; };

  let _latestSet = null;
  function latestSet() {
    if (_latestSet) return _latestSet;
    const order = window.SET_ORDER || [];
    const rank = window.SET_RANK || {};
    const present = new Set((window.CARDS_DB || []).map(c => c.set));
    let best = null, bestR = -1;
    order.forEach(s => {
      if (s === 'PA' || s === 'PB') return;        // los promos no son "expansión"
      if (present.has(s) && (rank[s] ?? -1) > bestR) { bestR = rank[s]; best = s; }
    });
    _latestSet = best;
    return best;
  }

  // Predicado por pill (sobre la carta de la DB).
  // Las pills cargan POR RAREZA (sin dedup por nombre): base ◊◊◊◊ para EX/Mega,
  // su rareza para full art / crown / immersive, y la última expansión = TODOS los artes.
  const PILL_QUERY = {
    ex:        c => c.ex,
    megaEx:    c => (c.name || '').toLowerCase().startsWith('mega '),
    fullArt:   c => c.cardType === 'supporter' && c.rarity === 'SAR',
    latest:    c => c.set === latestSet(),
    crown:     c => c.rarity === '♕',
    immersive: c => c.rarity === 'IM',
  };

  // Pills que se quedan con la impresión BASE de cada Pokémon (ver baseImpressions).
  const PILL_BASE = new Set(['ex', 'megaEx']);

  // Impresión base por NOMBRE: las ◊◊◊◊ (puede haber varias, una por expansión) y,
  // si el Pokémon solo salió como promo (Mega Heracross ex, Mega Houndoom ex,
  // Zygarde ex…), sus promos — así ningún Pokémon se queda fuera del preset.
  function baseImpressions(cards) {
    const byName = new Map();
    cards.forEach(c => {
      const k = c.name || '';
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k).push(c);
    });
    const out = [];
    byName.forEach(list => {
      const base = list.filter(c => c.rarity === '◊◊◊◊');
      out.push(...(base.length ? base : list.filter(c => c.rarity === 'Promo')));
    });
    return out;
  }

  function sortBySet(cards) {
    const rank = window.SET_RANK || {};
    return cards.slice().sort((a, b) => ((rank[a.set] ?? 99) - (rank[b.set] ?? 99))
      || (parseInt(a.number || '0') - parseInt(b.number || '0')));
  }

  // Resuelve una pill → todas las cartas que casan (cada variante es independiente).
  function resolvePill(id) {
    const pred = PILL_QUERY[id];
    if (!pred) return [];
    let cards = (window.CARDS_DB || []).filter(c => c && c.image && pred(c));
    if (PILL_BASE.has(id)) cards = baseImpressions(cards);
    return sortBySet(cards);
  }

  // Carga una sugerencia en el pool y la marca como activa.
  function setSuggestion(id) {
    let ids;
    if (id === 'metaDecks') ids = metaDeckItems();           // top 50 mazos meta (ítems 'deck:')
    else { const cards = resolvePill(id); ids = cards.map(c => c.id); }
    if (!ids.length) return false;
    TL.pool = ids;
    TL.activeSuggestion = id;
    renderPool();
    renderPills();
    return true;
  }

  async function applyPill(id) {
    // Confirmar solo si el pool tiene contenido MANUAL (no una sugerencia pura).
    if (TL.pool.length && TL.activeSuggestion === null) {
      const ok = window.pbConfirm
        ? await window.pbConfirm({
            title: T('tierlist.replacePoolTitle'),
            message: T('tierlist.replacePoolMsg'),
            okLabel: T('tierlist.replace'),
            cancelLabel: T('common.cancel'),
          })
        : true;
      if (!ok) return;
    }
    if (!setSuggestion(id)) return;
    activateSubtab('pool');
    if (window.playSound) try { window.playSound('cardGrab'); } catch (e) {}
  }

  // El pool pasa a ser "manual" (deja de coincidir con una sugerencia).
  function markPoolManual() {
    if (TL.activeSuggestion !== null) { TL.activeSuggestion = null; renderPills(); }
  }

  // ── Pool (bandeja de "sin clasificar") ──────────────────────────
  function removeFromPool(cardId) {
    TL.pool = TL.pool.filter(x => x !== cardId);
    markPoolManual();
    renderPool();
  }

  async function clearPool() {
    if (!TL.pool.length) return;
    const ok = window.pbConfirm
      ? await window.pbConfirm({
          title: T('tierlist.clearPoolTitle'),
          okLabel: T('tierlist.clearPool'),
          cancelLabel: T('common.cancel'),
          danger: true,
        })
      : true;
    if (!ok) return;
    TL.pool = [];
    markPoolManual();
    renderPool();
  }

  // Las sugerencias (pills) solo se ven dentro de «Mi selección» y SOLO si está vacía.
  function updatePresetsVisibility() {
    const p = document.getElementById('tl-presets');
    if (p) p.style.display = TL.pool.length ? 'none' : '';
  }

  function renderPool() {
    markSearchInPool();   // mantener sincronizadas las marcas del buscador
    updatePresetsVisibility();
    const pane = document.getElementById('tl-pool-content');
    if (!pane) return;
    pane.innerHTML = '';
    if (!TL.pool.length) {
      const hint = document.createElement('div');
      hint.className = 'tl-pane-hint';
      hint.textContent = T('tierlist.poolEmpty');
      pane.appendChild(hint);
      return;
    }
    const head = document.createElement('div');
    head.className = 'tl-pool-head';
    const cnt = document.createElement('span');
    cnt.className = 'tl-pool-count';
    cnt.textContent = T('tierlist.poolCount', { n: TL.pool.length });
    const clr = document.createElement('button');
    clr.className = 'tl-pool-clear';
    clr.type = 'button';
    clr.textContent = T('tierlist.clearPool');
    clr.addEventListener('click', clearPool);
    head.appendChild(cnt);
    head.appendChild(clr);
    pane.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'tl-pool-grid';
    TL.pool.forEach(id => {
      const vis = itemVisual(id);
      if (!vis) return;
      const cell = document.createElement('div');
      cell.className = 'tl-pool-card' + (isDeckItem(id) ? ' tl-deck-item' : '');
      cell.dataset.id = id;
      cell.appendChild(vis);
      makeItemGesture(cell, id, { kind: 'pool' });   // mantener=arrastrar · tocar=levantar · mazo=ver/rankear
      const rm = document.createElement('button');
      rm.className = 'tl-pool-remove';
      rm.type = 'button';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', 'remove');
      rm.addEventListener('click', e => { e.stopPropagation(); removeFromPool(id); });
      cell.appendChild(rm);
      grid.appendChild(cell);
    });
    pane.appendChild(grid);
    // Cue táctil «primera vez»: el tap+tap para rankear (tocar carta → tocar tier).
    // Modelo C (máx 2, 1/sesión, «hecha» al levantar) lo gestiona pbCue.
    if (window.pbIsTouchMobile && window.pbIsTouchMobile() &&
        window.pbCue && window.pbCue.eligible && window.pbCue.eligible('tierlistPlace')) {
      setTimeout(function () {
        var first = grid.querySelector('.tl-pool-card');
        if (first && first.getBoundingClientRect().width > 0 && !document.querySelector('.tl-lifted')) {
          window.pbCue.maybe('tierlistPlace', { place: 'float' });   // flotante fijo, no anclada
        }
      }, 500);
    }
  }

  // ── Buscador embebido (esencial) ────────────────────────────────
  const ST = {
    q: '', set: '', types: new Set(), els: new Set(), stages: new Set(),
    rarities: new Set(), ex: false, mega: false, ability: false,
    sortBy: 'set', sortDir: 'desc',   // por defecto: expansión descendente (más nuevas arriba)
  };
  let currentShown = [];    // cartas mostradas en los resultados (para lote / rango)
  let lastClickIdx = null;  // índice del último click (para shift+click = rango)
  const SEARCH_TYPES = ['pokemon', 'item', 'tool', 'supporter', 'stadium', 'fossil'];
  const SEARCH_STAGES = ['basic', '1', '2'];
  const SEARCH_ELS = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'dragon', 'colorless'];
  const SEARCH_RARS = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '✸', '✸✸', '♕', 'Promo'];
  const SEARCH_CAP = 300;

  // Mismo lenguaje visual que Cartas: símbolos de rareza ◇/☆/♛ (no AR/SAR/IM)
  const RARITY_DISPLAY = {
    '◊': '◇', '◊◊': '◇◇', '◊◊◊': '◇◇◇', '◊◊◊◊': '◇◇◇◇',
    'AR': '☆', 'SAR': '☆☆', 'IM': '☆☆☆', '✸': '✸', '✸✸': '✸✸', '♕': '♛', 'Promo': 'Promo',
  };

  function toggleSet(set, v, chip) {
    if (set.has(v)) { set.delete(v); chip.classList.remove('active'); }
    else { set.add(v); chip.classList.add('active'); }
    runSearch();
  }

  // Inyecta el orbe de energía REAL en los chips de elemento (igual que Cartas).
  function injectOrbs() {
    document.querySelectorAll('#tls-el .cv-el-chip').forEach(chip => {
      const type = chip.dataset.cvEl;
      const iconKey = window.ORB_ICON_KEY && window.ORB_ICON_KEY[type];
      // El dragón no tiene orbe de energía en Pocket → su ICONO de tipo (el mismo que
      // usan Cartas y el buscador del tablero); antes se quedaba con el punto de color.
      const src = (iconKey && ((window.ENERGY_ICONS && window.ENERGY_ICONS[iconKey]) || (window.ORB_ICONS && window.ORB_ICONS[iconKey])))
               || (type === 'dragon' ? window.DRAGON_EL_ICON : null);
      if (src) chip.innerHTML = '<img src="' + src + '" style="width:20px;height:20px;border-radius:50%;pointer-events:none;" draggable="false">';
    });
  }

  function buildSearchChips() {
    // Tipo (texto, como en Cartas) — chips .cv-chip con color activo por tipo
    const typeHost = document.getElementById('tls-type');
    if (typeHost) {
      typeHost.innerHTML = '';
      SEARCH_TYPES.forEach(t => {
        const c = document.createElement('span');
        c.className = 'cv-chip' + (ST.types.has(t) ? ' active' : '');
        c.dataset.cvType = t;
        c.textContent = (window.typeName ? window.typeName(t) : t);
        c.addEventListener('click', () => toggleSet(ST.types, t, c));
        typeHost.appendChild(c);
      });
    }
    // Elemento (orbe de energía real)
    const elHost = document.getElementById('tls-el');
    if (elHost) {
      elHost.innerHTML = '';
      SEARCH_ELS.forEach(e => {
        const c = document.createElement('span');
        c.className = 'cv-chip cv-el-chip cv-el-icon' + (ST.els.has(e) ? ' active' : '');
        c.dataset.cvEl = e;
        c.title = (window.elName ? window.elName(e) : e);
        c.innerHTML = '<span class="cv-eldot el-' + e + '"></span>';
        c.addEventListener('click', () => {
          const on = !ST.els.has(e);
          toggleSet(ST.els, e, c);
          // mismo estallido de partículas que en Cartas (fuente única _cvChipBurst)
          if (on && window._cvChipBurst) window._cvChipBurst(c, 'el', e);
        });
        elHost.appendChild(c);
      });
      injectOrbs();
    }
    // Fase (Básico / Fase 1 / Fase 2)
    const stageHost = document.getElementById('tls-stage');
    if (stageHost) {
      stageHost.innerHTML = '';
      SEARCH_STAGES.forEach(s => {
        const c = document.createElement('span');
        c.className = 'cv-chip' + (ST.stages.has(s) ? ' active' : '');
        c.dataset.cvStage = s;
        c.textContent = (window.stageLabel ? window.stageLabel(s === 'basic' ? 'basic' : parseInt(s, 10)) : s);
        c.addEventListener('click', () => toggleSet(ST.stages, s, c));
        stageHost.appendChild(c);
      });
    }
    // Rareza (símbolos ◇/☆/♛)
    const rarHost = document.getElementById('tls-rar');
    if (rarHost) {
      rarHost.innerHTML = '';
      SEARCH_RARS.forEach(r => {
        const c = document.createElement('span');
        c.className = 'cv-chip cv-rar-chip' + (ST.rarities.has(r) ? ' active' : '');
        c.dataset.rar = r;
        var ih = window.rarityIconHTML && window.rarityIconHTML(r);
        if (ih) c.innerHTML = ih; else c.textContent = RARITY_DISPLAY[r] || r;
        c.addEventListener('click', () => toggleSet(ST.rarities, r, c));
        rarHost.appendChild(c);
      });
    }
    // EX / Mega / Habilidad (mismo grupo, como en Cartas)
    const exC = document.getElementById('tls-ex');
    if (exC) { exC.classList.toggle('active', ST.ex); exC.onclick = () => { ST.ex = !ST.ex; exC.classList.toggle('active', ST.ex); runSearch(); }; }
    const megaC = document.getElementById('tls-mega');
    if (megaC) { megaC.classList.toggle('active', ST.mega); megaC.onclick = () => { ST.mega = !ST.mega; megaC.classList.toggle('active', ST.mega); runSearch(); }; }
    const abC = document.getElementById('tls-ability');
    if (abC) { abC.classList.toggle('active', ST.ability); abC.onclick = () => { ST.ability = !ST.ability; abC.classList.toggle('active', ST.ability); runSearch(); }; }
  }

  function buildSearchUI() {
    const setSel = document.getElementById('tls-set');
    if (setSel) {
      setSel.innerHTML = '';
      const optAll = document.createElement('option');
      optAll.value = ''; optAll.textContent = T('cards.allSets');
      setSel.appendChild(optAll);
      (window.SET_ORDER || []).forEach(code => {
        const o = document.createElement('option');
        o.value = code;
        o.textContent = (window.setName ? window.setName(code) : code);
        setSel.appendChild(o);
      });
      setSel.value = ST.set;   // '' = todos los sets por defecto
      setSel.onchange = () => { ST.set = setSel.value; runSearch(); };
    }
    buildSearchChips();
    const q = document.getElementById('tls-q');
    if (q) { q.value = ST.q; q.oninput = () => { ST.q = q.value; runSearch(); }; }
    const done = document.getElementById('tls-done');
    if (done) done.onclick = () => activateSubtab('pool');
    const tg = document.getElementById('tls-select-toggle');
    if (tg) tg.onclick = () => { if (tg.dataset.mode === 'deselect') deselectAllResults(); else selectAllResults(); };
    updateSelectToggle();
    // Orden (dropdown como en Cartas)
    const sortTrig = document.getElementById('tls-sort-trigger');
    const sortMenu = document.getElementById('tls-sort-menu');
    if (sortTrig && sortMenu) {
      sortTrig.onclick = e => { e.stopPropagation(); sortMenu.style.display = sortMenu.style.display === 'none' ? 'block' : 'none'; };
      sortMenu.querySelectorAll('.cv-sort-opt').forEach(opt => { opt.onclick = () => setSort(opt.dataset.sort); });
      document.addEventListener('click', () => { sortMenu.style.display = 'none'; });
    }
    updateSortUI();
    tlsApplyResponsive();   // móvil: caja + botón «Filtros» → hoja
  }

  function setSort(by) {
    if (ST.sortBy === by) ST.sortDir = ST.sortDir === 'asc' ? 'desc' : 'asc';
    else { ST.sortBy = by; ST.sortDir = by === 'set' ? 'desc' : 'asc'; }
    updateSortUI();
    const m = document.getElementById('tls-sort-menu');
    if (m) m.style.display = 'none';
    runSearch();
  }

  function updateSortUI() {
    const names = { set: T('cards.sortSet'), type: T('cards.sortType'), rarity: T('cards.sortRarity'), name: T('cards.sortName') };
    const arrow = ST.sortDir === 'asc' ? ' ↑' : ' ↓';
    const label = document.getElementById('tls-sort-label');
    if (label) label.textContent = (names[ST.sortBy] || ST.sortBy) + arrow;
    document.querySelectorAll('#tls-sort-menu .cv-sort-opt').forEach(b => {
      const active = b.dataset.sort === ST.sortBy;
      b.classList.toggle('active', active);
      const ar = b.querySelector('.cv-sort-arrow');
      if (ar) ar.textContent = active ? arrow : '';
    });
  }

  function sortResults(cards) {
    const rank = window.SET_RANK || {};
    const RAR = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '✸', '✸✸', '♕', 'Promo'];
    const TYPES = ['pokemon', 'item', 'tool', 'supporter', 'stadium', 'fossil'];
    const setKey = c => (rank[c.set] ?? 99) * 10000 + parseInt(c.number || '0', 10);
    const rr = c => { const i = RAR.indexOf(c.rarity); return i < 0 ? 99 : i; };
    const tk = c => { const i = TYPES.indexOf(c.cardType); return i < 0 ? 99 : i; };
    const nm = c => (window.cardName ? window.cardName(c) : c.name || '').toLowerCase();
    const dir = ST.sortDir === 'asc' ? 1 : -1;
    return cards.slice().sort((a, b) => {
      let p = 0;
      if (ST.sortBy === 'set') p = setKey(a) - setKey(b);
      else if (ST.sortBy === 'rarity') p = rr(a) - rr(b);
      else if (ST.sortBy === 'type') p = (tk(a) - tk(b)) || (setKey(a) - setKey(b));
      else p = nm(a) < nm(b) ? -1 : nm(a) > nm(b) ? 1 : 0;
      return p !== 0 ? dir * p : setKey(a) - setKey(b);
    });
  }

  function searchMatches() {
    // plegada (sin tildes ni apostrofos) igual que el indice de nombres de shared.js
    const q = window.pbFold ? window.pbFold(ST.q.trim().toLowerCase()) : ST.q.trim().toLowerCase();
    return (window.CARDS_DB || []).filter(c => {
      if (!c || !c.image) return false;
      if (ST.set && c.set !== ST.set) return false;
      if (ST.types.size && !ST.types.has(c.cardType) && !(c.cardType === 'fossil' && ST.types.has('item'))) return false;   // un fósil es una carta de Objeto
      if (ST.els.size && !(c.cardType === 'pokemon' && ST.els.has(c.element))) return false;
      if (ST.stages.size) {
        if (c.cardType !== 'pokemon') return false;   // la fase es de Pokémon (un fósil es un Objeto)
        const st = c.stage == null ? null
          : (c.stage === 'basic' || c.stage === 0 ? 'basic' : String(c.stage));
        if (!ST.stages.has(st)) return false;
      }
      if (ST.rarities.size && !ST.rarities.has(c.rarity)) return false;
      if (ST.ex && !c.ex) return false;
      if (ST.mega && !(c.name || '').toLowerCase().startsWith('mega ')) return false;
      if (ST.ability && !c.hasAbility) return false;
      if (q) {
        // Casa contra el nombre inglés Y las traducciones ES/JA a la vez.
        const names = window.cardSearchNames ? window.cardSearchNames(c) : (c.name || '').toLowerCase();
        if (names.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  // Click = añadir / quitar (por ID EXACTO de la variante). Click derecho = solo añadir.
  function toggleSearchCard(card, addOnly) {
    const i = TL.pool.indexOf(card.id);
    if (i >= 0) { if (addOnly) return; TL.pool.splice(i, 1); }
    else TL.pool.push(card.id);
    markPoolManual();
    renderPool();   // re-marca el buscador vía markSearchInPool()
  }

  // Helpers de lote por ID (mutan el pool SIN re-render; el caller renderiza una vez).
  function addCardById(card) { if (!TL.pool.includes(card.id)) TL.pool.push(card.id); }
  function removeCardById(card) { const i = TL.pool.indexOf(card.id); if (i >= 0) TL.pool.splice(i, 1); }
  function selectRange(a, b) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let k = lo; k <= hi; k++) if (currentShown[k]) addCardById(currentShown[k]);
    markPoolManual();
    renderPool();
  }
  function selectAllResults() { currentShown.forEach(addCardById); markPoolManual(); renderPool(); }
  function deselectAllResults() { currentShown.forEach(removeCardById); markPoolManual(); renderPool(); }
  function allShownSelected() {
    return currentShown.length > 0 && currentShown.every(c => TL.pool.includes(c.id));
  }

  // Etiquetas con contador (pestaña «Mi selección (N)» y botón CTA).
  function updatePoolTabLabel() {
    const btn = document.getElementById('tl-subtab-pool');
    if (btn) btn.textContent = T('tierlist.tab.pool') + (TL.pool.length ? ' (' + TL.pool.length + ')' : '');
  }
  function updateSelectionButton() {
    const btn = document.getElementById('tls-done');
    if (!btn) return;
    btn.textContent = T('tierlist.finishSelection') + (TL.pool.length ? ' (' + TL.pool.length + ')' : '');
    btn.classList.toggle('is-cta', TL.pool.length >= 2);   // verde solo con ≥2 cartas
  }
  // Botón único Seleccionar/Deseleccionar todo, según los resultados actuales.
  function updateSelectToggle() {
    const btn = document.getElementById('tls-select-toggle');
    if (!btn) return;
    const all = allShownSelected();
    btn.textContent = all ? T('tierlist.deselectAll') : T('tierlist.selectAll');
    btn.dataset.mode = all ? 'deselect' : 'select';
  }

  // Marca "ya en la selección" por ID (sin re-renderizar) + actualiza etiquetas/toggle.
  function markSearchInPool() {
    updatePoolTabLabel();
    updateSelectionButton();
    updateSelectToggle();
    const host = document.getElementById('tls-results');
    if (!host) return;
    const ids = new Set(TL.pool);
    host.querySelectorAll('.tls-card').forEach(cell => {
      cell.classList.toggle('in', ids.has(cell.dataset.id));
    });
  }

  function runSearch() {
    const host = document.getElementById('tls-results');
    if (!host) return;
    const all = sortResults(searchMatches());
    const shown = all.slice(0, SEARCH_CAP);
    currentShown = shown;
    lastClickIdx = null;
    updateSelectToggle();
    const ids = new Set(TL.pool);
    const cnt = document.getElementById('tls-count');
    if (cnt) cnt.textContent = all.length > SEARCH_CAP
      ? T('tierlist.resultsCapped', { shown: SEARCH_CAP, total: all.length })
      : T('tierlist.resultsCount', { n: all.length });
    if (typeof tlsUpdateFilterBadge === 'function') tlsUpdateFilterBadge();
    const fsApply = document.getElementById('tls-fs-apply');
    if (fsApply) fsApply.textContent = T('cards.seeResults') + ' (' + Math.min(all.length, SEARCH_CAP) + ')';
    host.innerHTML = '';
    if (!shown.length) {
      const e = document.createElement('div'); e.className = 'tl-pane-hint'; e.textContent = T('tierlist.searchEmpty');
      host.appendChild(e);
      return;
    }
    const grid = document.createElement('div');
    grid.className = 'tls-grid';
    shown.forEach((card, i) => {
      const cell = document.createElement('div');
      cell.className = 'tls-card' + (ids.has(card.id) ? ' in' : '');
      cell.dataset.id = card.id;
      const img = document.createElement('img');
      img.src = window.cardImage ? window.cardImage(card) : card.image;
      img.alt = ''; img.draggable = false; img.loading = 'lazy';
      cell.appendChild(img);
      const badge = document.createElement('div');
      badge.className = 'tls-badge';
      badge.innerHTML = '<span class="tls-plus">+</span><span class="tls-tick">✓</span>';
      cell.appendChild(badge);
      const ring = document.createElement('div'); ring.className = 'cv-lp-ring'; cell.appendChild(ring);
      const TOUCH = !!(window.pbIsTouchMobile && window.pbIsTouchMobile());
      cell.addEventListener('click', e => {
        if (cell._suppressClick) { cell._suppressClick = false; return; }
        if (TOUCH) { openZoom(card, cell); return; }   // táctil: tocar = zoom (añadir = mantener)
        if (e.shiftKey && lastClickIdx !== null) selectRange(lastClickIdx, i);
        else { toggleSearchCard(card, false); lastClickIdx = i; }
      });
      cell.addEventListener('contextmenu', e => { e.preventDefault(); toggleSearchCard(card, true); lastClickIdx = i; });
      // Táctil: pulsación larga = añadir a la selección (anillo + vibración, como en Cartas)
      cell.addEventListener('pointerdown', e => tlsLpStart(cell, card, e));
      cell.addEventListener('pointermove', tlsLpMove);
      cell.addEventListener('pointerup', () => tlsLpUp(cell));
      cell.addEventListener('pointercancel', tlsLpEnd);
      grid.appendChild(cell);
    });
    host.appendChild(grid);
  }

  // ── Sub-pestañas (Búsqueda / Pool / Mis tierlists) ──────────────
  function activateSubtab(pane) {
    document.querySelectorAll('#tl-subtabs .tl-subtab').forEach(t =>
      t.classList.toggle('active', t.dataset.pane === pane));
    document.querySelectorAll('#tl-panes .tl-pane').forEach(p =>
      p.classList.toggle('active', p.id === 'tl-pane-' + pane));
    // La tierlist se queda fija arriba (sticky + colapso) SOLO en «Mi selección».
    const view = document.getElementById('view-tierlist');
    if (view) view.classList.toggle('tl-pool-mode', pane === 'pool');
    if (pane !== 'pool') {
      const card = document.getElementById('tl-card');
      if (card) card.style.setProperty('--tl-scale', '1');
    }
    if (pane === 'library') renderLibrary();
  }
  function wireSubtabs() {
    document.querySelectorAll('#tl-subtabs .tl-subtab').forEach(tab => {
      tab.addEventListener('click', () => {
        activateSubtab(tab.dataset.pane);
        if (window.playSound) try { window.playSound('tab'); } catch (e) {}
      });
    });
  }

  // ════════════════════════════════════════════════════════════════
  //  TANDA 4 — Guardar (biblioteca «Mis tierlists») + compartir por URL
  //  TANDA 5 — Exportar a PNG
  // ════════════════════════════════════════════════════════════════
  const TL_LIB_KEY = 'pocketboard_tierlists_v1';
  function loadTierLib() { try { return JSON.parse(localStorage.getItem(TL_LIB_KEY)) || []; } catch (e) { return []; } }
  function saveTierLib(lib) { try { localStorage.setItem(TL_LIB_KEY, JSON.stringify(lib)); } catch (e) {} }
  function uiLoc() { const l = window.i18n && window.i18n.getLang && window.i18n.getLang(); return { es: 'es-ES', en: 'en-US', ja: 'ja-JP', it: 'it-IT', fr: 'fr-FR', pt: 'pt-BR', ko: 'ko-KR' }[l] || undefined; }
  function tierCount() { return TL.rows.reduce((n, r) => n + r.cards.length, 0); }
  // Color de un tier por su posición entre filas NORMALES (la especial S+ no consume color).
  function rowColorByPos(rows, i) { if (rows[i] && rows[i].special) return null; let n = 0; for (let k = 0; k < i; k++) if (!(rows[k] && rows[k].special)) n++; return TIER_COLORS[n] || '#9097a0'; }

  // Serializar / restaurar el estado completo (filas + selección + título)
  function buildTierPayload() {
    return {
      title: TL.title || '',
      rows: TL.rows.map(r => ({ label: r.label, special: !!r.special, cards: r.cards.slice() })),
      pool: TL.pool.slice(),
    };
  }
  function applyTierState(state) {
    if (!state) return;
    TL.title = state.title || '';
    const rows = (state.rows && state.rows.length) ? state.rows : DEFAULT_LABELS.slice(0, 6).map(l => ({ label: l }));
    TL.rows = rows.map(r => ({ label: r.label || '', special: !!r.special, cards: (r.cards || []).slice() }));
    TL.pool = (state.pool || []).slice();
    TL.activeSuggestion = null;
    const tEl = document.getElementById('tl-title'); if (tEl) tEl.value = TL.title;
    renderRows(); renderPool(); renderPills();
  }

  // ── Guardar en «Mis tierlists» ──────────────────────────────────
  async function saveTierlist() {
    if (!tierCount()) { if (window.pbToast) window.pbToast(T('tierlist.nothingToSave')); return; }
    let name = (TL.title || '').trim();
    if (!name && window.pbPrompt) {
      name = await window.pbPrompt({ title: T('tierlist.namePrompt'), placeholder: T('tierlist.titlePlaceholder'), okLabel: T('common.save') });
      if (name == null) return;
    }
    name = (name || T('tierlist.titlePlaceholder')).trim();
    TL.title = name;
    const tEl = document.getElementById('tl-title'); if (tEl) tEl.value = name;
    const lib = loadTierLib();
    lib.unshift(Object.assign({ id: Date.now(), savedAt: Date.now() }, buildTierPayload()));
    saveTierLib(lib);
    renderLibrary();
    if (window.pbToast) window.pbToast(T('tierlist.savedToast', { name: name }));
    if (window.playSound) try { window.playSound('notification'); } catch (e) {}
  }

  // ── Biblioteca: render + acciones ───────────────────────────────
  function mkLibBtn(label, fn, danger) {
    const b = document.createElement('button'); b.type = 'button';
    b.className = 'tl-lib-btn' + (danger ? ' danger' : ''); b.textContent = label;
    b.addEventListener('click', fn); return b;
  }
  function renderLibrary() {
    const pane = document.getElementById('tl-pane-library');
    if (!pane) return;
    const lib = loadTierLib();
    pane.innerHTML = '';
    if (!lib.length) {
      const hint = document.createElement('div'); hint.className = 'tl-pane-hint';
      hint.textContent = T('tierlist.libEmpty'); pane.appendChild(hint); return;
    }
    const list = document.createElement('div'); list.className = 'tl-lib-list';
    lib.forEach(entry => {
      const item = document.createElement('div'); item.className = 'tl-lib-item';
      const strip = document.createElement('div'); strip.className = 'tl-lib-strip';
      (entry.rows || []).forEach((r, i) => {
        if (!(r.cards && r.cards.length)) return;
        const seg = document.createElement('span'); seg.className = 'tl-lib-seg' + (r.special ? ' splus' : '');
        const col = rowColorByPos(entry.rows, i); if (col) seg.style.background = col;
        strip.appendChild(seg);
      });
      const info = document.createElement('div'); info.className = 'tl-lib-info';
      const nm = document.createElement('div'); nm.className = 'tl-lib-name'; nm.textContent = entry.title || T('tierlist.titlePlaceholder');
      const meta = document.createElement('div'); meta.className = 'tl-lib-meta';
      const total = (entry.rows || []).reduce((n, r) => n + (r.cards ? r.cards.length : 0), 0);
      let dt = ''; try { dt = new Date(entry.savedAt).toLocaleDateString(uiLoc()); } catch (e) {}
      meta.textContent = T('tierlist.poolCount', { n: total }) + (dt ? ' · ' + dt : '');
      info.appendChild(nm); info.appendChild(meta);
      const acts = document.createElement('div'); acts.className = 'tl-lib-acts';
      acts.appendChild(mkLibBtn(T('common.load'), () => loadFromLib(entry.id)));
      acts.appendChild(mkLibBtn(T('tierlist.duplicate'), () => duplicateLib(entry.id)));
      acts.appendChild(mkLibBtn(T('common.delete'), () => deleteLib(entry.id), true));
      item.appendChild(strip); item.appendChild(info); item.appendChild(acts);
      list.appendChild(item);
    });
    pane.appendChild(list);
  }
  function loadFromLib(id) {
    const entry = loadTierLib().find(e => e.id === id);
    if (!entry) return;
    applyTierState(entry);
    activateSubtab('pool');
    if (window.pbToast) window.pbToast(T('tierlist.loadedToast', { name: entry.title || T('tierlist.titlePlaceholder') }));
  }
  async function deleteLib(id) {
    const ok = window.pbConfirm ? await window.pbConfirm({ title: T('tierlist.deleteConfirm'), okLabel: T('common.delete'), cancelLabel: T('common.cancel'), danger: true }) : true;
    if (!ok) return;
    saveTierLib(loadTierLib().filter(e => e.id !== id));
    renderLibrary();
  }
  function duplicateLib(id) {
    const lib = loadTierLib(); const e = lib.find(x => x.id === id); if (!e) return;
    const copy = JSON.parse(JSON.stringify(e));
    copy.id = Date.now(); copy.savedAt = Date.now();
    copy.title = (e.title || T('tierlist.titlePlaceholder')) + ' ' + T('tierlist.copySuffix');
    lib.unshift(copy); saveTierLib(lib); renderLibrary();
  }

  // ── Compartir por URL (#tier=) — solo el RANKING, no la selección ──
  function encodeTierShare() {
    const payload = { v: 1, t: (TL.title || '').slice(0, 60), r: TL.rows.map(r => ({ n: r.label || '', s: r.special ? 1 : 0, c: r.cards.slice() })) };
    return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeTierShare(code) {
    try {
      let b = String(code || '').replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '=';
      const o = JSON.parse(decodeURIComponent(escape(atob(b))));
      if (!o || o.v !== 1 || !Array.isArray(o.r)) return null;
      return o;
    } catch (e) { return null; }
  }
  async function shareTierlist() {
    if (!tierCount()) { if (window.pbToast) window.pbToast(T('tierlist.nothingToShare')); return; }
    const link = location.href.split('#')[0] + '#tier=' + encodeTierShare();
    if (link.length > 8000) {            // URL demasiado larga → sugerir guardar
      const ok = window.pbConfirm ? await window.pbConfirm({ title: T('tierlist.shareLongTitle'), message: T('tierlist.shareLongMsg'), okLabel: T('common.save'), cancelLabel: T('common.cancel') }) : false;
      if (ok) saveTierlist();
      return;
    }
    if (window.pbCopyText) window.pbCopyText(link).then(() => { if (window.pbToast) window.pbToast(T('tierlist.shareCopied')); });
  }
  function checkSharedTierURL() {
    const m = (location.hash || '').match(/tier=([A-Za-z0-9_-]+)/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const data = decodeTierShare(m[1]);
    if (!data) { if (window.pbToast) window.pbToast(T('tierlist.invalidLink')); return; }
    const rows = (data.r || []).map(r => ({
      label: r.n || '', special: !!r.s,
      cards: (r.c || []).filter(id => isDeckItem(id) ? !!deckById(id.slice(5)) : !!lookupCard(id)),
    }));
    const total = rows.reduce((n, r) => n + r.cards.length, 0);
    if (!total) { if (window.pbToast) window.pbToast(T('tierlist.linkEmpty')); return; }
    const name = (data.t || '').trim() || T('tierlist.titlePlaceholder');
    const go = ok => {
      if (!ok) return;
      if (window.switchAppTab) window.switchAppTab('tierlist');
      if (window._tlInit) window._tlInit();
      applyTierState({ title: name, rows: rows, pool: [] });
      activateSubtab('pool');
    };
    if (window.pbConfirm) window.pbConfirm({ title: T('tierlist.importTitle'), message: T('tierlist.importMsg', { name: name, n: total }), okLabel: T('tierlist.importBtn'), cancelLabel: T('common.cancel') }).then(go);
    else go(true);
  }

  // ── Export PNG ──────────────────────────────────────────────────
  // Descarga directa (sin diálogo): 1920×1080 por defecto; si hay muchas filas y no
  // cabe, la altura crece proporcional (no se aplasta). Título solo si lo puso. Marca
  // de agua siempre.
  function exportTierImage() {
    if (!tierCount()) { if (window.pbToast) window.pbToast(T('tierlist.nothingToExport')); return; }
    renderTierPNG({ showTitle: !!(TL.title && TL.title.trim()), size: 'auto' });
  }
  function openTierExportOptions() {
    let showTitle = !!(TL.title && TL.title.trim());
    let size = 'proportional';   // 'fit' (16:9) | 'proportional'
    const overlay = document.createElement('div'); overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div'); box.className = 'pb-modal mz-dlimg-modal';
    const title = document.createElement('div'); title.className = 'pb-modal-title'; title.textContent = T('tierlist.exportTitle');
    const prevWrap = document.createElement('div'); prevWrap.className = 'mz-dlimg-preview';
    const prevCanvas = document.createElement('canvas'); prevWrap.appendChild(prevCanvas);
    const dims = document.createElement('div'); dims.className = 'mz-dlimg-dims';
    let tok = 0;
    async function refresh(){ const my = ++tok; await drawTierImageToCanvas(prevCanvas, { showTitle: showTitle, size: size }); if (my === tok) dims.textContent = prevCanvas.width + ' × ' + prevCanvas.height; }
    function seg(options, getter, setter){
      const grp = document.createElement('div'); grp.className = 'cv-chip-group';
      options.forEach(o => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cv-chip' + (getter() === o.id ? ' active' : ''); b.textContent = o.label;
        b.onclick = () => { setter(o.id); grp.querySelectorAll('.cv-chip').forEach(x => x.classList.remove('active')); b.classList.add('active'); refresh(); };
        grp.appendChild(b); });
      return grp;
    }
    const controls = document.createElement('div'); controls.className = 'mz-dlimg-controls';
    controls.appendChild(seg([{ id: true, label: T('tierlist.titleWith') }, { id: false, label: T('tierlist.titleWithout') }], () => showTitle, v => showTitle = v));
    controls.appendChild(seg([{ id: 'fit', label: T('tierlist.sizeFit') }, { id: 'proportional', label: T('tierlist.sizeProp') }], () => size, v => size = v));
    const actions = document.createElement('div'); actions.className = 'pb-modal-actions';
    const cancel = document.createElement('button'); cancel.className = 'pb-btn'; cancel.textContent = T('common.cancel');
    const ok = document.createElement('button'); ok.className = 'pb-btn pb-btn-primary'; ok.textContent = T('mazos.download');
    const close = () => { overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 200); };
    cancel.onclick = close;
    ok.onclick = () => { close(); renderTierPNG({ showTitle: showTitle, size: size }); };
    box.appendChild(title); box.appendChild(prevWrap); box.appendChild(dims); box.appendChild(controls);
    actions.appendChild(cancel); actions.appendChild(ok); box.appendChild(actions);
    overlay.appendChild(box); document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    requestAnimationFrame(() => { overlay.classList.add('open'); refresh(); });
  }

  // Igual que el export de mazos: se prueban TODAS las URLs de la carta (idioma actual →
  // inglesa canónica → copia de R2 en cualquier idioma) y cada remota se reintenta con
  // cache-buster, porque una entrada del CDN cacheada sin cabecera CORS deja la carta
  // en gris. Ver window.cardImageCandidates en shared.js.
  function tlTry(url) {
    return new Promise(resolve => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = url;
    });
  }
  async function tlLoadImage(src, card) {
    const cands = (card && window.cardImageCandidates) ? window.cardImageCandidates(card) : [];
    if (src && cands.indexOf(src) < 0) cands.unshift(src);
    for (const u of cands) {
      let im = await tlTry(u);
      if (!im && /^https?:/i.test(u)) im = await tlTry(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'cors=1');
      if (im) return im;
    }
    throw new Error('img load failed: ' + src);
  }
  function cardOf(id) { return (id && window.dbLookup) ? window.dbLookup({ id: id }) : null; }
  function artOf(id) { const c = cardOf(id); return c ? (window.cardImage ? window.cardImage(c) : c.image) : ''; }

  // Ajuste del nombre de tier en canvas SIN partir palabras (misma lógica que la web):
  // busca el mayor tamaño con el que las palabras quepan en `maxW` envolviendo en varias
  // líneas y el bloque quepa en `maxH`. Devuelve {fs, lines, lh}.
  function wrapLabelLines(cc, text, maxW, maxH, fam) {
    text = (text || '').trim();
    const words = text.split(/\s+/).filter(Boolean);
    if (!words.length) return { fs: 30, lines: [''], lh: 32 };
    const layout = () => {
      const lines = []; let cur = '';
      for (const w of words) {
        if (cc.measureText(w).width > maxW) return null;   // una palabra no cabe ni sola
        const test = cur ? cur + ' ' + w : w;
        if (cc.measureText(test).width <= maxW) cur = test;
        else { lines.push(cur); cur = w; }
      }
      if (cur) lines.push(cur);
      return lines;
    };
    for (let fs = 46; fs >= 15; fs -= 1) {
      cc.font = '800 ' + fs + 'px ' + fam;
      const lines = layout();
      if (!lines) continue;
      const lh = fs * 1.08;
      if (lines.length * lh <= maxH) return { fs, lines, lh };
    }
    // Fallback: tamaño mínimo, una sola línea recortada.
    cc.font = '800 15px ' + fam;
    return { fs: 15, lines: [text], lh: 16 };
  }

  // Dibuja la tierlist en `canvas` con el fondo + marca de agua branded (mismo look que la imagen de mazo).
  // opts: { showTitle:bool, size:'fit'(16:9 fijo)|'proportional'(alto variable) }
  async function drawTierImageToCanvas(canvas, opts) {
    const RATIO = 1.397;
    // Márgenes mínimos como en la web: GAP entre cartas casi nulo, poco padding en la
    // tier, filas casi pegadas. Esquinas de carta sin redondear (CARD_RAD=0).
    const W = 1920, MARGIN = 48, LBL_W = 156, GAP = 2, PAD = 7, ROW_GAP = 6, CW = 128, CH = Math.round(CW * RATIO), RAD = 12, CARD_RAD = 0;
    const ROW_W = W - MARGIN * 2;
    const FAM = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const areaW = W - MARGIN * 2 - LBL_W;
    const perRow = Math.max(1, Math.floor((areaW + GAP) / (CW + GAP)));
    const rowsGeo = TL.rows.map(r => { const lines = Math.max(1, Math.ceil((r.cards.length || 0) / perRow)); return { row: r, lines: lines, h: lines * CH + (lines - 1) * GAP + PAD * 2 }; });
    const titleH = (opts.showTitle && (TL.title || '').trim()) ? 96 : 0;
    const naturalH = MARGIN * 2 + titleH + rowsGeo.reduce((s, g) => s + g.h, 0) + (rowsGeo.length - 1) * ROW_GAP;
    // Contenido en offscreen transparente → se compone sobre el fondo branded
    const content = document.createElement('canvas'); content.width = W; content.height = naturalH;
    const cc = content.getContext('2d');
    let corsBlocked = false;
    if (titleH) {
      cc.fillStyle = 'rgba(255,255,255,0.96)';
      cc.font = '740 46px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      cc.textAlign = 'center'; cc.textBaseline = 'middle';
      cc.fillText((TL.title || '').slice(0, 60), W / 2, MARGIN + titleH / 2);
    }
    let y = MARGIN + titleH;
    for (const geo of rowsGeo) {
      const r = geo.row, rowH = geo.h, x0 = MARGIN;
      // 1) Recuadro de la TIER (espacio definido, no solo la etiqueta) — cristal oscuro
      //    translúcido con borde sutil, sobre el fondo branded.
      cc.save();
      cc.beginPath(); cc.roundRect(x0, y, ROW_W, rowH, RAD);
      cc.fillStyle = 'rgba(18,18,28,0.46)'; cc.fill();
      cc.lineWidth = 1.5; cc.strokeStyle = 'rgba(255,255,255,0.09)'; cc.stroke();
      cc.restore();
      // 2) Bloque de etiqueta (color del tier), con las esquinas IZQUIERDAS redondeadas
      //    (encaja en el recuadro) y las derechas rectas (linda con las cartas).
      cc.save();
      cc.beginPath(); cc.roundRect(x0, y, LBL_W, rowH, [RAD, 0, 0, RAD]); cc.clip();
      if (r.special) { const lg = cc.createLinearGradient(x0, y, x0 + LBL_W, y); ['#9d6b86', '#9d8a6b', '#8f9d6b', '#6b9d7e', '#6b8a9d', '#7e6b9d'].forEach((c, i, a) => lg.addColorStop(i / (a.length - 1), c)); cc.fillStyle = lg; }
      else { cc.fillStyle = rowColorByPos(TL.rows, TL.rows.indexOf(r)) || '#9097a0'; }
      cc.fillRect(x0, y, LBL_W, rowH);
      cc.fillStyle = 'rgba(255,255,255,0.10)'; cc.fillRect(x0, y, LBL_W, rowH * 0.42);
      // Texto de la etiqueta: MISMA lógica que la web (nunca parte palabras; se ajusta
      // por palabras en varias líneas y encoge para caber). Clip a la caja de la etiqueta.
      const wrapped = wrapLabelLines(cc, (r.label || '').slice(0, LABEL_MAX), LBL_W - 20, rowH - 16, FAM);
      cc.fillStyle = '#fff';
      cc.textAlign = 'center'; cc.textBaseline = 'middle';
      cc.shadowColor = 'rgba(0,0,0,0.5)'; cc.shadowBlur = 4; cc.shadowOffsetY = 1;
      const total = wrapped.lines.length * wrapped.lh, cy0 = y + rowH / 2 - total / 2 + wrapped.lh / 2;
      wrapped.lines.forEach((ln, li) => cc.fillText(ln, x0 + LBL_W / 2, cy0 + li * wrapped.lh));
      cc.restore();
      cc.shadowColor = 'transparent'; cc.shadowBlur = 0; cc.shadowOffsetY = 0;
      // 3) Cartas (esquinas rectas, gap mínimo).
      let cx = x0 + LBL_W + PAD, cy = y + PAD, col = 0;
      for (const id of r.cards) {
        if (col >= perRow) { col = 0; cx = x0 + LBL_W + PAD; cy += CH + GAP; }
        cc.fillStyle = '#1a1a26'; cc.fillRect(cx, cy, CW, CH);
        try {
          if (isDeckItem(id)) { const d = deckById(id.slice(5)); if (d) corsBlocked = !(await drawDeckCoverPNG(cc, d, cx, cy, CW, CH, Math.round(CW * 0.045))) || corsBlocked; }
          else { const im = await tlLoadImage(artOf(id), cardOf(id)); cc.save(); cc.beginPath(); cc.rect(cx, cy, CW, CH); cc.clip(); cc.drawImage(im, cx, cy, CW, CH); cc.restore(); }
        } catch (e) { corsBlocked = true; }
        cx += CW + GAP; col++;
      }
      y += rowH + ROW_GAP;
    }
    // Compose con fondo + marca branded (símbolos de las 8 energías)
    const octx = canvas.getContext('2d');
    const ICONS = ['R', 'W', 'G', 'L', 'P', 'F', 'D', 'M'];
    // 'auto' (por defecto): 1920×1080 si cabe; si hay muchas filas, altura proporcional.
    const useFit = opts.size === 'fit' || (opts.size !== 'proportional' && naturalH <= 1080);
    if (useFit) {
      canvas.width = 1920; canvas.height = 1080;
      if (window.tcgBrandBg) await window.tcgBrandBg(octx, 1920, 1080, ICONS); else { octx.fillStyle = '#0d0d0d'; octx.fillRect(0, 0, 1920, 1080); }
      const scale = Math.min(1920 / W, 1080 / naturalH);
      const dw = W * scale, dh = naturalH * scale, dx = (1920 - dw) / 2, dy = (1080 - dh) / 2;
      octx.drawImage(content, dx, dy, dw, dh);
      if (window.tcgBrandWatermark) window.tcgBrandWatermark(octx, 1920, 1080);
    } else {
      canvas.width = W; canvas.height = naturalH;
      if (window.tcgBrandBg) await window.tcgBrandBg(octx, W, naturalH, ICONS); else { octx.fillStyle = '#0d0d0d'; octx.fillRect(0, 0, W, naturalH); }
      octx.drawImage(content, 0, 0);
      if (window.tcgBrandWatermark) window.tcgBrandWatermark(octx, W, naturalH);
    }
    return { corsBlocked };
  }
  async function renderTierPNG(opts) {
    if (window.pbToast) window.pbToast(T('mazos.generating'));
    const canvas = document.createElement('canvas');
    const { corsBlocked } = await drawTierImageToCanvas(canvas, opts || {});
    if (corsBlocked && window.pbToast) window.pbToast(T('mazos.corsWarn'), 4000);
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      a.download = ((TL.title || 'tierlist').replace(/[^a-z0-9_\- ]/gi, '').trim() || 'tierlist') + '.png';
      a.href = url; a.click();
      if (!corsBlocked && window.pbToast) window.pbToast(T('mazos.imgDownloaded'));
      return url;
    } catch (e) { if (window.pbToast) window.pbToast(T('mazos.dlError'), 3000); return null; }
  }

  // Cover de mazo en canvas: mono = carta completa; dual = 50/50 horizontal (top de cada carta)
  async function drawDeckCoverPNG(ctx, deck, x, y, w, h, rad) {
    const ids = deckProtIds(deck);
    ctx.save(); ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.clip();
    try {
      if (ids.length <= 1) {
        const im = await tlLoadImage(artOf(ids[0]), cardOf(ids[0])); ctx.drawImage(im, x, y, w, h);
      } else {
        const a = await tlLoadImage(artOf(ids[0]), cardOf(ids[0])), b = await tlLoadImage(artOf(ids[1]), cardOf(ids[1]));
        const bandH = h / 2, drawH = w * 1.397;
        // Ambas mitades muestran el TOP de su carta; la silueta de carta la da el clip
        // redondeado del contenedor (rad, aplicado abajo) → esquinas inferiores redondeadas.
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, bandH); ctx.clip(); ctx.drawImage(a, x, y, w, drawH); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(x, y + bandH, w, bandH); ctx.clip(); ctx.drawImage(b, x, y + bandH, w, drawH); ctx.restore();
      }
      ctx.restore(); return true;
    } catch (e) { ctx.restore(); return false; }
  }

  // ════════════════════════════════════════════════════════════════
  //  MÓVIL (Tanda 4·gestos) — táctil de la Tierlist:
  //   · «Mi selección»: mantener 0,5 s + vibración = arrastrar (el swipe rápido
  //     hace scroll, como reordenar apps en la home del móvil); tocar = LEVANTAR
  //     (modo colocar) → tocar un tier la coloca.
  //   · «Añadir cartas»: tocar = zoom; mantener pulsado = añadir a la selección
  //     (mismo gesto/anillo que añadir al mazo en Cartas).
  //   · Buscador con caja + botón «Filtros» → HOJA (igual que Cartas en móvil).
  // ════════════════════════════════════════════════════════════════
  const HOLD_DRAG_MS = 500;     // mantener pulsado (táctil) = arrastrar
  const VIEW_HOLD_MS = 1500;    // mantener QUIETO un mazo hasta 1,5 s = ver el mazo (2º tiempo)
  const TL_LP_MS = 500;         // mantener pulsado (táctil, en el buscador) = añadir
  let _tlLifted = null;         // id de la carta «en la mano» (modo colocar)
  let _tlDragArmed = false;     // arrastre activo (para bloquear el scroll del navegador)
  function tlScroller() { return document.getElementById('view-tierlist'); }

  // Auto-scroll al arrastrar cerca de los bordes (smooth, como pedía Daniel)
  function autoEdgeScroll(clientY) {
    const sc = tlScroller(); if (!sc) return;
    const top = 72, bot = window.innerHeight - 92;
    if (clientY < top) sc.scrollTop -= Math.min(26, (top - clientY) * 0.5);
    else if (clientY > bot) sc.scrollTop += Math.min(26, (clientY - bot) * 0.5);
  }

  // ── Modo «colocar» (tocar una carta la levanta → tocar un tier la coloca) ──
  let _tlLiftedSource = null;   // de dónde se levantó (pool o row N) — para colocar bien
  function liftCard(id, cell, source) {
    if (_tlLifted === id) { clearLift(); return; }       // tocar de nuevo = soltar
    if (window.pbCue) window.pbCue.done('tierlistPlace');  // usó el tap → cue aprendida
    clearLift();
    _tlLifted = id; _tlLiftedSource = source || { kind: 'pool' };
    cell.classList.add('tl-lifted');
    const v = tlScroller(); if (v) { v.classList.add('tl-placing'); v.scrollTo({ top: 0, behavior: 'smooth' }); }
    // Sin texto de «segundo paso»: el resaltado de los tiers ya dice dónde colocar.
    if (window.pbHaptic) window.pbHaptic('light');
  }
  function clearLift() {
    _tlLifted = null; _tlLiftedSource = null;
    document.querySelectorAll('.tl-lifted').forEach(c => c.classList.remove('tl-lifted'));
    const v = tlScroller(); if (v) v.classList.remove('tl-placing');
    hidePlaceHint();
  }
  function placeLiftedIntoRow(rowN) {
    if (_tlLifted == null) return false;
    const id = _tlLifted, src = _tlLiftedSource || { kind: 'pool' };
    clearLift();
    moveCard(id, src, { kind: 'row', row: rowN });   // al final del tier (anima «slam»)
    return true;
  }
  function showPlaceHint() {
    let h = document.getElementById('tl-place-hint');
    if (!h) { h = document.createElement('div'); h.id = 'tl-place-hint'; document.body.appendChild(h); }
    h.textContent = T('tierlist.placeHint');
    h.classList.add('show');
  }
  function hidePlaceHint() { const h = document.getElementById('tl-place-hint'); if (h) h.classList.remove('show'); }

  // ── Gesto unificado de cartas/mazos (selección Y tiers) ──────────
  //  Táctil:  swipe = scroll · mantener 0,5 s = arrastrar (reordenar) · tocar:
  //           carta de selección → levantar · carta de tier → zoom · MAZO → levantar
  //  Mantener sobre un MAZO = ver el mazo completo (no arrastra; se rankea tocando).
  //  En modo «colocar», tocar un tier coloca lo levantado.
  function makeItemGesture(cell, id, source) {
    cell.addEventListener('pointerdown', e => {
      if (e.button != null && e.button !== 0) return;
      if (e.target.closest && e.target.closest('.tl-pool-remove')) return;
      const isDeck = isDeckItem(id);
      const touch = e.pointerType === 'touch';
      const startX = e.clientX, startY = e.clientY;
      const view = tlScroller();
      const canDrag = !!(view && view.classList.contains('tl-pool-mode'));   // mazos también se arrastran
      let dragging = false, zoomed = false, armed = false, scrolled = false, moved = false, ghost = null, target = null;
      let holdTimer2 = null;

      // 1er tiempo: táctil = «coger» (0,5 s, SIN ghost aún) · ratón = zoom/ver (0,25 s).
      // 2º tiempo (SOLO mazos, táctil): si te mantienes QUIETO hasta 1,5 s → ver el mazo.
      const holdTimer = setTimeout(() => {
        if (dragging || scrolled) return;
        if (!touch || !canDrag) { zoomed = true; teardown(); if (isDeck) openDeckView(id); else openZoom(lookupCard(id), cell); return; }
        armPickup();
        if (isDeck) {
          holdTimer2 = setTimeout(() => {
            if (moved) return;                 // si ya empezaste a arrastrar, NO abrir
            cancelArmedDrag();
            if (window.pbHaptic) window.pbHaptic('light');
            openDeckView(id);
          }, VIEW_HOLD_MS - HOLD_DRAG_MS);
        }
      }, touch ? HOLD_DRAG_MS : HOLD_MS);

      // «Coger» (armar): háptico + realce sutil + resaltar destinos, pero SIN ghost.
      // El ghost solo se crea cuando empiezas a moverte (beginDrag) → nada flota si esperas.
      function armPickup() {
        armed = true; clearTimeout(holdTimer);
        if (window.pbHaptic) window.pbHaptic('light');
        cell.classList.add('tl-armed');
        _tlDragArmed = true;
        if (view) view.classList.add('tl-dragging-active');
        document.querySelectorAll('#tl-rows .tl-row').forEach(r => r.classList.add('tl-drop-active'));
        const pz = document.getElementById('tl-pane-pool'); if (pz) pz.classList.add('tl-drop-active');
        dragSound('cardGrab');
      }
      function beginDrag() {        // primer movimiento tras coger → aparece el ghost
        dragging = true; _pushKey = null;
        cell.classList.remove('tl-armed'); cell.classList.add('tl-dragging');
        ghost = document.createElement('div');
        ghost.className = 'tl-drag-ghost' + (isDeck ? ' tl-drag-ghost-deck' : '');
        const vis = itemVisual(id); if (vis) ghost.appendChild(vis);
        document.body.appendChild(ghost);
        try { ghost.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'forwards' }); } catch (er) {}
      }
      function clearArmState() {
        cell.classList.remove('tl-armed', 'tl-dragging');
        if (view) view.classList.remove('tl-dragging-active');
        cancelPush(); clearDropFeedback(); _tlDragArmed = false;
      }
      function cancelArmedDrag() {     // mazo: 2º tiempo → cancelar la cogida y ver el mazo
        zoomed = true; dragging = false; armed = false;
        if (ghost) { ghost.remove(); ghost = null; }
        clearArmState(); teardown();
      }

      function onMove(ev) {
        if (!dragging) {
          const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
          if (touch) {
            if (armed) { if (dist > DRAG_THRESHOLD) beginDrag(); else return; }   // cogida → al mover, arrastra
            else { if (dist > DRAG_THRESHOLD) { scrolled = true; clearTimeout(holdTimer); } return; }  // moviste antes de coger = scroll
          } else {
            if (!canDrag) return;
            if (dist > DRAG_THRESHOLD) { armPickup(); beginDrag(); } else return;   // ratón: arrastrar al mover
          }
        }
        moved = true;   // hubo arrastre real → el 2º tiempo (ver mazo) ya no aplica
        if (ev.cancelable) ev.preventDefault();
        if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
        autoEdgeScroll(ev.clientY);
        document.querySelectorAll('#view-tierlist .tl-drop-over').forEach(el => el.classList.remove('tl-drop-over'));
        const oc = document.getElementById('tl-drop-caret'); if (oc) oc.remove();
        const under = document.elementFromPoint(ev.clientX, ev.clientY);
        target = null;
        const row = under && under.closest && under.closest('#tl-rows .tl-row');
        const pool = under && under.closest && under.closest('#tl-pane-pool');
        if (row) {
          row.classList.add('tl-drop-over');
          const cards = row.querySelector('.tl-row-cards');
          const idx = dropIndexAt(cards, ev.clientX, ev.clientY, cell);
          placeCaret(cards, idx, cell);
          schedulePush(cards, idx, cell, +row.dataset.row);
          target = { kind: 'row', row: +row.dataset.row, index: idx };
        } else if (pool) {
          cancelPush();
          pool.classList.add('tl-drop-over');
          const grid = document.querySelector('#tl-pool-content .tl-pool-grid');
          const idx = grid ? poolDropIndex(grid, ev.clientX, ev.clientY, cell) : null;
          target = { kind: 'pool', index: idx };
        } else cancelPush();
      }

      function onUp() {
        teardown();
        if (dragging) {                          // arrastre real → soltar en el destino
          if (ghost) ghost.remove();
          const t = target; clearArmState();
          if (t) moveCard(id, source, t);
          return;
        }
        if (armed) { clearArmState(); return; }  // cogida y soltada sin mover = nada
        if (zoomed || scrolled) return;
        // tap: en modo «colocar», tocar un tier coloca lo levantado.
        if (_tlLifted != null) {
          const r = cell.closest && cell.closest('#tl-rows .tl-row');
          if (r) { placeLiftedIntoRow(+r.dataset.row); return; }
        }
        if (isDeck) { liftCard(id, cell, source); return; }                 // mazo: tocar = rankear
        if (source.kind === 'pool') { liftCard(id, cell, source); return; } // selección: tocar = levantar
        openZoom(lookupCard(id), cell);                                     // carta en tier: tocar = zoom
      }

      function onCancel() {
        if (dragging || armed) { if (ghost) ghost.remove(); ghost = null; dragging = false; armed = false; clearArmState(); }
        else scrolled = true;   // el navegador empezó a hacer scroll
        teardown();
      }
      function teardown() {
        clearTimeout(holdTimer); clearTimeout(holdTimer2);
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
      }
      document.addEventListener('pointermove', onMove, { passive: false });
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }

  // ── «Añadir cartas»: pulsación larga = añadir a la selección (anillo de Cartas) ──
  let _tlsLpCell = null, _tlsLpT = null, _tlsLpSX = 0, _tlsLpSY = 0, _tlsLpAdded = false;
  function tlsLpEnd() { clearTimeout(_tlsLpT); if (_tlsLpCell) { _tlsLpCell.classList.remove('lp'); _tlsLpCell = null; } }
  function tlsLpStart(cell, card, e) {
    if (e.pointerType !== 'touch') return;
    if (_tlsLpCell) { tlsLpEnd(); return; }   // 2º dedo (pinch) → cancelar
    _tlsLpCell = cell; _tlsLpSX = e.clientX; _tlsLpSY = e.clientY; _tlsLpAdded = false;
    cell.classList.remove('lp'); void cell.offsetWidth; cell.classList.add('lp');
    _tlsLpT = setTimeout(() => {
      toggleSearchCard(card, true);   // solo añadir
      _tlsLpAdded = true;
      if (window.pbHaptic) window.pbHaptic('light');
      tlsCardPulse(cell);
      tlsLpEnd();
    }, TL_LP_MS);
  }
  function tlsLpMove(e) { if (_tlsLpCell && (Math.abs(e.clientX - _tlsLpSX) > 10 || Math.abs(e.clientY - _tlsLpSY) > 10)) tlsLpEnd(); }
  function tlsLpUp(cell) { if (_tlsLpAdded) cell._suppressClick = true; tlsLpEnd(); }
  function tlsCardPulse(el) { if (!el) return; el.classList.remove('cv-add-ok'); void el.offsetWidth; el.classList.add('cv-add-ok'); setTimeout(() => el.classList.remove('cv-add-ok'), 520); }

  // ── Hoja de filtros del buscador (mismo patrón que Cartas en móvil) ──
  const _tlMq = window.matchMedia('(max-width: 720px)');
  function tlIsMobile() { return _tlMq.matches; }
  let _tlsMoved = [];
  function tlsFilterNodes() {
    const bar = document.getElementById('tls-bar'); if (!bar) return [];
    const nodes = [];
    ['tls-set', 'tls-sort-wrap', 'tls-type', 'tls-el', 'tls-stage', 'tls-rar'].forEach(id => { const n = document.getElementById(id); if (n) nodes.push(n); });
    bar.querySelectorAll('.cv-chip-group:not([id])').forEach(n => nodes.push(n));   // grupo EX/Mega/Habilidad
    const bulk = document.getElementById('tls-select-toggle'); if (bulk) nodes.push(bulk);
    return nodes;
  }
  function tlsBuildSheet() {
    if (document.getElementById('tls-filter-sheet')) return;
    const view = document.getElementById('view-tierlist'); if (!view) return;
    const bd = document.createElement('div'); bd.id = 'tls-filter-backdrop'; bd.addEventListener('click', tlsCloseSheet);
    const sheet = document.createElement('div'); sheet.id = 'tls-filter-sheet';
    const head = document.createElement('div'); head.id = 'tls-fs-head';
    const title = document.createElement('span'); title.id = 'tls-fs-title'; title.textContent = T('cards.filters');
    const clr = document.createElement('button'); clr.id = 'tls-fs-clear'; clr.type = 'button'; clr.textContent = T('cards.clearFilters'); clr.addEventListener('click', tlsClearFilters);
    const cls = document.createElement('button'); cls.id = 'tls-fs-close'; cls.type = 'button'; cls.setAttribute('aria-label', 'close'); cls.textContent = '✕'; cls.addEventListener('click', tlsCloseSheet);
    head.appendChild(title); head.appendChild(clr); head.appendChild(cls);
    const body = document.createElement('div'); body.id = 'tls-fs-body';
    const foot = document.createElement('div'); foot.id = 'tls-fs-foot';
    const apply = document.createElement('button'); apply.id = 'tls-fs-apply'; apply.type = 'button'; apply.textContent = T('cards.seeResults'); apply.addEventListener('click', tlsCloseSheet);
    foot.appendChild(apply);
    sheet.appendChild(head); sheet.appendChild(body); sheet.appendChild(foot);
    view.appendChild(bd); view.appendChild(sheet);
  }
  function tlsMoveFiltersToSheet() {
    const body = document.getElementById('tls-fs-body'); if (!body || _tlsMoved.length) return;
    tlsFilterNodes().forEach(node => {
      const ph = document.createComment('tls-anchor');
      node.parentNode.insertBefore(ph, node);
      body.appendChild(node);
      _tlsMoved.push([node, ph]);
    });
  }
  function tlsRestoreFilters() {
    _tlsMoved.forEach(([node, ph]) => { if (ph.parentNode) { ph.parentNode.insertBefore(node, ph); ph.remove(); } });
    _tlsMoved = [];
  }
  function tlsActiveFilterCount() {
    return ST.types.size + ST.els.size + ST.stages.size + ST.rarities.size +
      (ST.ex ? 1 : 0) + (ST.mega ? 1 : 0) + (ST.ability ? 1 : 0) + (ST.set ? 1 : 0);
  }
  function tlsUpdateFilterBadge() {
    const b = document.getElementById('tls-filters-badge'); if (!b) return;
    const n = tlsActiveFilterCount();
    b.textContent = n; b.hidden = n === 0;
  }
  function tlsClearFilters() {
    ST.types.clear(); ST.els.clear(); ST.stages.clear(); ST.rarities.clear();
    ST.ex = false; ST.mega = false; ST.ability = false; ST.set = '';
    document.querySelectorAll('#tls-type .cv-chip, #tls-el .cv-chip, #tls-stage .cv-chip, #tls-rar .cv-chip, #tls-ex, #tls-mega, #tls-ability').forEach(c => c.classList.remove('active'));
    const ss = document.getElementById('tls-set'); if (ss) ss.value = '';
    runSearch();
  }
  function tlsOpenSheet() {
    const sheet = document.getElementById('tls-filter-sheet'), bd = document.getElementById('tls-filter-backdrop');
    if (sheet) sheet.classList.add('open');
    if (bd) bd.classList.add('open');
  }
  function tlsCloseSheet() {
    const sheet = document.getElementById('tls-filter-sheet'), bd = document.getElementById('tls-filter-backdrop');
    if (sheet) sheet.classList.remove('open');
    if (bd) bd.classList.remove('open');
  }
  // Botón «Filtros» (+ badge) en la barra del buscador — solo móvil (CSS lo muestra)
  function tlsEnsureFiltersBtn() {
    if (document.getElementById('tls-filters-btn')) return;
    const bar = document.getElementById('tls-bar'), q = document.getElementById('tls-q');
    if (!bar || !q) return;
    const btn = document.createElement('button'); btn.id = 'tls-filters-btn'; btn.type = 'button';
    btn.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><path d="M2 4h12M4 8h8M6 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
      '<span>' + T('cards.filters') + '</span><span id="tls-filters-badge" hidden></span>';
    btn.addEventListener('click', tlsOpenSheet);
    q.insertAdjacentElement('afterend', btn);
  }
  // Botones «añadir tier» (arriba/abajo): en móvil NO hay hover → se vuelven
  // estáticos en la cabecera, junto a Guardar/Compartir/etc. (lo pidió Daniel).
  let _tlAddMoved = [];
  function tlMoveAddBtns() {
    const actions = document.getElementById('tl-actions');
    if (!actions || _tlAddMoved.length) return;
    ['tl-add-row-top', 'tl-add-row'].forEach(id => {
      const n = document.getElementById(id); if (!n) return;
      const ph = document.createComment('tl-addbtn');
      n.parentNode.insertBefore(ph, n);
      actions.appendChild(n);
      _tlAddMoved.push([n, ph]);
    });
  }
  function tlRestoreAddBtns() {
    _tlAddMoved.forEach(([n, ph]) => { if (ph.parentNode) { ph.parentNode.insertBefore(n, ph); ph.remove(); } });
    _tlAddMoved = [];
  }
  function tlsApplyResponsive() {
    tlsEnsureFiltersBtn();
    tlsBuildSheet();
    if (tlIsMobile()) { tlsMoveFiltersToSheet(); tlMoveAddBtns(); }
    else { tlsRestoreFilters(); tlsCloseSheet(); tlRestoreAddBtns(); }
    tlsUpdateFilterBadge();
    // Pista del buscador adaptada al gesto (tocar = zoom · mantener = añadir)
    const cue = document.getElementById('tls-cue');
    if (cue) cue.textContent = T(tlIsMobile() ? 'tierlist.searchCueMobile' : 'tierlist.searchCue');
  }

  // ── Init / refresh (lo llama switchAppTab al entrar) ────────────
  window._tlInit = function () {
    if (_inited) return;
    _inited = true;
    window._tlInitialised = true;

    renderRows();
    renderPills();
    renderPool();
    renderLibrary();
    wireSubtabs();
    buildSearchUI();
    runSearch();
    // Pool = pestaña por defecto, VACÍA (con las sugerencias visibles).
    activateSubtab('pool');

    // ── Táctil: bloquear el scroll del navegador SOLO mientras se arrastra ──
    document.addEventListener('touchmove', e => { if (_tlDragArmed && e.cancelable) e.preventDefault(); }, { passive: false });
    // Modo «colocar»: tocar la zona VACÍA de un tier coloca la carta levantada.
    // (Los taps SOBRE una carta de tier los gestiona el propio gesto → sin doble.)
    // Se usa pointerup (no click) para evitar el retardo de 300 ms del táctil.
    const rowsHostPlace = document.getElementById('tl-rows');
    if (rowsHostPlace) rowsHostPlace.addEventListener('pointerup', e => {
      if (_tlLifted == null) return;
      if (e.target.closest && e.target.closest('.tl-tier-card')) return;   // lo coloca el gesto de la carta
      const row = e.target.closest && e.target.closest('#tl-rows .tl-row');
      if (row) placeLiftedIntoRow(+row.dataset.row);
    });
    // Tocar fuera de tiers/selección con una carta levantada = soltarla
    document.addEventListener('pointerup', e => {
      if (_tlLifted == null) return;
      if (e.target.closest && (e.target.closest('#tl-rows .tl-row') || e.target.closest('.tl-pool-card') || e.target.closest('.tl-tier-card'))) return;
      clearLift();
    });
    // Re-aplicar el patrón móvil (caja+Filtros↔hoja) al cruzar el breakpoint
    const onBp = () => { tlsApplyResponsive(); runSearch(); };
    if (_tlMq.addEventListener) _tlMq.addEventListener('change', onBp); else if (_tlMq.addListener) _tlMq.addListener(onBp);

    const addBtn = document.getElementById('tl-add-row');
    if (addBtn) addBtn.addEventListener('click', addRow);
    const addTopBtn = document.getElementById('tl-add-row-top');
    if (addTopBtn) addTopBtn.addEventListener('click', addRowAbove);

    const resetBtn = document.getElementById('tl-reset');
    if (resetBtn) resetBtn.addEventListener('click', resetTierlist);
    const saveBtn = document.getElementById('tl-save');
    if (saveBtn) saveBtn.addEventListener('click', saveTierlist);
    const shareBtn = document.getElementById('tl-share');
    if (shareBtn) shareBtn.addEventListener('click', shareTierlist);
    const exportBtn = document.getElementById('tl-export');
    if (exportBtn) exportBtn.addEventListener('click', exportTierImage);

    // Los ＋ de añadir fila solo asoman al pasar el ratón por la ZONA DE ETIQUETAS
    // (las letras/color), no por la zona de colocar cartas. El de ARRIBA, además,
    // solo asoma sobre la etiqueta de la tier MÁS ALTA (fila 0). Hay una zona muerta
    // entre la etiqueta (dentro de la tarjeta) y el botón (asomando por fuera): se
    // salva con un temporizador de gracia + handlers de entrada/salida en los botones.
    const rowsHost = document.getElementById('tl-rows');
    const viewEl = document.getElementById('view-tierlist');
    if (rowsHost && viewEl) {
      const isTopLabel = lab => lab && lab.closest('.tl-row') && lab.closest('.tl-row').dataset.row === '0';
      let hideTimer = null;
      // En MÓVIL los ＋ viven estáticos en la cabecera (no hay hover) → NO activar el
      // reveal con desplazamiento (movía/bugueaba el botón del header). Solo escritorio.
      const showAdd = top => { if (tlIsMobile()) return; clearTimeout(hideTimer); viewEl.classList.add('tl-labels-hover'); viewEl.classList.toggle('tl-top-hover', !!top); };
      const keepAdd = top => { if (tlIsMobile()) return; clearTimeout(hideTimer); viewEl.classList.add('tl-labels-hover'); if (top) viewEl.classList.add('tl-top-hover'); };
      const hideSoon = () => { clearTimeout(hideTimer); hideTimer = setTimeout(() => viewEl.classList.remove('tl-labels-hover', 'tl-top-hover'), 280); };
      rowsHost.addEventListener('pointerover', e => {
        const lab = e.target.closest && e.target.closest('.tl-row-label');
        if (lab) showAdd(isTopLabel(lab));
      });
      rowsHost.addEventListener('pointerout', e => {
        const lab = e.target.closest && e.target.closest('.tl-row-label');
        if (lab) hideSoon();
      });
      // Mantener visible mientras el ratón está sobre el propio botón (cruza la zona muerta).
      [addBtn, addTopBtn].forEach((b, i) => {
        if (!b) return;
        b.addEventListener('pointerenter', () => keepAdd(i === 1));
        b.addEventListener('pointerleave', hideSoon);
      });
    }

    const title = document.getElementById('tl-title');
    if (title) title.addEventListener('input', () => { TL.title = title.value; });

    // Lápiz → enfocar y seleccionar el título para editarlo.
    const pencil = document.getElementById('tl-title-edit');
    if (pencil && title) pencil.addEventListener('click', () => { title.focus(); title.select(); });

    // Reflejo de cristal que sigue al cursor sobre TODA la tarjeta (una pieza).
    const cardEl = document.getElementById('tl-card');
    if (cardEl) {
      cardEl.addEventListener('pointermove', e => {
        const r = cardEl.getBoundingClientRect();
        cardEl.style.setProperty('--mx', (((e.clientX - r.left) / r.width) * 100).toFixed(1) + '%');
        cardEl.style.setProperty('--my', (((e.clientY - r.top) / r.height) * 100).toFixed(1) + '%');
      });
    }

    // Colapso de la tierlist al hacer scroll: encoge y las cartas del pool pasan por
    // detrás (efecto cristal). OPCIONAL (switch); tarde, muy gradual, y SOLO si la
    // tierlist cubre casi toda la página (pool grande).
    syncCollapseSwitch();
    const scroller = document.getElementById('view-tierlist');
    if (scroller && cardEl) {
      const COLLAPSE_START = 140;   // px de scroll antes de EMPEZAR a encoger (algo de zona muerta)
      const COLLAPSE_RANGE = 420;   // px de scroll para llegar al mínimo (gradual)
      const MIN_SCALE = 0.70;       // tamaño final (encoge un poco más que antes)
      let ticking = false;
      scroller.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          // Solo en «Mi selección», con el switch activado, y SOLO si la pool es grande
          // (hay bastante que scrollear → cartas pasando por detrás). Con pool pequeña no encoge.
          const bigPool = (scroller.scrollHeight - scroller.clientHeight) > 300;
          if (_tlCollapseOn && bigPool && scroller.classList.contains('tl-pool-mode')) {
            const f = Math.min(1, Math.max(0, (scroller.scrollTop - COLLAPSE_START) / COLLAPSE_RANGE));
            cardEl.style.setProperty('--tl-scale', (1 - (1 - MIN_SCALE) * f).toFixed(3));   // 1 → 0.70
          } else {
            cardEl.style.setProperty('--tl-scale', '1');
          }
          // El ＋ de añadir fila solo asoma con el scroll arriba del todo.
          scroller.classList.toggle('tl-scrolled', scroller.scrollTop > 1);
          ticking = false;
        });
      }, { passive: true });
    }

    // Re-traducir/re-localizar al cambiar de idioma (texto e imágenes son JS).
    window.addEventListener('langchange', () => { renderPills(); renderRows(); renderPool(); renderLibrary(); buildSearchUI(); runSearch(); });
  };

  window._tlRefresh = function () {
    if (!_inited) window._tlInit();
  };

  // ── API pública: añadir cartas al pool desde la pestaña Cartas ──
  // Añade (no reemplaza) por ID exacto; cada variante es independiente.
  window._tlSendCards = function (cards) {
    const have = new Set(TL.pool);
    let added = 0;
    (cards || []).forEach(c => {
      if (!c || !c.image || have.has(c.id)) return;
      TL.pool.push(c.id);
      have.add(c.id);
      added++;
    });
    markPoolManual();
    renderPool();
    activateSubtab('pool');
    if (window.pbToast) window.pbToast(T('tierlist.addedToPool', { n: added }));
  };

  // ── Hooks de test (headless) ────────────────────────────────────
  window._tlState = () => ({ pool: TL.pool.slice(), rows: TL.rows.map(r => r.label), title: TL.title });
  window._tlRowCards = () => TL.rows.map(r => r.cards.slice());
  window._tlMove = moveCard;     // mover por estado (verificación headless)
  window._tlResolvePill = id => (id === 'metaDecks' ? metaDeckItems() : resolvePill(id).map(c => c.id));
  window._tlApplyPill = applyPill;
  window._tlOpenDeck = openDeckView;
  window._tlCloseDeck = closeDeckView;
  // Tanda 4/5
  window._tlSave = saveTierlist;
  window._tlLib = loadTierLib;
  window._tlClearLib = () => saveTierLib([]);
  window._tlShareCode = encodeTierShare;
  window._tlApplyShare = code => { const d = decodeTierShare(code); if (d) applyTierState({ title: d.t, rows: (d.r || []).map(r => ({ label: r.n, special: !!r.s, cards: r.c || [] })), pool: [] }); return !!d; };
  window._tlApplyState = applyTierState;
  window._tlExportPNG = renderTierPNG;
  window._tlDrawTierImage = drawTierImageToCanvas;   // hook de test (render a canvas)
  window._tlOpenExport = openTierExportOptions;       // hook de test (diálogo con preview)
  // Portada de mazo (mono = carta completa · dual = 50/50). La reusa la pestaña Mazos
  // para las miniaturas de Enfrentamientos (mismo formato que la tierlist).
  window._tlDeckCover = deckCover50;

  // Import al cargar la página desde un link compartido (#tier=...)
  setTimeout(checkSharedTierURL, 650);
})();
