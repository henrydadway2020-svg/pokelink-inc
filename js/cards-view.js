/* ══════════════════════════════════════════════
   CARDS VIEW  (js/cards-view.js)
   Depends on: window.CARDS_DB (set by data/cards.db.js)
   FIX (revisión posterior): el archivo usaba "CARD_DB" (sin la S) en 5 sitios,
   restos de un find&replace mal hecho, mientras data/cards.db.js siempre
   definió "CARDS_DB". Como se leía como `window.CARDS_DB || []`, no lanzaba
   error: simplemente devolvía un array vacío y la vista de Cartas nunca
   tenía datos que mostrar. Corregido a CARDS_DB en todas las apariciones.
══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── i18n ──
  const T = (k, v) => (window.t ? window.t(k, v) : k);

  // ── Uso en el meta ──────────────────────────────────────────────
  // Tasa de juego por carta = suma sobre los mazos meta de (cuota del mazo ×
  // % de listas de ese arquetipo que llevan la carta). Datos: window.META_DECKS
  // (deck.share + deck.cardstats[id] = [inclusión, winrate]). Por IMPRESIÓN exacta:
  // la que registra el meta sale con su %, las reimpresiones/homónimas quedan a 0.
  let _usageMap = null;
  function usageOf(card) {
    if (!card) return 0;
    if (_usageMap === null) {
      const md = window.META_DECKS, decks = md && md.decks;
      if (!Array.isArray(decks)) return 0;   // meta aún no cargado; se reintenta luego
      _usageMap = Object.create(null);
      for (const dk of decks) {
        const share = dk.share || 0, cs = dk.cardstats;
        if (!share || !cs) continue;
        for (const id in cs) {
          const arr = cs[id];
          const incl = (Array.isArray(arr) && arr.length) ? (arr[0] || 0) : 0;
          _usageMap[id] = (_usageMap[id] || 0) + share * incl;
        }
      }
    }
    return _usageMap[card.id] || 0;
  }

  // Re-traduce los chips que se keyean por data-attr (tipo/fase/elemento) usando
  // los helpers de idioma de shared.js, y la etiqueta del orden. Lo estático con
  // data-i18n lo hace i18n.js solo.
  function cvLocalize() {
    if (!window.typeName) return;
    document.querySelectorAll('[data-cv-type]').forEach(c => { c.textContent = window.typeName(c.dataset.cvType); });   // sin acotar a #cv-filters: en móvil el bloque «Avanzados» (con el chip Fósil) se mueve a la hoja
    document.querySelectorAll('#cv-filters [data-cv-stage]').forEach(c => { c.textContent = window.stageLabel(c.dataset.cvStage); });
    document.querySelectorAll('.cv-el-chip').forEach(c => { c.title = window.elName(c.dataset.cvEl); });
    // Desplegable de expansiones: nombre de set por idioma (la opción "" la hace data-i18n)
    document.querySelectorAll('#cv-set option').forEach(o => {
      const s = (o.value || '').split('|')[0]; if (!s) return;
      const nm = window.setName ? window.setName(s) : s;
      o.textContent = nm ? `${nm} (${s})` : s;
    });
    // …y su piel: re-pinta TODOS los pickers montados (Cartas y el constructor de Barajas)
    if (window.pbSetPicker) window.pbSetPicker.refresh();
    const label = document.getElementById('cv-sort-label');
    if (label && window.t && typeof F !== 'undefined' && F.sortBy) {
      const sn = { set: T('cards.sortSet'), type: T('cards.sortType'), rarity: T('cards.sortRarity'), name: T('cards.sortName'), usage: T('cards.sortUsage') };
      label.textContent = (sn[F.sortBy] || F.sortBy) + (F.sortDir === 'asc' ? ' ↑' : ' ↓');
    }
  }
  window.addEventListener('langchange', function () {
    if (!window._cvInitialised) return; // se traducirá al abrir la pestaña
    cvLocalize();
    if (window._cvRefreshAdvUI) window._cvRefreshAdvUI();   // re-traduce el sufijo de modo de los desplegables
    if (window._cvUpdateTextLang) window._cvUpdateTextLang();  // aviso rojo "solo inglés" si idioma ≠ en
    if (window._cvFilter) window._cvFilter();
  });

  // Icono del tipo Dragón solo para el filtro de elemento (no existe energía dragón en TCG Pocket)
  const DRAGON_EL_ICON = 'data:image/png;base64,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';

  window.DRAGON_EL_ICON = DRAGON_EL_ICON;
  // GLIFO del dragón SIN el orbe (alpha = solo el dragón, derivado del icono de arriba):
  // para partículas/efectos donde el disco entero sería una mancha. Se tiñe del color
  // de su orbe (dorado) — igual que el resto de tipos usan el color del suyo.
  const DRAGON_GLYPH_ICON = 'data:image/png;base64,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';
  const DRAGON_ORB_COLOR = '#e6c73c';   // dorado del orbe de dragón
  window.DRAGON_GLYPH_ICON = DRAGON_GLYPH_ICON;
  window.DRAGON_ORB_COLOR = DRAGON_ORB_COLOR;
   // expuesto para reutilizarlo en otras vistas (Mazos) — siempre este icono de dragón subido al proyecto

  // ── Tab switching ──────────────────────────────────────────────
  // Board elements to hide when switching to Cartas view.
  // view-cards es hermano de page-wrap (position:fixed, z-index:9050 cubre el tablero);
  // no ocultamos page-wrap para que el estado del tablero siga vivo debajo.
  const BOARD_IDS = ['zoom-overlay','discard-overlay',
                     'sdt-fan-overlay','card-editor-popover','card-preview',
                     'energy-menu-wrap','dmg-strip'];

  // Resalta la pestaña del par Barajas/Meta según el LADO que muestre la vista de Mazos.
  // Vive fuera de switchAppTab porque también la llama _mazosOpenById (deep-link a un mazo:
  // el lado lo decide el slug, no la pestaña por la que se entró).
  window._pbSyncMazosNav = function () {
    const mine = document.getElementById('app-tab-mazos');
    const meta = document.getElementById('app-tab-meta');
    [mine, meta].forEach(b => { if (b) { b.classList.remove('active'); b.removeAttribute('aria-current'); } });
    const side = window._mazosCurrentSide ? window._mazosCurrentSide() : 'meta';
    const on = (side === 'mine') ? mine : (meta || mine);
    if (on) { on.classList.add('active'); on.setAttribute('aria-current', 'page'); }
  };

  // ══════════════════════════════════════════════════════════════
  // BARRA SUPERIOR (nav). Vivía en js/home-view.js, que se BORRÓ al jubilar el Inicio viejo
  // (2026-08-23) — pero esto no era de Inicio: gobierna el nav en TODAS las secciones.
  // ══════════════════════════════════════════════════════════════
  // Guardián anti-solape: si el bloque derecho (apoyo + idioma + ajustes) toca las pestañas
  // centradas, pone `.nav-tight` (pestañas a solo icono, sin coletilla). Mide el SOLAPE REAL,
  // así que es a prueba de tipografía/zoom/idioma — donde los cortes por píxel fijo fallaban.
  // Sin oscilación: siempre mide con pestañas de TEXTO (quita la clase antes de leer, mismo
  // frame → sin parpadeo). Las media queries de responsive.css cubren el caso base sin
  // depender de esto.
  function fitNav() {
    const nav = document.getElementById('app-nav');
    const tabs = document.getElementById('app-nav-tabs');
    if (!nav || !tabs) return;
    if (getComputedStyle(tabs).display === 'none') { nav.classList.remove('nav-tight'); return; }  // hamburguesa
    nav.classList.remove('nav-tight');                    // medir con pestañas de TEXTO
    const tr = tabs.getBoundingClientRect();
    const kofi = document.getElementById('kofi-support');
    const lang = document.getElementById('lang-select');
    const rc = (kofi && kofi.offsetParent !== null) ? kofi : lang;  // 1er elemento del bloque derecho
    if (!rc) return;
    if (rc.getBoundingClientRect().left < tr.right + 12) nav.classList.add('nav-tight');  // roza/pisa → estrecho
  }
  window._fitNav = fitNav;
  let _fitNavT = null;
  window.addEventListener('resize', () => { clearTimeout(_fitNavT); _fitNavT = setTimeout(fitNav, 90); });
  window.addEventListener('langchange', () => { fitNav(); setTimeout(fitNav, 60); });

  // Botón de apoyo (Ko-fi): SIEMPRE integrado dentro de la barra, a la izquierda del idioma.
  // Antes flotaba suelto arriba-dcha y se solapaba con la barra por debajo de ~1400px (bug
  // reportado). Integrado, la barra es un único bloque que cabe o colapsa a hamburguesa.
  // (El estado «floaty» de la barra murió con el Inicio viejo: era exclusivo de esa vista.)
  window._pbNavSync = function () {
    const k = document.getElementById('kofi-support');
    if (k) {
      const right = document.getElementById('app-nav-right');
      const lang = document.getElementById('lang-select');
      if (right && k.parentNode !== right) right.insertBefore(k, lang);
      k.classList.remove('kofi-floating');
    }
    fitNav();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window._pbNavSync);
  else window._pbNavSync();

  window.switchAppTab = function (tab) {
    // Arranque limpio (marca puesta en el <head> antes del primer pintado): en cuanto el JS
    // toma el control de las vistas, la regla que oculta el tablero sobra — y estorba, porque
    // su `!important` ganaría al display en línea con el que se muestra `#page-wrap`.
    document.documentElement.classList.remove('pb-boot');
    // El Inicio viejo se BORRÓ (2026-08-23): la raíz es el hub «Jugar». Cualquiera que pida
    // 'home' —un enlace antiguo, un marcador, código viejo— acaba en el hub, no en blanco.
    if (tab === 'home') tab = 'jugar';
    // Un draft online ya empezado no puede seguir oculto mientras su reloj continúa. La
    // navegación se convierte en la confirmación de rendición; si se cancela, la vista queda.
    if (tab !== 'draft' && window._draftMpGuardNavigation && window._draftMpGuardNavigation(tab)) return;
    // Una cue es contextual a su vista → al cambiar de pestaña, quítala (aunque sea «pegajosa»).
    if (window.pbCue && window.pbCue.dismissAll) window.pbCue.dismissAll();
    // Si abandonas la edición de un mazo (sales de Cartas), olvida el contexto de edición
    if (tab !== 'cards') { window._cvEditingDeck = null; window._cvEditReturn = false; }
    // ── PvP: navegabilidad en partida (petición de Daniel) ──────────
    // Mid-partida, la pestaña «Jugar» muestra la PARTIDA (tablero), no el hub. Al salir a otra
    // pestaña se SUSPENDE el flujo PvP (búsqueda/VS/fin) — la sesión sigue viva — y al volver
    // a la sección de juego se RESTAURA. Así se pueden revisar Cartas/Mazos sin cerrar la partida.
    if (tab === 'jugar' && window._pvpSyncState && window._pvpSyncState().active) tab = 'board';
    if (tab === 'jugar' || tab === 'board') { if (window._pvpFlowRestore) window._pvpFlowRestore(); }
    else if (window._pvpFlowSuspend) window._pvpFlowSuspend();
    const cards     = document.getElementById('view-cards');
    const mazos     = document.getElementById('view-mazos');
    const draft     = document.getElementById('view-draft');
    const tierlist  = document.getElementById('view-tierlist');
    const jugar     = document.getElementById('view-jugar');
    const btnBoard  = document.getElementById('app-tab-board');
    const btnCards  = document.getElementById('app-tab-cards');
    const btnMazos  = document.getElementById('app-tab-mazos');
    const btnDraft  = document.getElementById('app-tab-draft');
    const btnTier   = document.getElementById('app-tab-tierlist');
    const btnJugar  = document.getElementById('app-tab-jugar');
    const btnMeta   = document.getElementById('app-tab-meta');   // split Barajas/Meta (2026-08-07)
    const btnPerfil = document.getElementById('app-tab-perfil');

    // Helper: remove active class from all nav tabs
    function clearNavActive() {
      [btnBoard, btnCards, btnMazos, btnDraft, btnTier, btnJugar, btnMeta, btnPerfil].forEach(b => { if (b) { b.classList.remove('active'); b.removeAttribute('aria-current'); } });
    }

    // Helper: hide draft view (su estado JS sigue vivo, solo se oculta)
    function hideDraftView() {
      if (draft) draft.style.display = 'none';
    }

    // Helper: hide tierlist view (su estado JS sigue vivo, solo se oculta)
    function hideTierlistView() {
      if (tierlist) tierlist.style.display = 'none';
    }

    // Helper: hide cards view + pill
    function hideCardsView() {
      if (cards) cards.style.cssText = 'display:none';
      const pill = document.getElementById('cv-deck-pill');
      if (pill) { pill.classList.remove('open'); pill.style.display = 'none'; }
    }

    // Helper: restore board overlays that were hidden when entering cards/mazos
    function restoreBoardOverlays() {
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.dataset._hiddenByCards !== undefined) {
          el.style.display = el.dataset._hiddenByCards;
          delete el.dataset._hiddenByCards;
        }
      });
    }

    if (tab === 'cards') {
      // Ocultar mazos + draft + tierlist
      if (mazos) mazos.style.display = 'none';
      // El constructor móvil reutiliza los nodos REALES de Cartas. Antes de enseñar
      // esta pestaña, devolverlos a su raíz para que nunca pueda abrirse vacía.
      if (window.pbCardsSurface) window.pbCardsSurface.restore();
      hideDraftView();
      hideTierlistView();
      // Hide board overlays
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.dataset._hiddenByCards = el.style.display || '';
        if (el) el.style.display = 'none';
      });
      cards.style.cssText = 'display:flex !important; flex-direction:column; position:fixed; top:48px; left:0; right:0; bottom:0; background:#111118; color:#e0e0e0; z-index:9050; overflow:hidden;';
      clearNavActive();
      if (btnCards) { btnCards.classList.add('active'); btnCards.setAttribute('aria-current','page'); }
      if (!window._cvInitialised) initCardsView();
      // El pop-up del mazo SOLO existe si hay una SESIÓN DE EDICIÓN abierta (ver _deckEditing).
      // Sincronía Cartas↔Barajas: si estás EDITando un mazo en Barajas, el pop-up de Cartas usa
      // EL MISMO mazo (_mzEditCards vía _mzPillCtx). Si no, Cartas usa su mazo (deckQueues).
      if (!(window._mazosIsEditing && window._mazosIsEditing())) {
        const _pl = document.getElementById('cv-deck-pill');
        _pillCtx = _pillCtxDefault; if (_pl) _pl.classList.remove('pill-ext');
      }
      _cvSyncDeckUI();
      if (_deckEditing()) _cvMaybeAddCue(_lastResults.length);   // cue «primera vez» de añadir, al ENTRAR en Cartas
    } else if (tab === 'mazos' || tab === 'meta') {
      // La MISMA vista sirve a dos pestañas (split 2026-08-07): 'mazos' = Barajas (Mis Mazos)
      // y 'meta' = Mejores mazos. Desde que se quitó el conmutador (2026-08-12) son dos
      // páginas de verdad: CADA pestaña fuerza su lado, venga de donde venga (nav de
      // escritorio, drawer móvil, hub o ruta directa). Los deep-links /mazos/<slug> los
      // corrige _mazosOpenById justo después, que sabe el lado por el prefijo del slug.
      hideCardsView();
      hideDraftView();
      hideTierlistView();
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset._hiddenByCards = el.style.display || ''; el.style.display = 'none'; }
      });
      if (mazos) mazos.style.display = 'flex';
      if (window._mazosSetSide) window._mazosSetSide(tab === 'meta' ? 'meta' : 'mine');   // antes del render
      clearNavActive();
      window._pbSyncMazosNav();   // resalta por LADO real (lo re-llama _mazosOpenById en los deep-links)
      // Init/refresh mazos view
      if (!window._mazosInitialised) {
        if (window._mazosInit) window._mazosInit();
      } else {
        if (window._mazosRefreshIfOpen) window._mazosRefreshIfOpen();
      }
      if (tab === 'mazos' && window._mazosSyncMobileBuilder)
        requestAnimationFrame(() => window._mazosSyncMobileBuilder());
      // Al volver a Barajas editando (p.ej. desde Cartas), re-sincroniza el pop-up del mazo al scroll.
      if (tab === 'mazos' && window._mazosSyncPill) requestAnimationFrame(() => window._mazosSyncPill());
    } else if (tab === 'draft') {
      // Ocultar cards + mazos + tierlist + overlays del tablero
      hideCardsView();
      if (mazos) mazos.style.display = 'none';
      hideTierlistView();
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset._hiddenByCards = el.style.display || ''; el.style.display = 'none'; }
      });
      if (draft) draft.style.display = 'flex';
      clearNavActive();
      // Draft es ahora un modo del hub «Jugar» → se resalta «Jugar» (T3).
      if (btnJugar) { btnJugar.classList.add('active'); btnJugar.setAttribute('aria-current','page'); }
      if (!window._draftInitialised && window._draftInit) window._draftInit();
      else if (window._draftReveal) window._draftReveal(); // sobre nuevo al reentrar
    } else if (tab === 'tierlist') {
      // Ocultar cards + mazos + draft + overlays del tablero
      hideCardsView();
      if (mazos) mazos.style.display = 'none';
      hideDraftView();
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset._hiddenByCards = el.style.display || ''; el.style.display = 'none'; }
      });
      if (tierlist) tierlist.style.display = 'flex';
      clearNavActive();
      if (btnTier) { btnTier.classList.add('active'); btnTier.setAttribute('aria-current','page'); }
      if (!window._tlInitialised && window._tlInit) window._tlInit();
      else if (window._tlRefresh) window._tlRefresh();
    } else if (tab === 'jugar') {
      // Hub «Jugar» (Fase 1, aditivo). Oculta el resto de vistas + overlays del tablero.
      hideCardsView();
      if (mazos) mazos.style.display = 'none';
      hideDraftView();
      hideTierlistView();
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset._hiddenByCards = el.style.display || ''; el.style.display = 'none'; }
      });
      clearNavActive();
      if (btnJugar) { btnJugar.classList.add('active'); btnJugar.setAttribute('aria-current','page'); }
      if (!window._jugarInitialised && window._jugarInit) window._jugarInit();
      else if (window._jugarRefresh) window._jugarRefresh();
    } else if (tab === 'perfil') {
      // Perfil (Maestría Pokémon): pestaña propia en la nav
      hideCardsView();
      if (mazos) mazos.style.display = 'none';
      hideDraftView();
      hideTierlistView();
      BOARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset._hiddenByCards = el.style.display || ''; el.style.display = 'none'; }
      });
      clearNavActive();
      if (btnPerfil) { btnPerfil.classList.add('active'); btnPerfil.setAttribute('aria-current','page'); }
      if (!window._perfilInitialised && window._perfilInit) window._perfilInit();
      else if (window._perfilRefresh) window._perfilRefresh();
    } else {
      // board
      hideCardsView();
      if (mazos) mazos.style.display = 'none';
      hideDraftView();
      hideTierlistView();
      restoreBoardOverlays();
      clearNavActive();
      // El TABLERO es independiente del online: si venimos de una partida online que ya
      // no está en curso, se limpia y vuelve la partida LOCAL (o queda de cero).
      if (window._pbBoardResetAfterOnline) window._pbBoardResetAfterOnline();
      // El tablero es ahora el modo «Tablero libre» del hub «Jugar» → se resalta «Jugar»
      // (T3). El aviso móvil del tablero se retiró por decisión de Daniel.
      if (btnJugar) { btnJugar.classList.add('active'); btnJugar.setAttribute('aria-current','page'); }
    }
    // El tablero (#page-wrap) es una capa fija que las demás vistas cubren con un overlay
    // opaco. Si se queda pintando debajo (glow/pulsos/orbes en sus propias capas GPU), en
    // móvil asoma con flashes + mini-stutter a través del overlay. Lo ocultamos del todo
    // cuando NO estás en el tablero → deja de animar/repintar debajo. Su estado vive en el
    // DOM/JS, así que volver a mostrarlo lo restaura al instante (sin re-init).
    if (jugar) jugar.style.display = (tab === 'jugar') ? 'flex' : 'none';
    const perfilView = document.getElementById('view-perfil');
    if (perfilView) perfilView.style.display = (tab === 'perfil') ? 'flex' : 'none';
    const pageWrap = document.getElementById('page-wrap');
    if (pageWrap) pageWrap.style.display = ['cards','mazos','draft','tierlist','jugar','perfil'].includes(tab) ? 'none' : '';
    // Al VOLVER al tablero, recalcular escala + recolocar el FAB (☰) con el tablero ya
    // visible: cambiar de pestaña no dispara resize, y una medición hecha con #page-wrap
    // oculto (rect a 0) dejaba el FAB perdido tras la nav hasta recargar.
    if (!['cards','mazos','draft','tierlist','jugar','perfil'].includes(tab) && window._setBoardScale) {
      requestAnimationFrame(function () { window._setBoardScale(); });
    }
    // Botones de esquina del tablero (⋯ + Deshacer): se montan con el tablero a la vista y
    // se retiran al salir (miden la banca de J1 → con #page-wrap oculto darían rect 0).
    if (window._pbSyncBoardCorner) requestAnimationFrame(function () { window._pbSyncBoardCorner(); });
    // Barra superior: coloca el botón de apoyo y recalcula el anti-solape.
    if (window._pbNavSync) window._pbNavSync();
    // Pestaña REAL de la sección (jugar/board/draft comparten el resaltado visual de
    // «Jugar», así que el router no puede derivarla del .active) → la fija aquí (T3).
    window._pbCurrentTab = tab;
    // Sincroniza la dirección/historial con la sección actual (js/router.js).
    if (window._pbRouteSync) window._pbRouteSync(tab);
    // SEO: título/descripción de la sección + quita el bloque de prerender al tomar el control.
    if (window._pbApplyRouteMeta) window._pbApplyRouteMeta(tab);
  };

  // ── Constants ──────────────────────────────────────────────────
  const TYPE_ES = {
    pokemon: 'Pokémon', item: 'Objeto', tool: 'Herramienta',
    supporter: 'Partidario', stadium: 'Estadio', fossil: 'Fósil',
  };
  // Constantes compartidas — definidas en js/shared.js
  const STAGE_LABEL = window.STAGE_LABEL;
  const SET_NAMES   = window.SET_NAMES;
  const SET_RANK    = window.SET_RANK;

  const RAR_ORDER = ['◊','◊◊','◊◊◊','◊◊◊◊','AR','SAR','IM','✸','✸✸','♕','Promo'];
  const RAR_RANK  = Object.fromEntries(RAR_ORDER.map((r,i) => [r, i]));

  // Active filter state
  const F = {
    types:      new Set(),
    els:        new Set(),
    stages:     new Set(),
    rcs:        new Set(),   // retreat cost values as strings
    rcOp:       '=',         // '=' | '>=' | '<='
    set:        '',
    rarity:     '',
    exOnly:     false,
    hpMin:      null,
    hpMax:      null,
    hpOp:       '=',         // '=' | '>=' | '<='  (debe coincidir con el botón «=» activo por defecto en el HTML)
    attackCost:   [],          // e.g. ['psychic','psychic','colorless']
    costMode:     'exact',     // 'exact' | 'min'
    rarities:     new Set(),   // DB rarity codes: '◊', '◊◊', 'AR', etc.
    megaOnly:     false,
    abilityOnly:  false,
    sortBy:       'set',       // 'set' | 'type' | 'rarity' | 'name'
    sortDir:      'desc',      // 'asc' | 'desc'  (desc = newest first for set)
    effects:      new Set(),   // chips de Avanzados simples → claves de EFFECT_KEYS (combinan en AND)
    drawMode:     null,        // null | 'all' | 'generic' | 'specific'  (chip Robo, desplegable)
    lockMode:     null,        // null | 'all' | 'retreat' | 'supporter' | 'item' | 'evolve' | 'energy' | 'attack'
    dmgMode:      null,        // null | 'all' | 'cond' | 'energy' | 'bench'  (chip +Daño)
    negMode:      null,        // null | 'all' | 'recoil' | 'energy' | 'hand' | 'mill' | 'self'  (Negativo/coste)
    conditions:   new Set(),   // pill de Estados → {poisoned,burned,asleep,paralyzed,confused} (OR dentro)
    textQuery:    '',          // caja de búsqueda por TEXTO de carta (Avanzados, inglés)
    customOnly:   false,       // chip de Avanzados: ver SOLO las cartas custom de pokelink
    // ── EXCLUIR (clic derecho / mantener pulsado en móvil) ──────────────
    // Cada conjunto de arriba tiene su gemelo de EXCLUIDOS: dentro de una categoría
    // los incluidos suman (OR) y los excluidos restan (AND de NOT). Un mismo valor
    // nunca está en los dos: al excluir se quita de incluidos y al revés.
    notTypes:     new Set(),
    notEls:       new Set(),
    notStages:    new Set(),
    notRcs:       new Set(),   // usa el MISMO operador visible (≤ = ≥), negado
    notRarities:  new Set(),
    notEffects:   new Set(),
    notConditions: new Set(),
    notDD:        new Set(),   // 'draw'|'lock'|'dmg'|'neg' → «sin nada de eso»
    mechEx:       new Set(),   // 'ex'|'mega'|'ability'|'ub'|'past'|'future' → «sin X»
  };
  const DD_DIMS = { draw: null, lock: 'lock', dmg: 'dmg', neg: 'neg' };

  // ── Filtros AVANZADOS por EFECTO ────────────────────────────────
  // Cada chip = un concepto de juego; se resuelve mirando los `ops` ya parseados del
  // motor de efectos (CARD_EFFECTS = ataques, CARD_ABILITIES = habilidades,
  // CARD_TRAINER_EFFECTS = entrenadores/objetos/estadios). Independiente del idioma.
  // Las etiquetas 'inner:X' resuelven los ops ENVOLTORIO (triggered / turnPhase / onAttach),
  // cuyo concepto real va anidado (effect.type / action / effect-string) — ver expandOps().
  // Chips SIMPLES (toggle on/off, combinan en AND). Los conceptos con desplegable (Robo, +Daño,
  // Daño a la banca, Descartar energía, Milling, Bloquear) y la pill de Estados se calculan como
  // dimensiones aparte. gust/mobility/recoil se derivan y se añaden a `tags`.
  const EFFECT_OPS = {
    heal:          new Set(['heal','healEach','healChooseMine','healChooseBench','healDrain','healActive','abilityHeal','checkupHeal','eeveeBagChoice','recycleSelfOnHeal','toolHealEndTurn','toolCureEndTurn','abilityHealExDiscard','abilityRemoveCond','cureSelfConditions','moveDamage','abilityMoveDamageToSelf','inner:heal','inner:healSelf','inner:healActiveType']),
    draw:          new Set(['drawCards','drawToMatch','drawPerCount','abilityDrawDiscardCost','toolDrawToOnKO','toolDrawOnKOgiven','ionoShuffleDraw','stadiumDrawEndTurn','shuffleHandToDeck','shuffleHandDrawOppHand','inner:draw']),
    deckSearch:    new Set(['attackFromDeck','attackToBench','fromDeckNamed','fromDeckFilter','evolveFromDeckChoose','evolveFromDeckSelf','abilityFromDeck','swapHandPokemonForDeck','topCardConditional','lookTopDeck','inner:fromDeck','inner:evolveFromDeck','inner:lookTopTake']),
    ignoreWeak:    new Set(['ignoreWeakness','noWeaknessNextTurn']),
    attachEnergy:  new Set(['attachEnergyZone','attachRandomEnergyZone','distributeEnergy','attachEnergyNamed','attachEnergyNamedEach','attachEnergyFlip','attachDiscardEnergyRandom','attachDiscardEnergyNamed','attachDiscardEnergyActive','coinAttachBench','abilityAttachEnergy','abilityAttachSelf','abilityAttachDiscardActive','attachEnergyStage','energyProvides','distributeFromDiscard','inner:attachActiveType','inner:attachSelf']),
    moveEnergy:    new Set(['moveEnergySelfToBench','moveEnergyToActive','moveAllEnergyToActiveNamed','abilityMoveEnergy','koMoveEnergy','toolMoveEnergyOnKO','moveEnergyFree','moveOppBenchEnergyToActive','inner:switchSelfMoveEnergy','inner:stealEnergy']),
    // Pila de descartes = reciclar/leer el descarte + descartar cartas (NO mill = lo alto del mazo, que es su propio chip).
    pila:          new Set(['retrieveDiscardToHand','putOppDiscardToBench','toolRescue','attachDiscardEnergyRandom','attachDiscardEnergyNamed','attachDiscardEnergyActive','abilityDiscardEnergyToSelf','distributeFromDiscard','discardOppActiveTools','discardToolOrStadium','discardOppTools','discardStadium','discardOpponentHand','discardOppHandCard','oppDiscardHandTo','discardHandCost','discardHandToolsForDamage','discardBenchForDamage','toolDiscardEndOppTurn','toolMoveEnergyOnKO','abilityDiscardOppActiveTools','abilityAttachDiscardActive','inner:fromDiscardTrainer']),
    oppHand:       new Set(['revealOpponentHand','discardOpponentHand','oppShuffleHandDraw','oppShuffleHandDrawByPoints','prankSpinner','discardOppHandCard','oppDiscardHandTo','revealChooseOppHand','revealOppDeck','oppRevealShuffleHand','toolReactiveRevealShuffle','oppHandToBench','inner:revealOppHand','inner:oppShuffleDraw']),
    prevent:       new Set(['preventDmg','preventDamage','preventEffects','preventFromBasic','disguise','reduceDamage','toolReduce','teamReduceNextTurn','teamReduceAura','toolPreventBench','surviveSelf','surviveKO','selfReduceNextTurn','defenderAttackWeak','oppAttackReduce','toolPreventEffects','onAttackKO','inner:selfShield']),
    hpBonus:       new Set(['hpBonusTeam','hpBonusSelfPerEnergy','toolHpBonus','stadiumHpBonus']),
    copy:          new Set(['copyAttack','copySupporter','abilityCopySupporter','timeRecall','toolTimeRecall']),
    // 'coin' es especial (cualquier op con tirada de moneda); 'pila' añade variantes que leen el descarte.
  };
  const EFFECT_KEYS = ['heal','draw','deckSearch','ignoreWeak','attachEnergy','moveEnergy','pila','oppHand','prevent','hpBonus','copy','coin'];
  // 'pdmg' (daño pasivo) y 'edmg' (daño por efecto) se derivan en cardInfo y se añaden allí a `tags`.
  // Staples cableados a mano en el motor (sin ops en los datos) → etiquetas por NOMBRE.
  const STAPLE_TAGS = {
    "professor's research": ['draw'], "professors research": ['draw'], 'copycat': ['draw'],
    'poké ball': ['deckSearch'], 'poke ball': ['deckSearch'], 'may': ['deckSearch'],
    'lisia': ['deckSearch'], 'arven': ['deckSearch', 'coin'],
  };
  function opMatchesConcept(op, key) {
    if (key === 'coin') return !!op.coin || !!op.coins || /coin|flip/i.test(op.op) || op.op === 'forceNextHeads' || op.op === 'victoryStar';
    // «Mirar» lo alto del mazo (Pokédex, Rotom Dex, Porygon) NO es buscar: solo cuenta si
    // la carta acaba en tu mano (Turista, Mercader Ambulante, Chica Amante de Cachorros).
    if (key === 'deckSearch' && op.op === 'lookTopDeck') return !!op.take;
    if (key === 'pila') return EFFECT_OPS.pila.has(op.op)
      || (op.op === 'damagePerCount' && /discard/i.test(op.count || ''))
      || (op.op === 'condDamage' && /discard/i.test(op.cond || ''));
    const s = EFFECT_OPS[key];
    return s ? s.has(op.op) : false;
  }
  // Expande los ops envoltorio en ops virtuales 'inner:<tipo>' para clasificar su efecto anidado.
  function expandOps(op, out) {
    out.push(op);
    if (op.op === 'triggered' && op.effect && op.effect.type) out.push(Object.assign({}, op.effect, { op: 'inner:' + op.effect.type }));
    else if (op.op === 'turnPhase' && op.action) out.push({ op: 'inner:' + op.action });
    else if ((op.op === 'onAttach' || op.op === 'onAttachOpponent') && typeof op.effect === 'string') out.push({ op: 'inner:' + op.effect, cond: op.cond });
  }
  const DMG_ANY = new Set(['condDamage','damagePerBench','damagePerEnergy','damagePerCount','damagePerAttackUse','damagePerNamedAttack','damagePerKO','turnDamageBuff','attackBuff','selfAttackBuffNextTurn','selfAttackStack','nextTurnDamageBuff','abilityTurnDamageBuff','toolDamageBuff','stadiumAttackBuff','attackTwice']);
  const ALL_CONDS = ['poisoned', 'burned', 'asleep', 'paralyzed', 'confused'];
  const _infoCache = {};
  // Calcula en UNA pasada: tags (chips simples + gust/mobility/recoil + draw/deckSearch) y las
  // dimensiones con desplegable (lock/dmg/bench/denergy/mill) + condiciones para la pill.
  function cardInfo(card) {
    const id = card.id;
    if (_infoCache[id]) return _infoCache[id];
    const ops = [];
    const ce = window.CARD_EFFECTS && window.CARD_EFFECTS[id];
    if (ce) for (const an in ce) (ce[an].ops || []).forEach(o => expandOps(o, ops));
    const ca = window.CARD_ABILITIES && window.CARD_ABILITIES[id];
    if (ca) ca.forEach(ab => (ab.ops || []).forEach(o => expandOps(o, ops)));
    const ct = window.CARD_TRAINER_EFFECTS && window.CARD_TRAINER_EFFECTS[id];
    if (ct && ct.ops) ct.ops.forEach(o => expandOps(o, ops));
    const tags = new Set();
    EFFECT_KEYS.forEach(key => { if (ops.some(o => opMatchesConcept(o, key))) tags.add(key); });
    const st = STAPLE_TAGS[(card.name || '').toLowerCase()];
    if (st) st.forEach(t => tags.add(t));
    const lock = new Set(), dmg = new Set(), bench = new Set(), denergy = new Set(), mill = new Set(), conds = new Set();
    let gust = false, mobility = false, recoil = false, handCost = false, selfLock = false, passiveDmg = false, effectDmg = false;
    ops.forEach(o => {
      const k = o.op, side = o.side, who = o.who, tgt = o.target;
      // ── Descartar de TU mano como coste (a menudo motor; va en Negativo/coste) ──
      if (k === 'discardHandCost' || k === 'discardHandToolsForDamage' || k === 'abilityDrawDiscardCost') handCost = true;
      // ── Bloquear (subtipos) ── SIEMPRE es lo que le impides al RIVAL. Lo que te penaliza
      // a TI (Leafeon «no puedes atacar tu próximo turno») va a Negativo/coste, no aquí.
      if (k === 'cantRetreat' || k === 'defenderRetreatUp') lock.add('retreat');
      if (k === 'noSupporterNextTurn' || k === 'noTrainersNextTurn' || k === 'firstAttackLock' || (k === 'aura' && o.kind === 'noOppSupporter')) lock.add('supporter');
      if (k === 'noItemsNextTurn' || k === 'noTrainersNextTurn' || k === 'firstAttackLock') lock.add('item');
      if (k === 'noTrainersNextTurn' || k === 'firstAttackLock' || (k === 'aura' && o.kind === 'noOppStadium')) lock.add('stadium');
      if (k === 'noEvolveNextTurn' || (k === 'aura' && o.kind === 'noOppEvolveActive')) lock.add('evolve');
      if (k === 'noActiveEnergyNextTurn') lock.add('energy');
      // «No atacar» incluye dificultarlo: fallar el ataque (Weezing), perder UN ataque
      // concreto (Quagsire «Amnesia») o encarecerlo (Oranguru, Stoutland).
      if (k === 'cantAttack' || k === 'cantUse' || k === 'cantUseRandom' || k === 'smokescreen'
        || k === 'defenderAttackCostUp' || k === 'oppAttackCostUp') lock.add('attack');
      if (k === 'suppressAbilities' || (k === 'aura' && o.kind === 'noBasicAbilities')) lock.add('ability');
      if (k === 'aura' && o.kind === 'noHeal') lock.add('heal');
      // ── +Daño (subtipos) ──
      if (k === 'condDamage') dmg.add('cond');
      if (k === 'damagePerEnergy') dmg.add('energy');
      if (k === 'damagePerBench') dmg.add('bench');
      if (DMG_ANY.has(k) || k === 'defenderVulnYourTurn') dmg.add('any');
      // Daño EXTRA condicional por habilidad ligada a un estado: Nihilego (el veneno hace +10),
      // Darkrai Bad Dreams (20 si el rival está Dormido).
      if (k === 'poisonAmplify' || k === 'inner:damageOppActiveIfAsleep') { dmg.add('cond'); dmg.add('any'); }
      // ── Daño a la banca (rival / propia) ──
      // OJO: «a 1 de los Pokémon de tu rival» / «a cada Pokémon de tu rival» SÍ es banca aunque
      // el texto no diga «Banca» — y da igual que venga de un ataque, de una habilidad
      // (Greninja «Shuriken de Agua»), del Checkup (Flygon ex) o de un efecto diferido
      // (Meowscarada marca un hueco, que puede ser de la banca).
      if (k === 'benchSpread' || k === 'chooseDamage' || k === 'randomDamage' || k === 'coinBenchSpread' || k === 'damageBenchMulti' || k === 'damageAllOpp' || k === 'extraRandomTargets') {
        if (side === 'self') bench.add('self');
        else if (side === 'both') { bench.add('self'); bench.add('opp'); }
        else bench.add('opp');
      }
      if ((k === 'abilityDamage' && tgt === 'chooseOpp')
        || ((k === 'checkupDamage' || k === 'koRetaliate') && o.scope === 'eachOpp')
        || ((k === 'delayedDamage' || k === 'delayedKO') && tgt === 'spot')) bench.add('opp');
      // ── Daño de retroceso (autodaño, incluye dañar tu propia banca: Great Tusk, Emolga…) ──
      if (k === 'recoil' || ((k === 'benchSpread' || k === 'chooseDamage') && (side === 'self' || side === 'both')) || o.selfDamage) recoil = true;
      // ── DAÑO PASIVO vs DAÑO POR EFECTO (reglas de Daniel, 2026-08-25) ──────
      //   PASIVO     = haces daño SIN atacar y sin depender de nada: tú lo activas o pasa
      //                solo. Greninja y Crobat (habilidad), Flygon ex y Glaceon ex (Checkup),
      //                Darkrai ex / Drizzile / Inteleon (al poner energía o evolucionar),
      //                Jolteon ex, Malos Sueños, Aguja Engañosa.
      //   POR EFECTO = daño indirecto, o que ni siquiera se considera daño. Dos familias:
      //                · el KO como EFECTO, sin hacer daño: Armaldo, Raging Bolt, Bewear.
      //                · el que necesita colocar un efecto sobre el Pokémon rival: Mismagius
      //                  (su daño llega al final del siguiente turno del rival).
      //                · el contraataque: no es pasivo porque depende de una ACCIÓN del rival
      //                  — que te pegue (Casco Dentado, Contraataque, Perish Body, Sableye ex).
      // NI UNO NI OTRO: Meowscarada ex. Su daño es DIRECTO (marca un HUECO, no coloca efecto
      // en nadie) pero sale de un ATAQUE, así que no es «sin atacar». Sí es daño a la banca.
      if (k === 'abilityDamage' || k === 'checkupDamage' || k === 'inner:damageOppActive'
        || k === 'inner:damageThat' || k === 'inner:damageOppActiveIfAsleep'
        || k === 'toolDamageEndTurn') passiveDmg = true;
      if (k === 'koOppActive' || k === 'coinKO' || k === 'delayedKO'                 // KO como efecto
        || (k === 'delayedDamage' && tgt !== 'spot')                                 // efecto puesto en el rival
        || k === 'toolRetaliate' || k === 'koRetaliate' || k === 'koKoAttacker'      // contraataque
        || k === 'counterNextTurn' || k === 'snappingTrap'
        || (k === 'retaliate' && o.kind === 'damage')) effectDmg = true;
      // ── Te penaliza a TI el próximo turno (no es «Bloquear», es coste) ──
      if (k === 'selfCantAttackNextTurn' || k === 'selfVulnNextTurn') selfLock = true;
      // ── Descartar energía (tuya / rival) ──
      if (k === 'discardEnergy') denergy.add(tgt === 'self' ? 'self' : 'opp');
      else if (k === 'discardOppActiveEnergy' || k === 'discardEnergyOppAbility' || k === 'discardOppEnergyFlip') denergy.add('opp');
      else if (k === 'discardEnergyAllPokemon') {   // Gaia Blast (Groudon) = solo los tuyos (side:self); el resto = ambos
        if (side === 'self') denergy.add('self');
        else if (side === 'opponent') denergy.add('opp');
        else { denergy.add('self'); denergy.add('opp'); }
      }
      else if (k === 'discardEnergyBothActive') { denergy.add('self'); denergy.add('opp'); }
      else if (k === 'coinDiscardDamage') denergy.add('self');
      // ── Milling (lo alto del mazo: tu mazo = negativo / rival) ──
      if (k === 'discardTopDeck') { if (side === 'opponent') mill.add('opp'); else if (side === 'both') { mill.add('self'); mill.add('opp'); } else mill.add('self'); }
      else if (k === 'abilityDiscardOppDeck') mill.add('opp');
      else if (k === 'coinDiscardDeck' || k === 'discardTopForDamage') mill.add(side === 'opponent' ? 'opp' : 'self');
      // ── Cambiar activo del RIVAL (gust) ──
      if (k === 'switchOpponent' || k === 'devolveOpponent' || k === 'returnActive' || k === 'discardOppActive' || (k === 'attackSwitch' && who === 'opponent') || (k === 'abilitySwitch' && who === 'opponent') || k === 'inner:switchOpp') gust = true;
      // ── Movilidad: cambios/movimiento de TUS Pokémon + reducir coste de retirada ──
      if (k === 'switchSelf' || k === 'returnSelfActiveToHand' || k === 'moveAllBenchToActive' || k === 'shuffleSelfToDeck' || k === 'mayShuffleSelf' || k === 'inner:switchSelfMoveEnergy'
        || (k === 'attackSwitch' && who === 'self') || (k === 'abilitySwitch' && (who === 'self' || who === 'selfThis'))
        || k === 'retreatReduceThisTurn' || k === 'toolRetreatReduce' || k === 'stadiumRetreatReduce'
        || (k === 'retreatMod' && (o.target === 'self' || o.target === 'activeMine') && (o.setZero || (typeof o.amount === 'number' && o.amount < 0)))) mobility = true;
      // ── Estados: causa la condición O tiene mecánica relacionada (más daño si X / amplifica X) ──
      if (k === 'randomCondition') ALL_CONDS.forEach(x => conds.add(x));
      else if (k === 'sleepOnOppAttach' || k === 'inner:damageOppActiveIfAsleep') conds.add('asleep');
      else if (k === 'poisonAmplify') conds.add('poisoned');
      else if (k === 'condDamage') { if (o.status && ALL_CONDS.indexOf(o.status) >= 0) conds.add(o.status); }
      else if (k === 'coinCondition') { [o.heads, o.tails].forEach(x => { if (x) conds.add(x); }); }
      else if (k === 'selfImmune') { if (o.what === 'allConditions') ALL_CONDS.forEach(x => conds.add(x)); else if (o.what) conds.add(o.what); }
      else if (k === 'aura' && o.kind === 'condImmuneTeam') ALL_CONDS.forEach(x => conds.add(x));
      else if (k === 'cureSelfConditions' || k === 'abilityRemoveCond') ALL_CONDS.forEach(x => conds.add(x));
      else if (/condition/i.test(k) || k === 'inner:selfCondition' || k === 'toolRetaliateCond' || (k === 'retaliate' && o.kind === 'condition')) {
        if (o.cond) conds.add(o.cond);
        if (o.options) o.options.forEach(x => conds.add(x));
        if (o.conds) o.conds.forEach(x => conds.add(x));
      }
    });
    // Chips OFENSIVOS (limpios, contra el rival) = tags simples.
    if (bench.has('opp')) tags.add('benchOpp');
    if (denergy.has('opp')) tags.add('denergyOpp');
    if (mill.has('opp')) tags.add('millOpp');
    if (gust) tags.add('gust');
    if (mobility) tags.add('mobility');
    if (passiveDmg) tags.add('pdmg');
    if (effectDmg) tags.add('edmg');
    // Desplegable "Negativo / coste" = perjuicios a ti mismo (no es lo que se busca de primeras).
    const neg = new Set();
    if (recoil) neg.add('recoil');               // daño de retroceso / a tu propia banca
    if (selfLock) neg.add('self');               // te deja sin atacar / más vulnerable el próximo turno
    if (denergy.has('self')) neg.add('energy');  // descartar tu propia energía
    if (handCost) neg.add('hand');               // descartar de tu mano (coste)
    if (mill.has('self')) neg.add('mill');       // quemar tu propio mazo
    const info = { tags, lock, dmg, neg, conds, bench, denergy, mill };
    _infoCache[id] = info;
    return info;
  }
  function cardEffectTags(card) { return cardInfo(card).tags; }
  window._cvCardEffectTags = function (card) { return Array.from(cardInfo(card).tags); };   // hook de test
  window._cvCardInfo = function (card) { const i = cardInfo(card); return { tags: [...i.tags], lock: [...i.lock], dmg: [...i.dmg], neg: [...i.neg], conds: [...i.conds], bench: [...i.bench], denergy: [...i.denergy], mill: [...i.mill] }; };

  // ── Búsqueda por TEXTO de carta (caja de Avanzados) ───────────────
  // Índice = nombre + ataques (nombre+efecto, cards.db) + habilidades (abilities.js) +
  // entrenadores (trainer_text.js). El texto es INGLÉS; un mini-diccionario traduce las
  // palabras escritas en español. Reglas: sin comillas = AND de palabras (cada una debe
  // aparecer al INICIO de una palabra → 'poison' pilla "poisoned" pero 'turn' no "return");
  // entre comillas = frase exacta.
  const ES_EN = {
    robar: 'draw', robo: 'draw', curar: 'heal', cura: 'heal', 'curación': 'heal', curacion: 'heal',
    veneno: 'poison', envenenar: 'poison', envenenado: 'poison', quemar: 'burn', quemado: 'burn', quemadura: 'burn',
    dormir: 'sleep', dormido: 'asleep', 'sueño': 'sleep', sueno: 'sleep',
    paralizar: 'paralyze', 'parálisis': 'paralyze', paralisis: 'paralyze', paralizado: 'paralyze',
    confundir: 'confuse', 'confusión': 'confuse', confusion: 'confuse', confundido: 'confuse',
    'energía': 'energy', energia: 'energy', descartar: 'discard', descarte: 'discard', banca: 'bench',
    mano: 'hand', mazo: 'deck', retirada: 'retreat', retirar: 'retreat',
    evolucionar: 'evolve', 'evolución': 'evolve', evolucion: 'evolve',
    'daño': 'damage', dano: 'damage', 'dañar': 'damage', moneda: 'coin', cara: 'heads', cruz: 'tails',
    buscar: 'search', barajar: 'shuffle', mover: 'move', debilidad: 'weakness', herramienta: 'tool',
    objeto: 'item', partidario: 'supporter', estadio: 'stadium', activo: 'active',
    rival: 'opponent', oponente: 'opponent', puntos: 'points', escudo: 'shield', prevenir: 'prevent',
    ataque: 'attack', cambiar: 'switch', evolución: 'evolve'
  };
  // Ignora tildes/diacríticos (NFD): "energía"="energia", "daño"="dano", "Flabébé"="flabebe".
  // Tildes Y apostrofos: «energia»=«energía», «farfetchd»=«Farfetch'd»=«Farfetch’d».
  // El plegado vive en shared.js (window.pbFold) para que TODOS los buscadores usen el mismo.
  function deaccent(s) { return window.pbFold ? window.pbFold(s) : (s || ''); }
  // Símbolos de energía del texto («[P]», «[W]»…). Los datos los traen en DOS grafías:
  // pegada en los ataques y habilidades de los sets normales, y CON ESPACIOS («[ P ]») en
  // todo el texto de Entrenadores y en los ataques de las promos PA/PB. Se pliegan a la
  // forma pegada en el blob Y en la consulta, para que «[P]» encuentre también a Plaza
  // Peculiar, Misty o el Mewtwo promo (antes solo salían los Pokémon de set normal).
  function foldEnergyTags(s) { return (s || '').replace(/\[\s*([a-z])\s*\]/g, '[$1]'); }
  const ES_EN_DA = {}; Object.keys(ES_EN).forEach(function (k) { ES_EN_DA[deaccent(k)] = ES_EN[k]; });
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function parseQuery(q) {
    const phrases = [];
    q = foldEnergyTags(deaccent((q || '').toLowerCase())).replace(/"([^"]+)"/g, function (_, p) { const t = p.trim(); if (t) phrases.push(t); return ' '; });
    return { phrases: phrases, words: q.split(/\s+/).filter(Boolean) };
  }
  // Matcher de TEXTO de carta: traduce es→en y exige inicio de palabra. Precompila una vez.
  function buildTextMatcher(q) {
    const pq = parseQuery(q);
    const res = pq.words.map(function (w) {
      const term = ES_EN_DA[w] || w;
      // Un símbolo de energía («[p]») ya es su propia frontera: en los datos aparece pegado a
      // la palabra anterior («Discard Grass[G] Energy…»), así que exigirle inicio de palabra
      // dejaba fuera esas cartas.
      return new RegExp((term.charAt(0) === '[' ? '' : '(^|[^a-z0-9])') + escRe(term));
    });
    return function (blob) {
      for (let i = 0; i < pq.phrases.length; i++) if (blob.indexOf(pq.phrases[i]) < 0) return false;
      for (let i = 0; i < res.length; i++) if (!res[i].test(blob)) return false;
      return true;
    };
  }
  // Matcher de NOMBRE: AND de palabras por substring (sin inicio-de-palabra, para que "saur"
  // siga encontrando Bulbasaur) + comillas = frase exacta.
  function buildNameMatcher(q) {
    const pq = parseQuery(q);
    return function (name) {
      name = deaccent(name);
      for (let i = 0; i < pq.phrases.length; i++) if (name.indexOf(pq.phrases[i]) < 0) return false;
      for (let i = 0; i < pq.words.length; i++) if (name.indexOf(pq.words[i]) < 0) return false;
      return true;
    };
  }
  const _textCache = {};
  function cardText(card) {
    if (_textCache[card.id]) return _textCache[card.id];
    const parts = [card.name || ''];
    // nombres de carta traducidos (ES/JA) → buscar por nombre en cualquier idioma
    if (window.cardSearchNames) parts.push(window.cardSearchNames(card));
    const anES = window.ATTACK_NAMES_ES, anJA = window.ATTACK_NAMES_JA;
    const bnES = window.ABILITY_NAMES_ES, bnJA = window.ABILITY_NAMES_JA;
    (card.attacks || []).forEach(function (a) {
      if (a.name) { parts.push(a.name); if (anES && anES[a.name]) parts.push(anES[a.name]); if (anJA && anJA[a.name]) parts.push(anJA[a.name]); }
      if (a.effect) parts.push(a.effect);
    });
    const ab = window.ABILITY_DATA && window.ABILITY_DATA[card.id];
    if (ab) ab.forEach(function (x) {
      if (x.name) { parts.push(x.name); if (bnES && bnES[x.name]) parts.push(bnES[x.name]); if (bnJA && bnJA[x.name]) parts.push(bnJA[x.name]); }
      if (x.effect) parts.push(x.effect);
    });
    const tt = window.TRAINER_TEXT && window.TRAINER_TEXT[card.id];
    if (tt) parts.push(tt);
    // Entrenador de un set en PREVIEW: su texto no está en el cache scrapeado, viaja en la
    // propia carta (la ficha del zoom ya cae a él). Sin esto, un set nuevo entra MUDO al buscador.
    if (card.previewText) parts.push(card.previewText);
    // TEXTO de efecto traducido (por carta: ES exacto de TCGdex donde cubre + OCR; JA por OCR)
    const ctES = window.CARD_TEXT_ES, ctJA = window.CARD_TEXT_JA;
    if (ctES && ctES[card.id]) parts.push(ctES[card.id]);
    if (ctJA && ctJA[card.id]) parts.push(ctJA[card.id]);
    return (_textCache[card.id] = foldEnergyTags(deaccent(parts.join(' \n ').toLowerCase())));
  }
  function cvSyncTextBox() {
    const w = document.getElementById('cv-text-wrap');
    if (w) w.classList.toggle('has-text', !!(F.textQuery && F.textQuery.trim()));
  }
  window._cvTextSearch = function (v) { F.textQuery = v || ''; cvSyncTextBox(); cvSyncAdvCount(); runFilter(); };
  window._cvClearText = function () {
    const i = document.getElementById('cv-text-search'); if (i) i.value = '';
    window._cvTextSearch('');
  };
  window._cvToggleTextInfo = function (e) { if (e) e.stopPropagation(); const p = document.getElementById('cv-text-info'); if (p) p.classList.toggle('open'); };
  function cvUpdateTextLang() {
    const note = document.getElementById('cv-text-ennote');
    if (note) note.style.display = (window.i18n && window.i18n.getLang() !== 'en') ? '' : 'none';
  }
  window._cvUpdateTextLang = cvUpdateTextLang;
  document.addEventListener('click', function (e) { if (!e.target.closest('#cv-text-info')) { const p = document.getElementById('cv-text-info'); if (p) p.classList.remove('open'); } });
  function advActiveCount() {
    return F.effects.size + F.conditions.size + F.notEffects.size + F.notConditions.size + F.notDD.size
      + (F.drawMode ? 1 : 0) + (F.lockMode ? 1 : 0) + (F.dmgMode ? 1 : 0) + (F.negMode ? 1 : 0)
      + (F.textQuery && F.textQuery.trim() ? 1 : 0)
      + (F.types.has('fossil') ? 1 : 0)    // el chip Fósil vive en avanzados (cuenta aquí, y se descuenta de F.types al totalizar)
      + (F.customOnly ? 1 : 0);
  }
  // ── Cartas CUSTOM de pokelink ───────────────────────────────────
  // Regla (Daniel): NO existen para el buscador salvo que se pidan a propósito —
  // este chip las muestra SOLAS, y escribir su nombre en el buscador también las trae.
  // Ningún otro filtro (Objeto, Partidario, tipo, rareza…) las saca por su cuenta.
  window._cvToggleCustom = function (el) {
    F.customOnly = !F.customOnly;
    if (el) {
      el.classList.toggle('active', F.customOnly);
      if (F.customOnly && window._cvChipBurst) window._cvChipBurst(el, 'type', 'item');
    }
    cvSyncAdvCount();
    runFilter();
  };

  // ══ EXCLUIR un filtro (clic derecho en escritorio · mantener pulsado en móvil) ══
  // Un solo camino para TODOS los chips: se identifica el chip por sus data-attrs
  // (o por su id, en los que van por checkbox oculto) y se llama a su toggle en
  // modo negativo. Los chips que son MODOS (línea evolutiva, ocultar preevos,
  // CUSTOM) no se excluyen: no son un conjunto de cartas.
  const MECH_CHIPS = { 'cv-ex-chip': 'ex', 'cv-mega-chip': 'mega', 'cv-ability-chip': 'ability',
                       'cv-ub-chip': 'ub', 'cv-past-chip': 'past', 'cv-future-chip': 'future',
                       'cv-tr-chip': 'tr' };
  const MECH_CB    = { ex: 'cv-ex-only', mega: 'cv-mega-only', ability: 'cv-ability-only',
                       ub: 'cv-ub', past: 'cv-past', future: 'cv-future', tr: 'cv-tr' };
  function chipSpec(el) {
    if (!el || el.classList.contains('cv-custom-chip')) return null;
    if (el.id === 'cv-evoline-chip' || el.id === 'cv-noevo-chip') return null;
    const d = el.dataset || {};
    if (d.cvType)   return { kind: 'type',   value: d.cvType };
    if (d.cvEl)     return { kind: 'el',     value: d.cvEl };
    if (d.cvStage)  return { kind: 'stage',  value: d.cvStage };
    if (d.cvRc)     return { kind: 'rc',     value: d.cvRc === '4' ? '4+' : d.cvRc };
    if (d.cvEffect) return { kind: 'effect', value: d.cvEffect };
    if (d.rar)      return { kind: 'rar',    value: d.rar };
    if (d.cvCond)   return { kind: 'cond',   value: d.cvCond };
    if (MECH_CHIPS[el.id]) return { kind: 'mech', value: MECH_CHIPS[el.id] };
    const dd = el.closest('.cv-dd-wrap');
    if (dd && dd.id.startsWith('cv-dd-')) return { kind: 'dd', value: dd.id.slice(6) };
    return null;
  }
  // «Sin EX» / «sin habilidad»… — el chip pasa de «solo X» a «sin X» y de ahí a neutro.
  function toggleMechEx(el, which) {
    const cb = document.getElementById(MECH_CB[which]);
    if (cb && cb.disabled) return;
    if (F.mechEx.has(which)) { F.mechEx.delete(which); el.classList.remove('excluded'); }
    else {
      F.mechEx.add(which); el.classList.add('excluded');
      el.classList.remove('active');
      if (cb) cb.checked = false;
    }
    runFilter();
  }
  // Excluir un concepto con desplegable = «que no tenga NADA de eso» (sin robo, sin bloqueo…)
  function toggleDDEx(which) {
    const wrap = document.getElementById('cv-dd-' + which);
    if (F.notDD.has(which)) { F.notDD.delete(which); if (wrap) wrap.classList.remove('excluded'); }
    else {
      F.notDD.add(which); F[which + 'Mode'] = null;
      updateDDChip(which);
      if (wrap) wrap.classList.add('excluded');
    }
    cvSyncAdvCount();
    runFilter();
  }
  // La cue sale al usar un filtro por primera vez, anclada al chip recién pulsado.
  function cvMaybeExcludeCue(el) {
    if (!el || !window.pbCue || !window.pbCue.eligible || !window.pbCue.eligible('cardsExclude')) return;
    setTimeout(() => {
      if (el.getBoundingClientRect().width > 0) window.pbCue.maybe('cardsExclude', { anchor: el, place: 'below' });
    }, 700);
  }

  function excludeChip(el) {
    const spec = chipSpec(el);
    if (!spec) return false;
    if (spec.kind === 'mech') toggleMechEx(el, spec.value);
    else if (spec.kind === 'dd') toggleDDEx(spec.value);
    else if (spec.kind === 'rar') window._cvToggleRar(el, spec.value, true);
    else if (spec.kind === 'cond') window._cvToggleCond(el, spec.value, true);
    else toggleChip(el, spec.kind, spec.value, true);
    if (window.pbCue) window.pbCue.done('cardsExclude');
    return true;
  }
  window._cvExcludeChip = excludeChip;

  // Cableado del gesto (delegado: los chips viajan a la hoja de filtros en móvil)
  (function wireExclude() {
    const CV_TOUCH = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    const inScope = el => el && el.closest && el.closest('#view-cards, #cv-filter-sheet');
    const chipOf  = e => { const c = e.target.closest && e.target.closest('.cv-chip'); return inScope(c) ? c : null; };

    document.addEventListener('contextmenu', e => {
      const chip = chipOf(e);
      if (!chip || !chipSpec(chip)) return;
      e.preventDefault();                    // en táctil el long-press ya lo hizo; aquí solo se evita el menú
      if (!CV_TOUCH) excludeChip(chip);
    });

    // Táctil: mantener pulsado ~0,5 s = excluir. El clic que viene detrás se traga.
    let lpT = null, lpChip = null, lpX = 0, lpY = 0, suppress = null;
    const cancel = () => { clearTimeout(lpT); lpT = null; lpChip = null; };
    document.addEventListener('pointerdown', e => {
      if (e.pointerType !== 'touch') return;
      const chip = chipOf(e);
      if (!chip || !chipSpec(chip)) return;
      lpChip = chip; lpX = e.clientX; lpY = e.clientY;
      lpT = setTimeout(() => {
        lpT = null;
        if (!lpChip) return;
        suppress = lpChip;
        excludeChip(lpChip);
        if (window.pbHaptic) window.pbHaptic('light');
        lpChip = null;
      }, 500);
    }, { passive: true });
    document.addEventListener('pointermove', e => {
      if (!lpT) return;
      if (Math.abs(e.clientX - lpX) > 10 || Math.abs(e.clientY - lpY) > 10) cancel();
    }, { passive: true });
    ['pointerup', 'pointercancel'].forEach(ev => document.addEventListener(ev, cancel, { passive: true }));
    // El onclick inline del chip vive en el propio nodo → hay que cortar el evento
    // ANTES de la fase de destino (capture en document), o el toque «incluiría» también.
    document.addEventListener('click', e => {
      if (!suppress) return;
      if (e.target.closest && e.target.closest('.cv-chip') === suppress) { e.stopPropagation(); e.preventDefault(); }
      suppress = null;
    }, true);
  })();

  function cvSyncAdvCount() {
    const c = document.getElementById('cv-adv-count');
    if (c) { const n = advActiveCount(); c.textContent = n; c.classList.toggle('on', n > 0); }
  }
  window._cvToggleAdvanced = function () {
    // El botón vive en la fila superior y el cuerpo (#cv-advanced) bajo los filtros →
    // se sincroniza .open en ambos, y .adv-on en la cabecera (enseña la caja de texto).
    // Ojo: esto MUESTRA/OCULTA, no desactiva — si quedan filtros avanzados puestos, el
    // botón se queda encendido con su contador (badge) para que no filtren a escondidas.
    const adv = document.getElementById('cv-advanced');
    const open = adv ? adv.classList.toggle('open') : false;
    if (!open) closeAllDD();   // sin esto, plegar los avanzados dejaba un menú colgando
    const tog = document.getElementById('cv-adv-toggle');
    if (tog) tog.classList.toggle('open', open);
    const head = document.getElementById('cv-header');
    if (head) head.classList.toggle('adv-on', open);
  };
  // ── Desplegables (Robo / Bloquear / +Daño): un solo modo activo cada uno ──
  function closeAllDD() {
    document.querySelectorAll('.cv-dd-wrap.open').forEach(w => w.classList.remove('open'));
    syncDDClip();
  }
  // El menú de un desplegable es ABSOLUTO y cae por DEBAJO de su pill, así que lo recortaban
  // dos `overflow:hidden`: el de la propia pill segmentada (`.cv-chip-group`, que redondea sus
  // chips) y el de `#cv-adv-body` (que hace posible la animación de abrir/cerrar los avanzados).
  // Resultado: el menú se abría de verdad pero quedaba cortado — invisible y no clicable (al
  // pulsar donde debería estar tocabas el chip de detrás). Mientras haya uno abierto, se marca
  // la vista y esos dos contenedores dejan de recortar; al cerrarlo vuelven a hacerlo.
  function syncDDClip() {
    const v = document.getElementById('view-cards');
    const open = !!document.querySelector('.cv-dd-wrap.open');
    if (v) v.classList.toggle('cv-dd-open', open);
    const h = window.pbCardsSurface && window.pbCardsSurface.host();
    if (h) h.classList.toggle('cv-dd-open', open);
    const mz = document.getElementById('view-mazos');
    if (mz) mz.classList.toggle('cv-dd-open', open);
  }
  function updateDDChip(which) {
    const wrap = document.getElementById('cv-dd-' + which);
    if (!wrap) return;
    const mode = F[which + 'Mode'];
    const chip = wrap.querySelector('.cv-eff-dd');
    if (chip) chip.classList.toggle('active', mode != null);
    wrap.classList.toggle('active', mode != null);   // activa la × para quitar de un clic
    wrap.querySelectorAll('[data-dd-opt]').forEach(b => b.classList.toggle('sel', b.getAttribute('data-dd-opt') === mode));
    const modeSpan = wrap.querySelector('.cv-dd-mode');
    if (modeSpan) {
      if (mode && mode !== 'all') { const b = wrap.querySelector('[data-dd-opt="' + mode + '"]'); modeSpan.textContent = b ? ('· ' + b.textContent.trim()) : ''; }
      else modeSpan.textContent = '';
    }
  }
  window._cvRefreshAdvUI = function () { Object.keys(DD_DIMS).forEach(updateDDChip); cvSyncAdvCount(); };
  window._cvDD = function (e, which) {
    e.stopPropagation();
    const wrap = document.getElementById('cv-dd-' + which);
    if (!wrap) return;
    const wasOpen = wrap.classList.contains('open');
    closeAllDD();
    if (!wasOpen) wrap.classList.add('open');
    syncDDClip();
  };
  window._cvSetMode = function (which, mode) {
    const key = which + 'Mode';
    F[key] = (F[key] === mode) ? null : mode;
    if (F[key] != null && F.notDD.has(which)) {          // «con robo» y «sin robo» se excluyen
      F.notDD.delete(which);
      const w = document.getElementById('cv-dd-' + which); if (w) w.classList.remove('excluded');
    }
    updateDDChip(which);
    closeAllDD();
    cvSyncAdvCount();
    runFilter();
  };
  // Quitar un desplegable activo de un clic (la × del chip), sin reabrir el menú.
  window._cvClearMode = function (e, which) {
    if (e) e.stopPropagation();
    F[which + 'Mode'] = null;
    updateDDChip(which);
    cvSyncAdvCount();
    runFilter();
  };
  window._cvToggleCond = function (el, cond, neg) {
    if (neg) {
      if (F.notConditions.has(cond)) { F.notConditions.delete(cond); el.classList.remove('excluded'); }
      else { F.notConditions.add(cond); F.conditions.delete(cond); el.classList.remove('active'); el.classList.add('excluded'); }
    } else if (F.conditions.has(cond)) { F.conditions.delete(cond); el.classList.remove('active'); }
    else { F.conditions.add(cond); F.notConditions.delete(cond); el.classList.remove('excluded'); el.classList.add('active'); }
    cvSyncAdvCount();
    runFilter();
  };
  document.addEventListener('click', e => { if (!e.target.closest('.cv-dd-wrap')) closeAllDD(); });

  // ── COMPONENTE COMPARTIDO: desplegable de EXPANSIÓN / SOBRE ────────────────────
  // Una sola implementación para los DOS buscadores que lo usan (pestaña Cartas y el
  // constructor de Barajas) — antes el constructor tenía un <select> nativo pelado, sin
  // sobres ni miniaturas. Se monta dentro de un HOST y no guarda estado propio: lee y
  // escribe el valor por callbacks, así cada sitio conserva su almacén.
  //   valor ''  = todas · 'A1' = expansión entera · 'A1|Mewtwo' = un sobre concreto
  const escAttr = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function cvSetOptions(order) {
    const DB = window.CARDS_DB || [];
    const present = new Set(DB.map(c => c.set).filter(Boolean));
    // 'game' = orden real del juego (SET_ORDER) · por defecto, alfabético por código.
    const sets = (order === 'game' && window.SET_ORDER)
      ? window.SET_ORDER.filter(s => present.has(s))
      : [...present].sort();
    return sets.map(s => ({ set: s, name: window.setName ? window.setName(s) : s, packs: (window.setPacks ? window.setPacks(s) : []) }));
  }
  function cvSetEntryName(set, pack) {
    // Un sobre cuyo nombre repite el de la expansión (sets de un solo sobre) → el del set.
    const sn = window.setName ? window.setName(set) : set;
    const en = (window.SET_NAMES || {})[set] || '';
    return (pack && pack.toLowerCase() !== en.toLowerCase()) ? pack : sn;
  }

  const _SET_HOSTS = [];   // hosts montados (para re-pintarlos al cambiar de idioma)
  function _setPrune() { for (let i = _SET_HOSTS.length - 1; i >= 0; i--) if (!_SET_HOSTS[i].isConnected) _SET_HOSTS.splice(i, 1); }
  function _setCfg(host) { return host && host._pbSet; }

  function _setBuildMenu(host) {
    const cfg = _setCfg(host); if (!cfg) return;
    const menu = host.querySelector('.pb-set-menu'); if (!menu) return;
    let h = '<button class="cv-set-opt" data-val="">' +
            '<span class="cv-set-optthumb"></span><span class="cv-set-optname">' + escAttr(cfg.allLabel()) + '</span></button>';
    cvSetOptions(cfg.order).forEach(o => {
      const multi = o.packs.length > 1;
      const th = (!multi && o.packs[0]) ? '<img src="' + escAttr(o.packs[0].thumb) + '" alt="" draggable="false">' : '';
      h += '<div class="cv-set-row' + (multi ? ' has-sub' : '') + '">' +
           '<button class="cv-set-opt" data-val="' + escAttr(o.set) + '">' +
             '<span class="cv-set-optthumb">' + th + '</span>' +
             '<span class="cv-set-optname">' + escAttr(o.name) + '</span>' +
             '<span class="cv-set-optcode">' + escAttr(o.set) + '</span>' +
             (multi ? '<span class="cv-set-exp" data-exp="' + escAttr(o.set) + '" role="button" aria-label="' + escAttr(o.name) + '">' +
                '<svg viewBox="0 0 16 16" width="11" height="11" fill="none"><path d="M6 3.5l4.5 4.5L6 12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></span>' : '') +
           '</button>';
      if (multi) {
        h += '<div class="cv-set-sub">' + o.packs.map(p =>
          '<button class="cv-set-opt cv-set-subopt" data-val="' + escAttr(o.set + '|' + p.pack) + '">' +
            '<span class="cv-set-optthumb"><img src="' + escAttr(p.thumb) + '" alt="" draggable="false"></span>' +
            '<span class="cv-set-optname">' + escAttr(p.pack) + '</span></button>').join('') + '</div>';
      }
      h += '</div>';
    });
    menu.innerHTML = '<div class="cv-set-scroll">' + h + '</div>';
    menu.querySelectorAll('.cv-set-opt').forEach(b => {
      b.addEventListener('click', e => {
        // la flecha ▸ despliega la sub-lista sin elegir la expansión entera
        if (e.target.closest('.cv-set-exp')) {
          e.stopPropagation();
          const row = b.closest('.cv-set-row'); if (row) row.classList.toggle('open');
          return;
        }
        _setPick(host, b.dataset.val);
      });
    });
    _setSyncUI(host);
  }
  // Refleja el valor en el botón (miniatura + texto) y en la lista.
  function _setSyncUI(host) {
    const cfg = _setCfg(host); if (!cfg) return;
    const val = cfg.get() || '';
    const parts = val.split('|'), set = parts[0], pack = parts[1];
    const lab = host.querySelector('.pb-set-label'), th = host.querySelector('.pb-set-thumb');
    if (lab) lab.textContent = val ? cvSetEntryName(set, pack) : cfg.allLabel();
    if (th) {
      const packs = set ? (window.setPacks ? window.setPacks(set) : []) : [];
      const one = pack ? packs.find(p => p.pack === pack) : (packs.length === 1 ? packs[0] : null);
      th.innerHTML = one ? '<img src="' + escAttr(one.thumb) + '" alt="" draggable="false">' : '';
    }
    host.classList.toggle('pb-set-on', !!val);
    host.querySelectorAll('.cv-set-opt').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    // deja abierta la sub-lista de la expansión elegida
    host.querySelectorAll('.cv-set-row.has-sub').forEach(r => {
      const own = r.querySelector('.cv-set-opt').dataset.val;
      if (set && own === set) r.classList.add('open');
    });
  }
  function _setPick(host, val) {
    const cfg = _setCfg(host); if (!cfg) return;
    cfg.set(val);
    _setSyncUI(host);
    const menu = host.querySelector('.pb-set-menu'); if (menu) menu.style.display = 'none';
    if (cfg.onChange) cfg.onChange(val);
  }
  function _setToggle(host) {
    const menu = host.querySelector('.pb-set-menu'); if (!menu) return;
    const open = menu.style.display !== 'none';
    if (!open && !menu.children.length) _setBuildMenu(host);
    menu.style.display = open ? 'none' : 'block';
    if (!open) _setFit(host, menu);
  }
  // El alto del menú estaba calibrado para el ancla de Cartas (arriba del todo). En el
  // constructor de mazos el disparador queda muy abajo y se salía de la pantalla → se capa
  // por el hueco REAL, y si abajo no cabe se abre hacia ARRIBA.
  function _setFit(host, menu) {
    const scr = menu.querySelector('.cv-set-scroll'); if (!scr) return;
    scr.style.maxHeight = ''; menu.style.top = ''; menu.style.bottom = '';
    const trg = host.querySelector('.pb-set-trigger'); if (!trg) return;
    const r = trg.getBoundingClientRect(), M = 14;
    const abajo = window.innerHeight - r.bottom - M, arriba = r.top - M;
    const arribaMejor = abajo < 220 && arriba > abajo;
    if (arribaMejor) { menu.style.top = 'auto'; menu.style.bottom = 'calc(100% + 6px)'; }
    // El menú tiene padding/borde propios: el hueco es para el CONTENEDOR, no para la lista.
    const chrome = Math.max(0, menu.offsetHeight - scr.offsetHeight);
    scr.style.maxHeight = Math.max(160, Math.floor((arribaMejor ? arriba : abajo) - chrome - 8)) + 'px';
  }

  // API pública. `mount` es idempotente: re-montar sobre el mismo host re-pinta.
  window.pbSetPicker = {
    //  opts = { get:()=>valor, set:(v)=>void, onChange:(v)=>void, allLabel:()=>texto, order:'game'|undefined }
    mount: function (host, opts) {
      if (!host) return;
      host._pbSet = Object.assign({ allLabel: () => (window.t ? window.t('cards.allSets') : 'Todas las expansiones') }, opts || {});
      if (!host.querySelector('.pb-set-trigger')) {
        host.classList.add('pb-set-wrap');
        const trg = document.createElement('button');
        trg.type = 'button'; trg.className = 'pb-set-trigger';
        trg.innerHTML = '<span class="pb-set-thumb"></span><span class="pb-set-label"></span>' +
          '<svg viewBox="0 0 16 16" width="10" height="10" fill="none" aria-hidden="true"><path d="M4 6.5l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        trg.addEventListener('click', () => _setToggle(host));
        const menu = document.createElement('div');
        menu.className = 'pb-set-menu'; menu.style.display = 'none';
        host.appendChild(trg); host.appendChild(menu);
      }
      _setPrune();
      if (_SET_HOSTS.indexOf(host) < 0) _SET_HOSTS.push(host);
      // El menú se pinta perezoso al abrirlo; el botón sí refleja el valor ya.
      const m = host.querySelector('.pb-set-menu');
      if (m && m.children.length) _setBuildMenu(host); else _setSyncUI(host);
    },
    refresh: function (host) {
      if (!host) { _setPrune(); _SET_HOSTS.slice().forEach(h => window.pbSetPicker.refresh(h)); return; }
      const m = host.querySelector('.pb-set-menu');
      if (m && m.children.length) _setBuildMenu(host); else _setSyncUI(host);
    },
    sync:  function (host) { _setSyncUI(host); },
    close: function (host) { const m = host && host.querySelector('.pb-set-menu'); if (m) m.style.display = 'none'; },
    unmount: function (host) { const i = _SET_HOSTS.indexOf(host); if (i >= 0) _SET_HOSTS.splice(i, 1); if (host) host._pbSet = null; },
  };
  // Un ÚNICO listener de «clic fuera» para todos los pickers (antes iba acotado a #cv-set-wrap).
  document.addEventListener('click', e => {
    _setPrune();
    const inside = e.target.closest('.pb-set-wrap');
    _SET_HOSTS.forEach(h => { if (h !== inside) window.pbSetPicker.close(h); });
  });

  // ── Cartas: el <select id="cv-set"> OCULTO sigue siendo el almacén del valor (lo leen
  //    runFilter, «Limpiar» y el contador de filtros activos); el picker es solo la piel.
  function cvSetHost() { return document.getElementById('cv-set-wrap'); }
  function cvMountSetPicker() {
    const host = cvSetHost(); if (!host) return;
    window.pbSetPicker.mount(host, {
      get: () => { const sel = document.getElementById('cv-set'); return sel ? sel.value : ''; },
      set: v => {
        const sel = document.getElementById('cv-set'); if (!sel) return;
        // el <select> solo tiene opciones por SET → para un sobre concreto se añade al vuelo
        if (v && !Array.prototype.some.call(sel.options, o => o.value === v)) {
          const o = document.createElement('option'); o.value = v; sel.appendChild(o);
        }
        sel.value = v;
      },
      onChange: () => { if (window._cvFilter) window._cvFilter(); },
    });
  }
  // Compatibilidad: los nombres viejos siguen valiendo (index.html, langchange, «Limpiar»).
  function cvBuildSetMenu() { cvMountSetPicker(); window.pbSetPicker.refresh(cvSetHost()); }
  function cvSyncSetUI() { const h = cvSetHost(); if (h && h._pbSet) _setSyncUI(h); }
  window._cvSyncSetUI = cvSyncSetUI;
  window._cvRebuildSetMenu = cvBuildSetMenu;
  window._cvToggleSetMenu = () => { const h = cvSetHost(); if (h) { if (!h._pbSet) cvMountSetPicker(); _setToggle(h); } };
  window._cvPickSet = val => { const h = cvSetHost(); if (h) { if (!h._pbSet) cvMountSetPicker(); _setPick(h, val); } };

  // Táctil de puntero grueso: en móvil el tilt hover de las miniaturas estorba
  // al scroll (mousemove sintético dispara el rAF y traba el desplazamiento).
  const CV_COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  // ── Carga de imágenes de la rejilla (pedido por Daniel) ──
  // Al abrir/filtrar: NO se muestran cartas → un CÍRCULO de carga hasta que la primera pantalla
  // está lista, y entonces aparece ya cargada. Si tarda más de CV_LOAD_FALLBACK, se revela lo que
  // haya (esqueleto en lo que falta) para ver el progreso. Al hacer scroll, cada carta funde al cargar.
  const CV_LOAD_FALLBACK = 2500;   // ms antes de mostrar la rejilla parcial (fallback)
  let _cvImgObs = null;
  let _cvRenderTok = 0;   // invalida los callbacks/timeouts de una carga anterior (filtros rápidos)
  // Precarga una imagen; si la localizada (es/ja) falla, reintenta con la CANÓNICA en inglés
  // (GitHub raw) → una carta suelta que no cargue por el CDN localizado igualmente aparece.
  function cvPreload(url, cb, card) {
    const im = new Image();
    im.onload = () => cb(url);
    im.onerror = () => {
      const id = (card && card.id) || (window.cardIdFromImage && window.cardIdFromImage(url));
      let en = id && window.dbLookup ? (window.dbLookup({ id: id }) || {}).image : null;
      if (en && window._normImg) en = window._normImg(en);   // la canónica local es RELATIVA → normalizar (en /es/cartas resolvía contra /es/ y el reintento también fallaba)
      const c = card || cvFindCard(id);
      // Último recurso: la MISMA url con cache-buster — sanea una entrada de caché envenenada
      // (p. ej. un 404→HTML cacheado durante la propagación de un deploy). Si TAMPOCO carga
      // (o sea, no hay arte local para esta carta), se genera el placeholder — nunca gris roto,
      // y nunca se pide nada a un servidor externo.
      const placeholder = () => cb(cvPlaceholderCard(c));
      const retry = done => { const im3 = new Image(); im3.onload = () => done(retry._u); im3.onerror = placeholder; im3.src = retry._u; };
      retry._u = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'r=1';
      if (en && en !== url) { const im2 = new Image(); im2.onload = () => cb(en); im2.onerror = () => retry(cb); im2.src = en; }
      else retry(cb);
    };
    if (!url) { placeholderNow(); return; }
    im.src = url;
    function placeholderNow() { cb(cvPlaceholderCard(card)); }
  }
  // Pinta el fondo (si cargó) y funde la carta (quita el esqueleto). Idempotente.
  function cvReveal(el, okUrl) {
    if (!el || el._cvSet) return;
    el._cvSet = true;
    if (okUrl) { window.setCardBg ? window.setCardBg(el, okUrl) : (el.style.backgroundImage = `url("${okUrl}")`); }
    el.classList.add('cv-img-loaded');
  }
  // Diferida con fundido individual (scroll): descarga al acercarse al viewport y revela al cargar.
  function cvLazyImg(el) {
    if (!el || !el._cvUrl) { el && cvReveal(el, el && el._cvCard ? cvPlaceholderCard(el._cvCard) : null); return; }
    if (!('IntersectionObserver' in window)) { cvPreload(el._cvUrl, u => cvReveal(el, u), el._cvCard); return; }
    if (!_cvImgObs) {
      _cvImgObs = new IntersectionObserver(ents => {
        ents.forEach(en => {
          if (!en.isIntersecting) return;
          const t = en.target; _cvImgObs.unobserve(t);
          if (t._cvUrl) cvPreload(t._cvUrl, u => cvReveal(t, u), t._cvCard);
        });
      }, { root: document.getElementById('cv-body'), rootMargin: '400px 0px' });
    }
    _cvImgObs.observe(el);
  }
  // Círculo de carga en el cuerpo de Cartas (mientras la rejilla está oculta).
  function cvShowLoading(show) {
    const body = document.getElementById('cv-body'); if (!body) return;
    let sp = document.getElementById('cv-loading');
    if (show) {
      if (!sp) { sp = document.createElement('div'); sp.id = 'cv-loading'; sp.innerHTML = '<div class="cv-loading-spin"></div>'; }
      body.appendChild(sp);
    } else if (sp) { sp.remove(); }
  }
  // Cuántas cartas caben en la 1ª pantalla (columnas × filas visibles + 1) → cuántas precargar
  // antes de revelar. Se calcula sin depender del layout (la rejilla está oculta al medir).
  function cvFirstScreenCount() {
    const grid = document.getElementById('cv-grid'), body = document.getElementById('cv-body');
    const gap = 12, bw = (body.clientWidth || window.innerWidth) - 32;
    let cols;
    if (window.matchMedia('(max-width: 720px)').matches) {
      cols = parseInt(getComputedStyle(grid).getPropertyValue('--cv-cols'), 10) || 3;
    } else { cols = Math.max(1, Math.floor((bw + gap) / (120 + gap))); }
    const colW = (bw - (cols - 1) * gap) / cols;
    const cardH = colW * 559 / 400 + 26;   // + info bajo la carta
    const rows = Math.ceil((body.clientHeight || window.innerHeight) / (cardH + gap)) + 1;
    return Math.max(cols, cols * rows);
  }

  let _view = 'grid';         // 'grid' | 'table'
  let _lastResults = [];      // cache for "Aplicar al buscador"
  let _page = 0;
  const PAGE_SIZE = 80;
  let _scrollObs = null;

  // ── Init ───────────────────────────────────────────────────────
  function initCardsView() {
    window._cvInitialised = true;
    const DB = window.CARDS_DB || [];

    // Populate set dropdown with full names
    const sets = [...new Set(DB.map(c => c.set).filter(Boolean))].sort();
    const selSet = document.getElementById('cv-set');
    sets.forEach(s => {
      const o = document.createElement('option');
      o.value = s;
      const name = window.setName ? window.setName(s) : SET_NAMES[s];
      o.textContent = name ? `${name} (${s})` : s;
      selSet.appendChild(o);
    });
    cvBuildSetMenu();   // piel del desplegable (miniaturas de sobre + sub-lista por sobre)

    // Enable ability toggle if DB has ability data
    if (DB.some(c => c.hasAbility === true || c.hasAbility === false)) {
      const inp = document.getElementById('cv-ability-only');
      if (inp) inp.disabled = false;
    }

    // Expose filter function
    window._cvToggleSortMenu = () => {
      const menu = document.getElementById('cv-sort-menu');
      if (!menu) return;
      const open = menu.style.display !== 'none';
      menu.style.display = open ? 'none' : 'block';
    };

    window._cvSetSort = (by, el) => {
      if (F.sortBy === by) {
        F.sortDir = F.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        F.sortBy  = by;
        F.sortDir = (by === 'set' || by === 'usage') ? 'desc' : 'asc';
      }
      // Update dropdown options — ACOTADO a #cv-sort-menu: la Tier List reutiliza la clase
      // .cv-sort-opt en su propio menú (#tls-sort-menu) y un selector global le borraba el resaltado.
      document.querySelectorAll('#cv-sort-menu .cv-sort-opt').forEach(b => {
        const active = b.dataset.sort === F.sortBy;
        b.classList.toggle('active', active);
        const arrow = b.querySelector('.cv-sort-arrow');
        if (arrow) arrow.textContent = active ? (F.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
      });
      // Update trigger label
      const sortNames = {set:T('cards.sortSet'),type:T('cards.sortType'),rarity:T('cards.sortRarity'),name:T('cards.sortName'),usage:T('cards.sortUsage')};
      const label = document.getElementById('cv-sort-label');
      if (label) label.textContent = (sortNames[F.sortBy] || F.sortBy) + (F.sortDir === 'asc' ? ' ↑' : ' ↓');
      // Close menu
      const menu = document.getElementById('cv-sort-menu');
      if (menu) menu.style.display = 'none';
      runFilter();
    };
    // Render initial cost slots (3 empty circles)
    renderCostZone();

    // Inject real energy orb images into element filter chips
    document.querySelectorAll('.cv-el-chip').forEach(chip => {
      const type    = chip.dataset.cvEl;
      const iconKey = window.ORB_ICON_KEY && window.ORB_ICON_KEY[type];
      const src     = (iconKey && ((window.ENERGY_ICONS && window.ENERGY_ICONS[iconKey]) || (window.ORB_ICONS && window.ORB_ICONS[iconKey])))
                   || (type === 'dragon' ? DRAGON_EL_ICON : null);
      if (src) {
        chip.innerHTML = `<img src="${src}" style="width:20px;height:20px;border-radius:50%;pointer-events:none;" draggable="false">`;
      }
    });

    // Pill de Estados: usa los PNG reales de estado del tablero (window.STATUS_ICONS), igual que el tablero.
    if (window.STATUS_ICONS) {
      document.querySelectorAll('.cv-cond-chip[data-cond-icon]').forEach(chip => {
        const src = window.STATUS_ICONS[chip.dataset.condIcon];
        if (src) chip.innerHTML = `<img class="cv-cond-img" src="${src}" draggable="false">`;
      });
    }
    cvUpdateTextLang();   // aviso "solo inglés" de la búsqueda por texto

    cvLocalize(); // chips tipo/fase/elemento + etiqueta de orden al idioma actual

    window._cvToggleRar = (el, rar, neg) => {
      if (neg) {
        if (F.notRarities.has(rar)) { F.notRarities.delete(rar); el.classList.remove('excluded'); }
        else { F.notRarities.add(rar); F.rarities.delete(rar); el.classList.remove('active'); el.classList.add('excluded'); }
      } else if (F.rarities.has(rar)) { F.rarities.delete(rar); el.classList.remove('active'); }
      else {
        F.rarities.add(rar); F.notRarities.delete(rar);
        el.classList.remove('excluded'); el.classList.add('active');
        window._cvChipBurst(el, 'rar', rar);
      }
      runFilter();
    };
    window._cvFilter          = runFilter;
    window._cvToggle          = toggleChip;
    window._cvSetView         = setView;
    window._cvApplyToSearch   = applyToSearch;
    window._cvApplyToTierlist = applyToTierlist;
    window._cvAddFilterEnergy = addFilterEnergy;

    // Estallido de los chips de mecánica (Ultra Ente / Pasado / Futuro / EX / Mega / Habilidad).
    // Van por el onchange de checkbox oculto, no por toggleChip → se cablea aquí, pero los
    // OPTS viven en _cvChipBurst (fuente única, disponible sin abrir Cartas → el builder de
    // Mazos también los usa). Aquí solo se DELEGA.
    window._cvMechBurst = (which, on, el) => { if (on && el) window._cvChipBurst(el, which, which); };

    window._cvSetOp           = setOp;
    window._cvClearCost    = () => { F.attackCost = []; { const cc = document.getElementById('cv-cost-count'); if (cc) cc.value = ''; } renderCostZone(); runFilter(); };
    window._cvCostCountChanged = () => {
      const cc = document.getElementById('cv-cost-count');
      const clear = document.querySelector('.cv-cost-clear-btn');
      if (clear) clear.style.visibility = (F.attackCost.length > 0 || (cc && cc.value !== '')) ? 'visible' : 'hidden';
      runFilter();
    };
    window._cvSetCostMode  = (mode, el) => {
      F.costMode = mode;
      document.getElementById('cv-cost-mode-group').querySelectorAll('.cv-op-btn').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      runFilter();
    };

    cvRenderRarityIcons();  // sustituye los glifos ◇/☆ de los chips por los PNG reales
    runFilter();
    cvApplyResponsive();   // móvil: mueve los filtros a la hoja si toca
  }

  // Pinta los iconos PNG de rareza en los chips estáticos del filtro (Promo se queda texto).
  function cvRenderRarityIcons() {
    if (!window.rarityIconHTML) return;
    document.querySelectorAll('#cv-filters .cv-rar-chip').forEach(chip => {
      const ih = window.rarityIconHTML(chip.dataset.rar);
      if (ih) chip.innerHTML = ih;
    });
  }

  // ── Paletas del "estallido" jugoso al activar un filtro (estilo Duolingo) ──
  // El color refleja el filtro pulsado; el efecto vive en pbJuicyBurst (shared.js)
  // y respeta «Reducir animaciones». Solo se dispara al ACTIVAR (no al quitar).
  const CV_BURST = {
    type: {
      pokemon:  ['#7de87d', '#aef0ae'], item:     ['#7ab8ff', '#bfe0ff'],
      tool:     ['#ffd060', '#ffe6a8'], supporter:['#d88aff', '#ecc4ff'],
      stadium:  ['#5ee0e0', '#b6f3f3'], fossil:   ['#c4c4c4', '#e8e8e8'],
    },
    el: {
      grass:    ['#5ec98f', '#a8e8c4'], fire:     ['#ff6b54', '#ffb09e'],
      water:    ['#5a9cff', '#a8ccff'], lightning:['#ffd23b', '#ffe89a'],
      psychic:  ['#cf7be0', '#ecc0f4'], fighting: ['#d08a4a', '#ecc196'],
      darkness: ['#8a8ac0', '#bcbce4'], metal:    ['#a8b8cc', '#d4dde8'],
      dragon:   ['#7a7ae0', '#bcbcf0'], colorless:['#d0d0d0', '#efefef'],
    },
  };
  const CV_BURST_NEUTRAL = ['#ffffff', '#cfd6e6'];
  // Color de ACENTO por tipo de energía para teñir su partícula (símbolo coloreado,
  // no negro). Oscuridad / incoloro subidos de luminosidad para que se lean.
  const CV_ENERGY_ACCENT = {
    grass: '#5ec98f', fire: '#ff6b54', water: '#5a9cff', lightning: '#ffd23b',
    psychic: '#cf7be0', fighting: '#d08a4a', darkness: '#9b9be6', metal: '#aebccf',
    dragon: '#9a8af0', colorless: '#e2e2e2',
  };
  // Rareza → partículas que la "evocan", con cantidad INCREMENTAL según el nivel:
  // diamantes 4>3>2>1, estrellas IM>SAR>AR, shiny ✸✸>✸. Corona = dorada dominante
  // con un toque multicolor (distinta del arcoíris pleno de shiny). Promo neutra.
  function rarBurstOpts(rar) {
    // Diamantes (plateado): 4 se queda; 3/2/1 descienden.
    if (rar === '◊◊◊◊') return { colors: ['#e6edf7', '#b9c4d6', '#ffffff', '#9fb0c8'], count: 7, spread: 22 };
    if (rar === '◊◊◊')  return { colors: ['#e6edf7', '#b9c4d6', '#ffffff'], count: 6, spread: 20 };
    if (rar === '◊◊')   return { colors: ['#e6edf7', '#b9c4d6'], count: 5, spread: 18 };
    if (rar === '◊')    return { colors: ['#dfe6f0', '#ffffff'], count: 4, spread: 16 };
    // Estrellas (dorado): IM(3) > SAR(2) > AR(1).
    if (rar === 'IM')   return { colors: ['#ffd95e', '#ffe9a0', '#ffbf3b', '#fff3c4'], count: 8, spread: 22 };
    if (rar === 'SAR')  return { colors: ['#ffd95e', '#ffe9a0', '#ffbf3b'], count: 6, spread: 20 };
    if (rar === 'AR')   return { colors: ['#ffd95e', '#ffe9a0'], count: 4, spread: 17 };
    // Shiny (multicolor + halo arcoíris): ✸✸ > ✸.
    if (rar === '✸✸')  return { colors: ['#ff7eb0', '#ffd95e', '#7ad7ff', '#a98bff', '#7de8a0', '#ffffff'], count: 10, ring: true, ringRainbow: true };
    if (rar === '✸')   return { colors: ['#ff7eb0', '#7ad7ff', '#a98bff', '#7de8a0'], count: 7, ring: true, ringRainbow: true, ringScale: 1.5 };
    // Corona (la más alta): dorada dominante + un toque multicolor.
    if (rar === '♕')   return { colors: ['#ffe07a', '#fff3c4', '#ffbf3b', '#ffe07a', '#ff9ed1', '#ffe07a', '#8fdcff'], count: 11, ring: true, ringRainbow: true, ringScale: 1.8 };
    return { colors: CV_BURST_NEUTRAL, count: 6 };  // Promo
  }
  // Orbe de energía REAL de un elemento (PNG transparente) para usarlo de partícula.
  // El dragón no tiene orbe de energía en Pocket → usa el icono de dragón que subió
  // Daniel (window.DRAGON_EL_ICON, el mismo que se usa para el tipo en toda la web).
  function cvOrbSrc(type) {
    if (type === 'dragon') return window.DRAGON_EL_ICON || null;
    const key = window.ORB_ICON_KEY && window.ORB_ICON_KEY[type];
    if (!key) return null;
    return (window.ORB_ICONS && window.ORB_ICONS[key]) ||
           (window.ENERGY_ICONS && window.ENERGY_ICONS[key]) || null;
  }

  // Estallido de un chip de filtro AL ACTIVARLO. Fuente ÚNICA reutilizada por Cartas
  // (toggleChip / _cvToggleRar) Y por el buscador del builder de Mazos (window._cvChipBurst).
  // Solo al activar; cada tipo de filtro tiene su efecto/paleta.
  window._cvChipBurst = function (el, kind, value) {
    if (!el || !window.pbJuicyBurst) return;
    if (kind === 'stage') {
      // Fase evolutiva: básico = solo rebote; Fase 1/2 = "colocar evolución"
      // (1 ó 2 clones con la forma del botón que caen encima, smooth y sutil).
      if (value === '1')      window.pbJuicyBurst(el, { evolveStack: 1, bounce: true });
      else if (value === '2') window.pbJuicyBurst(el, { evolveStack: 2, bounce: true, evolveTravel: 18, evolveDur: 620, evolveOpacity: 0.95, evolveDelay: 150 });
      else                    window.pbJuicyBurst(el, { popOnly: true, bounce: true });
    } else if (kind === 'el') {
      // Tipo de energía: el ORBE real teñido del color de ACENTO de ese tipo.
      // DRAGÓN: no hay orbe de energía en Pocket; su icono es un disco dorado con el
      // dragón dentro → la partícula usa SOLO el glifo del dragón (sin el disco),
      // teñido del DORADO de su orbe: así se reconoce el tipo, igual que el resto lleva
      // el color del suyo (feedback de Daniel 2026-08-15).
      const src = value === 'dragon' ? DRAGON_GLYPH_ICON : cvOrbSrc(value);
      const acc = value === 'dragon' ? DRAGON_ORB_COLOR : (CV_ENERGY_ACCENT[value] || '#dddddd');
      window.pbJuicyBurst(el, src
        ? { icon: src, iconTint: acc, count: 5, spread: 24, iconSize: value === 'dragon' ? 17 : 15 }
        : { colors: [acc], count: 5 });
    } else if (kind === 'trend') {
      // Tendencia del meta (nuevo / en alza / en caída): la paleta de su estado.
      const P = { new: ['#78aaff', '#cfe3ff', '#ffffff'], rising: ['#6fe6a0', '#aef0c8', '#dff7e8'], falling: ['#ff8f8f', '#ffc2c2', '#ffe3e3'] };
      window.pbJuicyBurst(el, { colors: P[value] || CV_BURST_NEUTRAL, count: 5, spread: 17,
        upward: value === 'rising', rise: value === 'rising' ? 9 : (value === 'falling' ? -6 : 0),
        ring: value === 'new', ringScale: 1.26, ringBand: 3, ringOpacity: 0.28 });
    } else if (kind === 'type') {
      // Tipo de carta: "ping" de color FINO (anillo poco intenso) + pocas partículas.
      window.pbJuicyBurst(el, { colors: (CV_BURST.type[value] || CV_BURST_NEUTRAL), count: 4, spread: 16, ring: true, ringScale: 1.28, ringBand: 3, ringOpacity: 0.3 });
    } else if (kind === 'rc') {
      // Coste de retirada: orbes INCOLOROS que popean hacia arriba, 1 por coste.
      if (value === '0') {
        window.pbJuicyBurst(el, { ring: true, ringScale: 1.22, ringBand: 3, ringOpacity: 0.16, colors: ['#cfd6e6'], count: 0 });
      } else {
        const n = value === '4+' ? 4 : Number(value);
        const orb = cvOrbSrc('colorless');
        window.pbJuicyBurst(el, orb
          ? { icon: orb, iconTint: '#e6e6e6', count: n, upward: true, iconSize: 13, spread: 12 }
          : { colors: ['#e6e6e6'], count: n, upward: true });
      }
    } else if (kind === 'rar') {
      window.pbJuicyBurst(el, rarBurstOpts(value));
    } else if (kind === 'ub') {
      // Ultra Ente: GLITCH dimensional — corte cromático rojo/cian + píxeles fuera del botón.
      window.pbJuicyBurst(el, { glitch: true, colors: ['#ff3355', '#38e1ff'], count: 8, spread: 38, splitX: 3, glitchDur: 480 });
    } else if (kind === 'past') {
      // Pasado: ÁMBAR — resplandor cálido + motas doradas suspendidas (lentas).
      window.pbJuicyBurst(el, { glow: '#e8a13a', glowDur: 800, colors: ['#e8a13a', '#ffcf6b', '#fff3d6'], count: 5, spread: 18, rise: 8, size: 3, dur: 1100 });
    } else if (kind === 'future') {
      // Futuro: MATERIALIZACIÓN HOLOGRÁFICA — barrido de escaneo + partículas en su sitio.
      window.pbJuicyBurst(el, { scan: '#37e0ff', scanDur: 580, materialize: true, colors: ['#37e0ff', '#dfe9f2', '#8b6bff'], count: 5, spread: 15 });
    } else if (kind === 'tr') {
      // Team Rocket: el mismo destello rojo EN SU SITIO que el de Habilidad (lo pidió Daniel)
      // y encima la «R» del emblema, ROJA ENTERA y recta (el logo no es en cursiva; la
      // itálica del logo es cosa del «ex»). Dos llamadas porque tagClone sale antes de
      // dibujar nada más.
      window.pbJuicyBurst(el, { tagClone: true, tagFill: 'rgba(206,36,34,0.30)', tagBorder: '#e0332b',
        tagGlowColor: 'rgba(226,44,38,0.65)', tagGlow: 5, tagDur: 700 });
      window.pbJuicyBurst(el, { logoText: 'R', logoItalic: false, logoTrack: 0, logoSize: 34, logoDur: 900,
        logoGrad: 'linear-gradient(180deg,#ff4b3f,#c8120b)', logoGlow: 'rgba(226,40,32,0.85)', count: 0 });
    } else if (kind === 'ex') {
      // EX: el logo «ex» se superpone LENTO + unas chispas doradas.
      window.pbJuicyBurst(el, { logoText: 'ex', logoDur: 1300, logoSize: 28, sharp: true, colors: ['#ffd95e', '#fff0c0', '#dbe6ff'], count: 5, spread: 22 });
    } else if (kind === 'mega') {
      // Mega: ESPIRAL multicolor + halo arcoíris difuso que viaja poco.
      window.pbJuicyBurst(el, { swirl: true, colors: ['#ff4d6d', '#ffd24d', '#5dff8f', '#4dd2ff', '#8b6bff'], count: 8, spread: 30,
        ring: true, ringRainbow: true, ringScale: 1.3, ringBand: 8, ringOpacity: 0.45, ringDuration: 780, ringBlur: 5 });
    } else if (kind === 'ability') {
      // Habilidad: etiqueta roja EN SU SITIO (pop+fade) + brillo de radio pequeño.
      window.pbJuicyBurst(el, { tagClone: true, tagFill: 'rgba(208,58,58,0.28)', tagBorder: '#e0443c', tagGlowColor: 'rgba(224,68,60,0.6)', tagGlow: 4, tagDur: 660 });
    } else {
      window.pbJuicyBurst(el, { colors: CV_BURST_NEUTRAL, count: 5 });
    }
  };

  // ── Chip toggle ────────────────────────────────────────────────
  const SETS_IN  = { type: 'types', el: 'els', stage: 'stages', effect: 'effects', rc: 'rcs' };
  const SETS_OUT = { type: 'notTypes', el: 'notEls', stage: 'notStages', effect: 'notEffects', rc: 'notRcs' };

  // Tres estados por chip: neutro → incluido (clic) → excluido (clic derecho / mantener
  // pulsado) → neutro. Un valor nunca está incluido y excluido a la vez.
  function toggleChip(el, kind, value, neg) {
    const inc = F[SETS_IN[kind]] || F.rcs;
    const exc = F[SETS_OUT[kind]] || F.notRcs;
    if (neg) {
      if (exc.has(value)) { exc.delete(value); el.classList.remove('excluded'); }
      else { exc.add(value); inc.delete(value); el.classList.remove('active'); el.classList.add('excluded'); }
    } else {
      if (inc.has(value)) { inc.delete(value); el.classList.remove('active'); }
      else {
        inc.add(value); exc.delete(value);
        el.classList.remove('excluded'); el.classList.add('active');
        window._cvChipBurst(el, kind, value);
        cvMaybeExcludeCue(el);       // «…y con el clic derecho se excluye»
      }
    }
    if (kind === 'effect' || kind === 'type') cvSyncAdvCount();   // 'type' porque el chip Fósil vive en avanzados
    runFilter();
  }

  // ── Operator helper ────────────────────────────────────────────
  function cmpOp(val, op, ref) {
    if (val == null) return false;
    const v = Number(val), r = Number(ref);
    if (op === '=')  return v === r;
    if (op === '!=') return v !== r;
    if (op === '>=') return v >= r;
    if (op === '<=') return v <= r;
    return true;
  }

  // ── Archetype classification (Ultra Beast / Past / Future paradox) ──
  // La DB no trae un campo `archetype`; se clasifica por nombre base.
  const UB_NAMES = new Set([
    'nihilego','buzzwole','pheromosa','xurkitree','celesteela','kartana',
    'guzzlord','poipole','naganadel','stakataka','blacephalon',
    // Formas Necrozma = Ultra Entes oficiales en Pocket (Bulbapedia/Game8/Serebii; promos PA-078/079/081).
    // El Necrozma NORMAL (A3-088) NO lleva la etiqueta → no añadirlo (el match exacto ya lo excluye).
    'ultra necrozma','dusk mane necrozma','dawn wings necrozma',
  ]);
  const PAST_NAMES = new Set([
    'great tusk','scream tail','brute bonnet','flutter mane','slither wing',
    'sandy shocks','roaring moon','walking wake','gouging fire','raging bolt',
    'koraidon',   // Ancient (Paradox Drive)
  ]);
  const FUTURE_NAMES = new Set([
    'iron treads','iron bundle','iron hands','iron jugulis','iron moth',
    'iron thorns','iron valiant','iron leaves','iron boulder','iron crown',
    'miraidon',   // Future (Paradox Drive) — verificado: funciona con Professor Turo
  ]);
  // Excepción: el Miraidon/Koraidon NORMAL (no ex) NO lleva la etiqueta Futuro/Pasado;
  // solo la versión ex. (La etiqueta es por carta, no por especie — aquí lo forzamos a mano.)
  const EX_ONLY_PARADOX = new Set(['miraidon', 'koraidon']);
  function cardArchetype(c) {
    if (c.cardType !== 'pokemon') return null;
    const raw = (c.name || '').toLowerCase().trim();
    const n = raw.replace(/\s+ex$/, '').trim();
    if (EX_ONLY_PARADOX.has(n) && raw === n) return null;   // es el normal (sin " ex") → sin etiqueta
    if (UB_NAMES.has(n))     return 'ultraBeast';
    if (PAST_NAMES.has(n))   return 'past';
    if (FUTURE_NAMES.has(n)) return 'future';
    return null;
  }
  // Compartido con el tablero (Celesteela «Ultra Thrusters»; Boosters Ancient/Future): NO duplicar las listas.
  window.isUltraBeast = function (c) { return !!c && cardArchetype(c) === 'ultraBeast'; };
  window.isPast = function (c) { return !!c && cardArchetype(c) === 'past'; };     // «Ancient» (Pasado)
  window.isFuture = function (c) { return !!c && cardArchetype(c) === 'future'; };
  // Team Rocket (B4a): a diferencia de los de arriba NO hay lista que mantener — el grupo
  // ES el nombre. La carta lo lleva escrito y los efectos del juego lo dicen así de literal
  // (Marowak: «If your opponent's Active Pokémon has "Team Rocket" in its name…»), así que
  // se comprueba igual: subcadena sobre el nombre INGLÉS (el de la DB, invariable por idioma).
  // Coge también «Team Rocket Grunt», que es lo correcto: es una carta del Team Rocket.
  window.isTeamRocket = function (c) { return !!c && (c.name || '').toLowerCase().includes('team rocket'); };

  // ── Attack cost filter ─────────────────────────────────────────
  // El modo (=/≥) gobierna el TOTAL de energías del ataque; los orbes son "que
  // CONTENGA al menos esto" (incoloro = incoloro real, no comodín). `countN` = número
  // del campo "Nº"; si no se puso, el objetivo por defecto es el nº de orbes colocados
  // (así, sin número, se comporta igual que antes: '=' = coste exacto, '≥' = superset).
  function costMatches(attacks, filterCost, mode, countN) {
    const orbs = filterCost || [];
    let N = (countN != null) ? countN : (orbs.length ? orbs.length : null);
    if (!orbs.length && N == null) return true;   // nada que filtrar
    if (!attacks || !attacks.length) return false;
    const need = {};
    orbs.forEach(e => { need[e] = (need[e] || 0) + 1; });
    const lenOp = mode === 'exact' ? '=' : '>=';
    return attacks.some(atk => {
      const cost = atk.cost || [];
      const have = {};
      cost.forEach(e => { have[e] = (have[e] || 0) + 1; });
      // Contiene AL MENOS los orbes pedidos
      for (const e in need) if ((have[e] || 0) < need[e]) return false;
      // El total de energías cumple el operador
      if (N != null && !cmpOp(cost.length, lenOp, N)) return false;
      return true;
    });
  }

  function addFilterEnergy(type) {
    if (F.attackCost.length >= COST_SLOTS) return;   // casillas fijas: no más orbes que casillas
    F.attackCost.push(type);
    renderCostZone();
    runFilter();
  }

  function makeOrb(type) {
    // Use static energy icon (same as equipped energy on board card) — simpler and reliable
    const wrap = document.createElement('div');
    wrap.className = 'cv-cost-orb';
    wrap.title = type;
    const iconKey = window.ORB_ICON_KEY && window.ORB_ICON_KEY[type];
    const src = iconKey && ((window.ENERGY_ICONS && window.ENERGY_ICONS[iconKey]) || (window.ORB_ICONS && window.ORB_ICONS[iconKey]));
    if (src) {
      const img = document.createElement('img');
      img.src = src; img.draggable = false; img.className = 'cv-cost-orb-img';
      wrap.appendChild(img);
    } else {
      // Fallback: colored circle
      wrap.style.background = (window.ORB_COLORS && window.ORB_COLORS[type]) ? window.ORB_COLORS[type].b : '#888';
    }
    const xBtn = document.createElement('button');
    xBtn.className = 'cv-orb-x'; xBtn.textContent = '×';
    wrap.appendChild(xBtn);
    return wrap;
  }

  // Nº FIJO de casillas de orbe → el ancho del bloque NO cambia al añadir energías
  // (sin reflow de la fila de filtros). El total de energías se expresa con el campo
  // numérico "Nº"; estas casillas sirven para exigir TIPOS concretos.
  const COST_SLOTS = 3;

  function renderCostZone() {
    const container = document.getElementById('cv-cost-slots');
    const clear     = document.querySelector('.cv-cost-clear-btn');
    if (!container) return;
    container.innerHTML = '';

    const filled = F.attackCost.length;
    const totalSlots = COST_SLOTS;

    for (let i = 0; i < totalSlots; i++) {
      const slot = document.createElement('div');
      if (i < filled) {
        // Filled slot: energy icon + hover X
        const type = F.attackCost[i];
        slot.className = 'cv-cost-slot filled';
        const iconKey = window.ORB_ICON_KEY && window.ORB_ICON_KEY[type];
        const src = iconKey && ((window.ENERGY_ICONS && window.ENERGY_ICONS[iconKey]) || (window.ORB_ICONS && window.ORB_ICONS[iconKey]));
        if (src) {
          const img = document.createElement('img');
          img.src = src; img.draggable = false;
          slot.appendChild(img);
        } else {
          slot.style.background = (window.ORB_COLORS && window.ORB_COLORS[type]) ? window.ORB_COLORS[type].b : '#888';
        }
        const x = document.createElement('div'); x.className = 'cv-slot-x'; x.textContent = '×';
        slot.appendChild(x);
        const idx = i;
        x.addEventListener('click', e => { e.stopPropagation(); F.attackCost.splice(idx, 1); renderCostZone(); runFilter(); });
      } else {
        // Empty slot: clickable "+"
        slot.className = 'cv-cost-slot empty energy-zone';
        const plus = document.createElement('span'); plus.textContent = '+';
        slot.appendChild(plus);
      }
      container.appendChild(slot);
    }

    { const ccEl = document.getElementById('cv-cost-count');
      // visibility (no display) → la ✕ reserva su hueco siempre = ancho estable
      if (clear) clear.style.visibility = (filled > 0 || (ccEl && ccEl.value !== '')) ? 'visible' : 'hidden'; }

    // Re-wire the add-btn reference for openEnergyMenu
    const emptySlots = container.querySelectorAll('.cv-cost-slot.empty');
    emptySlots.forEach(slot => {
      slot.addEventListener('click', e => {
        e.stopPropagation();
        if (typeof window.openEnergyMenu === 'function') {
          window._energyFilterCtx = true;
          window.openEnergyMenu(slot, 'filter');
          requestAnimationFrame(() => {
            const wrap = document.getElementById('energy-menu-wrap');
            if (!wrap || !wrap.classList.contains('open')) return;
            const touch = window.pbIsTouchMobile && window.pbIsTouchMobile();
            const wr = wrap.getBoundingClientRect();
            if (touch) {
              // Posición FIJA en móvil: centrado horizontal, justo encima del
              // bloque del filtro (no se desplaza según cuántas energías haya).
              const blk = slot.closest('.cv-num-block') || slot;
              const br = blk.getBoundingClientRect();
              wrap.style.left = Math.max(8, (window.innerWidth - wr.width) / 2) + 'px';
              wrap.style.top  = Math.max(8, br.top - wr.height - 10) + 'px';
            } else {
              // Escritorio: a la derecha de la casilla; si se saliera por el borde,
              // salta a la izquierda y, en cualquier caso, se ACOTA dentro de la ventana.
              const r = slot.getBoundingClientRect();
              let left = r.right + 12;
              if (left + wr.width > window.innerWidth - 8) left = r.left - wr.width - 12;
              left = Math.max(8, Math.min(left, window.innerWidth - wr.width - 8));
              let top = r.top + r.height / 2 - wr.height / 2;
              top = Math.max(8, Math.min(top, window.innerHeight - wr.height - 8));
              wrap.style.left = left + 'px';
              wrap.style.top  = top + 'px';
            }
          });
        }
      });
    });
  }

  function setOp(kind, op, el) {
    if (kind === 'hp') F.hpOp = op;
    else if (kind === 'rc') F.rcOp = op;
    el.closest('.cv-chip-group').querySelectorAll('.cv-op-btn').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    runFilter();
  }
  window._cvSetOp = setOp;

  // Nombres (lowercase) que son PREEVOLUCIÓN de alguna carta (algo evoluciona de ellos).
  // Se calcula una vez (la DB es estática) → el filtro «Ocultar preevoluciones» es O(1)/carta.
  let _preevoNames = null;
  function getPreevoNames() {
    if (_preevoNames) return _preevoNames;
    _preevoNames = new Set();
    (window.CARDS_DB || []).forEach(c => {
      const f = (c.evolvesFrom || '').toLowerCase();
      if (f) _preevoNames.add(f);
    });
    return _preevoNames;
  }

  // Cadena evolutiva COMPLETA (hacia arriba y hacia abajo) de un conjunto de nombres
  // (lowercase). Fuente ÚNICA: la usa el buscador de Cartas y el del constructor de mazos.
  function evoChainNames(originalNames) {
    const DB = window.CARDS_DB || [];
    const byName = new Map();       // nombre → cartas
    const evolvesInto = new Map();  // preevo → Set de evoluciones
    DB.forEach(c => {
      if (c.cardType !== 'pokemon') return;
      const n = (c.name || '').toLowerCase();
      if (!byName.has(n)) byName.set(n, []);
      byName.get(n).push(c);
      const from = (c.evolvesFrom || '').toLowerCase();
      if (from) {
        if (!evolvesInto.has(from)) evolvesInto.set(from, new Set());
        evolvesInto.get(from).add(n);
      }
    });
    const includedNames = new Set(originalNames);
    const queue = [...includedNames];
    while (queue.length) {
      const name = queue.shift();
      (byName.get(name) || []).forEach(c => {          // hacia arriba (evolvesFrom)
        const from = (c.evolvesFrom || '').toLowerCase();
        if (from && !includedNames.has(from)) { includedNames.add(from); queue.push(from); }
      });
      (evolvesInto.get(name) || new Set()).forEach(child => {   // hacia abajo
        if (!includedNames.has(child)) { includedNames.add(child); queue.push(child); }
      });
    }
    return includedNames;
  }
  window.pbEvoChainNames = evoChainNames;
  window.pbPreevoNames = getPreevoNames;

  // «Mostrar línea evolutiva» y «Ocultar preevoluciones» son EXCLUYENTES (no tiene sentido
  // los dos a la vez): activar uno apaga el otro.
  window._cvToggleEvoMode = function (mode) {
    const evo = document.getElementById('cv-evoline');
    const noe = document.getElementById('cv-noevo');
    const evoChip = document.getElementById('cv-evoline-chip');
    const noeChip = document.getElementById('cv-noevo-chip');
    if (mode === 'evoline') { evo.checked = !evo.checked; if (evo.checked) noe.checked = false; }
    else                    { noe.checked = !noe.checked; if (noe.checked) evo.checked = false; }
    evoChip.classList.toggle('active', evo.checked);
    noeChip.classList.toggle('active', noe.checked);
    runFilter();
  };

  // Filtro «Solo favoritas» (botón estrella de la barra).
  window._cvToggleFavFilter = function () {
    F.favOnly = !F.favOnly;
    const b = document.getElementById('cv-fav-btn');
    if (b) b.classList.toggle('fav-active', F.favOnly);
    runFilter();
  };

  // ── Run filter ─────────────────────────────────────────────────
  function runFilter() {
    // Pool base = la DB de Pokémon TCG Pocket. Las cartas CUSTOM (data/custom.cards.js) NO
    // están en ella: solo entran si se piden con el chip de Avanzados o si se escribe su
    // nombre en el buscador. Así no contaminan ningún otro resultado.
    const DB = window.CARDS_DB || [];
    const q      = (document.getElementById('cv-search').value || '').toLowerCase().trim();
    // Valor del desplegable de expansión: 'A1' (set entero) o 'A1|Mewtwo' (un sobre).
    const setRaw = (document.getElementById('cv-set').value || '').trim();
    const setVal = window.setValueParse(setRaw).set;   // solo para hasIdentityFilter/badge
    const exOnly      = document.getElementById('cv-ex-only')?.checked || false;
    const megaOnly    = document.getElementById('cv-mega-only')?.checked || false;
    const abilityInp  = document.getElementById('cv-ability-only');
    const abilityOnly = abilityInp && !abilityInp.disabled && abilityInp.checked;
    const evoLine     = document.getElementById('cv-evoline')?.checked || false;
    const noEvo       = document.getElementById('cv-noevo')?.checked || false;
    const ubOnly      = document.getElementById('cv-ub')?.checked || false;
    const pastOnly    = document.getElementById('cv-past')?.checked || false;
    const futureOnly  = document.getElementById('cv-future')?.checked || false;
    const trOnly      = document.getElementById('cv-tr')?.checked || false;
    const hpRaw  = document.getElementById('cv-hp-val').value;
    const hpRef  = hpRaw !== '' ? parseInt(hpRaw, 10) : null;
    let costCountN = null;
    { const cc = document.getElementById('cv-cost-count');
      if (cc && cc.value !== '') { const v = parseInt(cc.value, 10); if (Number.isFinite(v)) costCountN = Math.max(0, v); } }
    // Caja de NOMBRE (AND de palabras + "frase exacta") y caja de TEXTO de carta (Avanzados).
    const nameM = q ? buildNameMatcher(q) : null;
    const textM = (F.textQuery && F.textQuery.trim()) ? buildTextMatcher(F.textQuery) : null;

    // Filtros de "identidad": qué carta es. Independientes de stage/elemento/
    // retirada/HP/coste, que son filtros de "detalle" sobre esa carta.
    const identityFilter = c => {
      if (nameM   && !nameM(window.cardSearchNames ? window.cardSearchNames(c) : (c.name || '').toLowerCase())) return false;
      if (setRaw && !window.cardInSetValue(c, setRaw)) return false;   // expansión o sobre concreto
      if (F.rarities.size && !F.rarities.has(c.rarity)) return false;
      if (F.notRarities.size && F.notRarities.has(c.rarity)) return false;
      if (exOnly && !c.ex) return false;
      if (megaOnly && !(c.name || '').toLowerCase().startsWith('mega ')) return false;
      if (abilityOnly && !c.hasAbility) return false;
      if (ubOnly     && cardArchetype(c) !== 'ultraBeast') return false;
      if (pastOnly   && cardArchetype(c) !== 'past')       return false;
      if (futureOnly && cardArchetype(c) !== 'future')     return false;
      if (trOnly     && !window.isTeamRocket(c))           return false;
      // Mecánicas EXCLUIDAS («sin EX», «sin habilidad»…)
      if (F.mechEx.size) {
        if (F.mechEx.has('ex') && c.ex) return false;
        if (F.mechEx.has('mega') && (c.name || '').toLowerCase().startsWith('mega ')) return false;
        if (F.mechEx.has('ability') && c.hasAbility) return false;
        if (F.mechEx.has('ub') && cardArchetype(c) === 'ultraBeast') return false;
        if (F.mechEx.has('past') && cardArchetype(c) === 'past') return false;
        if (F.mechEx.has('future') && cardArchetype(c) === 'future') return false;
        if (F.mechEx.has('tr') && window.isTeamRocket(c)) return false;
      }
      if (F.favOnly  && !(window.pbIsFav && window.pbIsFav(c.id))) return false;
      return true;
    };
    const hasIdentityFilter = !!(q || setVal || F.rarities.size || F.notRarities.size || exOnly || megaOnly || abilityOnly || ubOnly || pastOnly || futureOnly || trOnly || F.mechEx.size || F.favOnly);

    const preevoNames = noEvo ? getPreevoNames() : null;
    const CUSTOM = window.CUSTOM_CARDS || [];
    const POOL = F.customOnly ? CUSTOM : (q && CUSTOM.length ? DB.concat(CUSTOM) : DB);
    let results = POOL.filter(c => {
      if (!identityFilter(c)) return false;
      // Un fósil ES una carta de OBJETO (solo se comporta como Pokémon una vez EN JUEGO):
      // filtrar «Objeto» lo trae; el chip «Fósil» (avanzados) sirve para verlos solo a ellos.
      if (F.types.size  && !F.types.has(c.cardType) && !(c.cardType === 'fossil' && F.types.has('item')))  return false;
      // Excluir un tipo: «Objeto» arrastra a los fósiles igual que al incluirlo
      if (F.notTypes.size && (F.notTypes.has(c.cardType) || (c.cardType === 'fossil' && F.notTypes.has('item')))) return false;
      // «Ocultar preevoluciones»: fuera toda carta cuyo NOMBRE sea el evolvesFrom de otra
      // (solo sirven para evolucionar). Deja finales, básicos sin evolución y EX. OJO: NO
      // distingue cardType → oculta también los FÓSILES (Helix Fossil, Old Amber…), porque
      // cada fósil es el evolvesFrom de su Pokémon. Comportamiento querido por Daniel (2026-07-12).
      if (noEvo && preevoNames.has((c.name || '').toLowerCase())) return false;
      if (F.els.size    && !F.els.has(c.element))     return false;
      if (F.notEls.size && c.element && F.notEls.has(c.element)) return false;
      // Excluir una fase solo afecta a Pokémon (un Partidario no tiene fase → se queda)
      if (F.notStages.size && c.cardType === 'pokemon') {
        const stx = c.stage == null ? null
                  : c.stage === 'basic' || c.stage === 0 ? 'basic'
                  : String(c.stage);
        if (F.notStages.has(stx)) return false;
      }
      if (F.stages.size) {
        // La fase es de POKÉMON: un fósil nunca casa aquí aunque un dato suelto le pusiera
        // `stage` (como carta es un Objeto; que se juegue como Básico es cosa del tablero).
        if (c.cardType !== 'pokemon') return false;
        const st = c.stage == null ? null
                 : c.stage === 'basic' || c.stage === 0 ? 'basic'
                 : String(c.stage);
        if (!F.stages.has(st)) return false;
      }
      if (F.rcs.size) {
        const rc = c.retreatCost == null ? null : Number(c.retreatCost);
        const match = [...F.rcs].some(v => {
          const ref = v === '4+' ? 4 : parseInt(v, 10);
          const op  = v === '4+' ? '>=' : F.rcOp;
          return cmpOp(rc, op, ref);
        });
        if (!match) return false;
      }
      // Excluir retirada: el MISMO operador que se ve en pantalla, negado
      if (F.notRcs.size) {
        const rc = c.retreatCost == null ? null : Number(c.retreatCost);
        const hit = [...F.notRcs].some(v => {
          const ref = v === '4+' ? 4 : parseInt(v, 10);
          const op  = v === '4+' ? '>=' : F.rcOp;
          return cmpOp(rc, op, ref);
        });
        if (hit) return false;
      }
      if (hpRef != null && !cmpOp(c.health, F.hpOp, hpRef)) return false;
      if ((F.attackCost.length || costCountN != null) && !costMatches(c.attacks, F.attackCost, F.costMode, costCountN)) return false;
      // Búsqueda por TEXTO de carta (Avanzados): el texto es inglés (es→en por diccionario).
      if (textM && !textM(cardText(c))) return false;
      // Filtros por EFECTO (Avanzados): AND entre dimensiones (chips simples, Robo, Bloquear,
      // +Daño, Estados); dentro de Estados es OR (causa cualquiera de las marcadas).
      if (F.effects.size || F.drawMode || F.lockMode || F.dmgMode || F.negMode || F.conditions.size
          || F.notEffects.size || F.notConditions.size || F.notDD.size) {
        const info = cardInfo(c);
        for (const eff of F.effects) if (!info.tags.has(eff)) return false;
        for (const eff of F.notEffects) if (info.tags.has(eff)) return false;
        for (const k of F.notConditions) if (info.conds.has(k)) return false;
        if (F.notDD.has('draw') && (info.tags.has('draw') || info.tags.has('deckSearch'))) return false;
        if (F.notDD.has('lock') && info.lock.size) return false;
        if (F.notDD.has('dmg')  && info.dmg.size)  return false;
        if (F.notDD.has('neg')  && info.neg.size)  return false;
        if (F.drawMode) {
          const ok = F.drawMode === 'all' ? (info.tags.has('draw') || info.tags.has('deckSearch'))
                   : F.drawMode === 'generic' ? info.tags.has('draw') : info.tags.has('deckSearch');
          if (!ok) return false;
        }
        // Desplegables de un solo conjunto: 'all' = cualquier subtipo; si no, ese subtipo concreto.
        const dimOk = (mode, set) => mode === 'all' ? set.size > 0 : set.has(mode);
        if (F.lockMode && !dimOk(F.lockMode, info.lock)) return false;
        if (F.dmgMode  && !dimOk(F.dmgMode, info.dmg))   return false;
        if (F.negMode  && !dimOk(F.negMode, info.neg))   return false;
        if (F.conditions.size) {
          let any = false;
          for (const k of F.conditions) if (info.conds.has(k)) { any = true; break; }
          if (!any) return false;
        }
      }
      return true;
    });

    // Si los filtros de detalle (fase, elemento, retirada, HP, coste...) dejan
    // el resultado vacío pero la búsqueda por identidad sí encuentra cartas,
    // usamos esas como semilla para la línea evolutiva: la carta buscada se
    // muestra igualmente.
    // OJO — comportamiento de «Mostrar línea evolutiva» (querido por Daniel, 2026-07-12):
    // el MERGE de abajo (~1320) añade la FAMILIA entera por NOMBRE (BFS sube por evolvesFrom
    // y BAJA a TODAS las ramas hermanas: Eevee → las 8 eeveelutions) SIN re-aplicar los
    // filtros de detalle NI de identidad → aparecen cartas que contradicen el filtro activo
    // (p.ej. Fuego + línea evolutiva mete Vaporeon/Jolteon…). Es intencional: completar la
    // línea manda sobre el filtro. NO «arreglar» sin pedírselo a Daniel.
    if (evoLine && !results.length && hasIdentityFilter && !F.customOnly) {
      // Semilla SOLO de Pokémon (las líneas son de Pokémon) y respetando el filtro de TIPO
      // de carta: si filtras «Objeto», un Partidario como Copycat NO debe reaparecer por la línea.
      results = DB.filter(c => (c.cardType === 'pokemon' || c.cardType === 'fossil')
        && (!F.types.size || F.types.has(c.cardType) || (c.cardType === 'fossil' && F.types.has('item')))
        && identityFilter(c));
    }

    // ── Línea evolutiva ───────────────────────────────────────────
    if (evoLine && results.length) {
      // originalNames = los nombres que YA casaron la búsqueda; NO re-metemos otras
      // impresiones de esos nombres (ej. al buscar Tyranitar oscuro, no traer el de lucha).
      const originalNames = new Set(results.map(c => (c.name || '').toLowerCase()));
      const includedNames = evoChainNames(originalNames);

      // Merge DB cards whose name is in the chain (preserve original order, no dupes)
      const seen = new Set(results.map(c => c.id));
      DB.forEach(c => {
        const n = (c.name||'').toLowerCase();
        // Solo preevos/evoluciones REALES (nombres añadidos por la cadena), no otras
        // impresiones del nombre buscado.
        // Los FÓSILES entran en la línea como una preevolución más (Omanyte evoluciona del
        // Fósil Hélice) — igual que ya los cuenta «Ocultar preevoluciones».
        if ((c.cardType === 'pokemon' || c.cardType === 'fossil') && includedNames.has(n) && !originalNames.has(n) && !seen.has(c.id)) {
          results.push(c); seen.add(c.id);
        }
      });
    }

    // Orden por uso en el meta: las cartas que no se juegan (0%) desaparecen.
    if (F.sortBy === 'usage') results = results.filter(c => usageOf(c) > 0);

    // ── Sort ──────────────────────────────────────────────────────
    const TYPE_ORDER = ['pokemon','item','tool','supporter','stadium','fossil'];
    const TYPE_RANK  = Object.fromEntries(TYPE_ORDER.map((t,i) => [t, i]));

    // Helper: set+number as a single numeric key for secondary sort
    const setKey = c => (SET_RANK[c.set] ?? 99) * 10000 + parseInt(c.number || '0');
    const cmp = (va, vb) => va < vb ? -1 : va > vb ? 1 : 0;
    const dir = v => F.sortDir === 'asc' ? v : -v;

    results.sort((a, b) => {
      let primary;
      if (F.sortBy === 'set') {
        primary = dir(cmp(setKey(a), setKey(b)));
        if (primary !== 0) return primary;
        return cmp((a.name||'').toLowerCase(), (b.name||'').toLowerCase());
      } else if (F.sortBy === 'type') {
        // Primary: card type (pokemon before trainers)
        const ctA = TYPE_RANK[a.cardType] ?? 99;
        const ctB = TYPE_RANK[b.cardType] ?? 99;
        const byCardType = dir(cmp(ctA, ctB));
        if (byCardType !== 0) return byCardType;
        // Secondary (for Pokemon): energy element type
        const EL_ORDER = ['grass','fire','water','lightning','psychic','fighting','darkness','metal','dragon','colorless'];
        const EL_RANK  = Object.fromEntries(EL_ORDER.map((e,i) => [e, i]));
        const elA = EL_RANK[a.element] ?? 99;
        const elB = EL_RANK[b.element] ?? 99;
        const byEl = cmp(elA, elB); // element always asc within each card type
        if (byEl !== 0) return byEl;
        // Tertiary: set + number
        const bySet = cmp(setKey(a), setKey(b));
        if (bySet !== 0) return bySet;
        return cmp((a.name||'').toLowerCase(), (b.name||'').toLowerCase());
      } else if (F.sortBy === 'usage') {
        primary = dir(cmp(usageOf(a), usageOf(b)));
        if (primary !== 0) return primary;
        return cmp((a.name||'').toLowerCase(), (b.name||'').toLowerCase());
      } else if (F.sortBy === 'rarity') {
        primary = dir(cmp(RAR_RANK[a.rarity] ?? 99, RAR_RANK[b.rarity] ?? 99));
        if (primary !== 0) return primary;
        return cmp((a.name||'').toLowerCase(), (b.name||'').toLowerCase());
      } else { // name
        return dir(cmp((a.name||'').toLowerCase(), (b.name||'').toLowerCase()));
      }
    });

    _lastResults = results;
    document.getElementById('cv-count').textContent = T('cards.count', { n: results.length });
    if (window._cvSyncFilterUI) window._cvSyncFilterUI(results.length);
    cvAutoZoom(results.length);   // zoom inteligente según nº de resultados (móvil)
    _cvMaybeAddCue(results.length);   // cue «primera vez»: cómo añadir al mazo

    _page = 0;
    if (_view === 'grid') renderGrid(results);
    else renderTable(results);
  }

  // ── Grid render ────────────────────────────────────────────────
  function renderGrid(cards) {
    const grid  = document.getElementById('cv-grid');
    const body  = document.getElementById('cv-body');
    const empty = document.getElementById('cv-empty');
    if (_cvImgObs) _cvImgObs.disconnect();   // limpia observaciones de imágenes viejas
    grid.innerHTML = '';
    // Remove any leftover sentinel from previous render
    const old = body.querySelector('#cv-sentinel');
    if (old) old.remove();
    cvShowLoading(false);   // quita cualquier spinner anterior
    const myTok = ++_cvRenderTok;   // esta carga; invalida timeouts/callbacks de la anterior

    if (!cards.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    if (_scrollObs) { _scrollObs.disconnect(); _scrollObs = null; }

    let loaded = 0;
    function nextBatch() {   // tandas SIGUIENTES (al scrollear): fundido individual
      const end = Math.min(loaded + PAGE_SIZE, cards.length);
      const imgs = [];
      for (let i = loaded; i < end; i++) { const w = makeGridCard(cards[i]); grid.appendChild(w); imgs.push(w.querySelector('.cv-card-img')); }
      loaded = end;
      imgs.forEach(cvLazyImg);
      setSentinel();
    }
    function setSentinel() {
      if (loaded >= cards.length) return;
      const s = document.createElement('div');
      s.id = 'cv-sentinel'; s.style.cssText = 'height:1px;';
      body.appendChild(s);
      _scrollObs = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { _scrollObs.disconnect(); _scrollObs = null; nextBatch(); }
      }, { root: body, rootMargin: '200px' });
      _scrollObs.observe(s);
    }

    // ── PRIMERA tanda: spinner hasta que la 1ª pantalla esté lista, entonces revelar ──
    cvShowLoading(true);           // círculo de carga
    grid.style.display = 'none';   // NO se ven cartas mientras carga
    const end = Math.min(PAGE_SIZE, cards.length);
    const imgs = [];
    for (let i = 0; i < end; i++) { const w = makeGridCard(cards[i]); grid.appendChild(w); imgs.push(w.querySelector('.cv-card-img')); }
    loaded = end;

    const firstN = Math.min(cvFirstScreenCount(), imgs.length);
    const firstEls = imgs.slice(0, firstN), restEls = imgs.slice(firstN);
    let arrived = 0, done = false;
    function revealGrid() {
      if (done || myTok !== _cvRenderTok) return; done = true; clearTimeout(fb);
      cvShowLoading(false);
      grid.style.display = '';
      // revela las cartas de 1ª pantalla que ya cargaron; las que no (fallback) quedan de
      // esqueleto y van cargando individualmente (sus callbacks las revelan al llegar).
      firstEls.forEach(el => { if (el._cvArrived) cvReveal(el, el._okUrl); });
      restEls.forEach(cvLazyImg);
      setSentinel();
    }
    const fb = setTimeout(revealGrid, CV_LOAD_FALLBACK);
    firstEls.forEach(el => cvPreload(el._cvUrl, u => {
      el._okUrl = u; el._cvArrived = true;
      if (done) cvReveal(el, u);                 // ya revelado el grupo → esta carta funde sola
      else if (++arrived >= firstN) revealGrid(); // toda la 1ª pantalla lista → revelar junto
    }, el._cvCard));
    if (!firstN) revealGrid();
  }

  function makeGridCard(card) {
    const wrap = document.createElement('div');
    wrap.className = 'cv-card-wrap';

    const imgDiv = document.createElement('div');
    imgDiv.className = 'cv-card-img';
    const _gImg = cvCardImg(card);   // CU- → local; oficial sin arte local → placeholder directo
    if (_gImg) { imgDiv._cvUrl = _gImg; imgDiv._cvCard = card; }   // la carga la orquesta renderGrid (1ª pantalla junta · resto diferido)

    // Click on image → zoom with flip from card position
    imgDiv.addEventListener('click', () => {
      if (imgDiv._suppressClick) { imgDiv._suppressClick = false; return; }  // hubo pulsación larga
      openCardZoom(card, imgDiv);
    });

    // Estrella de FAVORITA (esquina sup-derecha; en móvil solo vive en el zoom cercano).
    const fav = document.createElement('button');
    const isFav = !!(window.pbIsFav && window.pbIsFav(card.id));
    fav.className = 'cv-fav-star' + (isFav ? ' on' : '');
    fav.type = 'button';
    fav.setAttribute('aria-pressed', String(isFav));
    fav.title = window.t ? window.t('cards.favorite') : 'Favorita';
    fav.setAttribute('aria-label', fav.title);
    fav.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.6l-5.91 3.16 1.13-6.57L2.45 9.54l6.6-.96z"/></svg>';
    fav.addEventListener('click', e => {
      e.stopPropagation();
      const now = window.pbToggleFav(card.id);
      fav.classList.toggle('on', now);
      fav.setAttribute('aria-pressed', String(now));
      if (F.favOnly) runFilter();   // si estás filtrando favoritas, refresca
    });
    wrap.appendChild(fav);   // sobre el wrapper (no se recorta ni se inclina con la carta)

    // Badge de uso en el meta (esquina sup-izq; solo al ordenar por «Más usadas»)
    if (F.sortBy === 'usage') {
      const u = usageOf(card);
      if (u > 0) {
        const ub = document.createElement('div');
        ub.className = 'cv-usage-badge';
        ub.textContent = (u * 100).toFixed(u < 0.095 ? 1 : 0) + '%';
        ub.title = window.t ? window.t('cards.usageBadge') : 'Uso en el meta';
        wrap.appendChild(ub);
      }
    }

    // 3D tilt + glare + holo on hover (same as binder.js)
    const glare = document.createElement('div'); glare.className = 'cv-card-glare'; imgDiv.appendChild(glare);
    const shine = document.createElement('div'); shine.className = 'cv-card-shine'; imgDiv.appendChild(shine);
    // Sello CUSTOM: dice de un vistazo que la carta NO existe en Pokémon TCG Pocket. Cuelga de
    // la IMAGEN (abajo del todo) para no tapar el nombre impreso de la carta.
    if (window.isCustomCard && window.isCustomCard(card)) {
      const cb = document.createElement('div');
      cb.className = 'cv-custom-badge';
      cb.textContent = window.t ? window.t('cards.customBadge') : 'CUSTOM';
      cb.title = window.t ? window.t('cards.customFilter') : '';
      imgDiv.appendChild(cb);
    }
    imgDiv.addEventListener('mouseenter', () => { if (!CV_COARSE) imgDiv.style.transition = 'none'; });
    imgDiv.addEventListener('mousemove', e => {
      if (CV_COARSE) return;   // táctil: sin tilt hover → scroll fluido
      const r = imgDiv.getBoundingClientRect();
      const dx = (e.clientX - r.left - r.width/2)  / (r.width/2);
      const dy = (e.clientY - r.top  - r.height/2) / (r.height/2);
      imgDiv._tGx = dx; imgDiv._tGy = dy;
      if (!imgDiv._tRAF) {
        imgDiv._tTx = imgDiv._tTx || 0; imgDiv._tTy = imgDiv._tTy || 0;
        const tick = () => {
          const tiltOn = !window.pbFx || window.pbFx('tilt');
          const holoOn = !window.pbFx || window.pbFx('holo');
          imgDiv._tTx += (imgDiv._tGx - imgDiv._tTx) * 0.12;
          imgDiv._tTy += (imgDiv._tGy - imgDiv._tTy) * 0.12;
          if (tiltOn) {
            const rx = imgDiv._tTy * -14, ry = imgDiv._tTx * 14;
            imgDiv.style.transform = `perspective(500px) scale(1.06) rotateX(${rx}deg) rotateY(${ry}deg)`;
            imgDiv.style.boxShadow = `${imgDiv._tTx*5}px ${imgDiv._tTy*5+5}px 18px rgba(0,0,0,0.6)`;
          } else { imgDiv.style.transform = ''; imgDiv.style.boxShadow = ''; }
          if (!holoOn) { glare.style.background = ''; shine.style.opacity = '0';
            if (imgDiv._tActive) imgDiv._tRAF = requestAnimationFrame(tick); else imgDiv._tRAF = null; return; }
          const gx = (imgDiv._tTx*0.5+0.5)*100, gy = (imgDiv._tTy*0.5+0.5)*100;
          glare.style.background = `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.3) 0%, transparent 55%)`;
          const dist = Math.min(Math.sqrt(imgDiv._tTx**2+imgDiv._tTy**2),1);
          const ang  = 88+imgDiv._tTx*4, sh = imgDiv._tTx*40;
          const hue  = c => (c+dist*60)%360;
          shine.style.background = `repeating-linear-gradient(${ang}deg,hsla(${hue(45)},85%,62%,0.5) ${sh}px,hsla(${hue(335)},75%,58%,0.45) ${sh+14}px,hsla(${hue(175)},80%,50%,0.48) ${sh+28}px,hsla(${hue(210)},80%,55%,0.5) ${sh+42}px,hsla(${hue(280)},70%,55%,0.45) ${sh+56}px,hsla(${hue(45)},85%,62%,0.5) ${sh+72}px)`;
          const mr = 45+dist*30;
          const mask = `radial-gradient(ellipse ${mr}% ${mr*0.85}% at 50% 50%, black 0%, rgba(0,0,0,0.18) 50%, transparent 85%)`;
          shine.style.webkitMaskImage = mask; shine.style.maskImage = mask;
          shine.style.opacity = String(Math.min(dist*2.2, 0.7));
          if (imgDiv._tActive) imgDiv._tRAF = requestAnimationFrame(tick);
          else imgDiv._tRAF = null;
        };
        imgDiv._tActive = true;
        imgDiv._tRAF = requestAnimationFrame(tick);
      }
    });
    imgDiv.addEventListener('mouseleave', () => {
      imgDiv._tActive = false; imgDiv._tTx = 0; imgDiv._tTy = 0;
      imgDiv.style.transition = 'transform 0.3s ease-out, box-shadow 0.3s ease-out';
      imgDiv.style.transform = ''; imgDiv.style.boxShadow = '';
      glare.style.background = 'radial-gradient(circle at 50% 50%, rgba(255,255,255,0.18) 0%, transparent 65%)';
      shine.style.opacity = '0';
    });

    // Consistent action row below card name (matches board button language)
    const addRow = document.createElement('button');
    addRow.className = 'cv-card-add-row';
    addRow.textContent = '+';

    // 1s hover → expand pill preview
    let _addHoverT = null;
    addRow.addEventListener('mouseenter', () => {
      _addHoverT = setTimeout(() => { if (_deckEditing()) cvPillShow(); }, 1000);
    });
    addRow.addEventListener('mouseleave', () => clearTimeout(_addHoverT));

    function doAddCard() { return _cvAddWithPulse(card, imgDiv); }

    addRow.addEventListener('click', e => { e.stopPropagation(); clearTimeout(_addHoverT); doAddCard(); if (window.pbCue) window.pbCue.dismiss('cardsAddDeck'); });

    // Clic derecho (desktop) = añadir. En TÁCTIL el long-press dispara contextmenu
    // en Android → solo prevenir el menú; añadir lo hacen los timers de la pulsación.
    imgDiv.addEventListener('contextmenu', e => { e.preventDefault(); if (!CV_COARSE) { doAddCard(); if (window.pbCue) window.pbCue.done('cardsAddDeck'); } });

    // Táctil: pulsación larga = añadir (0,5s → 1, 1,0s → 2ª copia). Anillo de progreso.
    const lpRing = document.createElement('div'); lpRing.className = 'cv-lp-ring'; imgDiv.appendChild(lpRing);
    imgDiv.addEventListener('pointerdown', e => cvLpStart(imgDiv, doAddCard, e));
    imgDiv.addEventListener('pointermove', cvLpMove);
    imgDiv.addEventListener('pointerup', () => cvLpUp(imgDiv));
    imgDiv.addEventListener('pointercancel', cvLpEnd);

    const info = document.createElement('div');
    info.className = 'cv-card-info';

    const name = document.createElement('div');
    name.className = 'cv-card-name';
    name.title = window.cardName ? window.cardName(card) : card.name;
    name.textContent = name.title || '';

    const ct = card.cardType || 'unknown';
    const row2 = document.createElement('div');
    row2.className = 'cv-card-row2';
    const badge = document.createElement('span');
    badge.className = `cv-badge cv-t-${ct}`;
    badge.textContent = window.typeName ? window.typeName(ct) : (TYPE_ES[ct] || ct);
    row2.appendChild(badge);
    row2.appendChild(addRow);

    info.appendChild(name);
    info.appendChild(row2);

    wrap.appendChild(imgDiv);
    wrap.appendChild(info);
    return wrap;
  }

  // ── Table render ───────────────────────────────────────────────
  function renderTable(cards) {
    const tbody = document.getElementById('cv-tbody');
    const empty = document.getElementById('cv-empty');
    tbody.innerHTML = '';

    if (!cards.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    const showAdd = _deckEditing();

    cards.forEach(c => {
      const ct = c.cardType || 'unknown';
      const stageKey = c.stage === 'basic' || c.stage === 0 ? 'basic' : String(c.stage ?? '');
      const stg = window.stageLabel ? window.stageLabel(stageKey) : (STAGE_LABEL[stageKey] ?? (c.stage != null ? c.stage : ''));
      const tImg = cvCardImg(c);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${tImg ? `<img class="cv-tbl-thumb" src="${tImg}" loading="lazy" onerror="window._cvImgErr(this,'${String(c.id).replace(/'/g,"\\'")}')">` : ''}</td>
        <td><b>${escHtml((window.cardName ? window.cardName(c) : c.name) || '')}</b>${c.ex ? ' <span style="color:#f90;font-size:10px;font-weight:800;">EX</span>' : ''}</td>
        <td><span class="cv-badge cv-t-${ct}">${window.typeName ? window.typeName(ct) : (TYPE_ES[ct] || ct)}</span></td>
        <td>${c.element ? `<span class="cv-eldot el-${c.element}" style="display:inline-block;"></span> ${window.elName ? window.elName(c.element) : c.element}` : ''}</td>
        <td class="cv-stage">${stg}</td>
        <td>${c.health ?? ''}</td>
        <td class="cv-stage">${c.retreatCost ?? ''}</td>
        <td style="color:#666;font-size:11px;">${c.set || ''}${c.number ? ' #'+c.number : ''}</td>
        ${showAdd ? `<td><button class="cv-tbl-add-btn">+</button></td>` : '<td></td>'}
      `;
      if (showAdd) {
        tr.querySelector('.cv-tbl-add-btn').addEventListener('click', () => {
          _cvAddWithPulse(c, tr.querySelector('.cv-tbl-thumb') || tr);
        });
      }
      // click row image → zoom
      const img = tr.querySelector('.cv-tbl-thumb');
      if (img) img.addEventListener('click', () => openCardZoom(c, img));
      tbody.appendChild(tr);
    });
  }

  // ── View toggle ────────────────────────────────────────────────
  function setView(v) {
    _view = v;
    document.getElementById('cv-view-grid').classList.toggle('active', v === 'grid');
    document.getElementById('cv-view-table').classList.toggle('active', v === 'table');
    document.getElementById('cv-grid').style.display           = v === 'grid'  ? '' : 'none';
    document.getElementById('cv-table-wrap').style.display     = v === 'table' ? '' : 'none';
    runFilter();
  }

  // ── Apply to sidebar search ────────────────────────────────────
  function applyToSearch() {
    window._advancedSearchResults = _lastResults.slice();
    // Switch to board tab first (restores page-wrap visibility)
    window.switchAppTab('board');
    // Open sidebar and switch to search tab, then trigger search
    setTimeout(() => {
      if (typeof window.openSidebar === 'function') window.openSidebar();
      if (typeof window.setSbTab === 'function') window.setSbTab('search');
      if (typeof window._dbRunSearch === 'function') window._dbRunSearch();
    }, 80);
  }

  // Mandar los resultados actuales al pool de la Tierlist (añade, no reemplaza).
  function applyToTierlist() {
    const cards = _lastResults.slice();
    if (!cards.length) return;
    window.switchAppTab('tierlist');
    setTimeout(() => { if (window._tlSendCards) window._tlSendCards(cards); }, 60);
  }

  // ── Limpiar todos los filtros (botón del estado vacío) ─────────
  function clearAllFilters() {
    { const cb = document.getElementById('cv-clear-btn'); if (cb && window.pbSpinIcon) window.pbSpinIcon(cb); }
    F.types.clear(); F.els.clear(); F.stages.clear(); F.rcs.clear();
    F.rarities.clear(); F.attackCost = []; F.effects.clear();
    // …y todo lo EXCLUIDO
    [F.notTypes, F.notEls, F.notStages, F.notRcs, F.notRarities, F.notEffects, F.notConditions, F.notDD, F.mechEx]
      .forEach(set => set.clear());
    document.querySelectorAll('#cv-filters .excluded, #cv-filter-sheet .excluded').forEach(c => c.classList.remove('excluded'));
    F.drawMode = F.lockMode = F.dmgMode = F.negMode = null;
    F.conditions.clear();
    F.textQuery = ''; { const ti = document.getElementById('cv-text-search'); if (ti) ti.value = ''; }
    { const tw = document.getElementById('cv-text-wrap'); if (tw) tw.classList.remove('has-text'); }
    Object.keys(DD_DIMS).forEach(updateDDChip); cvSyncAdvCount();
    F.rcOp = '='; F.hpOp = '='; F.costMode = 'exact';
    document.getElementById('cv-search').value = '';
    document.getElementById('cv-set').value = '';
    if (window._cvSyncSetUI) window._cvSyncSetUI();
    document.getElementById('cv-hp-val').value = '';
    { const cc = document.getElementById('cv-cost-count'); if (cc) cc.value = ''; }
    // Checkboxes ocultos (EX, Mega, Habilidad, línea evolutiva, arquetipos)
    ['cv-ex-only','cv-mega-only','cv-ability-only','cv-evoline','cv-noevo','cv-ub','cv-past','cv-future','cv-tr'].forEach(id => {
      const inp = document.getElementById(id);
      if (inp) inp.checked = false;
    });
    F.favOnly = false;
    F.customOnly = false;   // el chip pierde .active con el barrido de .cv-chip.active de abajo
    { const fb = document.getElementById('cv-fav-btn'); if (fb) fb.classList.remove('fav-active'); }
    // Desactivar todos los chips visuales
    document.querySelectorAll('#cv-filters .cv-chip.active').forEach(c => c.classList.remove('active'));
    // Re-sincronizar los botones de operador (≤/=/≥ de HP·Retirada y =/≥ de Coste) a su default '=':
    // son .cv-op-btn (no .cv-chip), así que la línea de arriba NO los tocaba → quedaban resaltados
    // con el operador anterior mientras F.hpOp/rcOp/costMode ya habían vuelto a '='.
    document.querySelectorAll('#cv-filters .cv-op-btn').forEach(b => b.classList.toggle('active', b.textContent.trim() === '='));
    renderCostZone();
    runFilter();
  }
  window._cvClearAllFilters = clearAllFilters;

  // ── Hoja de filtros en móvil ───────────────────────────────────
  // En ≤720px los filtros (y orden/set/vista/acciones) se MUEVEN a una hoja
  // deslizante; en desktop vuelven a su sitio. Se reubica el nodo REAL (no se
  // duplica) → los handlers inline por id siguen funcionando.
  const CV_MQ = window.matchMedia('(max-width: 720px)');
  const CV_RELOC = [
    ['cv-set-wrap', 'cv-fs-top'], ['cv-sort-wrap', 'cv-fs-top'],
    ['cv-view-grid', 'cv-fs-top'], ['cv-view-table', 'cv-fs-top'],
    ['cv-filters', 'cv-fs-filters-host'],
  ];
  function cvAnchor(node) {
    if (node && !node._cvAnchor) {
      const c = document.createComment('cv');
      if (node.parentNode) node.parentNode.insertBefore(c, node);
      node._cvAnchor = c;
    }
  }
  // Nº de columnas para que cada grupo segmentado quede en filas equilibradas
  // (≤2 filas siempre que se pueda; energía 10→5+5, tipo 6→3+3, rareza 9→3×3).
  function cvColsFor(n) {
    if (n <= 1) return 1;
    if (n <= 5) return n;
    if (n === 6) return 3;
    if (n === 10) return 5;
    if (n % 4 === 0) return 4;
    if (n % 3 === 0) return 3;
    return Math.ceil(n / 2);
  }
  // Pasa los grupos segmentados de chips a rejilla de N columnas (móvil): la píldora
  // segmentada se parte en filas equilibradas en vez de salirse de la pantalla.
  // Compartido: lo usan la hoja de filtros de Cartas y el buscador del constructor.
  window.pbGridifyChips = function (host, on) {
    if (!host) return;
    host.querySelectorAll(':scope > .cv-chip-group').forEach(g => {
      if (on) g.style.gridTemplateColumns = 'repeat(' + cvColsFor(g.querySelectorAll('.cv-chip').length) + ', 1fr)';
      else g.style.gridTemplateColumns = '';
    });
  };
  function cvGridifyFilters(on) {
    const fil = document.getElementById('cv-filters');
    if (!fil) return;
    fil.querySelectorAll(':scope > .cv-chip-group').forEach(g => {
      if (on) {
        const n = g.querySelectorAll('.cv-chip').length;
        g.style.gridTemplateColumns = 'repeat(' + cvColsFor(n) + ', 1fr)';
      } else {
        g.style.gridTemplateColumns = '';
      }
    });
  }
  // Avanzados: en escritorio el botón vive en la fila superior y su cuerpo
  // (#cv-advanced) bajo los filtros. En móvil el botón vuelve DENTRO de
  // #cv-advanced (encima del cuerpo) para que viajen juntos a la hoja, como
  // antes. El anclaje recuerda la posición de escritorio (fila superior).
  function cvPlaceAdvMobile() {
    const tog = document.getElementById('cv-adv-toggle');
    const adv = document.getElementById('cv-advanced');
    const txt = document.getElementById('cv-text-wrap');
    const body = document.getElementById('cv-adv-body');
    if (tog && adv && tog.parentNode !== adv) { cvAnchor(tog); adv.insertBefore(tog, adv.firstChild); }
    // la caja de «Texto de la carta» no cabe en la fila superior del móvil → va
    // dentro del cuerpo de la búsqueda avanzada, encima de los chips de efecto
    if (txt && body && txt.parentNode !== body) { cvAnchor(txt); body.insertBefore(txt, body.firstChild); }
  }
  function cvPlaceAdvDesktop() {
    ['cv-adv-toggle', 'cv-text-wrap'].forEach(id => {
      const n = document.getElementById(id);
      if (n && n._cvAnchor && n._cvAnchor.parentNode) n._cvAnchor.parentNode.insertBefore(n, n._cvAnchor);
    });
  }
  function cvMoveToSheet() {
    CV_RELOC.forEach(([id, host]) => {
      const n = document.getElementById(id), h = document.getElementById(host);
      if (n && h && n.parentNode !== h) { cvAnchor(n); h.appendChild(n); }
    });
    cvPlaceAdvMobile();
    cvGridifyFilters(true);
  }
  function cvRestoreFromSheet() {
    cvGridifyFilters(false);
    CV_RELOC.forEach(([id]) => {
      const n = document.getElementById(id);
      if (n && n._cvAnchor && n._cvAnchor.parentNode) n._cvAnchor.parentNode.insertBefore(n, n._cvAnchor);
    });
    cvPlaceAdvDesktop();
  }
  function cvApplyResponsive() {
    if (CV_MQ.matches) cvMoveToSheet();
    else { cvRestoreFromSheet(); if (window._cvCloseFilters) window._cvCloseFilters(); }
  }
  window._cvApplyResponsive = cvApplyResponsive;
  if (CV_MQ.addEventListener) CV_MQ.addEventListener('change', cvApplyResponsive);

  window._cvOpenFilters = function () {
    const s = document.getElementById('cv-filter-sheet'), b = document.getElementById('cv-filter-backdrop');
    if (!s) return;
    s.classList.add('open'); s.setAttribute('aria-hidden', 'false');
    if (b) b.classList.add('open');
    document.body.style.overflow = 'hidden';
  };
  window._cvCloseFilters = function () {
    const s = document.getElementById('cv-filter-sheet'), b = document.getElementById('cv-filter-backdrop');
    if (s) { s.classList.remove('open'); s.setAttribute('aria-hidden', 'true'); }
    if (b) b.classList.remove('open');
    document.body.style.overflow = '';
  };

  // ── Superficie compartida Cartas ↔ constructor móvil ─────────────
  // El constructor NO clona ni reimplementa la búsqueda: reubica temporalmente
  // la cabecera, resultados y hoja de filtros originales. Los comentarios-ancla
  // conservan exactamente su sitio para restaurarlos al abrir la pestaña Cartas.
  let _cvSurfaceHost = null;
  const CV_SURFACE_IDS = ['cv-header', 'cv-body', 'cv-filter-backdrop', 'cv-filter-sheet'];
  function cvSurfaceAnchor(node) {
    if (!node || node._cvSurfaceAnchor) return;
    const a = document.createComment('cv-surface:' + node.id);
    if (node.parentNode) node.parentNode.insertBefore(a, node);
    node._cvSurfaceAnchor = a;
  }
  function cvSurfaceRestoreNode(node) {
    const a = node && node._cvSurfaceAnchor;
    if (a && a.parentNode) a.parentNode.insertBefore(node, a.nextSibling);
  }
  window.pbCardsSurface = {
    mount: function (host, overlayHost) {
      if (!host) return false;
      const overlay = overlayHost || host;
      CV_SURFACE_IDS.forEach(id => cvSurfaceAnchor(document.getElementById(id)));
      ['cv-header', 'cv-body'].forEach(id => {
        const n = document.getElementById(id); if (n && n.parentNode !== host) host.appendChild(n);
      });
      ['cv-filter-backdrop', 'cv-filter-sheet'].forEach(id => {
        const n = document.getElementById(id); if (n && n.parentNode !== overlay) overlay.appendChild(n);
      });
      _cvSurfaceHost = host;
      host.setAttribute('aria-hidden', 'false');
      host.classList.add('mounted');
      if (!window._cvInitialised) initCardsView();
      else { cvApplyResponsive(); runFilter(); }
      return true;
    },
    restore: function () {
      if (window._cvCloseFilters) window._cvCloseFilters();
      CV_SURFACE_IDS.forEach(id => cvSurfaceRestoreNode(document.getElementById(id)));
      if (_cvSurfaceHost) {
        _cvSurfaceHost.classList.remove('mounted', 'active', 'cv-dd-open');
        _cvSurfaceHost.setAttribute('aria-hidden', 'true');
      }
      _cvSurfaceHost = null;
      if (window._cvInitialised) cvApplyResponsive();
    },
    reset: function () {
      if (!window._cvInitialised) initCardsView();
      clearAllFilters();
      setView('grid');
      cvSetCols(3, false);
      const body = document.getElementById('cv-body'); if (body) body.scrollTop = 0;
    },
    refresh: function () { if (window._cvInitialised) runFilter(); },
    isMounted: function () { return !!_cvSurfaceHost; },
    host: function () { return _cvSurfaceHost; },
  };

  // Nº de filtros activos (la búsqueda por nombre NO cuenta: queda siempre visible)
  function cvActiveFilterCount() {
    // (el tipo «Fósil» ya lo cuenta advActiveCount — vive en avanzados — así que no se dobla)
    let n = (F.types.size - (F.types.has('fossil') ? 1 : 0)) + F.els.size + F.stages.size + F.rcs.size + F.rarities.size + advActiveCount()
      + (F.notTypes.size - (F.notTypes.has('fossil') ? 1 : 0)) + F.notEls.size + F.notStages.size + F.notRcs.size + F.notRarities.size + F.mechEx.size;
    if (F.attackCost.length) n++;
    { const cc = document.getElementById('cv-cost-count'); if (cc && cc.value !== '') n++; }
    const hp = document.getElementById('cv-hp-val'); if (hp && hp.value !== '') n++;
    const set = document.getElementById('cv-set'); if (set && set.value) n++;
    ['cv-ex-only', 'cv-mega-only', 'cv-ability-only', 'cv-evoline', 'cv-noevo', 'cv-ub', 'cv-past', 'cv-future', 'cv-tr'].forEach(id => {
      const i = document.getElementById(id); if (i && i.checked) n++;
    });
    if (F.favOnly) n++;
    return n;
  }
  window._cvSyncFilterUI = function (resultCount) {
    const badge = document.getElementById('cv-filters-badge');
    if (badge) {
      const n = cvActiveFilterCount();
      badge.textContent = n;
      badge.hidden = n === 0;
    }
    const fc = document.getElementById('cv-fs-count');
    if (fc && typeof resultCount === 'number') fc.textContent = '(' + resultCount + ')';
  };

  // ── Pinch para cambiar columnas (3→5→7) con animación FLIP, estilo TCG Pocket ──
  // Pinch IN (dedos juntos) = zoom OUT = MÁS columnas (cartas más pequeñas).
  const CV_COL_STEPS = [3, 5, 7];
  let _cvCols = 3;
  let _cvLastN = 99999;   // nº de resultados actual (capa el zoom-out permitido)
  // Tope de columnas (zoom-out) según resultados: ≤9 → 3, 10-30 → 5, >30 → 7.
  function cvMaxCols() {
    if (_cvLastN >= 1 && _cvLastN <= 9) return 3;
    if (_cvLastN >= 10 && _cvLastN <= 30) return 5;
    return 7;
  }
  function cvSetCols(n, animate) {
    n = Math.max(CV_COL_STEPS[0], Math.min(CV_COL_STEPS[CV_COL_STEPS.length - 1], n));
    const grid = document.getElementById('cv-grid');
    if (!grid) return;
    if (!animate || n === _cvCols) { grid.style.setProperty('--cv-cols', n); grid.setAttribute('data-cols', n); _cvCols = n; return; }
    grid.setAttribute('data-cols', n);
    // FLIP solo en las cartas VISIBLES (+margen) → el pinch va fluido aunque
    // haya 80+ cartas cargadas. Las de fuera de pantalla reflowan sin animar.
    const vh = window.innerHeight || 800;
    const wraps = Array.prototype.slice.call(grid.querySelectorAll('.cv-card-wrap'))
      .filter(w => { const r = w.getBoundingClientRect(); return r.bottom > -120 && r.top < vh + 120; });
    const first = wraps.map(w => w.getBoundingClientRect());
    grid.style.setProperty('--cv-cols', n);   // Last
    _cvCols = n;
    grid.classList.add('cv-cols-anim');
    wraps.forEach((w, i) => {                  // Invert
      const last = w.getBoundingClientRect();
      if (!first[i].width || !last.width) return;
      const dx = first[i].left - last.left;
      const dy = first[i].top - last.top;
      const ds = first[i].width / last.width;
      w.style.transition = 'none';
      w.style.transformOrigin = 'top left';
      w.style.transform = `translate(${dx}px,${dy}px) scale(${ds})`;
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {   // Play
      wraps.forEach(w => {
        w.style.transition = 'transform 0.44s cubic-bezier(0.22,1,0.36,1)';
        w.style.transform = '';
      });
    }));
    clearTimeout(grid._colsT);
    grid._colsT = setTimeout(() => {
      wraps.forEach(w => { w.style.transition = ''; w.style.transform = ''; w.style.transformOrigin = ''; });
      grid.classList.remove('cv-cols-anim');
    }, 540);
  }
  function cvStepCols(dir) {
    const idx = CV_COL_STEPS.indexOf(_cvCols);
    const ni = Math.max(0, Math.min(CV_COL_STEPS.length - 1, (idx < 0 ? 0 : idx) + dir));
    let target = CV_COL_STEPS[ni];
    if (target > cvMaxCols()) target = cvMaxCols();   // no alejar más de lo permitido por los resultados
    if (target !== _cvCols) cvSetCols(target, true);
  }
  // Abre la pestaña Cartas mostrando SOLO las cartas custom (lo llama el popup de reglas
  // del formato Avanzado, que es donde se descubre que existen).
  window._cvShowCustomCards = function () {
    if (window.switchAppTab) window.switchAppTab('cards');
    setTimeout(() => {
      const chip = document.getElementById('cv-custom-chip');
      if (!chip || F.customOnly) { if (!F.customOnly && chip) window._cvToggleCustom(chip); return; }
      const adv = document.getElementById('cv-advanced');
      if (adv && !adv.classList.contains('open') && window._cvToggleAdvanced) window._cvToggleAdvanced();
      window._cvToggleCustom(chip);
      chip.scrollIntoView({ block: 'nearest' });
    }, 260);
  };

  window._cvResults = () => _lastResults.slice();   // hook de test (resultados del filtro actual)
  window._cvSetCols = cvSetCols;     // hook de test
  window._cvStepCols = cvStepCols;

  // Zoom inteligente al FILTRAR (solo móvil, solo HACIA cerca, SIN animación —
  // las cartas se re-renderizan): 1-9 resultados → carga de cerca (3 col); 10-30
  // → zoom medio (5 col) SOLO si estaba más alejado (7). Nunca aleja (a la inversa).
  // Cue «primera vez»: cómo AÑADIR al mazo (clic derecho / mantener) — solo en Cartas,
  // con resultados y hueco en el mazo. La elegibilidad y el no-apilado los gestiona pbCue.
  function _cvMaybeAddCue(n) {
    if (!n || !window.pbCue || !window.pbCue.eligible || !window.pbCue.eligible('cardsAddDeck')) return;
    var view = document.getElementById('view-cards');
    var inCards = !!(view && getComputedStyle(view).display !== 'none');
    var mounted = !!(window.pbCardsSurface && window.pbCardsSurface.isMounted());
    if (!inCards && !mounted) return;
    var deck = (_pillCtx && _pillCtx.deck ? _pillCtx.deck() : []) || [];
    if (deck.length >= _pillMax()) return;
    setTimeout(function () {
      // Ancla el bocadillo al POP-UP DEL MAZO (esquina), no a una carta al azar:
      // así descubres el deck builder y no señalas una carta concreta.
      var pill = document.getElementById('cv-deck-pill');
      // offsetParent es null en position:fixed → medir por rect (0 si display:none).
      if (pill && pill.getBoundingClientRect().width > 0) window.pbCue.maybe('cardsAddDeck', { anchor: pill, place: 'above' });
    }, 500);
  }

  function cvAutoZoom(n) {
    _cvLastN = n;            // siempre, para que cvMaxCols cape el pinch
    if (!CV_COARSE) return;
    if (n >= 1 && n <= 9) { if (_cvCols > 3) cvSetCols(3, false); }
    else if (n >= 10 && n <= 30) { if (_cvCols > 5) cvSetCols(5, false); }
  }

  // ── Pulsación larga para añadir al mazo (TÁCTIL): 0,5s = 1 copia, +0,5s = 2ª ──
  // Sustituye al «+» (que desaparece al hacer zoom-out) en táctil; en PC sigue
  // el clic derecho. La lupa/selector de iOS se evita con user-select/callout:none.
  // El segundo reloj nace DESPUÉS de ejecutar la primera copia. Si el hilo estuvo
  // bloqueado, nunca se vacían los dos callbacks juntos (dos cartas + dos sonidos).
  const CV_LP_FIRST_MS = 500, CV_LP_REPEAT_MS = 500;
  let _lpEl = null, _lpT1 = null, _lpT2 = null, _lpSX = 0, _lpSY = 0, _lpAdded = 0, _lpGen = 0;
  function cvLpEnd() {
    _lpGen++;   // invalida también callbacks ya vencidos que esperan turno en la cola
    clearTimeout(_lpT1); clearTimeout(_lpT2);
    _lpT1 = _lpT2 = null;
    if (_lpEl) { _lpEl.classList.remove('lp'); _lpEl = null; }
  }
  function cvLpStart(imgDiv, addFn, e) {
    if (e.pointerType !== 'touch') return;     // PC usa clic derecho
    if (!_deckEditing()) return;               // sin mazo en edición no se arma el anillo
    if (_lpEl) { cvLpEnd(); return; }           // 2º dedo (pinch) → cancelar
    const gen = ++_lpGen;
    _lpEl = imgDiv; _lpSX = e.clientX; _lpSY = e.clientY; _lpAdded = 0;
    imgDiv.classList.remove('lp'); void imgDiv.offsetWidth;   // reinicia la animación del anillo
    imgDiv.classList.add('lp');
    _lpT1 = setTimeout(() => {
      _lpT1 = null;
      if (gen !== _lpGen || _lpEl !== imgDiv) return;
      // Desde aquí ya fue una pulsación larga, aunque la carta sea duplicada,
      // esté vetada o el mazo esté lleno: el click posterior no debe abrir zoom.
      _lpAdded = 1;
      const first = addFn();
      // duplicate/full/banned llama a cvLpBlock() dentro de addFn e invalida gen.
      if (gen !== _lpGen || _lpEl !== imgDiv) return;
      if (first !== 'added') { cvLpEnd(); return; }
      if (window.pbCue) window.pbCue.done('cardsAddDeck');
      _lpT2 = setTimeout(() => {
        _lpT2 = null;
        if (gen !== _lpGen || _lpEl !== imgDiv) return;
        const second = addFn();
        if (gen !== _lpGen || _lpEl !== imgDiv) return;
        if (second === 'added') _lpAdded = 2;
        cvLpEnd();
      }, CV_LP_REPEAT_MS);
    }, CV_LP_FIRST_MS);
  }
  function cvLpMove(e) {
    if (_lpEl && (Math.abs(e.clientX - _lpSX) > 10 || Math.abs(e.clientY - _lpSY) > 10)) cvLpEnd();
  }
  function cvLpUp(imgDiv) {
    if (_lpAdded > 0) imgDiv._suppressClick = true;   // tras añadir, NO abrir el zoom
    cvLpEnd();
  }

  // Al rechazar durante una pulsación larga: el anillo de carga se PARA y se
  // vuelve rojo (como si chocara), y no añade más.
  function cvLpBlock(imgDiv) {
    _lpGen++;
    clearTimeout(_lpT1); clearTimeout(_lpT2);
    _lpT1 = _lpT2 = null;
    imgDiv.classList.add('lp-blocked');
    setTimeout(() => { imgDiv.classList.remove('lp', 'lp-blocked'); if (_lpEl === imgDiv) _lpEl = null; }, 520);
  }

  // Pulso en la CARTA (no en el «+»). OK = pulso sutil + ONDA mística que se
  // desvanece (cada añadido lanza su onda → se superponen). ERR = shake sutil
  // multidirección + el anillo se para y enrojece. z-index elevado para
  // superponerse a las cartas vecinas si quedan muy cerca.
  function cvCardPulse(el, kind) {
    if (!el) return;
    if (kind === 'err') {
      el.classList.remove('cv-add-err'); void el.offsetWidth;
      el.classList.add('cv-add-err');
      setTimeout(() => el.classList.remove('cv-add-err'), 480);
      if (el.classList.contains('lp')) cvLpBlock(el);
      return;
    }
    el.classList.remove('cv-add-ok'); void el.offsetWidth;
    el.classList.add('cv-add-ok');
    setTimeout(() => el.classList.remove('cv-add-ok'), 520);
  }

  // Añadir carta al mazo con pulso/háptico. Es LA MISMA función para Cartas y para
  // el builder de Mis Mazos: la fuente del mazo la decide el contexto del pill
  // (_pillCtx.addCard → deckQueues en Cartas, _mzEditCards en Mis Mazos).
  function _cvAddWithPulse(card, imgDiv) {
    if (!_deckEditing()) return 'nodeck';   // sin mazo en edición no se añade nada (Cartas = consulta)
    const deckCard = Object.assign({}, card, { expansion: card.set || card.expansion || '' });
    const result = _pillCtx.addCard(deckCard);
    if (result === 'added') {
      cvCardPulse(imgDiv, 'ok');
      if (window.pbHaptic) window.pbHaptic('light');
      if (_pillCtx.onAdd) _pillCtx.onAdd(card);
    } else if (result === 'full' || result === 'duplicate' || result === 'banned') {
      cvCardPulse(imgDiv, 'err');
      if (window.pbHaptic) window.pbHaptic('error');
    }
    return result;
  }
  window._cvAddWithPulse = _cvAddWithPulse;
  window.cvCardPulse = cvCardPulse;
  window.cvLpStart = cvLpStart; window.cvLpMove = cvLpMove; window.cvLpUp = cvLpUp; window.cvLpEnd = cvLpEnd;

  // Gesto pinch en el cuerpo de resultados (solo táctil)
  (function cvWirePinch() {
    const body = document.getElementById('cv-body');
    if (!body) return;
    let d0 = 0, pinching = false;
    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    body.addEventListener('touchstart', e => {
      if (e.touches.length === 2) { pinching = true; d0 = dist(e.touches); cvLpEnd(); }  // pinch ≠ long-press
    }, { passive: true });
    body.addEventListener('touchmove', e => {
      if (!pinching || e.touches.length !== 2) return;
      e.preventDefault();                       // bloquea el zoom nativo del navegador
      const d = dist(e.touches), r = d / (d0 || 1);
      if (r < 0.72)       { cvStepCols(+1); d0 = d; }   // dedos juntos → más columnas
      else if (r > 1.42)  { cvStepCols(-1); d0 = d; }   // dedos separados → menos
    }, { passive: false });
    body.addEventListener('touchend', e => { if (e.touches.length < 2) pinching = false; }, { passive: true });
  })();

  // ── Card zoom — uses the board's full flip+holo animation ──────
  function openCardZoom(card, fromEl) {
    const z = cvCardImg(card);
    if (!z) return;
    if (typeof window.openZoomFromImage === 'function') {
      window.openZoomFromImage(z, fromEl || null, { rarity: card.rarity });
    }
  }

  // ── Deck Pill ──────────────────────────────────────────────────
  let _pillPlayer = 'p1';
  let _pillTimer  = null;

  let _pillHovered = false;

  // ── Contexto del pill ──────────────────────────────────────────────
  // El MISMO pill (#cv-deck-pill) se usa en dos sitios (Cartas y el builder de Mis Mazos):
  // NO se replica, se GENERALIZA. El contexto abstrae de dónde sale el mazo y qué hacen los
  // botones. Por defecto = Cartas (deckQueues + tablero); Mis Mazos apunta el pill a SU mazo
  // vía window.pbPill.setCtx(). Un solo mazo por sitio, sincronizado con su vista.
  const _pillCtxDefault = {
    mode: 'cards',
    deck: () => (window.deckQueues && window.deckQueues[_pillPlayer]) || [],
    // El mazo de Cartas es el del builder de la sidebar → su tamaño y su tope de copias
    // salen del FORMATO de ese lado (20/2 Estándar · 30/2 Avanzado), no de constantes.
    max: () => (window.deckSizeFor && window._pbSideFormat) ? window.deckSizeFor(window._pbSideFormat(_pillPlayer)) : 20,
    maxCopies: () => (window.maxCopiesFor && window._pbSideFormat) ? window.maxCopiesFor(window._pbSideFormat(_pillPlayer)) : 2,
    noAutoClose: false,
    removeCopy: function (key) {
      if (!window.deckQueues) return;
      const deck = window.deckQueues[_pillPlayer];
      const idx = deck.findLastIndex(c => (c.id || c.name) === key);   // key = IMPRESIÓN (ver cvPillRefresh)
      if (idx === -1) return;
      deck.splice(idx, 1);
      window.sfx && window.sfx('cards.removeDeck');
      if (window.deckPlayQueues) window.deckPlayQueues[_pillPlayer] = null;
      if (window.renderDeckList) window.renderDeckList();
      if (window.pbHaptic) window.pbHaptic('light');
    },
    addCopy: function (card, key) {
      if (!window.deckQueues) return;
      const deck = window.deckQueues[_pillPlayer];
      // El tope es POR NOMBRE (regla de Pocket: 2 copias del mismo nombre, sea cual sea la
      // impresión); la inserción va junto a su MISMA impresión.
      const nk = String((card && card.name) || key).toLowerCase();
      const cnt = deck.filter(c => String(c.name || c.id).toLowerCase() === nk).length;
      if (cnt >= _pillCap() || deck.length >= _pillMax()) return;
      const first = deck.findIndex(c => (c.id || c.name) === key);
      const clone = Object.assign({}, card);
      if (first === -1) deck.push(clone); else deck.splice(first + 1, 0, clone);
      window.sfx && window.sfx('cards.addDeck');
      if (window.deckPlayQueues) window.deckPlayQueues[_pillPlayer] = null;
      if (window.renderDeckList) window.renderDeckList();
      if (window.pbHaptic) window.pbHaptic('light');
    },
    addCard: function (card) { return window.addCardToDeck ? window.addCardToDeck(card) : null; },   // devuelve 'added'|'full'|'duplicate'
    onAdd: function (card) { cvPillAdd(card); },   // Cartas: abre/refresca el pill al añadir
    save: function () { if (window.saveDeckToLibrary) window.saveDeckToLibrary(); },
    clear: function () { if (window.clearDeck) window.clearDeck(); },
  };
  let _pillCtx = _pillCtxDefault;

  // ── ¿Hay una SESIÓN DE EDICIÓN de mazo abierta ahora mismo? ────────────────
  // Construir un mazo es un estado con principio y fin (como la partida del tablero). Fuera de
  // esa sesión, Cartas es SOLO consulta: no sale el pop-up del mazo y los gestos de añadir no
  // hacen nada — antes escribían en deckQueues.p1 (el mazo del builder del tablero) a ciegas.
  // Tres formas legítimas de estar editando:
  //   · Barajas con el constructor abierto (_mazosIsEditing) — su ctx es _mzPillCtx.
  //   · El pop-up apuntando a un mazo que no es el de Cartas (ctx propio ya puesto por setCtx).
  //   · Importar por texto/QR, que edita EN Cartas con deckQueues (_cvEditingDeck/_cvEditReturn).
  // OJO: recargar la página estando en Cartas NO cuenta como sesión (el borrador está aparcado y
  // lo reanuda Barajas al entrar); es deliberado, así «editando» siempre significa lo mismo.
  function _deckEditing() {
    if (_pillCtx && _pillCtx !== _pillCtxDefault) return true;
    if (window._mazosIsEditing && window._mazosIsEditing()) return true;
    if (window._cvEditingDeck || window._cvEditReturn) return true;
    return false;
  }
  window.pbDeckEditing = _deckEditing;   // hook de test + consumidores externos

  // Aplica ese estado a la pestaña Cartas: pop-up visible o no, y clase que apaga los «+».
  function _cvSyncDeckUI() {
    const editing = _deckEditing();
    const view = document.getElementById('view-cards');
    if (view) view.classList.toggle('cv-no-deck', !editing);
    const pill = document.getElementById('cv-deck-pill');
    if (!pill) return;
    const inCards = !!(view && view.style.display !== 'none');
    if (!editing) {
      // Cerrar por CLASE y por display a la vez (el pop-up abre por clase: dejar solo el
      // display puesto lo dejaría inservible al reabrir).
      pill.classList.remove('open', 'closing', 'cv-slide-off');
      pill.style.display = 'none';
      const bd = document.getElementById('cv-deck-backdrop');
      if (bd) bd.classList.remove('open');
      return;
    }
    if (!inCards) return;              // en Barajas la visibilidad la decide _mzPillEval (scroll)
    pill.style.display = 'block';
    pill.classList.remove('open');
    cvPillRefresh();
    cvPillInitHover();
  }
  window._cvSyncDeckUI = _cvSyncDeckUI;

  // `max`/`maxCopies` del contexto admiten número (Barajas, fijado al entrar a editar) o
  // función (Cartas, depende del formato del lado activo, que puede cambiar en caliente).
  function _pillMax()  { const m = _pillCtx.max;       return (typeof m === 'function' ? m() : m) || 20; }
  function _pillCap()  { const m = _pillCtx.maxCopies; return (typeof m === 'function' ? m() : m) || 2; }
  // El pill nace DENTRO de #view-cards → si esa vista está display:none (Mis Mazos), el pill no
  // renderiza aunque su propio display sea block. Se mueve UNA vez a <body> (position:fixed, así
  // flota sobre cualquier vista); no rompe Cartas (todo va por getElementById, no por posición DOM).
  function _pillEnsureBody() {
    const p = document.getElementById('cv-deck-pill');
    if (p && p.parentElement !== document.body) document.body.appendChild(p);
    const bd = document.getElementById('cv-deck-backdrop');
    if (bd && bd.parentElement !== document.body) document.body.appendChild(bd);
  }
  window.pbPill = {
    setCtx: function (ctx) {
      _pillEnsureBody();
      _pillCtx = Object.assign({}, _pillCtxDefault, ctx || {});
      const p = document.getElementById('cv-deck-pill');
      if (p) p.classList.toggle('pill-ext', _pillCtx.mode !== 'cards');   // oculta save/clear fuera de Cartas
      cvPillInitHover();   // idempotente: cablea el pill aunque Cartas no se haya abierto nunca
      _cvSyncDeckUI();     // entrar en edición habilita el pop-up y los «+» de Cartas
    },
    resetCtx: function () { _pillCtx = _pillCtxDefault; const p = document.getElementById('cv-deck-pill'); if (p) p.classList.remove('pill-ext'); },
    refresh: function () { cvPillRefresh(); },
    show: function () { _pillEnsureBody(); const p = document.getElementById('cv-deck-pill'); if (p) { clearTimeout(p._extHideT); p.style.display = 'block'; } _pillHovered = false; cvPillShow(); },
    // Ocultar del todo (no dejar el FAB en reposo): usado cuando el mazo vuelve a estar a la vista.
    hide: function () { _pillHovered = false; clearTimeout(_pillTimer); const p = document.getElementById('cv-deck-pill'); cvPillHide(); if (p) { clearTimeout(p._extHideT); p._extHideT = setTimeout(() => { if (!p.classList.contains('open')) p.style.display = 'none'; }, 340); } },
    // Aparecer CERRADO (FAB en la esquina) con un pulso «estoy aquí» — sin abrir el panel.
    peek: function () {
      _pillEnsureBody();
      const p = document.getElementById('cv-deck-pill'); if (!p) return;
      clearTimeout(p._extHideT); clearTimeout(_pillTimer); clearTimeout(p._closeT);
      cvPillRefresh();
      p.style.display = 'block';
      p.classList.remove('open', 'closing');   // colapsado = FAB
      p.classList.remove('pill-peek'); void p.offsetWidth; p.classList.add('pill-peek');
      clearTimeout(p._peekT); p._peekT = setTimeout(() => p.classList.remove('pill-peek'), 1500);
    },
    isOpen: function () { const p = document.getElementById('cv-deck-pill'); return !!(p && p.classList.contains('open')); },
  };

  // Cue «primera vez»: cómo QUITAR del mazo (clic derecho / swipe arriba), al abrir el pop-up con cartas.
  function _cvMaybeRemoveCue() {
    if (!window.pbCue || !window.pbCue.maybe) return;
    const deck = _pillCtx.deck();
    if (!deck.length) return;
    // La elegibilidad se comprueba DENTRO del setTimeout (maybe la re-evalúa): al abrir
    // el mazo se acaba de descartar la cue de AÑADIR y su nodo tarda ~260ms en irse.
    setTimeout(function () {
      // float no necesita ancla; ya sabemos que hay cartas (deck.length arriba).
      const pill = document.getElementById('cv-deck-pill');
      if (pill && pill.classList.contains('open')) window.pbCue.maybe('cardsRemoveDeck', { place: 'float' });   // flotante minimal (como la Tierlist)
    }, 550);
  }

  function cvPillShow() {
    const pill = document.getElementById('cv-deck-pill');
    if (!pill) return;
    if (!_deckEditing()) return;   // sin sesión de edición el pop-up no existe
    const wasOpen = pill.classList.contains('open');   // re-añadir con el panel abierto NO re-desliza
    if (!wasOpen && window.pbCue) window.pbCue.dismiss('cardsAddDeck');  // abrir el mazo cierra la cue de «añadir»
    pill.style.display = 'block';
    pill.classList.remove('closing');
    pill.classList.add('open');
    cvPillRefresh();
    cvPillSyncNames();
    _cvMaybeRemoveCue();   // cue «primera vez»: cómo quitar del mazo
    // En táctil NO hay hover → el panel se queda abierto hasta tocar fuera/×
    // (nada de auto-cierre por temporizador). Solo auto-cierra con ratón.
    const touch = window.pbIsTouchMobile && window.pbIsTouchMobile();
    const bd = document.getElementById('cv-deck-backdrop');
    if (bd) bd.classList.toggle('open', !!touch);
    if (touch && !wasOpen) {
      // Slide-in desde abajo (como la hoja de filtros), solo al ABRIR
      pill.classList.add('cv-slide-off', 'cv-slide-instant');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pill.classList.remove('cv-slide-instant');
        pill.classList.remove('cv-slide-off');
      }));
    }
    if (!_pillHovered && !touch && !_pillCtx.noAutoClose) {
      clearTimeout(_pillTimer);
      _pillTimer = setTimeout(cvPillHide, 3500);
    }
  }

  // Sync player names from the board header into the pill buttons
  function cvPillSyncNames() {
    ['p1','p2'].forEach(pl => {
      const nameEl = document.getElementById('pname-' + pl);
      const btn    = document.querySelector(`.cv-pill-player[data-pl="${pl}"]`);
      if (nameEl && btn) btn.textContent = nameEl.textContent.trim() || (pl === 'p1' ? 'J1' : 'J2');
    });
  }

  // Wire hover expand/collapse once
  function cvPillInitHover() {
    const pill = document.getElementById('cv-deck-pill');
    if (!pill || pill._hoverWired) return;
    pill._hoverWired = true;

    // Track real mouse position — mouseleave fires spuriously during CSS expansion
    let _mx = 0, _my = 0;
    document.addEventListener('mousemove', e => { _mx = e.clientX; _my = e.clientY; }, { passive: true });

    // `mouseenter` también llega como evento de compatibilidad tras un toque. Eso
    // expandía el FAB ANTES del click y Chrome re-hacía el hit-test sobre la carta
    // de debajo. Hover solo significa ratón real; el toque abre por click más abajo.
    pill.addEventListener('pointerenter', e => {
      if (e.pointerType !== 'mouse') return;
      _pillHovered = true;
      clearTimeout(_pillTimer);   // cancel any pending hide
      pill.classList.remove('closing');
      if (!pill.classList.contains('open')) cvPillShow();
    });

    pill.addEventListener('pointerleave', e => {
      if (e.pointerType !== 'mouse') return;
      // Wait for CSS transition to settle, then verify the mouse truly left
      setTimeout(() => {
        const r = pill.getBoundingClientRect();
        const inside = _mx >= r.left - 8 && _mx <= r.right + 8
                    && _my >= r.top  - 8 && _my <= r.bottom + 8;
        if (inside) return;                        // spurious leave during expansion
        _pillHovered = false;
        clearTimeout(_pillTimer);
        _pillTimer = setTimeout(cvPillHide, 3500); // same delay as card-add trigger
      }, 120);
    });

    // Sin hover (táctil, stylus o un dispositivo híbrido), tocar el FAB lo abre.
    // Es universal porque el tipo de puntero puede cambiar durante la sesión.
    // NO se cierra al tocar fuera: así los resultados siguen siendo utilizables.
    pill.addEventListener('click', e => {
      if (pill.classList.contains('open')) return;   // ya abierta: los botones internos actúan
      e.preventDefault();
      e.stopPropagation();
      _pillHovered = true;          // evita el auto-cierre por temporizador
      clearTimeout(_pillTimer);
      cvPillShow();
    });

    window._cvPillSave = function() { _pillCtx.save(); };
    // Abrir la píldora cargada al entrar a editar/crear un mazo desde Mazos.
    // Fuerza J1 (donde se carga el mazo a editar) y la deja abierta (sin auto-cierre).
    window._cvBeginEdit = function() {
      _cvSyncDeckUI();     // importar por texto/QR también es una sesión de edición
      _pillPlayer = 'p1';
      if (window.switchDeckTab) window.switchDeckTab('p1');
      document.querySelectorAll('.cv-pill-player').forEach(b => b.classList.toggle('active', b.dataset.pl === 'p1'));
      _pillHovered = true;            // mantener abierta mientras editas
      cvPillRefresh();
      cvPillShow();
    };
    window._cvPillClear = function() { _pillCtx.clear(); cvPillRefresh(); };
  }

  function cvPillHide() {
    const pill = document.getElementById('cv-deck-pill');
    if (!pill || !pill.classList.contains('open')) return;
    if (window.pbCue) window.pbCue.dismiss('cardsRemoveDeck');  // su ancla (miniatura) desaparece al cerrar

    const bd = document.getElementById('cv-deck-backdrop');
    if (bd) bd.classList.remove('open');
    clearTimeout(pill._closeT);
    const touch = window.pbIsTouchMobile && window.pbIsTouchMobile();
    if (touch) {
      // Slide-out hacia abajo
      pill.classList.remove('cv-slide-instant');
      pill.classList.add('cv-slide-off');
      pill._closeT = setTimeout(() => { pill.classList.remove('open', 'cv-slide-off'); }, 340);
    } else {
      pill.classList.add('closing');
      pill._closeT = setTimeout(() => { pill.classList.remove('open', 'closing'); }, 300);
    }
  }
  // Cierre explícito (botón × / backdrop en móvil) — resetea el flag de hover
  window._cvPillClose = function () { _pillHovered = false; clearTimeout(_pillTimer); cvPillHide(); };

  // Color progresivo 0→20: gris → naranja → amarillo → verde
  window.pbPillCountColor = c => pillCountColor(c);
  function pillCountColor(count) {
    if (count === 0) return 'rgba(255,255,255,0.25)';
    // Interpolate HSL hue from 15° (orange) at 1 to 128° (green) at 20
    const t   = Math.min(count, 20) / 20;
    const hue = Math.round(15 + t * 113);
    const sat = 80;
    const lit = 62;
    return `hsl(${hue}deg ${sat}% ${lit}%)`;
  }

  // Quita UNA copia (la última) del mazo del jugador activo. Reusado por el
  // clic derecho (desktop) y el swipe-up (táctil).
  function removeOneCopy(key) {
    _pillCtx.removeCopy(key);   // Cartas = deckQueues+tablero; Mis Mazos = su mazo (ver setCtx)
    cvPillRefresh();
  }

  // Botón + : añade la 2ª copia — inserta un clon justo tras la 1ª copia, como el deckbuilder
  // del sidebar. Respeta el máximo (2 por nombre, 20 en total).
  function addOneCopy(card, key) {
    _pillCtx.addCopy(card, key);
    cvPillRefresh();
  }

  function cvPillRefresh() {
    const deck  = _pillCtx.deck();
    const MAX   = _pillMax();
    const count = deck.length;
    const countEl = document.getElementById('cv-pill-count');
    const bar     = document.getElementById('cv-pill-bar');
    const thumbs  = document.getElementById('cv-pill-thumbs');
    if (!countEl) return;
    const pill = document.getElementById('cv-deck-pill'); if (pill) pill.dataset.max = String(MAX);
    const maxEl = document.getElementById('cv-pill-max'); if (maxEl) maxEl.textContent = '/' + MAX;

    // Update resting-state count with progressive color
    const restCount = document.getElementById('cv-pill-rest-count');
    if (restCount) {
      restCount.innerHTML = `<span style="color:${pillCountColor(count)}">${count}</span>/${MAX}`;
    }
    // Expanded count with bump animation + progressive color
    const prev = parseInt(countEl.textContent) || 0;
    countEl.textContent = count;
    countEl.style.color = pillCountColor(count);
    if (count !== prev) {
      countEl.classList.remove('bump');
      requestAnimationFrame(() => requestAnimationFrame(() => countEl.classList.add('bump')));
      setTimeout(() => countEl.classList.remove('bump'), 300);
    }

    // Progress bar
    const pct = (count / MAX) * 100;
    bar.style.width = pct + '%';
    bar.classList.toggle('full', count >= MAX);

    // Thumbnails — una miniatura por IMPRESIÓN (no por nombre), igual que el builder grande
    // (collapseCards, mazos-view.js): dos Luxray de sets distintos son DOS cartas, no una ×2.
    // El TOPE de copias sigue siendo POR NOMBRE (regla de Pocket) → mapa aparte `byName`.
    const seen   = new Map();   // id → {card, count}   (lo que se ve)
    const byName = new Map();   // nombre → nº total de copias (lo que capa el +)
    deck.forEach(c => {
      const key = c.id || c.name;
      if (seen.has(key)) seen.get(key).count++;
      else seen.set(key, { card: c, count: 1 });
      const nk = String(c.name || c.id).toLowerCase();
      byName.set(nk, (byName.get(nk) || 0) + 1);
    });
    const _capName = _pillCap();

    const SLOTS = 10;
    const prevKeys   = new Set([...thumbs.querySelectorAll('.cv-pill-thumb-wrap')].map(w => w.dataset.key));
    const prevCounts = new Map([...thumbs.querySelectorAll('.cv-pill-thumb-wrap')].map(w => [w.dataset.key, parseInt(w.dataset.count||'0')]));

    thumbs.innerHTML = '';
    let slot = 0;
    seen.forEach(({ card: c, count }, key) => {
      const wrap = document.createElement('div');
      wrap.className = 'cv-pill-thumb-wrap';
      wrap.dataset.key   = key;
      wrap.dataset.count = count;
      const t = document.createElement('div');
      t.className = 'cv-pill-thumb';
      const _pImg = cvCardImg(c);
      if (_pImg) t.style.backgroundImage = `url("${_pImg}")`;
      const isNew       = !prevKeys.has(key);
      const gotSecond   = !isNew && count === 2 && (prevCounts.get(key) || 0) < 2;
      if (isNew)     t.classList.add('pop-in');
      else if (gotSecond) t.classList.add('pop-second');
      wrap.appendChild(t);
      // Clic derecho (desktop) = quitar una copia
      wrap.addEventListener('contextmenu', e => { e.preventDefault(); removeOneCopy(key); if (window.pbCue) window.pbCue.done('cardsRemoveDeck'); });
      // Táctil: SWIPE UP = quitar. Es un GESTO (no drag-drop): al detectar que el
      // dedo sube >24px, dispara una animación FIJA (vuela arriba + fade ease-in
      // desde el primer momento), da igual dónde se suelte.
      let _sy = 0, _swiping = false, _fired = false;
      function fireRemove() {
        _fired = true;
        if (window.pbCue) window.pbCue.done('cardsRemoveDeck');
        wrap.style.zIndex = '100';            // se superpone a la UI
        // Snappy: el deslizamiento (0.24s, ease-in fuerte) y la opacidad MÁS
        // rápida (0.16s) → la carta está totalmente desvanecida antes de acabar de subir.
        t.style.transition = 'transform 0.24s cubic-bezier(0.55,0,1,0.45), opacity 0.16s cubic-bezier(0.5,0,1,1)';
        t.style.transform = 'translateY(-130px) scale(0.8)';
        t.style.opacity = '0';
        if (window.pbHaptic) window.pbHaptic('light');
        setTimeout(() => removeOneCopy(key), 230);
      }
      wrap.addEventListener('pointerdown', e => {
        if (e.pointerType !== 'touch') return;
        _sy = e.clientY; _swiping = true; _fired = false;
      });
      wrap.addEventListener('pointermove', e => {
        if (!_swiping || _fired) return;
        if (e.clientY - _sy < -24) fireRemove();   // swipe-up detectado → gesto
      });
      wrap.addEventListener('pointerup', () => { _swiping = false; });
      wrap.addEventListener('pointercancel', () => { _swiping = false; });
      // Stepper − N + IDÉNTICO al deckbuilder del sidebar (mismas clases .deck-copy-badge/.dcb-*):
      // el contador siempre visible; los +/− aparecen (y son clicables) solo al hover (desktop).
      // En táctil quedan ocultos y sin pointer-events → no interfieren con el swipe-up de quitar.
      const badge = document.createElement('div');
      badge.className = 'deck-copy-badge';
      const dMinus = document.createElement('span');
      dMinus.className = 'dcb-minus';
      dMinus.textContent = '−';
      dMinus.addEventListener('click', e => { e.stopPropagation(); removeOneCopy(key); });
      const dCount = document.createElement('span');
      dCount.className = 'dcb-count';
      dCount.textContent = count;
      const dPlus = document.createElement('span');
      const _nCnt = byName.get(String(c.name || c.id).toLowerCase()) || count;   // tope por NOMBRE
      dPlus.className = 'dcb-plus' + ((_nCnt >= _capName || deck.length >= MAX) ? ' maxed' : '');
      dPlus.textContent = '+';
      dPlus.addEventListener('click', e => { e.stopPropagation(); addOneCopy(c, key); });
      badge.appendChild(dMinus); badge.appendChild(dCount); badge.appendChild(dPlus);
      wrap.appendChild(badge);
      thumbs.appendChild(wrap);
      slot++;
    });
    // Fill remaining slots with empty placeholders up to SLOTS
    for (; slot < SLOTS; slot++) {
      const empty = document.createElement('div');
      empty.className = 'cv-pill-empty';
      thumbs.appendChild(empty);
    }
  }

  function cvPillAdd(card) {
    window.sfx && window.sfx('cards.addDeck'); // añadir una carta al mazo (pestaña Cartas)
    // Sync to whichever player deck is currently active
    const activePl = window._deckTabActive || 'p1';
    if (activePl !== _pillPlayer) {
      _pillPlayer = activePl;
      document.querySelectorAll('.cv-pill-player').forEach(b => {
        b.classList.toggle('active', b.dataset.pl === _pillPlayer);
      });
    }
    // En TÁCTIL con el panel cerrado (flujo de pulsación larga): solo subir el
    // contador del FAB (sin abrir el panel, para poder seguir añadiendo del grid).
    // En desktop / panel abierto: cvPillShow (preview con auto-cierre / refresh).
    const pill = document.getElementById('cv-deck-pill');
    const touch = window.pbIsTouchMobile && window.pbIsTouchMobile();
    if (touch && pill && !pill.classList.contains('open')) {
      cvPillRefresh();
      pill.classList.remove('fab-bump'); void pill.offsetWidth; pill.classList.add('fab-bump');
    } else {
      // addCardToDeck ya actualizó deckQueues; un cvPillRefresh (dentro de
      // cvPillShow) basta — un 2º llamada borraría el DOM y cancelaría el pop-in.
      cvPillShow();
    }
  }

  window._cvPillSetPlayer = function(pl, el) {
    _pillPlayer = pl;
    document.querySelectorAll('.cv-pill-player').forEach(b => b.classList.remove('active'));
    el.classList.add('active');
    if (window.switchDeckTab) window.switchDeckTab(pl);
    cvPillRefresh();
  };


  // ── Helpers ────────────────────────────────────────────────────
  function escHtml(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // ══════════════════════════════════════════════════════════════
  // SISTEMA HÍBRIDO DE IMÁGENES
  //  · Cartas personalizadas (id empieza con "CU-"): SIEMPRE tu carpeta
  //    local ../assets/cards/{id}.png.
  //  · Cartas oficiales: se intenta el arte local que ya tenga la base
  //    de datos (card.image); si no existe (o falla al cargar), se
  //    genera un placeholder LOCAL (SVG, sin red) con el color de su
  //    tipo, nombre y set. Nunca se pide nada a un servidor externo.
  // ══════════════════════════════════════════════════════════════
  const CV_TYPE_COLORS = {
    fire:'#ff5520', water:'#30a8ff', grass:'#38c030', lightning:'#ffe030',
    psychic:'#d050f0', fighting:'#c05818', darkness:'#3a3a48', metal:'#90b0c8',
    dragon: (window.DRAGON_ORB_COLOR || '#e6c73c'), colorless:'#d8ceb0'
  };

  function _cvEscXml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Genera una tarjeta placeholder en SVG (data URI, 100% local) para
  // cartas oficiales de las que aún no tenemos arte propio.
  function cvPlaceholderCard(card) {
    const type  = (card && card.cardType) || 'colorless';
    const color = CV_TYPE_COLORS[type] || CV_TYPE_COLORS.colorless;
    const name  = _cvEscXml((card && (window.cardName ? window.cardName(card) : card.name)) || (card && card.id) || '?');
    const setL  = _cvEscXml((card && card.set) || '');
    const num   = _cvEscXml(card && card.number ? '#' + card.number : '');
    const sub   = [setL, num].filter(Boolean).join(' ');
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 420">'
      + '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.85"/>'
      + '<stop offset="100%" stop-color="' + color + '" stop-opacity="0.30"/>'
      + '</linearGradient></defs>'
      + '<rect width="300" height="420" rx="16" fill="#1a1a24"/>'
      + '<rect x="6" y="6" width="288" height="408" rx="12" fill="url(#g)" stroke="' + color + '" stroke-width="3"/>'
      + '<text x="150" y="195" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="#ffffff">' + name + '</text>'
      + (sub ? '<text x="150" y="222" text-anchor="middle" font-family="sans-serif" font-size="13" fill="#ffffffcc">' + sub + '</text>' : '')
      + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
  window.cvPlaceholderCard = cvPlaceholderCard;

  // Busca una carta por id en la base de datos cargada (para los onerror delegados).
  function cvFindCard(id) {
    if (!id) return null;
    if (typeof DB !== 'undefined' && Array.isArray(DB)) {
      for (let i = 0; i < DB.length; i++) if (DB[i] && DB[i].id === id) return DB[i];
    }
    return window.dbLookup ? window.dbLookup({ id: id }) : null;
  }

  // Resuelve la URL/ruta de imagen a INTENTAR para una carta (sin red externa).
  //  · CU- → tu arte local.
  //  · resto → SOLO se acepta como "local" una ruta relativa (sin http/https);
  //    cualquier URL externa (pokelink.com, GitHub, o cualquier otro host) que
  //    venga en card.image se ignora a propósito y se cae al placeholder,
  //    porque cards_db.js trae muchas entradas con "image" apuntando a un
  //    repositorio externo de arte de cartas con copyright.
  function cvCardImg(card) {
    if (!card) return '';
    const id = String(card.id || '');
    if (id.startsWith('CU-')) return '../assets/cards/' + id + '.png';
    // Ruta local ya espejada de la carta (assets/cards/es/webp/cards/{set}/{numero}.webp),
    // sin depender de la URL externa que trae card.image.
    if (card.set && card.number) {
      const setFolder = String(card.set).toLowerCase();
      const num = String(card.number);
      return '../assets/cards/es/webp/cards/' + setFolder + '/' + num + '.webp';
    }
    const local = (card.image && !/^https?:\/\//i.test(card.image)) ? card.image : '';
    return local || cvPlaceholderCard(card);
  }
  window.cvCardImg = cvCardImg;

  // Handler delegado para el onerror de <img> sueltos (tabla, etc.): si la
  // ruta local falla al cargar, cae al placeholder generado — nunca a un
  // servidor externo ni se queda en gris roto.
  window._cvImgErr = function (imgEl, id) {
    if (!imgEl) return;
    imgEl.onerror = null;
    imgEl.src = cvPlaceholderCard(cvFindCard(id));
  };

})();
