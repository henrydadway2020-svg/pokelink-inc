/* ══════════════════════════════════════════════════════════════
   router.js — Rutas/URLs por sección E IDIOMA (client-side routing)
   INGLÉS en la RAÍZ (/, /cards, /decks…) = idioma por defecto;
   cada otro idioma bajo su prefijo (/es/cartas, /ja/decks, /pt/cards…).
   El idioma lo determina la URL: al cargar, la app se pone en ese
   idioma; al navegar se mantiene el prefijo; al cambiar de idioma con
   el selector, la URL salta a la misma sección en ese idioma.
   La RAÍZ pelada autodetecta (idioma guardado > navegador > inglés) y
   redirige a su prefijo. hreflang/canonical los pone el prerender
   (build_public.py). Solo activo sobre http/https; en file:// (dist
   single-file) queda inerte (como antes).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var SITE = 'https://pokelink.com';
  // en primero (raíz/por defecto). El resto lleva prefijo.
  var LANGS = ['en', 'es', 'ja', 'it', 'fr', 'pt', 'ko'];
  var PREFIXED = ['es', 'ja', 'it', 'fr', 'pt', 'ko'];   // todos menos en (raíz)
  // slug por (tab, idioma) — DEBE coincidir con build_public.py. en en la raíz;
  // es con palabras en español; el resto usa las palabras inglesas bajo su prefijo.
  // 2026-08-08: JUGAR = LA RAÍZ (el Inicio viejo murió; el hub es el nuevo Inicio).
  // 'home' ya no tiene slug: cualquier tab desconocida cae a jugar (raíz). Los /play
  // viejos también caen a la raíz vía el fallback de parsePath.
  var SLUGS = {
    jugar:    { en: '',         es: 'es',          ja: 'ja',          it: 'it',          fr: 'fr',          pt: 'pt',          ko: 'ko' },
    cards:    { en: 'cards',    es: 'es/cartas',   ja: 'ja/cards',    it: 'it/cards',    fr: 'fr/cards',    pt: 'pt/cards',    ko: 'ko/cards' },
    mazos:    { en: 'decks',    es: 'es/mazos',    ja: 'ja/decks',    it: 'it/decks',    fr: 'fr/decks',    pt: 'pt/decks',    ko: 'ko/decks' },
    tierlist: { en: 'tierlist', es: 'es/tierlist', ja: 'ja/tierlist', it: 'it/tierlist', fr: 'fr/tierlist', pt: 'pt/tierlist', ko: 'ko/tierlist' },
    board:    { en: 'board',    es: 'es/tablero',  ja: 'ja/board',    it: 'it/board',    fr: 'fr/board',    pt: 'pt/board',    ko: 'ko/board' },
    draft:    { en: 'draft',    es: 'es/draft',    ja: 'ja/draft',    it: 'it/draft',    fr: 'fr/draft',    pt: 'pt/draft',    ko: 'ko/draft' },
    meta:     { en: 'meta',     es: 'es/meta',     ja: 'ja/meta',     it: 'it/meta',     fr: 'fr/meta',     pt: 'pt/meta',     ko: 'ko/meta' },
    // Perfil (Maestría Pokémon): vista privada por usuario (sin prerender/SEO a propósito)
    perfil:   { en: 'profile',  es: 'es/perfil',   ja: 'ja/profile',  it: 'it/profile',  fr: 'fr/profile',  pt: 'pt/profile',  ko: 'ko/profile' }
  };
  // reverse: último segmento del slug → tab, por idioma
  var TAB_BY_SEG = {};
  LANGS.forEach(function (lg) { TAB_BY_SEG[lg] = {}; });
  Object.keys(SLUGS).forEach(function (tab) {
    LANGS.forEach(function (lg) { TAB_BY_SEG[lg][SLUGS[tab][lg].split('/').pop()] = tab; });
  });

  // título + descripción por (tab, idioma) — coincide con el prerender. Se aplican al navegar
  // dentro de la SPA y al renderizar (para que <title>/description casen con la URL/idioma).
  var META = {
    home: {
      en: { title: "PokeLink — Cards, decks and matches for Pokémon TCG Pocket", desc: "Cards, decks and matches for Pokémon TCG Pocket in one place. Board, advanced card search, deck builder, tier list and draft." },
      es: { title: "PokeLink — Cartas, mazos y partidas de Pokémon TCG Pocket", desc: "Cartas, mazos y partidas de Pokémon TCG Pocket en un sitio. Tablero, buscador con filtros avanzados, deck builder, tier list y draft." },
      ja: { title: "PokeLink — ポケポケ（ポケモンTCGポケット）のカード・デッキ・対戦", desc: "ポケモンTCGポケットのカード検索、デッキ構築、対戦ボード、ティアリスト、ドラフトをひとつに。" },
      it: { title: "PokeLink — Carte, mazzi e partite per Pokémon TCG Pocket", desc: "Carte, mazzi e partite per Pokémon TCG Pocket in un unico posto. Tabellone, ricerca avanzata delle carte, costruttore di mazzi, tier list e draft." },
      fr: { title: "PokeLink — Cartes, decks et parties pour Pokémon TCG Pocket", desc: "Cartes, decks et parties pour Pokémon TCG Pocket au même endroit. Plateau, recherche de cartes avancée, deck builder, tier list et draft." },
      pt: { title: "PokeLink — Cartas, decks e partidas de Pokémon TCG Pocket", desc: "Cartas, decks e partidas de Pokémon TCG Pocket em um só lugar. Tabuleiro, busca avançada de cartas, montador de decks, tier list e draft." },
      ko: { title: "PokeLink — Pokémon TCG Pocket 카드, 덱, 대전", desc: "Pokémon TCG Pocket(포켓포켓)의 카드, 덱, 대전을 한곳에서. 보드, 고급 카드 검색, 덱 빌더, 티어표, 드래프트까지." },
    },
    cards: {
      en: { title: "Pokémon TCG Pocket card search — PokeLink", desc: "Search 3,400+ Pokémon TCG Pocket cards with advanced filters: type, rarity, HP, energy cost, attacks and abilities." },
      es: { title: "Buscador de cartas de Pokémon TCG Pocket — PokeLink", desc: "Busca entre más de 3.400 cartas de Pokémon TCG Pocket con filtros avanzados: tipo, rareza, HP, coste de energía, ataques y habilidades." },
      ja: { title: "ポケモンTCGポケット カード検索 — PokeLink", desc: "3,400枚以上のポケモンTCGポケットのカードを詳細フィルターで検索：タイプ・レアリティ・HP・エネルギー・ワザ・特性。" },
      it: { title: "Ricerca carte Pokémon TCG Pocket — PokeLink", desc: "Cerca oltre 3.400 carte di Pokémon TCG Pocket con filtri avanzati: tipo, rarità, HP, costo di energia, attacchi e abilità." },
      fr: { title: "Recherche de cartes Pokémon TCG Pocket — PokeLink", desc: "Recherchez plus de 3 400 cartes Pokémon TCG Pocket avec des filtres avancés : type, rareté, PV, coût en énergie, attaques et talents." },
      pt: { title: "Busca de cartas de Pokémon TCG Pocket — PokeLink", desc: "Pesquise mais de 3.400 cartas de Pokémon TCG Pocket com filtros avançados: tipo, raridade, HP, custo de energia, ataques e habilidades." },
      ko: { title: "Pokémon TCG Pocket 카드 검색 — PokeLink", desc: "3,400장이 넘는 Pokémon TCG Pocket 카드를 고급 필터로 검색하세요. 타입, 레어도, HP, 에너지 비용, 기술, 특성까지." },
    },
    // /decks (Barajas) = TUS mazos (constructor + biblioteca). El contenido del META
    // vive en /meta desde el split definitivo (2026-08-12) → cada URL dice lo que es.
    mazos: {
      en: { title: "My decks — Pokémon TCG Pocket deck builder | PokeLink", desc: "Build, save and share your Pokémon TCG Pocket decks: 20-card lists, starting-hand odds, deck image, text list and the in-game QR code." },
      es: { title: "Mis mazos — Constructor de mazos de Pokémon TCG Pocket | PokeLink", desc: "Construye, guarda y comparte tus mazos de Pokémon TCG Pocket: listas de 20 cartas, probabilidades de mano inicial, imagen, lista en texto y código QR." },
      ja: { title: "マイデッキ — ポケモンTCGポケットのデッキ構築 | PokeLink", desc: "ポケモンTCGポケットのデッキを構築・保存・共有。20枚のリスト、初手の確率、デッキ画像、テキストリスト、ゲームのQRコードに対応。" },
      it: { title: "I miei mazzi — Costruttore di mazzi Pokémon TCG Pocket | PokeLink", desc: "Crea, salva e condividi i tuoi mazzi di Pokémon TCG Pocket: liste da 20 carte, probabilità di mano iniziale, immagine, lista testuale e codice QR del gioco." },
      fr: { title: "Mes decks — Créateur de decks Pokémon TCG Pocket | PokeLink", desc: "Créez, sauvegardez et partagez vos decks Pokémon TCG Pocket : listes de 20 cartes, probabilités de main de départ, image, liste texte et code QR du jeu." },
      pt: { title: "Meus decks — Construtor de decks de Pokémon TCG Pocket | PokeLink", desc: "Monte, salve e compartilhe seus decks de Pokémon TCG Pocket: listas de 20 cartas, probabilidades de mão inicial, imagem, lista em texto e código QR do jogo." },
      ko: { title: "내 덱 — Pokémon TCG Pocket 덱 빌더 | PokeLink", desc: "Pokémon TCG Pocket 덱을 만들고 저장하고 공유하세요. 20장 리스트, 초기 손패 확률, 덱 이미지, 텍스트 리스트, 게임 QR 코드까지." }
    },
    tierlist: {
      en: { title: "Pokémon TCG Pocket tier list — PokeLink", desc: "Pokémon TCG Pocket meta tier list: the best decks and cards ranked. Build your own tier list and share it." },
      es: { title: "Tier list de Pokémon TCG Pocket — PokeLink", desc: "Tier list del meta de Pokémon TCG Pocket: ránking de los mejores mazos y cartas. Crea tu propia tier list y compártela." },
      ja: { title: "ポケモンTCGポケット ティアリスト — PokeLink", desc: "ポケモンTCGポケット環境のティアリスト：最強デッキ・カードのランキング。自分だけのティアリストも作成・共有可能。" },
      it: { title: "Tier list di Pokémon TCG Pocket — PokeLink", desc: "Tier list meta di Pokémon TCG Pocket: i migliori mazzi e le migliori carte classificati. Crea la tua tier list e condividila." },
      fr: { title: "Tier list Pokémon TCG Pocket — PokeLink", desc: "Tier list meta de Pokémon TCG Pocket : les meilleurs decks et cartes classés. Créez votre propre tier list et partagez-la." },
      pt: { title: "Tier list de Pokémon TCG Pocket — PokeLink", desc: "Tier list do meta de Pokémon TCG Pocket: os melhores decks e cartas ranqueados. Monte sua própria tier list e compartilhe." },
      ko: { title: "Pokémon TCG Pocket 티어표 — PokeLink", desc: "Pokémon TCG Pocket 메타 티어표: 최고의 덱과 카드 순위. 나만의 티어표를 만들고 공유하세요." },
    },
    board: {
      en: { title: "Board / match simulator — Pokémon TCG Pocket | PokeLink", desc: "Set up plays and simulate full Pokémon TCG Pocket matches controlling both players. Interactive board with the game rules." },
      es: { title: "Tablero / simulador de partidas — Pokémon TCG Pocket | PokeLink", desc: "Monta jugadas y simula partidas completas de Pokémon TCG Pocket manejando a los dos jugadores. Tablero interactivo con las reglas del juego." },
      ja: { title: "対戦ボード／シミュレーター — ポケモンTCGポケット | PokeLink", desc: "両プレイヤーを操作してポケモンTCGポケットの対戦を再現・シミュレート。ゲームのルールに対応したインタラクティブなボード。" },
      it: { title: "Tabellone / simulatore di partite — Pokémon TCG Pocket | PokeLink", desc: "Imposta le mosse e simula intere partite di Pokémon TCG Pocket controllando entrambi i giocatori. Tabellone interattivo con le regole del gioco." },
      fr: { title: "Plateau / simulateur de parties — Pokémon TCG Pocket | PokeLink", desc: "Préparez des situations et simulez des parties complètes de Pokémon TCG Pocket en contrôlant les deux joueurs. Plateau interactif avec les règles du jeu." },
      pt: { title: "Tabuleiro / simulador de partidas — Pokémon TCG Pocket | PokeLink", desc: "Monte jogadas e simule partidas completas de Pokémon TCG Pocket controlando os dois jogadores. Tabuleiro interativo com as regras do jogo." },
      ko: { title: "보드 / 대전 시뮬레이터 — Pokémon TCG Pocket | PokeLink", desc: "양쪽 플레이어를 조작하며 상황을 연출하고 Pokémon TCG Pocket 대전을 처음부터 끝까지 시뮬레이션하세요. 게임 규칙이 적용된 인터랙티브 보드." },
    },
    draft: {
      en: { title: "Pokémon TCG Pocket draft — PokeLink", desc: "Pokémon TCG Pocket draft mode: build a deck by picking from waves of cards, single-player style." },
      es: { title: "Draft de Pokémon TCG Pocket — PokeLink", desc: "Modo draft de Pokémon TCG Pocket: construye un mazo eligiendo entre oleadas de cartas, estilo single-player." },
      ja: { title: "ポケモンTCGポケット ドラフト — PokeLink", desc: "ポケモンTCGポケットのドラフトモード：カードの選択を繰り返して20枚のデッキを構築するシングルプレイ。" },
      it: { title: "Draft di Pokémon TCG Pocket — PokeLink", desc: "Modalità draft di Pokémon TCG Pocket: costruisci un mazzo scegliendo tra ondate di carte, in stile giocatore singolo." },
      fr: { title: "Draft Pokémon TCG Pocket — PokeLink", desc: "Mode draft de Pokémon TCG Pocket : composez un deck en piochant parmi des vagues de cartes, en solo." },
      pt: { title: "Draft de Pokémon TCG Pocket — PokeLink", desc: "Modo draft de Pokémon TCG Pocket para um jogador: monte um deck escolhendo entre ondas de cartas." },
      ko: { title: "Pokémon TCG Pocket 드래프트 — PokeLink", desc: "Pokémon TCG Pocket 드래프트 모드: 여러 차례 제시되는 카드 중에서 골라 덱을 완성하는 싱글 플레이 방식." },
    },
    // jugar = LA RAÍZ → conserva el título/desc de MARCA que tenía el Inicio viejo (continuidad SEO)
    jugar: {
      en: { title: "PokeLink — Cards, decks and matches for Pokémon TCG Pocket", desc: "Cards, decks and matches for Pokémon TCG Pocket in one place. Play online, search cards, build decks and follow the meta." },
      es: { title: "PokeLink — Cartas, mazos y partidas de Pokémon TCG Pocket", desc: "Cartas, mazos y partidas de Pokémon TCG Pocket en un sitio. Juega online, busca cartas, construye mazos y sigue el meta." },
    },
    // /meta = Mejores mazos (el contenido del meta y su SEO viven aquí desde el split).
    meta: {
      en: { title: "Best meta decks for Pokémon TCG Pocket — PokeLink", desc: "The best Pokémon TCG Pocket meta decks with usage %, win rate and tournament lists. Build, save and share your own decks." },
      es: { title: "Mejores mazos meta de Pokémon TCG Pocket — PokeLink", desc: "Los mejores mazos del meta de Pokémon TCG Pocket con % de uso, winrate y listas de torneo. Construye, guarda y comparte tus mazos." },
      ja: { title: "ポケモンTCGポケット 最強デッキ（環境）— PokeLink", desc: "ポケモンTCGポケットの環境上位デッキを使用率・勝率・大会リスト付きで掲載。デッキの構築・保存・共有も。" },
      it: { title: "I migliori mazzi meta di Pokémon TCG Pocket — PokeLink", desc: "I migliori mazzi meta di Pokémon TCG Pocket con % di utilizzo, percentuale di vittorie e liste da tornei. Crea, salva e condividi i tuoi mazzi." },
      fr: { title: "Meilleurs decks meta pour Pokémon TCG Pocket — PokeLink", desc: "Les meilleurs decks meta de Pokémon TCG Pocket avec % d'utilisation, taux de victoire et listes de tournoi. Créez, sauvegardez et partagez vos propres decks." },
      pt: { title: "Melhores decks do meta de Pokémon TCG Pocket — PokeLink", desc: "Os melhores decks do meta de Pokémon TCG Pocket com % de uso, taxa de vitória e listas de torneio. Monte, salve e compartilhe seus próprios decks." },
      ko: { title: "Pokémon TCG Pocket 최고의 메타 덱 — PokeLink", desc: "사용률, 승률, 대회 리스트로 보는 Pokémon TCG Pocket 최고의 메타 덱. 나만의 덱을 만들고 저장하고 공유하세요." },
    },
  };

  function routingOn() { return location.protocol === 'http:' || location.protocol === 'https:'; }
  function curLang() { return (window.i18n && window.i18n.getLang && window.i18n.getLang()) || 'en'; }

  // pathname → { lang, tab }.  inglés = raíz (sin prefijo); el resto lleva /xx/.
  function parsePath(pathname) {
    var p = (pathname || '/').replace(/\.html$/, '').replace(/\/+$/, '');
    var lang = 'en';
    var m = p.match(/^\/(es|ja|it|fr|pt|ko)(?=\/|$)/);
    if (m) { lang = m[1]; p = p.slice(m[0].length); }
    if (p === '' || p === '/' || p === '/index.html') return { lang: lang, tab: 'jugar' };
    var seg = p.split('/')[1] || '';
    return { lang: lang, tab: TAB_BY_SEG[lang][seg] || TAB_BY_SEG.en[seg] || 'jugar' };
  }
  function pathFor(tab, lang) { return '/' + (SLUGS[tab] || SLUGS.jugar)[lang]; }   // jugar en → '/'
  function mazosSlug(pathname) {
    var m = (pathname || '').match(/^(?:\/(?:es|ja|it|fr|pt|ko))?\/(?:mazos|decks)\/([^\/?#]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function currentTab() {
    // jugar/board/draft comparten el resaltado visual de «Jugar» (T3) → la pestaña real
    // la fija switchAppTab en window._pbCurrentTab; el .active visible es solo fallback.
    if (window._pbCurrentTab) return window._pbCurrentTab;
    var a = document.querySelector('#app-nav-tabs .app-tab.active');
    return a ? a.id.replace('app-tab-', '') : null;
  }

  var _silent = false, _settingLang = false;

  // Título/descripción/canonical de la sección+idioma actuales + quita el bloque de prerender.
  window._pbApplyRouteMeta = function (tab) {
    var lang = curLang();
    var m = (META[tab] && META[tab][lang]) || (META.home && META.home[lang]) || {};
    try {
      if (m.title) document.title = m.title;
      var d = document.querySelector('meta[name="description"]'); if (d && m.desc) d.setAttribute('content', m.desc);
      var c = document.querySelector('link[rel="canonical"]'); if (c) { var cp = pathFor(tab, lang); c.setAttribute('href', SITE + (cp === '/' ? '' : cp)); }
    } catch (e) {}
    var seo = document.getElementById('seo-prerender');
    if (seo && seo.parentNode) seo.parentNode.removeChild(seo);
  };

  function routerSetLang(lang) {   // pone el idioma sin re-navegar (marca la bandera)
    if (!window.i18n || !window.i18n.setLang) return;
    if (window.i18n.getLang && window.i18n.getLang() === lang) return;
    _settingLang = true;
    try { window.i18n.setLang(lang); } catch (e) {}
    _settingLang = false;
  }

  // Sincroniza la URL con la sección actual (lo llama switchAppTab), en el idioma actual.
  window._pbRouteSync = function (tab) {
    if (_silent || !routingOn()) return;
    if (tab === 'mazos' && mazosSlug(location.pathname)) return;
    var path = pathFor(tab, curLang());
    if (location.pathname !== path) { try { history.pushState({ tab: tab }, '', path); } catch (e) {} }
  };
  // Fija la URL (replaceState, sin nueva entrada) a una sección SIN cambiar la vista visible.
  // Lo usa el DRAFT ONLINE: se muestra la vista de draft (#view-draft) pero la URL/sección
  // lógica es el HUB «Jugar» → al recargar se aterriza en el hub (y allí se reanuda/limpia),
  // NUNCA en el draft en solitario. También alinea nav/idioma (todo cuelga de _pbCurrentTab).
  window._pbReplaceRoute = function (tab) {
    if (!routingOn()) return;
    window._pbCurrentTab = tab;
    var path = pathFor(tab, curLang());
    if (location.pathname !== path) { try { history.replaceState({ tab: tab }, '', path); } catch (e) {} }
    window._pbApplyRouteMeta(tab);
  };
  // Ejecuta un cambio de VISTA (switchAppTab) SIN tocar URL/historial: el llamante fija la ruta
  // aparte con _pbReplaceRoute. Evita empujar una entrada transitoria (p.ej. /draft) que luego se
  // reemplaza por /play → sin basura de historial ni un «Atrás» muerto. Reusa la bandera _silent
  // (la misma que usa go() en popstate) para que _pbRouteSync no empuje.
  window._pbViewOnly = function (fn) {
    var prev = _silent; _silent = true;
    try { fn(); } finally { _silent = prev; }
  };
  // Detalle de mazo: /mazos/<slug> (o /en/decks/<slug>…) — una entrada de historial por mazo.
  window._pbOpenDeckRoute = function (slug) {
    if (!routingOn() || !slug) return;
    try { history.pushState({ tab: 'mazos', deck: slug }, '', pathFor('mazos', curLang()) + '/' + encodeURIComponent(slug)); } catch (e) {}
  };
  window._pbCloseDeckRoute = function () {
    if (!routingOn()) return;
    if (mazosSlug(location.pathname)) { try { history.replaceState({ tab: 'mazos' }, '', pathFor('mazos', curLang())); } catch (e) {} }
  };

  function go(tab) {
    if (tab === currentTab()) return;
    _silent = true;
    if (window.switchAppTab) window.switchAppTab(tab);
    _silent = false;
  }

  window.addEventListener('popstate', function () {
    if (!routingOn()) return;
    var pr = parsePath(location.pathname);
    routerSetLang(pr.lang);
    go(pr.tab);
    window._pbApplyRouteMeta(pr.tab);
    if (pr.tab === 'mazos') {
      var slug = mazosSlug(location.pathname);
      if (slug) { if (!(window._mazosOpenById && window._mazosOpenById(slug)) && window._mazosShowGrid) window._mazosShowGrid(); }
      // Sin slug = la rejilla… salvo que haya un mazo A MEDIAS: volver con el botón ATRÁS
      // del navegador NO puede tirar lo que estabas construyendo (era el bug del reporte).
      // OJO: aquí NO se aparca aunque `_mazosIsEditing()` sea true. Estando en el constructor
      // y yendo a otra pestaña, la edición sigue viva; atrás es justo cómo se VUELVE a ella
      // (el caso del reporte). Quien decide es el flag `auto`: aparcar a propósito lo apaga.
      else if (window._mazosDraftIsAuto && window._mazosDraftIsAuto() && window._mazosResumeDraft) window._mazosResumeDraft();
      else if (window._mazosShowGrid) window._mazosShowGrid();
    }
  });

  // Cambio de idioma por el USUARIO (selector) → lleva la URL a la misma sección en ese idioma.
  window.addEventListener('langchange', function () {
    if (_settingLang || !routingOn()) return;
    var tab = currentTab() || 'jugar';
    var path = pathFor(tab, curLang());
    if (location.pathname !== path && !mazosSlug(location.pathname)) {
      try { history.replaceState({ tab: tab }, '', path); } catch (e) {}
    }
    window._pbApplyRouteMeta(tab);
  });

  // Idioma guardado por el usuario (o null si nunca eligió) e idioma del navegador.
  function savedLang() {
    try { var s = localStorage.getItem('pocketboard_lang_v1'); return (s && LANGS.indexOf(s) !== -1) ? s : null; } catch (e) { return null; }
  }
  function detectBrowserLang() {
    try {
      var cands = [].concat(navigator.languages || [], navigator.language || []);
      for (var i = 0; i < cands.length; i++) {
        var code = String(cands[i] || '').slice(0, 2).toLowerCase();
        if (LANGS.indexOf(code) !== -1) return code;
      }
    } catch (e) {}
    return null;
  }

  // Ruta inicial al cargar: pon el idioma de la URL, aplica meta (quita prerender) y ve a la sección.
  function initialRoute() {
    if (!routingOn()) return;
    var pr = parsePath(location.pathname);
    // Autodetección SOLO en la RAÍZ pelada inglesa (/): idioma guardado > navegador.
    // Si prefiere un idioma soportado ≠ inglés → redirige a su home (conservando ?/#
    // para no perder enlaces de mazo/tier compartidos). Googlebot (Accept-Language en)
    // se queda en inglés. Los enlaces profundos en inglés (/cards…) NO redirigen.
    var atRoot = /^\/(index\.html)?$/.test(location.pathname);   // raíz PELADA inglesa
    if (atRoot && pr.lang === 'en') {
      var target = savedLang() || detectBrowserLang();
      if (target && target !== 'en') {
        location.replace(pathFor('jugar', target) + location.search + location.hash);
        return;
      }
    }
    routerSetLang(pr.lang);
    window._pbApplyRouteMeta(pr.tab);
    go(pr.tab);
    if (pr.tab === 'mazos') {
      var slug = mazosSlug(location.pathname);
      if (slug && window._mazosOpenById && !window._mazosOpenById(slug) && window._mazosShowGrid) window._mazosShowGrid();
    }
  }
  // Hooks de test (inertes en producción): verificación de rutas/idioma.
  window._pbParsePath = parsePath;
  window._pbPathFor = pathFor;
  window._pbMazosSlug = mazosSlug;
  window._pbDetectLang = detectBrowserLang;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialRoute);
  else initialRoute();

})();
