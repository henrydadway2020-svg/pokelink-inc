/* ══════════════════════════════════════════════
   MAZOS VIEW  (js/mazos-view.js)
   Feature A: Mis Mazos tab
   Feature D: Export deck as PNG
══════════════════════════════════════════════ */

(function () {
  'use strict';

  const LIBRARY_KEY   = 'pocketboard_library_v1';
  const ACTIVE_KEY    = 'pocketboard_active_deck_v1';
  // Mazo activo (modelo TCG Live): guarda SOLO el id del mazo elegido; el hub «Jugar» lo lee.
  window._pbActiveDeckId = function () { try { return localStorage.getItem(ACTIVE_KEY) || null; } catch (e) { return null; } };
  window._pbSetActiveDeck = function (id) {
    try { localStorage.setItem(ACTIVE_KEY, String(id)); } catch (e) {}   // dispara sync (está en SYNC_KEYS)
    if (window._jugarRefresh) window._jugarRefresh();
  };
  const TEMP_KEY      = 'pocketboard_temp_cards_v1';

  // Resolver del mazo ACTIVO, compartido por el hub «Jugar» y el selector de inicio del tablero.
  // Criterio IDÉNTICO al del online (js/pvp.js deckKeyOf): el id si resuelve, si no el primero de
  // la biblioteca; los mazos sin `id` se identifican por POSICIÓN — no divergir de ahí.
  const _deckKeyOf = (d, i) => (d && d.id != null ? String(d.id) : '#' + i);
  window._pbActiveDeck = function () {
    const lib = loadLibrary();
    if (!lib.length) return null;
    const id = window._pbActiveDeckId();
    if (id) { for (let i = 0; i < lib.length; i++) if (_deckKeyOf(lib[i], i) === String(id)) return lib[i]; }
    return lib[0];
  };
  // ¿Sirve el mazo activo para arrancar una partida (del formato pedido)?
  // BLOQUEA solo lo que impide jugar: sin mazo activo, menos de 5 cartas, u otro formato.
  // El resto de motivos de legalidad (copias, básico, ban list, customs) viajan como AVISO
  // — el tablero local es también un sandbox para probar mazos a medias.
  window._pbActiveDeckCheck = function (fmt) {
    const d = window._pbActiveDeck();
    if (!d) return { ok: false, deck: null, reasons: [{ k: 'start.noActive' }] };
    const cards = d.cards || [];
    if (cards.length < 5) return { ok: false, deck: d, reasons: [{ k: 'start.incomplete' }] };
    const own = window.formatIdOf ? window.formatIdOf(d) : 'standard';
    if (fmt && own !== fmt) {
      return { ok: false, deck: d, wrongFmt: true,
               reasons: [{ k: 'start.activeWrongFmt', vars: { format: window.formatName ? window.formatName(fmt) : fmt } }] };
    }
    let reasons = [];
    if (fmt && window.validateDeckForFormat) {
      const v = window.validateDeckForFormat(d, fmt);
      reasons = (v && v.reasons) || [];
    }
    return { ok: true, deck: d, reasons: reasons };
  };

  // Icono QR compartido (botón «Código 2D» del grid y del detalle meta)
  const QR_SVG = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.3"/><path d="M9.5 9.5h2.2v2.2H9.5zM12.8 12.8h1.2M9.5 13.6v.4M14 9.5v1.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';

  // ── i18n ──
  const T = (k, v) => (window.t ? window.t(k, v) : k);
  const _LOCALES = { es: 'es-ES', en: 'en-US', ja: 'ja-JP', it: 'it-IT', fr: 'fr-FR', pt: 'pt-BR', ko: 'ko-KR' };
  const uiLocale = () => _LOCALES[window.i18n ? window.i18n.getLang() : 'es'] || 'es-ES';
  // Ordinal estilo Limitless (1st, 2nd, 3rd, 4th…) para el puesto en «Resultados».
  const ordinal = n => { const v = n % 100; return n + (['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'); };
  // Re-pinta la vista actual (grid o detalle). Compartido por langchange y el
  // cambio de breakpoint móvil↔escritorio (la tabla meta y las cartas grandes
  // cambian de layout entre ambos).
  function reRenderCurrent(ev) {
    const view = document.getElementById('view-mazos');
    if (!view || view.style.display === 'none') return; // se re-pinta al abrir
    const detail = document.getElementById('mz-detail-view');
    if (detail && detail.style.display !== 'none' && _currentDeck) {
      // El buscador de PC contiene textos generados. Al cambiar de idioma hay
      // que reconstruirlo; conservar el nodo deja placeholders/chips antiguos.
      if (_mzEditing && ev && ev.type === 'langchange') {
        const oldSearch = document.getElementById('mzb-search');
        if (oldSearch) oldSearch.remove();
      }
      renderDetail(_currentDeck, _currentIdx);
      // En edición, el breakpoint decide qué superficie se usa: Cartas REAL en móvil,
      // buscador propio + mazo fijable en PC.
      if (_mzEditing) _mzSyncMobileBuilder(false);
    } else renderGrid();
  }
  window.addEventListener('langchange', reRenderCurrent);

  // ── Móvil ──────────────────────────────────────────────────────
  const _mq720 = window.matchMedia('(max-width: 720px)');
  function isMobile() { return _mq720.matches; }
  // Al cruzar el breakpoint, re-pintar (tabla meta ↔ lista de tarjetas, etc.)
  if (_mq720.addEventListener) _mq720.addEventListener('change', reRenderCurrent);
  else if (_mq720.addListener) _mq720.addListener(reRenderCurrent);

  // Constantes compartidas — definidas en js/shared.js
  const EL_COLORS   = window.EL_COLORS;
  const EL_ES       = window.EL_ES;
  const STAGE_LABEL = window.STAGE_LABEL;

  // ── State ──────────────────────────────────────────────────────
  let _currentDeck = null;      // deck object shown in detail view
  let _currentIdx  = null;      // index in library
  // FUENTE del meta: 'limitless' (el de torneos del juego real) o el meta PROPIO de pokelink
  // por modo — qué juega la gente en NUESTRO online, agregado de las partidas reales.
  let _metaSource = 'limitless';
  // Dataset de la fuente que se está mirando. Limitless = data/meta_decks.js (lo trae
  // scrape_meta_decks.py); las propias = data/meta_pokelink.js (lo genera meta_interno.js).
  // Devuelve null cuando esa fuente todavía no tiene datos → la vista pinta su estado vacío.
  // Las OTRAS vistas (draft, tierlist, selector de rival, «Jugar») siguen leyendo
  // window.META_DECKS a propósito: su referencia es el meta del juego real, no el nuestro.
  // «Solo desde la última expansión» (ajustes avanzados, solo fuentes propias). El meta
  // propio acumula desde que se recoge, así que al salir un sobre mezcla dos juegos
  // distintos; con esto se mira solo lo de después. Vive en memoria como el resto de
  // filtros: uno pegado tras recargar escondería datos sin decir por qué.
  let _metaOnlySet = false;
  function metaSet() {
    if (_metaSource === 'limitless') {
      const M = window.META_DECKS;
      return (M && M.decks && M.decks.length) ? M : null;
    }
    const S = window.META_TCGMINI && window.META_TCGMINI[_metaSource];
    if (!S) return null;
    const D = (_metaOnlySet && S.sinceSet && S.sinceSet.decks && S.sinceSet.decks.length) ? S.sinceSet : S;
    return (D.decks && D.decks.length) ? D : null;
  }
  const metaLastSet = () => (window.META_TCGMINI && window.META_TCGMINI.lastSet) || null;
  function metaRows() { const M = metaSet(); return (M && M.decks) || []; }
  const metaIsOwn = () => _metaSource !== 'limitless';
  // FILTRO de FORMATO de la biblioteca (solo en Mis mazos): 'all' | 'standard' | 'advanced'.
  // Vive en memoria a propósito: un filtro pegado tras recargar esconde mazos sin avisar.
  let _mzFormat = 'all';
  let _mzMode      = 'meta';    // 'mine' | 'meta' — LADO de la vista. Ya no es un conmutador:
                                // son dos páginas del nav (Barajas = /mazos, Meta = /meta) y lo fija switchAppTab.
  let _metaSortKey = 'share';   // columna de orden: 'share' | 'winrate'
  let _metaSortDir = 'desc';    // 'desc' (mayor→menor) | 'asc'
  let _metaShowAll = false;     // false = top 50 · true = todos
  const META_TOP   = 50;
  let _metaSearch  = '';        // buscador principal: por NOMBRE del mazo
  let _cardSearch  = '';        // avanzado: por CARTA contenida en el mazo
  let _metaQuick   = null;      // 'new' | 'rising' | 'falling' | null
  let _metaTypes   = new Set(); // tipos de energía activos
  let _gamesMin    = null;      // avanzado: filtro de MÍNIMO de partidas · null = inactivo
  let _wrLo = null, _wrHi = null; // avanzado: filtro de RANGO de victorias (fracción) · null = inactivo

  // ── Orden de Mis mazos ────────────────────────────────────────
  // 'manual' = el orden del ARRAY de la biblioteca, que es el que el usuario coloca a mano
  // arrastrando (por eso ahí los favoritos NO se fijan arriba: manda su orden). En los demás
  // órdenes los favoritos sí van primero, como hasta ahora.
  const SORT_KEY  = 'pocketboard_deck_sort_v1';     // preferencia de VISTA, por dispositivo
  const ORDER_MIG = 'pocketboard_deck_order_v1';    // marca de la normalización única del array
  const SORT_DIR_DEF = { manual: 'asc', date: 'desc', name: 'asc', type: 'asc' };
  let _mzSortBy = 'manual', _mzSortDir = 'asc';
  try {
    const g = JSON.parse(localStorage.getItem(SORT_KEY) || 'null');
    if (g && SORT_DIR_DEF[g.by]) { _mzSortBy = g.by; _mzSortDir = g.dir === 'desc' ? 'desc' : 'asc'; }
  } catch (e) {}
  function _mzSortSave() {
    try { localStorage.setItem(SORT_KEY, JSON.stringify({ by: _mzSortBy, dir: _mzSortDir })); } catch (e) {}
  }

  // ── Selección múltiple (Mis mazos): borrar/copiar/favoritos varios a la vez ──
  let _mzSelect = false;        // modo selección activo
  const _mzSel = new Set();     // claves de mazos marcados (por deck.id, fallback al índice)
  const deckKey = (deck, idx) => (deck && deck.id) || ('#' + idx);
  let _mzAnchorKey = null;      // ancla para el rango con shift-clic (clave del último marcado)
  // Rubber-band (arrastre del ratón para seleccionar varios, como el explorador de archivos)
  let _rbActive = false, _rbSuppress = false, _rbBox = null;
  let _rbStartX = 0, _rbStartY = 0; let _rbBase = null;

  // ── Library helpers ───────────────────────────────────────────
  // Id ESTABLE para un mazo antiguo sin `id`. Tiene que salir de datos que TODOS los
  // dispositivos comparten (nunca de Date.now()): si dos asignaran ids distintos al mismo
  // mazo, la fusión de la nube lo duplicaría en vez de reconocerlo.
  function _legacyDeckId(d) {
    // Se hashean los NOMBRES de las cartas, NUNCA sus ids: repairDeckCards (justo arriba)
    // reasigna ids cuando un set en preview renumera, así que dos dispositivos con distinta
    // versión de la DB producirían ids distintos para el MISMO mazo y la nube lo duplicaría.
    // El propio reparador trata el nombre como la fuente de verdad.
    var sem = (d && d.name || '') + '|' + (((d && d.cards) || []).map(function (c) { return (c && c.name) || ''; }).join(','));
    var h = 5381;
    for (var i = 0; i < sem.length; i++) { h = ((h * 33) ^ sem.charCodeAt(i)) >>> 0; }
    return 'lg-' + ((d && d.savedAt) || 0) + '-' + h.toString(36);
  }

  window._mazosLegacyId = _legacyDeckId;   // hook de test
  function loadLibrary() {
    var lib;
    try { lib = JSON.parse(localStorage.getItem(LIBRARY_KEY)) || []; } catch(e) { return []; }
    // Repara al leer los mazos cuyas cartas quedaron apuntando a otra carta (ids de preview
    // reasignados al salir el set). Se reescribe UNA vez: a partir de ahí no hay trabajo.
    var tocado = false;
    lib.forEach(function (d) {
      var fix = d && window.repairDeckCards && window.repairDeckCards(d.cards);
      if (fix) { d.cards = fix; tocado = true; }
    });
    // Un mazo SIN id se identifica por su POSICIÓN ('#i' en deckKey) — y desde que los mazos
    // se reordenan a mano, la posición cambia: la selección múltiple, sus acciones de lote y
    // el mazo activo apuntarían a otro mazo. Además la fusión de la nube DESCARTA lo que no
    // tiene id (nunca llegaba a sincronizarse). Se le asigna uno estable, una sola vez.
    var usados = {};
    lib.forEach(function (d) { if (d && d.id != null) usados[d.id] = 1; });
    lib.forEach(function (d) {
      if (!d || d.id != null) return;
      var id = _legacyDeckId(d), n = 1;
      while (usados[id]) id = _legacyDeckId(d) + '-' + (++n);
      usados[id] = 1; d.id = id; tocado = true;
    });
    if (tocado) { try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch(e) {} }
    return lib;
  }
  function saveLibrary(lib) {
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib)); } catch(e) {}
  }
  function loadTempCards() {
    try { return JSON.parse(localStorage.getItem(TEMP_KEY)) || []; } catch(e) { return []; }
  }
  // Localiza el mazo por id en una biblioteca recién cargada (la lista puede
  // haber cambiado desde la sidebar). Fallback: índice de render.
  function libIndexOf(lib, deck, fallbackIdx) {
    if (deck && deck.id != null) {
      const i = lib.findIndex(d => d.id === deck.id);
      // Tiene id y no está en la lista → es nuevo (o lo borraron en otro sitio). NO se cae al
      // índice de render: pisaría el mazo que ocupe esa posición ahora.
      return i;
    }
    return (fallbackIdx != null && lib[fallbackIdx]) ? fallbackIdx : -1;
  }

  // Recover images for custom (_temp) cards from pocketboard_temp_cards_v1
  function enrichDeck(deck) {
    const customs = loadTempCards();
    (deck.cards || []).forEach(c => {
      if (c._temp && !c.image) {
        const ref = customs.find(x => x.id === c.id);
        if (ref) c.image = ref.image;
      }
    });
    return deck;
  }

  // ── Init ──────────────────────────────────────────────────────
  function initMazosView() {
    window._mazosInitialised = true;
    renderGrid();
    // Recargar (o entrar) con un mazo a medias vuelve directo al constructor, igual que el
    // tablero conserva la partida. Diferido para no pelear con la ruta inicial del router.
    const _puedeReanudar = () => {
      const det = document.getElementById('mz-detail-view');
      const detalleAbierto = det && getComputedStyle(det).display !== 'none';
      return _mzMode === 'mine' && !_mzEditing && !detalleAbierto && window._mazosDraftIsAuto();
    };
    if (_puedeReanudar()) setTimeout(() => { if (_puedeReanudar()) window._mazosResumeDraft(); }, 60);
  }

  // Título de la página (sustituye al viejo conmutador Meta/Mis mazos: son dos páginas
  // distintas del nav, así que aquí solo se dice en cuál estás). En Meta el título deja su
  // sitio a la sub-navbar de fuentes.
  function syncTitle() {
    const t = document.getElementById('mz-title');
    if (t) t.textContent = T(_mzMode === 'mine' ? 'mazos.tabMine' : 'mazos.tabMeta');
    const head = document.getElementById('mz-header');
    if (head) head.classList.toggle('mz-meta-head-mode', _mzMode === 'meta');
    const tabs = document.getElementById('mz-source-tabs');
    if (tabs) {
      tabs.style.display = _mzMode === 'meta' ? '' : 'none';
      if (!tabs._wired) {
        tabs._wired = true;
        tabs.querySelectorAll('.mz-md-tab').forEach(b => b.addEventListener('click', () => {
          const src = b.dataset.src;
          if (src === _metaSource) return;
          _metaSource = src;
          // Cada fuente tiene sus arquetipos y sus tipos presentes: lo que dependa del
          // dataset se invalida al cambiar (si no, los filtros y el top-100 se quedan
          // con los de la fuente anterior).
          // Cambiar de fuente = empezar limpio. Un filtro heredado (tipo, búsqueda, rango)
          // escondería mazos de la fuente nueva sin decir por qué, y los tipos presentes y
          // los rangos de los deslizadores son distintos en cada una.
          _metaTop100 = null; _metaRanges = null; _metaCardIdx = null; _metaNameIdx = null;
          _metaSearch = ''; _metaQuick = null; _metaTypes = new Set(); _metaShowAll = false;
          _metaOnlySet = false;
          const fh = document.getElementById('mz-meta-filters');
          if (fh) { fh._built = false; fh.innerHTML = ''; }
          window.sfx && window.sfx('ui.tab');
          renderMetaGrid();
        }));
      }
      // En móvil las cuatro pestañas no caben con el nombre largo («Torneos de Limitless
      // TCG»…): se usa la variante corta. Se cambia el data-i18n, no solo el texto, para
      // que applyI18n no lo pise al cambiar de idioma.
      const SRC_K = { limitless: 'mazos.srcLimitless', standard: 'mazos.srcStandard',
                      advanced: 'mazos.srcAdvanced', draft: 'mazos.srcDraft' };
      tabs.querySelectorAll('.mz-md-tab').forEach(b => {
        const k = (SRC_K[b.dataset.src] || '') + (isMobile() ? 'Short' : '');
        if (SRC_K[b.dataset.src]) { b.setAttribute('data-i18n', k); b.textContent = T(k); }
        b.classList.toggle('active', b.dataset.src === _metaSource);
      });
    }
  }

  // Formato de un mazo (id). `formatIdOf` (js/formats.js) resuelve `deck.format` y, si el mazo
  // es antiguo y no lo lleva, lo deduce del tamaño → los mazos de siempre caen en Estándar.
  const _fmtIdOf = d => (window.formatIdOf ? window.formatIdOf(d) : 'standard');

  // SUB-NAVBAR de FORMATOS de Mis mazos (Todos / Estándar / Avanzado, con su recuento).
  // Mismo componente que la de fuentes del meta. Los números salen SIEMPRE de la biblioteca
  // completa: son el mapa de lo que tienes, no de lo que se está viendo.
  function syncFormatTabs(library) {
    const tabs = document.getElementById('mz-format-tabs');
    if (!tabs) return;
    const head = document.getElementById('mz-header');
    // Con la biblioteca vacía no hay nada que filtrar (y en selección manda su propia barra).
    const show = _mzMode === 'mine' && !_mzSelect && library.length > 0;
    tabs.style.display = show ? '' : 'none';
    if (head) head.classList.toggle('mz-fmt-head-mode', show);
    if (!show) return;

    if (!tabs._wired) {
      tabs._wired = true;
      tabs.querySelectorAll('.mz-md-tab').forEach(b => b.addEventListener('click', () => {
        const f = b.dataset.fmt;
        if (f === _mzFormat) return;
        _mzFormat = f;
        _mzSel.clear();   // la selección no puede sobrevivir a un cambio de filtro: borraría mazos que ya no ves
        _mzAnchorKey = null;
        window.sfx && window.sfx('ui.tab');
        renderGrid();
      }));
    }

    const n = { all: library.length, standard: 0, advanced: 0 };
    library.forEach(d => { const f = _fmtIdOf(d); if (n[f] != null) n[f]++; });
    tabs.querySelectorAll('.mz-md-tab').forEach(b => {
      const f = b.dataset.fmt;
      const label = f === 'all' ? T('mazos.fmtAll')
                                : (window.formatName ? window.formatName(f) : f);
      b.textContent = label;
      const cnt = document.createElement('span');
      cnt.className = 'mz-tab-n';
      cnt.textContent = n[f] || 0;
      b.appendChild(cnt);
      b.classList.toggle('active', f === _mzFormat);
    });
  }

  // ── Show/hide sub-views ───────────────────────────────────────
  // Fuerza el modo VISTA (no edición). El botón «Volver» y cambiar de pestaña NO llaman a
  // exitDeckEdit → el estado de edición se quedaba sucio y al reabrir un mazo salía el
  // buscador aunque no estuvieras editando. Esto lo limpia a mano (SIN guardar; salir de la
  // edición descarta los cambios igual que Cancelar).
  // `explicito` = el usuario PIDIÓ salir del constructor (Volver, el hub, la pestaña Meta):
  // el borrador queda ofrecido en la banda, no se reabre solo al volver a Barajas.
  function _mzForceViewMode(explicito) {
    // APARCAR, no tirar: el borrador sobrevive a cualquier salida de la vista. Si la
    // escritura falla (cuota de localStorage llena) se avisa — es la ÚNICA copia del trabajo.
    if (_mzEditing && !_mzDraftSave(explicito) && window.pbToast) window.pbToast(T('mazos.draftSaveFail'));
    if (_mzExitT) { clearTimeout(_mzExitT); _mzExitT = 0; }   // corta una salida animada a medias
    const _g = document.getElementById('mz-cards-grid'); if (_g) _g.classList.remove('dcb-out');
    if (window.pbCardsSurface) window.pbCardsSurface.restore();
    _mzEditing = false; _mzEditCards = null; _mzEditDeck = null; _mzEditIdx = -1; _mzEditBase = null;
    _mzPillTeardown();   // DESPUÉS de apagar la sesión: el teardown re-sincroniza el pop-up de Cartas
    const _sb = document.getElementById('mzb-search'); if (_sb) _sb.remove();
    const _st = document.querySelector('#mz-detail-info-col .mz-stats-panel'); if (_st) _st.style.display = '';
    const _bd = document.getElementById('mz-detail-body'); if (_bd) _bd.classList.remove('mz-editing', 'mz-pin');
    _mzPinScroll(true);   // (ya sin edición) devuelve el mazo a su tamaño natural
    // Limpia la cabecera de cualquier resto de edición (por si se sale sin exitDeckEdit, p.ej. atrás del navegador).
    const _back = document.getElementById('mz-back-btn'); if (_back) _back.style.display = '';
    ['mz-detail-save-edit', 'mz-pin-btn'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
    const _head = document.getElementById('mz-detail-header'); if (_head) _head.classList.remove('mz-editing');
    const _acts = document.getElementById('mz-detail-actions'); if (_acts) _acts.style.display = '';
    const _cnt = document.getElementById('mz-deck-counter'); if (_cnt) _cnt.style.display = 'none';
  }
  function showGridView(explicito) {
    _mzForceViewMode(explicito);
    closeEnergyPopover(); closeFeaturedPicker(); closeDeckCardsView();
    document.getElementById('mz-grid-view').style.display   = 'flex';
    document.getElementById('mz-detail-view').style.display = 'none';
    if (window._pbCloseDeckRoute) window._pbCloseDeckRoute();   // sincroniza la URL → /mazos
    renderGrid();
  }

  function showDetailView(deck, idx, silent) {
    window.sfx && window.sfx('mazos.open'); // abrir el detalle de un mazo
    _mzForceViewMode();   // cualquier edición abandonada (Volver / cambio de pestaña) → vista limpia
    _currentDeck = deck;
    _currentIdx  = idx;
    enrichDeck(deck);
    document.getElementById('mz-grid-view').style.display   = 'none';
    document.getElementById('mz-detail-view').style.display = 'flex';
    renderDetail(deck, idx);
    // Abrir un mazo (incl. desde Enfrentamientos) SIEMPRE arranca arriba del todo, no al
    // nivel de scroll del mazo anterior (los contenedores con overflow conservan scrollTop).
    ['mz-detail-view', 'mz-detail-body', 'mz-meta-detail'].forEach(id => { const el = document.getElementById(id); if (el) el.scrollTop = 0; });
    // Cada mazo abierto = una URL (/mazos/<slug>); silent = lo abrió el router (atrás/recarga)
    if (!silent && window._pbOpenDeckRoute) window._pbOpenDeckRoute(slugForDeck(deck));
  }
  function slugForDeck(deck) {
    if (!deck) return '';
    if (deck._isMeta) return 'a-' + ((deck._row && deck._row.id) || deck.id || '');
    return 'm-' + deck.id;
  }
  // Abrir un mazo por su slug de URL (lo usa el router en atrás/adelante/recarga)
  window._mazosOpenById = function (slug) {
    if (!slug) return false;
    // El slug dice de qué LADO es el mazo (a- = meta, m- = mío) → al volver del detalle
    // se aterriza en la página correcta y el nav resalta la pestaña correcta.
    _mzMode = (slug.indexOf('a-') === 0) ? 'meta' : 'mine';
    if (window._pbSyncMazosNav) window._pbSyncMazosNav();
    if (slug.indexOf('a-') === 0) {
      const o = metaDeckById(slug.slice(2));
      if (o) { const i = metaRows().indexOf(o); showDetailView(buildMetaDeck(o), i, true); return true; }
    } else if (slug.indexOf('m-') === 0) {
      const lib = loadLibrary(); const id = slug.slice(2);
      // Volver por la URL a un mazo que estabas EDITANDO reabre el constructor con lo que
      // llevabas, no la vista de solo lectura (los cambios sin guardar siguen ahí).
      const dr = _mzDraftRead();
      if (dr && String(dr.deck.id) === id) return !!window._mazosResumeDraft();
      const i = lib.findIndex(d => String(d.id) === id);
      if (i >= 0) { showDetailView(lib[i], i, true); return true; }
    }
    return false;
  };
  // «Volver» es un ATRÁS de verdad: te devuelve al sitio del que viniste.
  //  · Editando desde el lápiz de la miniatura (o mazo nuevo/importado) → a Mis Barajas.
  //  · Editando desde el botón «Editar» del mazo abierto → al DETALLE de ese mazo; el
  //    siguiente «Volver» ya va a Mis Barajas.
  // Al salir de la edición se PREGUNTA qué hacer con los cambios — y solo si los hay: sin
  // tocar nada, «Volver» sale sin diálogo.
  window._mazosBack = function () {
    if (_mzEditing) { _mzBackFromEdit(); return; }
    var http = (location.protocol === 'http:' || location.protocol === 'https:');
    if (http && /^\/mazos\/[^/]/.test(location.pathname)) history.back();
    else showGridView();
  };
  // Salida del constructor por «Volver». Guardar / Descartar / seguir editando.
  function _mzBackFromEdit() {
    const from = _mzEditFrom, deck = _mzEditDeck, idx = _mzEditIdx;
    // `yaFue` = la propia salida ya navegó (mazo nuevo sin guardar → rejilla): no re-navegar.
    const salir = save => exitDeckEdit(save, yaFue => {
      if (yaFue) return;
      if (from === 'detail' && deck) return;   // el detalle ya se re-pintó: te quedas ahí
      showGridView();
    });
    if (!_mzDraftDirty()) { salir(false); return; }   // sin cambios no se pregunta
    window.pbChoose({
      title: T('mazos.backSaveTitle'), message: T('mazos.backSaveMsg'),
      options: [{ value: 'save', label: T('mazos.saveChanges') },
                { value: 'discard', label: T('mazos.discardDraft'), danger: true }],
      cancelLabel: T('mazos.keepEditing'),
    }).then(v => {
      if (v === 'save') { window.sfx && window.sfx('mazos.edit'); salir(true); }
      else if (v === 'discard') salir(false);
    });
  }

  // ── Orden de los mazos ────────────────────────────────────────
  // Fecha de ENTRADA en la cuenta (da igual si creado, copiado o importado). El `id` de un
  // mazo es el Date.now() del momento en que se creó en TODOS los caminos... salvo el mazo de
  // bienvenida, cuyo id es de texto. Por eso solo se usa si parece una marca de tiempo.
  // NO se usa `savedAt` como principal: se reescribe en cada edición.
  function _deckAddedAt(d) {
    const n = Number(d && d.id);
    if (isFinite(n) && n > 1e12) return n;
    return Number(d && d.savedAt) || 0;
  }
  // Energías del mazo en el orden canónico de la web (el mismo que usa la pestaña Cartas).
  const _mzEnCache = new WeakMap();
  function _deckEnergyRank(d) {
    if (!d) return [99];
    const hit = _mzEnCache.get(d); if (hit) return hit;
    let en = (d.energyTypes && d.energyTypes.length) ? d.energyTypes
           : (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(d.cards || [])) : []);
    const r = en.map(t => { const i = DECK_EL_ORDER.indexOf(t); return i < 0 ? 98 : i; }).sort((a, b) => a - b);
    const out = r.length ? r : [99];   // sin energía declarada ni inferible → al final
    _mzEnCache.set(d, out);
    return out;
  }
  function _cmpRank(a, b) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const x = a[i] == null ? 99 : a[i], y = b[i] == null ? 99 : b[i];
      if (x !== y) return x - y;
    }
    return 0;
  }
  // ¿Se siguen fijando los favoritos arriba en «Mi orden»? Sí HASTA el primer arrastre: así el
  // día que esto entra no se mueve nada de sitio. En cuanto el usuario coloca un mazo a mano,
  // su orden pasa a mandar (y la estrella se queda como marca). No se escribe nada por el mero
  // hecho de abrir la pestaña: la normalización la hace el propio arrastre, que ya escribe.
  function _mzPinFavs() {
    try { return localStorage.getItem(ORDER_MIG) !== '1'; } catch (e) { return true; }
  }
  // Ordena las entradas {deck, idx} ya filtradas. En 'manual' respeta el array tal cual.
  function _mzSortEntries(entries) {
    const dir = _mzSortDir === 'asc' ? 1 : -1;
    const nm = d => (d.name || '').toLowerCase();
    if (_mzSortBy === 'manual') {
      return _mzPinFavs()
        ? entries.slice().sort((a, b) => ((b.deck.favorite ? 1 : 0) - (a.deck.favorite ? 1 : 0)) || (a.idx - b.idx))
        : entries;
    }
    const out = entries.slice().sort((A, B) => {
      const a = A.deck, b = B.deck;
      const fav = (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0);   // los favoritos se fijan arriba
      if (fav) return fav;
      let p = 0;
      if (_mzSortBy === 'date') p = _deckAddedAt(a) - _deckAddedAt(b);
      else if (_mzSortBy === 'type') {
        // Un mazo sin energía declarada ni inferible no pertenece a ningún tipo: se queda al
        // final en los DOS sentidos (si entrara en la inversión saltaría al principio).
        const ra = _deckEnergyRank(a), rb = _deckEnergyRank(b);
        const sa = ra[0] === 99, sb = rb[0] === 99;
        if (sa !== sb) return sa ? 1 : -1;
        p = _cmpRank(ra, rb);
      }
      else p = nm(a) < nm(b) ? -1 : nm(a) > nm(b) ? 1 : 0;
      if (p) return p * dir;
      return nm(a) < nm(b) ? -1 : nm(a) > nm(b) ? 1 : A.idx - B.idx;   // desempate estable
    });
    return out;
  }

  // ── Grid render ───────────────────────────────────────────────
  function renderGrid() {
    const grid      = document.getElementById('mz-grid');
    const empty     = document.getElementById('mz-empty');
    const countEl   = document.getElementById('mz-deck-count');
    if (!grid) return;

    // El lado ya NO se elige aquí: lo fija la pestaña/ruta (Barajas = /mazos, Meta = /meta).
    syncTitle();
    const newBtn = document.getElementById('mz-new-btn');
    const banner = document.getElementById('mz-meta-banner');
    if (_mzMode === 'meta') {
      if (newBtn) newBtn.style.display = 'none';
      syncFormatTabs([]);   // la barra de formatos es de Mis mazos; en Meta manda la de fuentes
      if (_mzSelect) { _mzSelect = false; _mzSel.clear(); }   // el modo selección es solo de Mis mazos
      syncSelectUI(0);
      _mzSyncDraftBanner(); _mzSyncRescueBanner();   // la rejilla es la MISMA para los dos lados → en Meta la banda se retira
      return renderMetaGrid();
    }
    if (newBtn) newBtn.style.display = '';
    if (banner) banner.style.display = 'none';
    _mzSyncDraftBanner(); _mzSyncRescueBanner();   // «tienes un mazo a medias» (nunca se pierde nada en silencio)
    const fbar = document.getElementById('mz-meta-filters');
    if (fbar) fbar.style.display = 'none';
    const bodyEl = document.getElementById('mz-grid-body');
    if (bodyEl) bodyEl.classList.remove('mz-meta-mode');
    if (empty) empty.style.display = 'none';

    const library = loadLibrary();
    grid.innerHTML = '';

    if (countEl) countEl.textContent = library.length ? `(${library.length})` : '';
    syncFormatTabs(library);   // pinta los recuentos por formato (sobre la biblioteca COMPLETA)

    if (!library.length) {
      if (_mzSelect) { _mzSelect = false; _mzSel.clear(); }
      syncSelectUI(0);
      if (empty) empty.style.display = 'none';
      grid.appendChild(makeCreateCard());   // sin mazos: solo el slot de crear
      return;
    }
    if (empty) empty.style.display = 'none';

    // Descarta selecciones de mazos que ya no existen (p.ej. tras sincronizar).
    if (_mzSel.size) {
      const valid = new Set(library.map((d, i) => deckKey(d, i)));
      Array.from(_mzSel).forEach(k => { if (!valid.has(k)) _mzSel.delete(k); });
    }

    // Favoritos primero (orden estable dentro de cada grupo); se pinta el índice
    // de ALMACENAMIENTO como clave (no el de pintado) para que borrar/copiar/fav
    // sigan casando con la biblioteca real.
    // El slot «crear» va PRIMERO (fuera de modo selección, donde estorbaría).
    if (!_mzSelect) grid.appendChild(makeCreateCard());

    // El filtro de formato va DESPUÉS de emparejar cada mazo con su índice de ALMACENAMIENTO:
    // filtrar antes desplazaría los índices y borrar/copiar/favorito irían al mazo equivocado.
    const order = _mzSortEntries(library.map((deck, idx) => ({ deck, idx }))
      .filter(({ deck }) => _mzFormat === 'all' || _fmtIdOf(deck) === _mzFormat));
    order.forEach(({ deck, idx }) => {
      grid.appendChild(makeDeckCard(deck, idx));
    });
    syncSelectUI(order.length);   // «Seleccionar» mira lo VISIBLE (un filtro sin mazos no lo ofrece)
    wireRubberBand();
  }

  // Banda «tienes un mazo a medias» en la rejilla de Mis Mazos. Es la salida visible del
  // borrador aparcado: nada se descarta solo, y volver a él es un clic. NO es un pop-up
  // (regla: entrar a la web no saca diálogos) — es una banda dentro de la propia vista.
  function _mzSyncDraftBanner() {
    const host = document.getElementById('mz-grid-view');
    let b = document.getElementById('mz-draft-bar');
    const d = (_mzMode === 'mine' && !_mzEditing) ? _mzDraftRead() : null;
    if (!d) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'mz-draft-bar';
      const hdr = document.getElementById('mz-header');
      if (hdr && hdr.parentElement === host) host.insertBefore(b, hdr.nextSibling);
      else host.insertBefore(b, host.firstChild);
    }
    const name = d.deck.name || T('mazos.noName');
    b.innerHTML = '';
    const txt = document.createElement('span');
    txt.className = 'mz-draft-txt';
    txt.textContent = T('mazos.draftPending', { name: name }) + ' · ' + (d.cards.length) + (d.deck.format === 'advanced' ? '/30' : '/20');
    const go = document.createElement('button');
    go.className = 'mz-draft-go';
    go.textContent = T('mazos.draftResume');
    go.onclick = () => window._mazosResumeDraft();
    const dz = document.createElement('button');
    dz.className = 'mz-draft-dz';
    dz.textContent = T('mazos.discardDraft');
    dz.onclick = () => {
      window.pbConfirm({ title: T('mazos.discardTitle'), message: T('mazos.discardMsg'),
                         okLabel: T('mazos.discardDraft'), danger: true })
        .then(ok => { if (ok) { _mzDraftClear(_draftId(d.deck)); _mzSyncDraftBanner(); } });   // SOLO el que anuncia
    };
    b.appendChild(txt); b.appendChild(go); b.appendChild(dz);
  }

  /* Banda «se recuperaron N mazos». Cuando la nube se lleva por delante mazos que este
     dispositivo no llegó a subir, cloud-sync los guarda en vez de perderlos; aquí se ofrecen
     de vuelta. Misma banda que la del mazo a medias: nada de pop-ups al entrar. */
  function _mzSyncRescueBanner() {
    const host = document.getElementById('mz-grid-view');
    let b = document.getElementById('mz-rescue-bar');
    const salvados = (_mzMode === 'mine' && !_mzEditing && window.pbRescuedDecks) ? window.pbRescuedDecks() : [];
    if (!salvados.length) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('div');
      b.id = 'mz-rescue-bar'; b.className = 'mz-draft-bar-like';
      const draft = document.getElementById('mz-draft-bar');
      const hdr = document.getElementById('mz-header');
      if (draft && draft.parentElement === host) host.insertBefore(b, draft.nextSibling);
      else if (hdr && hdr.parentElement === host) host.insertBefore(b, hdr.nextSibling);
      else host.insertBefore(b, host.firstChild);
    }
    b.innerHTML = '';
    const txt = document.createElement('span');
    txt.className = 'mz-draft-txt';
    txt.textContent = T('mazos.rescuePending', { n: salvados.length, name: (salvados[salvados.length - 1].item || {}).name || '' });
    const go = document.createElement('button');
    go.className = 'mz-draft-go';
    go.textContent = T('mazos.rescueRestore');
    go.onclick = () => {
      salvados.forEach(r => { if (r && r.item) window.pbRestoreRescued(r.item.id); });
      _mzSyncRescueBanner(); renderGrid();
      if (window.pbToast) window.pbToast(T('mazos.rescueDone', { n: salvados.length }));
    };
    const dz = document.createElement('button');
    dz.className = 'mz-draft-dz';
    dz.textContent = T('mazos.rescueDismiss');
    dz.onclick = () => {
      try { localStorage.removeItem('pocketboard_library_v1__rescue'); } catch (e) {}
      _mzSyncRescueBanner();
    };
    b.appendChild(txt); b.appendChild(go); b.appendChild(dz);
  }

  // Stack reutilizable: 3 dorsos + frente con miniatura (1 carta = completa;
  // 2-3 destacadas = bandas). Lo usan las tarjetas de Mis Mazos Y el hub «Jugar».
  function makeDeckStack(deck) {
    const stack = document.createElement('div');
    stack.className = 'mz-stack';
    const backImg = window.CARD_BACK_IMG ? `url(${window.CARD_BACK_IMG})` : '';
    [3, 2, 1].forEach(n => {
      const back = document.createElement('div');
      back.className = `mz-stack-back mz-stack-back-${n}`;
      if (backImg) back.style.backgroundImage = backImg;
      stack.appendChild(back);
    });
    const front = document.createElement('div');
    front.className = 'mz-stack-front';
    paintDeckThumb(front, deck);
    stack.appendChild(front);
    return stack;
  }
  window._mazosDeckStack = makeDeckStack;

  // Slot dedicado para crear un mazo — CALCA la estructura de un mazo ya creado
  // (stack de dorsos + frente + info), pero el frente lleva el "+" y la info dice
  // «Nuevo mazo». Al pulsarlo abre el menú de opciones ya existente (newDeck).
  function makeCreateCard() {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'mz-create-card';
    card.setAttribute('aria-label', T('mazos.newDeck'));

    // Stack de cartas (3 dorsos + frente), como un mazo real — el frente lleva el "+".
    const stack = document.createElement('div');
    stack.className = 'mz-stack';
    const backImg = window.CARD_BACK_IMG ? `url(${window.CARD_BACK_IMG})` : '';
    [3, 2, 1].forEach(n => {
      const back = document.createElement('div');
      back.className = `mz-stack-back mz-stack-back-${n}`;
      if (backImg) back.style.backgroundImage = backImg;
      stack.appendChild(back);
    });
    const front = document.createElement('div');
    front.className = 'mz-stack-front mz-create-front';
    front.innerHTML = `<span class="mz-create-plus"><svg viewBox="0 0 24 24" fill="none"><line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></span>`;
    stack.appendChild(front);

    // Info: «Nuevo mazo» centrado, donde en un mazo van el nombre + los botones.
    const info = document.createElement('div');
    info.className = 'mz-create-info';
    const label = document.createElement('div');
    label.className = 'mz-create-label';
    label.textContent = T('mazos.newDeck');
    info.appendChild(label);

    card.appendChild(stack);
    card.appendChild(info);
    card.addEventListener('click', () => newDeck());
    return card;
  }

  function makeDeckCard(deck, idx) {
    const key = deckKey(deck, idx);
    const card = document.createElement('div');
    card.className = 'mz-deck-card';
    if (_mzSelect) card.classList.add('mz-selectable');
    if (_mzSel.has(key)) card.classList.add('mz-selected');

    // Stack preview (3 dorsos + frente) — componente reutilizable (lo usa también el hub «Jugar»).
    const stack = makeDeckStack(deck);

    // Marca de selección (esquina superior izquierda, solo en modo selección)
    const check = document.createElement('div');
    check.className = 'mz-select-check';
    check.innerHTML = '<svg viewBox="0 0 16 16" fill="none"><polyline points="3.5,8.5 6.5,11.5 12.5,4.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    stack.appendChild(check);

    // Estrella de favorito (esquina superior izquierda, fuera de modo selección)
    if (deck.favorite) {
      const fav = document.createElement('div');
      fav.className = 'mz-fav-badge';
      fav.title = T('mazos.favorite');
      fav.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.6l1.9 3.95 4.35.55-3.2 3 .82 4.3L8 11.9 4.13 13.9l.82-4.3-3.2-3 4.35-.55L8 1.6z"/></svg>';
      stack.appendChild(fav);
    }

    // Badge de FORMATO (esquina sup. derecha) — solo formatos NO estándar (Advanced), para no
    // saturar (la mayoría de mazos son Estándar). El Estándar no lleva marca.
    const _fid = window.formatIdOf ? window.formatIdOf(deck) : 'standard';
    if (!deck._isMeta && _fid !== 'standard') {
      const fb = document.createElement('div');
      fb.className = 'mz-format-badge';
      fb.textContent = window.formatName ? window.formatName(_fid) : 'Advanced';
      stack.appendChild(fb);
    }

    // Mazo activo (modelo TCG Live): NO lleva insignia — se marca con el botón de play en
    // verde brillante + el outline verde de la tarjeta (clase mz-deck-active).
    const _activeId = window._pbActiveDeckId ? window._pbActiveDeckId() : null;
    const isActive = !deck._isMeta && _activeId != null && String(deck.id) === String(_activeId);
    if (isActive) card.classList.add('mz-deck-active');

    // Info
    const info = document.createElement('div');
    info.className = 'mz-deck-info';

    const nameEl = document.createElement('div');
    nameEl.className = 'mz-deck-name';
    nameEl.title = deck.name;
    nameEl.textContent = deck.name || T('mazos.noName');

    const dateEl = document.createElement('div');
    dateEl.className = 'mz-deck-date';
    dateEl.textContent = deckDateLine(deck);

    // Barra inferior: botones de acción (izquierda) + orbes de energía (esquina inf. dcha.)
    const bar = document.createElement('div');
    bar.className = 'mz-deck-bar';

    const btns = document.createElement('div');
    btns.className = 'mz-deck-btns';
    btns.innerHTML = `
      <button class="mz-deck-btn activar${isActive ? ' is-active' : ''}" type="button" title="${esc(T(isActive ? 'mazos.activeDeck' : 'mazos.activate'))}" aria-label="${esc(T(isActive ? 'mazos.activeDeck' : 'mazos.activate'))}">
        <svg viewBox="0 0 16 16" fill="none"><polygon points="4,2 14,8 4,14" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor"/></svg>
      </button>
      <button class="mz-deck-btn editar" type="button" title="${esc(T('mazos.editShort'))}" aria-label="${esc(T('mazos.editShort'))}">
        <svg viewBox="0 0 16 16" fill="none"><path d="M11 2l3 3L5 14H2v-3L11 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
      </button>
      <button class="mz-deck-btn exportar" type="button" title="${esc(T('mazos.share'))}" aria-label="${esc(T('mazos.share'))}">
        <svg viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="3.5" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 7l4.4-2.5M5.8 9l4.4 2.5" stroke="currentColor" stroke-width="1.3"/></svg>
      </button>
      <button class="mz-deck-btn qr" type="button" title="${esc(T('mazos.qrBtn'))}" aria-label="${esc(T('mazos.qrBtn'))}">
        ${QR_SVG}
      </button>
    `;
    btns.querySelector('.activar').addEventListener('click', e => { e.stopPropagation(); activateDeck(deck, renderGrid); });
    // Editar = lo MISMO que el botón «Editar» del detalle: abre el mazo y entra en el constructor.
    btns.querySelector('.editar').addEventListener('click', e => {
      e.stopPropagation();
      window.sfx && window.sfx('mazos.edit');
      showDetailView(deck, idx);
      enterDeckEdit(deck, idx);
    });
    btns.querySelector('.exportar').addEventListener('click', e => { e.stopPropagation(); exportDeckImage(deck); });
    btns.querySelector('.qr').addEventListener('click', e => { e.stopPropagation(); if (window.pbDeckQR) window.pbDeckQR.show(deck); });

    const energy = document.createElement('div');
    energy.className = 'mz-deck-energy';
    const enTypes = ((deck.energyTypes && deck.energyTypes.length)
      ? deck.energyTypes
      : (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(deck.cards || [])) : [])
    ).slice(0, 3);
    // data-n gobierna la forma del cúmulo: 1 suelta · 2 superpuestas a la mitad · 3 en triángulo
    energy.dataset.n = String(enTypes.length);
    energy.innerHTML = energyOrbsHTML(enTypes);

    bar.appendChild(btns);
    bar.appendChild(energy);

    info.appendChild(nameEl);
    info.appendChild(dateEl);
    info.appendChild(bar);

    card.appendChild(stack);
    card.appendChild(info);
    card._deckKey = key;
    card._deckIdx = idx;      // índice de ALMACENAMIENTO (lo usa el commit del reorden)
    card._deckId = deck.id;
    // Reordenar arrastrando: solo en modo edición (fuera de él la rejilla se comporta
    // exactamente como siempre — clic = abrir el mazo, arrastrar = rectángulo de selección).
    if (_mzSelect) card.addEventListener('pointerdown', e => _mzDeckDragStart(card, e));

    // Clic en la tarjeta:
    //  · Fuera de selección: clic normal abre el detalle; ⌘/Ctrl/⇧-clic entra en
    //    modo selección y marca la tarjeta.
    //  · En selección: clic marca/desmarca (y fija el ancla); ⇧-clic marca el RANGO
    //    visual desde el ancla (como en el explorador de archivos).
    card.addEventListener('click', (e) => {
      if (_rbSuppress) { _rbSuppress = false; return; }   // acaba de terminar un arrastre
      const mod = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!_mzSelect) {
        if (mod) { enterSelectVisual(); toggleSelect(key, card); _mzAnchorKey = key; return; }
        showDetailView(deck, idx);
        return;
      }
      if (e.shiftKey && _mzAnchorKey) { selectRangeVisual(_mzAnchorKey, key); return; }
      toggleSelect(key, card);
      _mzAnchorKey = _mzSel.has(key) ? key : _mzAnchorKey;
    });

    return card;
  }

  // Marca/desmarca un mazo en modo selección y refresca la barra de acciones.
  function toggleSelect(key, cardEl) {
    if (_mzSel.has(key)) { _mzSel.delete(key); cardEl && cardEl.classList.remove('mz-selected'); }
    else { _mzSel.add(key); cardEl && cardEl.classList.add('mz-selected'); }
    syncSelectBar();
  }

  // Cartas del grid en orden visual (para rango con shift-clic y rubber-band).
  function orderedCards() { return Array.from(document.querySelectorAll('#mz-grid .mz-deck-card')); }

  // Selecciona el RANGO visual entre dos tarjetas (inclusive), sumando a la selección.
  function selectRangeVisual(fromKey, toKey) {
    const cards = orderedCards();
    const keys = cards.map(c => c._deckKey);
    let a = keys.indexOf(fromKey), b = keys.indexOf(toKey);
    if (a < 0 || b < 0) return;
    if (a > b) { const t = a; a = b; b = t; }
    for (let i = a; i <= b; i++) { _mzSel.add(keys[i]); cards[i].classList.add('mz-selected'); }
    syncSelectBar();
  }

  // Entra en modo selección SIN recrear las tarjetas (para el arrastre): añade la
  // clase a las existentes y muestra la barra. Así el rubber-band no pierde las refs.
  function enterSelectVisual() {
    _mzSelect = true;
    _mzSel.clear();
    orderedCards().forEach(c => { c.classList.add('mz-selectable'); c.classList.remove('mz-selected'); });
    syncSelectUI(loadLibrary().length);
  }

  // Rubber-band: arrastrar con el RATÓN sobre el grid selecciona las tarjetas que
  // toca el rectángulo (sólo ratón — en táctil el arrastre sigue haciendo scroll).
  function wireRubberBand() {
    const grid = document.getElementById('mz-grid');
    if (!grid || grid._rbWired) return;
    grid._rbWired = true;
    grid.addEventListener('pointerdown', rbDown);
    // Suprime el clic sintético que sigue a un arrastre (fase de captura).
    grid.addEventListener('click', e => {
      if (_rbSuppress) { e.stopPropagation(); e.preventDefault(); _rbSuppress = false; }
    }, true);
  }
  function rbDown(e) {
    if (e.button !== 0) return;
    if (e.pointerType && e.pointerType !== 'mouse') return;         // táctil = scroll
    if (e.target.closest('button, a, input, textarea, select')) return;
    // Reparto del gesto en modo edición: sobre una TARJETA se reordena (lo maneja
    // _mzDeckDragStart, que además corta la propagación); sobre el hueco vacío de la
    // rejilla sigue mandando el rectángulo de selección.
    if (_mzSelect && e.target.closest && e.target.closest('.mz-deck-card')) return;
    _rbStartX = e.clientX; _rbStartY = e.clientY;
    _rbActive = false;
    _rbBase = new Set(_mzSel);                                       // base para arrastre aditivo (⇧/⌘/Ctrl)
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const move = ev => rbMove(ev, additive);
    const up = ev => { rbUp(ev); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  function rbMove(e, additive) {
    const dx = e.clientX - _rbStartX, dy = e.clientY - _rbStartY;
    if (!_rbActive) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;             // umbral clic↔arrastre
      _rbActive = true;
      if (!_mzSelect) { enterSelectVisual(); _rbBase = new Set(); } // arrastrar entra en selección
      _rbBox = document.createElement('div');
      _rbBox.className = 'mz-rubber';
      document.body.appendChild(_rbBox);
      document.body.style.userSelect = 'none';
    }
    const x1 = Math.min(_rbStartX, e.clientX), y1 = Math.min(_rbStartY, e.clientY);
    const w = Math.abs(dx), h = Math.abs(dy);
    _rbBox.style.cssText = 'left:' + x1 + 'px;top:' + y1 + 'px;width:' + w + 'px;height:' + h + 'px;';
    const R = { l: x1, t: y1, r: x1 + w, b: y1 + h };
    orderedCards().forEach(c => {
      const bb = c.getBoundingClientRect();
      const hit = !(bb.right < R.l || bb.left > R.r || bb.bottom < R.t || bb.top > R.b);
      const key = c._deckKey;
      if (hit || (additive && _rbBase.has(key))) { _mzSel.add(key); c.classList.add('mz-selected'); }
      else { _mzSel.delete(key); c.classList.remove('mz-selected'); }
    });
    syncSelectBar();
  }
  function rbUp() {
    if (_rbActive) {
      _rbActive = false;
      _rbSuppress = true;                                            // suprime SOLO el clic síncrono del propio arrastre
      setTimeout(() => { _rbSuppress = false; }, 0);                 // …y se limpia solo (no filtra al siguiente clic)
      if (_rbBox) { _rbBox.remove(); _rbBox = null; }
      document.body.style.userSelect = '';
    }
  }

  /* ── Reordenar mazos arrastrando (SOLO en modo edición) ─────────────────────────────
     Mismo sistema que reordenar cartas dentro de un tier en la Tierlist: con el RATÓN
     arrastras y ya; en TÁCTIL hay que mantener pulsado 0,5 s para «coger» y luego mover
     (así deslizar el dedo sigue haciendo scroll). Se agarra por cualquier zona de la tarjeta
     que no sea un botón.
     Diferencia obligada con la Tierlist: allí las cartas van en una fila FLEX y el destino se
     marca con un caret de 3 px entre dos cartas. #mz-grid es CSS GRID, donde un caret ocuparía
     una celda entera de 190 px y un translateX no puede saltar de fila. Aquí el hueco se ABRE
     de verdad: un hueco fantasma ocupa la celda destino y las demás se apartan con FLIP. */
  let _mzDragArmed = false;      // táctil: gesto tomado (bloquea el scroll del navegador)
  let _mzDragActive = false;     // hay un arrastre vivo (aplaza los re-render de la nube)
  let _mzDragPending = false;    // llegó un re-render durante el arrastre: se hace al soltar
  const MZ_HOLD_MS = 500;        // táctil: mantener para «coger» (igual que la Tierlist)
  const MZ_DRAG_TOL = 6;         // px que distinguen un clic de un arrastre

  function _mzGridScroller() { return document.getElementById('mz-grid-body'); }
  // Auto-scroll al arrastrar cerca de los bordes. El scroller de Mazos es #mz-grid-body
  // (no la vista), y las bandas se miden sobre SU rect, no sobre la ventana: así vale igual
  // en escritorio y en móvil, donde cambian los paddings.
  function _mzEdgeScroll(y) {
    const sc = _mzGridScroller(); if (!sc) return;
    const r = sc.getBoundingClientRect();
    if (y < r.top + 46) sc.scrollTop -= Math.min(26, (r.top + 46 - y) * 0.5);
    else if (y > r.bottom - 46) sc.scrollTop += Math.min(26, (y - (r.bottom - 46)) * 0.5);
  }
  // FLIP: mueve el hueco y anima a las demás tarjetas hasta su sitio nuevo. La transición la
  // pone la clase .mz-reordering del grid → aquí solo se invierte y se suelta (sin timers de
  // limpieza que puedan pisar un FLIP posterior si arrastras rápido).
  function _mzFlip(grid, mover) {
    const els = Array.from(grid.children).filter(el => el.style.display !== 'none');
    const antes = els.map(el => el.getBoundingClientRect());
    mover();
    els.forEach((el, i) => {
      const l = el.getBoundingClientRect();
      const dx = antes[i].left - l.left, dy = antes[i].top - l.top;
      if (!dx && !dy) return;
      el.style.transition = 'none';
      el.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      els.forEach(el => { el.style.transition = ''; el.style.transform = ''; });
    }));
  }

  function _mzDeckDragStart(card, e) {
    if (!_mzSelect) return;                                   // el arrastre vive en modo edición
    if (e.button != null && e.button !== 0) return;
    if (e.target.closest && e.target.closest('button, a, input, textarea, select')) return;
    const grid = document.getElementById('mz-grid'); if (!grid) return;
    // El rubber-band escucha el MISMO pointerdown sobre #mz-grid: sin cortar aquí se dibujaría
    // además el rectángulo de selección y se desmarcarían mazos mientras arrastras.
    e.stopPropagation();
    const touch = e.pointerType === 'touch';
    const x0 = e.clientX, y0 = e.clientY;
    // Si el mazo agarrado está MARCADO, se mueve toda la selección junta y en su orden
    // relativo (lo que hace un explorador de archivos, que es el vocabulario que esta
    // pestaña ya enseña con ⌘/⇧-clic y el rectángulo). Si no lo está, se mueve solo él.
    const bloque = (_mzSel.has(card._deckKey) && _mzSel.size > 1)
      ? Array.from(grid.querySelectorAll('.mz-deck-card')).filter(c => _mzSel.has(c._deckKey))
      : [card];
    let armed = false, dragging = false, scrolled = false, ghost = null, ph = null;
    const holdT = touch ? setTimeout(() => { if (!scrolled && !dragging) arm(); }, MZ_HOLD_MS) : null;

    function arm() {                       // «coger»: realce, sin fantasma todavía
      armed = true; _mzDragArmed = true;
      card.classList.add('mz-deck-armed');
      if (window.pbHaptic) window.pbHaptic('light');
      if (window.playSound) try { window.playSound('cardGrab'); } catch (er) {}
    }
    function begin() {                     // primer movimiento tras coger → fantasma + hueco
      dragging = true; _mzDragActive = true;
      card.classList.remove('mz-deck-armed');
      grid.classList.add('mz-reordering');
      ph = document.createElement('div');
      ph.className = 'mz-deck-ph';
      ph.style.height = card.getBoundingClientRect().height + 'px';
      card.parentNode.insertBefore(ph, card);
      bloque.forEach(c => { c.style.display = 'none'; });   // salen del flujo Y del hit-test
      ghost = document.createElement('div');
      ghost.className = 'mz-drag-ghost';
      const cover = card.querySelector('.mz-stack');
      if (cover) ghost.appendChild(cover.cloneNode(true));
      if (bloque.length > 1) {
        const n = document.createElement('span');
        n.className = 'mz-drag-count'; n.textContent = bloque.length;
        ghost.appendChild(n);
      }
      document.body.appendChild(ghost);
    }
    function moverHueco(ev) {
      const bajo = document.elementFromPoint(ev.clientX, ev.clientY);
      const ref = bajo && bajo.closest && bajo.closest('#mz-grid .mz-deck-card');
      if (ref && bloque.indexOf(ref) < 0) {
        const r = ref.getBoundingClientRect();
        const despues = (ev.clientY > r.bottom) || (ev.clientY >= r.top && ev.clientX > r.left + r.width / 2);
        const destino = despues ? ref.nextSibling : ref;
        if (destino === ph || (despues && ref.nextSibling === ph)) return;
        _mzFlip(grid, () => grid.insertBefore(ph, destino));
        return;
      }
      // Fuera de una tarjeta pero dentro de la rejilla y por debajo de la última → al final.
      // La «última» tiene que ser la última VISIBLE: las que se están arrastrando siguen en el
      // DOM con display:none y su rectángulo es todo ceros, así que cualquier `y > bottom`
      // daba verdadero y el hueco saltaba al final en cuanto el bloque arrastrado incluía la
      // última tarjeta de la rejilla.
      const g = grid.getBoundingClientRect();
      if (!ref && ev.clientX >= g.left && ev.clientX <= g.right && ev.clientY > g.top) {
        const vis = Array.from(grid.querySelectorAll('.mz-deck-card')).filter(c => c.style.display !== 'none');
        const ultima = vis[vis.length - 1];
        if (!ultima) return;
        const ru = ultima.getBoundingClientRect();
        if (ru.height && ev.clientY > ru.bottom && ph.nextSibling)
          _mzFlip(grid, () => grid.appendChild(ph));
      }
    }
    function onMove(ev) {
      if (!dragging) {
        const d = Math.hypot(ev.clientX - x0, ev.clientY - y0);
        if (touch) {
          if (armed) { if (d > MZ_DRAG_TOL) begin(); else return; }
          else { if (d > MZ_DRAG_TOL) { scrolled = true; clearTimeout(holdT); } return; }   // deslizar = scroll
        } else {
          if (d > MZ_DRAG_TOL) { arm(); begin(); } else return;
        }
      }
      if (ev.cancelable) ev.preventDefault();
      if (ghost) { ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px'; }
      _mzEdgeScroll(ev.clientY);
      moverHueco(ev);
    }
    function limpiar() {
      clearTimeout(holdT);
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      _mzDragArmed = false;
      card.classList.remove('mz-deck-armed');
      if (ghost) { ghost.remove(); ghost = null; }
      grid.classList.remove('mz-reordering');
      Array.from(grid.children).forEach(el => { el.style.transition = ''; el.style.transform = ''; });
    }
    function onUp() {
      const huboArrastre = dragging;
      if (dragging) {
        bloque.forEach(c => { grid.insertBefore(c, ph); c.style.display = ''; });
        if (ph) { ph.remove(); ph = null; }
      }
      limpiar();
      _mzDragActive = false;
      if (huboArrastre) {
        // El clic sintético que sigue al arrastre marcaría/desmarcaría el mazo: se suprime
        // con el mismo mecanismo que ya usa el rubber-band (listener en fase de captura).
        _rbSuppress = true; setTimeout(() => { _rbSuppress = false; }, 0);
        if (window.playSound) try { window.playSound('nextCard'); } catch (er) {}
        _mzCommitOrder();
      } else if (_mzDragPending) { _mzDragPending = false; renderGrid(); }
    }
    function onCancel() {
      if (dragging && ph) {                 // el navegador se llevó el gesto: se deshace
        bloque.forEach(c => { grid.insertBefore(c, ph); c.style.display = ''; });
        ph.remove(); ph = null;
      }
      limpiar();
      _mzDragActive = false;
      if (_mzDragPending) { _mzDragPending = false; renderGrid(); }
    }
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
  }

  /* Escribe el orden nuevo. El orden VISIBLE manda: los mazos que se ven ocupan las mismas
     posiciones del array que ocupaban (en ascendente), pero repartidas en su nuevo orden. Así
     un filtro de formato activo no mueve ni pierde a los que no se ven, que se quedan anclados
     entre sus vecinos. Soltar deja además el orden en «Mi orden ↑»: lo que ves pasa a ser tu
     orden, y así nada salta de sitio al re-pintar. */
  function _mzCommitOrder() {
    const grid = document.getElementById('mz-grid'); if (!grid) return;
    const vis = Array.from(grid.querySelectorAll('.mz-deck-card'));
    const lib = loadLibrary();
    const idx = vis.map(c => c._deckIdx);
    // La biblioteca puede haber cambiado desde que se pintó (otra pestaña, la nube). Si los
    // índices ya no señalan a los mismos mazos, no se escribe nada: se re-pinta y se acabó.
    const coincide = idx.every((i, k) => lib[i] && String(lib[i].id) === String(vis[k]._deckId));
    if (!coincide || new Set(idx).size !== idx.length) { renderGrid(); return; }
    const huecos = idx.slice().sort((a, b) => a - b);
    const out = lib.slice();
    huecos.forEach((pos, k) => { out[pos] = lib[idx[k]]; });
    if (out.every((d, i) => d === lib[i])) { renderGrid(); return; }   // no se movió nada
    // El mazo ACTIVO se resuelve por id y, si no hay ninguno guardado, es «el primero de la
    // biblioteca»: reordenar cambiaría con qué mazo juegas sin decir nada. Se fija antes.
    _mzPinActiveDeck(lib);
    saveLibrary(out);
    // A partir del primer arrastre el orden lo manda el usuario: los favoritos dejan de
    // fijarse arriba (lo que se acaba de guardar ES lo que se veía, así que nada salta).
    try { localStorage.setItem(ORDER_MIG, '1'); } catch (e) {}
    _mzSortBy = 'manual'; _mzSortDir = 'asc';   // lo que ves ES tu orden (sin doble inversión)
    _mzSortSave();
    if (window.renderDeckLibrary) try { window.renderDeckLibrary(); } catch (e) {}   // sidebar del tablero
    renderGrid();
  }
  // Si el mazo activo es implícito (nadie pulsó «Activar» → es lib[0]), se fija el que está
  // activo DE HECHO antes de mover nada.
  function _mzPinActiveDeck(lib) {
    try {
      const id = window._pbActiveDeckId && window._pbActiveDeckId();
      if (id && lib.some((d, i) => _deckKeyOf(d, i) === String(id))) return;
      const cur = lib[0];
      if (cur && cur.id != null && window._pbSetActiveDeck) window._pbSetActiveDeck(cur.id);
    } catch (e) {}
  }

  // Bloquea el scroll del navegador SOLO mientras hay un arrastre tomado (patrón de la
  // Tierlist). Un único listener, registrado al cargar la vista.
  document.addEventListener('touchmove', e => { if (_mzDragArmed && e.cancelable) e.preventDefault(); }, { passive: false });

  // ── Selección múltiple (borrar varios mazos) ──────────────────
  // Muestra u oculta el botón «Seleccionar» (solo en Mis mazos con mazos) y
  // sincroniza la barra de selección con el estado actual.
  function syncSelectUI(deckCount) {
    const selBtn = document.getElementById('mz-select-btn');
    const bar    = document.getElementById('mz-select-bar');
    const newBtn = document.getElementById('mz-new-btn');
    const header = document.getElementById('mz-header');
    const canSelect = _mzMode === 'mine' && deckCount > 0;
    if (selBtn) selBtn.style.display = (canSelect && !_mzSelect) ? '' : 'none';
    const sortWrap = document.getElementById('mz-sort-wrap');
    if (sortWrap) {
      sortWrap.style.display = (canSelect && !_mzSelect) ? '' : 'none';
      if (canSelect && !_mzSelect) _mzSortUpdateUI(); else _mzCloseSortMenu();
    }
    if (newBtn) newBtn.style.display = (_mzMode === 'mine' && !_mzSelect) ? '' : 'none';
    if (bar)    bar.style.display    = _mzSelect ? 'flex' : 'none';
    if (header) header.classList.toggle('mz-selecting', _mzSelect);
    if (_mzSelect) syncSelectBar();
  }

  // ── Desplegable de ORDEN (cabecera de Mis mazos) ──────────────
  // Mismo comportamiento que el de la pestaña Cartas: el disparador enseña la opción activa
  // con su flecha, y volver a clicar la MISMA opción invierte el sentido.
  function _mzSortNames() {
    return { manual: T('mazos.sortManual'), date: T('mazos.sortDate'),
             name: T('cards.sortName'), type: T('mazos.sortType') };
  }
  function _mzSortUpdateUI() {
    // «Mi orden» NO tiene sentido ascendente/descendente: es la posición en la que el usuario
    // ha colocado sus mazos. Ahí la flecha ni se pinta, y reclicarlo no invierte nada.
    const names = _mzSortNames(), manual = _mzSortBy === 'manual', desc = _mzSortDir === 'desc';
    const lbl = document.getElementById('mz-sort-label');
    if (lbl) lbl.textContent = names[_mzSortBy] || _mzSortBy;
    const dir = document.getElementById('mz-sort-dir');
    if (dir) { dir.classList.toggle('desc', !manual && desc); dir.classList.toggle('hide', manual); }
    document.querySelectorAll('#mz-sort-menu .mz-menu-item').forEach(b => {
      const active = b.dataset.sort === _mzSortBy;
      b.classList.toggle('active', active);
      const ar = b.querySelector('.mz-menu-dir');
      if (ar) { ar.classList.toggle('desc', active && !manual && desc); ar.classList.toggle('hide', b.dataset.sort === 'manual'); }
    });
  }
  function _mzCloseSortMenu() {
    const m = document.getElementById('mz-sort-menu'); if (m) m.style.display = 'none';
    const b = document.getElementById('mz-sort-trigger'); if (b) b.classList.remove('open');
  }
  window._mazosToggleSortMenu = function (e) {
    if (e && e.stopPropagation) e.stopPropagation();   // sin esto el listener de documento lo cierra al instante
    const m = document.getElementById('mz-sort-menu');
    if (!m) return;
    const abrir = m.style.display === 'none';
    m.style.display = abrir ? 'block' : 'none';
    const trig = document.getElementById('mz-sort-trigger');
    if (trig) trig.classList.toggle('open', abrir);
    if (abrir) {
      const fuera = ev => {
        if (ev.target.closest && ev.target.closest('#mz-sort-wrap')) return;
        _mzCloseSortMenu(); document.removeEventListener('click', fuera);
      };
      setTimeout(() => document.addEventListener('click', fuera), 0);
    }
  };
  window._mazosSetSort = function (by) {
    if (!SORT_DIR_DEF[by]) return;
    if (by === 'manual') { _mzSortBy = 'manual'; _mzSortDir = 'asc'; }   // sin dirección
    else if (_mzSortBy === by) _mzSortDir = _mzSortDir === 'asc' ? 'desc' : 'asc';
    else { _mzSortBy = by; _mzSortDir = SORT_DIR_DEF[by]; }
    _mzSortSave();
    _mzCloseSortMenu();
    window.sfx && window.sfx('ui.tab');
    renderGrid();
  };

  function syncSelectBar() {
    const count = document.getElementById('mz-sel-count');
    const del   = document.getElementById('mz-sel-del');
    const copy  = document.getElementById('mz-sel-copy');
    const fav   = document.getElementById('mz-sel-fav');
    const all   = document.getElementById('mz-sel-all');
    const n = _mzSel.size;
    if (count) count.textContent = T('mazos.selectedN', { n });
    if (del)   del.disabled  = n === 0;
    if (copy)  copy.disabled = n === 0;
    if (fav)   fav.disabled  = n === 0;
    const lib = loadLibrary();
    if (all) {
      const total = lib.length;
      all.querySelector('span').textContent = (n >= total && total > 0)
        ? T('mazos.selectNone') : T('mazos.selectAll');
    }
    // El botón «Favoritos» refleja si la selección ya es toda favorita (→ «Quitar de favoritos»)
    if (fav && n) {
      const selDecks = lib.filter((d, i) => _mzSel.has(deckKey(d, i)));
      const allFav = selDecks.length && selDecks.every(d => d.favorite);
      fav.classList.toggle('on', !!allFav);
      const span = fav.querySelector('span');
      if (span) span.textContent = allFav ? T('mazos.unfavorite') : T('mazos.favorite');
    } else if (fav) {
      fav.classList.remove('on');
      const span = fav.querySelector('span');
      if (span) span.textContent = T('mazos.favorite');
    }
  }

  function enterSelect() {
    _mzSelect = true;
    _mzSel.clear();
    _mzAnchorKey = null;
    renderGrid();
  }
  function exitSelect() {
    _mzSelect = false;
    _mzSel.clear();
    _mzAnchorKey = null;
    renderGrid();
  }
  window._mazosToggleSelect = function () { _mzSelect ? exitSelect() : enterSelect(); };
  window._mazosSelectCancel = exitSelect;
  // Escape = salir del modo selección (si no hay un modal propio abierto que lo gestione)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !_mzSelect) return;
    if (document.getElementById('mz-feat-modal') || document.getElementById('mz-dv-modal')) return;
    const gv = document.getElementById('mz-grid-view');
    if (!gv || gv.style.display === 'none') return;
    e.stopPropagation();
    exitSelect();
  });
  window._mazosSelectAll = function () {
    // Solo lo VISIBLE: con un filtro de formato activo, «Seleccionar todo» no puede marcar
    // (y luego borrar) mazos que no están en pantalla.
    const vis = loadLibrary().map((d, i) => ({ d, i }))
      .filter(({ d }) => _mzFormat === 'all' || _fmtIdOf(d) === _mzFormat);
    if (_mzSel.size >= vis.length) _mzSel.clear();
    else vis.forEach(({ d, i }) => _mzSel.add(deckKey(d, i)));
    renderGrid();
  };
  window._mazosDeleteSelected = function () {
    if (!_mzSel.size) return;
    const n = _mzSel.size;
    const doDelete = () => {
      const prev = loadLibrary();
      const lib = prev.filter((d, i) => !_mzSel.has(deckKey(d, i)));
      prev.forEach((d, i) => { if (_mzSel.has(deckKey(d, i))) _mzDraftClear(_draftId(d)); });   // y sus borradores
      saveLibrary(lib);
      _mzSel.clear();
      _mzSelect = false;
      renderGrid();
      if (window.sfx) window.sfx('mazos.delete');
    };
    if (window.pbConfirm) {
      window.pbConfirm({
        title: T('mazos.deleteManyTitle', { n }),
        message: T('mazos.deleteManyConfirm', { n }),
        okLabel: T('mazos.delete'),
        danger: true,
      }).then(ok => { if (ok) doDelete(); });
    } else { doDelete(); }
  };

  // Duplica los mazos seleccionados (copia independiente, id nuevo, «Copia de …»).
  window._mazosDuplicateSelected = function () {
    if (!_mzSel.size) return;
    const lib = loadLibrary();
    const copies = [];
    lib.forEach((d, i) => {
      if (!_mzSel.has(deckKey(d, i))) return;
      const c = JSON.parse(JSON.stringify(d));
      c.id = Date.now() + copies.length;           // id único (mismo formato numérico que el resto)
      c.name = T('mazos.copyOf', { name: d.name || T('mazos.noName') });
      c.savedAt = Date.now();
      c.favorite = false;                            // la copia no hereda el favorito
      copies.push(c);
    });
    if (!copies.length) return;
    saveLibrary(lib.concat(copies));                 // se añaden al final
    _mzSel.clear();
    _mzSelect = false;
    renderGrid();
    if (window.sfx) window.sfx('mazos.edit');
    if (window.pbToast) window.pbToast(T('mazos.duplicatedN', { n: copies.length }));
  };

  // Marca/desmarca como favoritos los seleccionados (los favoritos suben arriba en Mis mazos).
  window._mazosFavoriteSelected = function () {
    if (!_mzSel.size) return;
    const lib = loadLibrary();
    const selDecks = lib.filter((d, i) => _mzSel.has(deckKey(d, i)));
    const makeFav = !(selDecks.length && selDecks.every(d => d.favorite));  // si ya todos fav → quitar
    lib.forEach((d, i) => { if (_mzSel.has(deckKey(d, i))) d.favorite = makeFav; });
    saveLibrary(lib);
    renderGrid();                                    // se queda en modo selección; re-pinta estrellas + orden
    if (window.sfx) window.sfx('mazos.edit');
  };

  // ── Detail render ─────────────────────────────────────────────
  function renderDetail(deck, idx) {
    const headerName = document.getElementById('mz-detail-deck-name-header');
    if (headerName) {
      headerName.textContent = deck.name || 'Sin nombre';
      headerName.classList.remove('mz-rename');
      headerName.contentEditable = 'false';
      headerName.ondblclick = headerName.onblur = headerName.onkeydown = null;
    }
    // Energía junto al nombre. En meta no hay fuente fiable (los types salen del
    // elemento de los protagonistas → Blaziken+Greninja daría agua+fuego) → no se
    // muestra. En mazos propios es EDITABLE: tocarla abre el selector (como el nombre).
    closeEnergyPopover();
    const enHdr = document.getElementById('mz-detail-energy');
    if (enHdr) {
      enHdr.onclick = null;
      if (deck._isMeta) {
        enHdr.className = 'mz-detail-energy';
        enHdr.title = '';
        enHdr.innerHTML = '';
      } else {
        enHdr.className = 'mz-detail-energy mz-energy-editable';
        enHdr.title = T('mazos.editEnergy');
        paintHeaderEnergy(deck);
        enHdr.onclick = (e) => { e.stopPropagation(); openEnergyPopover(deck, idx, enHdr); };
      }
    }
    // Botón «Cartas destacadas» (a la derecha; solo mazos propios)
    const featBtn = document.getElementById('mz-featured-btn');
    if (featBtn) {
      featBtn.style.display = deck._isMeta ? 'none' : '';
      featBtn.onclick = deck._isMeta ? null : (e) => { e.stopPropagation(); openFeaturedPicker(deck, idx); };
    }
    // El grupo de acciones vive ahora en la CABECERA (derecha). Se oculta ENTERO para el
    // detalle meta (que pinta sus propios botones en #mz-meta-detail).
    const detActs = document.getElementById('mz-detail-actions');
    if (detActs) detActs.style.display = deck._isMeta ? 'none' : '';
    // Chip de FORMATO (Estándar / Advanced) junto al nombre. Solo mazos propios (el meta no tiene
    // formato). Tooltip con las reglas. El mazo está ATADO a su formato (no se cambia aquí).
    const fmtChip = document.getElementById('mz-detail-format');
    if (fmtChip) {
      if (deck._isMeta) { fmtChip.style.display = 'none'; }
      else {
        const fid = window.formatIdOf ? window.formatIdOf(deck) : 'standard';
        fmtChip.style.display = '';
        fmtChip.className = 'mz-detail-format' + (fid !== 'standard' ? ' is-advanced' : '');
        fmtChip.textContent = window.formatName ? window.formatName(fid) : (fid === 'advanced' ? 'Advanced' : 'Estándar');
        fmtChip.title = T('format.infoTip');
        fmtChip.style.cursor = 'pointer';
        fmtChip.onclick = () => _formatInfo(fid);   // reglas + ban list del formato
      }
    }

    const cardsCol = document.getElementById('mz-detail-cards-col');
    const infoCol  = document.getElementById('mz-detail-info-col');
    const body     = document.getElementById('mz-detail-body');
    let metaWrap   = document.getElementById('mz-meta-detail');

    // Mazo del META → detalle propio (consenso + flex). Mazo propio → detalle normal.
    if (deck._isMeta) {
      if (body) body.classList.remove('mz-mine');
      if (cardsCol) cardsCol.style.display = 'none';
      if (infoCol)  infoCol.style.display  = 'none';
      if (!metaWrap) {
        metaWrap = document.createElement('div');
        metaWrap.id = 'mz-meta-detail';
        document.getElementById('mz-detail-body').appendChild(metaWrap);
      }
      metaWrap.style.display = 'block';
      renderMetaDetail(deck, metaWrap, idx);
      return;
    }
    if (cardsCol) cardsCol.style.display = '';
    if (infoCol)  infoCol.style.display  = '';
    if (metaWrap) metaWrap.style.display = 'none';
    if (body) body.classList.add('mz-mine');

    // Renombrar (solo mazos propios): doble clic en el título de la cabecera
    if (headerName) {
      headerName.classList.add('mz-rename');
      headerName.ondblclick = () => { headerName.contentEditable = 'true'; headerName.spellcheck = false; headerName.focus(); document.execCommand('selectAll', false, null); };
      headerName.onblur = () => {
        headerName.contentEditable = 'false';
        const newName = headerName.textContent.trim() || deck.name;
        deck.name = newName;
        headerName.textContent = newName;
        // En una sesión de edición el nombre forma parte del borrador: Guardar lo
        // persiste y Volver → Descartar puede revertirlo de verdad.
        if (_mzEditing && _mzEditDeck === deck) _mzDraftSave();
        else {
          const lib = loadLibrary();
          const i = libIndexOf(lib, deck, idx);
          if (i !== -1) { lib[i].name = newName; saveLibrary(lib); }
        }
      };
      headerName.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); headerName.blur(); } };
    }

    renderDetailCards(deck);
    renderDetailStats(deck);
    wireDetailActions(deck, idx);
  }

  // ── Editor de energías del mazo (solo mazos propios) ──────────
  // Se edita como el nombre: tocando la energía de la cabecera se abre un selector
  // con 8 orbes conmutables. El cambio vive en el borrador hasta Guardar.
  const _ENERGY_TYPES = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'];

  function orbHTML(el) {
    const k = window.ORB_ICON_KEY && window.ORB_ICON_KEY[el];
    const src = k && ((window.ENERGY_ICONS && window.ENERGY_ICONS[k]) || (window.ORB_ICONS && window.ORB_ICONS[k]));
    return src ? `<img class="mz-el-orb" src="${src}" alt="">`
               : `<span class="mz-el-dot-circle" style="background:${EL_COLORS[el] || '#888'}"></span>`;
  }

  // Pinta la energía de la cabecera. En el constructor móvil usa literalmente el
  // cúmulo 1/2/3 de las tarjetas de Barajas; vacío = incolora gris (sin seleccionarla).
  function paintHeaderEnergy(deck) {
    const enHdr = document.getElementById('mz-detail-energy');
    if (!enHdr) return;
    const types = (deck.energyTypes && deck.energyTypes.length) ? deck.energyTypes : [];
    if (_mzEditing && _mzEditDeck === deck && isMobile()) {
      const shown = types.length ? types.slice(0, 3) : ['colorless'];
      enHdr.innerHTML = '<span class="mz-header-energy-stack mz-deck-energy' + (types.length ? '' : ' is-unset')
        + '" data-n="' + shown.length + '">' + shown.map(orbHTML).join('') + '</span>';
      return;
    }
    enHdr.innerHTML = types.length
      ? energyOrbsHTML(types)
      : `<span class="mz-energy-add"><svg viewBox="0 0 14 14" fill="none"><line x1="7" y1="3" x2="7" y2="11" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><line x1="3" y1="7" x2="11" y2="7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>${esc(T('mazos.addEnergy'))}</span>`;
  }

  function openEnergyPopover(deck, idx, anchorEl) {
    if (document.getElementById('mz-energy-pop')) { closeEnergyPopover(); return; }   // toca de nuevo = cerrar
    const mobileSheet = isMobile() && _mzEditing && _mzEditDeck === deck;
    const pop = document.createElement('div'); pop.id = 'mz-energy-pop';
    let options = pop;
    if (mobileSheet) {
      pop.className = 'mz-feat-modal mz-energy-modal';
      pop.innerHTML = '<div class="mz-feat-sheet mz-energy-sheet" role="dialog" aria-modal="true">'
        + '<div class="mz-energy-sheet-head"><span>' + esc(T('mazos.editEnergy')) + '</span>'
        + '<button type="button" class="mz-energy-sheet-close" aria-label="Cerrar">'
        + '<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>'
        + '<div class="mz-energy-options"></div></div>';
      options = pop.querySelector('.mz-energy-options');
      pop.addEventListener('click', e => { if (e.target === pop) closeEnergyPopover(); });
      pop.querySelector('.mz-energy-sheet').addEventListener('click', e => e.stopPropagation());
      pop.querySelector('.mz-energy-sheet-close').addEventListener('click', closeEnergyPopover);
    } else pop.className = 'mz-energy-pop';
    const active = new Set(deck.energyTypes || []);
    _ENERGY_TYPES.forEach(el => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mz-energy-toggle' + (active.has(el) ? ' on' : '');
      b.title = window.elName ? window.elName(el) : el;
      b.innerHTML = orbHTML(el);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!b.classList.contains('on') && active.size >= 3) {   // tope de 3 energías en toda la web
          if (window.pbToast) window.pbToast(T('mazos.energyMax3'));
          return;
        }
        const on = b.classList.toggle('on');
        if (on) active.add(el); else active.delete(el);
        saveDeckEnergies(deck, idx, active);
      });
      options.appendChild(b);
    });
    document.body.appendChild(pop);
    if (mobileSheet) {
      pop._esc = (e) => { if (e.key === 'Escape') closeEnergyPopover(); };
      document.addEventListener('keydown', pop._esc, true);
      requestAnimationFrame(() => pop.classList.add('open'));
      return;
    }
    const r = anchorEl.getBoundingClientRect();
    pop.style.left = Math.round(r.left) + 'px';
    pop.style.top  = Math.round(r.bottom + 6) + 'px';
    requestAnimationFrame(() => {
      const pr = pop.getBoundingClientRect();
      if (pr.right > window.innerWidth - 8) pop.style.left = Math.round(window.innerWidth - 8 - pr.width) + 'px';
      if (pr.left < 8) pop.style.left = '8px';
      pop.classList.add('open');
    });
    setTimeout(() => {
      const off = (e) => { if (!pop.contains(e.target) && e.target !== anchorEl && !anchorEl.contains(e.target)) closeEnergyPopover(); };
      const esc = (e) => { if (e.key === 'Escape') closeEnergyPopover(); };
      pop._off = off; pop._esc = esc;
      document.addEventListener('pointerdown', off, true);
      document.addEventListener('keydown', esc, true);
    }, 0);
  }

  function closeEnergyPopover() {
    const pop = document.getElementById('mz-energy-pop');
    if (!pop) return;
    if (pop._off) document.removeEventListener('pointerdown', pop._off, true);
    if (pop._esc) document.removeEventListener('keydown', pop._esc, true);
    if (pop.classList.contains('mz-energy-modal') && pop.classList.contains('open')) {
      pop.classList.remove('open'); setTimeout(() => pop.remove(), 220);
    } else pop.remove();
  }

  // Persiste los tipos de energía elegidos y refresca lo que los muestra.
  function saveDeckEnergies(deck, idx, activeSet) {
    // Orden canónico (mismo que los orbes) para que el guardado sea estable.
    const types = _ENERGY_TYPES.filter(t => activeSet.has(t));
    deck.energyTypes = types;
    if (_mzEditing && _mzEditDeck === deck) _mzDraftSave();
    else {
      const lib = loadLibrary();
      const i = libIndexOf(lib, deck, idx);
      if (i !== -1) { lib[i].energyTypes = types; saveLibrary(lib); }
    }
    paintHeaderEnergy(deck);   // cabecera en vivo
    if (window.sfx) window.sfx('mazos.edit');
  }

  // Colapsa cartas expandidas → [{id,count}] ordenadas (Pokémon por fase, luego entrenadores)
  function collapseCards(cards) {
    const map = new Map(), order = [];
    (cards || []).forEach(c => {
      const key = c.id || c.name;
      if (!map.has(key)) { map.set(key, { id: c.id, count: 0, _c: c }); order.push(key); }
      map.get(key).count++;
    });
    const arr = order.map(k => map.get(k));
    const stageOf = c => (c.stage === 'basic' || c.stage === 0) ? 0 : (c.stage === 1 ? 1 : (c.stage === 2 ? 2 : 0));
    arr.sort((a, b) => {
      const ap = window.isPokemonCard(a._c), bp = window.isPokemonCard(b._c);
      if (ap !== bp) return ap ? -1 : 1;
      if (ap && bp) return stageOf(a._c) - stageOf(b._c);
      return 0;
    });
    return arr.map(x => ({ id: x.id, count: x.count }));
  }

  // ── Edición de mazo EN SITIO (Mis Mazos = el builder; Editar ya no salta a Cartas) ──
  let _mzEditing = false, _mzEditDeck = null, _mzEditIdx = -1, _mzEditCards = null, _mzEditBase = null;
  // De DÓNDE se entró al constructor: 'detail' (botón Editar del mazo abierto) o 'grid'
  // (lápiz de la miniatura, mazo nuevo, importado, borrador reanudado). Lo usa «Volver»,
  // que es un ATRÁS de verdad: devuelve al sitio del que viniste, no siempre a la rejilla.
  let _mzEditFrom = 'grid';

  // ── SESIÓN DE EDICIÓN PERSISTENTE ────────────────────────────────────────────────
  // Antes, editar un mazo vivía SOLO en las 4 variables de arriba: cualquier camino que
  // enseñara la rejilla (el botón ATRÁS del navegador, la pestaña Meta, el hub, recargar)
  // lo destruía en silencio — y con un mazo nuevo se perdía el mazo entero, porque nunca
  // llegó a la biblioteca. Ahora el mazo a medias es un BORRADOR persistente, igual que la
  // partida del tablero: se guarda en cada cambio y solo desaparece al Guardar o al
  // descartarlo a propósito. Salir de la vista lo APARCA, no lo tira.
  // Los borradores van por MAZO (clave = su id), no en una ranura única: aparcar el mazo A
  // y ponerte con el B no puede pisar a A (con un mazo nuevo se perdería entero). Se guardan
  // los DRAFT_MAX más recientes; la rejilla ofrece el último y, al cerrarlo, el siguiente.
  const DRAFT_KEY = 'pocketboard_deck_draft_v1';
  const DRAFT_MAX = 6;
  const _draftId = d => String((d && d.id) != null ? d.id : '');
  function _mzDraftAll() {
    try {
      const raw = JSON.parse(localStorage.getItem(DRAFT_KEY));
      if (!raw || typeof raw !== 'object') return {};
      // Compat: el formato viejo era UN borrador suelto ({deck,cards,...}).
      if (raw.deck && Array.isArray(raw.cards)) { const o = {}; o[_draftId(raw.deck)] = raw; return o; }
      const out = {};
      Object.keys(raw).forEach(k => { const d = raw[k]; if (d && d.deck && Array.isArray(d.cards)) out[k] = d; });
      return out;
    } catch (e) { return {}; }
  }
  function _mzDraftWrite(all) {
    try {
      const ks = Object.keys(all).sort((a, b) => (all[b].ts || 0) - (all[a].ts || 0)).slice(0, DRAFT_MAX);
      const out = {}; ks.forEach(k => { out[k] = all[k]; });
      if (!ks.length) localStorage.removeItem(DRAFT_KEY);
      else localStorage.setItem(DRAFT_KEY, JSON.stringify(out));
      return true;
    } catch (e) { return false; }   // cuota llena → el que llama decide qué hacer
  }
  // ¿Este borrador tiene ALGO que reanudar? Abrir el constructor y salir sin tocar nada NO es
  // «un mazo a medias»: si el borrador es idéntico a lo guardado, la banda de la rejilla salía
  // por nada y apuntaba a un mazo cerrado hace días (reporte de Daniel, 2026-08-24).
  const _cardsKey = arr => (arr || []).map(c => c.id || c.name).sort().join(',');
  const _enerKey  = arr => (arr || []).slice().sort().join(',');
  function _mzDraftUseful(d, lib) {
    if (!d || !d.deck) return false;
    const cards = d.cards || [];
    const saved = lib.find(x => String(x.id) === _draftId(d.deck));
    if (saved) {
      return _cardsKey(saved.cards) !== _cardsKey(cards)
          || (saved.name || '') !== (d.deck.name || '')
          || _enerKey(saved.energyTypes) !== _enerKey(d.deck.energyTypes);
    }
    if (!cards.length) return false;   // mazo nuevo vacío: no hay trabajo dentro
    // Mazo nuevo que nunca llegó a la biblioteca POR ESTE camino, pero cuyas mismas cartas se
    // guardaron DESPUÉS (p.ej. rematando el guardado por otro sitio) → es el rastro de ese
    // guardado, no trabajo pendiente. Se exige que lo guardado sea MÁS NUEVO que el borrador:
    // así, construir hoy un mazo igual que otro que ya tenías sigue contando como trabajo vivo.
    return !lib.some(x => (x.savedAt || 0) > (d.ts || 0) && _cardsKey(x.cards) === _cardsKey(cards));
  }
  // El borrador «vigente» = el más reciente que siga teniendo sentido. Un borrador cuyo mazo
  // se editó DESPUÉS en otro sitio (la nube manda, patrón de cloud-sync), cuyo mazo ya no
  // existe, o que no tiene nada que reanudar se descarta al leerlo (y se poda de paso: así los
  // borradores zombis que ya estén guardados se limpian solos).
  function _mzDraftRead() {
    const all = _mzDraftAll(), lib = loadLibrary();
    let best = null, dirty = false;
    Object.keys(all).forEach(k => {
      const d = all[k];
      const inLib = lib.find(x => String(x.id) === k);
      const muerto = (inLib && (inLib.savedAt || 0) > (d.ts || 0))    // guardado más nuevo (otro dispositivo)
                  || (!inLib && !d.deck._draft)                        // el mazo se borró
                  || !_mzDraftUseful(d, lib);                          // no hay nada que reanudar
      if (muerto) { delete all[k]; dirty = true; return; }
      if (!best || (d.ts || 0) > (best.ts || 0)) best = d;
    });
    if (dirty) _mzDraftWrite(all);
    return best;
  }
  // Guarda el borrador de ESTE mazo. Se llama en CADA mutación (añadir/quitar/renombrar/
  // energía) y al cerrar la pestaña. Devuelve false si no se pudo escribir (cuota llena).
  function _mzDraftSave(explicito) {
    if (!_mzEditing || !_mzEditDeck || !_mzEditCards) return true;
    // Sin cambios respecto a lo guardado no hay borrador: abrir el constructor de un mazo y
    // salir sin tocar nada no puede dejar «un mazo a medias» rondando por la rejilla.
    if (!_mzDraftDirty()) { _mzDraftClear(_draftId(_mzEditDeck)); return true; }
    const d = Object.assign({}, _mzEditDeck);
    delete d.cards;
    const all = _mzDraftAll();
    const prev = all[_draftId(_mzEditDeck)];
    all[_draftId(_mzEditDeck)] = {
      deck: d, cards: _mzEditCards.map(_serCard), idx: _mzEditIdx, ts: Date.now(),
      // `auto` = «seguía dentro del constructor» → volver a Barajas lo reabre. Aparcar a
      // propósito (Volver / hub / Meta) lo pone a false: la rejilla lo ofrece, no lo impone.
      auto: explicito ? false : (prev ? prev.auto !== false : true),
    };
    return _mzDraftWrite(all);
  }
  // Sin id = todos (reset de emergencia); con id = solo el de ese mazo.
  function _mzDraftClear(id) {
    if (id == null) { try { localStorage.removeItem(DRAFT_KEY); } catch (e) {} return; }
    const all = _mzDraftAll(); delete all[String(id)]; _mzDraftWrite(all);
  }
  window._mazosDropDraftFor = id => _mzDraftClear(id);   // lo llama el borrado de mazos
  // Predicado de «hay algo a medias» (equivalente a _pbHasLiveMatch del tablero).
  window._mazosLoadLibrary = loadLibrary;   // hook de test
  window._mazosHasDraft = function () { return !!_mzDraftRead(); };
  // ¿Volver a Barajas debe reabrir el constructor? Solo si NO lo aparcaste a propósito.
  window._mazosDraftIsAuto = function () { const d = _mzDraftRead(); return !!(d && d.auto !== false); };
  window._mazosDraftName = function () { const d = _mzDraftRead(); return d ? (d.deck.name || T('mazos.noName')) : ''; };
  // ¿Hay cambios de verdad respecto a lo GUARDADO? (para no preguntar por nada). La base es
  // el registro de la BIBLIOTECA, no _mzEditDeck: al reanudar un borrador, _mzEditDeck ya es
  // el snapshot divergido y comparar contra él daría siempre «limpio».
  function _mzDraftDirty() {
    if (!_mzEditing || !_mzEditCards) return false;
    const saved = loadLibrary().find(x => String(x.id) === _draftId(_mzEditDeck));
    if (!saved) return _mzEditCards.length > 0;   // mazo nuevo: cualquier carta es trabajo
    return _cardsKey(saved.cards) !== _cardsKey(_mzEditCards)
        || (saved.name || '') !== (_mzEditDeck.name || '')
        || _enerKey(saved.energyTypes) !== _enerKey(_mzEditDeck.energyTypes);
  }
  // Reabre el borrador aparcado. Devuelve true si lo consiguió.
  window._mazosResumeDraft = function () {
    const d = _mzDraftRead();
    if (!d) return false;
    if (_mzEditing) return true;   // ya estás dentro
    const deck = Object.assign({}, d.deck, { cards: d.cards.slice() });
    enrichDeck(deck);
    showDetailView(deck, (d.idx != null ? d.idx : -1), true);
    enterDeckEdit(deck, (d.idx != null ? d.idx : -1));
    return true;
  };
  window._mazosDiscardDraft = function () {
    const d = _mzEditing ? { deck: _mzEditDeck } : _mzDraftRead();   // el que estás tocando
    if (d && d.deck) _mzDraftClear(_draftId(d.deck));   // NUNCA sin id: eso borraría todos
    if (_mzEditing) { _mzEditing = false; _mzEditCards = null; _mzEditDeck = null; _mzEditIdx = -1; }
    showGridView();
  };
  // Cerrar la pestaña/recargar a mitad de edición no puede perder nada.
  // OJO: el listener recibe el Event como 1er argumento → hay que envolverlo, o `explicito`
  // sería truthy y recargar la página contaría como «lo aparqué a propósito».
  // …y NO puede devolver nada: un valor de retorno en `beforeunload` hace que el navegador
  // pregunte «¿seguro que quieres salir?» y bloquee la navegación.
  window.addEventListener('beforeunload', () => { _mzDraftSave(); });

  // En móvil, el constructor ES la vista Cartas real dentro de Barajas. En PC se
  // restaura en su pestaña y continúa el buscador grande tradicional.
  function _mzSyncMobileBuilder(resetFilters) {
    const host = document.getElementById('mz-mobile-cards-host');
    const header = document.getElementById('mz-detail-header');
    const wasMounted = !!(window.pbCardsSurface && window.pbCardsSurface.isMounted());
    if (!_mzEditing || !isMobile()) {
      if (window.pbCardsSurface) window.pbCardsSurface.restore();
      if (host) { host.classList.remove('active'); host.setAttribute('aria-hidden', 'true'); }
      if (header) header.classList.toggle('mz-editing', !!_mzEditing);
      if (_mzEditing) _mzbBuildSearch();
      if (_mzEditing && wasMounted) _mzPillSetup(_mzEditDeck);
      return;
    }
    const oldSearch = document.getElementById('mzb-search'); if (oldSearch) oldSearch.remove();
    if (host && window.pbCardsSurface) {
      window.pbCardsSurface.mount(host, document.getElementById('view-mazos'));
      host.classList.add('active'); host.setAttribute('aria-hidden', 'false');
      if (resetFilters) window.pbCardsSurface.reset();
    }
    if (_mzPillObs) _mzPillSetup(_mzEditDeck);   // cruce PC → móvil: abre desde el inicio
    if (header) header.classList.add('mz-editing');
    paintHeaderEnergy(_mzEditDeck);
  }
  window._mazosSyncMobileBuilder = function () { if (_mzEditing) _mzSyncMobileBuilder(false); };

  function enterDeckEdit(deck, idx, from) {
    _mzbResetSearch();   // cada edición arranca con el buscador limpio (sin filtros ni texto viejos)
    _mzEditing = true; _mzEditDeck = deck; _mzEditIdx = idx;
    _mzEditFrom = (from === 'detail') ? 'detail' : 'grid';
    _mzEditCards = (deck.cards || []).slice();   // copia de trabajo (Cancelar la descarta)
    const saved = loadLibrary().find(x => String(x.id) === _draftId(deck));
    _mzEditBase = {
      name: saved ? saved.name : deck.name,
      energyTypes: ((saved ? saved.energyTypes : deck.energyTypes) || []).slice(),
    };
    const body = document.getElementById('mz-detail-body');
    if (body) body.classList.add('mz-editing');
    renderDetailCards(deck, true); renderDetailStats(deck); wireDetailActions(deck, idx);
    _mzPillSetup(deck);
    _mzSyncMobileBuilder(true);
    _mzApplyPin(); _mzPinRefresh();
    _mzDraftSave();          // el borrador existe desde el primer instante, no desde el primer cambio
    _mzSyncDraftBanner(); _mzSyncRescueBanner();    // dentro del constructor la banda de la rejilla sobra
  }
  // Recorta una carta a los campos canónicos de biblioteca (= serDeckCard de main.js, que no
  // está en window). Evita guardar los objetos GORDOS de CARDS_DB que mete la búsqueda.
  function _serCard(c) {
    return { id: c.id || '', name: c.name || '', image: c._temp ? '' : (c.image || ''),
             health: c.health || 0, cardType: c.cardType || '', element: c.element || '',
             stage: c.stage != null ? c.stage : '', evolvesFrom: c.evolvesFrom || '',
             expansion: window.cardSetCode ? window.cardSetCode(c) : (c.expansion || c.set || ''),
             number: c.number || '', rarity: c.rarity || '', _temp: c._temp || false };
  }
  let _mzExitT = 0;
  function exitDeckEdit(save, done) {
    // Los − / + se extendieron al entrar (dcbExtend) → al salir se repliegan antes de re-pintar.
    const grid = document.getElementById('mz-cards-grid');
    const reduce = window.pbFx && window.pbFx('reduceMotion');
    if (!_mzExitT && grid && grid.querySelector('.dcb-minus') && !reduce) {
      grid.classList.add('dcb-out');
      _mzExitT = setTimeout(() => {
        _mzExitT = 0;
        const g = document.getElementById('mz-cards-grid'); if (g) g.classList.remove('dcb-out');
        _exitDeckEditNow(save, done);
      }, 240);
      return;
    }
    if (_mzExitT) return;   // ya hay una salida en curso
    _exitDeckEditNow(save, done);
  }
  function _exitDeckEditNow(save, done) {
    const d = _mzEditDeck, ix = _mzEditIdx, edited = _mzEditCards;
    let savedIdx = -1;
    if (save && d && edited) {
      const lib = loadLibrary();
      let i = libIndexOf(lib, d, ix);
      if (i === -1 && edited.length) { d._draft = false; lib.push(d); i = lib.length - 1; }   // mazo NUEVO → se persiste al Guardar con ≥1 carta
      if (i !== -1) {
        lib[i].cards = edited.map(_serCard);
        lib[i].name = d.name || lib[i].name;
        lib[i].energyTypes = (d.energyTypes || []).slice();
        // Las destacadas son URLs de cartas del mazo. Si al editar desaparece la
        // última copia de una de ellas, no puede seguir ocupando la portada ni un
        // hueco invisible del selector. Una copia restante sí la conserva.
        if (Array.isArray(lib[i].featured) || Array.isArray(d.featured)) {
          const prevFeatured = Array.isArray(lib[i].featured) ? lib[i].featured : d.featured;
          const nextFeatured = featuredForCards({ featured: prevFeatured }, edited);
          lib[i].featured = nextFeatured;
          d.featured = nextFeatured.slice();
        }
        if (window.inferDeckEnergies && !(lib[i].energyTypes && lib[i].energyTypes.length))
          lib[i].energyTypes = window.inferDeckEnergies(edited);
        lib[i].savedAt = Date.now();
        saveLibrary(lib);
        d.cards = lib[i].cards; d.energyTypes = lib[i].energyTypes;
        d.name = lib[i].name;
        savedIdx = i;
      }
    }
    if (!save && d && _mzEditBase) {
      d.name = _mzEditBase.name;
      d.energyTypes = _mzEditBase.energyTypes.slice();
      const hn = document.getElementById('mz-detail-deck-name-header'); if (hn) hn.textContent = d.name || T('mazos.noName');
      paintHeaderEnergy(d);
    }
    _mzDraftClear(_draftId(d));   // salida EXPLÍCITA (Guardar o Descartar) → ese borrador ya no existe
    if (window.pbCardsSurface) window.pbCardsSurface.restore();
    _mzEditing = false; _mzEditCards = null; _mzEditDeck = null; _mzEditIdx = -1; _mzEditBase = null;
    const body = document.getElementById('mz-detail-body');
    if (body) body.classList.remove('mz-editing', 'mz-pin');
    const header = document.getElementById('mz-detail-header'); if (header) header.classList.remove('mz-editing');
    // Ya fuera del modo edición, sustituye el icono móvil provisional por la
    // energía final (incluida la inferida al guardar) o por «Añadir energía».
    if (d) paintHeaderEnergy(d);
    _mzPinScroll(true);
    _mzPillTeardown();
    const sb = document.getElementById('mzb-search'); if (sb) sb.remove();
    const _st = document.querySelector('#mz-detail-info-col .mz-stats-panel'); if (_st) _st.style.display = '';
    // Un mazo NUEVO (draft) cancelado o guardado vacío no llegó a la biblioteca → a la rejilla.
    if (d && d._draft && savedIdx === -1) { showGridView(); if (done) done(true); return; }
    if (d) { renderDetailCards(d); renderDetailStats(d); wireDetailActions(d, savedIdx !== -1 ? savedIdx : ix); }
    if (done) done(false);   // `true` = la salida ya te llevó a la rejilla por su cuenta
  }
  function mzEditDelta(id, delta) {
    if (!_mzEditing || !_mzEditCards) return;
    if (delta > 0) {
      const proto = _mzEditCards.find(c => c.id === id);
      if (!proto) return;
      const _cap2 = window.maxCopiesFor ? window.maxCopiesFor(_mzEditDeck) : 2;
      if (_mzEditCards.filter(c => c.name === proto.name).length >= _cap2) return;   // máx copias del formato
      _mzEditCards.push(Object.assign({}, proto));
    } else {
      for (let i = _mzEditCards.length - 1; i >= 0; i--) {
        if (_mzEditCards[i].id === id) { _mzEditCards.splice(i, 1); break; }
      }
    }
    renderDetailCards(_mzEditDeck); renderDetailStats(_mzEditDeck); _mzPillRefresh(); _mzPinRefresh(); _mzDraftSave();
  }

  // ── Mazo FIJADO arriba mientras buscas (solo escritorio) ──────────────
  // Con el mazo fijado se ve SIEMPRE lo que llevas, sin el pop-up flotante que tapa
  // los resultados. Y al bajar se ENCOGE: el sitio se lo queda la lista de cartas.
  // En móvil se conserva el flujo original: el mazo scrollea y aparece el pop-up.
  const MZ_PIN_KEY  = 'pocketboard_deck_pin_v1';
  const MZ_PIN_MIN   = 0.6;    // escala del mazo encogido (encoge «un poco», sigue legible)
  const MZ_PIN_MAXFRAC = 0.34; // …y ya encogido nunca ocupa más de esta parte de lo que se ve
  const MZ_PIN_FLOOR = 0.28;   // suelo: por debajo, las cartas dejan de reconocerse
  // DOS ESTADOS (natural / encogido) con histéresis, NO un encogimiento continuo ligado al
  // scroll: como encoger el mazo sube la lista ADEMÁS del scroll, el continuo hacía que el
  // contenido fuera a ~1,8× de la velocidad del gesto durante 240 px y luego frenara de golpe
  // a 1× (medido) → con la rueda, cada muesca desplazaba ~175 px en vez de 100. Ahora el
  // reajuste ocurre UNA vez, animado, y a partir de ahí el scroll es 1:1 exacto.
  const MZ_PIN_DOWN = 24;      // px bajados para encoger (casi al arrancar el gesto)
  const MZ_PIN_UP   = 4;       // …y solo vuelve a tamaño natural arriba del todo
  const MZ_PIN_COOL = 300;     // ms mínimos entre cambios de estado (anti-parpadeo)
  let _mzPinS = 1, _mzPinNat = 0, _mzPinSmall = false, _mzPinAt = 0, _mzPinT = 0;
  function _mzPinPrefOn() { try { return localStorage.getItem(MZ_PIN_KEY) !== '0'; } catch (e) { return true; } }
  // La preferencia pertenece a escritorio: no se borra al entrar en móvil, pero allí
  // nunca puede activar el sticky ni bloquear el pop-up del constructor.
  function _mzPinOn() { return !isMobile() && _mzPinPrefOn(); }
  const _MZ_PIN_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M9.6 1.6l4.8 4.8-1.5 1.5-1.2-.4-2.6 2.6.5 2.4-1.1 1.1L5 10.1l-3 2.9 2.9-3-3.5-3.5 1.1-1.1 2.4.5L7.5 3.3l-.4-1.2 2.5-.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>';
  function _mzMakePinBtn() {
    const b = document.createElement('button');
    b.id = 'mz-pin-btn'; b.className = 'mz-detail-btn mz-pin-btn';
    b.innerHTML = _MZ_PIN_SVG + '<span></span>';
    b.onclick = () => {
      if (isMobile()) return;
      const on = !_mzPinPrefOn();
      try { localStorage.setItem(MZ_PIN_KEY, on ? '1' : '0'); } catch (e) {}
      _mzApplyPin();
      if (!on) _mzPillEval(true);   // sin fijar, vuelve el pop-up flotante de siempre
    };
    return b;
  }
  // Enciende/apaga el modo fijado (clase en el scroller) y sincroniza el botón.
  function _mzApplyPin() {
    const on = _mzPinOn();
    const body = document.getElementById('mz-detail-body');
    if (body) body.classList.toggle('mz-pin', !!(on && _mzEditing));
    let btn = document.getElementById('mz-pin-btn');
    // El control tampoco se muestra en móvil. Al cruzar el breakpoint con la edición
    // abierta se quita/recrea sin perder la preferencia guardada de escritorio.
    if ((!_mzEditing || isMobile()) && btn) { btn.remove(); btn = null; }
    else if (_mzEditing && !isMobile() && !btn) {
      const header = document.getElementById('mz-detail-header');
      if (header) {
        btn = _mzMakePinBtn();
        const before = document.getElementById('mz-detail-cancel') || document.getElementById('mz-detail-save-edit');
        header.insertBefore(btn, before || null);
      }
    }
    if (btn) {
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      const sp = btn.querySelector('span');
      if (sp) sp.textContent = T(on ? 'mazos.unpinDeck' : 'mazos.pinDeck');
    }
    if (on && window.pbPill) { _mzPillShown = false; window.pbPill.hide(); }   // el fijado sustituye al pop-up
    _mzPinScroll(true);
    requestAnimationFrame(() => {
      _mzPinScroll(true);   // el mazo puede re-ajustar su tamaño en el frame siguiente
      if (!on) _mzPillEval(true);   // al pasar a móvil, restaura el pop-up según el scroll actual
    });
  }
  // Encoge el mazo fijado en cuanto empiezas a bajar. El alto se mide en el hijo (.mz-dl),
  // que NO lleva el transform → su offsetHeight sigue siendo el natural aunque esté escalado.
  function _mzPinScroll(force) {
    const grid = document.getElementById('mz-cards-grid');
    if (!grid) return;
    if (!_mzEditing || !_mzPinOn()) {
      grid.style.height = ''; grid.style.removeProperty('--mz-pin-s');
      grid.classList.remove('mz-pin-small', 'mz-pin-anim');
      _mzPinS = 1; _mzPinNat = 0; _mzPinSmall = false;
      return;
    }
    const sc = _mzScroller || document.getElementById('mz-detail-body');
    if (force || !_mzPinNat) {
      const inner = grid.firstElementChild;
      _mzPinNat = (inner ? inner.offsetHeight : grid.offsetHeight) || 0;
    }
    const natH = _mzPinNat;
    if (!natH) return;
    // Tamaño del estado encogido: el menor entre «encoge un poco» y «no te comas la
    // pantalla» (protege también ventanas de escritorio especialmente bajas).
    const cap = sc && sc.clientHeight ? (sc.clientHeight * MZ_PIN_MAXFRAC) / natH : 1;
    // Redondeada: si no, un cambio de 1 px en el alto del scroller da otro número y se
    // re-aplica todo el estilo sin que se vea diferencia.
    const fin = Math.round(Math.max(MZ_PIN_FLOOR, Math.min(MZ_PIN_MIN, cap, 1)) * 1000) / 1000;
    const st = sc ? sc.scrollTop : 0;
    // Solo merece la pena encoger si hay lista de sobra por debajo: con poco contenido, el
    // hueco que gana el mazo acorta el scroll, el navegador recorta scrollTop y el estado
    // se pondría a parpadear (encoger↔crecer) sin que el usuario toque nada.
    const gain = natH * (1 - fin);
    const worth = !sc || (sc.scrollHeight - sc.clientHeight) > gain + MZ_PIN_DOWN * 2;
    let small = _mzPinSmall;
    if (!small && st > MZ_PIN_DOWN && worth) small = true;
    else if (small && st < MZ_PIN_UP) small = false;
    if (small !== _mzPinSmall && !force) {
      const now = Date.now();
      if (now - _mzPinAt < MZ_PIN_COOL) {   // demasiado pronto: se re-evalúa al vencer
        clearTimeout(_mzPinT);
        _mzPinT = setTimeout(() => _mzPinScroll(false), MZ_PIN_COOL - (now - _mzPinAt) + 20);
        small = _mzPinSmall;
      } else _mzPinAt = now;
    }
    _mzPinSmall = small;
    const s = small ? fin : 1;
    if (!force && s === _mzPinS) return;
    _mzPinS = s;
    // La transición solo para los cambios que vienen del scroll: una re-medida por cambio de
    // mazo o de ventana tiene que cuadrar al instante, sin animar.
    grid.classList.toggle('mz-pin-anim', !force);
    grid.style.setProperty('--mz-pin-s', s);
    grid.style.height = Math.round(natH * s) + 'px';
    grid.classList.toggle('mz-pin-small', small);
  }
  // Re-mide tras un cambio de mazo. El doble paso es porque fitDeckEl puede reajustar el
  // tamaño de carta en el frame siguiente (ResizeObserver) → el alto natural cambia.
  function _mzPinRefresh() {
    if (!_mzEditing || !_mzPinOn()) return;
    _mzPinScroll(true);
    requestAnimationFrame(() => _mzPinScroll(true));
  }
  window._mazosPinOn = _mzPinOn;                    // hook de test
  window._mazosPinScale = () => _mzPinS;            // hook de test
  window._mazosTogglePin = function () { const b = document.getElementById('mz-pin-btn'); if (b) b.onclick(); };

  // ── Pill flotante en Mis Mazos = el MISMO #cv-deck-pill de Cartas (generalizado, NO replicado) ──
  // Apunta el pill a _mzEditCards vía window.pbPill.setCtx y lo muestra/oculta al scrollear (cuando
  // el mazo se sale de vista). Sincronizado con la rejilla: ambos re-pintan al cambiar el mazo.
  let _mzPillObs = null;               // handler de scroll activo (marcador «pill activo»)
  let _mzScroller = null, _mzDeckEl = null;   // scroller + rejilla del mazo observados
  let _mzPillShown = false;            // ¿pill visible (FAB u abierto)?
  let _mzPillAutoOpened = false;       // ¿ya se auto-ABRIÓ en esta sesión de edición? (auto-abre solo la 1ª vez)
  const MZ_PILL_SHOW_OFFSET = 110;     // px por debajo de «mazo justo fuera» para que aparezca
  const MZ_PILL_HIDE_FRAC = 0.10;      // fracción del alto del mazo que puede quedar arriba al ocultar
  const _mzPillCtx = {
    mode: 'mazos', max: 20, maxCopies: 2, hasGoto: false, noAutoClose: false,
    deck: () => _mzEditCards || [],
    removeCopy: (key) => { const c = (_mzEditCards || []).find(x => (x.id || x.name) === key); if (c) mzEditDelta(c.id, -1); },   // key = IMPRESIÓN
    addCopy: (card) => { if (card) mzEditDelta(card.id, +1); },
    addCard: (card) => _mzbAddCard(card),   // añade a _mzEditCards; devuelve 'added'|'full'|'duplicate'
    onAdd: () => {
      if (!window.pbPill) return;
      const cv = document.getElementById('view-cards');
      // En Cartas (sincronía): mostrar el pop-up al añadir, como en Cartas normal.
      // En Barajas: solo refrescar (el scroll decide mostrar/ocultar).
      if (cv && getComputedStyle(cv).display !== 'none') window.pbPill.show();
      else window.pbPill.refresh();
    },
    save: () => exitDeckEdit(true),
    clear: () => { if (_mzEditCards) { _mzEditCards.length = 0; renderDetailCards(_mzEditDeck); renderDetailStats(_mzEditDeck); _mzPinRefresh(); _mzDraftSave(); } },
    goto: () => {},
  };
  function _mzPillRefresh() { if (_mzEditing && window.pbPill) window.pbPill.refresh(); }
  function _mzPillDetachScroll() {
    if (_mzScroller && _mzPillObs) _mzScroller.removeEventListener('scroll', _mzPillObs);
    _mzPillObs = null; _mzScroller = null; _mzDeckEl = null;
  }
  // Decide si el pop-up del mazo debe verse según el scroll. Con HISTÉRESIS + regla de aparición:
  //  · APARECE un poco DESPUÉS de que el mazo salga de vista — «voy a bajar más».
  //  · DESAPARECE solo cuando el mazo vuelve a verse casi entero (~90%) — «casi arriba».
  //  · Se AUTO-ABRE (panel) SOLO la 1ª vez por sesión de edición; el resto aparece CERRADO (FAB) + pulso.
  //  `force` (al volver de otra pestaña) sincroniza el estado visible al scroll actual, sin histéresis.
  function _mzPillEval(force) {
    if (!_mzEditing || !window.pbPill || !_mzScroller || !_mzDeckEl) return;
    // Mazo fijado arriba = el pop-up flotante sería lo mismo dos veces (y tapa los resultados).
    if (_mzPinOn()) { if (_mzPillShown) { _mzPillShown = false; window.pbPill.hide(); } return; }
    const dr = _mzDeckEl.getBoundingClientRect();
    const rr = _mzScroller.getBoundingClientRect();
    const deckH = dr.height || 1;
    const showNow = dr.bottom <= rr.top - MZ_PILL_SHOW_OFFSET;
    const hideNow = dr.top    >= rr.top - deckH * MZ_PILL_HIDE_FRAC;
    const doShow = () => {
      _mzPillShown = true;
      if (!_mzPillAutoOpened) { _mzPillAutoOpened = true; window.pbPill.refresh(); window.pbPill.show(); }
      else window.pbPill.peek();
    };
    if (force) { if (showNow) doShow(); else { _mzPillShown = false; window.pbPill.hide(); } return; }
    if (!_mzPillShown && showNow) doShow();
    else if (_mzPillShown && hideNow) { _mzPillShown = false; window.pbPill.hide(); }
  }
  function _mzPillSetup(deck) {
    if (!window.pbPill) return;
    _mzPillCtx.max = window.deckSizeFor ? window.deckSizeFor(deck) : 20;
    _mzPillCtx.maxCopies = window.maxCopiesFor ? window.maxCopiesFor(deck) : 2;   // tope POR NOMBRE del formato
    _mzPillCtx.noAutoClose = isMobile();   // móvil: solo la × decide cuándo colapsarlo al FAB
    window.pbPill.setCtx(_mzPillCtx);
    _mzPillDetachScroll();
    _mzPillShown = false;
    _mzPillAutoOpened = false;   // cada entrada en edición reinicia el «auto-abre solo la 1ª vez»
    // En móvil ya no hay una vista grande del mazo que esperar a sacar de pantalla:
    // el pop-up ES el mazo y se abre desde el primer frame. Cerrar × lo deja como FAB.
    if (isMobile()) {
      _mzPillShown = true; _mzPillAutoOpened = true;
      window.pbPill.refresh(); window.pbPill.show();
      return;
    }
    _mzScroller = document.getElementById('mz-detail-body');
    _mzDeckEl = document.getElementById('mz-cards-grid');
    if (!_mzScroller || !_mzDeckEl) { _mzScroller = _mzDeckEl = null; return; }
    let raf = 0;
    const onScroll = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; _mzPinScroll(false); _mzPillEval(false); }); };
    _mzPillObs = onScroll;
    _mzScroller.addEventListener('scroll', onScroll, { passive: true });
    _mzPillEval(false);   // estado inicial
  }
  function _mzPillTeardown() {
    _mzPillDetachScroll();
    _mzPillShown = false;
    if (window.pbPill) { window.pbPill.hide(); window.pbPill.resetCtx(); }
    // Cerrar la sesión de edición apaga también el pop-up de la pestaña Cartas (y sus «+»).
    if (window._cvSyncDeckUI) window._cvSyncDeckUI();
  }
  // Sincronía Cartas↔Barajas: mientras editas, el pop-up de AMBAS pestañas usa el MISMO mazo
  // (_mzEditCards vía _mzPillCtx). switchAppTab consulta esto para NO resetear el contexto al ir a
  // Cartas, y re-sincroniza la visibilidad del pop-up al volver a Barajas.
  window._mazosIsEditing = function () { return !!_mzEditing; };
  window._mazosEditDeck  = function () { return _mzEditing ? _mzEditDeck : null; };   // hook de test
  window._mazosEditCount = function () { return _mzEditCards ? _mzEditCards.length : -1; };   // hook de test
  window._mazosSyncPill = function () {
    if (!_mzEditing) return;
    if (isMobile()) {
      if (window.pbPill) {
        window.pbPill.refresh();
        const p = document.getElementById('cv-deck-pill');
        if (!p || getComputedStyle(p).display === 'none') window.pbPill.peek();
      }
      return;
    }
    _mzPinScroll(true); _mzPillEval(true);
  };

  // ── Buscador del builder (Tanda 2): MISMA lógica que la tierlist (filtros intermedios) ──
  // Reutiliza las clases .tls-grid/.tls-card/.tls-badge (tierlist-view.css) y .cv-chip (cards-view.css).
  const _MZB_TYPES = ['pokemon', 'item', 'tool', 'supporter', 'stadium', 'fossil'];
  const _MZB_STAGES = ['basic', '1', '2'];
  const _MZB_ELS = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal', 'dragon', 'colorless'];
  const _MZB_RARS = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '✸', '✸✸', '♕', 'Promo'];
  const _MZB_RARDISP = { '◊': '◇', '◊◊': '◇◇', '◊◊◊': '◇◇◇', '◊◊◊◊': '◇◇◇◇' };
  const _MZB_CAP = 300;
  const _mzbST = { q: '', set: '', types: new Set(), els: new Set(), stages: new Set(), rarities: new Set(), ex: false, mega: false, ability: false, custom: false, favOnly: false, evoLine: false, noEvo: false, sortBy: 'set', sortDir: 'desc' };
  // Cada entrada en edición arranca limpia (el orden NO es un filtro → se conserva).
  function _mzbResetSearch() {
    _mzbST.q = ''; _mzbST.set = '';
    _mzbST.types.clear(); _mzbST.els.clear(); _mzbST.stages.clear(); _mzbST.rarities.clear();
    _mzbST.ex = _mzbST.mega = _mzbST.ability = false;
    _mzbST.custom = _mzbST.favOnly = _mzbST.evoLine = _mzbST.noEvo = false;
  }
  // Orden de resultados (copiado de la tierlist): por defecto expansión DESC = más nuevas arriba.
  function _mzbSortResults(cards) {
    const rank = window.SET_RANK || {};
    const RAR = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '✸', '✸✸', '♕', 'Promo'];
    const TYPES = ['pokemon', 'item', 'tool', 'supporter', 'stadium', 'fossil'];
    const setKey = c => (rank[c.set] != null ? rank[c.set] : 99) * 10000 + parseInt(c.number || '0', 10);
    const rr = c => { const i = RAR.indexOf(c.rarity); return i < 0 ? 99 : i; };
    const tk = c => { const i = TYPES.indexOf(c.cardType); return i < 0 ? 99 : i; };
    const nm = c => (window.cardName ? window.cardName(c) : c.name || '').toLowerCase();
    const dir = _mzbST.sortDir === 'asc' ? 1 : -1;
    return cards.slice().sort((a, b) => {
      let p = 0;
      if (_mzbST.sortBy === 'set') p = setKey(a) - setKey(b);
      else if (_mzbST.sortBy === 'rarity') p = rr(a) - rr(b);
      else if (_mzbST.sortBy === 'type') p = (tk(a) - tk(b)) || (setKey(a) - setKey(b));
      else { const na = nm(a), nb = nm(b); p = na < nb ? -1 : na > nb ? 1 : 0; }
      if (p) return p * dir;
      return setKey(a) - setKey(b);   // desempate estable
    });
  }
  function _mzbSetSort(by) {
    if (_mzbST.sortBy === by) _mzbST.sortDir = _mzbST.sortDir === 'asc' ? 'desc' : 'asc';
    else { _mzbST.sortBy = by; _mzbST.sortDir = by === 'set' ? 'desc' : 'asc'; }
    _mzbUpdateSortUI();
    const m = document.getElementById('mzb-sort-menu'); if (m) m.style.display = 'none';
    _mzbRender();
  }
  function _mzbUpdateSortUI() {
    const names = { set: T('cards.sortSet'), type: T('cards.sortType'), rarity: T('cards.sortRarity'), name: T('cards.sortName') };
    const arrow = _mzbST.sortDir === 'asc' ? ' ↑' : ' ↓';
    const label = document.getElementById('mzb-sort-label');
    if (label) label.textContent = (names[_mzbST.sortBy] || _mzbST.sortBy) + arrow;
    document.querySelectorAll('#mzb-sort-menu .cv-sort-opt').forEach(b => {
      const active = b.dataset.sort === _mzbST.sortBy;
      b.classList.toggle('active', active);
      const ar = b.querySelector('.cv-sort-arrow');
      if (ar) ar.textContent = active ? arrow : '';
    });
  }
  function _mzbCloseSortMenu() { const m = document.getElementById('mzb-sort-menu'); if (m) m.style.display = 'none'; }
  window._mzbDebug = () => ({ sortBy: _mzbST.sortBy, sortDir: _mzbST.sortDir, set: _mzbST.set, n: _mzbAll.length, first: _mzbAll.slice(0, 3).map(c => c.set + '-' + c.number) });   // hook de test
  window._mzbAdd = c => _mzbAddCard(c);   // hook de test (añadir al mazo en edición: 'added'|'full'|'duplicate'|'banned')
  const _MZB_PAGE = 60;
  let _mzbAll = [], _mzbLoaded = 0, _mzbGrid = null, _mzbSent = null, _mzbObs = null;

  function _mzbToggle(set, val, chip, kind) {
    const wasActive = set.has(val);
    if (wasActive) set.delete(val); else set.add(val);
    if (chip) chip.classList.toggle('active');
    // Mismo estallido de partículas/pop que la pestaña Cartas (solo al ACTIVAR).
    if (!wasActive && chip && window._cvChipBurst) window._cvChipBurst(chip, kind, val);
    _mzbRender();
  }

  // Copiado de searchMatches() de la tierlist.
  // ¿El mazo que se está editando admite cartas CUSTOM? (hoy: solo el formato Avanzado)
  function _mzbCustomOk() {
    if (!window.isCustomAllowedIn || !(window.CUSTOM_CARDS || []).length) return false;
    return window.isCustomAllowedIn(window.CUSTOM_CARDS[0], window.formatIdOf(_mzEditDeck));
  }

  function _mzbMatches() {
    // plegada (sin tildes ni apostrofos) igual que el indice de nombres de shared.js
    const q = window.pbFold ? window.pbFold(_mzbST.q.trim().toLowerCase()) : _mzbST.q.trim().toLowerCase();
    const CU = _mzbCustomOk() ? (window.CUSTOM_CARDS || []) : [];
    const POOL = _mzbST.custom ? CU : (q && CU.length ? (window.CARDS_DB || []).concat(CU) : (window.CARDS_DB || []));
    const preevo = (_mzbST.noEvo && window.pbPreevoNames) ? window.pbPreevoNames() : null;
    const res = POOL.filter(c => {
      if (!c || !c.image || c._temp) return false;
      // «Ocultar preevoluciones»: fuera toda carta cuyo NOMBRE sea el evolvesFrom de otra.
      if (preevo && preevo.has((c.name || '').toLowerCase())) return false;
      if (_mzbST.set && !window.cardInSetValue(c, _mzbST.set)) return false;   // expansión o SOBRE
      if (_mzbST.types.size && !_mzbST.types.has(c.cardType) && !(c.cardType === 'fossil' && _mzbST.types.has('item'))) return false;
      if (_mzbST.els.size && !(c.cardType === 'pokemon' && _mzbST.els.has(c.element))) return false;
      if (_mzbST.stages.size) {
        if (c.cardType !== 'pokemon') return false;
        const st = c.stage == null ? null : (c.stage === 'basic' || c.stage === 0 ? 'basic' : String(c.stage));
        if (!_mzbST.stages.has(st)) return false;
      }
      if (_mzbST.rarities.size && !_mzbST.rarities.has(c.rarity)) return false;
      if (_mzbST.ex && !c.ex) return false;
      if (_mzbST.mega && !(c.name || '').toLowerCase().startsWith('mega ')) return false;
      if (_mzbST.ability && !c.hasAbility) return false;
      if (_mzbST.favOnly && !(window.pbIsFav && window.pbIsFav(c.id))) return false;
      if (q) { const names = window.cardSearchNames ? window.cardSearchNames(c) : (c.name || '').toLowerCase(); if (names.indexOf(q) < 0) return false; }
      return true;
    });
    // «Mostrar línea evolutiva»: añade las preevos/evoluciones de lo que ya casó (como en Cartas).
    if (_mzbST.evoLine && res.length && window.pbEvoChainNames) {
      const origin = new Set(res.map(c => (c.name || '').toLowerCase()));
      const chain = window.pbEvoChainNames(origin);
      const seen = new Set(res.map(c => c.id));
      (window.CARDS_DB || []).forEach(c => {
        const n = (c.name || '').toLowerCase();
        if ((c.cardType === 'pokemon' || c.cardType === 'fossil') && chain.has(n) && !origin.has(n) && !seen.has(c.id)) {
          res.push(c); seen.add(c.id);
        }
      });
    }
    return res;
  }

  function _mzbChip(host, cls, label, active, onClick, html) {
    const c = document.createElement('span');
    c.className = 'cv-chip ' + cls + (active ? ' active' : '');
    if (html) c.innerHTML = html; else c.textContent = label;
    c.addEventListener('click', () => onClick(c));
    host.appendChild(c);
    return c;
  }

  function _mzbBuildSearch() {
    // El buscador es una "pestaña" del área bajo el mazo (info-col): sustituye a la mano inicial.
    // Los botones (Editar/Activar/Guardar/Cancelar) quedan arriba, entre el mazo y el buscador.
    const col = document.getElementById('mz-detail-info-col');
    if (!col || document.getElementById('mzb-search')) return;
    const _st = col.querySelector('.mz-stats-panel'); if (_st) _st.style.display = 'none';
    const box = document.createElement('div');
    box.id = 'mzb-search';
    box.innerHTML =
      '<div id="mzb-bar">' +
        '<div id="mzb-search-wrap" class="pb-search-wrap">' +
          '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/><line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
          '<input id="mzb-q" class="pb-search-input" type="text" autocomplete="off" spellcheck="false" placeholder="' + esc(T('cards.searchPlaceholder') || 'Nombre...') + '">' +
          '<span id="mzb-q-clear" class="pb-search-clear">✕</span>' +
        '</div>' +
        '<div id="mzb-set-wrap" class="pb-set-wrap"></div>' +
        '<div id="mzb-sort-wrap" class="pb-sort-wrap">' +
          '<button id="mzb-sort-trigger" class="pb-sort-trigger" type="button"><span id="mzb-sort-label"></span></button>' +
          '<div id="mzb-sort-menu" class="pb-sort-menu" style="display:none">' +
            '<button class="cv-sort-opt" data-sort="set"><span>' + esc(T('cards.sortSet')) + '</span><span class="cv-sort-arrow"></span></button>' +
            '<button class="cv-sort-opt" data-sort="type"><span>' + esc(T('cards.sortType')) + '</span><span class="cv-sort-arrow"></span></button>' +
            '<button class="cv-sort-opt" data-sort="rarity"><span>' + esc(T('cards.sortRarity')) + '</span><span class="cv-sort-arrow"></span></button>' +
            '<button class="cv-sort-opt" data-sort="name"><span>' + esc(T('cards.sortName')) + '</span><span class="cv-sort-arrow"></span></button>' +
          '</div>' +
        '</div>' +
        '<div class="cv-chip-group" id="mzb-type"></div>' +
        '<div class="cv-chip-group" id="mzb-el"></div>' +
        '<div class="cv-chip-group" id="mzb-stage"></div>' +
        '<div class="cv-chip-group" id="mzb-rar"></div>' +
        '<div class="cv-chip-group" id="mzb-flags"></div>' +
        '<div class="cv-chip-group" id="mzb-evo"></div>' +
        '<div class="cv-chip-group" id="mzb-fav"></div>' +
        '<div class="cv-chip-group" id="mzb-custom"></div>' +
        '<button id="mzb-clear" type="button" title="' + esc(T('cards.clearFilters')) + '" aria-label="' + esc(T('cards.clearFilters')) + '">' +
          '<svg viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.7-3.9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M13.6 1.9v3.2h-3.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '</button>' +
        '<span id="mzb-count"></span>' +
      '</div><div id="mzb-results"></div>';
    col.appendChild(box);
    const q = box.querySelector('#mzb-q');
    q.value = _mzbST.q; q.oninput = () => { _mzbST.q = q.value; _mzbRender(); };
    const qc = box.querySelector('#mzb-q-clear');
    if (qc) qc.onclick = () => { q.value = ''; _mzbST.q = ''; _mzbRender(); q.focus(); };
    // Expansión / SOBRE: el MISMO componente que la pestaña Cartas (window.pbSetPicker),
    // con miniaturas de sobre y sub-lista por sobre. Aquí el almacén del valor es _mzbST.set.
    const setHost = box.querySelector('#mzb-set-wrap');
    if (setHost && window.pbSetPicker) {
      window.pbSetPicker.mount(setHost, {
        get: () => _mzbST.set,
        set: v => { _mzbST.set = v; },
        onChange: () => _mzbRender(),
        order: 'game',   // el constructor lista las expansiones en el orden del juego (SET_ORDER)
      });
    }
    // Orden (desplegable): expansión/tipo/rareza/nombre (por defecto expansión ↓ = más nuevas).
    const sortTrig = box.querySelector('#mzb-sort-trigger'), sortMenu = box.querySelector('#mzb-sort-menu');
    if (sortTrig && sortMenu) {
      sortTrig.onclick = e => {
        e.stopPropagation();   // OJO: sin esto, el listener de documento cierra el menú al instante
        if (window.pbSetPicker) document.querySelectorAll('.pb-set-wrap').forEach(h => window.pbSetPicker.close(h));
        sortMenu.style.display = sortMenu.style.display === 'none' ? 'block' : 'none';
      };
      sortMenu.querySelectorAll('.cv-sort-opt').forEach(opt => { opt.onclick = () => _mzbSetSort(opt.dataset.sort); });
      document.removeEventListener('click', _mzbCloseSortMenu); document.addEventListener('click', _mzbCloseSortMenu);
      _mzbUpdateSortUI();
    }
    const tHost = box.querySelector('#mzb-type');
    // data-cv-type/-cv-el/-cv-stage/-rar = las MISMAS claves que usa la CSS de Cartas para el
    // color de ACTIVO de cada filtro → así el chip pulsado se destaca igual que en Cartas.
    _MZB_TYPES.forEach(t => { const c = _mzbChip(tHost, '', (window.typeName ? window.typeName(t) : t), _mzbST.types.has(t), ch => _mzbToggle(_mzbST.types, t, ch, 'type')); c.dataset.cvType = t; });
    const eHost = box.querySelector('#mzb-el');
    _MZB_ELS.forEach(e => {
      // Icono = el ORBE de energía REAL (como la pestaña Cartas), no un puntito de color.
      const key = window.ORB_ICON_KEY && window.ORB_ICON_KEY[e];
      const src = (key && ((window.ENERGY_ICONS && window.ENERGY_ICONS[key]) || (window.ORB_ICONS && window.ORB_ICONS[key]))) || (e === 'dragon' ? window.DRAGON_EL_ICON : null);
      const icon = src ? '<img src="' + src + '" style="width:20px;height:20px;border-radius:50%;pointer-events:none;" draggable="false">' : '<span class="cv-eldot el-' + e + '"></span>';
      const c = _mzbChip(eHost, 'cv-el-chip cv-el-icon', '', _mzbST.els.has(e), ch => _mzbToggle(_mzbST.els, e, ch, 'el'), icon);
      c.dataset.cvEl = e;
      c.title = window.elName ? window.elName(e) : e;
    });
    const sHost = box.querySelector('#mzb-stage');
    _MZB_STAGES.forEach(s => { const c = _mzbChip(sHost, '', (window.stageLabel ? window.stageLabel(s === 'basic' ? 'basic' : parseInt(s, 10)) : s), _mzbST.stages.has(s), ch => _mzbToggle(_mzbST.stages, s, ch, 'stage')); c.dataset.cvStage = s; });
    const rHost = box.querySelector('#mzb-rar');
    _MZB_RARS.forEach(r => { const ih = window.rarityIconHTML && window.rarityIconHTML(r); const c = _mzbChip(rHost, 'cv-rar-chip', _MZB_RARDISP[r] || r, _mzbST.rarities.has(r), ch => _mzbToggle(_mzbST.rarities, r, ch, 'rar'), ih || undefined); c.dataset.rar = r; });
    const fHost = box.querySelector('#mzb-flags');
    // Flags (EX/Mega/Habilidad): mismo estallido temático que Cartas (_cvMechBurst vía _cvChipBurst).
    const _flagBurst = (c, k, on) => { if (on && window._cvChipBurst) window._cvChipBurst(c, k, k); };
    _mzbChip(fHost, '', 'EX', _mzbST.ex, c => { _mzbST.ex = !_mzbST.ex; c.classList.toggle('active'); _flagBurst(c, 'ex', _mzbST.ex); _mzbRender(); });
    _mzbChip(fHost, '', 'Mega', _mzbST.mega, c => { _mzbST.mega = !_mzbST.mega; c.classList.toggle('active'); _flagBurst(c, 'mega', _mzbST.mega); _mzbRender(); });
    _mzbChip(fHost, '', (window.t ? window.t('cards.ability') : 'Habilidad'), _mzbST.ability, c => { _mzbST.ability = !_mzbST.ability; c.classList.toggle('active'); _flagBurst(c, 'ability', _mzbST.ability); _mzbRender(); });
    // Línea evolutiva: los dos son EXCLUYENTES (activar uno apaga el otro), como en Cartas.
    const vHost = box.querySelector('#mzb-evo');
    let evoChip = null, preChip = null;
    const _evoSync = () => {
      if (evoChip) evoChip.classList.toggle('active', _mzbST.evoLine);
      if (preChip) preChip.classList.toggle('active', _mzbST.noEvo);
      _mzbRender();
    };
    evoChip = _mzbChip(vHost, 'mzb-evo-chip', T('cards.evoLine'), _mzbST.evoLine, () => {
      _mzbST.evoLine = !_mzbST.evoLine; if (_mzbST.evoLine) _mzbST.noEvo = false; _evoSync();
    });
    preChip = _mzbChip(vHost, 'mzb-evo-chip', T('cards.hidePreevo'), _mzbST.noEvo, () => {
      _mzbST.noEvo = !_mzbST.noEvo; if (_mzbST.noEvo) _mzbST.evoLine = false; _evoSync();
    });
    // Cartas CUSTOM de pokelink: chip APARTE y SIEMPRE el último; solo existe si el formato
    // del mazo las admite (Avanzado). Etiqueta corta; el texto explícito, en el tooltip.
    // Favoritas: MISMO sistema que la pestaña Cartas (pbIsFav/pbToggleFav sobre
    // pocketboard_favorites_v1, ya sincronizado con la cuenta) — nada nuevo que persistir.
    const favHost = box.querySelector('#mzb-fav');
    if (favHost) {
      const _STAR = '<svg viewBox="0 0 16 16" width="15" height="15" style="pointer-events:none"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6 4.2 13.6l.7-4.3-3.1-3 4.3-.6L8 1.8z" fill="currentColor" fill-opacity="var(--mzb-star-fill,0)" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
      const fc = _mzbChip(favHost, 'mzb-fav-chip', '', _mzbST.favOnly, c => {
        _mzbST.favOnly = !_mzbST.favOnly; c.classList.toggle('active');
        if (_mzbST.favOnly && window._cvChipBurst) window._cvChipBurst(c, 'fav', 'fav');
        _mzbRender();
      }, _STAR);
      fc.title = T('cards.favorites');
    }
    if (_mzbCustomOk()) {
      const cHost = box.querySelector('#mzb-custom');
      const cch = _mzbChip(cHost, 'mzb-custom-chip', (window.t ? window.t('cards.customBadge') : 'CUSTOM'), _mzbST.custom, c => { _mzbST.custom = !_mzbST.custom; c.classList.toggle('active'); _mzbRender(); });
      if (cch) cch.title = window.t ? window.t('cards.customFilter') : '';
    }
    // Móvil: los grupos segmentados pasan a rejilla (si no, se salen de la pantalla).
    // Mismo helper que la hoja de filtros de Cartas.
    if (window.pbGridifyChips) window.pbGridifyChips(box.querySelector('#mzb-bar'), _mzMqNarrow());

    const clr = box.querySelector('#mzb-clear');
    if (clr) clr.onclick = () => { _mzbResetSearch(); _mzbRebuildSearch(); };

    _mzbRender();
  }

  // Breakpoint del buscador del constructor (el mismo de toda la web).
  const _mzbMq = (window.matchMedia ? window.matchMedia('(max-width: 720px)') : null);
  function _mzMqNarrow() { return !!(_mzbMq && _mzbMq.matches); }
  if (_mzbMq && _mzbMq.addEventListener) _mzbMq.addEventListener('change', () => {
    const bar = document.querySelector('#mzb-search #mzb-bar');
    if (bar && window.pbGridifyChips) window.pbGridifyChips(bar, _mzMqNarrow());
  });

  // Rehace la caja del buscador desde el estado actual (el mismo camino que usa el cambio de
  // idioma). _mzbBuildSearch sale temprano si la caja ya existe → hay que quitarla antes.
  function _mzbRebuildSearch() {
    const old = document.getElementById('mzb-search');
    if (old) old.remove();
    _mzbBuildSearch();
  }

  function _mzbRender() {
    const host = document.getElementById('mzb-results');
    if (!host) return;
    _mzbAll = _mzbSortResults(_mzbMatches());
    _mzbLoaded = 0;
    if (_mzbObs) { _mzbObs.disconnect(); _mzbObs = null; }
    const cnt = document.getElementById('mzb-count');
    if (cnt) cnt.textContent = String(_mzbAll.length);
    host.innerHTML = '';
    if (!_mzbAll.length) { const e = document.createElement('div'); e.className = 'mz-md-empty'; e.textContent = T('tierlist.searchEmpty') || 'Sin resultados'; host.appendChild(e); _mzbGrid = null; return; }
    _mzbGrid = document.createElement('div'); _mzbGrid.id = 'mzb-grid'; host.appendChild(_mzbGrid);
    _mzbSent = document.createElement('div'); _mzbSent.id = 'mzb-sentinel'; host.appendChild(_mzbSent);
    _mzbMore();
  }

  // Scroll infinito (como Cartas): páginas que se cargan al bajar, sin caja con scroll propio.
  function _mzbMore() {
    if (!_mzbGrid) return;
    const inDeck = {};
    (_mzEditCards || []).forEach(c => { const k = c.name || c.id; inDeck[k] = (inDeck[k] || 0) + 1; });
    const end = Math.min(_mzbLoaded + _MZB_PAGE, _mzbAll.length);
    for (let i = _mzbLoaded; i < end; i++) _mzbGrid.appendChild(_mzbResultCard(_mzbAll[i], inDeck));
    _mzbLoaded = end;
    if (_mzbObs) { _mzbObs.disconnect(); _mzbObs = null; }
    if (_mzbLoaded < _mzbAll.length && 'IntersectionObserver' in window && _mzbSent) {
      _mzbObs = new IntersectionObserver(es => { if (es[0].isIntersecting) _mzbMore(); }, { rootMargin: '700px' });
      _mzbObs.observe(_mzbSent);
    }
  }

  // Tarjeta de resultado ESTILO CARTAS (nombre + tipo abajo, botón +, zoom al clic). Reutiliza .cv-card-*.
  function _mzbResultCard(card, inDeck) {
    const wrap = document.createElement('div');
    wrap.className = 'cv-card-wrap';
    wrap.dataset.name = card.name || card.id;
    // Prohibida en el formato del mazo que se edita → se ve atenuada y no se puede añadir
    // (el intento avisa igualmente con el motivo, en vez de fallar en silencio).
    if (window.isCardBanned && _mzEditDeck && window.isCardBanned(card, window.formatIdOf(_mzEditDeck))) wrap.classList.add('mzb-banned');
    if (window.isCustomCard && window.isCustomCard(card) && _mzEditDeck
        && !(window.isCustomAllowedIn && window.isCustomAllowedIn(card, window.formatIdOf(_mzEditDeck)))) wrap.classList.add('mzb-banned');
    const url = metaImg(card);   // mismo resolver que las cartas del mazo (carga fiable)
    // Igual que la pestaña Cartas: el arte es background-image del .cv-card-img
    // (NO un <img>: si no, queda tapado por el esqueleto ::after que solo se retira con .cv-img-loaded).
    const imgDiv = document.createElement('div');
    imgDiv.className = 'cv-card-img cv-img-loaded';
    imgDiv.style.backgroundImage = "url('" + url + "')";
    imgDiv.style.cursor = 'zoom-in';
    // Añadir = LA MISMA función que Cartas (pulso verde/rojo + háptico), vía el contexto del pill.
    const add = () => (window._cvAddWithPulse ? window._cvAddWithPulse(card, imgDiv) : _mzbAddCard(card));
    imgDiv.addEventListener('click', () => {
      if (imgDiv._suppressClick) { imgDiv._suppressClick = false; return; }   // tras long-press, no abrir zoom
      if (window.openZoomFromImage) window.openZoomFromImage(url, imgDiv);
    });
    // Clic derecho (desktop) = añadir. En táctil solo prevenir el menú (añaden los timers de la pulsación).
    imgDiv.addEventListener('contextmenu', e => { e.preventDefault(); if (!(window.pbIsTouchMobile && window.pbIsTouchMobile())) add(); });
    // Táctil: pulsación larga = añadir, con el mismo anillo de progreso que Cartas.
    const lpRing = document.createElement('div'); lpRing.className = 'cv-lp-ring'; imgDiv.appendChild(lpRing);
    if (window.cvLpStart) {
      imgDiv.addEventListener('pointerdown', e => window.cvLpStart(imgDiv, add, e));
      imgDiv.addEventListener('pointermove', window.cvLpMove);
      imgDiv.addEventListener('pointerup', () => window.cvLpUp(imgDiv));
      imgDiv.addEventListener('pointercancel', window.cvLpEnd);
    }
    wrap.appendChild(imgDiv);
    // Estrella de FAVORITA — la MISMA que la pestaña Cartas (clase .cv-fav-star + pbToggleFav),
    // colgada del WRAPPER (no de la imagen) para no chocar con la pulsación larga de «añadir».
    if (window.pbToggleFav) {
      const fav = document.createElement('button');
      fav.className = 'cv-fav-star' + (window.pbIsFav && window.pbIsFav(card.id) ? ' on' : '');
      fav.title = T('cards.favorite');
      fav.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 2.6l2.95 5.98 6.6.96-4.77 4.65 1.13 6.57L12 17.6l-5.91 3.16 1.13-6.57L2.45 9.54l6.6-.96z"/></svg>';
      fav.addEventListener('click', e => {
        e.stopPropagation();
        const now = window.pbToggleFav(card.id);
        fav.classList.toggle('on', now);
        if (_mzbST.favOnly) _mzbRender();   // filtrando favoritas: la carta desmarcada se va
      });
      wrap.appendChild(fav);
    }
    // Sello CUSTOM: cuelga de la IMAGEN (abajo, sobre la carta) para no tapar el nombre impreso.
    if (window.isCustomCard && window.isCustomCard(card)) {
      const cb = document.createElement('div');
      cb.className = 'cv-custom-badge';
      cb.textContent = window.t ? window.t('cards.customBadge') : 'CUSTOM';
      imgDiv.appendChild(cb);
    }
    const info = document.createElement('div'); info.className = 'cv-card-info';
    const name = document.createElement('div'); name.className = 'cv-card-name';
    name.title = window.cardName ? window.cardName(card) : (card.name || '');
    name.textContent = name.title;
    info.appendChild(name);
    const row2 = document.createElement('div'); row2.className = 'cv-card-row2';
    const ct = card.cardType || 'unknown';
    const badge = document.createElement('span'); badge.className = 'cv-badge cv-t-' + ct;
    badge.textContent = window.typeName ? window.typeName(ct) : ct;
    row2.appendChild(badge);
    const addRow = document.createElement('button'); addRow.className = 'cv-card-add-row';
    const dc = (inDeck && inDeck[card.name || card.id]) || 0;
    addRow.textContent = dc ? ('+ (' + dc + ')') : '+';
    if (dc) addRow.classList.add('mzb-in');
    addRow.addEventListener('click', e => { e.stopPropagation(); add(); });
    row2.appendChild(addRow);
    info.appendChild(row2);
    wrap.appendChild(info);
    return wrap;
  }

  // Devuelve 'added'|'full'|'duplicate' (el pulso rojo/verde da el feedback, como en Cartas).
  function _mzbAddCard(card) {
    if (!_mzEditing || !_mzEditCards) return null;
    const cap = window.deckSizeFor ? window.deckSizeFor(_mzEditDeck) : 20;
    if (_mzEditCards.length >= cap) return 'full';
    const _capN = window.maxCopiesFor ? window.maxCopiesFor(_mzEditDeck) : 2;
    if (_mzEditCards.filter(c => c.name === card.name).length >= _capN) return 'duplicate';   // máx copias del formato
    // Carta CUSTOM en un formato que no las admite (p.ej. un mazo Estándar): fuera.
    if (window.isCustomCard && window.isCustomCard(card)
        && !(window.isCustomAllowedIn && window.isCustomAllowedIn(card, window.formatIdOf(_mzEditDeck)))) {
      window.pbToast && window.pbToast(T('format.customNotAllowed', { name: window.cardName ? window.cardName(card) : card.name }));
      return 'banned';
    }
    // Ban list del formato: la carta no entra y se explica (el pulso rojo solo no dice por qué)
    if (window.isCardBanned && window.isCardBanned(card, window.formatIdOf(_mzEditDeck))) {
      window.pbToast && window.pbToast(T('format.banned', { name: window.cardName ? window.cardName(card) : card.name }));
      return 'banned';
    }
    _mzEditCards.push(Object.assign({}, card));
    renderDetailCards(_mzEditDeck); renderDetailStats(_mzEditDeck); _mzbUpdateBadges(); _mzPillRefresh(); _mzPinRefresh(); _mzDraftSave();
    if (window.playSound) { try { window.playSound('cardGrab'); } catch (e) {} }
    return 'added';
  }

  // Actualiza SOLO los badges +/(n) de los resultados visibles (sin re-render → conserva el scroll).
  function _mzbUpdateBadges() {
    if (!_mzbGrid) return;
    const inDeck = {};
    (_mzEditCards || []).forEach(c => { const k = c.name || c.id; inDeck[k] = (inDeck[k] || 0) + 1; });
    _mzbGrid.querySelectorAll('.cv-card-wrap').forEach(w => {
      const dc = inDeck[w.dataset.name] || 0;
      const btn = w.querySelector('.cv-card-add-row');
      if (btn) { btn.textContent = dc ? ('+ (' + dc + ')') : '+'; btn.classList.toggle('mzb-in', !!dc); }
    });
  }

  // Mis mazos: el mazo en la MISMA distribución apaisada (componente compartido)
  // Contador X/size del FORMATO (formats.js) en la cabecera de las cartas.
  // Verde = mazo válido y completo; rojo = te pasas o es inválido (con motivo en el tooltip);
  // neutro mientras construyes (n < size). Se re-calcula en cada render de las cartas.
  function _mzUpdateCounter(deck) {
    const el = document.getElementById('mz-deck-counter');
    if (!el || !deck) return;
    const editing = _mzEditing && _mzEditDeck === deck;
    el.style.display = editing ? 'inline-flex' : 'none';   // solo tiene sentido al EDITAR
    const cards = (editing ? _mzEditCards : deck.cards) || [];
    const fmtId = window.formatIdOf ? window.formatIdOf(deck) : undefined;
    const size = window.deckSizeFor ? window.deckSizeFor(deck) : 20;
    const n = cards.length;
    const nEl = document.getElementById('mz-deck-counter-n');
    const mEl = document.getElementById('mz-deck-counter-max');
    if (mEl) mEl.textContent = '/' + size;
    if (nEl) {
      const prev = parseInt(nEl.textContent, 10) || 0;
      nEl.textContent = String(n);
      // Color progresivo del contador del pop-up, escalado al tamaño del formato (20 ó 30).
      if (window.pbPillCountColor) nEl.style.color = window.pbPillCountColor(Math.round(n / size * 20));
      if (n !== prev) {   // «pop» del número, igual que en el pop-up
        nEl.classList.remove('bump');
        requestAnimationFrame(() => requestAnimationFrame(() => nEl.classList.add('bump')));
        setTimeout(() => nEl.classList.remove('bump'), 300);
      }
    }
    let ok = (n === size), title = '';
    if (window.validateDeckForFormat) {
      const v = window.validateDeckForFormat(cards, fmtId);
      ok = !!(v && v.ok);
      // El desajuste de tamaño ya lo dice el propio contador → en el tooltip solo los OTROS
      // motivos (copias de más, sin básico, baneada, custom…).
      const rs = (v && v.reasons || []).filter(r => r.k !== 'pvp.deckCount');
      if (rs.length) title = rs.map(r => T(r.k, r.vars)).join(' · ');
    }
    el.classList.toggle('mz-counter-ok', ok);
    el.classList.toggle('mz-counter-bad', !ok && n >= size);
    el.title = title;
  }

  function renderDetailCards(deck, animate) {
    const grid = document.getElementById('mz-cards-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const editing = _mzEditing && _mzEditDeck === deck;
    const cards = editing ? _mzEditCards : deck.cards;
    const dlOpts = { big: true, copyBadge: true };   // el nº de copias (1 y 2) sale por defecto
    if (editing) {
      dlOpts.edit = {
        onDelta: mzEditDelta, animateIn: !!animate,
        maxCopies: (window.maxCopiesFor ? window.maxCopiesFor(deck) : 2),
        // copias del NOMBRE en el mazo (el tope de Pocket es por nombre, no por impresión)
        nameCount: card => {
          const n = String((card && card.name) || '').toLowerCase();
          return n ? (_mzEditCards || []).filter(x => String(x.name || '').toLowerCase() === n).length : 0;
        },
      };
      // Huecos decorativos hasta el nº típico de cartas distintas del formato (20→14, 30→23).
      const size = window.deckSizeFor ? window.deckSizeFor(deck) : 20;
      dlOpts.padTo = Math.max(0, Math.round(size * 0.9 - 4));
    }
    // Mismo tamaño grande que el detalle meta (antes era ~la mitad y se veía pequeño)
    grid.appendChild(deckLayout(collapseCards(cards), dlOpts));
    mzHoldImages(grid);
    _mzUpdateCounter(deck);
  }

  function renderDetailStats(deck) {
    const cards = (_mzEditing && _mzEditDeck === deck ? _mzEditCards : deck.cards) || [];
    const total = cards.length;

    const pokeCards     = cards.filter(c => window.isPokemonCard(c));
    const trainerCards  = cards.filter(c => !pokeCards.includes(c));
    const pokeCount     = pokeCards.length;
    const trainerCount  = trainerCards.length;

    // Stage distribution
    let basics = 0, phase1 = 0, phase2 = 0;
    pokeCards.forEach(c => {
      const st = c.stage;
      if (st === 'basic' || st === 0 || st === '0') basics++;
      else if (st === 1 || st === '1') phase1++;
      else if (st === 2 || st === '2') phase2++;
      else basics++; // unknown defaults to basic
    });

    // Probabilidades de mano inicial (lo único que vive en este panel ahora)
    renderStartProbs(cards);

    // Stage
    const stageEl = document.getElementById('mz-stage-row');
    if (stageEl) {
      stageEl.innerHTML = '';
      if (basics)  stageEl.appendChild(makeStageBadge(T('mazos.basicCount', { n: basics })));
      if (phase1)  stageEl.appendChild(makeStageBadge(`Fase 1 ×${phase1}`));
      if (phase2)  stageEl.appendChild(makeStageBadge(`Fase 2 ×${phase2}`));
      if (!basics && !phase1 && !phase2) stageEl.innerHTML = '<span style="color:rgba(255,255,255,0.2);font-size:11px;">—</span>';
    }

    // Tipos de energía del mazo (los declarados/inferidos, como en Pocket): orbe real + nombre.
    // No es el elemento de cada Pokémon, sino los 1-3 tipos que el mazo lleva en la zona.
    const elRow = document.getElementById('mz-element-row');
    if (elRow) {
      elRow.innerHTML = '';
      const types = (deck.energyTypes && deck.energyTypes.length)
        ? deck.energyTypes.slice()
        : (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(cards)) : []);
      if (types.length) {
        types.forEach(el => {
          const dot = document.createElement('span');
          dot.className = 'mz-el-dot';
          const iconKey = window.ORB_ICON_KEY && window.ORB_ICON_KEY[el];
          const src = iconKey && ((window.ENERGY_ICONS && window.ENERGY_ICONS[iconKey]) || (window.ORB_ICONS && window.ORB_ICONS[iconKey]));
          const orb = src
            ? `<img class="mz-el-orb" src="${src}" alt="">`
            : `<span class="mz-el-dot-circle" style="background:${EL_COLORS[el] || '#888'}"></span>`;
          dot.innerHTML = orb + (window.elName ? window.elName(el) : el);
          elRow.appendChild(dot);
        });
      } else {
        elRow.innerHTML = '<span style="color:rgba(255,255,255,0.2);font-size:11px;">—</span>';
      }
    }
  }

  // ── Probabilidades de mano inicial (5 cartas, básico garantizado) ──
  // MODELO «reemplazo», que es como funciona Pocket de verdad (confirmado por el
  // estudio de machapin, 2.000 partidas jun-2025): se roban 5 cartas a pelo y,
  // SOLO si la mano no trae ningún básico, se cambia una carta por un básico al
  // azar del mazo (uniforme entre las COPIAS de básicos). NO reserva un hueco de
  // básico (ese modelo infla los básicos múltiples) NI re-baraja la mano entera
  // (mulligan). La garantía solo mueve masa del caso «0 básicos» al «exactamente 1».
  // Para cada básico único X (nx copias, B básicos totales, N cartas, mano de 5):
  //  · pZero    = C(N−B,5)/C(N,5)                     (mano natural sin básicos → se activa el reemplazo)
  //  · «en mano»  = [1 − C(N−nx,5)/C(N,5)] + pZero·(nx/B)
  //  · «único»    = [C(nx+(N−B),5) − C(N−B,5)]/C(N,5) + pZero·(nx/B)
  //    (natural con ≥1 X y ningún otro básico, o el reemplazo dejó X como único básico)
  function comb(n, k) {
    if (k < 0 || k > n) return 0;
    k = Math.min(k, n - k);
    let r = 1;
    for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
    return r;
  }

  function renderStartProbs(cards, targetEl) {
    const box = targetEl || document.getElementById('mz-start-probs');
    if (!box) return;
    box.innerHTML = '';
    const N = cards.length;
    const HAND = 5;
    if (N < HAND) {
      box.innerHTML = '<span class="mz-prob-empty">Mazo incompleto</span>';
      return;
    }

    // Básicos únicos con nº de copias e imagen
    const basicsMap = new Map(); // name → {count, image}
    cards.forEach(c => {
      if (!window.isBasicPokemon(c)) return;
      const k = c.name || c.image;
      if (!basicsMap.has(k)) basicsMap.set(k, { name: c.name || '?', count: 0, image: c.image || '' });
      basicsMap.get(k).count++;
    });
    const B = [...basicsMap.values()].reduce((s, b) => s + b.count, 0);
    if (B === 0) {
      box.innerHTML = '<span class="mz-prob-empty">' + T('mazos.noBasics') + '</span>';
      return;
    }

    const allHands   = comb(N, HAND);
    const NB         = N - B;                       // cartas no básicas
    const pZeroBasic = comb(NB, HAND) / allHands;   // prob. de robar 5 sin ningún básico (activa el reemplazo)

    const rows = [...basicsMap.values()].map(b => {
      const nx = b.count;
      const pReplaceX = pZeroBasic * (nx / B);      // si la mano sale sin básico, el reemplazo mete X (∝ copias)
      // En mano: X sale de forma natural en las 5, o la mano vino vacía y el reemplazo mete X
      const pAppear = (1 - comb(N - nx, HAND) / allHands) + pReplaceX;
      // Único básico: la mano natural trae ≥1 X y ningún otro básico, o el reemplazo dejó X solo
      const pForced = (comb(nx + NB, HAND) - comb(NB, HAND)) / allHands + pReplaceX;
      return { ...b, pAppear, pForced };
    }).sort((a, b) => b.pForced - a.pForced);

    rows.forEach(r => {
      const a = Math.round(r.pAppear * 100);
      const b = Math.round(r.pForced * 100);
      const nm = (window.cardName ? window.cardName(r) : r.name);
      const row = document.createElement('div');
      row.className = 'mz-prob-row';
      // Frase en lenguaje natural «1 de cada X partidas…» en el HOVER (tooltip data-mztip).
      // Click = zoom de la carta (ratón normal, como las cartas del mazo). Sin ⓘ ni tap-toggle.
      const oneIn = p => (p > 0 ? Math.max(1, Math.round(1 / p)) : 0);
      let tip = T('mazos.handTipAppear', { x: oneIn(r.pAppear), p: a, name: esc(nm) });
      if (b >= 1) tip += '<br>' + T('mazos.handTipForced', { x: oneIn(r.pForced), p: b, name: esc(nm) });
      row.setAttribute('data-mztip', tip);

      const thumb = document.createElement('div');
      thumb.className = 'mz-prob-thumb';
      const _rImg = window.cardImage ? window.cardImage(r) : r.image;
      if (_rImg) thumb.style.backgroundImage = `url("${_rImg}")`;

      const main = document.createElement('div');
      main.className = 'mz-prob-main';
      const name = document.createElement('span');
      name.className = 'mz-prob-name';
      name.textContent = nm + (r.count > 1 ? ' ×' + r.count : '');
      const vals = document.createElement('span');
      vals.className = 'mz-prob-vals';
      vals.innerHTML = T('mazos.probInHandForced', { a: a, b: b });
      main.appendChild(name);
      main.appendChild(vals);

      if (_rImg && window.openZoomFromImage) {
        thumb.addEventListener('click', () => window.openZoomFromImage(_rImg, thumb));
      }

      row.appendChild(thumb);
      row.appendChild(main);
      box.appendChild(row);
    });
  }

  // ── Calculadora por turno: simulación Monte Carlo con cartas de robo ──
  // Modelo: mano inicial «reemplazo» (roba 5, si no hay básico cambia una carta
  // por un básico ∝ copias) + 1 robo por turno (el turno 1
  // también roba). Cada turno se juegan todas las Poké Ball (básico aleatorio
  // del mazo) y un solo Professor's Research (roba 2) — supporter por turno.
  const TURN_SIM_TURNS = 5;
  const TURN_SIM_ITERS = 6000;

  function simTurnProbs(cards, targetName) {
    const tpl = cards.map(c => ({
      name: c.name || '',
      basic: window.isBasicPokemon(c),
      research: /^professor'?s research$/i.test(c.name || ''),
      ball: /^pok[eé] ball$/i.test(c.name || '')
    }));
    const basics = tpl.map((c, i) => c.basic ? i : -1).filter(i => i !== -1);
    if (!basics.length) return null;
    const hits = new Array(TURN_SIM_TURNS + 1).fill(0);

    for (let it = 0; it < TURN_SIM_ITERS; it++) {
      let found = false;
      const hand = [];
      function take(i) {
        if (!found && tpl[i].name === targetName) found = true;
        hand.push(i);
      }
      // mano inicial, modelo «reemplazo»: robar 5 a pelo; si no hay básico,
      // cambiar una carta al azar por un básico al azar del mazo (∝ copias)
      const deck = [];
      for (let i = 0; i < tpl.length; i++) deck.push(i);
      for (let i = deck.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t;
      }
      const opening = [];
      for (let k = 0; k < 5; k++) opening.push(deck.pop());
      if (!opening.some(i => tpl[i].basic)) {
        const bIdx = [];
        for (let k = 0; k < deck.length; k++) if (tpl[deck[k]].basic) bIdx.push(k);
        if (bIdx.length) {
          const basicCard = deck.splice(bIdx[(Math.random() * bIdx.length) | 0], 1)[0];
          const swapOut = (Math.random() * opening.length) | 0;
          deck.splice((Math.random() * (deck.length + 1)) | 0, 0, opening[swapOut]); // la cambiada vuelve al mazo
          opening[swapOut] = basicCard;
        }
      }
      opening.forEach(i => take(i));
      if (found) hits[0]++;

      for (let t = 1; t <= TURN_SIM_TURNS; t++) {
        if (deck.length) take(deck.pop());
        // jugar cartas de robo de la mano
        let researchUsed = false;
        let again = true;
        while (again) {
          again = false;
          for (let h = 0; h < hand.length; h++) {
            const c = tpl[hand[h]];
            if (c.ball) {
              hand.splice(h, 1);
              const bIdx = [];
              for (let k = 0; k < deck.length; k++) if (tpl[deck[k]].basic) bIdx.push(k);
              if (bIdx.length) take(deck.splice(bIdx[(Math.random() * bIdx.length) | 0], 1)[0]);
              again = true; break;
            }
            if (c.research && !researchUsed) {
              hand.splice(h, 1);
              researchUsed = true;
              if (deck.length) take(deck.pop());
              if (deck.length) take(deck.pop());
              again = true; break;
            }
          }
        }
        if (found) hits[t]++;
      }
    }
    return hits.map(h => h / TURN_SIM_ITERS);
  }

  function renderTurnCalc(cards, targetEl) {
    const box = targetEl || document.getElementById('mz-turn-calc');
    if (!box) return;
    box.innerHTML = '';
    if (cards.length < 5 || !cards.some(c => window.isBasicPokemon(c))) {
      box.innerHTML = '<span class="mz-prob-empty">Mazo incompleto</span>';
      return;
    }
    // cartas únicas del mazo
    const seen = new Set();
    const unique = [];
    cards.forEach(c => {
      const k = c.name || c.image;
      if (!seen.has(k)) { seen.add(k); unique.push(c); }
    });

    const sel = document.createElement('select');
    sel.className = 'mz-turn-select';
    unique.forEach(c => {
      const o = document.createElement('option');
      o.value = c.name;
      o.textContent = (window.cardName ? window.cardName(c) : c.name);
      sel.appendChild(o);
    });

    const chart = document.createElement('div');
    chart.className = 'mz-turn2-chart';

    function run() {
      const probs = simTurnProbs(cards, sel.value);
      chart.innerHTML = probs ? buildTurnChart(probs) : '';
    }
    sel.addEventListener('change', run);
    box.appendChild(sel);
    box.appendChild(chart);
    run();
  }

  // Curva acumulada Inicial→T5 (más clara que 6 cifras sueltas): área + línea + puntos,
  // con guía al 50% y resaltado del turno en que cruza el 50% (o el último si no llega).
  function buildTurnChart(probs) {
    const labels = [T('mazos.turnInitial'), 'T1', 'T2', 'T3', 'T4', 'T5'];
    const n = probs.length;
    const W = 300, H = 98, padL = 16, padR = 12, top = 16, bot = 66;
    const X = i => padL + i * ((W - padL - padR) / (n - 1));
    const Y = p => bot - p * (bot - top);
    const pts = probs.map((p, i) => [X(i), Y(p)]);
    const line = pts.map((pt, i) => (i ? 'L' : 'M') + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ');
    const area = `M${X(0).toFixed(1)} ${bot} ` + pts.map(pt => 'L' + pt[0].toFixed(1) + ' ' + pt[1].toFixed(1)).join(' ') + ` L${X(n - 1).toFixed(1)} ${bot} Z`;
    let keyI = probs.findIndex(p => p >= 0.5); if (keyI < 0) keyI = n - 1;
    const marks = pts.map((pt, i) => {
      const k = i === keyI;
      const tip = i === 0 ? T('mazos.probInitialHand', { p: Math.round(probs[i] * 100) })
                          : T('mazos.probByTurn', { p: Math.round(probs[i] * 100), n: i });
      return `<circle cx="${pt[0].toFixed(1)}" cy="${pt[1].toFixed(1)}" r="${k ? 4 : 2.6}" class="mz-tc-dot${k ? ' key' : ''}"><title>${esc(tip)}</title></circle>` +
             `<text x="${pt[0].toFixed(1)}" y="${(pt[1] - 7).toFixed(1)}" class="mz-tc-pct${k ? ' key' : ''}" text-anchor="middle">${Math.round(probs[i] * 100)}%</text>` +
             `<text x="${pt[0].toFixed(1)}" y="${H - 5}" class="mz-tc-lbl${k ? ' key' : ''}" text-anchor="middle">${esc(labels[i])}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" class="mz-tc-svg">
      <defs><linearGradient id="mzTcG" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="rgba(95,214,138,0.4)"/><stop offset="1" stop-color="rgba(95,214,138,0)"/>
      </linearGradient></defs>
      <line x1="${padL}" y1="${Y(0.5).toFixed(1)}" x2="${W - padR}" y2="${Y(0.5).toFixed(1)}" class="mz-tc-mid"/>
      <text x="${W - padR}" y="${(Y(0.5) - 2).toFixed(1)}" class="mz-tc-midlbl" text-anchor="end">50%</text>
      <path d="${area}" fill="url(#mzTcG)"/>
      <path d="${line}" class="mz-tc-line" fill="none"/>
      ${marks}
    </svg>`;
  }

  function setStatVal(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function makeStageBadge(text) {
    const el = document.createElement('span');
    el.className = 'mz-stage-badge';
    el.textContent = text;
    return el;
  }

  // Marca un mazo de la biblioteca como MAZO ACTIVO (el que usa el hub «Jugar»).
  // Si ya lo era no hace nada: el verde es indicador de estado, no un conmutador.
  // Devuelve true si cambió (para saber si hay que re-pintar).
  function activateDeck(deck, onDone) {
    if (!deck || deck._isMeta) return false;
    const activeId = window._pbActiveDeckId ? window._pbActiveDeckId() : null;
    if (activeId != null && String(deck.id) === String(activeId)) return false;
    if (window._pbSetActiveDeck) window._pbSetActiveDeck(deck.id);
    window.sfx && window.sfx('mazos.play');
    window.pbToast && window.pbToast(T('mazos.activated', { name: deck.name || T('mazos.noName') }));
    if (onDone) onDone();
    return true;
  }

  function wireDetailActions(deck, idx) {
    const editarBtn   = document.getElementById('mz-detail-editar');
    const exportarBtn = document.getElementById('mz-detail-exportar');
    const eliminarBtn = document.getElementById('mz-detail-eliminar');
    const guardarBtn  = document.getElementById('mz-detail-guardar');
    const qrBtn       = document.getElementById('mz-detail-qr');
    const activarBtn  = document.getElementById('mz-detail-activar');
    const isMeta = !!deck._isMeta;

    // ── Modo EDICIÓN en sitio: solo «Guardar cambios» / «Cancelar» ──
    const _editingThis = _mzEditing && _mzEditDeck === deck;
    if (_editingThis) {
      // «Volver» (izquierda) YA hace de Cancelar (descarta y vuelve) → NO se pone una X aparte.
      // Solo se añade «Guardar cambios» a la derecha. Se oculta todo el grupo de acciones.
      const actions = document.getElementById('mz-detail-actions'); if (actions) actions.style.display = 'none';
      const header = document.getElementById('mz-detail-header');
      if (header && !document.getElementById('mz-detail-save-edit')) {
        const _SAVE_SVG = '<svg viewBox="0 0 16 16" fill="none"><path d="M3.2 2.2h7.4l3.2 3.2v7.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.8 13.7V8.8h6.4v4.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.7 2.6V5.3H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        const sv = document.createElement('button');
        sv.id = 'mz-detail-save-edit'; sv.className = 'mz-detail-btn mz-save-edit';
        // (el contador, a su izquierda, lleva el margin-left:auto que empuja el grupo a la derecha)
        sv.innerHTML = _SAVE_SVG + '<span>' + T('mazos.saveChanges') + '</span>';
        sv.onclick = () => { window.sfx && window.sfx('mazos.edit'); exitDeckEdit(true); };
        header.appendChild(_mzMakePinBtn());
        header.appendChild(sv);
      }
      _mzApplyPin();
      return;
    }
    // Salida de edición: restaurar «Volver», quitar los botones dinámicos + restaurar el grupo de acciones.
    const _back = document.getElementById('mz-back-btn'); if (_back) _back.style.display = '';
    ['mz-detail-save-edit', 'mz-pin-btn'].forEach(id => { const e = document.getElementById(id); if (e) e.remove(); });
    const _act = document.getElementById('mz-detail-actions'); if (_act) _act.style.display = isMeta ? 'none' : '';
    const _feat = document.getElementById('mz-featured-btn'); if (_feat) _feat.style.display = isMeta ? 'none' : '';

    // «Activar mazo» (modelo TCG Live): solo mazos propios; marca el mazo activo del hub «Jugar».
    if (activarBtn) {
      activarBtn.style.display = isMeta ? 'none' : '';
      const activeId = window._pbActiveDeckId ? window._pbActiveDeckId() : null;
      const isActive = !isMeta && activeId != null && String(deck.id) === String(activeId);
      activarBtn.classList.toggle('is-active', isActive);
      const lbl = activarBtn.querySelector('span');
      if (lbl) lbl.textContent = T(isActive ? 'mazos.activeDeck' : 'mazos.activate');
      activarBtn.onclick = () => activateDeck(deck, () => wireDetailActions(deck, idx));
    }

    // Un mazo del meta no se edita ni se elimina (no está en la biblioteca):
    // se Guarda en Mis Mazos, se Comparte y se exporta.
    if (editarBtn)   editarBtn.style.display   = isMeta ? 'none' : '';
    if (eliminarBtn) eliminarBtn.style.display = isMeta ? 'none' : '';
    if (guardarBtn)  guardarBtn.style.display  = isMeta ? '' : 'none';

    if (editarBtn)   editarBtn.onclick   = () => { window.sfx && window.sfx('mazos.edit'); enterDeckEdit(deck, idx, 'detail'); };
    if (exportarBtn) exportarBtn.onclick = () => { window.sfx && window.sfx('mazos.export'); exportDeckImage(deck); };
    if (eliminarBtn) eliminarBtn.onclick = () => { window.sfx && window.sfx('mazos.delete'); confirmDelete(deck, idx); };
    if (guardarBtn)  guardarBtn.onclick  = () => saveMetaToLibrary(deck);
    // Código 2D compatible con Pocket (solo si el módulo está cargado)
    if (qrBtn) {
      qrBtn.style.display = window.pbDeckQR ? '' : 'none';
      qrBtn.onclick = () => { if (window.pbDeckQR) window.pbDeckQR.show(deck); };
    }
  }

  // ── Deck actions ──────────────────────────────────────────────
  // Carga un mazo de la biblioteca en el builder del jugador (compartido por
  // Probar y Editar). Resetea la cola de juego barajada: si no, un robo
  // posterior seguiría sacando cartas del mazo anterior.
  function loadDeckIntoBuilder(deck, pl) {
    const customs = loadTempCards();
    if (window.deckQueues) {
      window.deckQueues[pl].length = 0;
      (deck.cards || []).forEach(c => {
        if (window._fixCardType) window._fixCardType(c);
        if (c._temp && !c.image) {
          const ref = customs.find(x => x.id === c.id);
          if (ref) c.image = ref.image;
        }
        window.deckQueues[pl].push(c);
      });
    }
    if (window.deckPlayQueues) window.deckPlayQueues[pl] = null;
    if (window.deckEnergyTypes && deck.energyTypes) {
      window.deckEnergyTypes[pl] = new Set(deck.energyTypes);
    }
    if (!window._deckNames) window._deckNames = { p1: '', p2: '' };
    window._deckNames[pl] = deck.name || '';
    // FORMATO del mazo cargado en este lado (Estándar 20 / Avanzado 30). El tablero lo lee
    // para el marcador (3/4 puntos), la mano inicial (5/6) y el tope del builder de la sidebar.
    window._deckFormats = window._deckFormats || { p1: null, p2: null };
    window._deckFormats[pl] = window.formatIdOf ? window.formatIdOf(deck) : 'standard';
    // Fuera de partida, el marcador ya enseña los puntos del formato elegido (3 o 4).
    if (!window._pbGameStarted && window._pbSetGameFormat && window._pbFormatFromDecks) {
      window._pbSetGameFormat(window._pbFormatFromDecks());
    }
    // Portada canónica del mazo elegido (protagonista curado del meta / thumbnail), para que
    // el selector VS muestre LA MISMA carta que la lista. Si sólo reconstruye por cartas, la
    // heurística de deckProtagonist elige otra (EX/Mega) y la miniatura «cambia» al confirmar.
    window._deckCovers = window._deckCovers || { p1: '', p2: '' };
    window._deckCovers[pl] = deckCover(deck);
    // Cartas destacadas (2-3) → el preview VS también compone las bandas
    window._deckFeatured = window._deckFeatured || { p1: null, p2: null };
    const featured = featuredForCards(deck);
    window._deckFeatured[pl] = featured.length >= 2 ? featured : null;
    // Se cargó un mazo CONCRETO en este lado → deja de ser "aleatorio" (el pick aleatorio y el
    // re-tirado lo vuelven a marcar después). Así elegir un mazo concreto para J2 apaga el modo random.
    window._pbSideRandom = window._pbSideRandom || { p1: false, p2: false };
    window._pbSideRandom[pl] = false;
    if (window.switchDeckTab) window.switchDeckTab(pl);
    if (window.buildEnergyToggles) window.buildEnergyToggles();
  }

  // (El viejo «Probar en tablero» —cargar el mazo en J1 y abrir el selector X-vs-Y— se
  // retiró: el play de Mis Mazos ahora ACTIVA el mazo. Para jugar en local se entra por
  // el hub «Jugar» → Tablero libre, que ya trae su propio selector de inicio.)

  // Carta "protagonista" de un mazo (la identidad del mazo, para la portada).
  // Meta: usa el protagonista curado del pipeline. Mis Mazos (sin datos de consenso):
  // heurística = EX/Mega primero → fase más alta → más HP.
  function deckProtagonist(deck) {
    const cards = (deck && deck.cards) || [];
    const pk = cards.filter(c => window.isPokemonCard && window.isPokemonCard(c));
    if (!pk.length) return cards[0] || null;
    const stageRank = c => (c.stage === 2 || c.stage === '2') ? 2 : ((c.stage === 1 || c.stage === '1') ? 1 : 0);
    const isEx = c => /\bex\b/i.test(c.name || '');
    return pk.slice().sort((a, b) => {
      const ae = isEx(a) ? 1 : 0, be = isEx(b) ? 1 : 0;
      if (ae !== be) return be - ae;
      const as = stageRank(a), bs = stageRank(b);
      if (as !== bs) return bs - as;
      return (Number(b.health) || 0) - (Number(a.health) || 0);
    })[0];
  }

  // Mantiene la selección dentro de la composición REAL del mazo. Se comparan
  // tanto las imágenes guardadas como las actuales de la DB para no invalidar una
  // carta que sigue presente si su proveedor cambió de URL entre versiones.
  function featuredForCards(deck, cards) {
    const allowed = new Set();
    const currentById = new Map();
    const idBySavedImage = new Map();
    const sourceCards = [];
    if (Array.isArray(cards)) sourceCards.push(...cards);
    if (deck && Array.isArray(deck.cards) && deck.cards !== cards) sourceCards.push(...deck.cards);
    sourceCards.forEach(c => {
      if (!c) return;
      if (c.image) allowed.add(c.image);
      const db = window.dbLookup ? window.dbLookup(c) : null;
      if (db && db.image) allowed.add(db.image);
      const id = c.id || (db && db.id) || (window.cardIdFromImage && window.cardIdFromImage(c.image || ''));
      const current = (db && db.image) || c.image || '';
      if (id && current) currentById.set(id, current);
      if (id && c.image) idBySavedImage.set(c.image, id);
    });
    const seen = new Set();
    const out = [];
    ((deck && Array.isArray(deck.featured)) ? deck.featured : []).forEach(src => {
      if (!src || out.length >= 3) return;
      // La URL puede ser la del proveedor anterior. Recupera su ID estable y
      // migra la selección al arte canónico actual de ESA misma carta.
      const oldDb = window.dbLookup ? window.dbLookup({ image: src }) : null;
      const id = (oldDb && oldDb.id) || (window.cardIdFromImage && window.cardIdFromImage(src)) || idBySavedImage.get(src);
      const normalized = (id && currentById.get(id)) || (allowed.has(src) ? src : '');
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      out.push(normalized);
    });
    return out;
  }

  function deckCover(deck) {
    const featured = featuredForCards(deck);
    if (featured.length) {
      return window.localizeImg ? window.localizeImg(featured[0]) : featured[0];
    }
    if (deck && deck.thumbnailImg) return window.localizeImg ? window.localizeImg(deck.thumbnailImg) : deck.thumbnailImg;
    // Meta: protagonista curado por el pipeline
    if (deck && deck._meta && deck._meta.protagonists && deck._meta.protagonists[0]) {
      const c = metaCardById(deck._meta.protagonists[0]);
      if (c) return (window.cardImage ? window.cardImage(c) : c.image) || '';
    }
    const prot = deckProtagonist(deck);
    const protImg = prot && (window.cardImage ? window.cardImage(prot) : prot.image);
    return protImg || deck.firstCardImg ||
      (deck.cards && deck.cards[0] && deck.cards[0].image) || '';
  }

  /* ══════════════════════════════════════════════════════════════════════
     CARTAS DESTACADAS (portada compuesta) — BLOQUE AISLADO, fácil de revertir.
     Guarda `deck.featured` = 1-3 URLs canónicas. La miniatura se compone en
     bandas (mitad superior de cada carta, estilo tierlist). Para revertir:
     borrar este bloque, la rama `deck.featured` de deckCover, la llamada a
     paintDeckThumb (usar deckCover) y el botón «Cartas destacadas» del detalle.
     ══════════════════════════════════════════════════════════════════════ */

  // Imágenes destacadas localizadas (1-3). Si no hay featured → la portada única.
  function featuredImages(deck) {
    const featured = featuredForCards(deck);
    if (featured.length) {
      return featured.map(u => (window.localizeImg ? window.localizeImg(u) : u));
    }
    const c = deckCover(deck);
    return c ? [c] : [];
  }

  // Posición vertical del recorte de cada banda según cuántas cartas haya.
  // 1 = carta completa (cover). 2 = mitad superior (center top). 3 = el MISMO
  // recorte centrado en las 3 bandas (que las 3 muestren el mismo trozo del arte,
  // como la banda central, sin borde de más arriba/abajo).
  const _BAND_POS = { 2: ['center top', 'center top'], 3: ['center 22%', 'center 22%', 'center 22%'] };

  function paintDeckThumb(front, deck) {
    front.classList.remove('mz-stack-front-empty');
    front.style.backgroundImage = '';
    front.innerHTML = '';
    const imgs = featuredImages(deck);
    if (!imgs.length) {
      front.classList.add('mz-stack-front-empty');
      front.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="13" height="18" rx="2" stroke="currentColor" stroke-width="1.4"/><rect x="5" y="2" width="13" height="18" rx="2" stroke="currentColor" stroke-width="1.4" fill="#111118"/><rect x="7" y="1" width="13" height="18" rx="2" stroke="currentColor" stroke-width="1.4" fill="#1a1a28"/></svg>';
      return;
    }
    if (imgs.length === 1) { front.style.backgroundImage = `url("${imgs[0]}")`; return; }
    const pos = _BAND_POS[imgs.length] || _BAND_POS[2];
    const bands = document.createElement('div');
    bands.className = 'mz-thumb-bands';
    imgs.forEach((src, i) => {
      const b = document.createElement('div');
      b.className = 'mz-thumb-band';
      b.style.backgroundImage = `url("${src}")`;
      b.style.backgroundPosition = pos[i] || 'center top';
      bands.appendChild(b);
    });
    front.appendChild(bands);
  }

  // ── Selector «Cartas destacadas» (hasta 3, con nº y tinte) ──
  let _featSel = [];   // URLs canónicas seleccionadas (en orden)
  function openFeaturedPicker(deck, idx) {
    closeFeaturedPicker();
    // Cartas del mazo, ÚNICAS y en orden canónico (Pokémon por fase, luego trainers).
    const uniq = collapseCards(deck.cards);   // [{id,count}]
    const cards = uniq.map(u => (window.dbLookup ? window.dbLookup({ id: u.id }) : null)).filter(c => c && c.image);
    if (!cards.length) return;
    // Defensa para mazos que ya estaban guardados con una selección huérfana:
    // al abrir/cerrar el selector se reparan sin tener que volver a meter la carta.
    _featSel = featuredForCards(deck, cards);

    const modal = document.createElement('div');
    modal.id = 'mz-feat-modal'; modal.className = 'mz-feat-modal';
    const sheet = document.createElement('div');
    sheet.className = 'mz-feat-sheet';
    const title = document.createElement('div');
    title.className = 'mz-feat-title';
    title.textContent = T('mazos.featuredTitle');
    const grid = document.createElement('div');
    grid.className = 'mz-feat-grid';

    function renderNums() {
      grid.querySelectorAll('.mz-feat-card').forEach(cell => {
        const src = cell.dataset.src;
        const n = _featSel.indexOf(src);
        cell.classList.toggle('sel', n >= 0);
        const badge = cell.querySelector('.mz-feat-num');
        if (n >= 0) { badge.textContent = (n + 1); badge.style.display = 'flex'; }
        else badge.style.display = 'none';
      });
    }
    cards.forEach(c => {
      const src = c.image;                       // URL canónica (se guarda así)
      const cell = document.createElement('div');
      cell.className = 'mz-feat-card'; cell.dataset.src = src;
      const im = document.createElement('img');
      im.src = (window.localizeImg ? window.localizeImg(src) : src);
      im.alt = ''; im.draggable = false; im.loading = 'lazy';
      im.onerror = () => { im.style.visibility = 'hidden'; };
      const badge = document.createElement('div');
      badge.className = 'mz-feat-num'; badge.style.display = 'none';
      cell.appendChild(im); cell.appendChild(badge);
      cell.addEventListener('click', () => {
        const at = _featSel.indexOf(src);
        if (at >= 0) _featSel.splice(at, 1);       // quitar (renumera)
        else if (_featSel.length < 3) _featSel.push(src);
        else return;                                // ya hay 3
        renderNums();
      });
      grid.appendChild(cell);
    });
    renderNums();

    const done = document.createElement('button');
    done.className = 'mz-feat-done'; done.type = 'button';
    done.setAttribute('aria-label', T('mazos.featuredDone'));
    done.innerHTML = '<svg viewBox="0 0 24 24" fill="none"><line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
    done.addEventListener('click', () => saveFeatured(deck, idx));

    sheet.appendChild(title); sheet.appendChild(grid);
    modal.appendChild(sheet); modal.appendChild(done);
    modal.addEventListener('pointerdown', e => { if (e.target === modal) saveFeatured(deck, idx); });
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    modal._esc = e => { if (e.key === 'Escape') { e.stopPropagation(); saveFeatured(deck, idx); } };
    document.addEventListener('keydown', modal._esc, true);
  }

  function saveFeatured(deck, idx) {
    deck.featured = featuredForCards({ featured: _featSel, cards: deck.cards });
    const lib = loadLibrary();
    const i = libIndexOf(lib, deck, idx);
    if (i !== -1) { lib[i].featured = deck.featured.slice(); saveLibrary(lib); }
    closeFeaturedPicker();
    // Re-pinta la energía+botón de la cabecera y, al volver, el grid mostrará la nueva portada.
    if (window.sfx) window.sfx('mazos.edit');
  }

  function closeFeaturedPicker() {
    const m = document.getElementById('mz-feat-modal');
    if (!m) return;
    if (m._esc) document.removeEventListener('keydown', m._esc, true);
    m.remove();
  }
  /* ════════════════════════ fin CARTAS DESTACADAS ════════════════════════ */

  // ── Mantener pulsado un mazo (selector de partida) = verlo completo ──
  function attachDeckPeek(el, deck) {
    let timer = null, sx = 0, sy = 0, fired = false;
    const clear = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', e => {
      if (e.button && e.button !== 0) return;
      sx = e.clientX; sy = e.clientY; fired = false;
      timer = setTimeout(() => { fired = true; openDeckCardsView(deck); }, 480);
    });
    el.addEventListener('pointermove', e => {
      if (timer && (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10)) clear();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => el.addEventListener(ev, clear));
    // Si el hold abrió la vista, suprime el clic (que seleccionaría el mazo)
    el.addEventListener('click', e => { if (fired) { e.stopPropagation(); e.preventDefault(); fired = false; } }, true);
  }

  // Vista rápida de las cartas de un mazo (mismo approach que ver un mazo en la tierlist)
  function openDeckCardsView(deck) {
    closeDeckCardsView();
    const cards = collapseCards(deck.cards);
    const modal = document.createElement('div');
    modal.id = 'mz-dv-modal'; modal.className = 'mz-dv-modal';
    const panel = document.createElement('div'); panel.className = 'mz-dv-panel';
    const head = document.createElement('div'); head.className = 'mz-dv-head';
    const ttl = document.createElement('div'); ttl.className = 'mz-dv-title'; ttl.textContent = deck.name || T('mazos.noName');
    const close = document.createElement('button'); close.className = 'mz-dv-close'; close.type = 'button'; close.textContent = '✕';
    close.setAttribute('aria-label', T('common.cancel'));
    close.addEventListener('click', closeDeckCardsView);
    head.appendChild(ttl); head.appendChild(close);
    const grid = document.createElement('div'); grid.className = 'mz-dv-grid';
    cards.forEach(c => {
      const card = window.dbLookup ? window.dbLookup({ id: c.id }) : null;
      if (!card || !card.image) return;
      const cell = document.createElement('div'); cell.className = 'mz-dv-card';
      const im = document.createElement('img');
      im.src = window.cardImage ? window.cardImage(card) : card.image;
      im.alt = ''; im.draggable = false; im.loading = 'lazy';
      cell.appendChild(im);
      if ((c.count || 1) > 1) { const b = document.createElement('span'); b.className = 'mz-dv-count'; b.textContent = '×' + c.count; cell.appendChild(b); }
      cell.addEventListener('click', () => { if (window.openZoomFromImage) window.openZoomFromImage(im.src, cell, { rarity: card.rarity }); });
      grid.appendChild(cell);
    });
    panel.appendChild(head); panel.appendChild(grid);
    modal.appendChild(panel);
    modal.addEventListener('pointerdown', e => { if (e.target === modal) closeDeckCardsView(); });
    document.body.appendChild(modal);
    requestAnimationFrame(() => modal.classList.add('open'));
    modal._esc = e => { if (e.key === 'Escape') { e.stopPropagation(); closeDeckCardsView(); } };
    document.addEventListener('keydown', modal._esc, true);
  }
  function closeDeckCardsView() {
    const m = document.getElementById('mz-dv-modal'); if (!m) return;
    if (m._esc) document.removeEventListener('keydown', m._esc, true);
    m.classList.remove('open'); setTimeout(() => { if (m.parentNode) m.remove(); }, 160);
  }

  // ── Selector de mazo rival (siempre, con override de J2) ──
  function openRivalPicker(playerDeck) {
    if (window._preloadCardDB) window._preloadCardDB(); // por si Aleatorio necesita la DB
    const lib = loadLibrary();
    const p2deck = (window.deckQueues && window.deckQueues.p2) || [];
    const p2HasDeck = p2deck.length >= 5;

    const overlay = document.createElement('div');
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal mz-rival-modal';

    const title = document.createElement('div');
    title.className = 'pb-modal-title mz-rival-title';
    title.textContent = 'Elige el mazo rival';
    const msg = document.createElement('div');
    msg.className = 'pb-modal-msg mz-rival-sub-head';
    msg.textContent = T('mazos.willPlayAsP1', { name: playerDeck.name || T('mazos.yourDeck') });

    const grid = document.createElement('div');
    grid.className = 'mz-rival-grid';

    let selection = null; // {kind:'deck',deck} | {kind:'random'} | {kind:'keep'}
    const playBtn = document.createElement('button');

    function select(el, sel) {
      grid.querySelectorAll('.mz-rival-opt.sel').forEach(o => o.classList.remove('sel'));
      el.classList.add('sel');
      selection = sel;
      playBtn.disabled = false;
    }

    // Cápsula horizontal: stack de cartas (como en Mis Mazos de la sidebar)
    // + nombre completo + info secundaria
    function makeOpt(label, sublabel, coverImg, sel, disabled, emoji) {
      const opt = document.createElement('button');
      opt.className = 'mz-rival-opt';
      if (disabled) { opt.classList.add('disabled'); opt.disabled = true; }

      const stack = document.createElement('div');
      stack.className = 'mz-rival-stack';
      const backImg = window.CARD_BACK_IMG ? 'url(' + window.CARD_BACK_IMG + ')' : '';
      [3, 2, 1].forEach(n => {
        const b = document.createElement('div');
        b.className = 'mzr-back mzr-back-' + n;
        if (backImg) b.style.backgroundImage = backImg;
        stack.appendChild(b);
      });
      const front = document.createElement('div');
      front.className = 'mzr-front';
      if (coverImg) front.style.backgroundImage = 'url(' + coverImg + ')';
      else { front.classList.add('mzr-front-empty'); front.textContent = emoji || ''; }
      stack.appendChild(front);

      const txt = document.createElement('div');
      txt.className = 'mz-rival-txt';
      const nm = document.createElement('div');
      nm.className = 'mz-rival-name';
      nm.textContent = label;
      txt.appendChild(nm);
      if (sublabel) {
        const sb = document.createElement('div');
        sb.className = 'mz-rival-sub';
        sb.textContent = sublabel;
        txt.appendChild(sb);
      }

      opt.appendChild(stack);
      opt.appendChild(txt);
      if (!disabled) opt.onclick = () => select(opt, sel);
      return opt;
    }

    // Mazo actual de J2 (si lo tiene) — preseleccionado
    let keepOpt = null;
    if (p2HasDeck) {
      keepOpt = makeOpt('Mazo actual de J2', p2deck.length + ' cartas', p2deck[0] && p2deck[0].image, { kind: 'keep' });
      grid.appendChild(keepOpt);
    }
    // Aleatorio
    const rndOpt = makeOpt('Aleatorio', 'Mazo generado al azar', '', { kind: 'random' }, false, '🎲');
    grid.appendChild(rndOpt);
    // Biblioteca
    lib.forEach(d => {
      const incomplete = !d.cards || d.cards.length < 5;
      grid.appendChild(makeOpt(d.name || 'Sin nombre',
        incomplete ? 'Incompleto' : (d.cards.length + ' cartas'),
        deckCover(d), { kind: 'deck', deck: d }, incomplete));
    });

    const actions = document.createElement('div');
    actions.className = 'pb-modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'pb-btn';
    cancel.textContent = T('common.cancel');
    playBtn.className = 'pb-btn pb-btn-primary';
    playBtn.textContent = 'Jugar';
    playBtn.disabled = true;

    function close() { document.removeEventListener('keydown', _esc, true); overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 180); }
    function _esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }   // Escape = cancelar
    document.addEventListener('keydown', _esc, true);
    cancel.onclick = close;
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    playBtn.onclick = () => {
      if (!selection) return;
      close();
      loadDeckIntoBuilder(playerDeck, 'p1');
      const begin = (rivalName, rivalImg) => {
        playVersusIntro(
          { name: playerDeck.name || 'J1', img: deckCover(playerDeck) },
          { name: rivalName, img: rivalImg },
          () => {
            window.switchAppTab('board');
            setTimeout(() => { window.quickStartGame && window.quickStartGame(); }, 150);
          }
        );
      };
      if (selection.kind === 'deck') {
        loadDeckIntoBuilder(selection.deck, 'p2');
        if (window.switchDeckTab) window.switchDeckTab('p1');
        begin(selection.deck.name || 'Rival', deckCover(selection.deck));
      } else if (selection.kind === 'keep') {
        begin('Mazo de J2', (p2deck[0] && p2deck[0].image) || '');
      } else {
        // Aleatorio: randomizeDeck opera sobre el tab activo
        if (window.switchDeckTab) window.switchDeckTab('p2');
        if (window.deckPlayQueues) window.deckPlayQueues.p2 = null;
        window.randomizeDeck && window.randomizeDeck(() => {
          const d2 = (window.deckQueues && window.deckQueues.p2) || [];
          if (window.switchDeckTab) window.switchDeckTab('p1');
          begin('Mazo aleatorio', (d2[0] && d2[0].image) || '');
        });
      }
    };

    actions.appendChild(cancel);
    actions.appendChild(playBtn);
    box.appendChild(title);
    box.appendChild(msg);
    box.appendChild(grid);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    // Preselección: mazo actual de J2 si existe, si no Aleatorio
    if (keepOpt) select(keepOpt, { kind: 'keep' });
    else select(rndOpt, { kind: 'random' });
  }

  // ── Intro «VS» — minimalista, mismo lenguaje que el coinflip 2D ──
  function playVersusIntro(p1, p2, done) {
    const ov = document.createElement('div');
    ov.id = 'vs-overlay';
    ov.innerHTML =
      '<div class="vs-side vs-left">' +
      '  <div class="vs-cover"></div><div class="vs-name vs-name-p1"></div>' +
      '</div>' +
      '<div class="vs-text">VS</div>' +
      '<div class="vs-side vs-right">' +
      '  <div class="vs-cover"></div><div class="vs-name vs-name-p2"></div>' +
      '</div>';
    const covers = ov.querySelectorAll('.vs-cover');
    if (p1.img) covers[0].style.backgroundImage = 'url(' + p1.img + ')';
    if (p2.img) covers[1].style.backgroundImage = 'url(' + p2.img + ')';
    ov.querySelector('.vs-name-p1').textContent = p1.name || 'J1';
    ov.querySelector('.vs-name-p2').textContent = p2.name || 'J2';
    document.body.appendChild(ov);
    window.playSound && window.playSound('notification');
    requestAnimationFrame(() => ov.classList.add('in'));
    setTimeout(() => ov.classList.add('out'), 1500);
    setTimeout(() => { ov.remove(); done && done(); }, 1850);
  }

  // ════ Selector de inicio X-vs-Y (vertical) ════
  // Vuelve a tirar un mazo meta al azar para cada lado marcado como "aleatorio", para que
  // «nueva partida» con aleatorio dé OTRO mazo (potencialmente el mismo) en vez de quedarse
  // fijo con el que salió la primera vez. El flag (window._pbSideRandom) sobrevive entre
  // partidas dentro de la sesión; sólo se apaga si eliges un mazo concreto para ese lado.
  function _rerollRandomSides() {
    const sr = window._pbSideRandom;
    if (!sr) return;
    const metaDecks = (window.META_DECKS && Array.isArray(window.META_DECKS.decks)) ? window.META_DECKS.decks : [];
    const topMeta = metaDecks.slice(0, 50);
    if (!topMeta.length) return;   // sin datos meta: se juega el último aleatorio (no re-tiramos)
    ['p1', 'p2'].forEach(pl => {
      if (!sr[pl]) return;
      loadDeckIntoBuilder(buildMetaDeck(topMeta[Math.floor(Math.random() * topMeta.length)]), pl);
      sr[pl] = true;   // loadDeckIntoBuilder lo apagó; sigue siendo aleatorio para la próxima
    });
    if (window.switchDeckTab) window.switchDeckTab('p1');   // el builder vuelve a "tu mazo"
  }

  // Pantalla que se abre SIEMPRE al iniciar partida / nueva partida: muestra los dos
  // mazos enfrentados (J2 arriba = lado de arriba del tablero, J1 abajo = tu lado),
  // cada uno con su botón «Cambiar» (recicla la preview de «Probar mazo»). Confirmar →
  // _beginMatchNow (moneda + reparto). Si hay partida en curso, además «Vaciar el tablero».
  function _openStartSelector(opts) {
    opts = opts || {};
    // Durante una partida ONLINE no se monta ninguna partida local (empezar vaciaría el tablero).
    if (window._pvpSyncState && window._pvpSyncState().active) return;
    if (window._preloadCardDB) window._preloadCardDB();
    const old = document.getElementById('start-selector');
    if (old) { if (old._pbClose) old._pbClose(); else old.remove(); }
    // FORMATO pedido (el hub «Jugar» abre el selector con `{format:'advanced'}`). Con formato:
    // solo valen mazos de ese formato en los dos lados, y el «Aleatorio» meta queda fuera
    // (los mazos meta son de 20 = Estándar).
    const FMT = opts.format && window.PB_FORMATS && window.PB_FORMATS[opts.format] ? opts.format : null;
    window._pbSideRandom = window._pbSideRandom || { p1: false, p2: false };   // ANTES de tocarlo (perfil nuevo)
    if (FMT && FMT !== 'standard') { window._pbSideRandom.p1 = false; window._pbSideRandom.p2 = false; }
    // J1 = TU MAZO ACTIVO (ya no se elige aquí; se cambia en «Mis mazos»). Nunca «Aleatorio».
    window._pbSideRandom.p1 = false;
    const AD = window._pbActiveDeckCheck ? window._pbActiveDeckCheck(FMT) : { ok: false, deck: null, reasons: [] };
    // El picker de J2 carga el mazo AL VUELO (loadDeckIntoBuilder pone deckPlayQueues a null):
    // si se cancela el selector con una partida en curso, esa partida quedaría rota. Se guarda
    // una foto del lado J2 al abrir y se restaura si NO se llega a empezar.
    const _p2Snap = {
      queue: (window.deckQueues && window.deckQueues.p2) ? window.deckQueues.p2.slice() : null,
      play:  (window.deckPlayQueues && window.deckPlayQueues.p2) ? window.deckPlayQueues.p2.slice() : null,
      energy: (window.deckEnergyTypes && window.deckEnergyTypes.p2) ? new Set(window.deckEnergyTypes.p2) : null,
      name: (window._deckNames || {}).p2, cover: (window._deckCovers || {}).p2,
      feat: (window._deckFeatured || {}).p2, fmt: (window._deckFormats || {}).p2,
      rnd: !!window._pbSideRandom.p2
    };
    let _started = false;   // ¿se pulsó «Empezar»? (si no, el lado J2 se deshace al cerrar)
    let _p2Dirty = false;   // ¿el picker de J2 llegó a cargar un mazo? (si no, no hay nada que deshacer)
    function _restoreP2() {
      if (_started || !_p2Dirty || !_p2Snap.queue) return;                       // nadie tocó el picker de J2
      if (document.getElementById('start-selector') !== overlay) return;         // overlay ya reemplazado
      if (window.deckQueues) window.deckQueues.p2 = _p2Snap.queue;
      if (window.deckPlayQueues) window.deckPlayQueues.p2 = _p2Snap.play;
      if (window.deckEnergyTypes && _p2Snap.energy) window.deckEnergyTypes.p2 = _p2Snap.energy;
      if (window._deckNames) window._deckNames.p2 = _p2Snap.name;
      if (window._deckCovers) window._deckCovers.p2 = _p2Snap.cover;
      if (window._deckFeatured) window._deckFeatured.p2 = _p2Snap.feat;
      if (window._deckFormats) window._deckFormats.p2 = _p2Snap.fmt;
      window._pbSideRandom.p2 = _p2Snap.rnd;
    }

    const overlay = document.createElement('div');
    overlay.id = 'start-selector';
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal start-sel';
    // Lados marcados como "aleatorio oculto": el mazo se carga pero NO se revela en el selector.
    // Se inicializa del estado persistente (window._pbSideRandom) → al reabrir sigue en "Aleatorio".
    window._pbSideRandom = window._pbSideRandom || { p1: false, p2: false };
    const _selHidden = { p1: !!window._pbSideRandom.p1, p2: !!window._pbSideRandom.p2 };

    // Con formato fijado, un mazo de OTRO formato (p.ej. el de 20 de la partida anterior) NO
    // vale: el lado se ve vacío y hay que elegir uno del formato → «Empezar» queda apagado.
    function sideFmtOk(pl) { return !FMT || (window._pbSideFormat ? window._pbSideFormat(pl) === FMT : true); }
    // ¿El mazo que hay en el constructor de J1 es trabajo SIN GUARDAR que se perdería al
    // sembrar el mazo activo? (si coincide con el activo o con cualquier mazo de la
    // biblioteca, no hay nada que perder y no se molesta al usuario)
    function _sig(cards) { return (cards || []).map(c => (c && (c.id || c.name)) || '?').sort().join('|'); }
    function _builderDeckAtRisk() {
      const cur = (window.deckQueues || {}).p1 || [];
      if (cur.length < 2) return false;
      const sig = _sig(cur);
      if (AD.deck && sig === _sig(AD.deck.cards)) return false;
      return !loadLibrary().some(d => _sig(d.cards) === sig);
    }

    // J1 ya no depende de lo que haya en el builder: vale si vale su MAZO ACTIVO.
    function deckValid(pl) {
      if (pl === 'p1') return !!AD.ok;
      return (((window.deckQueues || {})[pl]) || []).length >= 5 && sideFmtOk(pl);
    }
    function coverFor(pl) {
      const cards = ((window.deckQueues || {})[pl]) || [];
      if (cards.length < 5) return '';
      // Portada guardada al elegir el mazo (protagonista curado) → misma carta que la lista.
      // Sólo cae a la heurística por cartas si no se cargó por el picker (p.ej. partida restaurada).
      const stored = window._deckCovers && window._deckCovers[pl];
      return stored || deckCover({ cards });
    }
    function playerName(pl) {
      const el = document.getElementById('pname-' + pl);
      return (el && el.textContent) || (pl === 'p1' ? 'P1' : 'P2');
    }
    function deckNameOf(pl) { return ((window._deckNames || {})[pl]) || ''; }

    // Lado J1: SOLO LECTURA — la portada del mazo activo. Cambiarlo se hace en «Mis mazos»
    // (mismo gesto que el mazo activo del hub «Jugar»), no aquí.
    function buildActiveSide(accent) {
      const side = document.createElement('div');
      side.className = 'start-sel-side start-sel-side--active';
      side.style.setProperty('--pc', accent);
      const label = document.createElement('div');
      label.className = 'start-sel-label';
      label.textContent = playerName('p1');
      side.appendChild(label);

      const goDecks = () => { close(); if (window._mazosOpenMine) window._mazosOpenMine({ grid: true }); };
      const cover = document.createElement('div');
      cover.className = 'start-sel-cover';

      if (!AD.deck) {                       // sin mazo activo (o biblioteca vacía)
        cover.classList.add('empty');
        cover.textContent = T('start.noActive');
      } else {
        const feat = AD.deck.featured;
        if (feat && feat.length >= 2) paintDeckThumb(cover, AD.deck);
        else {
          const img = window._mazosDeckCover ? window._mazosDeckCover(AD.deck) : '';
          if (img) cover.style.backgroundImage = 'url(' + img + ')';
          else { cover.classList.add('empty'); cover.textContent = T('start.pickDeck'); }
        }
        if (!AD.ok) cover.classList.add('start-sel-dim');   // no vale para este formato
      }
      cover.title = T('start.goToDecks');
      cover.onclick = goDecks;
      side.appendChild(cover);

      if (AD.deck) {
        const nameEl = document.createElement('div');
        nameEl.className = 'start-sel-deckname';
        nameEl.textContent = AD.deck.name || '';
        nameEl.title = T('start.goToDecks');
        nameEl.onclick = goDecks;
        side.appendChild(nameEl);
      }
      const tag = document.createElement('div');
      tag.className = 'start-sel-active-tag';
      tag.textContent = T('start.activeDeck');
      side.appendChild(tag);

      // Motivo + salida cuando el mazo activo no sirve (y aviso suave si solo hay reparos)
      const bad = !AD.ok, first = (AD.reasons || [])[0];
      if (bad || first) {
        const why = document.createElement('div');
        why.className = 'start-sel-reason' + (bad ? ' is-bad' : '');
        why.textContent = first ? T(first.k, first.vars || undefined) : '';
        if (why.textContent) side.appendChild(why);
      }
      if (bad) {
        const fix = document.createElement('button');
        fix.className = 'pb-btn start-sel-fix';
        // Si el formato pedido no existe en la biblioteca, la salida útil es CREAR uno.
        const hasFmtDeck = FMT ? loadLibrary().some(d => (window.formatIdOf ? window.formatIdOf(d) : 'standard') === FMT) : true;
        if (FMT && !hasFmtDeck) {
          fix.textContent = T('start.newFormatDeck', { format: window.formatName ? window.formatName(FMT) : FMT });
          fix.onclick = () => {
            close();
            if (window.switchAppTab) window.switchAppTab('mazos');
            setTimeout(() => window._mazosBuildNew && window._mazosBuildNew(FMT), 240);
          };
        } else {
          fix.textContent = T('start.goToDecks');
          fix.onclick = goDecks;
        }
        side.appendChild(fix);
      }
      return side;
    }

    function buildSide(pl, accent) {
      if (pl === 'p1') return buildActiveSide(accent);
      const side = document.createElement('div');
      side.className = 'start-sel-side';
      side.style.setProperty('--pc', accent);

      const label = document.createElement('div');
      label.className = 'start-sel-label';
      label.textContent = playerName(pl);

      const hidden = _selHidden[pl] && deckValid(pl);   // aleatorio: mazo cargado pero sin revelar
      const openPicker = () => _openDeckPickerFor(pl, (isHidden) => {
        _selHidden[pl] = !!isHidden;
        window._pbSideRandom[pl] = !!isHidden;   // recuerda "aleatorio" para las próximas partidas
        _p2Dirty = true;                         // este lado ya se cargó al vuelo → cancelar debe deshacerlo
        rerender();
      }, { format: FMT });

      const cover = document.createElement('div');
      cover.className = 'start-sel-cover';
      cover.title = T('start.change');           // tooltip nativo (clic = cambiar mazo)
      if (hidden) {
        // Misterio: dorso de carta, NO la portada real del mazo
        if (window.CARD_BACK_IMG) cover.style.backgroundImage = 'url(' + window.CARD_BACK_IMG + ')';
        cover.classList.add('mystery');
      } else {
        const feat = window._deckFeatured && window._deckFeatured[pl];
        const img = coverFor(pl);
        if (feat && feat.length >= 2) {
          paintDeckThumb(cover, { featured: feat, cards: ((window.deckQueues || {})[pl]) || [] });
        }
        else if (img) cover.style.backgroundImage = 'url(' + img + ')';
        else { cover.classList.add('empty'); cover.textContent = T('start.pickDeck'); }
      }
      // Insignia "cambiar" en la esquina (color del jugador): clic en el mazo para elegir otro
      const badge = document.createElement('div');
      badge.className = 'start-sel-edit';
      badge.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4 3 8l4 4"/><path d="M3 8h12"/><path d="m17 20 4-4-4-4"/><path d="M21 16H9"/></svg>';
      cover.appendChild(badge);
      cover.onclick = openPicker;

      let nameEl = null;
      const dn = hidden ? T('start.random') : deckNameOf(pl);
      if (dn && deckValid(pl)) {
        nameEl = document.createElement('div');
        nameEl.className = 'start-sel-deckname';
        nameEl.textContent = dn;
        nameEl.title = T('start.change');
        nameEl.onclick = openPicker;
      }

      side.appendChild(label);
      side.appendChild(cover);
      if (nameEl) side.appendChild(nameEl);
      return side;
    }

    function close() {
      document.removeEventListener('keydown', _esc, true);
      _restoreP2();   // cancelar no puede romper la partida en curso (el picker de J2 carga al vuelo)
      overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 180);
    }
    // SALIDA ÚNICA: quien retire este overlay DEBE pasar por aquí. Si no, el listener de
    // Escape queda huérfano y su _restoreP2() dispara minutos después, pisando el mazo y la
    // cola de robo de J2 en plena partida (y el autosave lo persiste).
    overlay._pbClose = close;
    function _esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }   // Escape = cancelar
    document.addEventListener('keydown', _esc, true);

    function rerender() {
      box.innerHTML = '';
      if (FMT && FMT !== 'standard') {   // cabecera con el formato de la partida (30 cartas · 4 puntos)
        const fchip = document.createElement('button');
        fchip.className = 'start-sel-fmt is-' + FMT;
        fchip.title = T('format.infoTip');
        fchip.textContent = (window.formatName ? window.formatName(FMT) : FMT) +
          ' · ' + T('start.fmtRules', { size: window.deckSizeFor(FMT), points: window.pointsFor(FMT) });
        fchip.onclick = () => _formatInfo(FMT);   // reglas + ban list del formato
        box.appendChild(fchip);
      }
      box.appendChild(buildSide('p2', '#ff6b6b'));   // arriba = J2 (parte de arriba del tablero)
      const vs = document.createElement('div');
      vs.className = 'start-sel-vs';
      vs.textContent = 'VS';
      box.appendChild(vs);
      box.appendChild(buildSide('p1', '#4dabff'));    // abajo = J1 (tú)

      const actions = document.createElement('div');
      actions.className = 'start-sel-actions';

      const begin = document.createElement('button');
      begin.className = 'pb-btn pb-btn-primary start-sel-begin';
      begin.textContent = T('board.start');
      begin.disabled = !(deckValid('p1') && deckValid('p2'));
      begin.onclick = () => {
        // Confirmaciones ANTES de tocar nada: empezar vacía el tablero (_beginMatchNow →
        // clearBoard) y siembra J1 con el mazo activo.
        const warns = [];
        const live = window._pbHasLiveMatch ? window._pbHasLiveMatch() : false;
        if (!live && window._pbBoardHasCards && window._pbBoardHasCards()) {
          warns.push({ title: T('board.freeWarnTitle'), message: T('board.freeWarnQ') });    // escena montada a mano
        }
        if (AD.ok && _builderDeckAtRisk()) {
          warns.push({ title: T('board.freeWarnTitle'), message: T('board.builderWarnQ') }); // mazo del builder sin guardar
        }
        const go = () => {
          _started = true;
          close();
          if (AD.ok) loadDeckIntoBuilder(AD.deck, 'p1');   // AL CONFIRMAR (al abrir rompería la partida en curso)
          _rerollRandomSides();
          window._beginMatchNow && window._beginMatchNow();
        };
        const ask = (i) => {
          if (i >= warns.length) { go(); return; }
          if (!window.pbConfirm) { go(); return; }
          window.pbConfirm({ title: warns[i].title, message: warns[i].message,
                             okLabel: T('board.start'), danger: true })
            .then(yes => { if (yes) ask(i + 1); });
        };
        ask(0);
      };
      actions.appendChild(begin);

      // (Fuera de aquí: «Jugar online» —el online se entra por el hub— y «Vaciar el tablero»,
      //  que se mudó al menú ⋯ del propio tablero, donde solo aparece si hay algo que vaciar.)

      const cancel = document.createElement('button');
      cancel.className = 'pb-btn start-sel-cancel';
      cancel.textContent = T('common.cancel');
      cancel.onclick = close;
      actions.appendChild(cancel);

      box.appendChild(actions);
    }

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    rerender();
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }
  window._openStartSelector = _openStartSelector;
  window._mazosLoadDeck = loadDeckIntoBuilder;   // hook de test (carga un mazo en el builder de un lado)

  // ════ Popup «i» de un FORMATO: sus reglas + su ban list ════
  // Lo abren el selector de modos del hub, el chip del selector de inicio y el del builder.
  // Vive aquí (y no en formats.js) porque formats.js es datos+lógica pura, sin DOM.
  function _formatInfo(fmtId) {
    const f = window.formatDef ? window.formatDef(fmtId) : null;
    if (!f) return;
    const old = document.getElementById('format-info'); if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'format-info';
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal fmt-info';

    const title = document.createElement('div');
    title.className = 'pb-modal-title fmt-info-title' + (f.id !== 'standard' ? ' is-' + f.id : '');
    title.textContent = window.formatName ? window.formatName(f.id) : f.id;
    box.appendChild(title);

    // El cuerpo scrollea; título y botón de cerrar se quedan SIEMPRE a la vista.
    const body = document.createElement('div');
    body.className = 'fmt-info-body';
    box.appendChild(body);

    // Las cuatro reglas, en recuadros: número grande + etiqueta. Ocupa una fila en vez de cuatro.
    const rules = document.createElement('div');
    rules.className = 'fmt-info-rules';
    [[T('format.deckSizeLabel'), String(f.deckSize)],
     [T('format.copiesLabel'), String(f.maxCopies)],
     [T('format.pointsLabel'), String(f.points)],
     [T('format.handLabel'), String(f.initialHand)]].forEach(([k, v]) => {
      const row = document.createElement('div'); row.className = 'fmt-info-tile';
      const b = document.createElement('span'); b.className = 'fmt-info-v'; b.textContent = v;
      const a = document.createElement('span'); a.className = 'fmt-info-k'; a.textContent = k;
      row.appendChild(b); row.appendChild(a); rules.appendChild(row);
    });
    body.appendChild(rules);

    // Cabecera de sección: título + (opcional) enlace a la derecha.
    function sec(txt, link) {
      const h = document.createElement('div'); h.className = 'fmt-info-sec';
      const s = document.createElement('span'); s.textContent = txt; h.appendChild(s);
      if (link) h.appendChild(link);
      body.appendChild(h);
      return h;
    }
    // Prohibidas y custom hablan el MISMO idioma visual: una tira de cartas que se arrastra en
    // horizontal, con los bordes desvanecidos (el patrón de la pila de descartes). Antes eran
    // dos listas con formas distintas apiladas, y el popup medía casi 1000px de alto.
    function strip(cards, extraClass) {
      const el = document.createElement('div');
      el.className = 'fmt-info-strip' + (extraClass ? ' ' + extraClass : '');
      cards.forEach(c => {
        const it = document.createElement('div'); it.className = 'fmt-info-card ' + (extraClass === 'is-ban' ? 'fmt-info-ban' : 'fmt-info-cu');
        const im = document.createElement('div'); im.className = 'fmt-info-art';
        const u = metaImg(c); if (u) im.style.backgroundImage = "url('" + u + "')";
        const nm = document.createElement('div'); nm.className = 'fmt-info-name';
        nm.textContent = window.cardName ? window.cardName(c) : c.name;
        it.appendChild(im); it.appendChild(nm);
        // El arrastre de la tira marca _dragMoved → no abrir el zoom al soltar.
        it.onclick = () => { if (el._dragMoved) return; if (window.openZoomFromImage) window.openZoomFromImage(metaImg(c), im); };
        el.appendChild(it);
      });
      body.appendChild(el);
      if (window._initGridDragScroll) window._initGridDragScroll(el);
      // El desvanecido de los bordes solo tiene sentido si de verdad hay más cartas que espacio.
      requestAnimationFrame(() => el.classList.toggle('has-more', el.scrollWidth > el.clientWidth + 2));
      return el;
    }

    const bans = (f.banList || []).map(id => (window.dbLookup ? window.dbLookup({ id }) : null)).filter(Boolean);
    sec(T('format.bansTitle'));
    if (!bans.length) {
      const none = document.createElement('div'); none.className = 'fmt-info-none'; none.textContent = T('format.noBans');
      body.appendChild(none);
    } else strip(bans, 'is-ban');

    // ── Cartas CUSTOM del formato ──
    // Aquí es donde alguien descubre que el Avanzado tiene cartas propias (no existen en Pocket).
    const cs = f.customSet;
    const customs = (cs === 'all') ? (window.CUSTOM_CARDS || [])
                  : (cs && cs.length) ? cs.map(id => (window.dbLookup ? window.dbLookup({ id }) : null)).filter(Boolean)
                  : [];
    if (customs.length) {
      const see = document.createElement('button');
      see.className = 'fmt-info-see';
      see.textContent = T('format.customSee');
      see.onclick = () => { close(); if (window._cvShowCustomCards) window._cvShowCustomCards(); };
      sec(T('format.customTitle'), see);
      strip(customs);
    }

    function close() { document.removeEventListener('keydown', _esc, true); overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 180); }
    function _esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', _esc, true);

    const actions = document.createElement('div');
    actions.className = 'pb-modal-actions';
    const ok = document.createElement('button');
    ok.className = 'pb-btn';
    ok.textContent = T('overlay.close');
    ok.onclick = close;
    actions.appendChild(ok);
    box.appendChild(actions);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }
  window.pbFormatInfo = _formatInfo;

  // Picker por jugador (recicla la preview de «Probar mazo»): tus mazos + Aleatorio.
  function _openDeckPickerFor(pl, onPicked, opts) {
    if (window._preloadCardDB) window._preloadCardDB();
    opts = opts || {};
    // Formato pedido por el selector: la lista solo ofrece mazos de ESE formato y, si no es
    // Estándar, la pestaña meta desaparece (los mazos meta son de 20 cartas).
    const FMT = opts.format && window.PB_FORMATS && window.PB_FORMATS[opts.format] ? opts.format : null;
    const fmtOf = d => (window.formatIdOf ? window.formatIdOf(d) : 'standard');
    const lib = loadLibrary().filter(d => !FMT || fmtOf(d) === FMT);

    const overlay = document.createElement('div');
    overlay.className = 'pb-modal-overlay start-deck-picker';
    const box = document.createElement('div');
    box.className = 'pb-modal mz-rival-modal';

    const title = document.createElement('div');
    title.className = 'pb-modal-title mz-rival-title';
    const who = (document.getElementById('pname-' + pl) || {}).textContent || (pl === 'p1' ? 'P1' : 'P2');
    title.textContent = T('start.pickFor', { name: who });

    const grid = document.createElement('div');
    grid.className = 'mz-rival-grid';

    function close() { document.removeEventListener('keydown', _esc, true); overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 180); }
    function _esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }   // Escape = cancelar
    document.addEventListener('keydown', _esc, true);

    function makeOpt(label, sublabel, coverImg, onClick, disabled, emoji, deckObj) {
      const opt = document.createElement('button');
      opt.className = 'mz-rival-opt';
      if (disabled) { opt.classList.add('disabled'); opt.disabled = true; }
      const stack = document.createElement('div');
      stack.className = 'mz-rival-stack';
      const backImg = window.CARD_BACK_IMG ? 'url(' + window.CARD_BACK_IMG + ')' : '';
      [3, 2, 1].forEach(n => {
        const b = document.createElement('div');
        b.className = 'mzr-back mzr-back-' + n;
        if (backImg) b.style.backgroundImage = backImg;
        stack.appendChild(b);
      });
      const front = document.createElement('div');
      front.className = 'mzr-front';
      if (deckObj && deckObj.featured && deckObj.featured.length >= 2) paintDeckThumb(front, deckObj);
      else if (coverImg) front.style.backgroundImage = 'url("' + coverImg + '")';
      else { front.classList.add('mzr-front-empty'); front.textContent = emoji || ''; }
      stack.appendChild(front);
      const txt = document.createElement('div');
      txt.className = 'mz-rival-txt';
      const nm = document.createElement('div');
      nm.className = 'mz-rival-name';
      nm.textContent = label;
      txt.appendChild(nm);
      if (sublabel) {
        const sub = document.createElement('div');
        sub.className = 'mz-rival-sub';
        sub.textContent = sublabel;
        txt.appendChild(sub);
      }
      opt.appendChild(stack);
      opt.appendChild(txt);
      if (!disabled) opt.onclick = onClick;
      // Mantener pulsado un mazo = verlo completo (como en la tierlist)
      if (deckObj && deckObj.cards && deckObj.cards.length) attachDeckPeek(opt, deckObj);
      return opt;
    }

    // Datos meta (ya vienen ordenados por share desc → top 50 = slice)
    const metaDecks = (window.META_DECKS && Array.isArray(window.META_DECKS.decks)) ? window.META_DECKS.decks : [];
    const topMeta = metaDecks.slice(0, 50);
    function metaCover(row) { return deckCover({ _meta: { protagonists: (row && row.protagonists) || [] } }); }
    // Cargar un mazo jugable; `hidden`=aleatorio (el selector NO lo revela)
    function finishPick(deckObj, hidden) {
      close();
      loadDeckIntoBuilder(deckObj, pl);                     // deckQueues[pl] + _deckNames[pl]
      if (window.switchDeckTab) window.switchDeckTab('p1');  // builder único: el tab vuelve a "tu mazo"
      onPicked && onPicked(hidden);
    }
    function pickMetaRow(row, hidden) { finishPick(buildMetaDeck(row), hidden); }

    // ── Dos pestañas deslizantes: Mis mazos / Mazos meta ──
    const tabs = document.createElement('div');
    tabs.className = 'mz-pick-tabs';
    const tabMine = document.createElement('button');
    tabMine.className = 'mz-pick-tab'; tabMine.type = 'button'; tabMine.textContent = T('start.yourDecks');
    const tabMeta = document.createElement('button');
    tabMeta.className = 'mz-pick-tab'; tabMeta.type = 'button'; tabMeta.textContent = T('start.metaDecks');
    const tabInd = document.createElement('div'); tabInd.className = 'mz-pick-tab-ind';
    tabs.appendChild(tabMine); tabs.appendChild(tabMeta); tabs.appendChild(tabInd);

    function renderMine() {
      grid.innerHTML = '';
      if (!lib.length) {
        const e = document.createElement('div'); e.className = 'mz-pick-empty';
        // Sin mazos DEL FORMATO pedido: se explica y se ofrece crearlo (no dejar al usuario en un callejón)
        e.textContent = FMT ? T('start.noFormatDecks', { format: window.formatName ? window.formatName(FMT) : FMT })
                            : T('start.noDecks');
        grid.appendChild(e);
        if (FMT && window._mazosBuildNew) {
          const b = document.createElement('button');
          b.className = 'pb-btn pb-btn-primary mz-pick-newdeck';
          b.textContent = T('start.newFormatDeck', { format: window.formatName ? window.formatName(FMT) : FMT });
          // Ir a Barajas Y crear el mazo del formato (buildNewDeck pinta en la vista de Mazos:
          // sin cambiar de pestaña antes, el builder se montaría en una vista oculta).
          b.onclick = () => {
            close();
            const s = document.getElementById('start-selector'); if (s) { if (s._pbClose) s._pbClose(); else s.remove(); }
            if (window.switchAppTab) window.switchAppTab('mazos');
            setTimeout(() => window._mazosBuildNew(FMT), 240);
          };
          grid.appendChild(b);
        }
        return;
      }
      lib.forEach(d => {
        const incomplete = !d.cards || d.cards.length < 5;
        // Con formato fijado, un mazo que NO cumple sus reglas (tamaño, copias, básico, ban list)
        // sale apagado CON EL MOTIVO — es el caso del spec «un ban deja ilegal un mazo legal».
        let bad = null;
        if (!incomplete && FMT && window.validateDeckForFormat) {
          const v = window.validateDeckForFormat(d, FMT);
          if (!v.ok && v.reasons.length) bad = T(v.reasons[0].k, v.reasons[0].vars || {});
        }
        grid.appendChild(makeOpt(
          d.name || T('mazos.noName'),
          incomplete ? T('start.incomplete') : (bad || T('start.cardsCount', { n: d.cards.length })),
          deckCover(d),
          () => finishPick(d, false),
          incomplete || !!bad, null, d));
      });
    }
    function renderMeta() {
      grid.innerHTML = '';
      // Aleatorio (top 50 al azar) ARRIBA de la pestaña meta — NO revela el mazo
      grid.appendChild(makeOpt(T('start.random'), T('start.randomSub'), '', () => {
        if (topMeta.length) { pickMetaRow(topMeta[Math.floor(Math.random() * topMeta.length)], true); return; }
        // sin META_DECKS: generador antiguo (también oculto)
        close();
        if (window.switchDeckTab) window.switchDeckTab(pl);
        if (window.deckPlayQueues) window.deckPlayQueues[pl] = null;
        window.randomizeDeck && window.randomizeDeck(() => {
          if (!window._deckNames) window._deckNames = { p1: '', p2: '' };
          window._deckNames[pl] = T('start.random');
          if (window.switchDeckTab) window.switchDeckTab('p1');
          onPicked && onPicked(true);
        });
      }, false, '🎲'));
      topMeta.forEach(row => {
        const pct = Math.round((row.share || 0) * 1000) / 10;
        grid.appendChild(makeOpt(row.name || T('mazos.noName'), T('start.metaUsage', { pct: pct }), metaCover(row), () => pickMetaRow(row, false), false));
      });
    }
    function setTab(which) {
      const mine = which === 'mine';
      tabMine.classList.toggle('active', mine);
      tabMeta.classList.toggle('active', !mine);
      tabs.classList.toggle('on-meta', !mine);   // desliza el indicador
      if (mine) renderMine(); else renderMeta();
    }
    tabMine.onclick = () => setTab('mine');
    tabMeta.onclick = () => setTab('meta');
    // Los mazos meta son de 20 cartas = Estándar → en otro formato esa pestaña no aplica.
    const metaAllowed = !FMT || FMT === 'standard';
    if (!metaAllowed) tabs.style.display = 'none';
    setTab((lib.length || !metaAllowed) ? 'mine' : 'meta');   // por defecto: tus mazos (si tienes); si no, meta

    const actions = document.createElement('div');
    actions.className = 'pb-modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'pb-btn';
    cancel.textContent = T('common.cancel');
    cancel.onclick = close;
    actions.appendChild(cancel);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    box.appendChild(title);
    box.appendChild(tabs);
    box.appendChild(grid);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  // «Nuevo mazo»: menú de origen (construir desde cero / importar lista / escanear código).
  // Los TRES caminos acaban en el MISMO sitio: el constructor de Barajas con el mazo dentro,
  // listo para revisar y guardar. Antes, importar saltaba a Cartas con el pop-up del mazo
  // (comportamiento viejo, de cuando el builder vivía allí) y dejaba el mazo del TABLERO
  // relleno — de ahí el «se descartará el mazo que tienes en construcción» que salía después.
  function newDeck() {
    // Cartas importadas → mazo nuevo en el constructor. El formato se deduce del tamaño de la
    // lista (>20 cartas = Avanzado); el mazo no llega a la biblioteca hasta que se guarda.
    const openImported = (cards, energy) => {
      if (!cards || !cards.length) return;
      const fmt = cards.length > 20 ? 'advanced' : 'standard';
      const deck = { id: Date.now(), name: T('mazos.newDeck'), cards: cards.map(_serCard),
                     energyTypes: (energy || []).slice(), format: fmt, source: 'manual', _draft: true };
      enrichDeck(deck);
      showDetailView(deck, -1, true);
      enterDeckEdit(deck, -1);
    };

    const doImport = () => {
      if (window._preloadCardDB) window._preloadCardDB();   // asegura _allCards (por si no se abrió el tablero)
      let pend = null;
      // El mazo se recoge al importar y se abre al CERRARSE el modal (si no, el constructor
      // se montaría debajo del modal, que sigue 1,2 s en pantalla con el «listo»).
      if (window.showImportModal) window.showImportModal(
        () => { if (pend) { openImported(pend.cards, pend.energy); pend = null; } },
        { max: 30, onCards: (cards, energy) => { pend = { cards: cards.slice(), energy: energy }; } });
    };

    // Escanear un código 2D (de Pocket o generado por la web) → mismo destino
    const doScanQR = () => {
      if (!window.pbDeckQR || !window.pbDeckQR.scanImport) return;
      if (window._preloadCardDB) window._preloadCardDB();
      window.pbDeckQR.scanImport(res => {
        if (!res || !res.cards.length) return;
        const extra = res.unknown ? ' · ' + T('qr.unknownCards', { n: res.unknown }) : '';
        window.pbToast && window.pbToast(T('qr.imported', { n: res.cards.length }) + extra);
        openImported(res.cards, res.energyTypes || []);
      });
    };

    // Menú 1 = qué hacer. «Construir desde cero» abre un 2º menú con los FORMATOS
    // (Estándar / Advanced / …futuros), porque el mazo queda ATADO a su formato al crearse.
    const fmtDesc = (id) => {
      const sz = window.deckSizeFor ? window.deckSizeFor(id) : (id === 'advanced' ? 30 : 20);
      const pts = window.pointsFor ? window.pointsFor(id) : (id === 'advanced' ? 4 : 3);
      return T('format.deckPoints', { n: sz, p: pts });
    };
    const chooseFormatThenBuild = () => {
      const order = window.PB_FORMAT_ORDER || ['standard', 'advanced'];
      // Las opciones son las BANDAS del selector de modos del hub (mismo componente y mismo
      // CSS, vía window.pbModeBand): aquí solo eligen el tipo de mazo — no tocan el modo de
      // juego elegido en «Jugar» ni navegan a ninguna parte.
      const BAND = { standard: 'estandar', advanced: 'advanced' };
      const fmtOpts = order.map(id => ({
        value: id,
        label: window.formatName ? window.formatName(id) : id,
        desc: fmtDesc(id),
        html: window.pbModeBand ? window.pbModeBand(BAND[id] || id, {
          name: window.formatName ? window.formatName(id) : id,
          desc: fmtDesc(id), fmt: id, sel: false, ppl: false,
        }) : '',
      }));
      window.pbChoose({
        title: T('mazos.newFromScratch'),
        options: fmtOpts,
        listClass: 'pb-choose-bands jv-bands',
        // El botón «i» de la banda abre las reglas del formato SIN elegirlo (stopPropagation).
        onRender: (el) => {
          const i = el.querySelector('[data-fmt]');
          if (i) i.addEventListener('click', ev => {
            ev.stopPropagation(); ev.preventDefault();
            window.pbFormatInfo && window.pbFormatInfo(i.dataset.fmt);
          });
        },
      }).then(fid => { if (fid) buildNewDeck(fid); });
    };
    const opts = [
      { value: 'build',  label: T('mazos.newFromScratch'), desc: T('mazos.newFromScratchDesc') },
      { value: 'import', label: T('mazos.newImport'),      desc: T('mazos.newImportDesc') },
    ];
    if (window.pbDeckQR && window.pbDeckQR.scanImport) {
      opts.push({ value: 'qr', label: T('mazos.newScanQR'), desc: T('mazos.newScanQRDesc') });
    }
    window.pbChoose({
      title: T('mazos.newTitle'),
      options: opts,
    }).then(choice => {
      if (choice === 'build') chooseFormatThenBuild();
      else if (choice === 'import') doImport();
      else if (choice === 'qr') doScanQR();
    });
  }
  // «Construir desde 0» → mazo VACÍO abierto en el builder de Mis Mazos (ya NO en Cartas):
  // muestra los huecos decorativos; se persiste al Guardar con ≥1 carta (exitDeckEdit) y un
  // draft cancelado/guardado-vacío no deja rastro en la biblioteca.
  function buildNewDeck(formatId) {
    const fmt = (formatId === 'advanced') ? 'advanced' : 'standard';   // el mazo queda ATADO a su formato
    const deck = { id: Date.now(), name: T('mazos.newDeck'), cards: [], energyTypes: [],
                   format: fmt, source: 'manual', _draft: true };
    showDetailView(deck, -1, true);   // silent = sin ruta de URL hasta que se guarde
    enterDeckEdit(deck, -1);
  }
  window._mazosBuildNew = buildNewDeck;   // hook de test + posible acceso directo futuro
  window._mazosNewDeck = newDeck;

  function confirmDelete(deck, idx) {
    window.pbConfirm({
      title: T('mazos.deleteDeck'),
      message: T('mazos.deleteMsg', { name: deck.name || T('mazos.noName') }),
      okLabel: T('common.delete'),
      danger: true,
    }).then(ok => {
      if (!ok) return;
      const lib = loadLibrary();
      const i = libIndexOf(lib, deck, idx);
      if (i !== -1) { lib.splice(i, 1); saveLibrary(lib); }
      _mzDraftClear(_draftId(deck));   // borrar el mazo se lleva su borrador aparcado
      showGridView();
      window.pbToast && window.pbToast(T('mazos.deletedToast'));
    });
  }

  // ── Compartir mazo: imagen / link / texto ─────────────────────
  function openShareMenu(deck) {
    const overlay = document.createElement('div');
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal mz-share-modal';
    const title = document.createElement('div');
    title.className = 'pb-modal-title';
    title.textContent = T('mazos.shareTitle');

    function close() { document.removeEventListener('keydown', _esc, true); overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 180); }
    function _esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }   // Escape = cancelar
    document.addEventListener('keydown', _esc, true);

    function opt(label, svg, handler) {
      const b = document.createElement('button');
      b.className = 'mz-share-opt';
      b.innerHTML = svg + '<span>' + label + '</span>';
      b.addEventListener('click', handler);
      return b;
    }

    const list = document.createElement('div');
    list.className = 'mz-share-list';
    list.appendChild(opt(T('mazos.shareImage'),
      '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" stroke-width="1.3"/><path d="M8 5v6M5 8l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      () => { close(); openExportOptions(deck); }));
    list.appendChild(opt(T('mazos.shareLink'),
      '<svg viewBox="0 0 16 16" fill="none"><path d="M6.5 9.5l3-3M5 11l-1.2 1.2a2.5 2.5 0 01-3.5-3.5L3.5 5.5M11 5l1.2-1.2a2.5 2.5 0 013.5 3.5L12.5 10.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" transform="translate(0,-0.5)"/></svg>',
      () => { copyDeckLink(deck); close(); }));
    list.appendChild(opt(T('mazos.shareText'),
      '<svg viewBox="0 0 16 16" fill="none"><rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
      () => { copyDeckText(deck); close(); }));

    const actions = document.createElement('div');
    actions.className = 'pb-modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'pb-btn';
    cancel.textContent = T('common.cancel');
    cancel.onclick = close;
    actions.appendChild(cancel);

    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
    box.appendChild(title);
    box.appendChild(list);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  function copyDeckLink(deck) {
    const code = window.encodeDeckShare && window.encodeDeckShare(deck);
    if (!code) { showToast(T('mazos.noLinkable')); return; }
    const omitted = (deck.cards || []).filter(c => !c.id).length;
    const link = location.href.split('#')[0] + '#deck=' + code;
    window.pbCopyText(link).then(() => {
      showToast(omitted
        ? T(omitted === 1 ? 'mazos.linkCopiedOmitOne' : 'mazos.linkCopiedOmitMany', { n: omitted })
        : T('mazos.linkCopied'));
    });
  }

  // Mismo generador que el «Exportar lista» del builder de la sidebar (shared.js).
  // Si el mazo no declara energías, se infieren de los costes de ataque.
  function deckToText(deck) {
    const cards = deck.cards || [];
    const en = (deck.energyTypes && deck.energyTypes.length) ? deck.energyTypes
             : (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(cards)) : []);
    return window.deckListText(cards, en);
  }

  function copyDeckText(deck) {
    const txt = deckToText(deck);
    if (!txt) { showToast(T('deck.empty')); return; }
    window.pbCopyText(txt).then(() => showToast(T('mazos.listCopied')));
  }

  // ── Importar mazo desde un link compartido (#deck=...) ────────
  function checkSharedDeckURL() {
    const m = (location.hash || '').match(/deck=([A-Za-z0-9_-]+)/);
    if (!m) return;
    history.replaceState(null, '', location.pathname + location.search);
    const data = window.decodeDeckShare(m[1]);
    if (!data) { showToast(T('mazos.invalidLink')); return; }
    const byId = new Map((window.CARDS_DB || []).map(c => [c.id, c]));
    const found = data.c.map(id => byId.get(id)).filter(Boolean);
    if (!found.length) { showToast(T('mazos.linkNoCards')); return; }
    const missing = data.c.length - found.length;
    const name = data.n || T('mazos.sharedDeckName');
    window.pbConfirm({
      title: T('mazos.importTitle'),
      message: T('mazos.importMsg', { name: name, n: found.length, missing: missing ? T('mazos.importMissing', { n: missing }) : '' }),
      okLabel: T('mazos.importBtn'),
    }).then(ok => {
      if (!ok) return;
      const lib = loadLibrary();
      lib.push({
        id: Date.now(),
        name: name,
        cards: found.map(c => ({
          id: c.id || '', name: c.name || '', image: c.image || '',
          health: c.health || 0, cardType: c.cardType || '', element: c.element || '',
          stage: c.stage || '', evolvesFrom: c.evolvesFrom || '',
          expansion: window.cardSetCode ? window.cardSetCode(c) : (c.expansion || c.set || ''), number: c.number || '',
          rarity: c.rarity || '', _temp: false
        })),
        energyTypes: (window.inferDeckEnergies ? window.inferDeckEnergies(found) : []),
        source: 'manual',   // lista importada por link = mazo construido (no draft ni meta)
        savedAt: Date.now()
      });
      saveLibrary(lib);
      if (window.switchAppTab) window.switchAppTab('mazos');
      showGridView();
      renderGrid();
      showToast(T('mazos.importedToast', { name: name }));
    });
  }
  setTimeout(checkSharedDeckURL, 500);

  // ── Export deck PNG — con opciones de layout y fondo ──────────
  function exportDeckImage(deck) {
    openShareMenu(deck);
  }

  // ── Imagen de mazo — config afinada en deck_image_tuner.html (por formato) ──
  const DECK_IMG_CFG = {
    horizontal:{bgColor:'#0d0d0d',iconColor:'#1a1a1a',iconOpacity:67,iconSize:45,iconStep:120,iconLayout:'brick',badgeShape:'pent',boxColor:'#141414',boxOpacity:91,boxBorder:0,badgeSize:17,energySize:32,showOnes:1,margin:0,cardShadow:0,wmText:'PokeLink.com',wmSize:15,wmMargin:4,wmOpacity:35,wmShadow:0},
    vertical:{bgColor:'#0d0d0d',iconColor:'#1a1a1a',iconOpacity:65,iconSize:90,iconStep:110,iconLayout:'brick',badgeShape:'pent',boxColor:'#141414',boxOpacity:91,boxBorder:0,badgeSize:17,energySize:56,showOnes:1,margin:0,cardShadow:0,wmText:'PokeLink.com',wmSize:40,wmMargin:26,wmOpacity:40,wmShadow:0},
    line:{bgColor:'#0d0d0d',iconColor:'#1a1a1a',iconOpacity:100,iconSize:40,iconStep:133,iconLayout:'brick',badgeShape:'pent',boxColor:'#141414',boxOpacity:91,boxBorder:0,badgeSize:17,energySize:32,showOnes:1,margin:23,cardShadow:0,wmText:'PokeLink.com',wmSize:36,wmMargin:0,wmOpacity:60,wmShadow:100}
  };
  const NUMFONT_IMG = 'Optima, Candara, "Segoe UI", system-ui, sans-serif';
  const EIMG_RATIO = 1.397;
  const _EN2ICON = { fire:'R', water:'W', grass:'G', lightning:'L', psychic:'P', fighting:'F', darkness:'D', metal:'M' };
  const _orbTileCache = {}, _energyImgCache = {};
  function _hexRgb(h){h=String(h||'#000').replace('#','');return {r:parseInt(h.slice(0,2),16)||0,g:parseInt(h.slice(2,4),16)||0,b:parseInt(h.slice(4,6),16)||0};}
  function loadPlainImage(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src;});}
  async function _symbolTile(iconKey, size, color){
    const ck = iconKey+'|'+color+'|'+size;
    if (_orbTileCache[ck]) return _orbTileCache[ck];
    const src = window.ORB_ICONS && window.ORB_ICONS[iconKey]; if (!src) return null;
    let orb; try { orb = await loadPlainImage(src); } catch(e){ return null; }
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d'); x.drawImage(orb,0,0,size,size);
    x.globalCompositeOperation='source-in'; x.fillStyle=color; x.fillRect(0,0,size,size);
    _orbTileCache[ck]=c; return c;
  }
  function _drawImgBg(ctx,W,H,c,iconKeys){
    ctx.fillStyle=c.bgColor; ctx.fillRect(0,0,W,H);
    const tiles=iconKeys.map(k=>_orbTileCache[k+'|'+c.iconColor+'|'+c.iconSize]).filter(Boolean);
    if (!tiles.length) return;
    const cell=c.iconSize, step=cell*(c.iconStep/100), rows=Math.ceil(H/step)+2, cols=Math.ceil(W/step)+2;
    for (let r=0;r<rows;r++) for (let col=0;col<cols;col++){
      let x=col*step-step/2,y=r*step-step/2; if (c.iconLayout==='brick'&&r%2) x+=step/2;
      const t=tiles.length<=2?tiles[(r+col)%tiles.length]:tiles[(r*7+col*13)%tiles.length];
      ctx.save(); ctx.globalAlpha=c.iconOpacity/100; ctx.drawImage(t,x,y,cell,cell); ctx.restore();
    }
  }
  function _polyPath(ctx,cx,cy,r,n,startDeg){ctx.beginPath();for(let k=0;k<n;k++){const a=Math.PI/180*(startDeg+360/n*k);const px=cx+r*Math.cos(a),py=cy+r*Math.sin(a);k?ctx.lineTo(px,py):ctx.moveTo(px,py);}ctx.closePath();}
  function _drawBadge(ctx,x,y,CW,CH,count,c){
    const fSize=Math.round(CW*c.badgeSize/100); ctx.font='600 '+fSize+'px '+NUMFONT_IMG;
    const txt=String(count),cx=x+CW/2,s=Math.round(fSize*1.55),cyc=y+CH-Math.round(CW*0.05)-s/2;
    const bo=_hexRgb(c.boxColor); ctx.fillStyle='rgba('+bo.r+','+bo.g+','+bo.b+','+(c.boxOpacity/100)+')';
    const sh=c.badgeShape;
    if (sh==='capsule'){const tw=ctx.measureText(txt).width,pw=Math.max(tw+CW*0.14,s);ctx.beginPath();ctx.roundRect(cx-pw/2,cyc-s/2,pw,s,s*0.34);}
    else if (sh==='circle'){ctx.beginPath();ctx.arc(cx,cyc,s/2,0,7);}
    else if (sh==='square'){ctx.beginPath();ctx.rect(cx-s/2,cyc-s/2,s,s);}
    else {const m={hex:[6,0],rombo:[4,-90],pent:[5,-90]}[sh]||[6,0];_polyPath(ctx,cx,cyc,s/2*1.1,m[0],m[1]);}
    ctx.fill();
    if (c.boxBorder>0){ctx.lineWidth=Math.max(1,s*0.05);ctx.strokeStyle='rgba(255,255,255,'+(c.boxBorder/100)+')';ctx.stroke();}
    ctx.fillStyle='rgba(255,255,255,0.96)'; ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.fillText(txt,cx,cyc+fSize*0.05);
  }
  async function _drawEnergyPill(ctx,W,etypes,c){
    if (!etypes.length) return 0;
    const od=Math.round(W*((c&&c.energySize||32)/1000)),gp=Math.round(od*0.28),pp=Math.round(od*0.36);
    const pillW=etypes.length*od+(etypes.length-1)*gp+pp*2,pillH=od+pp*2,px=Math.round(W*0.02),py=Math.round(W*0.02);
    ctx.fillStyle='rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.roundRect(px,py,pillW,pillH,pillH/2); ctx.fill();
    let ox=px+pp; const oy=py+pp;
    for (const t of etypes){
      const src=window.ENERGY_ICONS&&window.ENERGY_ICONS[_EN2ICON[t]]; if(!src){ox+=od+gp;continue;}
      try { const im=_energyImgCache[t]||(_energyImgCache[t]=await loadPlainImage(src));
        ctx.save(); ctx.beginPath(); ctx.arc(ox+od/2,oy+od/2,od/2,0,7); ctx.clip(); ctx.drawImage(im,ox,oy,od,od); ctx.restore();
      } catch(e){}
      ox+=od+gp;
    }
    return py+pillH+Math.round(W*0.015);
  }
  // Energía al final de la fila (formato Línea): orbes de color apilados en un hueco tipo carta
  async function _drawLineEnergySlot(ctx,x,y,CW,CH,etypes){
    const n=etypes.length; if(!n) return;
    const gap=CH*0.05, d=Math.min(CW*0.8,(CH-gap*(n-1))/n*0.96), totalH=n*d+(n-1)*gap;
    let oy=y+(CH-totalH)/2; const ox=x+(CW-d)/2;
    for (const t of etypes){
      const src=window.ENERGY_ICONS&&window.ENERGY_ICONS[_EN2ICON[t]];
      if(src){ try{ const im=_energyImgCache[t]||(_energyImgCache[t]=await loadPlainImage(src));
        ctx.save(); ctx.beginPath(); ctx.arc(ox+d/2,oy+d/2,d/2,0,7); ctx.clip(); ctx.drawImage(im,ox,oy,d,d); ctx.restore();
        ctx.beginPath(); ctx.arc(ox+d/2,oy+d/2,d/2,0,7); ctx.lineWidth=Math.max(1,d*0.02); ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.stroke();
      } catch(e){} }
      oy+=d+gap;
    }
  }
  function _drawWatermark(ctx,W,H,c,ref0){
    ctx.save();
    ctx.fillStyle='rgba(255,255,255,'+(c.wmOpacity/100)+')';
    // referencia CAPADA por el alto → la línea (muy ancha) no infla el tamaño/margen de la marca.
    // Con QR se pasa la referencia del lienzo BASE: la marca no crece porque la imagen se alargue.
    const ref=ref0||Math.min(W,Math.round(H*3));
    const fs=Math.round(ref*c.wmSize/1000);
    ctx.font='600 '+fs+'px system-ui, sans-serif';
    ctx.textAlign='right'; ctx.textBaseline='bottom';
    if (c.wmShadow>0){ ctx.shadowColor='rgba(0,0,0,'+(c.wmShadow/100)+')'; ctx.shadowBlur=Math.max(1,Math.round(fs*0.35)); ctx.shadowOffsetY=Math.max(1,Math.round(fs*0.06)); }
    const mg=Math.round(ref*c.wmMargin/1000); ctx.fillText(c.wmText,W-mg,H-mg);
    ctx.restore();
  }
  async function _drawCardImg(ctx,card,x,y,CW,CH,RAD){
    ctx.fillStyle='#1a1a26'; ctx.beginPath(); ctx.roundRect(x,y,CW,CH,RAD); ctx.fill();
    if (card.image || card.id){ try { const img=await loadImage(window.cardImage?window.cardImage(card):card.image, card);
      ctx.save(); ctx.beginPath(); ctx.roundRect(x,y,CW,CH,RAD); ctx.clip(); ctx.drawImage(img,x,y,CW,CH); ctx.restore(); return 0;
    } catch(e){} }
    drawCardPlaceholder(ctx,x,y,CW,CH,card.name||'?'); return 1;
  }
  // ── Código 2D dentro de la imagen del mazo (el que lee Pokémon TCG Pocket) ──
  // NO se encaja dentro de la imagen: ESTIRA el lienzo (a lo ancho en horizontal y
  // línea, a lo alto en vertical) para que el QR salga GRANDE. Su lado = el del bloque
  // de cartas (alto de las filas en horizontal, ancho en vertical) y respira con el
  // mismo aire de fondo que ya tiene el mazo.
  function deckQRPayload(deck){
    try { return (window.pbDeckQR && window.qrcode) ? (window.pbDeckQR._payloadFor(deck||{}).payload || null) : null; }
    catch(e){ return null; }
  }
  const QR_MIN_GAP = 60;                                  // ‰ del lado corto: aire mínimo alrededor del QR
  function _drawQRPanel(ctx,payload,x,y,side){
    const cv=document.createElement('canvas');
    window.pbDeckQR._draw(cv, payload, Math.round(side*0.96));
    const rad=Math.round(side*0.045), inset=Math.round(side*0.02);   // el inset deja intacta la zona muda al redondear
    ctx.save();
    ctx.fillStyle='#ffffff'; ctx.beginPath(); ctx.roundRect(x,y,side,side,rad); ctx.fill();
    ctx.drawImage(cv, x+inset, y+inset, side-inset*2, side-inset*2);
    ctx.restore();
  }
  // Dibuja la imagen de mazo en `canvas`. format: horizontal|vertical|line · transparent: sin fondo
  async function drawDeckImageToCanvas(canvas, deck, format, showEnergy, transparent, withQR){
    const c = DECK_IMG_CFG[format] || DECK_IMG_CFG.horizontal;
    const deckEnergy = (((deck.energyTypes&&deck.energyTypes.length)?deck.energyTypes:(window.inferDeckEnergies?window.inferDeckEnergies(deck.cards||[]):[]))||[]).filter(t=>_EN2ICON[t]).slice(0,3);
    const bgIconKeys = deckEnergy.length ? deckEnergy.map(t=>_EN2ICON[t]) : ['C'];
    const pillTypes = showEnergy ? deckEnergy : [];
    if (!transparent) for (const k of bgIconKeys) await _symbolTile(k, c.iconSize, c.iconColor);
    const cards=(deck.cards||[]).slice(0,20);
    const sorted=[...cards].sort((a,b)=>{const ap=window.isPokemonCard(a),bp=window.isPokemonCard(b);if(ap!==bp)return ap?-1:1;if(ap&&bp){const st=x=>x.stage==='basic'||x.stage===0?0:(x.stage===1?1:(x.stage===2?2:0));return st(a)-st(b);}return 0;});
    const counts={}; sorted.forEach(x=>counts[x.name]=(counts[x.name]||0)+1);
    const seen=new Set(),unique=[]; sorted.forEach(x=>{if(!seen.has(x.name)){seen.add(x.name);unique.push(x);}});
    const ctx=canvas.getContext('2d'); let failed=0;
    // El QR no aplica al formato de una línea (la tira es larguísima y el código quedaría ridículo)
    const qrPay = (withQR && format!=='line') ? deckQRPayload(deck) : null;
    if (format==='line'){
      const CW=200,CH=Math.round(CW*EIMG_RATIO),PAD=Math.round(CW*0.04),M=c.margin;
      const hasE=pillTypes.length>0, slotW=hasE?PAD+CW:0;
      const W=Math.max(1,sorted.length)*CW+(sorted.length-1)*PAD+slotW+M*2, H=CH+M*2;
      canvas.width=W; canvas.height=H;
      ctx.clearRect(0,0,W,H);
      if (!transparent) _drawImgBg(ctx,W,H,c,bgIconKeys);
      for (let i=0;i<sorted.length;i++) failed+=await _drawCardImg(ctx,sorted[i],M+i*(CW+PAD),M,CW,CH,Math.round(CW*0.05));
      if (hasE) await _drawLineEnergySlot(ctx, M+sorted.length*(CW+PAD), M, CW, CH, pillTypes);
      _drawWatermark(ctx,W,H,c);
      return { failed, qr: null };
    }
    const W=format==='vertical'?1080:1920, H=format==='vertical'?1920:1080;
    const cols=format==='vertical'?4:Math.ceil(unique.length/2);
    const rows=[]; for(let i=0;i<unique.length;i+=cols) rows.push(unique.slice(i,i+cols));
    const M=c.margin, maxRow=Math.max(...rows.map(r=>r.length),1), G=0.04;
    // reserva de la pill de energía (arriba) + margen SUMADO → el margen es efectivo desde 0 y sigue centrado
    const _eod=Math.round(W*((c.energySize||32)/1000));
    const pillBand = pillTypes.length ? (Math.round(W*0.02)+_eod+Math.round(_eod*0.36)*2+Math.round(W*0.015)) : 0;
    const vInset=pillBand+M, availH=Math.max(60,H-2*vInset);
    const fitW=(W-M*2)/(maxRow+(maxRow-1)*G), fitH=availH/((rows.length+(rows.length-1)*G)*EIMG_RATIO);
    const CW=Math.floor(Math.min(fitW,fitH)),CH=Math.round(CW*EIMG_RATIO),GAP=Math.round(CW*G),RAD=Math.round(CW*0.05);
    const blockH=rows.length*CH+(rows.length-1)*GAP, blockW=Math.max(...rows.map(r=>r.length*CW+(r.length-1)*GAP),0);
    const airX=Math.round((W-blockW)/2), minGap=Math.round(Math.min(W,H)*QR_MIN_GAP/1000);
    // El QR alarga el lienzo por su eje. El aire que lo separa del mazo = el que el bloque
    // de cartas ya tiene por el OTRO eje → el QR queda con el mismo margen por sus 4 lados.
    const gap=qrPay?Math.max(minGap,format==='vertical'?airX:Math.round((H-blockH)/2)):0;
    // En vertical el mazo va centrado a lo alto: con QR eso dejaba una franja vacía enorme
    // entre ambos → se sube el bloque justo bajo la pill de energía y todo respira igual.
    const top=(qrPay&&format==='vertical')?Math.max(pillBand+M,gap):Math.round((H-blockH)/2);
    // En vertical el bloque de cartas llena el ancho: el QR se encoge para dejar su mismo aire a los lados
    const qrSide=qrPay?(format==='vertical'?Math.min(blockW,W-2*gap):blockH):0;
    const qrX=qrPay?(format==='vertical'?Math.round((W-qrSide)/2):airX+blockW+gap):0;
    const qrY=qrPay?(format==='vertical'?top+blockH+gap:top):0;
    const Wt=(qrPay&&format!=='vertical')?qrX+qrSide+gap:W;
    const Ht=(qrPay&&format==='vertical')?qrY+qrSide+gap:H;
    canvas.width=Wt; canvas.height=Ht;
    ctx.clearRect(0,0,Wt,Ht);
    if (!transparent) _drawImgBg(ctx,Wt,Ht,c,bgIconKeys);
    for (let r=0;r<rows.length;r++){const row=rows[r],rowW=row.length*CW+(row.length-1)*GAP,x0=(W-rowW)/2,y=top+r*(CH+GAP);
      for (let i=0;i<row.length;i++){const x=x0+i*(CW+GAP),card=row[i];
        if (c.cardShadow>0){ctx.save();ctx.shadowColor='rgba(0,0,0,'+(c.cardShadow/100)+')';ctx.shadowBlur=CW*0.09;ctx.shadowOffsetY=CW*0.05;ctx.fillStyle='#000';ctx.beginPath();ctx.roundRect(x,y,CW,CH,RAD);ctx.fill();ctx.restore();}
        failed+=await _drawCardImg(ctx,card,x,y,CW,CH,RAD);
        const cnt=counts[card.name]||1; if (cnt>1||c.showOnes) _drawBadge(ctx,x,y,CW,CH,cnt,c);}}
    if (pillTypes.length) await _drawEnergyPill(ctx,W,pillTypes,c);
    if (qrPay) _drawQRPanel(ctx,qrPay,qrX,qrY,qrSide);
    _drawWatermark(ctx,Wt,Ht,c,Math.min(W,H*3));
    return { failed, qr: qrPay?{x:qrX,y:qrY,side:qrSide}:null };
  }
  async function renderDeckPNG(deck, format, showEnergy, transparent, withQR){
    if (!(deck.cards||[]).length){ showToast(T('deck.empty')); return; }
    showToast(T('mazos.generating'));
    const canvas=document.createElement('canvas');
    const { failed } = await drawDeckImageToCanvas(canvas, deck, format||'horizontal', showEnergy!==false, !!transparent, !!withQR);
    if (failed) showToast(T('mazos.corsWarn'),4000);
    try { const link=document.createElement('a');
      link.download=sanitizeFilename(deck.name||'mazo')+(format&&format!=='horizontal'?'_'+format:'')+(transparent?'_transp':'')+(withQR?'_qr':'')+'.png';
      link.href=canvas.toDataURL('image/png'); link.click();
      if (!failed) showToast(T('mazos.imgDownloaded'));
    } catch(e){ showToast(T('mazos.dlError'),3000); console.error('[mazos-view] renderDeckPNG error:',e); }
  }
  // Diálogo: preview grande 16:9 (todos los formatos caben dentro) + controles en UNA fila sin labels
  function openExportOptions(deck){
    const FORMATS=[{id:'horizontal',label:T('mazos.fmtHorizontal')},{id:'vertical',label:T('mazos.fmtVertical')},{id:'line',label:T('mazos.fmtLine')}];
    const hasEnergy=!!(deck.energyTypes&&deck.energyTypes.length);
    const canQR=!!deckQRPayload(deck);
    // En móvil la imagen vertical (retrato) llena la pantalla → por defecto vertical; en escritorio, horizontal.
    let format=isMobile()?'vertical':'horizontal', showEnergy=hasEnergy, transparent=false, withQR=false;
    const overlay=document.createElement('div'); overlay.className='pb-modal-overlay';
    const box=document.createElement('div'); box.className='pb-modal mz-dlimg-modal';
    const title=document.createElement('div'); title.className='pb-modal-title'; title.textContent=T('mazos.dlTitle');
    const prevWrap=document.createElement('div'); prevWrap.className='mz-dlimg-preview';
    const prevCanvas=document.createElement('canvas'); prevWrap.appendChild(prevCanvas);
    // Overlay de «procesando»: mientras se dibuja la imagen ENTERA en el lienzo, se oculta y se
    // muestra un spinner → se revela ya terminada (no se ve dibujarse carta a carta).
    const loadEl=document.createElement('div'); loadEl.className='mz-dlimg-loading'; loadEl.innerHTML='<div class="mz-dlimg-spin"></div>'; prevWrap.appendChild(loadEl);
    const dims=document.createElement('div'); dims.className='mz-dlimg-dims';
    let renderTok=0;
    async function refresh(){
      const my=++renderTok;
      loadEl.classList.add('on'); prevCanvas.style.visibility='hidden';
      await drawDeckImageToCanvas(prevCanvas, deck, format, showEnergy, transparent, withQR);
      if(my!==renderTok) return;   // llegó otra petición más nueva
      dims.textContent = prevCanvas.width+' × '+prevCanvas.height;   // el QR alarga el lienzo → medidas reales
      loadEl.classList.remove('on'); prevCanvas.style.visibility='visible';
    }
    function seg(options, getter, setter){
      const grp=document.createElement('div'); grp.className='cv-chip-group';
      options.forEach(o=>{const b=document.createElement('button'); b.type='button'; b.className='cv-chip'+(getter()===o.id?' active':''); b.textContent=o.label;
        b.onclick=()=>{setter(o.id);grp.querySelectorAll('.cv-chip').forEach(x=>x.classList.remove('active'));b.classList.add('active');refresh();};
        grp.appendChild(b);});
      return grp;
    }
    const controls=document.createElement('div'); controls.className='mz-dlimg-controls';
    let qrGroup=null;
    // «Una línea» no admite QR → el par se apaga y vuelve a «Sin QR»
    function syncQR(){
      if (!qrGroup) return;
      const off = format==='line';
      qrGroup.classList.toggle('mz-seg-off', off);
      const chips=qrGroup.querySelectorAll('.cv-chip');
      chips.forEach(b=>{ b.disabled=off; });
      if (off && withQR){ withQR=false; chips[0].classList.add('active'); chips[1].classList.remove('active'); }
    }
    controls.appendChild(seg(FORMATS, ()=>format, v=>{format=v;syncQR();}));
    if (hasEnergy) controls.appendChild(seg([{id:true,label:T('mazos.energyWith')},{id:false,label:T('mazos.energyWithout')}], ()=>showEnergy, v=>showEnergy=v));
    if (canQR){ qrGroup=seg([{id:false,label:T('mazos.qrWithout')},{id:true,label:T('mazos.qrWith')}], ()=>withQR, v=>withQR=v); controls.appendChild(qrGroup); syncQR(); }
    controls.appendChild(seg([{id:false,label:T('mazos.bgBranded')},{id:true,label:T('mazos.bgTransparent')}], ()=>transparent, v=>transparent=v));
    const actions=document.createElement('div'); actions.className='pb-modal-actions';
    const cancel=document.createElement('button'); cancel.className='pb-btn'; cancel.textContent=T('common.cancel');
    const ok=document.createElement('button'); ok.className='pb-btn pb-btn-primary'; ok.textContent=T('mazos.download');
    function close(){document.removeEventListener('keydown',_esc,true);overlay.classList.remove('open');setTimeout(()=>overlay.remove(),180);}
    function _esc(e){if(e.key==='Escape'){e.stopPropagation();close();}}
    document.addEventListener('keydown',_esc,true);
    cancel.onclick=close; overlay.addEventListener('click',e=>{if(e.target===overlay)close();});
    ok.onclick=()=>{ close(); renderDeckPNG(deck, format, showEnergy, transparent, withQR); };
    actions.appendChild(cancel); actions.appendChild(ok);
    box.appendChild(title); box.appendChild(prevWrap); box.appendChild(dims); box.appendChild(controls); box.appendChild(actions);
    overlay.appendChild(box); document.body.appendChild(overlay);
    requestAnimationFrame(()=>{ overlay.classList.add('open'); refresh(); });
  }

  // Carga con crossOrigin (canvas sin manchar) probando TODAS las URLs de la carta.
  // Cada URL remota se reintenta una vez con cache-buster: si el CDN tiene cacheada
  // una respuesta SIN cabecera CORS, la petición nueva la esquiva (otra clave de caché).
  function tryLoadImg(url) {
    return new Promise(resolve => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  async function loadImage(src, card) {
    const cands = (card && window.cardImageCandidates) ? window.cardImageCandidates(card) : [];
    if (src && cands.indexOf(src) < 0) cands.unshift(src);
    for (const u of cands) {
      let im = await tryLoadImg(u);
      if (!im && /^https?:/i.test(u)) im = await tryLoadImg(u + (u.indexOf('?') >= 0 ? '&' : '?') + 'cors=1');
      if (im) return im;
    }
    throw new Error('img load failed: ' + (src || (card && card.id)));
  }

  function drawRoundRect(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawCardPlaceholder(ctx, x, y, w, h, name) {
    ctx.fillStyle = '#252535';
    if (ctx.roundRect) {
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill();
    } else {
      ctx.fillRect(x, y, w, h);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Word-wrap name at ~20 chars
    const words = (name || '?').split(' ');
    let line = '';
    const lines = [];
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if (test.length > 18 && line) { lines.push(line); line = w; }
      else line = test;
    });
    if (line) lines.push(line);
    const ly = y + h / 2 - (lines.length - 1) * 9;
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, ly + i * 18));
  }

  function sanitizeFilename(name) {
    return name.replace(/[^a-z0-9_\-\. ]/gi, '_').replace(/\s+/g, '_').slice(0, 60);
  }

  // ── Toast — delega en el toast global de shared.js ─────────────
  function showToast(msg, duration) {
    window.pbToast && window.pbToast(msg, duration);
  }

  // ── Date helper ───────────────────────────────────────────────
  function formatDate(ts) {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString(uiLocale(), { day:'2-digit', month:'short', year:'numeric' });
    } catch(e) { return ''; }
  }

  // Origen del mazo (draft / manual / meta) → línea de fecha «Drafteado/Construido/Guardado el <fecha>».
  // Retrocompat: mazos ya guardados sin `source` → meta si llevan `_meta`, si no manual.
  // (Un mazo importado por link se guarda como «manual»: es una lista construida.)
  function deckSource(deck) {
    if (!deck) return 'manual';
    if (deck.source) return deck.source;
    if (deck._meta) return 'meta';
    // Retrocompat: los mazos de draft antiguos (sin `source`) conservaban el nombre
    // por defecto «Draft <fecha>» (prefijo fijo en todos los idiomas) → los reconocemos.
    if (/^draft /i.test(deck.name || '')) return 'draft';
    return 'manual';
  }
  function deckDateLine(deck) {
    if (!deck || !deck.savedAt) return '';
    const date = formatDate(deck.savedAt);
    const src = deckSource(deck);
    const key = src === 'draft' ? 'mazos.dateDrafted'
              : src === 'meta'  ? 'mazos.dateSaved'
                                : 'mazos.dateBuilt';
    return T(key, { date });
  }

  // ════ SECCIÓN META — Mejores mazos (datos de Limitless) ════════
  const pct = x => (x == null ? '—' : (x * 100).toFixed(1) + '%');
  const pctNum = x => (x == null ? '—' : (x * 100).toFixed(1));   // sin el «%» (lo dice la cabecera)
  const fmtNum = n => { try { return Number(n).toLocaleString(uiLocale()); } catch (e) { return '' + n; } };
  // "hace 1 día" / "1 day ago" / "1日前" — hace que el dato se sienta fresco, no offline
  function relTime(iso, short) {
    try {
      const s = (Date.now() - new Date(iso).getTime()) / 1000;
      const rtf = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'auto', style: short ? 'short' : 'long' });
      const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
      for (const [u, sec] of units) { if (Math.abs(s) >= sec || u === 'minute') return rtf.format(-Math.round(s / sec), u); }
    } catch (e) {}
    return formatDate((iso || '').slice(0, 10));
  }
  const wrClass = w => (w >= 0.52 ? 'pos' : (w < 0.48 ? 'neg' : 'mid'));
  // Winrate en espectro continuo rojo→verde según el número (40%→rojo · 50%→ámbar · 60%→verde)
  // Color del winrate. La rampa vieja repartía rojo→verde entre 40% y 60% pasando por
  // AMARILLO en el centro, y como el meta real vive entre 45% y 53% salían todos amarillos.
  // Ahora: neutro exacto en 50% y se aleja hacia rojo o verde SIN pasar por amarillo, con
  // la banda estrecha (±WR_BAND puntos = color pleno) para que el cambio se note.
  // `games` atenúa el color cuando la muestra es corta: un 56% con 30 partidas no puede
  // gritar igual que uno con 3.000. Subir WR_BAND = menos dramático.
  // Ajustes del tuner (meta_tuner.html → «Aplicar a la app»). Si no hay nada guardado,
  // manda lo que dice el CSS/estas constantes. Es solo para calibrar: lo definitivo se
  // pega en css/mazos-view.css con el botón «Copiar CSS».
  const META_TUNE_KEY = 'pocketboard_meta_tune_v1';
  let _metaTune = null, _metaTuneRead = false;
  function metaTune() {
    if (!_metaTuneRead) {
      _metaTuneRead = true;
      try { _metaTune = JSON.parse(localStorage.getItem(META_TUNE_KEY) || 'null'); } catch (e) { _metaTune = null; }
    }
    return _metaTune;
  }
  // Los ajustes del tuner son DOS JUEGOS INDEPENDIENTES: el de escritorio en la raíz y el
  // de móvil en `.mobile`. Se aplican como estilo en línea, así que ganan a la media query
  // del CSS — por eso no puede haber uno solo: un tuneo de escritorio (miniaturas grandes)
  // se colaba tal cual en el móvil y se comía la tarjeta entera.
  const MC_PX = { h: '--mc-h', name: '--mc-name', thumb: '--mc-thumb', overlap: '--mc-overlap',
                  thumbx: '--mc-thumb-x', thumby: '--mc-thumb-y', gap: '--mc-gap', numgap: '--mc-numgap',
                  rkx: '--mc-rk-x', trendw: '--mc-trendw', trendgap: '--mc-trendgap', arrowx: '--mc-arrow-x',
                  radius: '--mc-radius', padx: '--mc-padx', rowgap: '--mc-rowgap', bar: '--mc-bar',
                  thumbr: '--mc-thumb-r', rkf: '--mc-rkf', usef: '--mc-usef', wrf: '--mc-wrf',
                  gamesf: '--mc-gamesf', trendf: '--mc-trendf', headf: '--mc-headf', shb: '--mc-shb', rkshb: '--mc-rkshb' };
  // Columnas en ORDEN. El tuner guarda SIEMPRE las 6 anchuras y aparte qué se ve: al
  // ocultar una, su celda desaparece del grid (display:none) y su anchura sale de --mz-cols.
  const MC_COLS = ['rank', 'thumb', 'name', 'use', 'wr', 'games'];
  // Opciones que NO son CSS (dependen del texto): su valor por defecto vive aquí, y el
  // tuner solo lo sobrescribe. En móvil el nombre se abrevia y la tendencia va sin número.
  function metaOpt(key) {
    const t = metaTune(), mob = isMobile();
    const v = t ? (mob ? t.mobile : t) : null;
    if (v && v[key] != null) return v[key];
    // Horneados desde el tuner (los ajustó Daniel; el localStorage del tuner solo sirve
    // para calibrar y va por origen, así que lo definitivo vive aquí).
    const DEF = { trendNum: !mob, mega: mob, rocket: mob ? 'tr' : 'off',
                  nameLines: mob ? 2 : 1, wrPct: !mob, wrmix: 0 };
    return DEF[key];
  }
  // Nombre del arquetipo abreviado (SOLO en la lista del meta): «Mega Absol ex» → «M. Absol
  // ex», y «Team Rocket's Persian» → «Rocket's Persian» o «TR Persian». Los nombres vienen
  // de Limitless en inglés, así que las reglas son sobre el inglés.
  function metaShortName(name) {
    let s = String(name || '');
    if (metaOpt('mega')) s = s.replace(/\bMega[\s-]/g, 'M. ');
    const rk = metaOpt('rocket');
    // el apóstrofo puede venir recto o tipográfico según la fuente
    if (rk === 'rocket') s = s.replace(/\bTeam Rocket(['\u2019]s)?\s/g, (m, p) => (p ? "Rocket's " : 'Rocket '));
    else if (rk === 'tr') s = s.replace(/\bTeam Rocket(['\u2019]s)?\s/g, 'TR ');
    return s;
  }
  window._metaShortName = metaShortName;   // hook de test
  // El nombre del arquetipo es la suma de los nombres de sus cartas protagonistas
  // («Mega Lucario ex» + «Lucario»). Para partirlo en dos líneas se busca el nombre de la
  // SEGUNDA como sufijo (casa en los 165 mazos de 2 protagonistas); si no casa, una línea.
  function metaNameParts(r) {
    const raw = String(r.name || '');
    const p = r.protagonists || [];
    if (metaOpt('nameLines') < 2 || p.length < 2) return [metaShortName(raw)];
    const c2 = window.dbLookup && window.dbLookup({ id: p[1] });
    const n2 = c2 && c2.name;
    if (n2 && raw.length > n2.length && raw.slice(-n2.length) === n2) {
      return [metaShortName(raw.slice(0, -n2.length).trim()), metaShortName(n2)];
    }
    return [metaShortName(raw)];
  }
  window._metaNameParts = metaNameParts;   // hook de test
  function applyMetaTune(wrap) {
    const t = metaTune(); if (!t || !wrap) return;
    // sin juego guardado para este ancho, manda el CSS (que ya trae su propio juego de móvil)
    const v = isMobile() ? t.mobile : t;
    if (!v) return;
    Object.keys(MC_PX).forEach(k => { if (v[k] != null) wrap.style.setProperty(MC_PX[k], v[k] + 'px'); });
    if (v.show) {
      // `mcx-` fuerza ocultar y `mcs-` fuerza mostrar (hace falta lo segundo porque el CSS
      // de móvil esconde «Partidas» por su cuenta). Sin flag no se toca: manda el CSS.
      MC_COLS.forEach(k => {
        const on = v.show[k];
        if (on == null) return;
        wrap.classList.toggle('mcx-' + k, !on);
        wrap.classList.toggle('mcs-' + k, !!on);
      });
      if (v.show.trend != null) wrap.classList.toggle('mcx-trend', !v.show.trend);
    }
    if (v.tilt != null) wrap.style.setProperty('--mc-tilt', v.tilt + 'deg');
    if (v.rkalign) wrap.style.setProperty('--mc-rk-align', v.rkalign);
    if (v.arty != null) wrap.style.setProperty('--mc-art-y', v.arty + '%');
    if (v.artzoom != null) wrap.style.setProperty('--mc-art-zoom', v.artzoom + '%');
    if (v.artdim != null) wrap.style.setProperty('--mc-art-dim', v.artdim);
    if (v.scrim != null) wrap.style.setProperty('--mc-scrim', v.scrim);
    if (v.sho != null) wrap.style.setProperty('--mc-sho', v.sho);
    if (v.rko != null) wrap.style.setProperty('--mc-rko', v.rko);
    if (v.rkw != null) wrap.style.setProperty('--mc-rkw', v.rkw);
    if (v.rksho != null) wrap.style.setProperty('--mc-rksho', v.rksho);
    if (v.baro != null) wrap.style.setProperty('--mc-baro', v.baro);
    if (v.namelh != null) wrap.style.setProperty('--mc-namelh', v.namelh);
    // 0 = sin límite (el nombre usa toda su columna)
    if (v.namemax != null) wrap.style.setProperty('--mc-namemax', v.namemax > 0 ? v.namemax + 'px' : 'none');
    if (v.cols) {
      const parts = String(v.cols).trim().split(/\s+/);
      // 6 anchuras + flags = se aplican solo las de las columnas visibles; si el ajuste es
      // de una versión anterior (5 anchuras ya filtradas) se usa tal cual
      const cols = (parts.length === MC_COLS.length && v.show)
        ? parts.filter((_, i) => v.show[MC_COLS[i]] !== false).join(' ')
        : v.cols;
      wrap.style.setProperty('--mz-cols', cols);
    }
    if (v.show && v.show.trend === false) wrap.style.setProperty('--mc-trendw', '0px');
  }
  const WR_BAND = 0.02, WR_CONF = 400;
  const wrColor = (w, games) => {
    if (w == null) return 'rgba(255,255,255,0.85)';
    const tune = metaTune();
    const band = (tune && tune.band != null) ? tune.band / 100 : WR_BAND;
    const conf = (tune && tune.conf != null) ? tune.conf : WR_CONF;
    const t = Math.max(-1, Math.min(1, (w - 0.5) / band));
    let k = Math.pow(Math.abs(t), 0.68);                       // sale antes del neutro: sin grises turbios
    if (games != null && conf > 0) k *= 0.42 + 0.58 * Math.min(1, games / conf);
    const to = t >= 0 ? [55, 214, 122] : [255, 90, 90];
    // `wrmix` lo aclara hacia blanco: sobre el arte, el color pleno a veces se lee peor
    const mix = Math.max(0, Math.min(1, Number(metaOpt('wrmix')) || 0));
    const c = [0,1,2].map(i => {
      const v = 150 + (to[i] - 150) * k;
      return Math.round(v + (255 - v) * mix);
    });
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ── Tooltip reutilizable (escritorio = hover · móvil = tocar) ──────────────
  // Un único globo flotante; los elementos lo activan con data-mztip="…" (acepta
  // <b>). Los que llevan data-mztip-tap también lo abren al tocar (filas sin otra
  // acción). Estética Cartas: superficie oscura neutra, system-ui, sin azules.
  let _mzTipEl = null, _mzTipFor = null;
  function mzTipEl() {
    if (!_mzTipEl) { _mzTipEl = document.createElement('div'); _mzTipEl.className = 'mz-tip'; document.body.appendChild(_mzTipEl); }
    return _mzTipEl;
  }
  function mzTipShow(t) {
    const txt = t.getAttribute('data-mztip'); if (!txt) return;
    const el = mzTipEl();
    el.innerHTML = txt;
    el.classList.add('show');
    _mzTipFor = t;
    el.style.left = '0px'; el.style.top = '0px';                 // medir sin clamp previo
    const r = t.getBoundingClientRect(), b = el.getBoundingClientRect();
    let left = r.left + r.width / 2 - b.width / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - b.width - 8));
    let top = r.top - b.height - 9, below = false;
    if (top < 8) { top = r.bottom + 9; below = true; }
    el.style.left = left + 'px'; el.style.top = top + 'px';
    el.classList.toggle('below', below);
    el.style.setProperty('--mztip-ax', Math.max(12, Math.min(r.left + r.width / 2 - left, b.width - 12)) + 'px');
  }
  function mzTipHide() { if (_mzTipEl) _mzTipEl.classList.remove('show'); _mzTipFor = null; }
  if (!window._mzTipWired) {
    window._mzTipWired = true;
    document.addEventListener('mouseover', e => { const t = e.target.closest && e.target.closest('[data-mztip]'); if (t) mzTipShow(t); });
    document.addEventListener('mouseout',  e => { const t = e.target.closest && e.target.closest('[data-mztip]'); if (t && t === _mzTipFor) mzTipHide(); });
    document.addEventListener('click', e => {
      const t = e.target.closest && e.target.closest('[data-mztip-tap]');
      if (t) { if (_mzTipFor === t) mzTipHide(); else mzTipShow(t); return; }
      if (!e.target.closest || !e.target.closest('.mz-tip')) mzTipHide();
    });
    window.addEventListener('scroll', mzTipHide, true);
  }

  // Índice id→carta sobre la DB base (CARDS_DB ya está cargada antes que esta vista)
  let _metaCardIdx = null, _metaNameIdx = null;
  function metaCardById(id) {
    if (!_metaCardIdx) {
      _metaCardIdx = {}; _metaNameIdx = {};
      (window.CARDS_DB || []).forEach(c => {
        _metaCardIdx[c.id] = c;
        if (!_metaNameIdx[c.name]) _metaNameIdx[c.name] = c; // primera impresión por nombre (para raíz de línea)
      });
      // Las CUSTOM viven fuera de CARDS_DB a propósito, pero SÍ son cartas de un mazo: sin esto
      // se resolvían a null y se pintaban como hueco vacío (sin arte, sin nombre y sin zoom)
      // aunque contaran en el mazo. Solo por ID: el índice por nombre es para las líneas evolutivas.
      (window.CUSTOM_CARDS || []).forEach(c => { _metaCardIdx[c.id] = c; });
    }
    return _metaCardIdx[id] || null;
  }

  // ── Orden canónico de un mazo ──
  // Pokémon (por tipo de la línea → línea junta → fase MÁS ALTA primero) · Partidario · Objeto · Herramienta · Estadio
  const DECK_EL_ORDER = ['grass','fire','water','lightning','psychic','fighting','darkness','metal','dragon','colorless'];
  const DECK_CT_ORDER = { pokemon: 0, supporter: 1, item: 2, fossil: 2, tool: 3, stadium: 4 };
  const stageRankOf = c => { const s = c && c.stage; return s === 2 ? 2 : (s === 1 ? 1 : 0); };
  function lineRootOf(card) {
    metaCardById('');                       // asegura _metaNameIdx
    let cur = card, guard = 0;
    while (cur && cur.evolvesFrom && guard++ < 6) {
      const pre = _metaNameIdx[cur.evolvesFrom];
      if (!pre) break; cur = pre;
    }
    return cur ? cur.name : (card ? card.name : '');
  }
  function sortDeckCards(cards) {
    const info = (cards || []).map(c => {
      const card = metaCardById(c.id) || {};
      const isPk = window.isPokemonCard ? window.isPokemonCard(card) : card.cardType === 'pokemon';
      return { c, card, isPk, root: isPk ? lineRootOf(card) : null };
    });
    // elemento de cada línea = el de su carta de fase MÁS ALTA (el protagonista de la línea)
    const lineEl = {};
    info.forEach(it => {
      if (!it.isPk) return;
      const st = stageRankOf(it.card), cur = lineEl[it.root];
      if (!cur || st > cur.st) lineEl[it.root] = { st, el: it.card.element || 'colorless' };
    });
    const elRank = el => { const i = DECK_EL_ORDER.indexOf(el); return i < 0 ? 99 : i; };
    const key = it => {
      const ct = DECK_CT_ORDER[it.card.cardType] != null ? DECK_CT_ORDER[it.card.cardType] : 8;
      if (it.isPk) {
        const le = lineEl[it.root] ? lineEl[it.root].el : 'colorless';
        return [0, elRank(le), it.root || '', -stageRankOf(it.card), it.card.name || ''];
      }
      return [ct, 0, '', 0, it.card.name || ''];
    };
    return info.map(it => ({ it, k: key(it) }))
      .sort((a, b) => { for (let i = 0; i < a.k.length; i++) { if (a.k[i] < b.k[i]) return -1; if (a.k[i] > b.k[i]) return 1; } return 0; })
      .map(x => x.it.c);
  }

  // Expande [{id,count}] del meta a array de 20 objetos-carta (clonados de la DB)
  function expandMetaCards(row) {
    const out = [];
    (row.cards || []).forEach(c => {
      const base = c.id ? metaCardById(c.id) : null;
      const n = c.count || 1;
      for (let i = 0; i < n; i++) {
        out.push(base ? Object.assign({}, base) : { id: c.id || '', name: c.name || '', cardType: 'pokemon' });
      }
    });
    return out;
  }

  // Da forma a una fila del meta como objeto "deck" (reutiliza todo el detalle existente)
  function buildMetaDeck(row) {
    const cards = expandMetaCards(row);
    // Energía de la zona = `row.energy`: la energía REAL que declaran las listas de Limitless
    // (modal del arquetipo), NO el color de los Pokémon (`row.types`: un Greninja jugado por su
    // habilidad hace que un mazo "fire+water" por color sea fire-only real) ni la inferida por
    // costes de ataque (que se equivoca). Orden: energy real → color → inferencia.
    const TYPED = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'];
    let energyTypes = (row.energy || []).filter(t => TYPED.indexOf(t) >= 0);
    if (!energyTypes.length) energyTypes = (row.types || []).filter(t => TYPED.indexOf(t) >= 0);
    if (!energyTypes.length) {
      try { energyTypes = window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(cards)) : []; } catch (e) {}
    }
    energyTypes = energyTypes.slice(0, 3);   // tope de 3 energías en toda la web
    return {
      name: row.name,
      cards: cards,
      energyTypes: energyTypes,
      firstCardImg: (cards[0] && cards[0].image) || '',
      _isMeta: true,
      _row: row,
      _meta: { share: row.share, winrate: row.winrate, games: row.games,
               protagonists: row.protagonists || [], icons: row.icons || [] },
    };
  }

  // Las 2 cartas protagonistas (ids EXACTOS que guardó el pipeline desde el mazo)
  function archCardsFor(deck) {
    return ((deck._meta && deck._meta.protagonists) || []).map(metaCardById).filter(Boolean);
  }

  // Imagen de arquetipo: tamaño carta, corte horizontal, mitad superior de cada protagonista
  function archImageHTML(deck) {
    const prot = archCardsFor(deck);
    const img = c => (window.cardImage ? window.cardImage(c) : c.image) || c.image || '';
    const a = prot[0], b = prot[1];
    if (a && b) {
      return `<div class="mz-arch">
        <div class="mz-arch-h top" style="background-image:url('${img(a)}')"></div>
        <div class="mz-arch-h bot" style="background-image:url('${img(b)}')"></div>
        <div class="mz-arch-seam"></div></div>`;
    }
    if (a) return `<div class="mz-arch"><div class="mz-arch-h full" style="background-image:url('${img(a)}')"></div></div>`;
    return `<div class="mz-arch"></div>`;
  }

  // Imagen de arquetipo a partir de los ids de protagonista (sin construir el mazo)
  function archImageHTMLIds(ids) {
    const cards = (ids || []).map(metaCardById).filter(Boolean);
    const img = c => (window.cardImage ? window.cardImage(c) : c.image) || c.image || '';
    const a = cards[0], b = cards[1];
    if (a && b) {
      return `<div class="mz-arch">
        <div class="mz-arch-h top" style="background-image:url('${img(a)}')"></div>
        <div class="mz-arch-h bot" style="background-image:url('${img(b)}')"></div>
        <div class="mz-arch-seam"></div></div>`;
    }
    if (a) return `<div class="mz-arch"><div class="mz-arch-h full" style="background-image:url('${img(a)}')"></div></div>`;
    return `<div class="mz-arch"></div>`;
  }

  // En la tabla del meta: las dos cartas protagonistas COMPLETAS, lado a lado
  function archTwoCardsHTML(ids) {
    const cards = (ids || []).map(metaCardById).filter(Boolean);
    const img = c => (window.cardImage ? window.cardImage(c) : c.image) || c.image || '';
    return `<div class="mz-tcards">` +
      cards.map(c => `<img class="mz-tcard" src="${img(c)}" loading="lazy" onerror="this.style.display='none'">`).join('') +
      `</div>`;
  }

  // Texto descriptivo del tooltip de tendencia (situación exacta del mazo)
  function trendTip(r) {
    const now = r.tRecent, prev = r.tPrev;
    if (r.new || !prev) return T('mazos.metaTrendNew', { deck: r.name, now: pct(now || 0) });
    if (now == null) return '';
    const pp = (now - prev) * 100;
    const rel = Math.round(Math.abs((now - prev) / prev) * 100);
    const vars = { deck: r.name, prev: pct(prev), now: pct(now), pp: Math.abs(pp).toFixed(1), rel: rel };
    return (pp >= 0 ? T('mazos.metaTrendUp', vars) : T('mazos.metaTrendDown', vars));
  }
  // Indicador (en su columna): ▲ sube · ▼ baja · punto holo = nuevo
  // `num=false` deja SOLO la flecha (en móvil el número concreto no aporta y se come el
  // ancho que necesita el nombre del mazo).
  function trendHTML(r, num) {
    if (num === undefined) num = true;
    if (r.new) return `<span class="mz-newbadge" title="${esc(trendTip(r))}">${esc(T('mazos.metaNewBadge'))}</span>`;
    const t = r.trend;
    if (t == null) return '';
    const pp = t * 100;
    if (pp >= 0.2)  return `<span class="mz-trend up" title="${esc(trendTip(r))}">▲${num ? ' ' + pp.toFixed(1) : ''}</span>`;
    if (pp <= -0.2) return `<span class="mz-trend down" title="${esc(trendTip(r))}">▼${num ? ' ' + Math.abs(pp).toFixed(1) : ''}</span>`;
    return '';
  }

  // ── Barra de filtros del meta (búsqueda + chips + tipos), construida una vez ──
  const META_TYPE_ORDER = ['grass','fire','water','lightning','psychic','fighting','darkness','metal','dragon'];
  function metaTypesPresent() {
    const present = new Set();
    metaRows().forEach(r => (r.types || []).forEach(t => present.add(t)));
    return META_TYPE_ORDER.filter(t => present.has(t));
  }
  function ensureMetaFilters() {
    const host = document.getElementById('mz-meta-filters');
    if (!host || host._built) return host;
    host._built = true;
    // Buscador principal (por NOMBRE del mazo) = el MISMO componente que el de Cartas:
    // .pb-search-wrap con su lupa y su ✕, no una caja pelada aparte.
    const sw = document.createElement('div');
    sw.className = 'pb-search-wrap mz-search-wrap';
    sw.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none">'
      + '<circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.5"/>'
      + '<line x1="10.5" y1="10.5" x2="14.5" y2="14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    const search = document.createElement('input');
    search.id = 'mz-meta-search'; search.type = 'text';
    search.className = 'pb-search-input'; search.autocomplete = 'off';
    const sClear = document.createElement('span');
    sClear.className = 'pb-search-clear'; sClear.id = 'mz-meta-search-clear'; sClear.textContent = '✕';
    const syncClear = () => { sClear.style.visibility = search.value ? 'visible' : 'hidden'; };
    search.addEventListener('input', () => { _metaSearch = search.value.trim().toLowerCase(); syncClear(); renderMetaGrid(); });
    sClear.addEventListener('click', () => { search.value = ''; _metaSearch = ''; syncClear(); renderMetaGrid(); search.focus(); });
    syncClear();
    sw.appendChild(search); sw.appendChild(sClear);
    host.appendChild(sw);
    // Tendencia (Nuevos / En alza / En caída): UNA pill segmentada, estética Cartas (.cv-chip-group)
    const trendG = document.createElement('div'); trendG.className = 'cv-chip-group mz-trend-group';
    [['new', '✦'], ['rising', '▲'], ['falling', '▼']].forEach(([key, icon]) => {
      const c = document.createElement('span');
      c.className = 'cv-chip mz-trend-chip'; c.dataset.q = key;
      c.innerHTML = `<span class="mz-fic">${icon}</span><span class="mz-flabel"></span>`;
      c.addEventListener('click', () => {
        const on = _metaQuick !== key;
        _metaQuick = on ? key : null;
        if (on && window._cvChipBurst) window._cvChipBurst(c, 'trend', key);   // mismo catálogo que Cartas
        syncFilterChips(); renderMetaGrid();
      });
      trendG.appendChild(c);
    });
    host.appendChild(trendG);
    // Tipos de energía: pill segmentada con orbes REALES, igual que el filtro de Cartas (dragón = su icono propio)
    const ORB = { fire: 'R', water: 'W', grass: 'G', lightning: 'L', psychic: 'P', fighting: 'F', darkness: 'D', metal: 'M' };
    const typeG = document.createElement('div'); typeG.className = 'cv-chip-group mz-type-group';
    metaTypesPresent().forEach(el => {
      const b = document.createElement('span');
      b.className = 'cv-chip cv-el-chip cv-el-icon mz-type-chip'; b.dataset.cvEl = el;
      const src = (ORB[el] && window.ENERGY_ICONS && window.ENERGY_ICONS[ORB[el]])
               || (el === 'dragon' ? window.DRAGON_EL_ICON : null);
      b.innerHTML = src
        ? `<img src="${src}" style="width:20px;height:20px;border-radius:50%;pointer-events:none;" draggable="false">`
        : `<span class="cv-eldot el-${el}"></span>`;
      b.addEventListener('click', () => {
        const on = !_metaTypes.has(el);
        on ? _metaTypes.add(el) : _metaTypes.delete(el);
        // mismo estallido que el filtro de energía de Cartas (fuente única _cvChipBurst)
        if (on && window._cvChipBurst) window._cvChipBurst(b, 'el', el);
        syncFilterChips(); renderMetaGrid();
      });
      typeG.appendChild(b);
    });
    host.appendChild(typeG);
    // (aquí vivía una pill de orden solo para móvil; desde que la lista de tarjetas es la
    //  misma en las dos pantallas, se ordena clicando la cabecera de columna también en móvil)
    buildMetaAdvanced(host);
    return host;
  }
  function metaAdvCount() { return (_cardSearch ? 1 : 0) + (_gamesMin != null ? 1 : 0) + (_wrLo != null ? 1 : 0) + (_metaOnlySet ? 1 : 0); }
  function syncAdvCount() {
    const c = document.getElementById('mz-adv-count'); if (!c) return;
    const n = metaAdvCount(); c.textContent = n; c.classList.toggle('on', n > 0);
  }
  window._mzToggleAdvanced = function () {
    const adv = document.getElementById('mz-advanced'), btn = document.getElementById('mz-adv-toggle');
    if (!adv) return;
    const open = !adv.classList.contains('open');
    adv.classList.toggle('open', open);
    if (btn) { btn.classList.toggle('open', open); btn.setAttribute('aria-expanded', String(open)); }
  };
  // Dropdown «Ajustes avanzados» (estética Cartas): buscar por CARTA contenida + sliders de
  // MÍNIMO de partidas (para excluir mazos con pocos datos al ordenar/ver nuevos) + RANGO de WR.
  function buildMetaAdvanced(host) {
    const R = metaRanges();
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = 'mz-adv-toggle'; btn.setAttribute('aria-expanded', 'false');
    // mismo icono y orden que «Búsqueda avanzada» de Cartas
    btn.innerHTML = `<svg class="cv-adv-ico" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h7.2M12.6 4.5h1.4M2 11.5h3.2M8.6 11.5h5.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="11" cy="4.5" r="1.6" stroke="currentColor" stroke-width="1.5"/><circle cx="7" cy="11.5" r="1.6" stroke="currentColor" stroke-width="1.5"/></svg>`
      + `<span id="mz-adv-label"></span><span id="mz-adv-count">0</span>`;
    btn.addEventListener('click', () => window._mzToggleAdvanced && window._mzToggleAdvanced());
    host.appendChild(btn);

    const adv = document.createElement('div'); adv.id = 'mz-advanced';
    adv.innerHTML = `<div id="mz-adv-inner"><div id="mz-adv-body"></div></div>`;
    host.appendChild(adv);
    const body = adv.querySelector('#mz-adv-body');

    // ── Solo desde la última expansión (solo en las fuentes propias: el meta de torneos
    //    ya viene acotado a su ventana desde el pipeline) ──
    const ls = metaLastSet();
    if (metaIsOwn() && ls && ls.release) {
      // Mismo interruptor que Ajustes (div.pb-switch + perilla), no un checkbox pelado.
      const setRow = document.createElement('div');
      setRow.className = 'mz-adv-block mz-adv-switch'; setRow.id = 'mz-adv-setonly';
      setRow.setAttribute('role', 'switch'); setRow.tabIndex = 0;
      const sw = document.createElement('div');
      sw.className = 'pb-switch' + (_metaOnlySet ? ' on' : '');
      sw.innerHTML = '<span class="pb-switch-knob"></span>';
      const txt = document.createElement('span'); txt.className = 'mz-adv-switch-lbl';
      const nombre = (window.setName ? window.setName(ls.code) : '') || ls.name || ls.code;
      txt.textContent = T('mazos.onlyLastSet', { set: nombre });
      const flip = () => {
        _metaOnlySet = !_metaOnlySet;
        sw.classList.toggle('on', _metaOnlySet);
        setRow.setAttribute('aria-checked', String(_metaOnlySet));
        _metaTop100 = null; _metaRanges = null; _metaCardIdx = null; _metaNameIdx = null;
        syncAdvCount(); renderMetaGrid();
      };
      setRow.addEventListener('click', flip);
      setRow.addEventListener('keydown', e => {
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); }
      });
      setRow.setAttribute('aria-checked', String(_metaOnlySet));
      setRow.appendChild(sw); setRow.appendChild(txt);
      body.appendChild(setRow);
    }

    // ── Buscar por carta contenida ──
    const cardRow = document.createElement('div'); cardRow.className = 'mz-adv-block';
    const cardLbl = document.createElement('div'); cardLbl.className = 'cv-adv-label'; cardLbl.id = 'mz-adv-cardlbl';
    const cardIn = document.createElement('input'); cardIn.id = 'mz-card-search'; cardIn.type = 'text';
    cardIn.addEventListener('input', () => { _cardSearch = cardIn.value.trim().toLowerCase(); syncAdvCount(); renderMetaGrid(); });
    cardRow.appendChild(cardLbl); cardRow.appendChild(cardIn);
    body.appendChild(cardRow);

    const wrap = document.createElement('div'); wrap.className = 'mz-sliders';

    // ── Mínimo de partidas (1 mango) ──
    const gB = document.createElement('div'); gB.className = 'mz-slider';
    const gL = document.createElement('div'); gL.className = 'mz-slider-lbl';
    const gT = document.createElement('div'); gT.className = 'mz-range';
    gT.innerHTML = '<div class="mz-range-track"><div class="mz-range-fill"></div></div>';
    const gIn = document.createElement('input'); gIn.type = 'range';
    gIn.min = 0; gIn.max = R.gMax; gIn.step = Math.max(Math.round(R.gMax / 200), 1); gIn.value = 0;
    gT.appendChild(gIn);
    const gFill = gT.querySelector('.mz-range-fill');
    function gUpdate() {
      const v = +gIn.value, pct = R.gMax ? v / R.gMax * 100 : 0;
      _gamesMin = v > 0 ? v : null;
      gFill.style.left = pct + '%'; gFill.style.width = (100 - pct) + '%';
      gL.innerHTML = `${esc(T('mazos.filterMinGames'))} <b>≥ ${fmtNum(v)}</b>`;
    }
    gIn.addEventListener('input', () => { gUpdate(); syncAdvCount(); renderMetaGrid(); });
    gB.appendChild(gL); gB.appendChild(gT); gUpdate();

    // ── Victorias (rango, 2 mangos solapados) ──
    const wB = document.createElement('div'); wB.className = 'mz-slider';
    const wL = document.createElement('div'); wL.className = 'mz-slider-lbl';
    const wT = document.createElement('div'); wT.className = 'mz-range mz-range-dual';
    wT.innerHTML = '<div class="mz-range-track"><div class="mz-range-fill"></div></div>';
    const step = Math.max((R.wMax - R.wMin) / 200, 0.001);
    const lo = document.createElement('input'); lo.type = 'range'; lo.className = 'mz-range-lo';
    const hi = document.createElement('input'); hi.type = 'range'; hi.className = 'mz-range-hi';
    [lo, hi].forEach(s => { s.min = R.wMin; s.max = R.wMax; s.step = step; });
    lo.value = R.wMin; hi.value = R.wMax;
    wT.appendChild(lo); wT.appendChild(hi);
    const wFill = wT.querySelector('.mz-range-fill');
    function wUpdate() {
      let l = +lo.value, h = +hi.value;
      if (l > h) { if (document.activeElement === lo) { h = l; hi.value = h; } else { l = h; lo.value = l; } }
      const span = (R.wMax - R.wMin) || 1, lp = (l - R.wMin) / span * 100, hp = (h - R.wMin) / span * 100;
      wFill.style.left = lp + '%'; wFill.style.width = (hp - lp) + '%';
      const active = l > R.wMin + 1e-9 || h < R.wMax - 1e-9;
      _wrLo = active ? l : null; _wrHi = active ? h : null;
      wL.innerHTML = `${esc(T('mazos.metaWinrate'))} <b>${Math.round(l * 100)}%–${Math.round(h * 100)}%</b>`;
      lo.style.zIndex = (l > (R.wMin + R.wMax) / 2) ? 5 : 3;   // poder agarrar el mango bajo cuando se juntan arriba
    }
    lo.addEventListener('input', () => { wUpdate(); syncAdvCount(); renderMetaGrid(); });
    hi.addEventListener('input', () => { wUpdate(); syncAdvCount(); renderMetaGrid(); });
    wB.appendChild(wL); wB.appendChild(wT); wUpdate();

    wrap.appendChild(gB); wrap.appendChild(wB);
    body.appendChild(wrap);
    host._advSync = () => { gUpdate(); wUpdate(); };
    syncAdvCount();
  }
  function refreshFilterLabels() {
    const host = document.getElementById('mz-meta-filters'); if (!host) return;
    const s = document.getElementById('mz-meta-search'); if (s) s.placeholder = T('mazos.metaSearch');
    const advL = document.getElementById('mz-adv-label'); if (advL) advL.textContent = T('mazos.advFilters');
    const cardL = document.getElementById('mz-adv-cardlbl'); if (cardL) cardL.textContent = T('mazos.searchByCard');
    const cardI = document.getElementById('mz-card-search'); if (cardI) cardI.placeholder = T('mazos.searchCard');
    const map = { new: 'filterNew', rising: 'filterRising', falling: 'filterFalling' };
    host.querySelectorAll('.mz-trend-chip').forEach(c => {
      const lbl = c.querySelector('.mz-flabel'); if (lbl) lbl.textContent = T('mazos.' + map[c.dataset.q]);
    });
    host.querySelectorAll('.mz-type-chip').forEach(b => { b.title = window.elName ? window.elName(b.dataset.cvEl) : b.dataset.cvEl; });
    // las etiquetas de los sliders las escribe su propio update (solo corría al moverlos):
    // sin esto se quedaban en el idioma con el que se construyó la barra
    if (host._advSync) host._advSync();
    syncAdvCount();
  }
  function syncFilterChips() {
    const host = document.getElementById('mz-meta-filters'); if (!host) return;
    host.querySelectorAll('.mz-trend-chip').forEach(c => c.classList.toggle('active', c.dataset.q === _metaQuick));
    host.querySelectorAll('.mz-type-chip').forEach(b => b.classList.toggle('active', _metaTypes.has(b.dataset.cvEl)));
  }
  function metaFilterActive() { return !!(_metaSearch || _cardSearch || _metaQuick || _metaTypes.size || _gamesMin != null || _wrLo != null); }
  // Texto de las CARTAS del mazo (nombre EN + localizado) → modo «Contiene carta» encuentra
  // mazos que llevan esa carta aunque no sea protagonista. (El modo «Nombre» solo mira r.name.)
  function metaCardsBlob(r) {
    if (r._cardsBlob == null) {
      const names = (r.cards || []).map(c => {
        const card = metaCardById(c.id); if (!card) return '';
        return (card.name || '') + ' ' + (window.cardName ? window.cardName(card) : '');
      });
      r._cardsBlob = ((r.name || '') + ' ' + names.join(' ')).toLowerCase();
    }
    return r._cardsBlob;
  }
  // Min/max reales de uso y victorias (extremos de los sliders). Cacheado.
  let _metaRanges = null;
  function metaRanges() {
    if (!_metaRanges) {
      const all = metaRows();
      let wMin = 1, wMax = 0, gMax = 0, anyW = false;
      all.forEach(d => {
        if (d.games != null) gMax = Math.max(gMax, d.games);
        if (d.winrate != null) { wMin = Math.min(wMin, d.winrate); wMax = Math.max(wMax, d.winrate); anyW = true; }
      });
      if (!anyW) { wMin = 0.3; wMax = 0.7; }
      if (!gMax) gMax = 1000;
      _metaRanges = { wMin, wMax, gMax };
    }
    return _metaRanges;
  }
  function metaMatch(r) {
    if (_metaSearch && !(r.name || '').toLowerCase().includes(_metaSearch)) return false;     // por nombre
    if (_cardSearch && !metaCardsBlob(r).includes(_cardSearch)) return false;                  // por carta contenida
    if (_metaQuick === 'new' && !r.new) return false;
    if (_metaQuick === 'rising'  && !(r.trend != null && r.trend * 100 >= 0.2)) return false;
    if (_metaQuick === 'falling' && !(r.trend != null && r.trend * 100 <= -0.2)) return false;
    if (_metaTypes.size && !(r.types || []).some(t => _metaTypes.has(t))) return false;
    if (_gamesMin != null && (r.games == null || r.games < _gamesMin)) return false;           // mínimo de partidas
    if (_wrLo != null && (r.winrate == null || r.winrate < _wrLo || r.winrate > _wrHi)) return false;
    return true;
  }

  // Filtra (búsqueda/chips/tipos) + ordena; luego top 50 (o todos / o todos los que filtran)
  function metaTableRows() {
    const all = metaRows();
    const filtered = all.filter(metaMatch);
    const subset = (_metaShowAll || metaFilterActive()) ? filtered.slice() : filtered.slice(0, META_TOP);
    const k = _metaSortKey, dir = _metaSortDir === 'asc' ? 1 : -1;
    subset.sort((a, b) => ((a[k] || 0) - (b[k] || 0)) * dir);
    return { rows: subset, filteredCount: filtered.length, total: all.length };
  }
  // Ajuste manual de una carta protagonista (data/card_focus.js). El tuner lo pisa mientras
  // se calibra. Devuelve el registro crudo: encuadre + impresión de arte elegida.
  function metaFocusRaw(id) {
    const t = metaTune();
    const src = (t && t.focus) || window.CARD_FOCUS || {};
    return (id && src[id]) || null;
  }
  // Qué IMPRESIÓN presta su arte: por defecto la propia carta, pero se puede fijar otra del
  // mismo Pokémon (`img`) — hay artes normales que no quedan bien de fondo de ninguna forma.
  function metaArtId(id) {
    const f = metaFocusRaw(id), alt = f && f.img;
    // si la impresión elegida ya no existe (set retirado, id mal escrito a mano), se cae
    // en la carta original: la tarjeta nunca se queda sin fondo
    return (alt && window.dbLookup && window.dbLookup({ id: alt })) ? alt : id;
  }
  // Arte de FONDO de la tarjeta = el protagonista del mazo, como las bandas del hub.
  function metaProtImg(prots) {
    const id = metaArtId((prots || [])[0]);
    if (!id) return '';
    const c = window.dbLookup ? window.dbLookup({ id }) : null;
    if (!c) return '';
    // cardImage resuelve idioma + normaliza la ruta (imprescindible en /es/meta y demás)
    return window.cardImage ? window.cardImage(c) : (window.localizeImg ? window.localizeImg(c.image) : c.image);
  }
  // Encuadre del arte AJUSTADO A MANO para esa carta (data/card_focus.js). Sin entrada
  // propia, cae en el encuadre general del CSS. Se ajusta una vez por carta protagonista
  // y vale para todos los mazos donde salga.
  function metaFocus(id) {
    const f = metaFocusRaw(id);
    if (!f) return { vars: '', flip: '' };
    let v = '';
    if (f.x != null) v += `;--fx:${f.x}%`;
    if (f.y != null) v += `;--fy:${f.y}%`;
    if (f.z != null) v += `;--fz:${f.z}%`;
    return { vars: v, flip: f.f ? ' flip' : '' };
  }

  // Franja del color de su energía (misma regla que rowAccent del hub).
  function metaAccent(row) {
    const e = (row.energy && row.energy[0]) || (row.types && row.types[0]) || '';
    return (window.EL_COLORS && window.EL_COLORS[e]) || '#9aa0b4';
  }

  // Cabecera de columna: se clica para ordenar, como la de una tabla — pero alineada
  // sobre las tarjetas (mismas columnas de grid), no dentro de un <table>.
  function metaHeaderCell(key, label, cls) {
    const active = _metaSortKey === key;
    // la flecha se pinta SIEMPRE (invisible si la columna no ordena): si apareciera y
    // desapareciera, la palabra se desplazaría en cada clic
    const arrow = `<span class="mz-sort-arrow"${active ? '' : ' aria-hidden="true"'}>${active && _metaSortDir === 'asc' ? '▲' : '▼'}</span>`;
    return `<button type="button" class="mh-col ${cls}${active ? ' sorted' : ''}" data-sort="${key}"><span class="mh-t">${esc(label)}${arrow}</span></button>`;
  }

  function renderMetaGrid() {
    const grid    = document.getElementById('mz-grid');
    const empty   = document.getElementById('mz-empty');
    const countEl = document.getElementById('mz-deck-count');
    const banner  = document.getElementById('mz-meta-banner');
    const filters = document.getElementById('mz-meta-filters');
    const body    = document.getElementById('mz-grid-body');
    if (!grid) return;
    if (body) body.classList.add('mz-meta-mode');
    if (empty) empty.style.display = 'none';
    grid.innerHTML = '';

    syncTitle();   // deja la fuente marcada en la sub-navbar

    const M = metaSet();
    if (!M) {
      // Sin datos en esta fuente. El Draft no es una tabla de mazos (su métrica es el % de
      // pickeo por carta) y sigue pendiente; los formatos propios solo llegan aquí si aún
      // no se ha jugado nada en ellos.
      if (banner) banner.style.display = 'none';
      if (filters) filters.style.display = 'none';
      if (countEl) countEl.textContent = '';
      if (!metaIsOwn()) {
        grid.innerHTML = `<div style="padding:60px 20px;text-align:center;color:rgba(255,255,255,0.3);font-size:14px;">${T('mazos.metaEmpty')}</div>`;
        return;
      }
      const draft = _metaSource === 'draft';
      grid.innerHTML =
        `<div class="mz-meta-soon">` +
          `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 17.5l5.2-5.2 3.4 3.4L21 6.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15.4 6.3H21v5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
          `<h3>${esc(T(draft ? 'mazos.metaSoonTitle' : 'mazos.metaNoGamesTitle'))}</h3>` +
          `<p>${esc(T(draft ? 'mazos.metaSoonDraft' : 'mazos.metaNoGamesBody'))}</p>` +
        `</div>`;
      return;
    }

    if (banner) {
      banner.style.display = 'flex';
      const expName = M.expansion && M.expansion.name ? M.expansion.name : '';
      // En móvil la ficha larga («Meta de X · Actualizado hace 8 días · … · Datos de
      // Limitless TCG») se comía media pantalla: se queda en el nombre de la expansión,
      // la antigüedad abreviada, la muestra y la fuente a secas.
      const mob = isMobile();
      const dot = '<span class="mz-meta-dot">·</span>';
      // La ficha de Limitless habla de TORNEOS; la nuestra de PARTIDAS, que es lo que
      // agregamos. Y la fuente deja de ser «Limitless TCG» para ser el propio online.
      const own = metaIsOwn();
      const sample = own
        ? esc(T('mazos.metaSampleOwn', { g: fmtNum(M.matches || 0), p: fmtNum(M.players || 0) }))
        : esc(T('mazos.metaSample', { t: fmtNum(M.tournaments), p: fmtNum(M.players) }));
      const srcTxt = esc(T(own ? 'mazos.metaSourceOwn' : 'mazos.metaSource'));
      const srcShort = esc(T(own ? 'mazos.metaSourceOwnShort' : 'mazos.metaSourceShort'));
      banner.innerHTML = mob
        // móvil: UNA sola línea (los trozos sueltos con gap entre ellos se pasaban de ancho
        // y caían a dos filas). Si no cabe, se recorta por el final — que es lo menos
        // importante (la fuente); expansión, antigüedad y muestra van delante.
        ? `<span class="mz-meta-line">` +
            (expName ? `<b>${esc(expName)}</b> · ` : '') +
            `${esc(relTime(M.generated, true))} · ${sample} · ` +
            `<span class="mz-meta-src">${srcShort}</span>` +
          `</span>`
        : (expName ? `<span><b>${esc(T('mazos.metaOf', { name: expName }))}</b></span>${dot}` : '') +
          `<span>${esc(T('mazos.metaUpdated', { date: relTime(M.generated) }))}</span>` +
          dot +
          `<span>${sample}</span>` +
          `<span class="mz-meta-src">${srcTxt}</span>`;
    }
    ensureMetaFilters();
    if (filters) filters.style.display = 'flex';
    refreshFilterLabels();
    syncFilterChips();

    const { rows, filteredCount, total } = metaTableRows();
    if (countEl) countEl.textContent = `(${filteredCount})`;
    const maxShare = M.decks.reduce((mx, r) => Math.max(mx, r.share || 0), 0);

    if (!rows.length) {
      grid.innerHTML = `<div id="mz-meta-empty-filter">${esc(T('mazos.metaNoMatch'))}</div>`;
      return;
    }

    const wrap = document.createElement('div');
    wrap.id = 'mz-meta-wrap';
    applyMetaTune(wrap);

    // UNA sola lista para escritorio y móvil (antes eran dos renders distintos: tabla y
    // tarjetas). Cada mazo es una tarjeta con el ARTE del protagonista de fondo — el mismo
    // tratamiento que las bandas del hub «Jugar» (arte + velo que lo apaga + franja del
    // color de su energía). Sin barra de uso: uso, victorias y partidas van en columnas
    // alineadas con la cabecera, que es la que se clica para ordenar.
    const cols = ['share', 'winrate', 'games'];
    // En móvil las etiquetas van cortas: con «Victorias» entera, la flecha de orden se salía
    // por el borde derecho de la pantalla y no se veía por cuál estabas ordenando.
    const mobH = isMobile(), trendNum = metaOpt('trendNum');
    const nameParts = metaOpt('nameLines'), wrPct = metaOpt('wrPct') !== false;
    // una línea por carta; con `two` el hueco es de dos aunque el mazo tenga un solo prota
    const metaNameHTML = r => {
      const parts = metaNameParts(r);
      // a dos líneas cada trozo va en su <span> (es el que recorta con «…»); a una, texto pelado
      return nameParts > 1 ? parts.map(x => `<span>${esc(x)}</span>`).join('') : esc(parts[0]);
    };
    let html = `<div class="mz-meta-head">` +
        `<span class="mh-rk">#</span><span class="mh-thumb"></span>` +
        `<span class="mh-name">${esc(T('mazos.metaColDeck'))}</span>` +
        metaHeaderCell('share', T(mobH ? 'mazos.metaUsageShort' : 'mazos.metaUsage'), 'mh-use') +
        metaHeaderCell('winrate', T(mobH ? 'mazos.metaWinrateShort' : 'mazos.metaWinrate'), 'mh-wr') +
        metaHeaderCell('games', T('mazos.metaGamesShort'), 'mh-games') +
      `</div><div class="mz-meta-list">`;
    rows.forEach((r, i) => {
      const bg = metaProtImg(r.protagonists);
      const fc = metaFocus((r.protagonists || [])[0]);
      html +=
        `<button class="mz-mcard" data-i="${i}" style="--a:${esc(metaAccent(r))}">` +
          (bg ? `<span class="mc-art${fc.flip}" style="background-image:url(${esc(bg)})${fc.vars}"></span>` : `<span class="mc-art"></span>`) +
          `<span class="mc-scrim"></span>` +
          `<span class="mc-rk">${i + 1}</span>` +
          `<span class="mc-thumb">${archTwoCardsHTML(r.protagonists)}</span>` +
          `<span class="mc-name${nameParts > 1 ? ' two' : ''}">${metaNameHTML(r)}</span>` +
          // la tendencia va DENTRO de la celda de uso: son un pack y el % no se descentra
          `<span class="mc-use"><span class="mc-trend">${trendHTML(r, trendNum)}</span>${pct(r.share)}</span>` +
          `<span class="mc-wr" style="color:${wrColor(r.winrate, r.games)}">${wrPct ? pct(r.winrate) : pctNum(r.winrate)}</span>` +
          `<span class="mc-games">${fmtNum(r.games || 0)}</span>` +
        `</button>`;
    });
    html += `</div>`;
    wrap.innerHTML = html;

    grid.appendChild(wrap);

    wrap.querySelectorAll('.mh-col').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.getAttribute('data-sort');
        if (_metaSortKey === k) _metaSortDir = (_metaSortDir === 'asc' ? 'desc' : 'asc');
        else { _metaSortKey = k; _metaSortDir = 'desc'; }
        window.sfx && window.sfx('ui.tab');
        renderMetaGrid();
      });
    });
    // Click en la tarjeta → detalle del mazo
    wrap.querySelectorAll('button.mz-mcard').forEach(el => {
      el.addEventListener('click', () => {
        const r = rows[parseInt(el.getAttribute('data-i'), 10)];
        if (r) showDetailView(buildMetaDeck(r), parseInt(el.getAttribute('data-i'), 10));
      });
    });

    if (!metaFilterActive() && total > META_TOP) {
      const more = document.createElement('div');
      more.id = 'mz-meta-more';
      more.innerHTML = `<button>${esc(_metaShowAll ? T('mazos.metaShowTop', { n: META_TOP }) : T('mazos.metaShowAll', { n: total }))}</button>`;
      more.querySelector('button').addEventListener('click', () => {
        _metaShowAll = !_metaShowAll;
        window.sfx && window.sfx('ui.tab');
        renderMetaGrid();
        if (!_metaShowAll) { const b = document.getElementById('mz-grid-body'); if (b) b.scrollTop = 0; }
      });
      grid.appendChild(more);
    }
  }

  // ── Detalle META: cabecera + build de consenso + Flex/Tech + probabilidades ──
  // ── Distribución apaisada (componente reutilizable: únicas + ×N, filas centradas) ──
  function metaImg(c) { return c ? ((window.cardImage ? window.cardImage(c) : c.image) || c.image || '') : ''; }
  function metaName(c) { return c ? ((window.cardName ? window.cardName(c) : c.name) || c.name || '') : ''; }

  // Orbes de energía REALES (los mismos de Cartas) a partir de una lista de tipos
  function energyOrbsHTML(types) {
    return (types || []).map(el => {
      const k = window.ORB_ICON_KEY && window.ORB_ICON_KEY[el];
      const src = k && ((window.ENERGY_ICONS && window.ENERGY_ICONS[k]) || (window.ORB_ICONS && window.ORB_ICONS[k]));
      const title = esc(window.elName ? window.elName(el) : el);
      return src ? `<img class="mz-el-orb" src="${src}" alt="" title="${title}">`
                 : `<span class="mz-el-dot-circle" style="background:${EL_COLORS[el] || '#888'}"></span>`;
    }).join('');
  }

  function cardTip(c, st) {
    const nm = metaName(c);
    if (!st) return nm;
    let s = T('mazos.cardTipInc', { name: nm, inc: Math.round(Math.min(1, st[0]) * 100) });
    if (st[1] != null) s += ' · ' + T('mazos.cardTipSr', { sr: Math.round(st[1] * 100) });
    return s;
  }

  // Una fila de la lista «Flex y tech» bajo el mazo: miniatura + nombre + barra de % de uso + %.
  // Pool UNIFICADO del arquetipo (r.flex), por frecuencia. Stat = SOLO uso (lo que pidió Daniel).
  function metaFlexRowHTML(f, deckName) {
    const c = metaCardById(f.id), w = Math.round(f.rate * 100);
    const nm = metaName(c) || f.name;
    // Tooltip claro: «El X% de las listas de [mazo] juega [carta]. Gana el Y%…».
    // Args dinámicos pre-escapados; el template lleva <b> y se embebe SIN re-escapar.
    let tip = T('mazos.flexCardTip', { rate: w, deck: esc(deckName || ''), card: esc(nm) });
    if (f.sr != null) tip += T('mazos.flexCardTipWr', { sr: Math.round(f.sr * 100) });
    // hover = tooltip (data-mztip); click = zoom (data-zoom, ratón normal). Sin ⓘ ni tap-toggle.
    return `<div class="mz-md-frow" data-mztip="${tip}" data-zoom="${esc(metaImg(c))}">
      <img class="mz-md-fthumb" src="${metaImg(c)}" loading="lazy" onerror="this.style.visibility='hidden'">
      <span class="mz-md-fname">${f.copy === 2 ? '2× ' : ''}${esc(nm)}</span>
      <span class="mz-md-fbar ${f.bucket || ''}"><span style="width:${w}%"></span></span>
      <span class="mz-md-fpct">${w}%</span></div>`;
  }

  // Tira de las 20 cartas INDIVIDUALES (×2 = dos imágenes) en el orden del export → cada
  // resultado ocupa siempre lo mismo de largo. Reutilizable por cualquier lista [{id,count}].
  function finStripHTML(cards) {
    let html = '';
    sortDeckCards(cards || []).forEach(c => {
      const card = metaCardById(c.id), img = metaImg(card), nm = esc(metaName(card) || '');
      for (let i = 0; i < (c.count || 1); i++) {
        html += `<div class="mz-fin-card" data-zoom="${esc(img)}" title="${nm}"><img src="${esc(img)}" loading="lazy" onerror="this.style.visibility='hidden'"></div>`;
      }
    });
    return html;
  }

  // Los 4 botones de acción (activar/guardar/compartir/QR) — mismos iconos que la vista principal.
  // El play de una lista de torneo = guardarla en Mis Mazos y dejarla activa (no está en tu biblioteca).
  const FIN_BTNS = `<span class="mz-fin-acts">`
    + `<button class="mz-fin-btn fin-activar" title="__PLAY__"><svg viewBox="0 0 16 16" fill="none"><polygon points="4,2 14,8 4,14" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor"/></svg></button>`
    + `<button class="mz-fin-btn fin-guardar" title="__SAVE__"><svg viewBox="0 0 16 16" fill="none"><path d="M3.2 2.2h7.4l3.2 3.2v7.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.8 13.7V8.8h6.4v4.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.7 2.6V5.3H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`
    + `<button class="mz-fin-btn fin-compartir" title="__SHARE__"><svg viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="3.5" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 7l4.4-2.5M5.8 9l4.4 2.5" stroke="currentColor" stroke-width="1.3"/></svg></button>`
    + `<button class="mz-fin-btn fin-qr" title="__QR__">${QR_SVG}</button></span>`;

  // Orden de «Resultados». 'place' = como Best Finishes de Limitless: PERCENTIL (puesto /
  // tamaño del torneo) → un 2/500 va antes que un 1/60. También por fecha y por victorias.
  function finSortKey(f, key) {
    if (key === 'date') return f.date || '';
    if (key === 'score') return (f.rec && f.rec[0]) || 0;
    // Meta propio: no hay torneos ni puestos, así que la columna equivalente es cuánto se
    // usa esa lista dentro del arquetipo (más usada = antes, por eso va negada).
    if (f.place == null) return -(f.share || 0);
    return f.place / Math.max(1, f.of || 1);   // 'place' = percentil (menor = mejor)
  }
  function sortedFinishes(fins, sort) {
    return fins.slice().sort((a, b) => {
      const ka = finSortKey(a, sort.key), kb = finSortKey(b, sort.key);
      return ka < kb ? -sort.dir : ka > kb ? sort.dir : 0;
    });
  }

  // «Resultados» = pestaña completa (estilo Best Finishes de Limitless): columnas alineadas
  // Jugador · Torneo · Fecha · Puesto · Resultado (+ botones), cabeceras ORDENABLES, y BAJO
  // cada fila la lista de 20 cartas a la vista (sin ir a Limitless ni clicar «List»).
  function metaFinishesHTML(r, sort) {
    const lists = r.finishLists || [];
    const fins = sortedFinishes(r.finishes || [], sort);
    const btns = FIN_BTNS.replace('__PLAY__', esc(T('mazos.saveAndActivate')))
      .replace('__SAVE__', esc(T('mazos.saveToLibrary'))).replace('__SHARE__', esc(T('mazos.share')))
      .replace('__QR__', esc(T('mazos.qrBtn')));
    const arrow = k => sort.key === k ? `<i class="mz-fin-arr">${sort.dir > 0 ? '▲' : '▼'}</i>` : '';
    const sortBtn = (k, label) => `<button class="mz-fin-h${sort.key === k ? ' on' : ''}" data-sort="${k}">${esc(label)}${arrow(k)}</button>`;
    // La etiqueta «Ordenar por» solo se ve en móvil (CSS): allí la cabecera de columnas no
    // cabe y se convierte en una fila de chips de orden con los MISMOS botones .mz-fin-h.
    // El meta propio no tiene torneos: cada fila es una LISTA EXACTA con el récord de todas
    // sus partidas, así que las columnas cambian de significado (jugadores · partidas ·
    // última vez · uso dentro del arquetipo · récord).
    const own = metaIsOwn();
    const head = own
      ? `<div class="mz-fin-thead"><span class="mz-fin-sortlbl">${esc(T('mazos.sortBy'))}</span>`
        + `<span>${esc(T('mazos.finPlayers'))}</span><span>${esc(T('mazos.finGames'))}</span>`
        + sortBtn('date', T('mazos.finLastSeen')) + sortBtn('place', T('mazos.finUse'))
        + sortBtn('score', T('mazos.finRecord')) + `<span></span></div>`
      : `<div class="mz-fin-thead"><span class="mz-fin-sortlbl">${esc(T('mazos.sortBy'))}</span>`
        + `<span>${esc(T('mazos.finPlayer'))}</span><span>${esc(T('mazos.finTournament'))}</span>`
        + sortBtn('date', T('mazos.finDate')) + sortBtn('place', T('mazos.finPlace'))
        + sortBtn('score', T('mazos.finScore')) + `<span></span></div>`;
    // En móvil la fecha va en la línea de datos con puesto/resultado → formato corto para que quepa.
    const mob = isMobile();
    const dateFmt = mob ? { day: 'numeric', month: 'short', year: 'numeric' } : { day: '2-digit', month: 'long', year: 'numeric' };
    const rows = fins.map(f => {
      let date = f.date || '';
      try { date = new Date(f.date + 'T00:00:00').toLocaleDateString(uiLocale(), dateFmt); } catch (e) {}
      const place = own
        ? pct(f.share || 0)
        : ordinal(f.place) + ' ' + T('mazos.finOf') + ' ' + (f.of || '?');
      const score = (f.rec || []).join(' - ');
      // Móvil: los botones van DEBAJO del mazo (fuera de la línea de datos); escritorio los
      // mantiene como 6ª columna de la fila de datos.
      return `<div class="mz-fin-row" data-li="${f.li}">
        <div class="mz-fin-cols">
          <span class="mz-fin-player">${own ? esc(T((f.players === 1 ? 'mazos.finNPlayer' : 'mazos.finNPlayers'), { n: fmtNum(f.players || 0) })) : esc(f.player || '—')}</span>
          <span class="mz-fin-tourn" title="${esc(f.tname || '')}">${own ? esc(T((f.games === 1 ? 'mazos.finNGame' : 'mazos.finNGames'), { n: fmtNum(f.games || 0) })) : esc(f.tname || '')}</span>
          <span class="mz-fin-date">${esc(date)}</span>
          <span class="mz-fin-place">${esc(place)}</span>
          <span class="mz-fin-score">${esc(score)}</span>
          ${mob ? '' : btns}
        </div>
        <div class="mz-fin-strip">${finStripHTML(lists[f.li] || [])}</div>
        ${mob ? btns : ''}
      </div>`;
    }).join('');
    return head + `<div class="mz-fin-rows">${rows}</div>`;
  }

  // Oculta un contenedor de cartas y muestra un CÍRCULO de carga hasta que sus imágenes están
  // listas (o pasa un tope) → se revela ya cargado, sin ver las cartas entrar una a una.
  function mzHoldImages(container, timeout) {
    if (!container) return;
    const imgs = Array.from(container.querySelectorAll('img')).filter(im => im.getAttribute('src'));
    if (!imgs.length) return;
    container.classList.add('mz-imgs-loading');
    let pending = imgs.length, done = false;
    const finish = () => { if (done) return; done = true; clearTimeout(to); container.classList.remove('mz-imgs-loading'); };
    const to = setTimeout(finish, timeout || 2500);
    imgs.forEach(im => {
      if (im.complete) { if (--pending <= 0) finish(); return; }
      const on = () => { im.removeEventListener('load', on); im.removeEventListener('error', on); if (--pending <= 0) finish(); };
      im.addEventListener('load', on); im.addEventListener('error', on);
    });
  }

  // ── Vista de mazo «fit-to-frame» (mismo sistema que la descarga de imagen) ──
  const DECK_FIT_RATIO = 512 / 367;    // alto/ancho de carta (~1.395)
  // TAMAÑO OBJETIVO = el clásico del detalle (carta de 200px de alto → 143 de ancho).
  // Es un TECHO: la carta NUNCA se muestra más grande (escala consistente entre vistas,
  // da igual el ancho del contenedor); solo ENCOGE cuando el marco no da para más.
  const DECK_FIT_TARGET_W = 143;
  // Columnas, con el criterio de la imagen descargable — EN TODAS LAS VISTAS IGUAL:
  //  · ancho (escritorio) → formato HORIZONTAL: **2 filas SIEMPRE** (ceil(N/2) columnas),
  //    encogiendo la carta lo que haga falta para caber. NUNCA 3 líneas.
  //  · estrecho (móvil, no caben ~5 a tamaño objetivo) → formato VERTICAL: 4 columnas.
  // Se re-equilibran las filas (19 cartas → 10/9) y el flex-wrap centra la última fila
  // incompleta (como la imagen descargable). Ajusta al ANCHO siempre; al ALTO si el
  // consumidor pasó getAvailH (marco sin scroll, p.ej. el fin del draft).
  function fitDeckEl(fit) {
    if (!fit) return;
    if (!fit.isConnected) { if (fit._deckRO) { try { fit._deckRO.disconnect(); } catch (e) {} fit._deckRO = null; } return; }
    const N = fit.children.length; if (!N) return;
    // Medir el PADRE (.mz-dl, width:100%, sin restricciones): el propio fit lleva un
    // maxWidth que nosotros ponemos → medirlo a él realimentaría el encogimiento.
    const availW = (fit.parentElement || fit).clientWidth; if (availW < 20) return;
    const G = 0.05;                                   // hueco = 5% del ancho de carta
    const fitCols = Math.floor(availW / (DECK_FIT_TARGET_W * (1 + G)));   // cuántas caben a tamaño objetivo
    let cols = Math.max(1, fitCols <= 4 ? Math.min(4, N) : Math.ceil(N / 2));
    const rows = Math.ceil(N / cols);
    cols = Math.ceil(N / rows);                       // re-equilibra las filas (sin huérfanas)
    let cw = availW / (cols + (cols - 1) * G);         // que quepan `cols` en el ancho
    const getH = fit._deckGetAvailH;
    if (getH) { const availH = getH(); if (availH && availH > 40) cw = Math.min(cw, availH / ((rows + (rows - 1) * G) * DECK_FIT_RATIO)); }
    cw = Math.floor(Math.max(40, Math.min(cw, DECK_FIT_TARGET_W)));   // TECHO = tamaño clásico
    const gapPx = Math.max(3, Math.floor(cw * G));
    fit.style.setProperty('--mzdl-cw', cw + 'px');
    fit.style.setProperty('--mzdl-gap', gapPx + 'px');
    // Acota el contenedor a EXACTAMENTE `cols` cartas por fila: sin esto, el flex-wrap
    // mete las que quepan (con el techo de tamaño caben más) → filas desequilibradas
    // con huérfana (6/6/6/1 en vez de 5/5/5/4). `.mz-dl` centra el bloque acotado.
    fit.style.maxWidth = (cols * cw + (cols - 1) * gapPx + 2) + 'px';
  }
  // Re-ajusta TODAS las vistas de mazo al redimensionar la ventana (una sola vez; el
  // ResizeObserver por-mazo cubre cambios de tamaño del contenedor sin resize de ventana).
  let _deckFitRaf = 0;
  window.addEventListener('resize', () => {
    if (_deckFitRaf) return;
    _deckFitRaf = requestAnimationFrame(() => {
      _deckFitRaf = 0;
      document.querySelectorAll('.mz-dl-fit').forEach(fitDeckEl);
      _mzPinRefresh();   // el mazo fijado cambia de alto con el ancho de la ventana
    });
  });

  function deckLayout(cards, opts) {
    opts = opts || {};
    const cs = opts.cardstats;
    const wrap = document.createElement('div');
    wrap.className = 'mz-dl' + (opts.big ? ' big' : '');
    let list = sortDeckCards(cards || []);
    // Huecos decorativos (Mis Mazos en edición): rellenan hasta opts.padTo (nº típico de cartas
    // distintas del formato, ~14 en 20 / ~23 en 30). Cada carta añadida (incl. 2ª copia) quita un
    // hueco «mientras queden»; el CONTADOR X/size manda la validez, los huecos son solo visuales.
    const cardTotal = (list || []).reduce((s, c) => s + (c.count || 1), 0);
    const emptyN = opts.padTo ? Math.max(0, opts.padTo - cardTotal) : 0;
    if (!list.length && !emptyN) { wrap.innerHTML = `<div class="mz-md-empty">${esc(T('mazos.metaNoList'))}</div>`; return wrap; }

    // Huecos por anti-correlación (dato de Limitless): la carta-ancla se pinta como STACK con
    // sus alternativas detrás; se hojean con el gesto (bucle, dos sentidos). Solo la versión principal.
    // (El glow verde de «intercambiable» se quitó — Daniel 2026-07-03: solo lista + stacks.)
    const slotMap = new Map((opts.slots || []).filter(s => s.options && s.options.length).map(s => [s.anchor, s]));
    // carta suelta (sin hueco), con su badge ×N y zoom al clic
    function makePlain(c) {
      const card = metaCardById(c.id);
      const st = cs ? cs[c.id] : null;
      const el = document.createElement('div');
      el.className = 'mz-dl-card';
      const cnt = c.count || 1;
      const ed = opts.edit;
      // collapseCards agrupa por IMPRESIÓN, pero el límite de copias es POR NOMBRE: dos
      // impresiones distintas del mismo Pokémon ya llenan el cupo → el + va apagado en ambas.
      const nCnt = (ed && ed.nameCount) ? (ed.nameCount(card) || cnt) : cnt;
      const nCap = (ed && ed.maxCopies) || 2;
      // Mis Mazos (opts.copyBadge): cuadrado negro translúcido con el número SIEMPRE (1 y 2);
      // en EDICIÓN se le extienden − y + (componente .deck-copy-badge de la sidebar, reutilizado).
      // Resto (meta/draft): el badge ×2 de siempre.
      let badge = '';
      if (opts.copyBadge) {
        const mBtn = ed ? '<span class="dcb-minus">−</span>' : '';
        const pBtn = ed ? `<span class="dcb-plus${nCnt >= nCap ? ' maxed' : ''}">+</span>` : '';
        badge = `<div class="deck-copy-badge${ed && ed.animateIn ? ' dcb-anim' : ''}">${mBtn}<span class="dcb-count">${cnt}</span>${pBtn}</div>`;
      } else if (cnt >= 2) {
        badge = `<span class="mz-dl-x">${cnt}</span>`;
      }
      el.innerHTML = `<img src="${metaImg(card)}" loading="lazy" onerror="this.style.visibility='hidden'">` + badge;
      el.title = st ? cardTip(card, st) : metaName(card);
      el.style.cursor = 'zoom-in';
      el.addEventListener('click', () => {
        const im = metaImg(card);
        if (im && window.openZoomFromImage) window.openZoomFromImage(im, el.querySelector('img') || el);
      });
      if (ed) {
        const mn = el.querySelector('.dcb-minus'), pl = el.querySelector('.dcb-plus');
        if (mn) mn.addEventListener('click', e => { e.stopPropagation(); ed.onDelta(c.id, -1); });
        if (pl) pl.addEventListener('click', e => { e.stopPropagation(); if (nCnt < nCap) ed.onDelta(c.id, +1); });
        // Clic derecho = quitar una copia, igual que en el pop-up del builder.
        el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); ed.onDelta(c.id, -1); });
      }
      return el;
    }
    // Expande cada carta a celdas de render. CLAVE (Daniel): si el hueco es la 2ª copia de una
    // carta ×2, se ve la 1ª copia FIJA aparte + la 2ª como stack (así el mazo son 20 cartas claras,
    // no "19 + un stack ambiguo"). Cambio de línea entera (anchorCopy 1) o de 1 copia = un solo stack.
    function itemsFor(c) {
      const slot = slotMap.get(c.id), n = c.count || 1;
      if (slot && slot.anchorCopy === 2 && n >= 2) {
        const fixed = { c: { id: c.id, count: n - 1 }, plain: true };
        const stk = { c: { id: c.id, count: 1 }, slot: Object.assign({}, slot, { anchorCopy: 1, split: true }) };
        return [fixed, stk];
      }
      return [slot ? { c: c, slot: slot } : { c: c, plain: true }];
    }
    const render = it => it.slot ? buildSlotStack(it.c, it.slot, cs) : makePlain(it.c);
    const items = [];
    (list || []).forEach(c => { itemsFor(c).forEach(it => items.push(it)); });

    if (opts.big) {
      // Vista UNIFICADA: un único contenedor flex-wrap centrado; fitDeckEl() fija el tamaño
      // de carta para que TODO el mazo quepa (mismo sistema que la descarga de imagen).
      // Sustituye a las 3 ramas viejas (rejilla móvil / wrap >16 / filas fijas de 200px),
      // que causaban scroll brutal en móvil y 3 filas / carta huérfana en escritorio.
      const fit = document.createElement('div');
      fit.className = 'mz-dl-fit';
      items.forEach(it => fit.appendChild(render(it)));
      // Huecos vacíos decorativos: divs con la forma de carta (sin img/badge/click). fitDeckEl
      // los cuenta en fit.children.length → se reparten y encogen igual que las cartas reales.
      for (let i = 0; i < emptyN; i++) { const e = document.createElement('div'); e.className = 'mz-dl-card mz-dl-empty'; fit.appendChild(e); }
      wrap.appendChild(fit);
      if (typeof opts.getAvailH === 'function') fit._deckGetAvailH = opts.getAvailH;
      requestAnimationFrame(() => {
        fitDeckEl(fit);
        if (window.ResizeObserver && fit.parentElement) {
          const ro = new ResizeObserver(() => fitDeckEl(fit));
          ro.observe(fit.parentElement); fit._deckRO = ro;
        }
      });
    } else {
      // No-big (p.ej. fin del draft multijugador): filas compactas de siempre (ya encajan
      // por su propio CSS flex).
      const n = items.length;
      const rows = n <= 5 ? [items] : [items.slice(0, Math.ceil(n / 2)), items.slice(Math.ceil(n / 2))];
      rows.forEach(rc => {
        const row = document.createElement('div');
        row.className = 'mz-dl-row';
        rc.forEach(it => row.appendChild(render(it)));
        wrap.appendChild(row);
      });
    }
    return wrap;
  }

  // STACK de un hueco intercambiable: la carta-ancla del mazo delante y sus alternativas asomando
  // detrás. Se hojea de tres formas: arrastrar la del frente a un lado (con INERCIA: un golpe seco
  // corto basta, no hace falta recorrer una distancia), rueda/trackpad HORIZONTAL, o clic en una de
  // las que asoman. Bucle, en los dos sentidos. Tap limpio = zoom de la carta del frente.
  function buildSlotStack(mainCard, slot, cs) {
    const _mob = isMobile();
    const DX = _mob ? 6 : 8, DY = _mob ? 6 : 8, NB = 2, SC = 0.05;   // asomo por carta y nº de bordes visibles
    // % de la ancla EN SU CONFIGURACIÓN (×2 → % de llevar la doble); fallback a inclusión simple
    const mainInc = slot.rate != null ? Math.round(slot.rate * 100)
      : (cs && cs[mainCard.id]) ? Math.round((cs[mainCard.id][0] || 0) * 100) : null;
    // copy del ancla: si la carta flexible es la 2ª COPIA (main ×2), el badge dice «2ª · N%»
    // (sin esto, un stack sobre Copiona ×2 se lee como si TODA la Copiona fuera intercambiable)
    const members = [{ id: mainCard.id, main: true, count: mainCard.count || 1, pct: mainInc, copy: slot.anchorCopy }]
      .concat((slot.options || []).map(o => ({ id: o.id, pct: Math.round((o.rate || 0) * 100), sr: o.sr, copy: o.copy })));
    const n = members.length;
    let cur = 0;

    const cell = document.createElement('div');
    cell.className = 'mz-dl-card mz-slot';
    cell.dataset.cur = '0';
    // sizer invisible EN EL FLUJO → la celda toma el tamaño de una carta normal (responsive por flex)
    const sizer = document.createElement('img');
    sizer.className = 'mz-slot-sizer'; sizer.setAttribute('draggable', 'false');
    sizer.src = metaImg(metaCardById(mainCard.id));
    cell.appendChild(sizer);
    const layer = document.createElement('div');
    layer.className = 'mz-slot-layer';
    cell.appendChild(layer);

    const els = members.map(m => {
      const cm = metaCardById(m.id);
      const el = document.createElement('div');
      el.className = 'mz-slot-card';
      const up = m.main && m.count >= 2 ? ' up' : '';   // con badge ×2 debajo, el % sube un piso
      // % uniforme para todas (el de la principal = su inclusión); «2ª» = compite la 2ª copia
      const stat = m.pct != null ? (m.copy === 2 ? '2ª · ' : '') + m.pct + '%' : esc(T('mazos.slotMain'));
      el.innerHTML = `<img src="${metaImg(cm)}" draggable="false" onerror="this.style.visibility='hidden'">`
        + (m.main && m.count >= 2 ? `<span class="mz-dl-x">${m.count}</span>` : '')
        + `<span class="mz-slot-pct${m.main ? ' main' : ''}${up}">${stat}</span>`;
      el.title = metaName(cm) || '';
      layer.appendChild(el);
      return el;
    });

    // Cue de intercambiable: chip «⇄ N» (clic = pasar a la siguiente) + puntitos de posición
    const swap = document.createElement('button');
    swap.type = 'button';
    swap.className = 'mz-slot-swap';
    swap.innerHTML = `<svg viewBox="0 0 16 12" width="12" height="9" fill="none">
      <path d="M4.6 1.2 2 3.4l2.6 2.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M2.4 3.4h9.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
      <path d="M11.4 6.4 14 8.6l-2.6 2.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M13.6 8.6H4.2" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    </svg>${n}`;
    swap.title = T('mazos.metaFlexTitle');
    cell.appendChild(swap);
    const dotsWrap = document.createElement('div');
    dotsWrap.className = 'mz-slot-dots';
    if (members[0].count >= 2) dotsWrap.classList.add('hi');   // deja sitio al badge ×2 + %
    const dots = members.map((_, i) => {
      const d = document.createElement('span');
      d.className = 'mz-slot-dot' + (i === 0 ? ' on' : '');
      dotsWrap.appendChild(d);
      return d;
    });
    cell.appendChild(dotsWrap);
    function syncDots() { dots.forEach((d, i) => d.classList.toggle('on', i === cur)); }

    const W = () => sizer.getBoundingClientRect().width || 143;
    function base(i, c) {
      const p = (i - c + n) % n, pv = Math.min(p, NB);
      return { p, tx: pv * DX, ty: -pv * DY, sc: 1 - pv * SC, z: 100 - p, op: p <= NB ? 1 : 0 };
    }
    const dim = p => p === 0 ? 'none' : 'brightness(0.75) saturate(0.92)';   // profundidad, sin colores
    function put(el, s, anim) {
      el.style.transition = anim
        ? 'transform .34s cubic-bezier(.25,1,.5,1), opacity .28s ease, filter .28s ease'
        : 'none';
      el.style.transform = `translate(${s.tx}px, ${s.ty}px) scale(${s.sc})`;
      el.style.zIndex = String(s.z);
      el.style.opacity = String(s.op);
      el.style.filter = dim(s.p);
    }
    // spread=true → abanico un poco más abierto (hover de escritorio: «aquí hay más cartas»)
    function layout(anim, spread) {
      const m = spread ? 1.6 : 1;
      els.forEach((el, i) => { const b = base(i, cur); b.tx *= m; b.ty *= m; put(el, b, anim); });
      syncDots();
    }
    function killAnims() { els.forEach(el => { (el.getAnimations ? el.getAnimations() : []).forEach(a => a.cancel()); }); }
    layout(false);

    // Pasar a otra carta con coreografía FÍSICA: la del frente sale hacia el lado, encoge, y ya
    // pequeña se desliza POR DETRÁS hasta el fondo del stack; el resto avanza un puesto a la vez.
    function goTo(target, dir, from) {
      if (target === cur) return;
      killAnims();
      const outEl = els[cur], outIdx = cur;
      cur = target; cell.dataset.cur = String(cur);
      els.forEach((el, i) => { if (el !== outEl) put(el, base(i, cur), true); });
      const fin = base(outIdx, cur);
      const w = W(), side = (dir >= 0 ? 1 : -1) * w * 0.62;
      const f = from || { tx: 0, ty: 0, sc: 1, rot: 0 };
      outEl.style.transition = 'none';
      outEl.style.zIndex = '100';                     // fase 1 por delante; pasa detrás a mitad de vuelo
      const anim = outEl.animate([
        { transform: `translate(${f.tx}px, ${f.ty}px) scale(${f.sc}) rotate(${f.rot || 0}deg)`, filter: dim(0), opacity: 1, zIndex: 100, offset: 0 },
        { transform: `translate(${side}px, ${fin.ty - 8}px) scale(${Math.max(fin.sc, 0.9)}) rotate(${(dir >= 0 ? 1 : -1) * 5}deg)`, filter: dim(1), opacity: 1, zIndex: 100, offset: 0.42 },
        { transform: `translate(${(fin.tx + side) / 2}px, ${fin.ty - 4}px) scale(${fin.sc}) rotate(${(dir >= 0 ? 1 : -1) * 2}deg)`, filter: dim(1), opacity: 1, zIndex: fin.z, offset: 0.62 },
        { transform: `translate(${fin.tx}px, ${fin.ty}px) scale(${fin.sc}) rotate(0deg)`, filter: dim(1), opacity: fin.op, zIndex: fin.z, offset: 1 }
      ], { duration: 460, easing: 'cubic-bezier(.3,.75,.25,1)' });
      anim.onfinish = () => put(outEl, fin, false);
      syncDots();
      window.sfx && window.sfx('ui.tab');
    }
    const step = (dir, from) => goTo((cur + dir + n) % n, dir, from);
    swap.addEventListener('click', () => step(1));   // el chip también hojea (afordancia de clic)

    // Hover de escritorio: el stack se abre un poco → «aquí hay más cartas para deslizar»
    if (window.matchMedia && matchMedia('(hover:hover)').matches) {
      layer.addEventListener('pointerenter', () => { if (!dragging) layout(true, true); });
      layer.addEventListener('pointerleave', () => { if (!dragging) layout(true); });
    }

    // ── Arrastre con inercia: umbral corto O golpe seco (flick); si no llega, vuelve suave ──
    let sx = 0, sy = 0, dragging = false, moved = false, vx = 0, lastX = 0, lastT = 0, inIdx = -1;
    layer.addEventListener('pointerdown', e => {
      const top = els[cur];
      if (!top.contains(e.target)) {                  // clic en una que asoma → tráela al frente
        const bi = els.findIndex(el => el.contains(e.target));
        if (bi >= 0 && bi !== cur) goTo(bi, 1);
        return;
      }
      e.preventDefault();
      killAnims(); layout(false);                     // por si pilla una animación a medias
      dragging = true; moved = false; inIdx = -1;
      sx = e.clientX; sy = e.clientY;
      vx = 0; lastX = e.clientX; lastT = performance.now();
      try { layer.setPointerCapture(e.pointerId); } catch (_) {}
    });
    layer.addEventListener('pointermove', e => {
      if (!dragging) return;
      const now = performance.now();
      vx = 0.7 * vx + 0.3 * ((e.clientX - lastX) / Math.max(1, now - lastT));
      lastX = e.clientX; lastT = now;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (!moved) return;
      // la carta NO sigue el dedo más allá del tope de la coreografía del chip (w*0.62);
      // el dedo puede seguir, la carta se queda en el tope
      const w = W(), MAXX = w * 0.62;
      const vdx = Math.max(-MAXX, Math.min(MAXX, dx));
      const prog = Math.min(1, Math.abs(vdx) / (w * 0.7));
      const dirNow = dx >= 0 ? 1 : -1;
      const tIdx = (cur + dirNow + n) % n;
      if (inIdx >= 0 && inIdx !== tIdx && inIdx !== cur) put(els[inIdx], base(inIdx, cur), false);   // cambió el sentido
      inIdx = tIdx;
      const frontEl = els[cur], bSc = 1 - NB * SC;
      frontEl.style.transition = 'none';              // el frente sigue el dedo (siempre por encima)
      frontEl.style.transform = `translate(${vdx}px, ${-prog * NB * DY}px) scale(${1 - prog * (1 - bSc)}) rotate(${vdx * 0.03}deg)`;
      if (inIdx !== cur) {                            // la entrante va subiendo al frente
        const b = base(inIdx, cur), inEl = els[inIdx];
        inEl.style.transition = 'none';
        inEl.style.transform = `translate(${b.tx * (1 - prog)}px, ${b.ty * (1 - prog)}px) scale(${b.sc + (1 - b.sc) * prog})`;
        inEl.style.zIndex = '99';
        inEl.style.opacity = String(b.op ? 1 : Math.min(1, 0.25 + prog));
        inEl.style.filter = `brightness(${(0.7 + 0.3 * prog).toFixed(3)}) saturate(${(0.92 + 0.08 * prog).toFixed(3)})`;
      }
      // pasado el tope (un poco más) → se suelta sola y completa el pase, sin esperar al pointerup
      if (Math.abs(dx) >= MAXX * 1.08) {
        dragging = false;
        try { layer.releasePointerCapture(e.pointerId); } catch (_) {}
        step(dirNow, { tx: vdx, ty: -prog * NB * DY, sc: 1 - prog * (1 - bSc), rot: vdx * 0.03 });
        inIdx = -1;
      }
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false;
      try { layer.releasePointerCapture(e.pointerId); } catch (_) {}
      const dx = e.clientX - sx;
      if (!moved) {                                   // tap limpio → zoom de la carta del frente
        const cm = metaCardById(members[cur].id), im = metaImg(cm);
        if (im && window.openZoomFromImage) window.openZoomFromImage(im, els[cur].querySelector('img') || els[cur]);
        return;
      }
      const w = W();
      const flick = Math.abs(vx) > 0.35 && Math.abs(dx) > 8;              // golpe seco corto
      const commit = flick || Math.abs(dx) >= Math.max(22, w * 0.16);     // o distancia corta
      if (commit) {
        const dir = dx >= 0 ? 1 : -1, bSc = 1 - NB * SC, prog = Math.min(1, Math.abs(dx) / (w * 0.7));
        step(dir, { tx: dx, ty: -prog * NB * DY, sc: 1 - prog * (1 - bSc), rot: dx * 0.03 });
      } else {
        layout(true);                                 // no llegó → vuelve suave a su sitio
      }
      inIdx = -1;
    }
    layer.addEventListener('pointerup', endDrag);
    layer.addEventListener('pointercancel', endDrag);

    // Rueda/trackpad HORIZONTAL = hojear (la vertical se deja pasar → scroll normal de la página)
    let wheelT = 0;
    layer.addEventListener('wheel', e => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 6) return;
      e.preventDefault();
      const now = performance.now();
      if (now - wheelT < 340) return;
      wheelT = now;
      step(e.deltaX > 0 ? 1 : -1);
    }, { passive: false });
    return cell;
  }

  // Busca primero en la fuente que se está mirando y, si no está, en las demás — y en ese
  // caso CAMBIA de fuente. Es lo que hace que un enlace a un mazo del meta propio funcione
  // aunque llegues con Limitless seleccionado (los ids no colisionan: los de Limitless
  // llevan el set dentro).
  function metaDeckById(id) {
    const aqui = metaRows().find(d => d.id === id);
    if (aqui) return aqui;
    const prev = _metaSource;
    for (const src of ['limitless', 'standard', 'advanced']) {
      if (src === prev) continue;
      _metaSource = src;
      const o = metaRows().find(d => d.id === id);
      if (o) return o;
    }
    _metaSource = prev;
    return null;
  }
  // Top-100 arquetipos por cuota (META_DECKS.decks ya viene ordenado por share desc). Cacheado.
  let _metaTop100 = null;
  function metaTop100Ids() {
    if (!_metaTop100) _metaTop100 = new Set(metaRows().slice(0, 100).map(d => d.id));
    return _metaTop100;
  }

  // Fila de un enfrentamiento (rival + barra de winrate + % + nº de partidas), clicable.
  // El cover usa el MISMO formato de miniatura de mazo que la tierlist (window._tlDeckCover):
  // mono = carta completa · dual = 50/50, SIN recorte cuadrado ni redondeo. Se inyecta tras
  // pintar (es un elemento DOM); aquí solo dejamos el hueco con data-mu-cover.
  function muRowHTML(m) {
    const opp = metaDeckById(m.id);
    const nm = opp ? opp.name : m.name;
    const p = Math.round(m.wr * 100);
    const col = wrColor(m.wr);
    return `<button class="mz-mu-row${opp ? '' : ' nolink'}" data-mu-id="${esc(m.id)}" title="${esc(nm + ' — ' + m.record)}">`
      + `<span class="mz-mu-cover" data-mu-cover="${esc(m.id)}"></span>`
      + `<span class="mz-mu-name">${esc(nm)}</span>`
      + `<span class="mz-mu-bar"><span style="width:${p}%;background:${col}"></span></span>`
      + `<span class="mz-mu-pct" style="color:${col}">${p}%</span>`
      + `<span class="mz-mu-n">${fmtNum(m.matches)}</span></button>`;
  }

  // Detalle META: tabs (Núcleo+techs / Versión N estilo sidebar) + distribución única
  function renderMetaDetail(deck, host, idx) {
    const r = deck._row || {};
    const variants = (r.variants && r.variants.length)
      ? r.variants
      : [{ cards: r.cards || [], share: null, winrate: r.winrate, games: r.games }];
    const cs = r.cardstats || {};
    let _mainTab = 'deck';                          // pestaña PRINCIPAL (donde estaban las versiones): 'deck' | 'results'
    let _finSort = { key: 'place', dir: 1 };        // orden de Resultados (defecto: puesto = percentil, mejor primero)
    let _muView = 'all';                           // enfrentamientos: 'all' (lista completa) | 'top' (destacados)
    let _lowTab = 'stats';                          // pestaña inferior (dentro de 'deck'): 'stats' | 'matchups'
    function openMatchupDeck(oid) {
      const o = metaDeckById(oid); if (!o) return;
      const i = metaRows().indexOf(o);
      window.sfx && window.sfx('mazos.open');
      showDetailView(buildMetaDeck(o), i);
    }
    function paintMatchups() {
      const box = host.querySelector('#mz-md-mu'); if (!box) return;
      // Lista «Todos» = enfrentamientos con 10+ partidas (se ve el nº de partidas → el usuario
      // juzga la fiabilidad). «Mejores y peores» = solo top-100 arquetipos Y 30+ partidas.
      const mu = (r.matchups || []).filter(m => m.matches >= 10);
      if (mu.length < 2) { box.innerHTML = ''; return; }
      const sorted = mu.slice().sort((a, b) => b.wr - a.wr);        // SIEMPRE de mejor a peor (1 sola columna)
      const seg = `<div class="mz-mu-seg">`
        + `<button class="mz-mu-sg${_muView === 'all' ? ' on' : ''}" data-v="all">${esc(T('mazos.matchupsAll'))}</button>`
        + `<button class="mz-mu-sg${_muView === 'top' ? ' on' : ''}" data-v="top">${esc(T('mazos.matchupsHighlights'))}</button></div>`;

      let rowsHtml, explain;
      if (_muView === 'top') {
        // «Mejores y peores»: SOLO contra el top-100 de arquetipos Y con 30+ partidas → excluye
        // destacados frente a mazos con demasiado pocos datos.
        const top = metaTop100Ids();
        const pool = sorted.filter(m => top.has(m.id) && m.matches >= 30);
        const k = Math.min(5, Math.floor(pool.length / 2));
        const best = pool.slice(0, k), worst = pool.slice(pool.length - k);
        rowsHtml = `<div class="mz-mu-div best"><span>${esc(T('mazos.matchupsBest'))}</span></div>` + best.map(muRowHTML).join('')
          + `<div class="mz-mu-div worst"><span>${esc(T('mazos.matchupsWorst'))}</span></div>` + worst.map(muRowHTML).join('');
        explain = T('mazos.matchupsExplainTop');
      } else {
        rowsHtml = sorted.map(muRowHTML).join('');
        explain = T('mazos.matchupsExplain');
      }

      box.innerHTML = `<div class="mz-mu-bar2"><span class="mz-mu-title">${esc(T('mazos.matchupsTitle'))}</span>${seg}</div>`
        + `<div class="mz-mu-explain">${esc(explain)}</div>`
        + `<div class="mz-mu-list">${rowsHtml}</div>`;
      // Cover de cada rival con el formato de miniatura de mazo de la tierlist (mono/dual,
      // sin recorte). _tlDeckCover resuelve el protagonista de forma robusta (icons→nombres→
      // fallback) → siempre hay miniatura, incl. mazos ambiguos como Mega Charizard X/Y ex.
      box.querySelectorAll('.mz-mu-cover[data-mu-cover]').forEach(el => {
        const o = metaDeckById(el.dataset.muCover);
        if (o && window._tlDeckCover) { try { el.appendChild(window._tlDeckCover(o)); } catch (e) {} }
      });
      box.querySelectorAll('.mz-mu-sg').forEach(b => b.onclick = () => { _muView = b.dataset.v; window.sfx && window.sfx('ui.tab'); paintMatchups(); });
      box.querySelectorAll('.mz-mu-row').forEach(el => el.onclick = () => openMatchupDeck(el.dataset.muId));
    }

    // SIN pestañas de build: la vista es EL MAZO del arquetipo (esqueleto = lista más usada,
    // con sus huecos vivos). Las listas exactas viven en la pestaña «Resultados» con su
    // procedencia real (torneo/puesto/jugador), no como «Versión 2/3» abstractas.
    const curCards = () => (variants[0] && variants[0].cards) || r.cards || [];
    function deckWith(cards) {
      const ex = expandMetaCards({ cards });
      return Object.assign({}, deck, { cards: ex, firstCardImg: (ex[0] && ex[0].image) || '' });
    }
    const curDeck = () => deckWith(curCards());
    function coreFlexCounts() {
      // Cuenta «flexible» con el MISMO criterio que el resaltado verde de la rejilla:
      // inclusión < 70% (cardstats) O aparece en la lista de intercambiables (r.flex).
      const flexIds = new Set((r.flex || []).map(f => f.id));
      let core = 0, flex = 0;
      curCards().forEach(c => { const st = cs[c.id]; const inc = st ? st[0] : 1; if (inc < 0.7 || flexIds.has(c.id)) flex += c.count; else core += c.count; });
      return { core, flex };
    }

    // Cablea la pestaña «Resultados»: orden por cabecera + 3 botones y zoom por resultado.
    function wireResults() {
      const box = host.querySelector('.mz-md-fins'); if (!box) return;
      box.querySelectorAll('.mz-fin-h[data-sort]').forEach(h => h.onclick = () => {
        const k = h.dataset.sort;
        if (_finSort.key === k) _finSort.dir *= -1;
        else _finSort = { key: k, dir: k === 'place' ? 1 : -1 };   // puesto asc (mejor); fecha/score desc
        window.sfx && window.sfx('ui.tab');
        box.innerHTML = metaFinishesHTML(r, _finSort);
        wireResults();
      });
      box.querySelectorAll('.mz-fin-row').forEach(row => {
        const cards = (r.finishLists || [])[+row.dataset.li] || [];
        const dk = () => deckWith(cards);
        const p = row.querySelector('.fin-activar'), g = row.querySelector('.fin-guardar'), s = row.querySelector('.fin-compartir');
        if (p) p.onclick = () => saveMetaToLibrary(dk(), { activate: true });
        if (g) g.onclick = () => saveMetaToLibrary(dk());
        if (s) s.onclick = () => { window.sfx && window.sfx('mazos.export'); exportDeckImage(dk()); };
        // Código 2D de ESTA lista exacta de torneo (se lleva al juego tal cual)
        const q = row.querySelector('.fin-qr');
        if (q) { if (!window.pbDeckQR) q.style.display = 'none'; else q.onclick = () => window.pbDeckQR.show(dk()); }
        row.querySelectorAll('.mz-fin-card[data-zoom]').forEach(el => el.addEventListener('click', () => {
          const im = el.getAttribute('data-zoom');
          if (im && window.openZoomFromImage) window.openZoomFromImage(im, el.querySelector('img') || el);
        }));
      });
    }

    function paint() {

      // Chips del ARQUETIPO (uso/victorias/Top-8/partidas/tendencia) → viven en la pestaña
      // «Estadísticas» (ya no junto al título). El dato POR BUILD va en el subtítulo (variantSub).
      const chips = [];
      chips.push(`<span class="mz-md-chip"><b>${pct(r.share)}</b> ${esc(T('mazos.metaUsage'))}</span>`);
      chips.push(`<span class="mz-md-chip wr"><b style="color:${wrColor(r.winrate)}">${pct(r.winrate)}</b> ${esc(T('mazos.metaWinrate'))}</span>`);
      if (r.top8 != null) chips.push(`<span class="mz-md-chip"><b>${Math.round(r.top8 * 100)}%</b> ${esc(T('mazos.metaTop8'))}</span>`);
      chips.push(`<span class="mz-md-chip"><b>${fmtNum(r.games || 0)}</b> ${esc(T('mazos.metaGamesShort'))}</span>`);
      const tr = trendHTML(r); if (tr) chips.push(`<span class="mz-md-chip trendchip">${tr}</span>`);
      // Energía del arquetipo: NO se muestra. `r.types` sale del elemento de los
      // protagonistas (no de la energía real enviada) → da info errónea en mazos
      // mixtos (p. ej. Blaziken+Greninja = fuego, no agua+fuego). Sin fuente fiable,
      // no se pone (pendiente: leer la energía enviada en torneos que la exijan).

      const k = coreFlexCounts();
      const sub = esc(T('mazos.coreSub', { fixed: k.core, flex: k.flex, lists: fmtNum(r.lists || 0) }));
      const hasFins = !!(r.finishes && r.finishes.length);
      if (_mainTab === 'results' && !hasFins) _mainTab = 'deck';

      const flexPanel = (r.flex && r.flex.length) ? `
          <div class="mz-md-flexpanel">
            <div class="mz-md-flextitle">${esc(T('mazos.metaFlexTitle'))}</div>
            <div class="mz-md-flexhint">${esc(T('mazos.metaFlexHint'))}</div>
            <div class="mz-md-flexlist">${r.flex.map(f => metaFlexRowHTML(f, deck.name)).join('')}</div>
          </div>` : '';

      // Pestañas PRINCIPALES (donde estaban las versiones): «Mazo» (deck + estadísticas +
      // enfrentamientos) y «Resultados» (las listas de torneo, estilo Limitless).
      const mainTabs = hasFins ? `
        <div class="mz-md-tabs mz-md-mtabs">
          <button class="mz-md-tab${_mainTab === 'deck' ? ' active' : ''}" data-main="deck">${esc(T('mazos.tabDeck'))}</button>
          <button class="mz-md-tab${_mainTab === 'results' ? ' active' : ''}" data-main="results">${esc(T(metaIsOwn() ? 'mazos.tabLists' : 'mazos.tabResults'))}</button>
        </div>` : '';

      // Rama «Mazo»: el mazo con huecos + acciones + pestañas inferiores (Estadísticas/Enfrentamientos).
      const deckPane = `
        <div class="mz-md-subline">${sub}</div>
        <div class="mz-md-hero"></div>
        <div class="mz-md-actions">
          <button class="mz-detail-btn labeled activar"><svg viewBox="0 0 16 16" fill="none"><polygon points="4,2 14,8 4,14" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" fill="currentColor"/></svg><span>${esc(T('mazos.saveAndActivate'))}</span></button>
          <button class="mz-detail-btn guardar"><svg viewBox="0 0 16 16" fill="none"><path d="M3.2 2.2h7.4l3.2 3.2v7.1a1.2 1.2 0 0 1-1.2 1.2H3.4a1.2 1.2 0 0 1-1.2-1.2V3.4a1.2 1.2 0 0 1 1.2-1.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M4.8 13.7V8.8h6.4v4.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.7 2.6V5.3H10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(T('mazos.saveToLibrary'))}</span></button>
          <button class="mz-detail-btn exportar"><svg viewBox="0 0 16 16" fill="none"><circle cx="4" cy="8" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="3.5" r="2" stroke="currentColor" stroke-width="1.3"/><circle cx="12" cy="12.5" r="2" stroke="currentColor" stroke-width="1.3"/><path d="M5.8 7l4.4-2.5M5.8 9l4.4 2.5" stroke="currentColor" stroke-width="1.3"/></svg><span>${esc(T('mazos.share'))}</span></button>
          <button class="mz-detail-btn qrbtn">${QR_SVG}<span>${esc(T('mazos.qrBtn'))}</span></button>
        </div>
        <div class="mz-md-tabs mz-md-tabs2">
          <button class="mz-md-tab${_lowTab === 'stats' ? ' active' : ''}" data-low="stats">${esc(T('mazos.tabStats'))}</button>
          <button class="mz-md-tab${_lowTab === 'matchups' ? ' active' : ''}" data-low="matchups">${esc(T('mazos.matchupsTitle'))}</button>
        </div>
        <div class="mz-md-low" data-low="stats"${_lowTab === 'stats' ? '' : ' style="display:none"'}>
          ${flexPanel}
          <div class="mz-md-prob"><div class="mz-md-prob-h">${esc(T('mazos.openingHand'))}</div><div class="mz-md-start"></div></div>
        </div>
        <div class="mz-md-low" data-low="matchups"${_lowTab === 'matchups' ? '' : ' style="display:none"'}>
          <div id="mz-md-mu" class="mz-md-mu"></div>
        </div>`;

      host.innerHTML = `
        <div class="mz-md-head"><div class="mz-md-title">${esc(deck.name)}</div><div class="mz-md-chips">${chips.join('')}</div></div>
        ${mainTabs}
        <div class="mz-md-pane" data-pane="deck"${_mainTab === 'deck' ? '' : ' style="display:none"'}>${deckPane}</div>
        ${hasFins ? `<div class="mz-md-pane" data-pane="results"${_mainTab === 'results' ? '' : ' style="display:none"'}>
          <div class="mz-md-fins">${metaFinishesHTML(r, _finSort)}</div></div>` : ''}`;

      // Pestañas principales: conmutan panel (el «Mazo» solo se cablea/pinta una vez → guard).
      host.querySelectorAll('.mz-md-mtabs .mz-md-tab').forEach(b => b.onclick = () => {
        if (b.dataset.main === _mainTab) return;
        _mainTab = b.dataset.main; window.sfx && window.sfx('ui.tab'); paint();
      });

      if (_mainTab === 'deck') {
        const heroOpts = { cardstats: cs, big: true, slots: r.slots || [] };
        const _hero = host.querySelector('.mz-md-hero');
        _hero.appendChild(deckLayout(curCards(), heroOpts));
        mzHoldImages(_hero);
        host.querySelectorAll('.mz-md-tabs2 .mz-md-tab').forEach(b => b.onclick = () => {
          _lowTab = b.dataset.low; window.sfx && window.sfx('ui.tab');
          host.querySelectorAll('.mz-md-tabs2 .mz-md-tab').forEach(x => x.classList.toggle('active', x.dataset.low === _lowTab));
          host.querySelectorAll('.mz-md-low').forEach(pnl => { pnl.style.display = (pnl.dataset.low === _lowTab ? '' : 'none'); });
        });
        host.querySelector('.activar').onclick  = () => saveMetaToLibrary(curDeck(), { activate: true });
        host.querySelector('.guardar').onclick  = () => saveMetaToLibrary(curDeck());
        host.querySelector('.exportar').onclick = () => { window.sfx && window.sfx('mazos.export'); exportDeckImage(curDeck()); };
        host.querySelector('.qrbtn').onclick    = () => { if (window.pbDeckQR) window.pbDeckQR.show(curDeck()); };
        paintMatchups();
        renderStartProbs(curDeck().cards, host.querySelector('.mz-md-start'));
        // Click en la MINIATURA de una carta intercambiable = zoom (el hover sigue dando tooltip).
        host.querySelectorAll('.mz-md-frow[data-zoom]').forEach(el => {
          const im = el.getAttribute('data-zoom'); if (!im) return;
          const th = el.querySelector('.mz-md-fthumb'); if (!th) return;
          th.addEventListener('click', () => { if (window.openZoomFromImage) window.openZoomFromImage(im, th); });
        });
      } else {
        wireResults();
      }
    }
    paint();
  }

  // Imagen CANÓNICA (en) del protagonista de un mazo, para la portada por defecto
  // de Mis Mazos / la sidebar. Prioriza el protagonista curado del pipeline meta;
  // si no, cae a la heurística (EX/Mega → fase más alta → más HP).
  function deckCoverCanonical(deck) {
    const prot = (deck && deck._meta && deck._meta.protagonists) || [];
    for (const pid of prot) { const c = metaCardById(pid); if (c && c.image) return c.image; }
    const p = deckProtagonist(deck);
    return (p && p.image) || (deck.cards && deck.cards[0] && deck.cards[0].image) || deck.firstCardImg || '';
  }

  // Convierte un mazo meta en el formato ligero y estable de «Mis Mazos».
  // Separado del diálogo de guardado para que otros flujos controlados (p. ej. la
  // baraja de bienvenida) puedan persistirlo sin guardar `_row` ni objetos DB completos.
  function metaLibraryRecord(deck, opts) {
    opts = opts || {};
    const ordered = sortDeckCards((deck && deck.cards) || []);
    const now = opts.savedAt != null ? opts.savedAt : Date.now();
    const record = {
      id: opts.id != null ? opts.id : now,
      name: opts.name || (deck && deck.name) || '',
      cards: ordered.map(c => ({
        id: c.id || '', name: c.name || '',
        image: c._temp ? '' : (c.image || ''),
        health: c.health || 0, cardType: c.cardType || '', element: c.element || '',
        stage: c.stage || '', evolvesFrom: c.evolvesFrom || '',
        expansion: window.cardSetCode ? window.cardSetCode(c) : (c.expansion || c.set || ''),
        number: c.number || '', rarity: c.rarity || '', _temp: c._temp || false,
      })),
      energyTypes: (opts.energyTypes || (deck && deck.energyTypes) || []).slice(),
      format: opts.format || (window.formatIdOf ? window.formatIdOf(deck) : 'standard'),
      // Portada por defecto = protagonista del mazo (no la primera carta suelta).
      firstCardImg: deckCoverCanonical(deck || {}),
      _meta: { protagonists: ((deck && deck._meta && deck._meta.protagonists) || []).slice() },
      source: opts.source || 'meta',
      savedAt: now,
    };
    if (opts.welcome) record.welcome = true;
    return record;
  }

  // Guardar un mazo del meta en Mis Mazos (mismo formato que el guardado normal)
  // Guarda un mazo del meta (o una lista de torneo) en Mis Mazos. Con `opts.activate`
  // además lo deja como MAZO ACTIVO: es el atajo del botón de play en las vistas meta,
  // donde no se puede activar directamente (el mazo aún no está en tu biblioteca).
  function saveMetaToLibrary(deck, opts) {
    const activate = !!(opts && opts.activate);
    const suggested = (deck.energyTypes && deck.energyTypes.length)
      ? deck.energyTypes.slice()
      : (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(deck.cards || [])) : []);
    window.pbDeckSave({
      title: T('deck.saveTitle'),
      name: deck.name || '',
      nameEditable: true,
      suggested,
      okLabel: T('common.save'),
    }).then(res => {
      if (!res) return;
      const lib = loadLibrary();
      const newId = Date.now();
      lib.push(metaLibraryRecord(deck, {
        id: newId,
        name: res.name || deck.name,
        energyTypes: res.energyTypes || [],
        source: 'meta',
      }));
      saveLibrary(lib);
      window.sfx && window.sfx('mazos.save');
      if (activate) {
        if (window._pbSetActiveDeck) window._pbSetActiveDeck(newId);
        window.pbToast && window.pbToast(T('mazos.activated', { name: res.name || deck.name }));
      } else {
        window.pbToast && window.pbToast(T('mazos.savedToLibrary', { name: res.name || deck.name }));
      }
    });
  }

  // ── Expose to window ──────────────────────────────────────────
  window._mazosShowGrid   = showGridView;
  window._mazosDeckCover  = deckCover;   // portada canónica (para el hub «Jugar»)
  // Abre Mis Mazos forzando el lado «Mis mazos» (NUNCA Meta) — lo usa el hub «Jugar» al tocar el mazo.
  window._mazosOpenMine = function (opts) {
    _mzMode = 'mine';
    if (window.switchAppTab) window.switchAppTab('mazos');
    // PRESERVA el estado de la pestaña: si ya hay un mazo PROPIO abierto (viéndolo o editándolo)
    // NO se fuerza la rejilla → vuelves donde estabas. El hub «Jugar» pasa {grid:true} para
    // ir SIEMPRE a la rejilla (ahí sí quieres elegir mazo).
    var detail = document.getElementById('mz-detail-view');
    var mineOpen = !(opts && opts.grid) && detail && getComputedStyle(detail).display !== 'none' && _currentDeck && !_currentDeck._isMeta;
    if (!mineOpen) showGridView(true);
  };
  // Pestaña META del nav (split Barajas/Meta): fuerza el lado «Mejores mazos».
  // switchAppTab('meta') empuja la ruta /meta ANTES del showGridView → _pbCloseDeckRoute
  // ya no ve slug de detalle y no pisa la URL.
  window._mazosOpenMeta = function (opts) {
    _mzMode = 'meta';
    if (window.switchAppTab) window.switchAppTab('meta');
    var detail = document.getElementById('mz-detail-view');
    var metaOpen = !(opts && opts.grid) && detail && getComputedStyle(detail).display !== 'none' && _currentDeck && _currentDeck._isMeta;
    if (!metaOpen) showGridView(true);
  };
  // Setter/getter del lado para switchAppTab (rutas /meta directas y resaltado del nav).
  window._mazosSetSide = function (side) { _mzMode = (side === 'mine') ? 'mine' : 'meta'; };
  window._mazosCurrentSide = function () { return _mzMode; };
  window._mazosShowDetail = showDetailView;
  window._mazosRenderGrid = renderGrid;
  window._mazosInit       = initMazosView;
  window._exportDeckImage = exportDeckImage;
  window._mazosDeckLayout = deckLayout;   // hook de test (verificación headless de los huecos flex)
  // Formato «Mis Mazos» (2 filas, badge ×2) a partir de OBJETOS de carta (con duplicados).
  // Lo usa el final del draft multijugador para mostrar los dos mazos igual que en Mazos.
  window._mazosDeckLayoutFromCards = function (cards, opts) { return deckLayout(collapseCards(cards || []), opts || {}); };
  window._mazosFitDeck = fitDeckEl;   // re-ajuste manual de una vista de mazo (hook de test)
  window._mazosShareDeck = openShareMenu;   // menú compartir (imagen/link/texto) — reusado por el fin del draft MP
  window._mazosDeckToText = deckToText;     // hook de test (lista en texto: código de expansión + número)
  window._mazosRenderMetaDetail = renderMetaDetail;   // hook de test (detalle meta completo)
  window._mazosSaveMeta = saveMetaToLibrary;          // hook de test (guardar meta, con {activate:true})
  window._mazosBuildMetaDeck = buildMetaDeck;
  window._mazosMetaLibraryRecord = metaLibraryRecord; // serializador sin diálogo (bienvenida/tests)
  window._mazosRenderDeckPNG = renderDeckPNG;   // hook de test (export PNG del mazo)
  window._drawDeckImageToCanvas = drawDeckImageToCanvas;   // hook de test (render a canvas)
  window._openDeckImageDialog = openExportOptions;         // hook de test (diálogo con preview)
  window._DECK_IMG_CFG = DECK_IMG_CFG;                      // hook de test (config por formato)
  // Fondo + marca de agua branded reutilizables (los usa la tierlist para el mismo look)
  window.tcgBrandBg = async function (ctx, W, H, iconKeys) {
    const c = DECK_IMG_CFG.horizontal;
    const keys = (iconKeys && iconKeys.length) ? iconKeys : ['C'];
    for (const k of keys) await _symbolTile(k, c.iconSize, c.iconColor);
    _drawImgBg(ctx, W, H, c, keys);
  };
  window.tcgBrandWatermark = function (ctx, W, H) { _drawWatermark(ctx, W, H, DECK_IMG_CFG.horizontal); };

  // Auto-refresh grid when library changes (e.g., deck saved from sidebar)
  window._mazosRefreshIfOpen = function() {
    const view = document.getElementById('view-mazos');
    if (!view || view.style.display === 'none') return;
    // Con un arrastre vivo, re-pintar vaciaría la rejilla y dejaría huérfana la tarjeta que
    // se está moviendo (el fantasma seguiría al cursor y el destino se calcularía sobre
    // tarjetas nuevas). Se aplaza al soltar.
    if (_mzDragActive) { _mzDragPending = true; return; }
    const gridView = document.getElementById('mz-grid-view');
    if (gridView && gridView.style.display !== 'none') renderGrid();
  };

})();
