// ═══════════════════════════════════════════════════════════════
// PVP — Tanda 2: sincronización de partida (diseño en PVP_SYNC_DESIGN.md).
// T2a: transformaciones pub↔payload + publicar/aplicar + gate de manejo.
// El módulo NO toca el DOM ni conoce efectos: reusa el par
// buildSavePayload/_restoreState del deshacer (exports _pvp* de main.js).
// El pub viaja en el POV de quien lo emite (él = p1); el receptor del otro
// rol lo ingiere INTERCAMBIANDO p1↔p2 en todo el árbol → cada cliente se
// ve siempre abajo. Identidades de manos y mazos NUNCA viajan en pub.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var S = {
    active: false,        // partida PvP en curso en este cliente
    role: null,           // 'host' | 'guest'
    code: null,
    seq: 0,               // último nº de secuencia visto (publicado o aplicado)
    applying: false,      // aplicando pub remoto → sus mutaciones no re-publican
    lastPubSig: null,
    // R1 (replay real): canal de eventos
    evSeq: 0,             // contador de MIS eventos emitidos
    evOut: [],            // rolling de mis eventos (viajan en el pub)
    evInApplied: 0,       // último evento del rival ya replayado
    evQueue: [],          // cola de replay en este cliente
    evRunning: false,
    replaying: false,     // ejecutando un evento remoto → sus mutaciones no re-emiten
    peerHasEv: false,     // el otro cliente emite eventos (versión nueva)
    latestPub: null,
    evFail: false
  };

  function oppRole() { return S.role === 'host' ? 'guest' : 'host'; }

  // ── Swap p1↔p2 recursivo (claves de mapa y valores string) ──
  function swapSides(x) {
    if (Array.isArray(x)) return x.map(swapSides);
    if (x && typeof x === 'object') {
      var out = {};
      for (var k in x) {
        var nk = k === 'p1' ? 'p2' : (k === 'p2' ? 'p1' : k);
        out[nk] = swapSides(x[k]);
      }
      return out;
    }
    if (x === 'p1') return 'p2';
    if (x === 'p2') return 'p1';
    return x;
  }

  // ── Orden LÓGICO de huecos: [activo, banca…] ──
  // GOTCHA: el orden DOM de .pokemon-slot difiere por zona (en zone-p2 el activo es el
  // ÍNDICE 3, en zone-p1 otro) → los arrays de board del save van en orden DOM y NO se
  // pueden cruzar de lado tal cual. El pub viaja SIEMPRE en orden lógico; al aplicar se
  // re-mapea al orden DOM de la zona destino.
  function slotMap(pl) {
    var slots = document.querySelectorAll('#zone-' + pl + ' .pokemon-slot');
    if (!slots.length) return null;
    var act = -1;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].classList.contains('active-slot')) { act = i; break; }
    }
    if (act < 0) return null;
    var order = [act];
    for (var j = 0; j < slots.length; j++) if (j !== act) order.push(j);
    return order;   // lógico k → DOM order[k]
  }
  function toLogical(arr, pl) {
    var m = slotMap(pl); if (!m || !arr) return arr || [];
    var out = [];
    for (var k = 0; k < m.length; k++) out[k] = arr[m[k]] || null;
    return out;
  }
  function toDom(arr, pl) {
    var m = slotMap(pl); if (!m || !arr) return arr || [];
    var out = [];
    for (var k = 0; k < m.length; k++) out[m[k]] = arr[k] || null;
    return out;
  }

  // slotRef del daño retardado (Meowscarada etc.): {owner, idx} con idx en orden DOM →
  // convertir con la misma normalización lógica que el board (el owner lo swapea swapSides).
  function mapDelayedIdx(p, fn) {
    var list = p.turnState && p.turnState.delayed;
    if (!list || !list.length) return;
    list.forEach(function (d) {
      if (d && d.slotRef && d.slotRef.owner != null && d.slotRef.idx != null) {
        d.slotRef.idx = fn(d.slotRef.owner, d.slotRef.idx);
      }
    });
  }

  // ── payload (forma save) → pub (público: fuera identidades de mano/mazo) ──
  function pubFromPayload(payload) {
    var p;
    try { p = JSON.parse(JSON.stringify(payload)); } catch (e) { return null; }
    p.pov = S.role;
    if (p.board) {   // a orden lógico (independiente del DOM del emisor)
      p.board = { p1: toLogical(p.board.p1, 'p1'), p2: toLogical(p.board.p2, 'p2') };
    }
    // daño retardado: slotRef.idx también viaja en orden LÓGICO (mismo motivo que board)
    mapDelayedIdx(p, function (owner, idx) { var m = slotMap(owner); return m ? m.indexOf(idx) : idx; });
    p.handN = { p1: ((p.hands || {}).p1 || []).length, p2: ((p.hands || {}).p2 || []).length };
    p.deckN = { p1: ((p.playQueues || {}).p1 || []).length, p2: ((p.playQueues || {}).p2 || []).length };
    p.proto = PROTO;    // versión del protocolo (detecta clientes con la página vieja)
    p.evAt = S.evSeq;   // CAUSALIDAD: este snapshot ya incluye mis eventos hasta aquí. El
                        // receptor NO puede aplicarlo antes de replayarlos o repetiría lo
                        // que el snapshot ya trae (p.ej. un cambio de Activo hecho dos veces).
    p.energyTypes = {   // tipos de la zona de energía: públicos en Pocket
      p1: (p.decks && p.decks.p1 && p.decks.p1.energyTypes) || [],
      p2: (p.decks && p.decks.p2 && p.decks.p2.energyTypes) || []
    };
    delete p.hands;       // identidades de mano: NUNCA viajan
    delete p.playQueues;  // orden/contenido del mazo: NUNCA viaja
    delete p.decks;       // lista del mazo: NUNCA viaja
    return p;
  }

  function dorsoHand(n) {
    var out = [];
    var img = 'url("' + (window.CARD_BACK_IMG || '') + '")';
    for (var i = 0; i < n; i++) out.push({ img: img, cardType: '', cardName: '', hpMax: '' });
    return out;
  }
  function dummyQueue(n) {
    // Espejo de la cola del rival: DORSOS reales (si su espejo "roba" al pasarle el turno,
    // lo que vuela a su mano es un dorso, no una carta-comodín rota).
    var back = window.CARD_BACK_IMG || '';
    var out = [];
    for (var i = 0; i < n; i++) out.push({ image: back, name: '' });
    return out;
  }

  // ── Localización de imágenes entrantes: el emisor guarda URLs en SU idioma; al
  // aplicar se re-localizan al idioma de ESTE cliente (localizeImg round-tripea por id).
  function locRaw(u) {
    if (!u || u.indexOf('energy:') === 0 || u.indexOf('data:') === 0 || u === 'dorso') return u;
    try { return (window.localizeImg && window.localizeImg(u)) || u; } catch (e) { return u; }
  }
  function locCss(v) {
    var m = /^url\(["']?(.*?)["']?\)$/.exec(v || '');
    if (!m) return v;
    return 'url("' + locRaw(m[1]) + '")';
  }
  function localizeBoardArr(arr) {
    (arr || []).forEach(function (d) {
      if (!d) return;
      if (d.img) d.img = locCss(d.img);
      (d.evoStack || []).forEach(function (ev) { if (ev && ev.image) ev.image = locRaw(ev.image); });
      var tools = d.tool ? (Array.isArray(d.tool) ? d.tool : [d.tool]) : [];
      tools.forEach(function (t) { if (t && t.img) t.img = locCss(t.img); });
    });
  }
  function localizePass(p) {
    if (p.board) { localizeBoardArr(p.board.p1); localizeBoardArr(p.board.p2); }
    if (p.stadiums) ['p1', 'p2'].forEach(function (pl) { var s = p.stadiums[pl]; if (s && s.img) s.img = locCss(s.img); });
    if (p.discard) ['p1', 'p2'].forEach(function (pl) { p.discard[pl] = (p.discard[pl] || []).map(locRaw); });
  }

  // ── Frontera de confianza de cartas entrantes ─────────────────────────────
  // El peer puede describir el estado y las animaciones, pero una CARA de carta solo entra
  // si su imagen resuelve en la DB instalada en este cliente. La búsqueda se hace SOLO por
  // imagen: pasar también el nombre reactivaría el fallback permisivo de dbLookup.
  var CARD_IMAGE_EVENTS = { place: 1, evolve: 1, stadium: 1, tool: 1, trainer: 1 };
  var VALID_DISCARD_ENERGIES = { fire: 1, water: 1, grass: 1, lightning: 1,
    psychic: 1, fighting: 1, darkness: 1, metal: 1, colorless: 1 };
  function incomingRawImage(v) {
    if (typeof v !== 'string') return '';
    var s = v.trim();
    var m = /^url\(["']?(.*?)["']?\)$/.exec(s);
    return (m ? m[1] : s).trim();
  }
  function incomingCardDb(v) {
    var raw = incomingRawImage(v);
    if (!raw || /^data:/i.test(raw) || !window.dbLookup) return null;
    var db = window.dbLookup({ image: raw }) || null;   // deliberadamente SIN name
    var fmt = window._pvpFormat || S.mode || 'standard';
    if (db && db.custom && (!window.isCustomAllowedIn || !window.isCustomAllowedIn(db, fmt))) return null;
    return db;
  }
  function canonCardCss(db) { return 'url("' + String((db && db.image) || '').replace(/"/g, '%22') + '")'; }
  // PS canónico de una carta que va a estar EN UN HUECO. OJO: las 14 cartas de FÓSIL no tienen
  // `health` en la DB — como carta son un Objeto, y sus 40 PS son la vista EN JUEGO que define
  // main.js (_fossilInPlayDb). Sin este caso llegaban al espejo con hpMax='' → el receptor no les
  // ponía PS → _resolvePendingKOs las leía como «0 PS» y las descartaba al final del turno
  // regalando el punto (bug reportado por Daniel el 2026-08-26 con un mazo de fósiles).
  function canonHp(db) {
    var h = db && db.health;
    if (!h && db && window._isFossilDb && window._isFossilDb(db) && window._fossilInPlayDb) {
      var v = window._fossilInPlayDb(db);
      h = v && v.health;
    }
    return h ? String(h) : '';
  }
  function canonCardMeta(dst, db, eventShape) {
    if (eventShape) {
      dst.nm = db.name || '';
      dst.ct = db.cardType || '';
      dst.hp = canonHp(db);
    } else {
      dst.cardName = db.name || '';
      dst.cardType = db.cardType || '';
      dst.hpMax = canonHp(db);
    }
  }
  function canonBoardCard(d) {
    if (!d || typeof d !== 'object') return false;
    var db = incomingCardDb(d.img);
    if (!db) return false;
    d.img = canonCardCss(db);
    canonCardMeta(d, db, false);
    if (d.evoStack != null && !Array.isArray(d.evoStack)) return false;
    for (var i = 0; i < (d.evoStack || []).length; i++) {
      var ev = d.evoStack[i];
      if (!ev || typeof ev !== 'object') return false;
      var edb = incomingCardDb(ev.image);
      if (!edb) return false;
      ev.image = edb.image;
      ev.name = edb.name || '';
      ev.cardType = edb.cardType || '';
      ev.health = parseInt(canonHp(edb), 10) || 0;   // preevo fósil: su PS es el de la vista en juego
    }
    var tools = d.tool == null ? [] : (Array.isArray(d.tool) ? d.tool : [d.tool]);
    for (var j = 0; j < tools.length; j++) {
      var tool = tools[j];
      if (!tool || typeof tool !== 'object') return false;
      var tdb = incomingCardDb(tool.img);
      if (!tdb) return false;
      tool.img = canonCardCss(tdb);
      tool.name = tdb.name || '';
      tool.cardType = tdb.cardType || '';
    }
    return true;
  }
  function canonBoardList(list) {
    if (list == null) return true;
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) if (list[i] && !canonBoardCard(list[i])) return false;
    return true;
  }
  function canonDiscard(list) {
    if (list == null) return true;
    if (!Array.isArray(list)) return false;
    for (var i = 0; i < list.length; i++) {
      var raw = incomingRawImage(list[i]);
      if (raw.indexOf('energy:') === 0) {
        var et = raw.slice(7);
        if (!VALID_DISCARD_ENERGIES[et]) return false;
        list[i] = 'energy:' + et;
        continue;
      }
      var db = incomingCardDb(raw);
      if (!db) return false;
      list[i] = db.image;
    }
    return true;
  }
  function canonicalIncomingPub(pub) {
    var p;
    try { p = JSON.parse(JSON.stringify(pub)); } catch (e) { return null; }
    if (!p || typeof p !== 'object') return null;
    var valid = true;
    ['p1', 'p2'].forEach(function (pl) {
      if (valid && p.board && !canonBoardList(p.board[pl])) valid = false;
      if (valid && p.discard && !canonDiscard(p.discard[pl])) valid = false;
      var st = p.stadiums && p.stadiums[pl];
      if (valid && st) {
        var db = incomingCardDb(st.img);
        if (!db) valid = false;
        else { st.img = canonCardCss(db); canonCardMeta(st, db, false); }
      }
    });
    return valid ? p : null;
  }
  function canonicalIncomingSide(side) {
    var s;
    try { s = JSON.parse(JSON.stringify(side)); } catch (e) { return null; }
    if (!s || typeof s !== 'object') return null;
    return canonBoardList(s.board) && canonDiscard(s.discard) ? s : null;
  }
  function canonicalIncomingEvent(e) {
    if (!e || typeof e !== 'object') return e;
    var hasImage = Object.prototype.hasOwnProperty.call(e, 'img');
    if (!CARD_IMAGE_EVENTS[e.t] && !hasImage) return e;
    var db = incomingCardDb(e.img);
    if (!db) return null;
    var out = {};
    for (var k in e) out[k] = e[k];
    out.img = db.image;
    if (CARD_IMAGE_EVENTS[e.t]) canonCardMeta(out, db, true);
    return out;
  }
  function canonicalIncomingCardList(list, imageOnly) {
    if (!Array.isArray(list)) return null;
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!imageOnly && (!item || typeof item !== 'object')) return null;
      var db = incomingCardDb(imageOnly ? item : item.image);
      if (!db) return null;
      var safe = imageOnly ? {} : Object.assign({}, item);
      safe.image = db.image;
      safe.ct = db.cardType || '';
      safe.cardType = db.cardType || '';
      safe.name = db.name || '';
      safe.hpMax = canonHp(db);
      out.push(safe);
    }
    return out;
  }
  function rejectIncomingCards(kind) {
    S.cardIngressRejects = (S.cardIngressRejects || 0) + 1;
    if (S.cardIngressWarned) return;
    S.cardIngressWarned = true;
    if (window._boardNotice) window._boardNotice(T2('pvp.reloadNeeded'));
    console.warn('[pvp-sync] datos de carta entrantes bloqueados (' + kind + ')');
  }

  // ── pub → payload aplicable EN ESTE cliente (re-inyecta MI privado local) ──
  // Mi mano y mi mazo: la verdad vive en local (el rival ni las conoce; los efectos
  // que las tocan se delegan a este cliente — Tanda 3).
  // `fromResume` = reconexión: el tablero local está VACÍO, así que mi zona/próxima energía
  // hay que tomarlas del pub (el espejo del rival es la única fuente que queda).
  function payloadFromPub(pub, fromResume) {
    var p = (pub.pov === S.role) ? pub : swapSides(pub);
    try { p = JSON.parse(JSON.stringify(p)); } catch (e) {}
    if (p.board) {   // de orden lógico al orden DOM de MIS zonas
      p.board = { p1: toDom(p.board.p1, 'p1'), p2: toDom(p.board.p2, 'p2') };
    }
    mapDelayedIdx(p, function (owner, idx) { var m = slotMap(owner); return (m && m[idx] != null) ? m[idx] : idx; });
    var local = window._pvpBuildPayload ? window._pvpBuildPayload() : null;
    p.hands = {
      p1: (local && local.hands && local.hands.p1) || [],
      p2: dorsoHand((p.handN && p.handN.p2) || 0)
    };
    p.playQueues = {
      p1: (local && local.playQueues && local.playQueues.p1) || [],
      p2: dummyQueue((p.deckN && p.deckN.p2) || 0)
    };
    p.decks = {
      p1: (local && local.decks && local.decks.p1) || { cards: [], energyTypes: [] },
      p2: { cards: [], energyTypes: (p.energyTypes && p.energyTypes.p2) || [] }
    };
    // Mientras respondo un descarte delegado, el pub `pending` que originó la petición
    // todavía trae la pila ANTERIOR. Mano/cola p1 ya se preservan arriba por ser privadas;
    // la carta que acabo de hacer pública también debe sobrevivir hasta que llegue el pub
    // final del atacante. Sin este candado, el coalesce de snapshots la borraba ~1 s después.
    if (S.hiddenDiscardOwned && local) {
      p.discard = p.discard || {};
      p.discard.p1 = (local.discard && local.discard.p1) || [];
      p.discardFromDeck = p.discardFromDeck || {};
      p.discardFromDeck.p1 = (local.discardFromDeck && local.discardFromDeck.p1) || [];
    }
    delete p.handN; delete p.deckN; delete p.energyTypes; delete p.pov;
    // ENERGÍA local-autoritativa: MI zona/próxima-energía la genera MI cliente (como el
    // robo). El espejo del rival puede traer null/otra cosa → mi lado no se pisa.
    // OJO: se preserva TAMBIÉN el null (zona vacía porque ya coloqué la energía). Antes era un
    // truthy-check y una zona vacía caía al valor del pub — el espejo del rival, que podía ir
    // rezagado → me RESUCITABA el orbe ya gastado (y de paso bloqueaba el spawn del turno
    // siguiente, que solo genera si la zona está vacía).
    p.energyZone = p.energyZone || {};
    if (!fromResume && local && local.energyZone) p.energyZone.p1 = local.energyZone.p1 || null;
    if (!fromResume && local && local.turnState && local.turnState.nextEnergy) {
      p.turnState = p.turnState || {};
      p.turnState.nextEnergy = p.turnState.nextEnergy || {};
      p.turnState.nextEnergy.p1 = local.turnState.nextEnergy.p1 || null;   // Buggy Beam la escribe aquí vía el evento `nextE`
    }
    // ── RED: un pub del rival NO puede dejarme SIN NADA en juego ──
    // Su pub es autoritativo sobre TODO el tablero (mueve mis cartas al noquearlas, al
    // cambiarme el Activo…), así que un agujero en SU espejo de mi lado me borra cartas
    // REALES. Quedarme sin ninguna carta en juego solo es legítimo si he PERDIDO (sin Activo
    // ni banca = derrota) — y entonces el pub trae gameOver. Si no lo trae, el pub miente:
    // conservo mi tablero y aguanto su turno; en cuanto me toque, MI pub (que sí es
    // autoritativo) repara su espejo solo. OJO al auto-guard: si el KO fue de verdad, el
    // evento ya me lo descartó en local y aquí mi lado también está a 0 → no se preserva nada.
    if (!fromResume && local && local.board && p.board) {
      var _mias = (local.board.p1 || []).filter(Boolean).length;
      var _suyas = (p.board.p1 || []).filter(Boolean).length;
      if (_mias > 0 && _suyas === 0 && !(p.game && p.game.gameOver)) {
        p.board.p1 = local.board.p1;
        S.boardRescues = (S.boardRescues || 0) + 1;
        console.warn('[pvp-sync] el pub del rival traía mi lado VACÍO con ' + _mias + ' carta(s) en juego: conservado');
      }
    }
    localizePass(p);
    return p;
  }

  // ═══ 6a-3: CUES de las jugadas del rival ═══
  // El re-montaje síncrono no parpadea en lo que no cambia (mismos píxeles); lo que faltaba
  // era TRANSICIÓN en los cambios. Diff pub-anterior vs pub-nuevo (mi POV, orden lógico) →
  // cues con las animaciones REALES del tablero tras aplicar: entrada de carta
  // (.entering/.receiving), número de daño flotante (dmg-float-el), pop de orbes, sonidos.
  function canonPov(pub) {
    var p = (pub.pov === S.role) ? pub : swapSides(pub);
    try { return JSON.parse(JSON.stringify(p)); } catch (e) { return null; }
  }
  // IDENTIDAD de carta para el diff: cada cliente guarda la URL EN SU IDIOMA/origen →
  // comparar URLs crudas entre clientes marcaba TODAS las cartas como «cambiadas»
  // (sonido de evolve en cada pase de turno + >7 cambios = cues descartados en bloque).
  function imgKey(cssUrl) {
    var m = /url\(["']?(.*?)["']?\)/.exec(cssUrl || '');
    var u = m ? m[1] : (cssUrl || '');
    if (!u) return '';
    if (u.indexOf('data:') === 0) return 'dorso';
    try {
      var id = window.cardIdFromImage && window.cardIdFromImage(u);
      if (id) return String(id).toLowerCase();
    } catch (e) {}
    return u.replace(/^https?:\/\/[^/]+/, '');   // sin origen (mismo path, host distinto)
  }
  function slotCardEl(pl, logicalIdx) {
    var m = slotMap(pl); if (!m || m[logicalIdx] == null) return null;
    var slots = document.querySelectorAll('#zone-' + pl + ' .pokemon-slot');
    var s = slots[m[logicalIdx]];
    return s ? { slot: s, card: s.querySelector('.card') } : null;
  }
  // Carta que APARECE en un hueco: DESLIZADO desde la mano de su dueño hasta el hueco.
  // La única animación "nueva" autorizada por Daniel: simple, smooth y snappy — nada más.
  function slideCardFromHand(el, pl, sound) {
    var reduce = window.pbFx && window.pbFx('reduceMotion');
    if (!reduce) try {
      var handEl = document.getElementById('hand-' + pl);
      var hr = handEl ? handEl.getBoundingClientRect() : null;
      var cr = el.getBoundingClientRect();
      var dx = hr ? (hr.left + hr.width / 2) - (cr.left + cr.width / 2) : 0;
      var dy = hr ? (hr.top + hr.height / 2) - (cr.top + cr.height / 2) : (pl === 'p2' ? -120 : 120);
      el.animate([
        { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(0.82)', opacity: 0.6 },
        { transform: 'translate(0,0) scale(1)', opacity: 1 }
      ], { duration: 340, easing: 'cubic-bezier(0.25, 1, 0.4, 1)' });
    } catch (e) {}
    if (sound && window.playSound) window.playSound(sound);
  }
  function cueEnter(pl, idx, sound) {
    var r = slotCardEl(pl, idx);
    if (!r || !r.card) return;
    slideCardFromHand(r.card, pl, sound);
  }
  function cueOrbs(pl, idx, n) {
    var r = slotCardEl(pl, idx);
    if (!r || !r.card) return;
    var orbs = r.card.querySelectorAll('.energy-container .energy');
    for (var i = Math.max(0, orbs.length - n); i < orbs.length; i++) {
      try { orbs[i].animate(
        [{ transform: 'scale(0.2)', opacity: 0.4 }, { transform: 'scale(1.25)', opacity: 1 }, { transform: 'scale(1)' }],
        { duration: 380, easing: 'cubic-bezier(0.34,1.3,0.64,1)' }); } catch (e) {}
    }
    if (window.playSound) window.playSound('energyPlaced');
  }
  function playDiffCues(prev, next) {
    if (!prev || !next) return;
    var reduce = window.pbFx && window.pbFx('reduceMotion');
    // Con un peer que EMITE EVENTOS (replay real), las entradas/orbes/robos/estadios los
    // anima el replay con el código real → aquí solo quedan los cambios aún no eventados
    // (daño/KO/descartes hasta R2). Duplicarlos sería animar dos veces.
    var evPeer = S.peerHasEv;
    var cues = [];
    ['p1', 'p2'].forEach(function (pl) {
      var pb = (prev.board && prev.board[pl]) || [], nb = (next.board && next.board[pl]) || [];
      var len = Math.max(pb.length, nb.length);
      for (var i = 0; i < len; i++) {
        var a = pb[i], b = nb[i];
        if (!a && b) { if (!evPeer) cues.push({ t: 'enter', pl: pl, i: i }); }
        else if (a && !b) cues.push({ t: 'gone' });
        else if (a && b) {
          var idChanged = imgKey(a.img) !== imgKey(b.img);
          if (idChanged && !evPeer) cues.push({ t: 'enter', pl: pl, i: i, evo: true });
          // el delta de PS solo vale entre la MISMA carta — al evolucionar el máximo
          // cambia (Eevee 60 → Flareon 160) y salía un «+100» de cura fantasma
          if (!idChanged) {
            var d = (parseInt(b.hpCur, 10) || 0) - (parseInt(a.hpCur, 10) || 0);
            if (d) cues.push({ t: 'hp', pl: pl, i: i, d: d });
          }
          var eb = (b.energies || []).length - (a.energies || []).length;
          if (eb > 0 && !evPeer) cues.push({ t: 'orbs', pl: pl, i: i, n: eb });
        }
      }
    });
    // estadios: mismo deslizado que cualquier carta colocada
    ['p1', 'p2'].forEach(function (pl) {
      var sa = prev.stadiums && prev.stadiums[pl], sb = next.stadiums && next.stadiums[pl];
      if (!sa && sb && !evPeer) cues.push({ t: 'stadium', pl: pl });
    });
    if (((next.handN || {}).p2 || 0) > ((prev.handN || {}).p2 || 0) && !evPeer) cues.push({ t: 'draw' });
    // Descartes NUEVOS del rival: si además su mano bajó y no hubo KO en su tablero,
    // es una carta JUGADA de su mano (Entrenador) → enseñarla en grande (como Pocket).
    var koSeen = cues.some(function (c) { return c.t === 'gone'; });
    var handDown = ((next.handN || {}).p2 || 0) < ((prev.handN || {}).p2 || 0);
    var dPrevArr = ((prev.discard || {}).p2) || [];
    var dNextArr = ((next.discard || {}).p2) || [];
    var newDiscards = dNextArr.slice(dPrevArr.length).filter(function (u) { return u && u.indexOf('energy:') !== 0; });
    if (newDiscards.length && handDown && !koSeen && !evPeer) {
      newDiscards.slice(0, 2).forEach(function (img) { cues.push({ t: 'played', img: img }); });
    } else {
      var dNext = dNextArr.length + ((((next.discard || {}).p1) || []).length);
      var dPrev = dPrevArr.length + ((((prev.discard || {}).p1) || []).length);
      if (dNext > dPrev) cues.push({ t: 'discard' });
    }
    if (!cues.length || cues.length > 7) return;   // nada, o demasiado (reconexión) → sin cues
    cues.forEach(function (c, k) {
      setTimeout(function () {
        if (c.t === 'enter') { if (!reduce) cueEnter(c.pl, c.i, c.evo ? 'evolve' : 'cardGrab'); }
        else if (c.t === 'hp') {
          var r = slotCardEl(c.pl, c.i);
          if (r && r.card && window._pvpDamageCue && !reduce) window._pvpDamageCue(r.card, c.d);
        }
        else if (c.t === 'orbs') { if (window.playSound) window.playSound('energyPlaced'); }   // vuelo real del orbe = próximo paso; de momento SOLO el sonido real
        else if (c.t === 'draw') {
          var hand = document.querySelectorAll('#hand-p2 .card');
          var last = hand[hand.length - 1];
          if (last && !reduce) try { last.animate(
            [{ transform: 'translateY(-18px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }],
            { duration: 320, easing: 'ease-out' }); } catch (e) {}
        }
        else if (c.t === 'stadium') {
          var stSlot = document.querySelector('.slot[data-label="Estadio ' + (c.pl === 'p1' ? 'P1' : 'P2') + '"] .card');
          if (stSlot && !reduce) {
            try {
              var hEl = document.getElementById('hand-' + c.pl);
              var hR = hEl ? hEl.getBoundingClientRect() : null;
              var sR = stSlot.getBoundingClientRect();
              var sdx = hR ? (hR.left + hR.width / 2) - (sR.left + sR.width / 2) : 0;
              var sdy = hR ? (hR.top + hR.height / 2) - (sR.top + sR.height / 2) : (c.pl === 'p2' ? -120 : 120);
              stSlot.animate([
                { transform: 'translate(' + sdx + 'px,' + sdy + 'px) scale(0.82)', opacity: 0.6 },
                { transform: 'translate(0,0) scale(1)', opacity: 1 }
              ], { duration: 340, easing: 'cubic-bezier(0.25, 1, 0.4, 1)' });
            } catch (e) {}
          }
          if (window.playSound) window.playSound('cardGrab');
        }
        else if (c.t === 'played') {
          // solo peers LEGACY (sin eventos): con replay real el partidario lo anima playTrainer
          if (window.playSound) window.playSound('trainerReveal');
        }
        else if (window.playSound) window.playSound('goBack');   // gone/discard
      }, 110 * k);
    });
  }

  // ═══ R1 — PIVOTE A REPLAY REAL (PVP_SYNC_DESIGN.md §pivote) ═══
  // El actor graba cada acción pública como un EVENTO pequeño (viaja en el pub, rolling 40).
  // El receptor los EJECUTA en secuencia con las MISMAS funciones del tablero
  // (drawOneCard / _attachEnergyFromZone / _doEvolution / createCard / _makeToolWidget)
  // sobre su espejo (dorsos donde hay info oculta) → animación idéntica POR CONSTRUCCIÓN.
  // Después VERIFICA su estado contra el pub: coincide → SIN re-montaje; no coincide
  // (acción aún no eventada: ataques/trainers hasta R2) → snapshot de siempre.
  var REPLAY_TYPES = { draw: 1, energy: 1, place: 1, evolve: 1, stadium: 1, tool: 1, coins: 1,
                       trainer: 1, dmg: 1, ko: 1, handToDeck: 1, discardE: 1, swap: 1, cond: 1,
                       promote: 1, heal: 1, moveE: 1, zone: 1, nextE: 1 };
  // Tipos que el actor puede resolver sobre CUALQUIER lado (consecuencias públicas y
  // DELEGACIONES: draw/handToDeck sobre mi lado = Mars/Red Card resueltos con MIS cartas
  // reales); el resto solo sobre su propio lado (p1 en su POV).
  // `nextE` va aquí porque el actor toca justamente el lado del RIVAL (Buggy Beam le cambia
  // el tipo de SU próxima energía, que es estado local-autoritativo del otro cliente).
  var EV_BOTH_SIDES = { coins: 1, dmg: 1, ko: 1, discardE: 1, swap: 1, cond: 1, draw: 1,
                        handToDeck: 1, heal: 1, moveE: 1, nextE: 1 };

  function bgUrl(el) {
    var m = /url\(["']?(.*?)["']?\)/.exec((el && el.style && el.style.backgroundImage) || '');
    return m ? m[1] : '';
  }
  function evPush(t, d, anyTurn) {
    if (!S.active || S.applying || S.replaying || S.over) return false;
    if (!S.placementReleased) return false;   // la colocación va por el canal de lados (bocabajo + volteo)
    // SOLO EMITE EL ACTOR (el jugador en turno): las cascadas que un replay dispara en el
    // otro cliente (KO → Huevo Suerte roba, represalias…) corren en local SIN re-emitir —
    // ambos clientes ejecutan su mitad y los conteos convergen. Sin esta regla, cada
    // consecuencia asíncrona de un replay rebotaría como evento nuevo (dobles).
    // `anyTurn` = eventos de estado ABSOLUTO sobre MI propio lado (la zona de energía, que
    // se vacía justo cuando el turno ya ha cambiado): no son cascadas, no pueden rebotar
    // (S.replaying/S.applying ya cortan eso) y sin ellos el rival no ve mi orbe estallar.
    if (!anyTurn && window.activeTurn !== 'p1') return false;
    // RITMO REAL: cada evento lleva `dt` = ms transcurridos desde el anterior EN EL ACTOR.
    // El receptor los reproduce con ese mismo espaciado → el rival ve exactamente la misma
    // cadencia (robos cada 220ms, golpes simultáneos a 0, el efecto de un partidario justo
    // cuando termina su vuelo). Sustituye a las duraciones fijas por tipo, que goteaban.
    var now = Date.now();
    var dt = S.lastEvAt ? Math.min(3000, Math.max(0, now - S.lastEvAt)) : 0;
    S.lastEvAt = now;
    var e = { q: ++S.evSeq, t: t, dt: dt };
    if (d) for (var k in d) if (d[k] !== undefined) e[k] = d[k];
    S.evOut.push(e);
    if (S.evOut.length > 60) S.evOut = S.evOut.slice(-60);
    flushEvents();   // STREAMING: sale YA (no se espera al final de la acción)
    return true;
  }
  // ── Canal de eventos en STREAMING (independiente del snapshot) ──
  // Antes los eventos viajaban DENTRO del pub, que solo se publica cuando la acción entera
  // se asienta: el rival no veía nada hasta que el partidario había volado Y robado.
  // Ahora se escriben en su propio campo del documento en cuanto ocurren (borde de subida
  // inmediato + agrupado cada FLUSH_MS para no disparar el nº de escrituras).
  var PROTO = 6;   // + causa canónica para descarte oculto (6); delegado (5); +zone/nextE (4); replay (3)
  var FLUSH_MS = 150;
  function flushEvents() {
    if (!S.active || S.over || !S.code || !window.pbPvp) return;
    var since = Date.now() - (S.lastFlushAt || 0);
    if (S.flushTimer) return;
    if (since >= FLUSH_MS) { doFlush(); return; }
    S.flushTimer = setTimeout(function () { S.flushTimer = null; doFlush(); }, FLUSH_MS - since);
  }
  function doFlush() {
    if (!S.active || S.over || !S.code || !window.pbPvp || !S.evOut.length) return;
    S.lastFlushAt = Date.now();
    paintDbg();
    window.pbPvp.update(S.code, { ev: S.evOut.slice(-40), evBy: S.role, evHigh: S.evSeq, proto: PROTO, evTs: Date.now() })
      .catch(function (err) { console.warn('[pvp-sync] ev', (err && err.code) || err); });
  }
  function evSlotRef(cardEl) {
    var slot = cardEl && cardEl.closest && cardEl.closest('.pokemon-slot');
    if (!slot) return null;
    var pl = slot.closest('#zone-p2') ? 'p2' : 'p1';
    var slots = Array.prototype.slice.call(document.querySelectorAll('#zone-' + pl + ' .pokemon-slot'));
    var m = slotMap(pl);
    var idx = m ? m.indexOf(slots.indexOf(slot)) : -1;
    return idx >= 0 ? { pl: pl, idx: idx } : null;
  }
  // — Emisores (los llaman las primitivas de main.js) —
  // Solo se emite lo que este cliente hace sobre SU PROPIO lado (p1 local): lo que el
  // actor haga sobre su ESPEJO del rival (Mars, Splatter…) no se emite — su verdad la
  // resuelve el otro cliente (R3) y mientras tanto lo reconcilia el snapshot.
  window._pvpEvDraw = function (player) { evPush('draw', { pl: player === 'p2' ? 'p2' : 'p1' }); };
  /* Estado ABSOLUTO de MI zona de energía (orbe actual + próxima). La zona es local-autoritativa:
     el espejo del rival no puede adivinarla, y sin esto se quedaba con un orbe inventado que nadie
     consumía. Idempotente y con dedupe: los llamadores pueden invocarlo de más. */
  window._pvpEvZone = function (type, next) {
    var sig = (type || '-') + '|' + (next || '-');
    if (sig === S.lastZoneSig) return;
    // el dedupe solo se sella si el evento SALE de verdad (si no, un push descartado por
    // los guards dejaría el estado envenenado y el siguiente igual no se emitiría nunca)
    if (evPush('zone', { pl: 'p1', type: type || null, next: next || null }, true)) S.lastZoneSig = sig;
  };
  // Buggy Beam: el actor cambia la PRÓXIMA energía de un lado (normalmente el del rival).
  window._pvpEvNextEnergy = function (side, type) {
    if (side === 'p1') S.lastZoneSig = null;   // mi propia próxima cambió → el siguiente zone-sync no se deduplica
    evPush('nextE', { pl: side === 'p2' ? 'p2' : 'p1', type: type || null });
  };
  window._pvpEvEnergy = function (card, type) {
    var r = evSlotRef(card);
    if (r && r.pl === 'p1') evPush('energy', { pl: 'p1', idx: r.idx, type: type });
  };
  window._pvpEvPlace = function (card, slot) {
    var r = evSlotRef(card);
    if (!r || r.pl !== 'p1') return;
    evPush('place', { pl: 'p1', idx: r.idx, img: bgUrl(card), hp: card.dataset.hpMax || '',
                      ct: card.dataset.cardType || '', nm: card.dataset.cardName || '' });
  };
  window._pvpEvEvolve = function (evoCard, slot, src) {
    var r = evSlotRef(evoCard);
    if (!r || r.pl !== 'p1') return;
    // `anyTurn`: una evolución por HABILIDAD de fin del turno del rival (Caterpie «Quick
    // Growth», también al promover tras un KO) ocurre cuando el turno NO es mío, y evPush
    // descarta por defecto lo que se emite fuera de turno. Sin esto la evolución se veía en
    // mi pantalla —animación y sonido incluidos— y el siguiente pub del rival, que es el
    // autoritativo y no se había enterado, me la deshacía.
    evPush('evolve', { pl: 'p1', idx: r.idx, img: bgUrl(evoCard), hp: evoCard.dataset.hpMax || '',
                       nm: evoCard.dataset.cardName || '', src: src || 'hand' },
           !!window._pbEvoAnyTurn);
  };
  window._pvpEvStadium = function (card, owner) {
    if (owner && owner !== 'p1') return;
    evPush('stadium', { pl: 'p1', img: bgUrl(card), nm: card.dataset.cardName || '' });
  };
  window._pvpEvTool = function (targetCard, tw) {
    var r = evSlotRef(targetCard);
    if (r && r.pl === 'p1') evPush('tool', { pl: 'p1', idx: r.idx, img: bgUrl(tw), nm: tw.dataset.cardName || '' });
  };
  window._pvpEvCoins = function (heads, tails, untilTails) {
    evPush('coins', { h: heads || 0, tl: tails || 0, u: !!untilTails });
  };
  // — R2: consecuencias (el actor resuelve; el otro cliente EJECUTA lo mismo) —
  window._pvpEvTrainer = function (card, player) {
    if (player !== 'p1') return;
    evPush('trainer', { pl: 'p1', img: bgUrl(card), nm: (card.dataset && card.dataset.cardName) || '' });
  };
  window._pvpEvDmg = function (card, amount, src) {
    var rr = evSlotRef(card);
    if (rr) evPush('dmg', { pl: rr.pl, idx: rr.idx, n: amount, src: src || 'attack' });
  };
  window._pvpEvKo = function (card) {
    var rr = evSlotRef(card);
    // `deny` = la moneda de «tu rival no gana puntos por este KO», ya resuelta por el
    // atacante; si cada cliente la tirase por su cuenta, el marcador se desincronizaría.
    if (rr) evPush('ko', { pl: rr.pl, idx: rr.idx, src: card._koSource || 'attack',
                           deny: card._koDeny == null ? null : !!card._koDeny });
  };
  window._pvpEvHeal = function (card, healed) {
    var rr = evSlotRef(card);
    if (rr && healed > 0) evPush('heal', { pl: rr.pl, idx: rr.idx, n: healed });
  };
  window._pvpEvMoveEnergy = function (src, dest, orbs) {
    var a = evSlotRef(src), b = evSlotRef(dest);
    // Antes se descartaba el traslado entre lados «porque no ocurre en el juego». Con el set
    // B4a sí ocurre: Team Rocket's Raticate ex ROBA una energía del activo rival. Sin esto, en
    // la pantalla del rival la energía se teletransportaba sin animación.
    if (!a || !b) return;
    var t = (orbs && orbs[0] && orbs[0].dataset && orbs[0].dataset.energyType) || null;
    var same = (orbs || []).every(function (o) { return ((o.dataset && o.dataset.energyType) || null) === t; });
    evPush('moveE', { pl: a.pl, from: a.idx, to: b.idx, n: (orbs || []).length, etype: same ? t : null });
  };
  window._pvpEvHandToDeck = function (player) {
    evPush('handToDeck', { pl: player === 'p2' ? 'p2' : 'p1' });
  };
  // Descartes de energía: funnel único en _discardOrbs (cubre efectos Y retirada);
  // agrupa por carta y manda los TIPOS exactos (el azar ya se resolvió en el actor).
  window._pvpEvDiscardOrbs = function (orbs) {
    if (!S.active) return;
    var byCard = new Map();
    (orbs || []).forEach(function (o) {
      var c = o.closest && o.closest('.card');
      if (!c) return;
      if (!byCard.has(c)) byCard.set(c, []);
      byCard.get(c).push((o.dataset && o.dataset.energyType) || '');
    });
    byCard.forEach(function (types, c) {
      var rr = evSlotRef(c);
      if (rr) evPush('discardE', { pl: rr.pl, idx: rr.idx, types: types });
    });
  };
  function slotLogicalRef(slot) {
    if (!slot) return null;
    var pl = slot.closest && slot.closest('#zone-p2') ? 'p2' : 'p1';
    var slots = Array.prototype.slice.call(document.querySelectorAll('#zone-' + pl + ' .pokemon-slot'));
    var m = slotMap(pl);
    var idx = m ? m.indexOf(slots.indexOf(slot)) : -1;
    return idx >= 0 ? { pl: pl, idx: idx } : null;
  }
  // Promoción del ACTOR sobre su propio lado (Activo caído por recoil/veneno): el evento
  // resuelve el selector que el replay del 'ko' arma en el espejo del otro cliente.
  window._pvpEvPromote = function (player, benchSlot, e) {
    if (player !== 'p1' || (e && e._pvpInject)) return;
    var b = slotLogicalRef(benchSlot);
    if (b && b.pl === 'p1' && b.idx >= 1) evPush('promote', { pl: 'p1', idx: b.idx });
  };
  window._pvpEvSwap = function (slotA, slotB) {
    var a = slotLogicalRef(slotA), b = slotLogicalRef(slotB);
    if (a && b && a.pl === b.pl) evPush('swap', { pl: a.pl, a: a.idx, b: b.idx });
  };
  // Estados sincronizados: emite el _cond COMPLETO de la carta cuando CAMBIA su conjunto
  // de estados activos (dedupe por firma en el elemento; el primer render de una carta
  // sin estados NO emite — si no, cada carta nueva soltaba un 'cond' vacío de ruido).
  window._pvpEvCond = function (card) {
    if (!S.active || !card) return;
    var rr = evSlotRef(card);
    if (!rr) return;
    var cd = card._cond || {};
    var act = Object.keys(cd).filter(function (k) { return cd[k] === true; }).sort().join('|');
    if (!act && card._pvpCondSig == null) { card._pvpCondSig = ''; return; }
    if (card._pvpCondSig === act) return;
    card._pvpCondSig = act;
    var payload;
    try { payload = JSON.parse(JSON.stringify(cd)); } catch (e) { return; }
    evPush('cond', { pl: rr.pl, idx: rr.idx, cond: payload });
  };
  // Ejecutar fn sin emitir eventos (robos que el otro cliente YA anima en su espejo:
  // el primer robo tras la colocación y el robo de inicio de turno).
  window._pvpSilenceEv = function (fn) {
    S.replaying = true;
    try { fn(); } finally { S.replaying = false; }
  };

  // — Receptor: eventos nuevos → replay; gap/no-replayable → snapshot —
  function canReplayEv(e) {
    if (!e || !REPLAY_TYPES[e.t]) return false;   // tipo desconocido (peer con página vieja) → cae al snapshot
    if (EV_BOTH_SIDES[e.t]) return true;   // consecuencias públicas: valen sobre cualquier lado
    return e.pl === 'p1';   // su lado (POV emisor) = mi espejo p2
  }
  function handleIncomingPub(pub, alreadyCanonical) {
    var safe = alreadyCanonical ? pub : canonicalIncomingPub(pub);
    if (!safe) { rejectIncomingCards('pub'); return false; }
    S.latestPub = safe;
    checkProto(safe.proto);
    scheduleApply(safe);   // el snapshot es la RED DE SEGURIDAD; las animaciones van por eventos
    return true;
  }
  // Canal de eventos del rival (campo propio del documento, llega ANTES que su snapshot).
  // Aviso ÚNICO si el rival corre otra versión: sin esto el sync degrada en silencio
  // (remontajes mudos y sonidos fuera de lugar) y parece un bug de animaciones.
  function checkProto(theirs) {
    if (S.protoWarned || theirs === PROTO) return;
    S.protoWarned = true;
    window._boardNotice && window._boardNotice(T2('pvp.reloadNeeded'));
    console.warn('[pvp-sync] versión distinta: rival proto=' + theirs + ', yo=' + PROTO);
  }
  function handleIncomingEvents(room) {
    if (room.evBy && room.evBy !== S.role) checkProto(room.proto);
    if (!Array.isArray(room.ev) || !room.ev.length) return;
    if (room.evBy === S.role) return;             // eco propio
    // Validar TODO el rolling antes de tocar marcas de secuencia: un lote rechazado no puede
    // resetear/avanzar evInApplied ni colar los eventos buenos que lleve al lado del malicioso.
    var incoming = [];
    for (var ie = 0; ie < room.ev.length; ie++) {
      var ce = canonicalIncomingEvent(room.ev[ie]);
      if (ce === null) { rejectIncomingCards('event'); return false; }
      incoming.push(ce);
    }
    if (room.evHigh != null) S.evPeerHigh = room.evHigh;
    // RENUMERACIÓN del peer (recargó: su evSeq vuelve a 1): sin esto sus eventos nunca
    // superarían mi marca alta → snapshot mudo el resto de la partida. Se detecta porque
    // su MAYOR q es menor que mi marca (dentro de una sesión los q solo crecen).
    var maxQ = 0;
    incoming.forEach(function (e) { if (e && e.q > maxQ) maxQ = e.q; });
    if (maxQ && maxQ < S.evInApplied) S.evInApplied = 0;
    var evs = [];
    incoming.forEach(function (e) { if (e && e.q > S.evInApplied) evs.push(e); });
    if (!evs.length) return;
    S.waitSince = 0;   // llegan eventos nuevos: hay progreso
    if (room.evTs) S.lastLagMs = Math.max(0, evAgeMs(room.evTs));   // latencia real de entrega (sin el desfase)
    paintDbg();
    evs.sort(function (a, b) { return a.q - b.q; });
    // «El rival habla mi dialecto»: se decide con CADA lote, no una vez para siempre. Antes se
    // ponía a true solo por RECIBIR eventos y no volvía a false nunca: con un rival de otra
    // versión (tipos desconocidos) quedaba activado el camino de replay —que no podía
    // reproducir nada— y a la vez DESACTIVADO el de respaldo (playDiffCues), así que cada
    // acción suya era un salto seco sin ninguna animación. Ahora, si no entiendo sus eventos,
    // vuelvo al respaldo y aviso de que hay versiones distintas.
    var known = evs.every(function (e) { return e && REPLAY_TYPES[e.t]; });
    S.peerHasEv = known;
    if (!known) { S.evUnknown = (S.evUnknown || 0) + 1; checkProto(-1); }
    var ok = evs[0].q === S.evInApplied + 1 && evs.every(canReplayEv);
    S.evInApplied = evs[evs.length - 1].q;
    if (!ok) { if (S.latestPub) scheduleApply(S.latestPub); return; }   // gap → snapshot
    // JUGADAS VIEJAS: no se reproducen JAMÁS. El lote lleva la hora a la que lo escribió el
    // rival; si es de hace un rato, lo que trae ya no es «lo que está pasando», es historia —
    // y reproducirla es lo que hacía sonar entrenadores y evoluciones al abrir la web con una
    // sala vieja reanudada: la marca de «ya visto» vive en memoria y se pone a CERO en cada
    // carga, así que el buffer entero (40 jugadas) volvía a entrar como si fuera nuevo.
    // Se salta al estado real; lo ocurrido queda en el registro de acciones.
    if (room.evTs && evAgeMs(room.evTs) > S.EV_MAX_AGE_MS) {
      S.evStale = (S.evStale || 0) + 1;
      if (S.latestPub) scheduleApply(S.latestPub);
      return;
    }
    // «DEJAR DE MIRAR» (modelo del juego real, decisión de Daniel): lo que me perdí NO se
    // reproduce si vengo de una pausa de la pestaña o si ya voy muy por detrás — se salta al
    // estado real y lo perdido queda en el registro de acciones. Con COLCHÓN: una jugada
    // larga que acaba de llegar (un ataque con varios golpes) se ve entera, que es la regla
    // dura de las animaciones; lo que se descarta es el retraso acumulado.
    if ((Date.now() < (S.skipUntil || 0) || pendingReplayMs() > S.SKIP_BACKLOG_MS) && catchUpToLive()) return;
    enqueueReplay(evs);
    return true;
  }
  // Edad REAL de un lote del rival: su marca de tiempo la escribió ÉL con su reloj, así que
  // hay que descontar el desfase entre los dos dispositivos (lo mide checkPresence con su
  // latido). SIN esto, un rival con el reloj atrasado >20s veía TODAS sus jugadas descartadas
  // por «viejas» en mi cliente, en silencio y en un solo sentido: cada acción suya me llegaba
  // como un salto seco (medido con 60s de desfase: 0 replays y un re-montaje por acción).
  // reloj del rival = el mío + peerClockOff  →  su marca en MI reloj = ts - off  →  edad = ahora - (ts - off)
  function evAgeMs(ts) { return (Date.now() - ts) + (S.peerClockOff || 0); }
  window._pvpEvAgeMs = evAgeMs;   // hook de test
  // ── ANCLAS DE RELOJ COMPARTIDAS ENTRE DOS DISPOSITIVOS ──────────────────────────────
  // Los relojes de colocación y de turno se anclan a un instante que publica el OTRO cliente
  // (para que las dos pantallas enseñen el mismo número y una reconexión no lo reinicie), y
  // ese instante viene en SU reloj. Nadie sincroniza el reloj de su portátil: sin corregir el
  // desfase, el ancla cae minutos en el FUTURO (el reloj sale inflado y su consecuencia no
  // llega nunca: Daniel llegó a ver «398s» en uno de 90) o minutos en el PASADO (el turno se
  // auto-termina nada más empezar y la partida acaba sola sin que nadie haya podido jugar).
  function peerAt(t) { return t - (S.peerClockOff || 0); }
  // Lo ya transcurrido según un ancla compartida, EN MI RELOJ y acotado a [0, dur]. Se consulta
  // UNA VEZ, al armar: a partir de ahí cuenta mi propio reloj, que para medir DURACIONES es
  // fiable aunque su hora absoluta esté mal. Un ancla ajena que aún no puedo corregir (sin
  // latido del rival todavía) no vale nada: se empieza de cero.
  function sharedElapsed(at, dur, fromPeer) {
    if (!at) return 0;
    if (fromPeer && S.peerClockOff == null) return 0;
    var e = Date.now() - (fromPeer ? peerAt(at) : at);
    if (!(e > 0)) return 0;
    return Math.min(e, dur);
  }
  // RED DURA: ningún reloj compartido puede quitarle el turno ni la partida a nadie nada más
  // armarse. Por muy vencida que llegue el ancla, este cliente tiene que haber visto pasar esto.
  S.CLOCK_GRACE = 8000;
  function graceMs(dur) { return Math.min(S.CLOCK_GRACE, dur || 0); }
  window._pvpPeerAt = peerAt;               // hooks de test
  window._pvpSharedElapsed = sharedElapsed;
  S.SKIP_BACKLOG_MS = 1500;   // contenido pendiente a partir del cual se considera «voy detrás»
  S.EV_MAX_AGE_MS = 20000;    // más viejo que esto no se reproduce (una jugada real llega en menos de 1s)
  S.END_CLOSE_MS  = 4000;     // margen entre «se acabó» y cerrar la sesión (publicar + pintar el Fin)
  function pendingReplayMs() {
    var t = 0;
    for (var i = 0; i < S.evQueue.length; i++) t += (S.evQueue[i].dt != null ? S.evQueue[i].dt : 380);
    return t;
  }
  function catchUpToLive() {
    if (!S.latestPub) return false;   // sin estado autoritativo todavía: mejor reproducir
    S.evQueue.length = 0;
    S.evRunning = false;
    S.skipUntil = 0;
    var say = function () { try { window._boardNotice && window._boardNotice(T2('pvp.catchUp')); } catch (e) {} };
    say();
    scheduleApply(S.latestPub);
    setTimeout(say, 700);   // el re-montaje del tablero se lleva el aviso por delante: re-pintarlo
    return true;
  }
  window._pvpCatchUp = catchUpToLive;   // hooks de test
  window._pvpPendingReplayMs = pendingReplayMs;
  function enqueueReplay(evs) {
    Array.prototype.push.apply(S.evQueue, evs);
    if (S.evRunning) return;
    S.evRunning = true;
    (function step() {
      if (!S.active || S.over) { S.evQueue.length = 0; S.evRunning = false; return; }
      var e = S.evQueue.shift();
      if (!e) {
        S.evRunning = false;
        S.lastEvDoneAt = Date.now();   // margen para que las animaciones aterricen antes de comparar
        S.waitSince = 0;
        setTimeout(function () { verifySettle(0); }, 350);
        return;
      }
      var dur = 380;
      S.waitSince = 0;   // hay progreso: el escape anti-bloqueo del snapshot se reinicia
      S.replaying = true;
      try { dur = runEv(e) || 380; }
      catch (err) { S.evFail = true; console.warn('[pvp-sync] replay', e.t, err); }
      S.replaying = false;
      // El siguiente evento espera lo MISMO que esperó en el actor (dt). Así el rival ve la
      // cadencia real: dos robos seguidos van a 220ms, los golpes simultáneos a 0, y el
      // efecto de un partidario cae justo al acabar su vuelo. Si vamos retrasados (cola
      // larga por un pico de red) se comprime para alcanzar.
      var nxt = S.evQueue[0];
      var wait = nxt ? (nxt.dt != null ? nxt.dt : dur) : 0;
      if (S.evQueue.length > 4) wait = Math.round(wait * (S.evQueue.length > 8 ? 0.35 : 0.6));
      setTimeout(step, Math.max(0, Math.min(3000, wait)));
    })();
  }
  function popMirrorDorso() {
    var hand = document.getElementById('hand-p2');
    if (!hand) return;
    var cards = hand.querySelectorAll('.card');
    var last = cards[cards.length - 1];
    if (last) { last.remove(); window.layoutFan && window.layoutFan(hand); }
  }
  // Duración REAL de un golpe: animateDamage espera 275ms y luego _animateHpCount cuenta de
  // 10 en 10 con iv = min(119, max(52, 1375/pasos)) + un paso final. Sin esto, el 'ko' que
  // viene detrás arrancaba con la barra de PS aún bajando (daños grandes = ~700ms de desfase).
  function dmgDuration(amount) {
    var steps = Math.max(1, Math.ceil((amount || 0) / 10));
    var iv = Math.min(119, Math.max(52, 1375 / steps));
    if (document.documentElement.classList.contains('pb-reduce-motion')) return 420;
    return Math.min(2200, 275 + (steps + 1) * iv + 60);
  }
  function baseSlotStyles(c) {
    c.style.position = 'absolute'; c.style.left = '0'; c.style.top = '0';
    c.style.bottom = 'auto'; c.style.right = 'auto'; c.style.marginLeft = '0'; c.style.zIndex = '1';
  }
  function runEv(e) {
    var r;
    if (e.t === 'coins') {
      // el MISMO anuncio (texto + moneda 3D / fila) que vio el actor; su emit interno
      // queda gateado por S.replaying → no rebota
      window._announceCoins && window._announceCoins(e.h || 0, e.tl || 0, e.u);
      return 1500;
    }
    if (e.t === 'draw') {
      // pl 'p1' = robo del actor → dorso en su espejo; pl 'p2' = el actor hizo robar a MI
      // lado (Mars/Red Card) → robo REAL de mi cola (delegación: mis cartas las veo yo)
      var sideDr = e.pl === 'p2' ? 'p1' : 'p2';
      window.drawOneCard && window.drawOneCard(sideDr);
      return 780;
    }
    if (e.t === 'energy') {
      r = slotCardEl('p2', e.idx);
      if (!r || !r.card) throw new Error('sin carta');
      window._attachEnergyFromZone(r.card, e.type);     // partículas + sonido + reactivas reales
      return 520;
    }
    if (e.t === 'place') {
      r = slotCardEl('p2', e.idx);
      if (!r || r.card) throw new Error('hueco');
      popMirrorDorso();
      var c = window.createCard(locRaw(e.img));
      c.dataset.cardType = e.ct || '';
      c.dataset.cardName = e.nm || '';
      if (e.hp) { c.dataset.hpMax = e.hp; c.dataset.hpCur = e.hp; }
      r.slot.appendChild(c);
      window._ensureFossilHp && window._ensureFossilHp(c);   // red: fósil sin PS en el aviso → sus 40 (la vista en juego exige estar YA en el hueco)
      baseSlotStyles(c);
      c._enteredPlayTurn = window.globalTurnNumber;
      window.updateHpDisplay && window.updateHpDisplay(c);
      r.slot.classList.add('receiving');
      setTimeout(function () { r.slot.classList.remove('receiving'); }, 650);
      cueEnter('p2', e.idx, 'cardGrab');   // deslizado por defecto (validado por Daniel)
      return 480;
    }
    if (e.t === 'evolve') {
      r = slotCardEl('p2', e.idx);
      if (!r || !r.card) throw new Error('sin objetivo');
      if (e.src === 'deck') {
        if (window.deckPlayQueues && window.deckPlayQueues.p2) window.deckPlayQueues.p2.shift();
        window.refreshDeckBadge && window.refreshDeckBadge('p2');
      } else popMirrorDorso();
      var evo = window.createCard(locRaw(e.img));
      evo.dataset.cardType = e.ct || '';
      evo.dataset.cardName = e.nm || '';
      if (e.hp) { evo.dataset.hpMax = e.hp; evo.dataset.hpCur = e.hp; }   // el traspaso de daño de _doEvolution lo recalcula
      window._doEvolution(evo, r.card, r.slot);          // estado real: conserva daño/energía/tool
      baseSlotStyles(evo);
      // SIN deslizado ni sfx extra: en hotseat la evolución NO desliza desde la mano (el
      // drop handler sale por return antes) y _doEvolution ya suena — duplicarlo era eco.
      return 560;
    }
    if (e.t === 'stadium') {
      // estadio único: el nuevo manda el anterior (de cualquier lado) a su descarte
      document.querySelectorAll('.slot[data-label*="Estadio"] .card').forEach(function (old) {
        var so = old.closest('#zone-p2') ? 'p2' : 'p1';
        window.pushToDiscard && window.pushToDiscard(so, bgUrl(old), false);
        old.remove();
        window.refreshDiscardSlot && window.refreshDiscardSlot(so);
      });
      var stSlot = document.querySelector('.slot[data-label="Estadio ' + (e.pl === 'p1' ? 'P2' : 'P1') + '"]');
      if (!stSlot) throw new Error('sin hueco');
      popMirrorDorso();
      var st = window.createCard(locRaw(e.img));
      st.dataset.cardType = e.ct || '';
      st.dataset.cardName = e.nm || '';
      stSlot.appendChild(st);
      baseSlotStyles(st);
      slideCardFromHand(st, 'p2', 'cardGrab');
      return 500;
    }
    if (e.t === 'tool') {
      r = slotCardEl('p2', e.idx);
      if (!r || !r.card || !window._makeToolWidget) throw new Error('sin objetivo');
      popMirrorDorso();
      var tw = window._makeToolWidget('url("' + locRaw(e.img) + '")', e.nm || '');
      tw.dataset.cardType = e.ct || '';
      tw.dataset.cardName = e.nm || '';
      r.card.appendChild(tw);
      window._recomputeHp && window._recomputeHp(r.card);
      if (window.sfx) window.sfx('board.equipTool'); else if (window.playSound) window.playSound('cardGrab');
      return 420;
    }
    // — R2: consecuencias con las MISMAS funciones —
    if (e.t === 'trainer') {
      // el partidario/objeto del rival = playTrainer DE VERDAD sobre el último dorso de su
      // mano (vuelo con latigazo + giro + caída al descarte, y el push a su pila lo hace él)
      var hand2 = document.getElementById('hand-p2');
      var dorsos = hand2 ? hand2.querySelectorAll('.card') : [];
      var tcard = dorsos.length ? dorsos[dorsos.length - 1] : null;
      if (!tcard || !window.playTrainer) throw new Error('sin carta');
      tcard.style.backgroundImage = 'url("' + locRaw(e.img) + '")';
      tcard.dataset.cardType = e.ct || '';
      tcard.dataset.cardName = e.nm || '';
      if (e.hp) { tcard.dataset.hpMax = e.hp; tcard.dataset.hpCur = e.hp; }
      window.playTrainer(tcard, 'p2', null, { replay: true });
      return 1700;
    }
    if (e.t === 'dmg') {
      // el daño llega YA RESUELTO (reducciones/monedas del actor) → verbatim, y el KO NO
      // se deriva aquí (llega como evento 'ko' propio: una sola autoridad)
      var sideD = e.pl === 'p1' ? 'p2' : 'p1';
      r = slotCardEl(sideD, e.idx);
      if (!r || !r.card || !window.animateDamage) throw new Error('sin carta');
      window._pbDmgVerbatim = true;
      try { window.animateDamage(r.card, e.n, e.src); }
      finally { window._pbDmgVerbatim = false; }
      return dmgDuration(e.n);   // el KO no puede adelantarse al conteo de PS
    }
    if (e.t === 'ko') {
      var sideK = e.pl === 'p1' ? 'p2' : 'p1';
      r = slotCardEl(sideK, e.idx);
      if (!r || !r.card || !window.sendToDiscard) throw new Error('sin carta');
      r.card._koSource = e.src || 'attack';
      if (e.deny != null) r.card._koDeny = !!e.deny;   // la moneda la tiró el atacante
      window._pbAttacker = null;   // atacante RANCIO de mi último turno: Lucky Mittens no debe re-disparar aquí (llega como evento 'draw')
      window.sendToDiscard(r.card);   // vuelo + puntos + ceremonia + promoción REAL (si es mi Activo, elijo YO)
      return 1900;
    }
    if (e.t === 'handToDeck') {
      // Copiona y familia: la mano vuela al mazo y se baraja (los robos posteriores llegan
      // como eventos 'draw'). pl 'p2' = MI mano real (Red Card/Iono/Mars delegados: mis
      // cartas de verdad vuelven a MI mazo) — misma función, con 0 robos aquí.
      if (!window._shuffleHandRedraw) throw new Error('sin helper');
      window._shuffleHandRedraw(e.pl === 'p2' ? 'p1' : 'p2', function () { return 0; });
      return 1300;
    }
    if (e.t === 'swap') {
      var sideS = e.pl === 'p1' ? 'p2' : 'p1';
      var mS = slotMap(sideS);
      var slotsS = Array.prototype.slice.call(document.querySelectorAll('#zone-' + sideS + ' .pokemon-slot'));
      var sA = mS && slotsS[mS[e.a]], sB = mS && slotsS[mS[e.b]];
      if (!sA || !sB || !window._swapSlots) throw new Error('sin huecos');
      // Un intercambio SIEMPRE mueve dos Pokémon (retirada, cambio por efecto): todos los
      // llamadores de _swapSlots pasan huecos con carta. Si aquí falta una, mi tablero
      // discrepa del espejo del emisor → seguir dejaría el ACTIVO VACÍO (_swapSlots hace
      // `if (a) slotB.appendChild(a)` sin devolver nada). Mejor fallar: el throw cae al
      // snapshot, que es la red.
      if (!sA.querySelector('.card') || !sB.querySelector('.card')) throw new Error('hueco sin carta');
      window._swapSlots(sA, sB);   // retirada/switch: el MISMO intercambio real
      return 700;
    }
    if (e.t === 'cond') {
      var sideC = e.pl === 'p1' ? 'p2' : 'p1';
      r = slotCardEl(sideC, e.idx);
      if (!r || !r.card) throw new Error('sin carta');
      var prevC = r.card._cond || {};
      var nowC = e.cond || {};
      r.card._cond = JSON.parse(JSON.stringify(nowC));
      // firma en el MISMO formato del emisor (claves activas) → no re-emitir este estado
      r.card._pvpCondSig = Object.keys(nowC).filter(function (k) { return nowC[k] === true; }).sort().join('|');
      window._renderConditions && window._renderConditions(r.card);
      // sfx solo para estados que se ENCIENDEN (igual que _condSfx en el actor)
      for (var ck in nowC) {
        if (nowC[ck] === true && prevC[ck] !== true && window._condSfx) { try { window._condSfx(ck); } catch (err2) {} }
      }
      return 420;
    }
    if (e.t === 'promote') {
      // el actor eligió su nuevo Activo: resuelve el selector que el replay del 'ko' armó
      injectPromote(e.idx);
      return 700;
    }
    if (e.t === 'heal') {
      var sideH = e.pl === 'p1' ? 'p2' : 'p1';
      r = slotCardEl(sideH, e.idx);
      if (!r || !r.card || !window._healCard) throw new Error('sin carta');
      window._healCard(r.card, e.n);   // +N verde + partículas + conteo, la misma cura
      return 900;
    }
    if (e.t === 'moveE') {
      var sideM = e.pl === 'p1' ? 'p2' : 'p1';
      var src = slotCardEl(sideM, e.from), dst = slotCardEl(sideM, e.to);
      if (!src || !src.card || !dst || !dst.card || !window._moveEnergy) throw new Error('sin cartas');
      window._moveEnergy(src.card, dst.card, e.n, e.etype || null, false);   // vuelo real de orbes
      return 800;
    }
    if (e.t === 'discardE') {
      var sideE = e.pl === 'p1' ? 'p2' : 'p1';
      r = slotCardEl(sideE, e.idx);
      if (!r || !r.card || !window._discardEnergy) throw new Error('sin carta');
      window._discardEnergy(r.card, 0, null, e.types || []);   // EXACTAMENTE los tipos que salieron allí
      return 750;
    }
    if (e.t === 'zone') {
      // Estado absoluto de la zona del rival: su orbe real (tipo incluido) y su próxima energía.
      var zEl = document.querySelector('#energy-zone-p2 .energy-orb');
      var zTy = zEl ? (zEl.dataset.energyType || null) : null;
      if (e.type) { if (zTy !== e.type && window._buildZoneOrb) window._buildZoneOrb('p2', e.type, true); }
      else if (zEl) { (window.explodeOrb || window.consumeOrb)('p2'); }   // se gastó / se perdió al acabar su turno
      window._pbNextEnergy = window._pbNextEnergy || { p1: null, p2: null };
      window._pbNextEnergy.p2 = e.next || null;
      if (window._renderNextEnergy) window._renderNextEnergy('p2');
      return 220;
    }
    if (e.t === 'nextE') {
      // Buggy Beam: `pl` viaja en el POV del emisor → 'p2' suyo = 'p1' mío (soy el afectado).
      var sideN = e.pl === 'p1' ? 'p2' : 'p1';
      window._pbNextEnergy = window._pbNextEnergy || { p1: null, p2: null };
      window._pbNextEnergy[sideN] = e.type || null;
      if (window._renderNextEnergy) window._renderNextEnergy(sideN);
      if (window.sfx) { try { window.sfx('board.energySpawn'); } catch (er) {} }
      return 220;
    }
    throw new Error('evento desconocido');
  }
  // — Verificación post-replay: el espejo debe quedar EXACTO al pub —
  function verSig(c) {
    if (!c) return null;
    // OJO: siempre ARRAYS [p1, p2] — swapSides invierte el ORDEN de claves de los mapas
    // {p1,p2} y el JSON dejaría de coincidir aun con valores idénticos.
    var o = { b: [], s: [], d: [] };
    ['p1', 'p2'].forEach(function (pl) {
      o.b.push((((c.board || {})[pl]) || []).map(function (x) {
        if (!x) return null;
        var tools = x.tool ? (Array.isArray(x.tool) ? x.tool.length : 1) : 0;
        var cd = (x.state && x.state._cond) || {};
        var conds = Object.keys(cd).filter(function (k) { return cd[k] === true; }).sort().join('|');
        return [imgKey(x.img), String(x.hpCur || ''), (x.energies || []).length, (x.evoStack || []).length, tools, conds];
      }));
      var st = c.stadiums && c.stadiums[pl];
      o.s.push(st ? imgKey(st.img) : null);
      o.d.push((((c.discard || {})[pl]) || []).length);
    });
    var g = c.game || {}, sc = g.scores || {}, hN = c.handN || {}, dN = c.deckN || {};
    o.h = [hN.p1 || 0, hN.p2 || 0];
    o.n = [dN.p1 || 0, dN.p2 || 0];
    o.t = g.turn; o.tn = g.turnNum;
    o.sc = [sc.p1 || 0, sc.p2 || 0];
    return JSON.stringify(o);
  }
  // DIAGNÓSTICO: por qué divergió la verificación (lo lee el chip de depuración y las sondas).
  // Guarda las dos firmas y QUÉ claves difieren — sin esto, un re-montaje constante es mudo.
  function noteVerFail(want, have) {
    var keys = [];
    try {
      var w = JSON.parse(want), h = JSON.parse(have);
      Object.keys(w).forEach(function (k) {
        if (JSON.stringify(w[k]) !== JSON.stringify(h[k])) keys.push(k);
      });
    } catch (e) {}
    S.verFails = (S.verFails || 0) + 1;
    S.lastVerFail = { at: Date.now(), keys: keys, want: want, have: have };
  }
  window._pvpVerFail = function () { return S.lastVerFail || null; };
  function localCanon() {
    if (!window._pvpBuildPayload) return null;
    try { return pubFromPayload(window._pvpBuildPayload()); } catch (e) { return null; }
  }
  // Aplica el pendiente de elección que traiga el pub (o desarma el que quedara vivo).
  function applyPending(pub, delay) {
    S.pubPending = pub.pending || null;   // el rival está a mitad de efecto (revealHand…): mi watchdog no debe rematar KOs
    if (pub.pending === 'promote') setTimeout(showPromoteChoice, delay);
    else if (pub.pending === 'pick') setTimeout(function () { showPickChoice(pub.pickPool); }, delay);
    else { clearPromoteChoice(); clearPickChoice(); }   // si no, quedan .fx-target y un listener que roba clics
  }
  // NÚCLEO: si el replay ya dejó el espejo EXACTO al snapshot, NO se re-monta (objetivo del
  // pivote: cero refrescos secos); si diverge, restaura como red de seguridad.
  function settleOrApply(pub) {
    if (!pub || !S.active || S.over) return false;
    var wantC = canonPov(pub);
    if (!S.evFail && S.peerHasEv) {
      var want = verSig(wantC), have = verSig(localCanon());
      if (want && have && want === have) {
        S.lastAppliedPub = wantC;
        if (S.applyTimer) { clearTimeout(S.applyTimer); S.applyTimer = null; }
        S.pendingPub = null;
        applyPending(pub, 400);
        return true;
      }
      if (want && have) noteVerFail(want, have);
    }
    S.evFail = false;
    S.lastApplyAt = Date.now();
    if (!applyPub(pub)) { paintDbg(); return false; }
    applyPending(pub, 700);
    paintDbg();
    return false;
  }
  function verifySettle(attempt) {
    if (S.evRunning || !S.active || S.over) return;   // llegaron más eventos: verificará su drain
    // SOY EL ACTOR → mi estado local ES el canónico; S.latestPub es el pub VIEJO del rival
    // (su traspaso hacia mí). Verificar contra él siempre «divergiría» según juego mi turno
    // y un timer rezagado (el verify de los últimos replays) RE-MONTABA ese pub viejo —
    // llegó a REVERTIR un endTurn rápido y comerse el pase de turno (carrera de Daniel).
    if (S.actorNow) return;
    var pub = S.latestPub;
    if (!pub) return;
    if (S.evFail) { S.evFail = false; scheduleApply(pub); return; }
    var wantC = canonPov(pub), haveC = localCanon();
    var want = verSig(wantC), have = verSig(haveC);
    if (want && have && want !== have) noteVerFail(want, have);
    if (want && have && want === have) {
      S.lastAppliedPub = wantC;                                   // sin re-montaje
      if (S.applyTimer) { clearTimeout(S.applyTimer); S.applyTimer = null; }
      S.pendingPub = null;
      applyPending(pub, 400);
      return;
    }
    // un TURNO distinto nunca se arregla esperando (el cambio de turno no se replaya):
    // al snapshot YA — es el traspaso, y de él cuelgan mi robo y mi energía
    if (pub.evAt != null && pub.evAt < S.evInApplied) return;   // foto anterior a lo replayado: la siguiente traerá el estado bueno
    var turnDiff = wantC && haveC && ((wantC.game || {}).turn !== (haveC.game || {}).turn);
    if (attempt < 1 && !turnDiff) {
      setTimeout(function () { verifySettle(attempt + 1); }, 700);   // animaciones aún aterrizando
    } else {
      scheduleApply(pub);   // divergencia (efecto sin evento propio) → snapshot
    }
  }
  // Hooks de test del canal de eventos
  window._pvpHandlePub = handleIncomingPub;
  window._pvpHandleEvents = handleIncomingEvents;
  window._pvpDmgDuration = dmgDuration;
  window._pvpEvOut = function () { return S.evOut.slice(); };

  function applyPub(pub) {
    if (!pub || !window._pvpRestoreState || !window._pvpClearBoard) return false;
    pub = canonicalIncomingPub(pub);
    if (!pub) { rejectIncomingCards('pub/apply'); return false; }
    S.mounts = (S.mounts || 0) + 1;   // TODOS los re-montajes (antes solo los de settleOrApply)
    S.applying = true;
    var p, canon = canonPov(pub);
    try {
      p = payloadFromPub(pub);
      window._pvpClearBoard();
      window._pvpRestoreState(p);
      // una promoción viva sobrevive al re-montaje (el clearBoard la conserva en PvP):
      // hay que devolverle el resaltado, porque las cartas son nuevas
      window._pbRehighlightPromote && window._pbRehighlightPromote();
    } finally {
      // _restoreState remata con setTimeout(200) internos → margen antes de re-armar publish
      setTimeout(function () { S.applying = false; }, 280);
    }
    // cues de lo que CAMBIÓ — SOLO para peers legacy (sin eventos): con replay real las
    // animaciones ya corrieron con el código del tablero; duplicarlas aquí sería doble
    requestAnimationFrame(function () {
      if (!S.peerHasEv) { try { playDiffCues(S.lastAppliedPub, canon); } catch (e) {} }
      S.lastAppliedPub = canon;
    });
    // TRASPASO DE TURNO: el rival avanzó el turno hacia MÍ. Su cliente ya "robó" por mí
    // sobre su espejo (cola dummy → su conteo cuadra); el ROBO REAL (la carta de verdad,
    // de MI cola local a MI mano) tiene que hacerlo este cliente, una vez por nº de turno.
    try {
      var g = (p && p.game) || {};
      if (g.started && !g.placement && g.turn === 'p1' && g.turnNum != null && g.turnNum !== S.lastDrawTurn) {
        S.lastDrawTurn = g.turnNum;
        // SOY EL ACTOR DESDE YA (no desde el primer settle, que tarda ~2s en llegar por el
        // robo+vuelo+debounce): sin esto, un endTurn RÁPIDO nada más recibir el turno caía
        // en la rama muda (`!S.actorNow → return`) y el traspaso NUNCA se publicaba →
        // ambos clientes clavados en «no es tu turno» (bug del playtest de Daniel).
        S.actorNow = true;
        // ── BARRIDO DE TURNO en el cliente que RECIBE el turno ──
        // Lo dispara este bloque, no el restore: el restore corre en cada pub del rival (y en
        // cada deshacer/escenario), mientras que aquí ya hay dedupe por número de turno.
        // El actor lo dispara por su lado en advance() → los dos veis lo mismo.
        var _hold = 0;
        try { if (window.pbTurnFx) _hold = window.pbTurnFx.play('p1') || 0; } catch (e) {}
        var _afterFx = function (cb) { window.pbTurnFx ? window.pbTurnFx.after(cb) : setTimeout(cb, 0); };
        // Es una PAUSA: robo, energía y reloj esperan a que el barrido termine.
        _afterFx(function () {
          var _draw = function () {
            // SILENCIADO como evento: el cliente del rival ya animó este robo en su espejo
            // (el advance de su endTurn roba un dorso para mí) — re-emitirlo lo duplicaría.
            setTimeout(function () {
              if (!window.drawOneCard) return;
              window._pvpSilenceEv ? window._pvpSilenceEv(function () { window.drawOneCard('p1'); })
                                   : window.drawOneCard('p1');
            }, _hold ? 200 : 420);
          };
          // MIS habilidades de fase de turno van ANTES del robo: leen MI mazo, así que el
          // cliente del rival no ha podido resolverlas (para él son dorsos). Caterpie «Quick
          // Growth» evoluciona al cerrarse el turno del rival, antes de que yo robe.
          // El margen deja que el apply de ese pub suelte `S.applying` (280ms): el primer beat
          // se ejecuta SÍNCRONO y sus eventos se descartarían mientras siga puesto → el rival
          // vería la evolución aparecer de golpe con el siguiente snapshot, sin animación.
          setTimeout(function () {
            try { window._pbRunOwnTurnPhase && window._pbRunOwnTurnPhase(); } catch (e) {}
            // El robo espera a que terminen sus beats (si no hay ninguno, va directo).
            window._pbAfterBeats ? window._pbAfterBeats(_draw) : _draw();
          }, 320);
        });
        // Mi ENERGÍA del turno la genero YO (el 1er turno del 1er jugador no genera —
        // eso lo decide spawnOrb/nextEnergy local, aquí solo si la zona está vacía).
        _afterFx(function () {
          setTimeout(function () {
            if (!document.querySelector('#energy-zone-p1 .energy-orb') && window.spawnOrb) {
              try { window.spawnOrb('p1'); } catch (e) {}
            }
          }, _hold ? 320 : 700);
        });
        // El reloj de 90s arranca cuando puedes jugar de verdad, no durante la animación:
        // si no, cada turno te comería el segundo del barrido.
        _afterFx(function () { startTurnTimer(true); });
      }
    } catch (e) {}
    return true;
  }

  // ── publicar al asentarse una acción (misma señal que el checkpoint del deshacer) ──
  // GATING DE ACTOR: solo publica el cliente del jugador en turno (p1 local). El estado
  // de TRASPASO (acabo de pasar el turno → game.turn='p2') se publica UNA vez y se cede.
  // El no-actor JAMÁS publica → sin ecos ni pisadas al aplicar pubs remotos.
  window._pvpOnSettled = function (payload) {
    if (!S.active || S.applying || S.over) return;
    writePriv(payload);   // mi mano/cola al doc privado (reconexión); dedupe por firma
    // Colocación simultánea: cada cliente publica SOLO su lado (merge por rol, sin pisarse)
    if (payload.game && payload.game.placement) { publishSide(); return; }
    // La petición de descarte oculto debe seguir visible hasta que el dueño responda.
    // Un checkpoint intermedio (daño del ataque / habilidad marcada como usada) no puede
    // reemplazarla por un pub normal y hacer que el otro cliente nunca llegue a verla.
    if (S.hiddenDiscardReq) return;
    var turn = payload.game && payload.game.turn;
    if (turn === 'p1') {
      S.actorNow = true;
      // AFK: un settle en mi turno = acción, SALVO los de la maquinaria de inicio de turno
      // (robo automático ~1s tras armarse) — sin esta gracia, el robo marcaba «actuó» y
      // un jugador AFK de verdad nunca acumulaba strikes.
      if (!S.turnArmedAt || Date.now() - S.turnArmedAt > 2500) S.actedThisTurn = true;
    }
    else if (!S.actorNow) return;         // turno del rival y no vengo de actuar → mudo
    var pub = pubFromPayload(payload);
    if (!pub) return;
    var sig;
    try { sig = JSON.stringify(pub, function (k, v) { return k === 'ts' ? undefined : v; }); } catch (e) { sig = null; }
    if (sig && sig === S.lastPubSig) return;   // sin cambio público → no escribir
    S.lastPubSig = sig;
    S.seq += 1;
    var r = window.pbPvp;
    if (!r || !S.code) return;
    // update (NO set-merge): el campo pub se REEMPLAZA entero — un merge dejaría claves
    // rancias del pub anterior (pending, locks de turnState ya limpiados…).
    r.update(S.code, { pub: pub, seq: S.seq, pubBy: S.role })
      .catch(function (e) { console.warn('[pvp-sync] publish', (e && e.code) || e); });
    S.lastAppliedPub = canonPov(pub);   // mis propias jugadas NO generan cues al volver el turno
    if (turn !== 'p1') { S.actorNow = false; startTurnTimer(false); }   // traspaso publicado → reloj del rival
  };

  // ── entrada de snapshots de sala (lo llama pvp.js desde su onRoom) ──
  window._pvpOnRoom = function (room) {
    if (!S.active || !room) return;
    // Al reanudar, getPriv es asíncrono y el tablero todavía contiene cero o una partida
    // local ajena. Ningún responder de zonas ocultas puede ejecutarse hasta restaurar MI
    // mano/cola reales. Guardamos solo la foto más reciente y la reinyectamos al terminar.
    if (S.resumePending) { S.resumeRoom = room; return; }
    // Emote del rival: campo ligero `emote {by,id,n}` de la sala. Dedupe por `n` (el poll
    // re-entrega el mismo doc) + ventana de frescura (una reconexión trae el último emote
    // viejo → no re-mostrarlo). El propio eco (by === mi rol) solo actualiza la marca.
    var em = room.emote;
    // uid del rival (host/guest de la sala): su proyección pública se precarga aquí para
    // que el primer emote no espere a la red
    var oppUid = S.role === 'host' ? (room.guest && room.guest.uid) : (room.host && room.host.uid);
    if (oppUid && oppUid !== S.oppUid) { S.oppUid = oppUid; if (window.PB_EMOTES) try { window.PB_EMOTES.loadPublic(oppUid); } catch (e) {} }
    if (em && em.n && em.n !== S.lastEmoteN) {
      S.lastEmoteN = em.n;
      // `em.n` lo escribe el RIVAL con SU reloj → hay que descontar el desfase entre los dos
      // dispositivos (misma clase de fallo que la guarda de eventos: con un rival desfasado
      // más de 10 s sus emotes no se pintaban NUNCA).
      if (em.by && em.by !== S.role && evAgeMs(em.n) < 10000 && !emotesMuted()) {
        // ANTI-FAKE: solo se pinta si el rival tiene DERECHO a ese emote — los 7 por
        // defecto siempre; los demás según SU proyección pública (users/{uid}/public/
        // profile, escrita solo por la Cloud Function) evaluada con js/mastery.js.
        var E = window.PB_EMOTES, id = em.id, n = em.n;
        var show = function () { showEmoteBubble(id, 'opp'); if (window.playSound) window.playSound('notification'); };
        if (!E || E.isDefault(id)) show();
        else if (E.isKnown(id)) {
          E.loadPublic(S.oppUid).then(function (view) {
            if (evAgeMs(n) >= 10000) return;
            // sin proyección del rival SOLO se acepta en local/LAN (pruebas sin la función desplegada)
            if (!view && E.devLoose && E.devLoose()) { show(); return; }
            if (E.allowed(id, view || E.statsView(null))) show();
          });
        }
      }
    }
    // Fin de partida remoto (rendición o desconexión declarada por el otro cliente)
    if (room.status === 'over' && room.over && !S.over) {
      endMatchOver(room.over.winner, room.over.reason, false);
      return;
    }
    if (S.over) return;
    // Preflight ANTES de que pending/sides puedan responder, guardarse ocultos o liberar la
    // colocación. Conservamos el objeto original; solo esta vista local usa las copias saneadas.
    var rejectedPeerPub = false;
    if (room.pub && room.pubBy !== S.role) {
      var safePub = canonicalIncomingPub(room.pub);
      if (!safePub) { rejectIncomingCards('pub'); rejectedPeerPub = true; }
      room = Object.assign({}, room, { pub: safePub });
    }
    var oppSideKey = S.role === 'host' ? 'guest' : 'host';
    if (room.sides && room.sides[oppSideKey]) {
      var safeSide = canonicalIncomingSide(room.sides[oppSideKey]);
      var safeSides = Object.assign({}, room.sides);
      if (!safeSide) { rejectIncomingCards('side'); delete safeSides[oppSideKey]; }
      else safeSides[oppSideKey] = safeSide;
      room = Object.assign({}, room, { sides: safeSides });
    }
    checkPresence(room);
    // Reloj de turno COMPARTIDO: el jugador ACTIVO publica `turnAt`; el INACTIVO (y una
    // reconexión) lo ADOPTA y re-pinta su reloj con el mismo instante → los dos ven el mismo
    // tiempo restante, y recargar no lo reinicia a 90s.
    if (room.turnAt && S.placementReleased && !S.turnMine && room.turnAt !== S.turnAt) {
      startTurnTimer(false, room.turnAt, true);   // lo publicó el jugador activo = el rival
    }
    // Reloj de COLOCACIÓN: el host publica el instante de arranque y el invitado lo adopta
    // (los dos ven el mismo número; una reconexión lo recupera en vez de reiniciarlo).
    if (room.setupAt && !S.placementReleased && room.setupAt !== S.setupAt) armSetupTimer(room.setupAt);
    // ¿el rival ya ha colocado? (lo necesita el fin por tiempo de colocación)
    var _os = room.sides && room.sides[S.role === 'host' ? 'guest' : 'host'];
    S.oppDone = !!(_os && _os.done);
    // Tope global: adoptar el consumo publicado (el del rival siempre; el mío solo cuando no
    // estoy en turno — si estoy jugando, el bueno es mi contador en vivo).
    if (room.clock) {
      if (!S.used) S.used = { host: 0, guest: 0 };
      var _opr = S.role === 'host' ? 'guest' : 'host';
      if (typeof room.clock[_opr] === 'number') S.used[_opr] = room.clock[_opr];
      if (typeof room.clock[S.role] === 'number' && !S.turnMine) {
        S.used[S.role] = Math.max(S.used[S.role] || 0, room.clock[S.role]);
      }
    }
    // Fase de colocación: soltar (si ambos listos) ANTES de aplicar el lado — si no,
    // el apply re-entra en colocación por su timer interno y pisa la liberación.
    if (room.sides) S.lastRoomSides = room.sides;   // ya saneado por el preflight
    if (room.sides) maybeReleasePlacement(room);
    var oppSide = room.sides && room.sides[S.role === 'host' ? 'guest' : 'host'];
    // El seq se consume SOLO si el lado se aplica: marcarlo sin aplicar convertía una
    // carrera transitoria en una pérdida definitiva (ese lado ya no se vuelve a mirar).
    if (oppSide && oppSide.seq != null && oppSide.seq > S.oppSideSeq && !S.placementReleased) {
      S.oppSideSeq = oppSide.seq;
      applyOppSide(oppSide);
    }
    // Elección remota (promoción del rival) dirigida a MÍ como atacante
    var ch = room.choice;
    // Dedupe por FIRMA (no por seq creciente): el campo `choice` es ÚNICO y compartido por
    // los dos jugadores, y tras una recarga la numeración de cualquiera reinicia → un
    // umbral monótono descartaba elecciones legítimas (partida atascada).
    var chSig = ch ? (ch.by + '|' + ch.seq + '|' + ch.kind + '|' + ch.idx) : null;
    if (ch && ch.by && ch.by !== S.role && chSig !== S.lastChoiceSig) {
      S.lastChoiceSig = chSig;
      if (ch.seq != null && ch.seq > S.choiceHigh) S.choiceHigh = ch.seq;
      if (ch.kind === 'promote') injectPromote(ch.idx);
      else if (ch.kind === 'pick') injectPick(ch.idx);
      else if (ch.kind === 'hand') window._pbResolveHandReveal && window._pbResolveHandReveal(ch.idxs || ch.idx, ch.act);   // el rival eligió de MI mano (una o varias)
    }
    answerHandRequest(room);   // me piden mi mano (efecto que la revela) → responder
    onHandRevealed(room);      // llegó la mano que pedí → enseñarla y elegir
    answerDeckCount(room);     // me piden un conteo de mi mazo (Cyberjack) → responder
    onDeckCounted(room);       // llegó el conteo que pedí → seguir resolviendo el ataque
    answerHiddenDiscard(room); // me piden descartar de MI mazo/mano real → mutar y revelar solo lo descartado
    onHiddenDiscarded(room);   // llegó el resultado → quitar dorsos del espejo y continuar
    releaseHiddenDiscardGuard(room); // el pub final ya puede sustituir la pila local protegida
    // Eventos del rival: llegan por su propio campo y se replayan YA (antes que el snapshot)
    handleIncomingEvents(room);
    // Partida en marcha: pub completo autoritativo
    if (rejectedPeerPub) return;                  // no consumir su seq: una corrección con el mismo número aún puede entrar
    if (room.seq == null) return;
    if (room.seq <= S.seq) return;               // viejo o eco propio
    S.seq = room.seq;
    if (room.pubBy === S.role) return;           // eco propio con seq mayor (reconexión)
    if (room.pub) handleIncomingPub(room.pub, true);   // ya pasó el preflight; si no, snapshot
  };
  // COALESCE de applies: varios pubs seguidos (energía → ataque → fin de turno) re-montaban
  // el tablero en cadena y ABORTABAN las animaciones a medias («no se ven los cues»).
  // Mínimo ~1s entre restores; mientras, solo se guarda el ÚLTIMO pub y se aplica ese.
  function scheduleApply(pub) {
    S.pendingPub = pub;
    if (S.applyTimer) return;
    var since = Date.now() - (S.lastApplyAt || 0);
    // El agrupado de 1s evita ráfagas de re-montajes, pero el TRASPASO DE TURNO no puede
    // esperarlo (es lo único que no viaja como evento y se notaba lento) → vía rápida.
    var urgent = pub && pub.game && pub.game.turn &&
                 canonPov(pub).game.turn !== window.activeTurn;
    var wait = urgent ? 40 : Math.max(60, 1000 - since);
    S.applyTimer = setTimeout(function () {
      S.applyTimer = null;
      // replay en curso, eventos sin aplicar (los conocidos O los que el propio snapshot
      // declara incluir), o recién terminado (las animaciones aún aterrizan) → NO re-montar
      // por delante. Con escape a los 5s por si un evento se perdió (nunca bloquear).
      var pend = S.latestPub || S.pendingPub;
      // CAUSALIDAD snapshot ↔ eventos (`evAt` = hasta qué evento del emisor incluye la foto):
      //  · evAt > lo replayado → la foto va POR DELANTE: esperar a replayar (si no, el evento
      //    repetiría después lo que la foto ya trajo → cambio de Activo hecho dos veces).
      //  · evAt < lo replayado → la foto va POR DETRÁS: DESCARTARLA (aplicarla desharía lo ya
      //    replayado — el bug de «elijo mi nuevo activo y vuelve al de antes»).
      var behind = (S.evPeerHigh || 0) > S.evInApplied ||
                   (pend && pend.evAt != null && pend.evAt > S.evInApplied);
      var stale = pend && pend.evAt != null && pend.evAt < S.evInApplied;
      if (!S.waitSince) S.waitSince = Date.now();
      if (stale && Date.now() - S.waitSince < 5000) { scheduleApply(S.pendingPub); return; }
      if ((S.evRunning || behind || (S.lastEvDoneAt && Date.now() - S.lastEvDoneAt < 900)) &&
          Date.now() - S.waitSince < 5000) { scheduleApply(S.pendingPub); return; }
      S.waitSince = 0;
      // SIEMPRE el pub más reciente: mientras el timer esperaba pueden haber llegado pubs
      // por el camino de EVENTOS (que solo tocan S.latestPub) — restaurar el viejo haría
      // RETROCEDER el tablero deshaciendo lo ya replayado.
      var pp = S.latestPub || S.pendingPub; S.pendingPub = null;
      if (!pp || !S.active || S.over) return;
      // SOY EL ACTOR: nada que aplicar — todo pub en vuelo es el traspaso viejo del rival
      // (o un eco); restaurarlo desharía mis jugadas de ESTE turno (ver verifySettle).
      // Excepción: el pub que me HACE actor (turn-became-mine) ya se aplicó antes de armarse.
      if (S.actorNow) return;
      settleOrApply(pp);
    }, wait);
  }

  window._pvpMatchBegin = function (code, role) {
    S.active = true; S.code = code; S.role = role; S.seq = 0; S.lastPubSig = null;
    S.sideSeq = 0; S.oppSideSeq = 0; S.readySent = false; S.placementReleased = false;
    S.lastSideSig = null; S.actorNow = false; S.lastDrawTurn = -1;
    S.choiceHigh = 0; S.lastChoiceSig = null; S.choiceArmed = false; S.pickArmed = false;
    S.peerClockOff = null; S.evStale = 0; S.verFails = 0; S.lastVerFail = null;   // desfase de relojes y diagnóstico, por partida
    S.turnAt = 0; S.turnMine = false;   // reloj de turno compartido (turnAt): se fija al arrancar
    S.turnBase = 0; S.turnArmedAt = 0;   // ...y se cuenta con MI reloj desde que lo armo
    S.over = false; S.lastPrivSig = null; S._oppSeenVal = null; S._oppSeenAt = null;
    S.lastAppliedPub = null; S.lastOppSideBoard = null; S.lastOppVisSig = null; S.lastOppMull = null;
    S.lastRoomSides = null;
    S.lastOppSideReal = null;   // sin esto, un «Jugar otra» sin recargar podía voltear con el lado de la partida ANTERIOR
    S.evSeq = 0; S.evOut = []; S.evInApplied = 0; S.evQueue = []; S.evRunning = false;
    S.evPeerHigh = 0; S.lastEvAt = 0; S.lastFlushAt = 0; S.lastEvDoneAt = 0; S.waitSince = 0;
    S.protoWarned = false; S.mounts = 0; S.lastLagMs = null; S.lastZoneSig = null;
    S.cardIngressWarned = false; S.cardIngressRejects = 0; S.boardRescues = 0;
    S.handReq = null; S.handAnsweredSeq = null; S.pubPending = null;
    S.deckReq = null; S.deckAnsweredSeq = null; S.deckSeqN = 0; S.handSeqN = 0;
    S.hiddenDiscardReq = null; S.hiddenDiscardN = 0; S.hiddenDiscardAnsweredId = null;
    S.hiddenDiscardAnswerImages = null; S.hiddenDiscardAfterN = null;
    S.hiddenDiscardAnswerSent = false; S.hiddenDiscardPersisted = false; S.hiddenDiscardPersisting = false;
    S.hiddenDiscardOwned = null; S.hiddenDiscardReqSeqHigh = -1; S.hiddenDiscardLastDoneId = null;
    S.hiddenDiscardCauseUsed = {};
    S.resumePending = false; S.resumeRoom = null; S.privWriteChain = Promise.resolve();
    S.lastEmoteN = 0; S.lastEmoteSentAt = 0;   // emotes: dedupe de recepción + cooldown de envío
    S.oppUid = null;                            // uid del rival (para validar SUS emotes contra su proyección pública)
    if (window.PB_EMOTES) try { window.PB_EMOTES.loadMine(); } catch (e) {}   // mis stats → mi mazo de emotes
    if (S.handReqTimer) { clearTimeout(S.handReqTimer); S.handReqTimer = null; }
    if (S.deckReqTimer) { clearTimeout(S.deckReqTimer); S.deckReqTimer = null; }
    if (S.hiddenDiscardReqTimer) { clearTimeout(S.hiddenDiscardReqTimer); S.hiddenDiscardReqTimer = null; }
    if (window._pbCancelHiddenDiscard) window._pbCancelHiddenDiscard();
    if (S.flushTimer) { clearTimeout(S.flushTimer); S.flushTimer = null; }
    S.replaying = false; S.peerHasEv = false; S.latestPub = null; S.evFail = false;
    if (S.applyTimer) { clearTimeout(S.applyTimer); S.applyTimer = null; }
    S.pendingPub = null; S.lastApplyAt = 0;
    // ESTADÍSTICAS: acumulador propio a cero y marca de inicio REAL de la partida (el reloj
    // de servidor mide la vida de la SALA, que incluye lobby y espera del rival → no vale
    // para «cuánto dura una partida»).
    window._pbStatLog = []; S.matchStart = Date.now();
    // RELOJES del formato (colocación / turno / tope global). Advanced dura más que Estándar.
    var _ck = fmtClock();
    S.TURN_MS = _ck.turn; S.SETUP_MS = _ck.setup; S.MATCH_MS = _ck.match;
    S.used = { host: 0, guest: 0 };   // tiempo consumido por cada jugador (tope global)
    S.setupAt = 0; S.setupGraceAt = 0; S.oppDone = false; S.setupBase = 0; S.setupArmedAt = 0;
    if (S.setupTick) { clearInterval(S.setupTick); S.setupTick = null; }
    S.skipUntil = 0; S.wakeAt = 0;   // salto-al-estado-real tras una pausa de la pestaña
    if (window.pbSetRulesMode) try { window.pbSetRulesMode('normal'); } catch (e) {}   // PvP = modo Normal estricto
    try { document.documentElement.classList.add('pb-pvp-match'); } catch (e) {}   // gancho CSS: oculta controles de sandbox en online
    // El tablero pasa a estar «sucio» de online: al volver a él sin partida en curso
    // se limpia entero y se recupera la partida LOCAL (window._pbBoardResetAfterOnline).
    window._pbBoardOnlineDirty = true;
    // Sidebar (buscador/deck-builder): si quedó ABIERTA de antes de la partida, en online el flap
    // de cerrar está oculto → se quedaba atascada. La cerramos a la fuerza al entrar (y el CSS la
    // oculta del todo mientras dure la partida).
    try {
      var _sb = document.getElementById('sidebar'); if (_sb) _sb.classList.remove('open');
      var _ash = document.getElementById('app-shell'); if (_ash) _ash.classList.remove('sb-open');
    } catch (e) {}
    if (window.pbPresenceSetMatch) try { window.pbPresenceSetMatch(true); } catch (e) {}   // presencia: «en partida»
  };
  window._pvpMatchEnd = function () {
    if (window.pbPresenceSetMatch) try { window.pbPresenceSetMatch(false); } catch (e) {}
    try { document.documentElement.classList.remove('pb-pvp-match'); } catch (e) {}
    window._pbNamesLocked = false;
    S.active = false; S.code = null; S.role = null; S.seq = 0; S.lastPubSig = null;
    S.sideSeq = 0; S.oppSideSeq = 0; S.readySent = false; S.placementReleased = false;
    S.lastSideSig = null; S.over = false; S.lastPrivSig = null;
    if (typeof stopHeartbeat === 'function') stopHeartbeat();
    if (typeof stopWatchdog === 'function') stopWatchdog();
    if (typeof clearTurnTimer === 'function') clearTurnTimer();
    if (typeof disarmFastPublish === 'function') disarmFastPublish();
    if (S.applyTimer) { clearTimeout(S.applyTimer); S.applyTimer = null; }
    if (S.flushTimer) { clearTimeout(S.flushTimer); S.flushTimer = null; }
    if (S.hiddenDiscardReqTimer) { clearTimeout(S.hiddenDiscardReqTimer); S.hiddenDiscardReqTimer = null; }
    S.hiddenDiscardReq = null; S.hiddenDiscardOwned = null; S.resumePending = false; S.resumeRoom = null;
    S.hiddenDiscardAnsweredId = null; S.hiddenDiscardAnswerImages = null; S.hiddenDiscardAfterN = null;
    S.hiddenDiscardAnswerSent = false; S.hiddenDiscardPersisted = false; S.hiddenDiscardPersisting = false;
    S.hiddenDiscardCauseUsed = {};
    if (window._pbCancelHiddenDiscard) window._pbCancelHiddenDiscard();
    S.pendingPub = null;
    S.afkCount = 0;
    ['pvp-opts-btn', 'pvp-opts-menu', 'pvp-emote-btn', 'pvp-emote-menu'].forEach(function (id) { var e = document.getElementById(id); if (e) e.remove(); });
    document.querySelectorAll('.pvp-emote-bubble').forEach(function (b) { b.remove(); });
    var rc = document.getElementById('pvp-reconnecting'); if (rc) rc.remove();
    // SANEAR EL TABLERO YA, no al navegar. La partida online se pinta sobre el tablero REAL
    // (capa permanente) y el saneo vive en switchAppTab('board') → asume que sales del tablero
    // y vuelves. Pero el online se juega ESTANDO en esa pestaña, así que las salidas que solo
    // levantan el telón («Jugar otra» → «Cancelar», ✕, reconexión fallida) descubrían la
    // posición final de la partida online ya sin el candado del online = una «partida local»
    // que nadie empezó (⋯ con Vaciar el tablero / Nueva partida). Aquí la sesión ya está
    // cerrada, que es justo cuando ese tablero deja de ser del online.
    if (window._pbBoardResetAfterOnline) { try { window._pbBoardResetAfterOnline(); } catch (e) {} }
    // Devolver los botones de esquina del tablero LOCAL (⋯ + Deshacer): al entrar en la partida
    // se DESMONTAN (los manda el online) y, si se sale sin cambiar de pestaña —«Jugar otra» →
    // «Cancelar», o una reconexión fallida—, el tablero se quedaba sin ellos hasta navegar.
    if (window._pbSyncBoardCorner) { try { window._pbSyncBoardCorner(); } catch (e) {} }
  };

  // ═══ ARRANQUE DE PARTIDA (T2a-2) ═══
  function cssImg(u) { return 'url("' + (window.localizeImg ? window.localizeImg(u) : u) + '")'; }

  // Cada cliente arranca SU lado en local (p1 = yo, siempre abajo): carga el mazo,
  // baraja y roba con la lógica REAL (modelo reemplazo), y entra en colocación
  // reutilizando el camino de «reanudar colocación» del restore. El lado rival se
  // puebla por los pubs de lado que lleguen.
  window._pvpStartMatch = function (code, role, room, myDeck, opts) {
    opts = opts || {};
    window._pvpMatchBegin(code, role);
    // Nombres de jugador = cuentas (p1=yo, p2=rival), no editables durante la partida.
    try {
      var _me = room && room[role], _op = room && room[role === 'host' ? 'guest' : 'host'];
      if (window._pbSetMatchNames) window._pbSetMatchNames((_me && _me.name) || 'Tú', (_op && _op.name) || 'Rival');
    } catch (e) {}
    S.mode = (room && room.mode) || 'standard';   // 'draft' si vino del draft → ladders/ELO por formato
    var meFirst = room && room.coin === role;
    var first = meFirst ? 'p1' : 'p2';
    // preparar cola local del builder para el predraw real
    var cards = [];
    try { cards = JSON.parse(JSON.stringify((myDeck && myDeck.cards) || [])); } catch (e) {}
    window._pvpClearBoard && window._pvpClearBoard();
    if (window.deckQueues) {
      window.deckQueues.p1.length = 0;
      cards.forEach(function (c) { window.deckQueues.p1.push(c); });
      window.deckQueues.p2.length = 0;
    }
    var hand = (window._predrawInitialHand && window._predrawInitialHand('p1')) || [];
    var queue = ((window.deckPlayQueues || {}).p1 || []).slice();
    var energy = (myDeck && myDeck.energyTypes && myDeck.energyTypes.length)
      ? myDeck.energyTypes
      : (window.inferDeckEnergies ? window.inferDeckEnergies(cards) : []);
    // Tipos de energía del RIVAL desde el lobby (públicos): sin esto su próxima-energía
    // espejo no se podía prever y su zona quedaba muerta en este cliente.
    var oppInfo = (room && room[role === 'host' ? 'guest' : 'host']) || {};
    var oppEnergy = (oppInfo.deck && oppInfo.deck.energyTypes) || [];
    var payload = {
      ts: 0,
      decks: { p1: { cards: cards, energyTypes: energy }, p2: { cards: [], energyTypes: oppEnergy } },
      playQueues: { p1: queue, p2: [] },
      discard: { p1: [], p2: [] },
      board: { p1: [], p2: [] },
      stadiums: { p1: null, p2: null },
      energyZone: { p1: null, p2: null },
      hands: { p1: [], p2: [] },   // el reparto ANIMADO va DESPUÉS de la moneda
      log: [], turnState: {},
      game: { started: false, placement: true, firstPlayer: first, turn: first, turnNum: 0,
              ownerTurns: { p1: 0, p2: 0 }, scores: { p1: 0, p2: 0 }, gameOver: null }
    };
    S.applying = true;   // el restore inicial no debe re-publicar a medias
    try { window._pvpRestoreState(payload); }
    finally {
      setTimeout(function () {
        S.applying = false;
        publishSide();
        writePriv(null);
        ensureSurrenderBtn();
        startHeartbeat();
        armFastPublish();
        startWatchdog();
        paintDbg();
      }, 450);
    }
    // SECUENCIA DE INICIO (pedida por Daniel): moneda compartida → reparto con la
    // animación REAL de robar → colocar (ambos pueden pulsar «Empezar» cuando coloquen).
    var deal = function () {
      try { window.drawInitialHand && window.drawInitialHand('p1', { predrawn: hand }); } catch (e) {}
      // El reloj de colocación arranca con la mano YA repartida (no durante la moneda ni el
      // reparto): si no, el jugador vería correr su tiempo sin poder tocar nada.
      setTimeout(function () { armSetupTimer(); }, 2600);
    };
    // El VS (pvp.js) conduce la moneda a pantalla completa y llama al reparto DESPUÉS:
    // con deferCoin NO tiramos la moneda aquí, solo exponemos el reparto para que lo
    // dispare al terminar la pantalla VS.
    window._pvpRunDeal = deal;
    if (opts.deferCoin) return;
    if (window._pbCoinCeremony) {
      try { window._pbCoinCeremony(first, deal); } catch (e) { deal(); }
    } else deal();
  };

  // ── Colocación simultánea: publicar/aplicar SOLO mi lado ──
  function sideFromPayload(p) {
    return {
      board: toLogical((p.board && p.board.p1) || [], 'p1'),
      discard: (p.discard && p.discard.p1) || [],
      handN: ((p.hands || {}).p1 || []).length,
      deckN: ((p.playQueues || {}).p1 || []).length,
      energyTypes: (p.decks && p.decks.p1 && p.decks.p1.energyTypes) || [],
      energyZone: (p.energyZone && p.energyZone.p1) || null,
      // Mulligan del formato: solo el CONTADOR. Rebarajar no cambia mis conteos (6 y 24
      // antes y después), así que el rival no se enteraría por el estado; con esto su
      // cliente sabe que puede ofrecerle su carta extra (que decide ÉL).
      mull: (window._pbMulligans && window._pbMulligans.p1) || 0
    };
  }
  function publishSide(markDone) {
    if (!S.active) return;
    var r = window.pbPvp;
    if (!r || !S.code) return;
    var local = window._pvpBuildPayload ? window._pvpBuildPayload() : null;
    if (!local) return;
    var side = sideFromPayload(local);
    if (markDone) S.readySent = true;
    side.done = !!(S.readySent);
    var sig;
    try { sig = JSON.stringify(side); } catch (e) { sig = null; }
    if (sig && sig === S.lastSideSig) return;
    S.lastSideSig = sig;
    S.sideSeq += 1;
    side.seq = S.sideSeq;
    var patch = { sides: {} };
    patch.sides[S.role] = side;
    r.set(S.code, patch).catch(function (e) { console.warn('[pvp-sync] side', (e && e.code) || e); });
  }
  // Actualización LIGERA del lado del rival (p2) durante la COLOCACIÓN, SIN re-montar el
  // tablero. El re-montaje (clearBoard+restore) re-crea TODAS las cartas (p1 y p2) = el
  // «refresh» que ve el rival en cada acción. Durante la colocación el rival se ve BOCABAJO
  // (dorsos idénticos), así que basta con añadir/quitar dorsos en sus huecos y ajustar el nº
  // de su mano/mazo — nada más se re-crea → cero parpadeo. Devuelve false si la zona no está
  // lista → el caller cae al re-montaje completo.
  function applyMirrorLight(displayBoard, side) {
    if (!window.createCard) return false;
    var slots = document.querySelectorAll('#zone-p2 .pokemon-slot');
    if (!slots.length || !slotMap('p2')) return false;
    var domBoard = toDom(displayBoard || [], 'p2');
    var back = 'url("' + (window.CARD_BACK_IMG || '') + '")';
    for (var i = 0; i < slots.length; i++) {
      var want = domBoard[i];                       // dorso o null
      var have = slots[i].querySelector('.card');
      if (want && !have) {
        var c = window.createCard('');
        c.style.backgroundImage = back;
        c.dataset.cardType = 'pokemon';
        c.style.cssText += ';position:absolute;left:0;top:0;z-index:1;';
        slots[i].appendChild(c);
      } else if (!want && have) {
        have.remove();
      }
      // ambos con carta o ambos vacíos → NO se toca (dorsos idénticos = sin cambio visual)
    }
    // mano del rival = N dorsos (ajustar el número; los existentes NO se re-crean)
    var handEl = document.getElementById('hand-p2');
    if (handEl) {
      var cards = Array.prototype.slice.call(handEl.querySelectorAll('.card'));
      var wantN = side.handN || 0;
      if (cards.length !== wantN) {
        if (cards.length > wantN) { for (var k = cards.length - 1; k >= wantN; k--) cards[k].remove(); }
        else { for (var k2 = cards.length; k2 < wantN; k2++) { var hc = window.createCard(''); hc.style.backgroundImage = back; handEl.appendChild(hc); } }
        if (window.layoutFan) window.layoutFan(handEl);
      }
    }
    // contador del mazo del rival
    if (window.deckPlayQueues) {
      window.deckPlayQueues.p2 = [];
      for (var j = 0; j < (side.deckN || 0); j++) window.deckPlayQueues.p2.push({ image: window.CARD_BACK_IMG || '', name: '' });
    }
    if (window.refreshDeckBadge) window.refreshDeckBadge('p2');
    return true;
  }
  function applyOppSide(side, force) {
    if (!side || !window._pvpBuildPayload) return;
    side = canonicalIncomingSide(side);
    if (!side) { rejectIncomingCards('side/apply'); return; }
    // El rival ha rebarajado su mano inicial → me toca decidir si robo la carta extra.
    // Va ANTES del early-return: un mulligan no cambia su firma visual (mismos conteos).
    var _mull = side.mull || 0;
    if (S.lastOppMull == null) S.lastOppMull = _mull;
    else if (_mull > S.lastOppMull) {
      var _extra = _mull - S.lastOppMull;
      S.lastOppMull = _mull;
      // NO se ofrece aquí: se acumula y se pregunta al EMPEZAR (los dos listos) → la carta
      // extra no puede usarse para decidir la colocación.
      window._pbExtraDraw = window._pbExtraDraw || { p1: 0, p2: 0 };
      window._pbExtraDraw.p1 = (window._pbExtraDraw.p1 || 0) + _extra;
    }
    // «Listo» solo cambia el flag done → NADA visual cambió → no re-montar (el
    // re-montaje hacía «moverse» las cartas de ambos al marcar listo).
    var visSig;
    try { visSig = JSON.stringify({ b: side.board, d: side.discard, h: side.handN, n: side.deckN, e: side.energyZone }); } catch (e) { visSig = null; }
    if (!force && visSig && visSig === S.lastOppVisSig) {
      if (!S.placementReleased) S.lastOppSideReal = JSON.parse(JSON.stringify(side));
      return;
    }
    S.lastOppVisSig = visSig;
    S.applying = true;
    // cues de colocación: cartas que APARECEN en el lado rival respecto al último lado visto
    var prevB = S.lastOppSideBoard || [];
    var appeared = [];
    (side.board || []).forEach(function (d, i) { if (d && !prevB[i]) appeared.push(i); });
    S.lastOppSideBoard = JSON.parse(JSON.stringify(side.board || []));
    // Durante la colocación, las cartas del rival se ven BOCABAJO (como en Pocket: la
    // colocación es oculta hasta que ambos están listos). El dato REAL se guarda para
    // el VOLTEO al liberar (S.lastOppSideReal).
    var boardForDisplay = side.board || [];
    if (!S.placementReleased) {
      S.lastOppSideReal = JSON.parse(JSON.stringify(side));
      var back = 'url("' + (window.CARD_BACK_IMG || '') + '")';
      boardForDisplay = (side.board || []).map(function (d) {
        if (!d) return null;
        var c = JSON.parse(JSON.stringify(d));
        c.img = back;
        c.hpMax = ''; c.hpCur = '';   // sin PS visibles en un dorso
        c.evoStack = []; c.tool = null;
        return c;
      });
    }
    // COLOCACIÓN: actualización LIGERA del lado del rival (dorsos), SIN re-montar el tablero
    // → NADA se re-crea salvo el dorso que aparece/desaparece (ni mi lado ni el suyo «salta»).
    // Es la causa del «refresh». El REVELADO (force) sí re-monta para enseñar sus cartas.
    if (!force && !S.placementReleased && applyMirrorLight(boardForDisplay, side)) {
      if (appeared.length && appeared.length <= 4) {
        requestAnimationFrame(function () {
          var reduce = window.pbFx && window.pbFx('reduceMotion');
          if (reduce) return;
          appeared.forEach(function (idx, k) { setTimeout(function () { cueEnter('p2', idx, 'cardGrab'); }, 110 * k); });
        });
      }
      setTimeout(function () { S.applying = false; }, 200);
      return;
    }
    // REVELADO / fallback: re-montaje completo. Preservar MIS cartas (p1: mano + tablero) para
    // que no «salten» (mismos nodos). buildPayload lee del DOM → con p1 detachado el restore no
    // lo re-crea (solo re-monta el lado del rival).
    var _keep = { hand: [], board: [] };
    var _h1el = document.getElementById('hand-p1');
    if (_h1el) _keep.hand = Array.prototype.slice.call(_h1el.querySelectorAll('.card'));
    document.querySelectorAll('#zone-p1 .pokemon-slot').forEach(function (slot) {
      var card = slot.querySelector('.card');   // la carta REAL (puede estar dentro de un wrapper de animación)
      if (card) _keep.board.push({ slot: slot, card: card });
    });
    _keep.hand.forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    _keep.board.forEach(function (x) {
      var wrap = x.card.parentNode;
      if (wrap) wrap.removeChild(x.card);
      if (wrap && wrap !== x.slot && !wrap.querySelector('.card') && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });
    try {
      var p = window._pvpBuildPayload();
      p.board.p2 = toDom(boardForDisplay, 'p2');
      localizeBoardArr(p.board.p2);
      p.discard.p2 = (side.discard || []).map(locRaw);
      p.hands.p2 = dorsoHand(side.handN || 0);
      p.playQueues.p2 = dummyQueue(side.deckN || 0);
      p.decks.p2 = { cards: [], energyTypes: side.energyTypes || [] };
      p.energyZone.p2 = side.energyZone || null;
      window._pvpClearBoard();
      window._pvpRestoreState(p);
    } finally {
      _keep.board.forEach(function (x) { if (x.slot && x.card) x.slot.appendChild(x.card); });
      if (_keep.hand.length) {
        var _h1b = document.getElementById('hand-p1');
        if (_h1b) {
          _keep.hand.forEach(function (c) { _h1b.appendChild(c); });
          if (window.layoutFan) window.layoutFan(_h1b);
        }
      }
      setTimeout(function () { S.applying = false; }, 400);
    }
    if (appeared.length && appeared.length <= 4) {
      requestAnimationFrame(function () {
        var reduce = window.pbFx && window.pbFx('reduceMotion');
        if (reduce) return;
        appeared.forEach(function (idx, k) {
          setTimeout(function () { cueEnter('p2', idx, 'cardGrab'); }, 110 * k);
        });
      });
    }
  }

  // «Empezar» local durante la colocación PvP: marca LISTO y se retiene hasta que
  // ambos lados estén done (main.js consulta este hook al inicio de _exitPlacementPhase).
  window._pvpHoldPlacementExit = function () {
    if (!S.active) return false;
    if (S.placementReleased) return false;
    publishSide(true);
    return true;
  };
  function maybeReleasePlacement(room) {
    if (S.placementReleased) return;
    var h = room.sides && room.sides.host, g = room.sides && room.sides.guest;
    if (h && h.done && g && g.done) {
      S.placementReleased = true;
      clearSetupTimer();
      // SECUENCIA pedida por Daniel: ambos listos → pausa breve → REVELAR los bocabajo
      // (volteo) → y ENTONCES empezar (salida de colocación + robo del jugador en turno).
      // EL LADO DEL RIVAL SALE DE **ESTE** SNAPSHOT, no de lo que se llegó a aplicar.
      // `S.lastOppSideReal` solo tiene lo que pasó por applyOppSide, y el apply corre DESPUÉS
      // de esta liberación (y se lo salta en cuanto placementReleased está puesto). Los
      // snapshots de Firestore son FOTOS del estado, no un log de cambios: si los intermedios
      // se agrupan o se pierden (hipo de red, pestaña dormida, poll en vez de watch), el
      // primero que veo ya trae board + done → sin esto su lado se queda VACÍO para el resto
      // de la partida. Y como mi pub es AUTORITATIVO sobre todo el tablero, al jugar le
      // borraría su Activo de verdad (bug de Daniel: «mi Pokémon activo desaparece»).
      var _ok = S.role === 'host' ? 'guest' : 'host', _appliedSeq = 0;
      var real = (room.sides && room.sides[_ok]) || S.lastOppSideReal;
      S.lastOppSideReal = null;
      setTimeout(function () {
        if (!S.active || S.over) return;
        // El volteo va 800 ms después de liberar, y en ese hueco puede haber llegado un lado
        // más nuevo: colocar DESPUÉS de pulsar «Empezar» está permitido (la salida se retiene
        // hasta que ambos están listos), y ese último `side` llegaría ya con la colocación
        // liberada, cuando nadie lo aplica.
        var _fresh = S.lastRoomSides && S.lastRoomSides[_ok];
        if (_fresh && (!real || (_fresh.seq || 0) >= (real.seq || 0))) real = _fresh;
        _appliedSeq = (real && real.seq) || 0;
        if (real) {
          applyOppSide(real, true);   // force: la firma visual coincide con los datos ya vistos
          requestAnimationFrame(function () {
            var reduce = window.pbFx && window.pbFx('reduceMotion');
            if (window.playSound) window.playSound('cardsBack');
            if (reduce) return;
            document.querySelectorAll('#zone-p2 .pokemon-slot .card').forEach(function (c, k) {
              try {
                c.animate([
                  { transform: 'rotateY(88deg)', opacity: 0.85 },
                  { transform: 'rotateY(0deg)', opacity: 1 }
                ], { duration: 460, delay: 120 * k, easing: 'cubic-bezier(0.3,0.9,0.4,1)', fill: 'backwards' });
              } catch (e) {}
            });
          });
        }
        setTimeout(function () {
          if (!S.active || S.over) return;
          // ÚLTIMO REPASO antes de congelar su lado: la salida se retiene hasta que ambos
          // están listos, así que el rival puede seguir colocando ~2,3 s DESPUÉS de pulsar
          // «Empezar» — y ese `side` llega ya con la colocación liberada, cuando el gate de
          // _pvpOnRoom no lo aplica. Sin esto su banca de última hora no entra en mi espejo
          // y, al ser yo actor, mi pub se la borraría de su tablero real.
          var _late = S.lastRoomSides && S.lastRoomSides[_ok];
          if (_late && (_late.seq || 0) > _appliedSeq) { _appliedSeq = _late.seq || 0; applyOppSide(_late, true); }
          window._exitPlacementPhase && window._exitPlacementPhase();
          // El primer turno ya está servido: sin esto, un pub con turnNum 0 (reconexión rara)
          // casaría con el bloque de «turn-became-mine» y dispararía un segundo barrido y un
          // robo duplicado.
          if (S.lastDrawTurn == null || S.lastDrawTurn < 0) S.lastDrawTurn = 0;
          setTimeout(function () {
            var mine = window.activeTurn === 'p1';
            if (mine) S.actorNow = true;   // primer jugador: actor desde YA (mismo agujero que el turn-became-mine: un endTurn inmediato caía mudo)
            // El reloj arranca cuando se puede jugar, no durante el barrido de bienvenida
            // (si no, el primer turno empieza con ~1 s menos).
            if (window.pbTurnFx) window.pbTurnFx.after(function () { startTurnTimer(mine); });
            else startTurnTimer(mine);
          }, 500);
        }, real ? 1500 : 250);
      }, 800);
    }
  }
  window._pvpSyncState = function () { return S; };

  // Gate de manejo (lo consulta _canHandleCard de main.js): en partida PvP nunca
  // puedes tocar cartas del lado rival (p2 local), ni siquiera en su turno.
  window._pvpGate = function (card, owner) {
    if (!S.active) return true;
    if (owner === 'p2') return false;
    // COLOCACIÓN CERRADA al confirmar: el `side` que publica «Empezar» es el que el rival
    // congela en su espejo, y la salida se retiene hasta que él también esté listo. Lo que
    // se coloque en ese hueco ya no viaja (mi settle cae fuera de la fase y, no siendo actor,
    // no publica) → su pub, que es autoritativo, me lo borraría. Antes se aceptaba la carta
    // y luego se perdía en silencio; ahora no se deja, como en Pocket: confirmas y esperas.
    // (la ventana va desde «Empezar» hasta que la partida arranca de verdad: la liberación
    //  llega antes que la salida efectiva de la fase, y en ese hueco aún se podía colocar)
    if (S.readySent && !window._pbGameStarted) return false;
    return true;
  };
  // Motivo del bloqueo, para que el aviso del tablero no diga «no es tu turno» cuando lo que
  // pasa es que ya has confirmado la colocación.
  window._pvpBlockReason = function () {
    if (S.active && S.readySent && !window._pbGameStarted) return 'rules.setupLocked';
    return null;
  };

  // ═══ KO → PROMOCIÓN DELEGADA (T2b-2) ═══
  // La maquinaria de promoción (contadores, turno diferido, robo diferido) vive INTACTA
  // en el cliente del ATACANTE; el defensor solo ELIGE el hueco en su pantalla y la
  // elección vuelve como click inyectado (e._pvpInject) sobre la banca espejo.
  function forcePublish(extra) {
    if (!S.active) return;
    var r = window.pbPvp;
    if (!r || !S.code || !window._pvpBuildPayload) return;
    var pub = pubFromPayload(window._pvpBuildPayload());
    if (!pub) return;
    if (extra) for (var k in extra) pub[k] = extra[k];
    S.seq += 1;
    S.lastPubSig = null;   // el próximo settle re-publica el estado final sin dedupe contra este
    r.update(S.code, { pub: pub, seq: S.seq, pubBy: S.role })
      .catch(function (e) { console.warn('[pvp-sync] force', (e && e.code) || e); });
  }
  // El selector de promoción se armó en MI cliente. Si es para p2 (el rival), publico el
  // estado pendiente para que ÉL elija en su pantalla.
  window._pvpOnPromoteArmed = function (player) {
    if (!S.active || player !== 'p2') return;
    // Solo el ACTOR publica el pendiente: en el cliente no-actor, el arming del lado espejo
    // viene de un replay de KO (recoil del rival) y la elección la hace ÉL en su pantalla.
    if (window.activeTurn !== 'p1') return;
    forcePublish({ pending: 'promote' });
  };
  // ── REVELAR LA MANO DEL RIVAL (Mega Absol ex y familia) ──
  // Su mano nunca viaja (info oculta), pero este efecto la hace PÚBLICA por regla. El
  // atacante pide la mano; el cliente del rival la publica; el atacante la ve DE VERDAD y
  // elige; la elección vuelve y la carta la quita SU dueño (que es quien la tiene).
  window._pvpRequestOppHand = function (opp, op, onDone) {
    if (!S.active || S.over || opp !== 'p2') return false;   // solo pido la del espejo
    if (window.activeTurn !== 'p1') return false;            // solo el actor pide
    S.handSeqN = (S.handSeqN || 0) + 1;   // contador propio: ver la nota de deckSeqN (la 2.ª petición de la partida cogía la respuesta vieja)
    S.handReq = { op: op, onDone: onDone, seq: S.handSeqN };
    var reqPub = { pending: 'revealHand', revealSeq: S.handReq.seq };
    // Smeargle «Retrato» / Mew ex «Memoria Milagrosa»: su texto NO revela la mano, solo saca
    // 1 carta al azar. El sorteo lo hace su DUEÑO y devuelve únicamente esa → no viaja el resto.
    if (op && op.action === 'pickRandom') { reqPub.revealPick = String(op.pick || ''); reqPub.revealScope = String(op.scope || 'hand'); }
    forcePublish(reqPub);
    // NUNCA bloquear: el ataque queda esperando esta respuesta (de ella cuelgan el KO y el
    // fin de turno). Si el rival no contesta (caída/pestaña dormida), seguimos sin el efecto.
    if (S.handReqTimer) clearTimeout(S.handReqTimer);
    S.handReqTimer = setTimeout(function () {
      S.handReqTimer = null;
      if (!S.handReq) return;
      var req = S.handReq; S.handReq = null;
      if (req.onDone) req.onDone();
    }, 12000);
    return true;   // el flujo del ataque queda esperando la respuesta
  };
  // ¿Hay una petición de mano en vuelo? Entre pedirla y recibirla no hay overlay abierto,
  // así que sin esto un checkpoint podría caer a mitad de la jugada (Emma jugada, robo aún no).
  window._pvpHandReqActive = function () { return !!(S.active && S.handReq); };
  // ── CONTAR CARTAS DEL MAZO DEL RIVAL (Porygon-Z «Cyberjack») ──
  // Su mazo NUNCA viaja (es info oculta: solo viaja `deckN`, el total), así que el atacante
  // no puede contar sus Entrenadores — contaba 0 y el ataque hacía solo el daño impreso.
  // Este ataque hace ese NÚMERO público por regla, así que se le pide al rival cuando la
  // carta se juega (y solo entonces): él cuenta SU cola real y responde un número pelado,
  // sin identidades. Mismo patrón que la mano de Mega Absol.
  window._pvpRequestDeckCount = function (opp, what, onDone) {
    if (!S.active || S.over || opp !== 'p2') return false;   // solo pido la del espejo
    if (window.activeTurn !== 'p1') return false;            // solo el actor pide
    // OJO: el contador vive FUERA de S.deckReq — la petición se pone a null al resolverse, así
    // que un `(S.deckReq ? … : 0) + 1` volvería a empezar en 1 y la 2.ª petición de la partida
    // se comería la RESPUESTA VIEJA que sigue en la sala (mismo seq).
    S.deckSeqN = (S.deckSeqN || 0) + 1;
    S.deckReq = { what: what, onDone: onDone, seq: S.deckSeqN };
    forcePublish({ pending: 'deckCount', deckSeq: S.deckReq.seq, deckWhat: what });
    // NUNCA bloquear: si el rival no contesta (caída/pestaña dormida), el ataque sigue sin
    // el bono en vez de dejar la partida colgada.
    if (S.deckReqTimer) clearTimeout(S.deckReqTimer);
    S.deckReqTimer = setTimeout(function () {
      S.deckReqTimer = null;
      if (!S.deckReq) return;
      var req = S.deckReq; S.deckReq = null;
      if (req.onDone) req.onDone(null);
      // 6s, no los 12 de la mano: aquí lo que espera es el DAÑO del ataque (un rival con la
      // página vieja no entiende la petición y no contestará nunca → no congelar la partida).
    }, 6000);
    return true;   // el flujo del ataque queda esperando la respuesta
  };
  // Lado del RIVAL: me piden cuántas cartas de X me quedan en el mazo → respondo el número.
  function answerDeckCount(room) {
    var pub = room.pub;
    if (!pub || pub.pending !== 'deckCount' || !room.pubBy || room.pubBy === S.role) return;
    if (S.deckAnsweredSeq === pub.deckSeq) return;
    S.deckAnsweredSeq = pub.deckSeq;
    var n = (window._pbMyDeckCount && window._pbMyDeckCount(pub.deckWhat)) || 0;
    var r = window.pbPvp;
    if (r && S.code) r.set(S.code, { deckCount: { seq: pub.deckSeq, by: S.role, n: n } }).catch(function () {});
  }
  // Lado del ATACANTE: llega el número → el ataque continúa con él.
  function onDeckCounted(room) {
    var dc = room.deckCount;
    if (!dc || !S.deckReq || dc.seq !== S.deckReq.seq || dc.by === S.role) return;
    var req = S.deckReq; S.deckReq = null;
    if (S.deckReqTimer) { clearTimeout(S.deckReqTimer); S.deckReqTimer = null; }
    if (req.onDone) req.onDone(typeof dc.n === 'number' ? dc.n : null);
  }
  // ── DESCARTAR DEL MAZO/MANO OCULTOS DEL RIVAL ──
  // El espejo solo tiene dorsos. La operación se delega al propietario de la zona, que
  // quita las cartas reales y devuelve exclusivamente sus imágenes DESPUÉS de hacerse
  // públicas en el descarte. Sirve a Chandelure y a todas las ops equivalentes.
  function cleanHiddenDiscardSpec(spec) {
    // Frontera de confianza: NO coercionar. Estas son exactamente las cuatro formas que
    // existen en los datos actuales. Coalossal puede encadenar hasta el mazo entero, por
    // eso deck admite 1..30; mano aleatoria/filtrada siempre es 1 y Nasty Notice deja 4.
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return null;
    var keys = Object.keys(spec).sort().join(',');
    if (spec.source === 'deck') {
      if (keys !== 'count,source' || !Number.isInteger(spec.count) || spec.count < 1 || spec.count > 30) return null;
      return { source: 'deck', count: spec.count };
    }
    if (spec.source !== 'hand') return null;
    if (keys === 'source,toN' && spec.toN === 4) return { source: 'hand', toN: 4 };
    if (keys === 'count,source' && spec.count === 1) return { source: 'hand', count: 1 };
    if (keys === 'cardType,count,source' && spec.count === 1 && (spec.cardType === 'item' || spec.cardType === 'tool')) {
      return { source: 'hand', count: 1, cardType: spec.cardType };
    }
    // «Revela una carta al azar de tu mano y barájala en tu mazo»: la carta no sale del juego,
    // vuelve a su propio mazo. Tope 3 = las 3 monedas de Krookodile, el máximo que existe.
    if (keys === 'count,dest,source' && spec.dest === 'deck' &&
        Number.isInteger(spec.count) && spec.count >= 1 && spec.count <= 3) {
      return { source: 'hand', count: spec.count, dest: 'deck' };
    }
    return null;
  }
  function cleanHiddenDiscardKind(kind) {
    return kind === 'attack' || kind === 'ability' || kind === 'trainer' ? kind : '';
  }
  function cleanHiddenDiscardCause(cause) {
    if (!cause || typeof cause !== 'object' || Array.isArray(cause)) return null;
    var allowed = { cardId: 1, effectKind: 1, effectName: 1, opIndex: 1,
      sourceCardId: 1, actorUid: 1, turn: 1, logIndex: 1 };
    var keys = Object.keys(cause);
    if (keys.some(function (k) { return !allowed[k]; })) return null;
    if (typeof cause.cardId !== 'string' || !cause.cardId || cause.cardId.length > 32) return null;
    if (!cleanHiddenDiscardKind(cause.effectKind)) return null;
    if (typeof cause.effectName !== 'string' || !cause.effectName || cause.effectName.length > 128) return null;
    if (!Number.isInteger(cause.opIndex) || cause.opIndex < 0 || cause.opIndex > 63) return null;
    if (!Number.isInteger(cause.turn) || cause.turn < 0 || cause.turn > 10000) return null;
    var out = { cardId: cause.cardId, effectKind: cause.effectKind,
      effectName: cause.effectName, opIndex: cause.opIndex, turn: cause.turn };
    if (cause.sourceCardId != null) {
      if (typeof cause.sourceCardId !== 'string' || !cause.sourceCardId || cause.sourceCardId.length > 32) return null;
      out.sourceCardId = cause.sourceCardId;
    }
    if (cause.actorUid != null) {
      if (typeof cause.actorUid !== 'string' || !cause.actorUid || cause.actorUid.length > 96) return null;
      out.actorUid = cause.actorUid;
    }
    if (cause.logIndex != null) {
      if (!Number.isInteger(cause.logIndex) || cause.logIndex < 0 || cause.logIndex > 199) return null;
      out.logIndex = cause.logIndex;
    }
    if ((out.effectKind === 'attack' || out.effectKind === 'ability') && !out.actorUid) return null;
    if (out.effectKind === 'trainer' && out.logIndex == null) return null;
    return out;
  }
  function sameHiddenDiscardSpec(a, b) {
    if (!a || !b || a.source !== b.source) return false;
    return (a.count == null ? null : a.count) === (b.count == null ? null : b.count) &&
      (a.toN == null ? null : a.toN) === (b.toN == null ? null : b.toN) &&
      (a.cardType || '') === (b.cardType || '') &&
      (a.dest || 'discard') === (b.dest || 'discard');
  }
  function hiddenPubCardId(d) { var db = d && incomingCardDb(d.img); return (db && db.id) || ''; }
  function hiddenBoardHasId(list, id, from) {
    list = Array.isArray(list) ? list : [];
    for (var i = from || 0; i < list.length; i++) if (hiddenPubCardId(list[i]) === id) return true;
    return false;
  }
  function hiddenAttackSourceAllowed(pub, cause, active) {
    var sourceId = cause.sourceCardId || cause.cardId;
    if (sourceId === cause.cardId) return true;
    // Time Recall / Memory Light: la fuente es una preevolución pública de ESTE activo.
    if ((active.evoStack || []).some(function (e) { var db = e && incomingCardDb(e.image); return db && db.id === sourceId; })) return true;
    // Ataques copiados: el atacante canónico debe tener una op copyAttack y la carta fuente
    // tiene que estar en la zona PÚBLICA que esa op permite.
    var ownFx = window.CARD_EFFECTS && window.CARD_EFFECTS[cause.cardId];
    var copyOps = [];
    Object.keys(ownFx || {}).forEach(function (name) {
      ((ownFx[name] && ownFx[name].ops) || []).forEach(function (op) { if (op.op === 'copyAttack') copyOps.push(op); });
    });
    return copyOps.some(function (op) {
      if (op.source === 'oppActive') return hiddenPubCardId(((pub.board || {}).p2 || [])[0]) === sourceId;
      if (op.source === 'oppAny') return hiddenBoardHasId((pub.board || {}).p2, sourceId, 0);
      if (op.source === 'selfBench') return hiddenBoardHasId((pub.board || {}).p1, sourceId, 1);
      return false;   // fuente oculta/aleatoria: no hay prueba pública suficiente para delegar
    });
  }
  function hiddenCoinProof(room, pub, op, wanted) {
    if (!Array.isArray(room.ev) || room.evBy !== room.pubBy || !Number.isInteger(pub.evAt)) return false;
    var best = null;
    room.ev.forEach(function (e) {
      if (!e || e.t !== 'coins' || !Number.isInteger(e.q) || e.q > pub.evAt) return;
      if (!best || e.q > best.q) best = e;
    });
    if (!best || pub.evAt - best.q > 4 || !Number.isInteger(best.h) || !Number.isInteger(best.tl)) return false;
    if (op.untilTails) return best.u === true && best.h === wanted && best.tl === 1;
    if (op.coin === 'heads' || op.coin === true) return best.u !== true && best.h === 1 && best.tl === 0;
    return true;
  }
  // El propietario NO ejecuta la spec enviada. Resuelve la op desde los datos instalados,
  // comprueba que su carta causal está en el estado público correcto y DERIVA la única spec
  // que esa acción puede producir.
  function deriveHiddenDiscardSpec(room, cause) {
    var pub = room && room.pub;
    if (!pub || !cause || pub.pov !== room.pubBy || !pub.game || pub.game.turn !== 'p1' || pub.game.turnNum !== cause.turn) return null;
    var effect = null, op = null, active = ((pub.board || {}).p1 || [])[0] || null;
    if (cause.effectKind === 'attack') {
      if (!active || hiddenPubCardId(active) !== cause.cardId || (active.state || {})._uid !== cause.actorUid) return null;
      if (!hiddenAttackSourceAllowed(pub, cause, active)) return null;
      var attackId = cause.sourceCardId || cause.cardId;
      effect = window.CARD_EFFECTS && window.CARD_EFFECTS[attackId] && window.CARD_EFFECTS[attackId][cause.effectName];
      if (cause.logIndex != null) {
        var al = (pub.log || [])[cause.logIndex], am = al && al.meta || {};
        if (!al || al.turn !== cause.turn || al.player !== 'p1' || am.kind !== 'attack' || am.attack !== cause.effectName || am.card !== cause.actorUid) return null;
      }
    } else if (cause.effectKind === 'ability') {
      var actor = null;
      ((pub.board || {}).p1 || []).some(function (d) {
        if (d && hiddenPubCardId(d) === cause.cardId && (d.state || {})._uid === cause.actorUid) { actor = d; return true; }
        return false;
      });
      if (!actor || (actor.state || {})._abilityUsedTurn !== cause.turn) return null;
      var abs = (window.CARD_ABILITIES && window.CARD_ABILITIES[cause.cardId]) || [];
      effect = abs.filter(function (ab) { return ab && ab.name === cause.effectName; })[0] || null;
    } else if (cause.effectKind === 'trainer') {
      var tdb = window.dbLookup ? window.dbLookup({ id: cause.cardId }) : null;
      if (!tdb || tdb.name !== cause.effectName) return null;
      var disc = ((pub.discard || {}).p1) || [], lastId = '';
      for (var di = disc.length - 1; di >= 0 && !lastId; di--) {
        if (typeof disc[di] === 'string' && disc[di].indexOf('energy:') !== 0) {
          var dd = incomingCardDb(disc[di]); lastId = (dd && dd.id) || '';
        }
      }
      var tl = (pub.log || [])[cause.logIndex], tm = tl && tl.meta || {};
      if (lastId !== cause.cardId || !tl || tl.turn !== cause.turn || tl.player !== 'p1' || tm.kind !== 'playTrainer' || tm.id !== cause.cardId) return null;
      effect = window.CARD_TRAINER_EFFECTS && window.CARD_TRAINER_EFFECTS[cause.cardId];
    }
    op = effect && effect.ops && effect.ops[cause.opIndex];
    if (!op) return null;
    var spec = null;
    if (cause.effectKind === 'attack' && op.op === 'discardOpponentHand') {
      spec = { source: 'hand', count: op.count || 1 };
      if (op.coin && !hiddenCoinProof(room, pub, op, spec.count)) return null;
    } else if (cause.effectKind === 'attack' && op.op === 'discardTopDeck' && (op.side === 'opponent' || op.side === 'both')) {
      spec = { source: 'deck', count: op.count || 1 };
    } else if (cause.effectKind === 'attack' && (op.op === 'discardOppHandTool' || op.op === 'discardOppHandCard')) {
      spec = { source: 'hand', count: op.count || 1, cardType: op.cardType || 'tool' };
    } else if (cause.effectKind === 'attack' && op.op === 'coinDiscardDeck' && (op.side === 'opponent' || op.side === 'both')) {
      var ev = null;
      if (Array.isArray(room.ev)) room.ev.forEach(function (e) { if (e && e.t === 'coins' && Number.isInteger(e.q) && e.q <= pub.evAt && (!ev || e.q > ev.q)) ev = e; });
      var n = ev && ev.h;
      if (!Number.isInteger(n) || n < 1 || n > 30 || !hiddenCoinProof(room, pub, op, n)) return null;
      spec = { source: 'deck', count: n };
    } else if (cause.effectKind === 'attack' && op.op === 'oppRevealShuffleHand') {
      // Gastly «Impresionar», Tsareena, Purrloin, Liepard, Murkrow (1) y Krookodile (1 por cara).
      var rsN = op.count || 1;
      if (op.coins) {
        var rsEv = null;
        if (Array.isArray(room.ev)) room.ev.forEach(function (e) { if (e && e.t === 'coins' && Number.isInteger(e.q) && e.q <= pub.evAt && (!rsEv || e.q > rsEv.q)) rsEv = e; });
        rsN = rsEv && rsEv.h;
        if (!Number.isInteger(rsN) || rsN < 1 || rsN > op.coins || !hiddenCoinProof(room, pub, op, rsN)) return null;
      } else if (op.coin && !hiddenCoinProof(room, pub, op, rsN)) return null;
      spec = { source: 'hand', count: rsN, dest: 'deck' };
    } else if (cause.effectKind === 'trainer' && op.op === 'prankSpinner') {
      // Ruleta Traviesa: 1 carta al azar. El SORTEO del lado lo hace quien la juega (el nº de
      // cartas de cada mano es público); lo que se delega es solo mover la que toca.
      spec = { source: 'hand', count: 1, dest: 'deck' };
    } else if (cause.effectKind === 'ability' && op.op === 'abilityDiscardOppDeck') {
      spec = { source: 'deck', count: op.count || 1 };
    } else if (cause.effectKind === 'trainer' && op.op === 'oppDiscardHandTo') {
      spec = { source: 'hand', toN: op.n || 4 };
    }
    return cleanHiddenDiscardSpec(spec);
  }
  function hiddenDiscardCauseKey(cause) {
    return JSON.stringify([cause.effectKind, cause.cardId, cause.sourceCardId || '', cause.effectName,
      cause.opIndex, cause.actorUid || '', cause.turn, cause.logIndex == null ? -1 : cause.logIndex]);
  }
  function publishHiddenDiscardRequest(req) {
    forcePublish({ pending: 'hiddenDiscard', hiddenDiscardId: req.id,
      hiddenDiscardSpec: req.spec, hiddenDiscardKind: req.kind, hiddenDiscardCause: req.cause });
  }
  // Nunca abandonar silenciosamente: el dueño puede haber mutado su zona aunque su respuesta
  // llegue tarde. Re-publicar el MISMO id conserva exactly-once y la presencia cerrará una
  // partida realmente desconectada; continuar con [] perdería la carta real para siempre.
  function armHiddenDiscardRetry(id) {
    if (S.hiddenDiscardReqTimer) clearTimeout(S.hiddenDiscardReqTimer);
    S.hiddenDiscardReqTimer = setTimeout(function retry() {
      if (!S.hiddenDiscardReq || S.hiddenDiscardReq.id !== id || !S.active || S.over) return;
      publishHiddenDiscardRequest(S.hiddenDiscardReq);
      S.hiddenDiscardReqTimer = setTimeout(retry, 6000);
    }, 6000);
  }
  window._pvpRequestHiddenDiscard = function (opp, spec, onDone, kind, cause) {
    if (!S.active || S.over || opp !== 'p2' || window.activeTurn !== 'p1') return false;
    var clean = cleanHiddenDiscardSpec(spec);
    kind = cleanHiddenDiscardKind(kind || 'attack');   // compat de hooks/tests anteriores; el motor siempre lo pasa explícito
    cause = cleanHiddenDiscardCause(cause);
    if (!clean || !kind || !cause || cause.effectKind !== kind) { setTimeout(function () { if (onDone) onDone([], null); }, 0); return true; }
    // Las rutas actuales se encadenan (Ultra Necrozma: mazo propio y luego rival). Si en el
    // futuro dos intentan abrirse en paralelo, la segunda espera sin crear una petición que
    // pueda pisar la primera en el único campo `pub.pending`.
    if (S.hiddenDiscardReq) { setTimeout(function () { if (onDone) onDone([]); }, 0); return true; }
    S.hiddenDiscardN = (S.hiddenDiscardN || 0) + 1;
    var id = String(Date.now()) + '-' + String(S.role || '') + '-' + S.hiddenDiscardN;
    S.hiddenDiscardReq = { id: id, spec: clean, kind: kind, cause: cause, onDone: onDone };
    publishHiddenDiscardRequest(S.hiddenDiscardReq);
    armHiddenDiscardRetry(id);
    return true;
  };
  function sendHiddenDiscardAnswer(id, images, afterN) {
    var r = window.pbPvp;
    if (!r || !S.code) return;
    S.hiddenDiscardAnswerSent = true;
    r.set(S.code, { hiddenDiscard: { id: id, by: S.role, images: images || [], afterN: afterN } }).catch(function () {
      // La mutación NO se repite: se conserva la respuesta y el siguiente snapshot puede
      // reintentar solo la escritura.
      if (S.hiddenDiscardAnsweredId === id) S.hiddenDiscardAnswerSent = false;
    });
  }
  function persistHiddenDiscardAnswer(id) {
    if (S.hiddenDiscardPersisting || S.hiddenDiscardAnsweredId !== id) return;
    S.hiddenDiscardPersisting = true;
    Promise.resolve(writePriv()).then(function (ok) {
      S.hiddenDiscardPersisting = false;
      if (S.hiddenDiscardAnsweredId !== id || ok === false) return;
      S.hiddenDiscardPersisted = true;
      sendHiddenDiscardAnswer(id, S.hiddenDiscardAnswerImages || [], S.hiddenDiscardAfterN);
    }, function () { S.hiddenDiscardPersisting = false; });
  }
  // Lado del DUEÑO: aplicar exactamente una vez sobre p1 real y responder las caras.
  function answerHiddenDiscard(room) {
    var pub = room.pub;
    if (!pub || pub.pending !== 'hiddenDiscard' || !pub.hiddenDiscardId || !room.pubBy || room.pubBy === S.role) return;
    var id = String(pub.hiddenDiscardId);
    var reqSeq = typeof room.seq === 'number' ? room.seq : -1;
    if (!id || id.length > 96 || reqSeq < (S.hiddenDiscardReqSeqHigh == null ? -1 : S.hiddenDiscardReqSeqHigh)) return;
    if (reqSeq === S.hiddenDiscardReqSeqHigh && S.hiddenDiscardLastDoneId === id) return;
    // Mismo seq con otro id o una foto vieja posterior a otras peticiones: nunca vuelve a
    // tocar la zona. Las respuestas no incrementan seq, por eso este guard vive aquí.
    if (reqSeq === S.hiddenDiscardReqSeqHigh && S.hiddenDiscardAnsweredId && S.hiddenDiscardAnsweredId !== id) return;
    S.hiddenDiscardReqSeqHigh = Math.max(S.hiddenDiscardReqSeqHigh == null ? -1 : S.hiddenDiscardReqSeqHigh, reqSeq);
    if (S.hiddenDiscardAnsweredId === id) {
      if (!S.hiddenDiscardPersisted) persistHiddenDiscardAnswer(id);
      else if (!S.hiddenDiscardAnswerSent) sendHiddenDiscardAnswer(id, S.hiddenDiscardAnswerImages || [], S.hiddenDiscardAfterN);
      return;
    }
    var clean = cleanHiddenDiscardSpec(pub.hiddenDiscardSpec);
    var kind = cleanHiddenDiscardKind(pub.hiddenDiscardKind);
    var cause = cleanHiddenDiscardCause(pub.hiddenDiscardCause);
    var derived = cause && cause.effectKind === kind ? deriveHiddenDiscardSpec(room, cause) : null;
    // Petición mal formada: responder vacío para liberar al peer, pero jamás mutar ni
    // guardar un recibo de una operación que no existe en el motor.
    if (!clean || !kind || !cause || !derived || !sameHiddenDiscardSpec(clean, derived)) {
      rejectIncomingCards('hiddenDiscard/cause'); sendHiddenDiscardAnswer(id, [], null); return;
    }
    var causeKey = hiddenDiscardCauseKey(cause);
    S.hiddenDiscardCauseUsed = S.hiddenDiscardCauseUsed || {};
    if (S.hiddenDiscardCauseUsed[causeKey]) {
      rejectIncomingCards('hiddenDiscard/replay'); sendHiddenDiscardAnswer(id, [], null); return;
    }
    // Sellar ANTES de tocar la zona: otro id para la misma acción nunca puede drenarla otra vez.
    S.hiddenDiscardCauseUsed[causeKey] = id;
    var result = (window._pbApplyHiddenDiscardRequest && window._pbApplyHiddenDiscardRequest(derived)) || { images: [], afterN: 0 };
    var images = Array.isArray(result) ? result : (Array.isArray(result.images) ? result.images : []);
    var afterN = Array.isArray(result) ? null : result.afterN;
    if (!Number.isInteger(afterN) || afterN < 0 || afterN > 30) afterN = null;
    S.hiddenDiscardAnsweredId = id;
    S.hiddenDiscardAnswerImages = images.slice();
    S.hiddenDiscardAfterN = afterN;
    S.hiddenDiscardAnswerSent = false;
    S.hiddenDiscardPersisted = false;
    S.hiddenDiscardOwned = { id: id, reqSeq: reqSeq, images: images.slice(), afterN: afterN, causeKey: causeKey };
    // Cola/mano + recibo + pila se escriben atómicamente ANTES de contestar. Si se recarga
    // cualquiera de las dos páginas, el mismo id se reanuda sin extraer una segunda carta.
    persistHiddenDiscardAnswer(id);
  }
  // Lado del ATACANTE: reemplazar tantos dorsos como caras devolvió el dueño.
  function onHiddenDiscarded(room) {
    var hd = room.hiddenDiscard;
    if (!hd || !S.hiddenDiscardReq || String(hd.id) !== S.hiddenDiscardReq.id || hd.by === S.role) return;
    // La respuesta sigue siendo hostil aunque llegue por el canal auxiliar. Validar TODO el
    // lote antes de consumir la petición/timer: una mezcla buena+inyectada no descarta nada.
    var safeHidden = canonicalIncomingCardList(hd.images, true);
    if (!safeHidden) { rejectIncomingCards('hiddenDiscard'); return; }
    var afterN = hd.afterN;
    if (afterN != null && (!Number.isInteger(afterN) || afterN < 0 || afterN > 30)) { rejectIncomingCards('hiddenDiscard/count'); return; }
    var req = S.hiddenDiscardReq; S.hiddenDiscardReq = null;
    if (S.hiddenDiscardReqTimer) { clearTimeout(S.hiddenDiscardReqTimer); S.hiddenDiscardReqTimer = null; }
    // Para `toN`, el conteo local puede ir atrasado; el dueño es quien conoce cuántas quitó.
    // Los otros efectos sí tienen un máximo exacto en la propia spec.
    var max = req.spec.toN != null ? 30 : Math.max(0, req.spec.count || 0);
    var images = safeHidden.slice(0, max).map(function (c) { return locRaw(c.image); });
    if (req.onDone) req.onDone(images, afterN);
    // Habilidad/Entrenador no tienen un cierre de ataque que publique después: retirar el
    // `pending` de forma explícita una vez aplicada la respuesta.
    if (req.kind !== 'attack') setTimeout(function () { if (S.active && !S.over && !S.hiddenDiscardReq) forcePublish(); }, 0);
  }
  // El pub de petición puede aplicarse después de que el dueño ya mutó su pila. La
  // protección se suelta solo ante un pub POSTERIOR y ya no pendiente: ese es el snapshot
  // final del atacante, que contiene la misma carta revelada.
  function releaseHiddenDiscardGuard(room) {
    var own = S.hiddenDiscardOwned;
    if (!own || !room.pub || room.pubBy === S.role || typeof room.seq !== 'number' || room.seq <= own.reqSeq) return;
    if (room.pub.pending === 'hiddenDiscard' && String(room.pub.hiddenDiscardId || '') === own.id) return;
    S.hiddenDiscardLastDoneId = own.id;
    S.hiddenDiscardOwned = null;
    S.hiddenDiscardAnsweredId = null; S.hiddenDiscardAnswerImages = null; S.hiddenDiscardAfterN = null;
    S.hiddenDiscardAnswerSent = false; S.hiddenDiscardPersisted = false; S.hiddenDiscardPersisting = false;
    writePriv();   // limpia el recibo ya confirmado; una foto vieja queda frenada por reqSeqHigh
  }
  // Lado del RIVAL: me piden la mano → la publico tal cual (el efecto la revela).
  function answerHandRequest(room) {
    var pub = room.pub;
    if (!pub || pub.pending !== 'revealHand' || !room.pubBy || room.pubBy === S.role) return;
    if (S.handAnsweredSeq === pub.revealSeq) return;
    S.handAnsweredSeq = pub.revealSeq;
    // Frontera de confianza: los filtros son una lista cerrada; cualquier otro valor no
    // saca nada (nunca se cae hacia «enséñale la mano entera»).
    // 'any' (Team Rocket's Kecleon «Spy Ops», B4a) = UNA carta al azar de la mano, sin filtro de
    // tipo: mismo alcance que los otros modos (devuelve 1 sola carta), nunca la mano entera.
    var pick = ['supporter', 'pokemonAttack', 'any'].indexOf(String(pub.revealPick || '')) >= 0 ? String(pub.revealPick) : '';
    var scope = String(pub.revealScope || '') === 'handDeck' ? 'handDeck' : 'hand';
    var hand = pub.revealPick
      ? ((pick && window._pbMyPickForReveal && window._pbMyPickForReveal(pick, scope)) || [])
      : ((window._pbMyHandForReveal && window._pbMyHandForReveal()) || []);
    var r = window.pbPvp;
    if (r && S.code) r.set(S.code, { revealHand: { seq: pub.revealSeq, by: S.role, cards: hand } }).catch(function () {});
  }
  // Lado del ATACANTE: llega su mano → la enseño de verdad y mando la elección.
  function onHandRevealed(room) {
    var rh = room.revealHand;
    if (!rh || !S.handReq || rh.seq !== S.handReq.seq || rh.by === S.role) return;
    // Igual que pub/ev: la mano revelada solo admite caras DB y su tipo viene de esa DB.
    // El lote se valida entero ANTES de cancelar el escape de 12 s o consumir la petición.
    var safeCards = canonicalIncomingCardList(rh.cards, false);
    if (!safeCards) { rejectIncomingCards('revealHand'); return; }
    var req = S.handReq; S.handReq = null;
    if (S.handReqTimer) { clearTimeout(S.handReqTimer); S.handReqTimer = null; }   // llegó a tiempo: fuera el escape
    var op = req.op || {};
    var all = safeCards.map(function (c) { return { i: c.i, image: locRaw(c.image), ct: c.cardType }; });
    // Con la mano ya revelada, su contenido es público: se puede resolver la carta por su
    // imagen. Hace falta para «básico» (el aviso solo trae el TIPO de carta, no la fase).
    var _dbOf = function (c) { return window.dbLookup ? window.dbLookup({ image: c.image }) : null; };
    var cands = all.filter(function (c) {
      if (op.filter === 'supporter') return c.ct === 'supporter';
      if (op.filter === 'basic') { var d = _dbOf(c); return !!(d && window.isBasicPokemon && window.isBasicPokemon(d)); }
      return !!c.image;
    });
    // `cards` solo lo usa el modo SOLO-VER: el llamador cuenta sobre lo revelado (Emma roba
    // 1 por cada Pokémon). Los demás modos lo ignoran.
    var done = function (cards) { if (req.onDone) req.onDone(cards || null); };
    if (op.action === 'pickRandom') { done(all); return; }   // ya viene sorteada por su dueño: ni panel ni elección
    // SOLO VER (Emma, Mew «Psy Report», Periscopio, Misdreavus): la mano se revela y no se
    // toca nada, así que no hay elección ni choice de vuelta — solo enseñarla y devolverla.
    if (op.action === 'view') {
      if (all.length) window._showRevealCards(all, T2('reveal.opponentHand'), null, function () { done(all); });
      else { window._boardNotice && window._boardNotice(T2('reveal.handEmpty')); done(all); }
      return;
    }
    if (!cands.length) {   // regla del máximo posible: la mano se revela igual
      if (all.length) window._showRevealCards(all, T2('reveal.opponentHand'), null, done);
      else { window._boardNotice && window._boardNotice(T2('reveal.handEmpty')); done(); }
      return;
    }
    var title = op.filter === 'any' ? T2('reveal.opponentHand')
      : T2('reveal.oppHandPick', { name: window._pvpOppName || '', type: window.typeName ? window.typeName(op.filter || 'supporter') : '' });
    // JEFE DEL TEAM ROCKET: elección MÚLTIPLE («tantos como quieras») y los Básicos van a SU
    // banca. Es el mismo canal, con una acción nueva y una lista de índices en vez de uno.
    if (op.action === 'bench') {
      var _limit = op.max == null ? 1 : op.max;
      // Banca llena: la carta sigue mirando/revelando la mano, pero no permite mover nada.
      if (_limit <= 0) {
        if (all.length) window._showRevealCards(all, T2('reveal.opponentHand'), null, done);
        else done();
        return;
      }
      var _max = Math.min(_limit, cands.length);
      window._showRevealUpTo(all, T2('boss.choose'), _max,
        function (c) { return cands.indexOf(c) >= 0; },
        function (elegidas) {
          var idxs = (elegidas || []).map(function (c) { return c.i; }).filter(function (i) { return i != null; });
          if (idxs.length) {
            S.choiceHigh += 1;
            var rr = window.pbPvp;
            if (rr && S.code) rr.set(S.code, { choice: { kind: 'hand', idxs: idxs, act: 'bench', by: S.role, seq: S.choiceHigh } }).catch(function () {});
            // ESPEJO DEL ATACANTE: lo mismo en mi copia de su lado. Sin esto, mi siguiente pub
            // (autoritativo) llevaría su mano y su banca SIN el cambio y se lo desharía.
            try {
              (elegidas || []).forEach(function (c) {
                var dorso = document.querySelector('#hand-p2 .card');
                if (dorso) dorso.remove();
                window._benchCardOn && window._benchCardOn('p2', c.image, _dbOf(c), {});
              });
              window.layoutFan && window.layoutFan(document.getElementById('hand-p2'));
            } catch (e) {}
          }
          done();
        });
      return;
    }
    var resolvePick = function (picked) {
      if (picked && picked.i != null) {
        S.choiceHigh += 1;
        var r = window.pbPvp;
        if (r && S.code) r.set(S.code, { choice: { kind: 'hand', idx: picked.i, act: op.action || 'discard', by: S.role, seq: S.choiceHigh } }).catch(function () {});
        // ESPEJO DEL ATACANTE: la elegida sale de la mano del rival AQUÍ TAMBIÉN. Sin esto,
        // (a) Daniel no veía el descarte («clico y no pasa nada»), y (b) —peor— el siguiente
        // pub del atacante (autoritativo, con el KO) llevaba la mano/descarte SIN el descarte
        // → al aplicarlo el rival, la carta descartada le VOLVÍA a la mano. El rival hace lo
        // mismo en su lado real al recibir la choice → ambos estados convergen.
        try {
          var dorso = document.querySelector('#hand-p2 .card');
          if (dorso) { dorso.remove(); window.layoutFan && window.layoutFan(document.getElementById('hand-p2')); }
          if ((op.action || 'discard') === 'shuffleDeck') {
            if (window.deckPlayQueues && window.deckPlayQueues.p2) window.deckPlayQueues.p2.push({ image: window.CARD_BACK_IMG || '', name: '' });
            window.refreshDeckBadge && window.refreshDeckBadge('p2');
          } else if (picked.image && window.pushToDiscard) {
            window.pushToDiscard('p2', picked.image, false);
            window.refreshDiscardSlot && window.refreshDiscardSlot('p2');
          }
          if (window.sfx) window.sfx('board.goBack');
        } catch (e) {}
      }
      done();
    };
    // UI de Daniel: mano ENTERA del rival + arrastrar la elegida a un hueco (aura). Solo las
    // que casan el filtro se arrastran. Fallback al panel de revelar clásico.
    if (window._pbOppHandPick) {
      window._pbOppHandPick({
        cards: all,
        canPick: function (c) { return op.filter === 'supporter' ? c.ct === 'supporter' : true; },
        title: title,
        onDone: resolvePick
      });
      return;
    }
    window._showRevealCards(cands, title, resolvePick, function () { done(); });
  }

  // ── Elección DELEGADA genérica (Sabrina/Repel/Grapploct: «tu rival elige») ──
  // El actor arma _choosePoolCard sobre MI banca espejo → publica pending 'pick' con los
  // huecos; YO elijo en mi pantalla (resaltado real) → choice → el actor inyecta el click
  // y su efecto continúa (el swap resultante vuelve como evento y se replaya real).
  window._pvpOnPickArmed = function (pool, oppChooses) {
    if (!S.active || !oppChooses) return false;
    if (window.activeTurn !== 'p1') return false;   // solo el actor delega
    var allP2 = (pool || []).length && pool.every(function (c) { return c.closest && c.closest('#zone-p2'); });
    if (!allP2) return false;
    var idxs = pool.map(function (c) { var rr = evSlotRef(c); return rr ? rr.idx : -1; })
                   .filter(function (i) { return i >= 0; });
    if (!idxs.length) return false;
    forcePublish({ pending: 'pick', pickPool: idxs });
    return true;
  };
  function showPickChoice(idxs) {
    if (!S.active || S.over) return;
    clearPickChoice();
    var cards = [];
    (idxs || []).forEach(function (i) {
      var rr = slotCardEl('p1', i);
      if (rr && rr.card) cards.push({ card: rr.card, idx: i });
    });
    if (!cards.length) return;
    S.pickArmed = true;
    cards.forEach(function (x) { x.card.classList.add('fx-target'); });
    window._boardNotice && window._boardNotice(window.t ? window.t('rules.chooseTarget') : '');
    var handler = function (e) {
      var c = e.target.closest && e.target.closest('.card.fx-target');
      if (!c) return;
      e.stopPropagation(); e.preventDefault();
      var hit = cards.filter(function (x) { return x.card === c; })[0];
      clearPickChoice();
      if (!hit) return;
      S.choiceHigh += 1;
      var r = window.pbPvp;
      if (r && S.code) {
        r.set(S.code, { choice: { kind: 'pick', idx: hit.idx, by: S.role, seq: S.choiceHigh } })
          .catch(function (err) { console.warn('[pvp-sync] pick', (err && err.code) || err); });
      }
    };
    S._pickHandler = handler;
    document.addEventListener('click', handler, true);
  }
  function clearPickChoice() {
    S.pickArmed = false;
    if (S._pickHandler) { try { document.removeEventListener('click', S._pickHandler, true); } catch (e) {} S._pickHandler = null; }
    document.querySelectorAll('#zone-p1 .card.fx-target').forEach(function (c) { c.classList.remove('fx-target'); });
  }
  window._pvpShowPickChoice = showPickChoice;   // hook de test
  function injectPick(logicalIdx) {
    var rr = slotCardEl('p2', logicalIdx);
    if (!rr || !rr.card) return;
    if (!rr.card.classList.contains('fx-target')) rr.card.classList.add('fx-target');
    var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    ev._pvpInject = true;
    rr.card.dispatchEvent(ev);
  }
  // Elección de nuevo Activo hecha con el picker REAL de _pickBenchToActive en MI lado
  // (armado por el replay del KO): viaja al actor como choice para que su maquinaria
  // (turno/robo diferidos) complete. Las inyectadas (e._pvpInject) no rebotan.
  window._pvpOnPromoted = function (player, benchSlot, e) {
    if (!S.active || player !== 'p1') return;
    if (e && e._pvpInject) return;
    if (window.activeTurn === 'p1') return;   // en MI turno mi maquinaria es la autoritativa (no hay que delegar)
    var slots = Array.prototype.slice.call(document.querySelectorAll('#zone-p1 .pokemon-slot'));
    var m = slotMap('p1');
    var logicalIdx = m ? m.indexOf(slots.indexOf(benchSlot)) : -1;
    if (logicalIdx < 1) return;
    S.choiceHigh += 1;
    var r = window.pbPvp;
    if (r && S.code) {
      r.set(S.code, { choice: { kind: 'promote', idx: logicalIdx, by: S.role, seq: S.choiceHigh } })
        .catch(function (err) { console.warn('[pvp-sync] choice', (err && err.code) || err); });
    }
  };
  // Clicks locales sobre el selector del lado REMOTO: bloqueados (solo elige su dueño).
  window._pvpBlockLocalPromote = function (player, e) {
    if (!S.active || player !== 'p2') return false;
    return !(e && e._pvpInject);
  };
  // Elección remota recibida → click inyectado en la carta de banca correspondiente.
  function injectPromote(logicalIdx, tries) {
    // La elección del rival puede llegar ANTES de que el replay del KO haya armado el picker
    // local (carrera real: el evento del KO y la choice viajan por campos distintos). Un click
    // inyectado sin picker caía AL VACÍO y la choice se perdía (dedupe por firma → no se
    // re-procesa) → el capturador modal quedaba vivo PARA SIEMPRE tragándose todos los clics
    // del tablero (raíz del «no puedo abrir la pila de descartes»). → REINTENTAR hasta que el
    // picker esté armado y la carta espejo exista (re-montajes incluidos).
    var m = slotMap('p2');
    var slots = m ? document.querySelectorAll('#zone-p2 .pokemon-slot') : null;
    var slot = (m && logicalIdx >= 1 && logicalIdx < m.length) ? slots[m[logicalIdx]] : null;
    var card = slot && slot.querySelector('.card');
    if (!card || !window._promoteHandler || window._pbAwaitingPromote !== 'p2') {
      if (window._pbAwaitingPromote === null && card && !window._promoteHandler) return;   // ya resuelta por otro camino (snapshot) → nada que inyectar
      if ((tries || 0) < 40) setTimeout(function () { injectPromote(logicalIdx, (tries || 0) + 1); }, 250);
      return;
    }
    // si un re-montaje borró el resaltado, el handler exige .fx-target → re-ponerla
    if (!card.classList.contains('fx-target')) card.classList.add('fx-target');
    var ev = new MouseEvent('click', { bubbles: true, cancelable: true });
    ev._pvpInject = true;
    card.dispatchEvent(ev);
  }
  // ── Lado del DEFENSOR: elegir mi nuevo Activo y mandar la elección ──
  function showPromoteChoice() {
    // Con replay real, el KO de MI Activo arma mi picker REAL (_requirePromotion vía el
    // evento 'ko') → este picker ligero solo actúa en el camino snapshot (fallback).
    // OJO (bug del «stutter» al colocar el nuevo Activo): los dos son listeners CAPTURE en
    // document y `stopPropagation` NO frena a los hermanos → si ambos se armaban, un clic
    // movía la carta DOS veces (el ligero por _pvpLocalPromote y el real por su handler).
    if (window._pbAwaitingPromote === 'p1') return;
    // ...y si el evento 'ko' aún está en camino, esperar a que arme el picker real.
    if (S.evRunning || S.evQueue.length || (S.evPeerHigh || 0) > S.evInApplied) {
      clearTimeout(S._promoteWait);
      S._promoteWait = setTimeout(showPromoteChoice, 400);
      return;
    }
    // SIEMPRE re-armar desde cero: un apply entre el armado y el clic RE-MONTA el tablero
    // y borra los .fx-target, pero choiceArmed seguía true → clics muertos = partida
    // atascada sin poder poner Activo (deadlock del playtest de Daniel).
    clearPromoteChoice();
    S.choiceArmed = true;
    var bench = [];
    document.querySelectorAll('#zone-p1 .pokemon-slot .card').forEach(function (c) {
      var s = c.closest('.pokemon-slot');
      if (s && !s.classList.contains('active-slot')) bench.push(c);
    });
    if (!bench.length) { S.choiceArmed = false; return; }
    bench.forEach(function (c) { c.classList.add('fx-target'); });
    window._boardNotice && window._boardNotice(window.t ? window.t('rules.promoteActive') : '');
    var handler = function (e) {
      var c = e.target.closest && e.target.closest('.card.fx-target');
      if (!c) return;
      e.stopPropagation(); e.preventDefault();
      document.removeEventListener('click', handler, true);
      clearPromoteChoice();
      if (window._promoteHandler) return;   // el picker REAL está vivo: él mueve la carta (evita el doble movimiento)
      // índice LÓGICO del hueco elegido (1..3 = banca) — ANTES de moverla en local
      var slots = Array.prototype.slice.call(document.querySelectorAll('#zone-p1 .pokemon-slot'));
      var domIdx = slots.indexOf(c.closest('.pokemon-slot'));
      // subir MI Activo YA, con el movimiento real (la secuencia correcta: primero el
      // Activo, después ya llegará el robo del turno en el pub del atacante)
      window._pvpLocalPromote && window._pvpLocalPromote(c);
      var m = slotMap('p1');
      var logicalIdx = m ? m.indexOf(domIdx) : -1;
      if (logicalIdx < 1) return;
      S.choiceHigh += 1;
      var r = window.pbPvp;
      if (r && S.code) {
        r.set(S.code, { choice: { kind: 'promote', idx: logicalIdx, by: S.role, seq: S.choiceHigh } })
          .catch(function (e2) { console.warn('[pvp-sync] choice', (e2 && e2.code) || e2); });
      }
    };
    S._choiceHandler = handler;
    document.addEventListener('click', handler, true);
  }
  function clearPromoteChoice() {
    S.choiceArmed = false;
    if (S._promoteWait) { clearTimeout(S._promoteWait); S._promoteWait = null; }
    if (S._choiceHandler) { try { document.removeEventListener('click', S._choiceHandler, true); } catch (e) {} S._choiceHandler = null; }
    document.querySelectorAll('#zone-p1 .card.fx-target').forEach(function (c) { c.classList.remove('fx-target'); });
  }
  window._pvpShowPromoteChoice = showPromoteChoice;   // hook de test

  // ═══ T2c-2: PRIV + RECONEXIÓN + RENDIRSE + DESCONEXIÓN ═══
  function myUid() { var a = window.pbAccount && window.pbAccount(); return a ? a.uid : null; }

  // Doc privado: MI mano y MI cola (solo mi reconexión; el rival no puede leerlo).
  function writePriv(local) {
    var r = window.pbPvp, uid = myUid();
    if (!r || !r.setPriv || !S.code || !uid) return Promise.resolve(true);   // harness/LAN sin priv: no bloquear la partida
    var p = local || (window._pvpBuildPayload ? window._pvpBuildPayload() : null);
    if (!p) return Promise.resolve(false);
    var data = {
      hand: (p.hands && p.hands.p1) || [],
      queue: (p.playQueues && p.playQueues.p1) || [],
      deck: (p.decks && p.decks.p1) || null,
      // ESTADÍSTICAS: mis jugadas acumuladas. Van aquí para sobrevivir a una recarga
      // (al reanudar se recuperan) — el acumulador vive en memoria.
      stats: (window._pbStatLog || []).slice(0, 500),
      st0: S.matchStart || 0,
      // Acciones de descarte oculto ya consumidas. Persiste más allá del receipt inmediato:
      // una recarga no puede permitir un requestId NUEVO para la misma habilidad/ataque.
      hiddenDiscardCauseUsed: Object.keys(S.hiddenDiscardCauseUsed || {}).slice(-80).map(function (key) {
        return { key: key, id: S.hiddenDiscardCauseUsed[key] };
      })
    };
    // Recibo exactly-once de un descarte delegado. Solo existe mientras el pub de petición
    // siga pendiente; cola/mano, pila y recibo viajan en la MISMA escritura privada.
    if (S.hiddenDiscardOwned && S.hiddenDiscardAnsweredId === S.hiddenDiscardOwned.id) {
      data.hiddenDiscard = { id: S.hiddenDiscardAnsweredId,
        images: (S.hiddenDiscardAnswerImages || []).slice(), afterN: S.hiddenDiscardAfterN,
        causeKey: S.hiddenDiscardOwned.causeKey || '' };
      data.hiddenDiscardPile = (p.discard && p.discard.p1 || []).slice();
      data.hiddenDiscardPileFlags = (p.discardFromDeck && p.discardFromDeck.p1 || []).map(function (v) { return !!v; });
    } else {
      data.hiddenDiscard = null;   // deep-merge del harness/Firestore: limpiar explícitamente
    }
    var sig; try { sig = JSON.stringify(data); } catch (e) { sig = null; }
    // TTL del doc privado (política TTL de Firestore en la subcolección priv): se añade
    // DESPUÉS de la firma — si entrara en el sig, el dedupe no funcionaría nunca.
    data.expireAt = new Date(Date.now() + 24 * 3600 * 1000);
    var code = S.code;
    var task = function () {
      if (sig && sig === S.lastPrivSig) return true;
      return Promise.resolve(r.setPriv(code, uid, data)).then(function () {
        if (sig) S.lastPrivSig = sig;   // solo sellar dedupe tras confirmación real
        return true;
      }).catch(function (e) {
        console.warn('[pvp-sync] priv', (e && e.code) || e);
        return false;
      });
    };
    // Serializar evita que una escritura vieja (sin recibo) aterrice después de la nueva
    // y borre la prueba necesaria para reanudar exactamente una vez.
    S.privWriteChain = (S.privWriteChain || Promise.resolve()).then(task, task);
    return S.privWriteChain;
  }

  // ── Claim de maestrías (AUTOMÁTICO, cero UI — nunca un reporte manual) ─────
  // Al terminar la partida, CADA cliente apunta en su doc privado (campo `claim`,
  // owner-only por las reglas de priv → sin cambios de reglas ni TTL nuevos) su
  // versión del resultado y las cartas que JUGÓ: ids de DB deduplicados sacados del
  // registro de acciones (Pokémon colocados, evoluciones, Entrenadores, estadios).
  // La Cloud Function de maestrías compara los dos claims («cuenta salvo
  // contradicción»; claim AUSENTE ≠ contradicción — cubre desconexiones), valida
  // duración/turnos/no-solape con reloj de servidor y agrega. Un fallo aquí jamás
  // toca la partida; sin red o sin uid, simplemente no se apunta.
  function writeClaim(winnerRole, reason) {
    var r = window.pbPvp, uid = myUid();
    if (!r || !r.setPriv || !S.code || !uid) return;
    // Fuente = el ACUMULADOR propio (window._pbStatLog), NO el registro de acciones: ese
    // está capado a 200 con las acciones de ambos y en online lo reemplaza el pub del rival
    // en cada actualización → perdía jugadas (también las de las maestrías). El acumulador
    // solo crece con lo mío y se recupera del doc privado al reconectar.
    var cards = [], seen = {}, plays = [], kos = [], mull = 0;
    (window._pbStatLog || []).forEach(function (e) {
      if (!e) return;
      if (e.k === 'mulligan' && e.p === 'p1') mull = 1;
      // KO que hice YO = cae un Pokémon del rival (en mi espejo, 'p2').
      // `id` = quién cae · `by` = con qué carta lo tumbé (solo KO por ataque).
      if (e.k === 'ko' && e.p === 'p2' && e.id && kos.length < 24) {
        var k = { t: e.t | 0, id: e.id };
        if (e.by) k.by = e.by;
        kos.push(k);
      }
      if (!e.id || e.p !== 'p1') return;
      if (e.k !== 'playPokemon' && e.k !== 'evolve' && e.k !== 'playTrainer' && e.k !== 'stadium') return;
      // MAESTRÍAS: cartas jugadas, DEDUPLICADAS (misma semántica de siempre; ahora sin perderse)
      if (!seen[e.id]) { seen[e.id] = 1; cards.push(e.id); }
      // ESTADÍSTICAS: la misma jugada CON su turno y SIN dedupe (dos copias = dos entradas;
      // el turno es lo que permite «turno medio en que se juega X»)
      if (plays.length < 80) plays.push({ t: e.t | 0, id: e.id });
    });
    var ot = window._pbOwnerTurns || {};
    var sc = window._pbScores || {};
    r.setPriv(S.code, uid, {
      claim: {
        winner: winnerRole, reason: reason || '', mode: S.mode || 'standard',
        turns: ((ot.p1 | 0) + (ot.p2 | 0)), cards: cards.slice(0, 60), proto: PROTO, ts: Date.now(),
        heads: (((window._pbCoinsWon || {}).p1) | 0),   // caras (monedas ganadas) de ESTA partida → misión «Todo cara»
        // ── ESTADÍSTICAS de partida (meta interno) ────────────────────────────
        // Lo consume la MISMA Cloud Function, que escribe un registro ANÓNIMO en
        // `matches` (sin uid ni nombres). No influye en las maestrías ni en el juego.
        plays: plays, kos: kos, mull: mull, pts: (sc.p1 | 0),
        // duración de la PARTIDA (el reloj de servidor mide la vida de la sala: lobby incluido)
        pdur: S.matchStart ? Math.max(0, Date.now() - S.matchStart) : 0,
        env: window.PB_ENV || 'prod', build: window.PB_BUILD || ''
      },
      expireAt: new Date(Date.now() + 24 * 3600 * 1000)
    }).catch(function (e2) { console.warn('[pvp-sync] claim', (e2 && e2.code) || e2); });
  }
  window._pvpWriteClaim = writeClaim;   // hook de test (t14_claims)

  function restoreHiddenDiscardCauseUsed(priv) {
    S.hiddenDiscardCauseUsed = {};
    (Array.isArray(priv && priv.hiddenDiscardCauseUsed) ? priv.hiddenDiscardCauseUsed.slice(-80) : []).forEach(function (x) {
      if (!x || typeof x.key !== 'string' || !x.key || x.key.length > 600 ||
          typeof x.id !== 'string' || !x.id || x.id.length > 96) return;
      S.hiddenDiscardCauseUsed[x.key] = x.id;
    });
  }
  function restoreHiddenDiscardReceipt(priv, room, payload) {
    var pub = room && room.pub, rec = priv && priv.hiddenDiscard;
    if (!pub || pub.pending !== 'hiddenDiscard' || room.pubBy === S.role || !rec ||
        String(rec.id || '') !== String(pub.hiddenDiscardId || '')) return false;
    var spec = cleanHiddenDiscardSpec(pub.hiddenDiscardSpec);
    var kind = cleanHiddenDiscardKind(pub.hiddenDiscardKind);
    var cause = cleanHiddenDiscardCause(pub.hiddenDiscardCause);
    var derived = cause && cause.effectKind === kind ? deriveHiddenDiscardSpec(room, cause) : null;
    var safeImages = canonicalIncomingCardList(rec.images, true);
    var pile = Array.isArray(priv.hiddenDiscardPile) ? priv.hiddenDiscardPile.slice() : null;
    var causeKey = cause && hiddenDiscardCauseKey(cause);
    if (!spec || !kind || !cause || !derived || !sameHiddenDiscardSpec(spec, derived) ||
        !causeKey || rec.causeKey !== causeKey || !safeImages || !pile || !canonDiscard(pile)) return false;
    if (S.hiddenDiscardCauseUsed[causeKey] && S.hiddenDiscardCauseUsed[causeKey] !== String(rec.id)) return false;
    S.hiddenDiscardCauseUsed[causeKey] = String(rec.id);
    var flags = Array.isArray(priv.hiddenDiscardPileFlags) ? priv.hiddenDiscardPileFlags.map(function (v) { return !!v; }) : [];
    while (flags.length < pile.length) flags.push(false);
    flags.length = pile.length;
    var afterN = rec.afterN;
    if (!Number.isInteger(afterN) || afterN < 0 || afterN > 30) afterN = null;

    payload.discard = payload.discard || {};
    payload.discardFromDeck = payload.discardFromDeck || {};
    payload.discard.p1 = pile;
    payload.discardFromDeck.p1 = flags;
    S.hiddenDiscardAnsweredId = String(rec.id);
    S.hiddenDiscardAnswerImages = safeImages.map(function (c) { return c.image; });
    S.hiddenDiscardAfterN = afterN;
    S.hiddenDiscardAnswerSent = !!(room.hiddenDiscard && String(room.hiddenDiscard.id || '') === S.hiddenDiscardAnsweredId && room.hiddenDiscard.by === S.role);
    S.hiddenDiscardPersisted = true; S.hiddenDiscardPersisting = false;
    S.hiddenDiscardReqSeqHigh = typeof room.seq === 'number' ? room.seq : -1;
    S.hiddenDiscardOwned = { id: S.hiddenDiscardAnsweredId, reqSeq: S.hiddenDiscardReqSeqHigh,
      images: S.hiddenDiscardAnswerImages.slice(), afterN: afterN, causeKey: causeKey };
    return true;
  }

  // El iniciador también puede recargar con la petición aún en el pub. Reconstruir el
  // callback perdido permite consumir una respuesta ya escrita (o la que llegue después)
  // y completar el cierre del ataque sin repetir daño ni volver a usar la habilidad.
  function rehydrateOutgoingHiddenDiscard(room) {
    var pub = room && room.pub;
    if (!pub || pub.pending !== 'hiddenDiscard' || room.pubBy !== S.role || !pub.hiddenDiscardId) return false;
    var spec = cleanHiddenDiscardSpec(pub.hiddenDiscardSpec);
    var kind = cleanHiddenDiscardKind(pub.hiddenDiscardKind);
    var cause = cleanHiddenDiscardCause(pub.hiddenDiscardCause);
    var derived = cause && cause.effectKind === kind ? deriveHiddenDiscardSpec(room, cause) : null;
    var id = String(pub.hiddenDiscardId || '');
    if (!spec || !kind || !cause || !derived || !sameHiddenDiscardSpec(spec, derived) || !id || id.length > 96) return false;
    S.hiddenDiscardReq = { id: id, spec: spec, kind: kind, cause: cause, resumed: true,
      onDone: function (images, afterN) {
        if (window._pbResumeHiddenDiscard) window._pbResumeHiddenDiscard(spec, images || [], afterN, kind);
      } };
    window._pbHiddenDiscardPending = 1;
    armHiddenDiscardRetry(id);
    return true;
  }

  function finishResumeGate(fallbackRoom) {
    setTimeout(function () {
      if (!S.active || S.over) return;
      var latest = S.resumeRoom || fallbackRoom;
      rehydrateOutgoingHiddenDiscard(latest);
      S.resumePending = false; S.resumeRoom = null;
      if (latest) window._pvpOnRoom(latest);
    }, 520);   // después del guard S.applying (500 ms) del restore
  }

  // Reconexión EN PARTIDA: reconstruir MI tablero desde pub (compartido) + priv (mi mano/cola).
  window._pvpResumeMatch = function (code, role, room) {
    window._pvpMatchBegin(code, role);
    S.resumePending = true; S.resumeRoom = room || null;
    // La reconexión aplica pub/sides directamente y no pasa por _pvpOnRoom: mismo preflight
    // antes de leer privados o limpiar/restaurar el tablero. Aquí también se valida el lado
    // que figura como «mío»: el documento compartido no es una fuente de autenticidad.
    var resumeRoom = Object.assign({}, room || {});
    if (resumeRoom.pub) {
      resumeRoom.pub = canonicalIncomingPub(resumeRoom.pub);
      if (!resumeRoom.pub) {
        rejectIncomingCards('resume/pub');
        window._pvpMatchEnd && window._pvpMatchEnd();
        return false;
      }
    }
    if (resumeRoom.sides) {
      var resumeSides = Object.assign({}, resumeRoom.sides);
      for (var rs = 0; rs < 2; rs++) {
        var rk = rs === 0 ? 'host' : 'guest';
        if (!resumeSides[rk]) continue;
        resumeSides[rk] = canonicalIncomingSide(resumeSides[rk]);
        if (!resumeSides[rk]) {
          rejectIncomingCards('resume/side');
          window._pvpMatchEnd && window._pvpMatchEnd();
          return false;
        }
      }
      resumeRoom.sides = resumeSides;
    }
    room = resumeRoom;
    S.mode = (room && room.mode) || 'standard';   // conservar el formato al reconectar (draft/estándar)
    S.seq = room.seq || 0;   // el pub actual no es "nuevo": se aplica a mano aquí
    // Eventos históricos del pub: consumidos (el restore ya trae ese estado). OJO: los `q`
    // son POR EMISOR → solo cuentan si el último pub lo publicó EL RIVAL; adoptar MI propia
    // numeración dejaría sus eventos futuros por debajo de la marca (snapshot mudo).
    // Si el último en escribir fui YO, no hay nada del rival que sembrar; lo que quede suyo
    // en la sala tampoco debe reproducirse, y de eso se encarga el guard de EDAD de
    // handleIncomingEvents (ese hueco replayaba su partida entera al reanudar).
    if (Array.isArray(room.ev) && room.evBy && room.evBy !== role) {
      room.ev.forEach(function (e) { if (e && e.q > S.evInApplied) S.evInApplied = e.q; });
      if (room.evHigh != null) S.evPeerHigh = room.evHigh;
    }
    // Choices ya consumidas: sin esto se re-inyecta una elección vieja (fantasma) y mis
    // choices nuevas (seq reiniciado a 1) las descarta el peer, que conserva su marca alta.
    if (room.choice) {
      if (room.choice.seq != null) S.choiceHigh = room.choice.seq;   // sigo la numeración compartida
      S.lastChoiceSig = room.choice.by + '|' + room.choice.seq + '|' + room.choice.kind + '|' + room.choice.idx;   // ya consumida: no re-inyectar la vieja
    }
    var r = window.pbPvp, uid = myUid();
    // Reconexión DURANTE LA COLOCACIÓN: no hay `pub` todavía (solo aparece al soltarla), así que
    // el camino normal no puede reconstruir nada. Sin esto, reanudar dejaba la sesión ACTIVA pero
    // con el tablero vacío, sin latido y sin botón de rendirse → derrota segura a los 60s.
    // Se rehace con lo que SÍ existe: mi mano/cola/mazo del doc PRIVADO + los lados ya colocados
    // (`sides`, que es lo que se publica en esta fase) + la moneda de la sala.
    var finPlacement = function (priv) {
      if (!priv || !priv.deck) { window._pvpMatchEnd && window._pvpMatchEnd(); return; }
      var opp = role === 'host' ? 'guest' : 'host';
      var mySide = (room.sides && room.sides[role]) || null;
      var oppSide = (room.sides && room.sides[opp]) || null;
      var first = (room.coin === role) ? 'p1' : 'p2';
      var oppInfo = room[opp] || {};
      var payload = {
        ts: 0,
        decks: { p1: priv.deck, p2: { cards: [], energyTypes: (oppInfo.deck && oppInfo.deck.energyTypes) || [] } },
        playQueues: { p1: priv.queue || [], p2: [] },
        discard: { p1: (mySide && mySide.discard) || [], p2: [] },
        board: { p1: toDom((mySide && mySide.board) || [], 'p1'), p2: [] },
        stadiums: { p1: null, p2: null },
        energyZone: { p1: (mySide && mySide.energyZone) || null, p2: null },
        hands: { p1: priv.hand || [], p2: [] },
        log: [], turnState: {},
        game: { started: false, placement: true, firstPlayer: first, turn: first, turnNum: 0,
                ownerTurns: { p1: 0, p2: 0 }, scores: { p1: 0, p2: 0 }, gameOver: null }
      };
      S.applying = true;
      try { window._pvpClearBoard(); window._pvpRestoreState(payload); }
      finally { setTimeout(function () { S.applying = false; }, 500); }
      if (mySide && mySide.done) S.readySent = true;   // ya había pulsado «Empezar» antes de recargar
      ensureSurrenderBtn();
      startHeartbeat();
      armFastPublish();
      startWatchdog();
      setTimeout(function () {
        if (!S.active || S.over) return;
        publishSide(!!(mySide && mySide.done));   // re-anuncio mi lado (y mi «listo» si lo estaba)
        if (oppSide) applyOppSide(oppSide, true);  // su lado (bocabajo, como toda la colocación)
        maybeReleasePlacement(room);               // si los dos estaban listos, soltar
        // Reloj de colocación: se RECUPERA del instante compartido (no se reinicia al volver).
        if (!S.placementReleased) armSetupTimer(room.setupAt || 0);
      }, 600);
      finishResumeGate(room);
    };
    var fin = function (priv) {
      // Sin el privado NO existe una fuente legítima para mi mano/cola. Usar el DOM previo
      // podría responder una petición con cartas de otra partida local: cerrar es fail-safe.
      if (!priv || !priv.deck || !Array.isArray(priv.hand) || !Array.isArray(priv.queue)) {
        S.resumePending = false; S.resumeRoom = null;
        window._pvpMatchEnd && window._pvpMatchEnd();
        return;
      }
      // ESTADÍSTICAS: recuperar MIS jugadas acumuladas y el inicio real de la partida (el
      // acumulador vive en memoria; sin esto, recargar a mitad borraría todo lo jugado antes).
      if (priv && Array.isArray(priv.stats)) window._pbStatLog = priv.stats.slice();
      if (priv && priv.st0) S.matchStart = priv.st0;
      restoreHiddenDiscardCauseUsed(priv);
      if (!room.pub) { finPlacement(priv); return; }
      S.applying = true;
      S.lastAppliedPub = canonPov(room.pub);   // baseline: reanudar no dispara cues
      try {
        var p = payloadFromPub(room.pub, true);   // reconexión: mi zona sale del pub, no del tablero vacío
        p.hands.p1 = priv.hand;
        p.playQueues.p1 = priv.queue;
        p.decks.p1 = priv.deck;
        restoreHiddenDiscardReceipt(priv, room, p);
        window._pvpClearBoard();
        window._pvpRestoreState(p);
      } finally {
        setTimeout(function () { S.applying = false; }, 500);
      }
      if (room.pub.pending === 'promote') setTimeout(showPromoteChoice, 900);
      else if (room.pub.pending === 'pick') setTimeout(function () { showPickChoice(room.pub.pickPool); }, 900);
      S.placementReleased = true;   // partida ya en marcha
      ensureSurrenderBtn();
      startHeartbeat();
      armFastPublish();
      startWatchdog();
      // RECONEXIÓN: adopta el `turnAt` COMPARTIDO de la sala → el reloj sigue con el tiempo que
      // le quedaba, no vuelve a 90s (el bug: el que recargaba reiniciaba el reloj de verdad).
      setTimeout(function () {
        var mine = window.activeTurn === 'p1';
        if (mine) S.actorNow = true;   // reanudo EN mi turno → actor desde ya (un endTurn inmediato no puede caer mudo)
        startTurnTimer(mine, room.turnAt != null ? room.turnAt : undefined,
                       !!(room.turnAtBy && room.turnAtBy !== S.role));   // ¿la escribió el rival con SU reloj?
      }, 500);
      finishResumeGate(room);
    };
    if (r && r.getPriv && uid) r.getPriv(code, uid).then(fin).catch(function () { fin(null); });
    else fin(null);
  };

  // ── Rendirse ──
  // 'draw' = fin SIN ganador (tope global con puntos iguales, o nadie coloca a tiempo).
  function roleToLocal(role) {
    if (role === 'draw' || !role) return 'draw';
    return role === S.role ? 'p1' : 'p2';
  }
  window._pvpEndMatchOver = function (w, r, p, s) { return endMatchOver(w, r, p, s); };   // hook de test
  function endMatchOver(winnerRole, reason, publishIt, skipOverlay) {
    if (S.over) return;
    S.over = true;
    window._pbAskClose && window._pbAskClose();   // preguntas del tablero (mulligan/carta extra) fuera
    stopHeartbeat();
    stopWatchdog();
    hideReconnecting();
    if (typeof clearTurnTimer === 'function') clearTurnTimer();
    if (typeof disarmFastPublish === 'function') disarmFastPublish();
    if (publishIt) {
      var r = window.pbPvp;
      if (r && S.code) r.set(S.code, { status: 'over', over: { winner: winnerRole, reason: reason } }).catch(function () {});
    }
    var localWinner = roleToLocal(winnerRole);
    if (!skipOverlay) {   // fin natural: el overlay lo pinta el propio tablero (_endGame)
      window._pbGameOver = localWinner;
      window._pvpShowGameOver && window._pvpShowGameOver(localWinner);
    }
    window._pvpMatchOverCleanup && window._pvpMatchOverCleanup();   // sin reconexión fantasma
    ['pvp-opts-btn', 'pvp-opts-menu', 'pvp-emote-btn', 'pvp-emote-menu'].forEach(function (id) { var e = document.getElementById(id); if (e) e.remove(); });
    // Claim de maestrías: mi versión del resultado, apuntada sola (ver writeClaim)
    try { writeClaim(winnerRole, reason); } catch (eC) {}
    // Historial propio (cap 100; cloud-sync lo espeja como lista con ts)
    try {
      var K = 'pocketboard_pvp_history_v1';
      var hist = JSON.parse(localStorage.getItem(K) || '[]') || [];
      var ts = Date.now();
      hist.push({ id: ts, ts: ts, result: winnerRole === 'draw' ? 'draw' : (winnerRole === S.role ? 'win' : 'loss'),
                  reason: reason || '', opp: window._pvpOppName || '', mode: S.mode || 'standard' });
      if (hist.length > 100) hist = hist.slice(-100);
      localStorage.setItem(K, JSON.stringify(hist));
    } catch (e) {}
    // Y AQUÍ SE ACABA LA PARTIDA. Antes la sesión seguía «activa» hasta que el usuario
    // pulsaba un botón de la pantalla de Fin (o recargaba): mientras tanto el tablero
    // quedaba secuestrado (no se limpiaba, el autosave local congelado, «Jugar» llevaba al
    // tablero en vez de al hub) y una partida terminada podía seguir de fondo sin señal
    // ninguna. Una partida online tiene principio y fin, como la del tablero local.
    // El fin va DESPUÉS del claim y del historial, que necesitan S.code/S.role.
    // Y AQUÍ SE ACABA LA PARTIDA, de verdad. Antes la sesión seguía «activa» hasta que el
    // usuario pulsaba un botón de la pantalla de Fin (o recargaba): mientras tanto el tablero
    // quedaba secuestrado (no se limpiaba, el autosave local congelado, «Jugar» llevaba al
    // tablero en vez de al hub) y una partida terminada podía seguir de fondo sin señal.
    // Se cierra con un margen corto: el fin aún tiene que publicarse en la sala, llegarle al
    // rival y pintar la pantalla de resultado — apagarlo en el mismo tick se lleva por delante
    // S.code/S.role, que eso necesita. Si mientras tanto empieza OTRA partida («Jugar otra»),
    // el cierre se anula: el código de la sala ya no es el mismo.
    var _endedCode = S.code;
    setTimeout(function () {
      if (!S.active || S.code !== _endedCode || !S.over) return;   // otra partida ya en marcha
      window._pvpMatchEnd && window._pvpMatchEnd();
      S.over = true;   // no re-entrar en endMatchOver con la sesión ya cerrada
    }, S.END_CLOSE_MS);
  }
  // Fin de partida NATURAL (3 puntos o sin banca), decidido por el motor en cualquiera de
  // los dos clientes: cierra el PvP igual que una rendición pero SIN volver a mostrar el
  // overlay (el del tablero ya sale) — solo para el reloj/latidos, marca la sala y guarda.
  window._pvpOnGameOver = function (localWinner) {
    if (!S.active || S.over) return;
    var winnerRole = localWinner === 'p1' ? S.role : (S.role === 'host' ? 'guest' : 'host');
    endMatchOver(winnerRole, 'points', true, true);
  };
  // Traspaso de turno: publicar YA (sin esperar al asentamiento) — es lo único que no viaja
  // como evento y por eso se notaba más lento que el resto.
  window._pvpOnTurnAdvanced = function () {
    if (!S.active || S.over || S.applying || S.replaying) return;
    // `advance()` SOLO corre en el cliente que pasa turno (el otro recibe el cambio en la
    // foto) → aquí siempre toca publicar, venga o no de haber actuado. Condicionarlo a
    // `actorNow` dejaba al rival SIN turno cuando pasabas sin hacer nada.
    S.actorNow = false;
    forcePublish();
    startTurnTimer(false);              // el reloj pasa a ser el del rival
  };
  window._pvpSurrender = function (skipConfirm) {
    if (!S.active || S.over) return;
    var doIt = function () { endMatchOver(S.role === 'host' ? 'guest' : 'host', 'surrender', true); };
    if (skipConfirm || !window.pbConfirm) { doIt(); return; }
    window.pbConfirm({
      title: T2('pvp.surrender'), message: T2('pvp.surrenderQ'),
      okLabel: T2('pvp.surrender'), danger: true
    }).then(function (yes) { if (yes) doIt(); });
  };
  function T2(k, v) { return window.t ? window.t(k, v) : k; }
  // Opciones de partida (⋯): SOLO Rendirse + Registro (nada de los extras del juego real).
  function ensureSurrenderBtn() {
    // En partida ONLINE mandan estos botones: los del tablero local (⋯ + Deshacer) se retiran.
    if (window._pbSyncBoardCorner) window._pbSyncBoardCorner();
    ensureEmoteBtn();   // el botón de emotes vive justo debajo del ⋯ y comparte ciclo de vida
    if (S.over || document.getElementById('pvp-opts-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'pvp-opts-btn'; btn.type = 'button'; btn.className = 'pb-corner-btn';
    btn.setAttribute('aria-label', 'Opciones');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/></svg>';
    var menu = document.createElement('div');
    menu.id = 'pvp-opts-menu'; menu.className = 'pb-corner-menu';
    function onDoc(e) { if (e.target !== btn && !btn.contains(e.target) && !menu.contains(e.target)) closeMenu(); }
    function openMenu()  { positionOptsBtn(); menu.classList.add('open'); btn.classList.add('open'); setTimeout(function () { document.addEventListener('pointerdown', onDoc, true); }, 0); }
    function closeMenu() { menu.classList.remove('open'); btn.classList.remove('open'); document.removeEventListener('pointerdown', onDoc, true); }
    function mkItem(label, danger, onClick) {
      var it = document.createElement('button');
      it.type = 'button'; it.className = 'pvp-opt-item pb-corner-item' + (danger ? ' danger' : '');
      it.textContent = label;
      it.addEventListener('click', function (e) { e.stopPropagation(); closeMenu(); onClick(); });
      return it;
    }
    menu.appendChild(mkItem(T2('log.title'), false, function () { window._toggleActionLog && window._toggleActionLog(); }));
    menu.appendChild(mkItem(T2('pvp.surrender'), true, function () { window._pvpSurrender && window._pvpSurrender(); }));
    btn.addEventListener('click', function (e) { e.stopPropagation(); (menu.classList.contains('open') ? closeMenu : openMenu)(); });
    document.body.appendChild(btn);
    document.body.appendChild(menu);
    positionOptsBtn();
    // el tablero sigue asentando/reescalando durante el arranque (VS/moneda/reparto), a veces sin
    // disparar resize → el ⋯ se recoloca solo cada 500ms durante ~6s y luego para. Sin acoplarse al timer.
    var _n = 0, _iv = setInterval(function () { positionOptsBtn(); if (++_n >= 12) clearInterval(_iv); }, 500);
  }
  // El ⋯ va abajo-izquierda, a la altura de la banca de J1 (como el ☰ de móvil) y el menú
  // abre hacia ARRIBA; los emotes, justo debajo. La GEOMETRÍA es la compartida con el ⋯ del
  // tablero local (window._pbPositionCorner, js/main.js) — una sola implementación.
  function positionOptsBtn() {
    if (window._pbPositionCorner) window._pbPositionCorner('pvp-opts-btn', 'pvp-opts-menu', 'pvp-emote-btn', 'pvp-emote-menu');
  }
  window._pvpEnsureOptsBtn = ensureSurrenderBtn;   // hook de test (headless)

  // ── EMOTES (frases rápidas estilo Clash Royale) ──
  // Viajan como campo ligero `emote {by, id, n}` de la sala: el ID es lo que viaja y cada
  // cliente lo pinta con SU idioma (i18n). Mute local persistido (oculta los del rival, no
  // impide enviar) + cooldown de envío anti-spam. La recepción vive en _pvpOnRoom (dedupe
  // por `n` + ventana de frescura para no re-mostrar el último emote al reconectar).
  // Catálogo, misiones y MAZO (hasta 10 elegidos en el Perfil) viven en js/mastery.js
  // (window.PB_EMOTES). Aquí: el menú = mi mazo + UN emote bloqueado (la misión más
  // cercana) como teaser, y el envío solo admite lo que hay en mi mazo.
  var EMOTE_CD_MS = 2500, EMOTE_MUTE_KEY = 'pocketboard_pvp_emotes_muted_v1';
  function myEmoteDeck() { var E = window.PB_EMOTES; return E ? E.deckFor(E.myView()) : ['hi', 'gl', 'gg', 'nice', 'thanks', 'wow', 'oops']; }
  function emotesMuted() { try { return localStorage.getItem(EMOTE_MUTE_KEY) === '1'; } catch (e) { return false; } }
  function setEmotesMuted(v) {
    try { if (v) localStorage.setItem(EMOTE_MUTE_KEY, '1'); else localStorage.removeItem(EMOTE_MUTE_KEY); } catch (e) {}
    var btn = document.getElementById('pvp-emote-btn');
    if (btn) btn.classList.toggle('muted', !!v);
  }
  function emoteLabel(id) { return window.PB_EMOTES ? window.PB_EMOTES.emoteText(id) : null; }
  function sendEmote(id) {
    if (!S.active || S.over || !S.code) return false;
    if (myEmoteDeck().indexOf(id) < 0) return false;   // solo lo que hay en mi mazo (y por tanto desbloqueado)
    var now = Date.now();
    if (now - (S.lastEmoteSentAt || 0) < EMOTE_CD_MS) return false;   // anti-spam
    S.lastEmoteSentAt = now;
    S.lastEmoteN = now;   // mi propio eco en el snapshot no se re-muestra
    var r = window.pbPvp;
    if (r && r.set) r.set(S.code, { emote: { by: S.role, id: id, n: now } }).catch(function () {});
    showEmoteBubble(id, 'mine');
    return true;
  }
  // Ancla del bocadillo: la columna de los botones (borde izq. de los slots) a la altura de
  // la banca de cada lado — el mío abajo (junto a los botones), el del rival arriba (espejo).
  // El del rival va en ESPEJO COMPLETO (X e Y): el tablero es simétrico por rotación, así que
  // el hueco «entre banca y estadio» que en mi lado ocupan los botones (donde sale mi bocadillo)
  // es, en el lado del rival, el hueco de la DERECHA a la altura de su banca — vacío. Antes solo
  // se espejaba en Y y caía sobre su pila de descartes (feo, reporte de Daniel).
  function emoteAnchor(side) {
    var zone = document.getElementById(side === 'mine' ? 'zone-p1' : 'zone-p2');
    if (!zone) return null;
    var bench = zone.querySelector('.bench-zone') || zone;
    var rb = bench.getBoundingClientRect();
    if (!rb.width) return null;
    var minLeft = Infinity, maxRight = -Infinity;
    zone.querySelectorAll('.slot').forEach(function (s) { var r = s.getBoundingClientRect(); if (r.width) { if (r.left < minLeft) minLeft = r.left; if (r.right > maxRight) maxRight = r.right; } });
    if (!isFinite(minLeft)) return null;
    var y = side === 'mine' ? rb.top + rb.height * 0.25 : rb.bottom - rb.height * 0.25;
    return { x: Math.round(minLeft), xr: Math.round(maxRight), y: Math.round(y) };
  }
  function showEmoteBubble(id, side) {
    var text = emoteLabel(id);
    if (!text) return;
    var a = emoteAnchor(side);
    var old = document.getElementById('pvp-emote-bub-' + side);
    if (old) old.remove();
    var b = document.createElement('div');
    b.id = 'pvp-emote-bub-' + side;
    b.className = 'pvp-emote-bubble ' + (side === 'mine' ? 'mine' : 'opp');
    b.textContent = text;
    if (a) {
      if (side === 'mine') b.style.left = (a.x + 46) + 'px';                            // libra la columna de botones
      else { b.style.right = (window.innerWidth - (a.xr - 46)) + 'px'; b.style.left = 'auto'; }   // espejo exacto, a la derecha
      b.style.top = a.y + 'px';
    } else {
      b.style.left = '50%';
      b.style.top = side === 'mine' ? '72%' : '26%';
    }
    document.body.appendChild(b);
    setTimeout(function () {
      if (!b.isConnected) return;
      b.classList.add('leaving');
      setTimeout(function () { b.remove(); }, 320);
    }, 3200);
  }
  function ensureEmoteBtn() {
    if (S.over || document.getElementById('pvp-emote-btn')) return;
    var btn = document.createElement('button');
    btn.id = 'pvp-emote-btn'; btn.type = 'button'; btn.className = 'pb-corner-btn';
    btn.setAttribute('aria-label', T2('pvp.emotes'));
    btn.title = T2('pvp.emotes');
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.3c0 3.9-4 7-9 7-1 0-2-.12-2.9-.36L4.6 19.6l1.05-2.8C4.06 15.53 3 13.52 3 11.3c0-3.9 4-7 9-7s9 3.1 9 7z"/><circle cx="8.3" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="11.3" r="1" fill="currentColor" stroke="none"/><circle cx="15.7" cy="11.3" r="1" fill="currentColor" stroke="none"/></svg>';
    btn.classList.toggle('muted', emotesMuted());
    var menu = document.createElement('div');
    menu.id = 'pvp-emote-menu';
    function onDoc(e) { if (e.target !== btn && !btn.contains(e.target) && !menu.contains(e.target)) closeMenu(); }
    // El menú se RECONSTRUYE en cada apertura → idioma y estado de mute siempre al día
    function buildMenu() {
      menu.innerHTML = '';
      var cooling = Date.now() - (S.lastEmoteSentAt || 0) < EMOTE_CD_MS;
      var E = window.PB_EMOTES;
      var deck = myEmoteDeck();
      deck.forEach(function (id) {
        var it = document.createElement('button');
        it.type = 'button'; it.className = 'pvp-emote-item' + (cooling ? ' cooling' : '');
        it.textContent = emoteLabel(id) || id;
        it.addEventListener('click', function (e) {
          e.stopPropagation();
          if (sendEmote(id)) closeMenu();
        });
        menu.appendChild(it);
      });
      // TEASER: el emote de la misión más cercana, atenuado y con candado; al tocarlo, una
      // pista LOCAL de dónde se consigue (no se envía nada). Genera interés por el Perfil.
      var near = E ? E.nearestLocked(E.myView()) : null;
      if (near && deck.indexOf(near.m.emote) < 0) {
        var lk = document.createElement('button');
        lk.type = 'button'; lk.className = 'pvp-emote-item locked'; lk.setAttribute('aria-disabled', 'true');
        lk.innerHTML = '<span class="pvp-emote-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg></span><span class="pvp-emote-lktext"></span>';
        lk.querySelector('.pvp-emote-lktext').textContent = emoteLabel(near.m.emote) || '';
        lk.title = T2('emote.lockedHint');
        lk.addEventListener('click', function (e) {
          e.stopPropagation();
          var old = menu.querySelector('.pvp-emote-hint'); if (old) old.remove();
          var hint = document.createElement('div');
          hint.className = 'pvp-emote-hint';
          hint.textContent = T2('emote.lockedHint') + ' · ' + (E.missionTitle(near.m) || '');
          var sepEl = menu.querySelector('.pvp-emote-sep');
          if (sepEl) menu.insertBefore(hint, sepEl); else menu.appendChild(hint);
          setTimeout(function () { if (hint.isConnected) hint.remove(); }, 2600);
        });
        menu.appendChild(lk);
      }
      menu.classList.toggle('wide', menu.querySelectorAll('.pvp-emote-item').length > 6);
      var sep = document.createElement('div'); sep.className = 'pvp-emote-sep';
      menu.appendChild(sep);
      var mu = document.createElement('button');
      mu.type = 'button'; mu.className = 'pvp-emote-mute';
      mu.textContent = T2(emotesMuted() ? 'emote.unmute' : 'emote.mute');
      mu.addEventListener('click', function (e) {
        e.stopPropagation();
        setEmotesMuted(!emotesMuted());
        mu.textContent = T2(emotesMuted() ? 'emote.unmute' : 'emote.mute');
      });
      menu.appendChild(mu);
    }
    function openMenu()  { buildMenu(); positionOptsBtn(); menu.classList.add('open'); btn.classList.add('open'); setTimeout(function () { document.addEventListener('pointerdown', onDoc, true); }, 0); }
    function closeMenu() { menu.classList.remove('open'); btn.classList.remove('open'); document.removeEventListener('pointerdown', onDoc, true); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); (menu.classList.contains('open') ? closeMenu : openMenu)(); });
    document.body.appendChild(btn);
    document.body.appendChild(menu);
  }
  window._pvpSendEmote = sendEmote;               // hooks de test (headless)
  window._pvpShowEmoteBubble = showEmoteBubble;

  // ── VIGILANTE del tablero (PvP): que una partida NUNCA se quede encallada ──
  // Caso real (playtest de Daniel): noqueas al Activo del rival, sale «elige nuevo Activo»,
  // desaparece solo y el Pokémon se queda a 0 PS en el hueco con la partida parada. En una
  // partida en vivo no vale con arreglar el disparador concreto: el tablero tiene que
  // recuperarse solo de cualquier hueco que quede colgando.
  var WATCH_MS = 1500, ZOMBIE_MS = 3000;
  function boardWatchdog() {
    if (!S.active || S.over || S.applying || S.evRunning) return;
    // 0) TRASPASO PERDIDO (red de seguridad): pasé mi turno (turn local = p2) siendo actor,
    //    pero el pub del traspaso no llegó a salir (un settle cayó en S.applying, o el
    //    endTurn fue tan rápido que ningún settle me había marcado actor). Sin él, AMBOS
    //    clientes ven «no es tu turno» para siempre (bug del playtest de Daniel). El único
    //    que puede desatascar es este cliente → re-publicar el estado del traspaso.
    if (S.actorNow && window.activeTurn === 'p2' && !S.replaying &&
        !(window._pvpChoiceActive && window._pvpChoiceActive())) {
      try { window._pvpOnSettled && window._pvpBuildPayload && window._pvpOnSettled(window._pvpBuildPayload()); } catch (e) {}
    }
    // 1) Pokémon a 0 PS en un Activo sin KO resolviéndose → resolverlo.
    //    OJO: NO mientras el KO esté DIFERIDO a propósito — secuencia de ataque en curso
    //    (_pbAtkDeferKO: efectos → KO → nuevo Activo → turno), beats de fin de turno
    //    (_pbDeferKO), una elección/panel abiertos (Delcatty, Mega Absol…) o la mano del
    //    rival pedida por red (S.handReq). El vigilante REMATABA el KO a los 3s por
    //    detrás del panel (bug de Daniel con Mega Absol).
    var deferred = window._pbAtkDeferKO || window._pbDeferKO ||
                   (window._pbBeatQ && window._pbBeatQ.length) || S.handReq || S.deckReq || S.hiddenDiscardReq || S.hiddenDiscardOwned ||
                   S.pubPending === 'revealHand' || S.pubPending === 'deckCount' || S.pubPending === 'hiddenDiscard' ||   // el ATACANTE está a mitad de efecto sobre una zona privada: su KO llegará después
                   (window._uiChoiceOpen && window._uiChoiceOpen());
    ['p1', 'p2'].forEach(function (side) {
      var c = document.querySelector('#zone-' + side + ' .active-slot .card');
      if (!c) return;
      if (deferred) { c._zombieSince = 0; return; }   // diferido legítimo: el reloj zombi ni corre
      var hp = parseInt(c.dataset.hpCur);
      if (isNaN(hp) || hp > 0 || c._discarding) { c._zombieSince = 0; return; }
      if (!c._zombieSince) { c._zombieSince = Date.now(); return; }
      if (Date.now() - c._zombieSince > ZOMBIE_MS) {
        c._zombieSince = 0;
        console.warn('[pvp-sync] KO encallado: resolviéndolo');
        window.sendToDiscard && window.sendToDiscard(c);
      }
    });
    // 2) promoción esperando pero sin banca resaltada (un re-montaje se llevó el aviso)
    var pl = window._pbAwaitingPromote;
    if (pl && !document.querySelector('#zone-' + pl + ' .card.fx-target')) {
      // RANCIA (el Activo de ese lado YA está ocupado — la resolvió un snapshot o una carrera
      // de choices) → sanear el capturador modal, que si no se traga todos los clics del
      // tablero el resto de la partida. Si no es rancia, solo re-pintar el resaltado.
      if (!(window._pbHealStalePromote && window._pbHealStalePromote())) {
        window._pbRehighlightPromote && window._pbRehighlightPromote();
      }
    } else if (pl && window._pbHealStalePromote) {
      window._pbHealStalePromote();
    }
  }
  function startWatchdog() { stopWatchdog(); S.watch = setInterval(boardWatchdog, WATCH_MS); }
  function stopWatchdog() { if (S.watch) { clearInterval(S.watch); S.watch = null; } }
  window._pvpWatchdog = boardWatchdog;   // hook de test

  // ── Latidos + desconexión → victoria (~60s) ──
  S.RECON_MS = 15000;   // aviso «Rival reconectando…»
  S.LOSS_MS = 60000;    // sin señal → victoria del que queda
  // Relojes de ESTA partida = los del formato (js/formats.js). Fallback = los de Estándar.
  function fmtClock() {
    var f = window._pvpFormat || S.fmt || 'standard';
    if (window.formatClock) { try { return window.formatClock(f); } catch (e) {} }
    return { setup: 45000, turn: 90000, match: 20 * 60000 };
  }
  function beatNow() {
    var r = window.pbPvp;
    if (!r || !S.code || !S.active || S.over) return;
    var patch = { seen: {} };
    patch.seen[S.role] = Date.now();
    r.set(S.code, patch).catch(function () {});
  }
  function startHeartbeat() {
    stopHeartbeat();
    var beat = beatNow;
    beat();
    // 8s (antes 5): mismo comportamiento con RECON_MS 15s / LOSS_MS 60s, ~40% menos
    // escrituras de latido en Firestore por partida.
    S.hb = setInterval(beat, 8000);
  }
  function stopHeartbeat() { if (S.hb) { clearInterval(S.hb); S.hb = null; } }
  function showReconnecting() {
    if (document.getElementById('pvp-reconnecting')) return;
    var el = document.createElement('div');
    el.id = 'pvp-reconnecting';
    el.textContent = T2('pvp.oppReconnecting');
    document.body.appendChild(el);
  }
  function hideReconnecting() {
    var el = document.getElementById('pvp-reconnecting');
    if (el) el.remove();
  }
  // DESPERTAR de la pestaña. Una pestaña en segundo plano ve sus temporizadores ralentizados
  // y el sistema puede congelarla entera (móvil con la pantalla apagada, portátil dormido).
  // Al volver, MI reloj ha avanzado pero la última señal del rival que procesé es vieja →
  // sin esto se pintaba «Rival reconectando…» y, pasados 60s, se declaraba una victoria por
  // desconexión FALSA contra alguien que no se había movido de su sitio.
  S.WAKE_GRACE = 12000;   // tras despertar, no se juzga al rival durante este rato
  S.SKIP_WINDOW = 4000;   // ventana en la que lo perdido se resuelve saltando al estado real
  function markWake() {
    var now = Date.now();
    S.wakeAt = now;
    S._oppSeenAt = now;           // el silencio fue MÍO: el contador del rival empieza de cero
    S.skipUntil = now + S.SKIP_WINDOW;
    hideReconnecting();
    if (S.active && !S.over) { try { beatNow(); } catch (e) {} }   // avisar YA de que sigo aquí
  }
  window._pvpMarkWake = markWake;   // hook de test
  if (!window.__pvpWakeBound) {
    window.__pvpWakeBound = 1;
    document.addEventListener('visibilitychange', function () { if (!document.hidden) markWake(); });
    window.addEventListener('pageshow', function () { markWake(); });
    // Red para las pausas que NO disparan visibilitychange: si entre dos ticks pasa mucho
    // más de lo esperado, la pausa fue de esta pestaña, no del rival.
    var _lastTick = Date.now();
    setInterval(function () {
      var now = Date.now();
      if (now - _lastTick > 6000) markWake();
      _lastTick = now;
      try { paintDbg(); } catch (e) {}   // que el chip no se quede rancio si el rival deja de emitir
    }, 2000);
  }
  // Comparar el VALOR del latido rival con MI reloj (inmune al desfase entre dispositivos).
  function checkPresence(room) {
    if (!S.active || S.over) return;
    var opp = S.role === 'host' ? 'guest' : 'host';
    var val = room.seen && room.seen[opp];
    if (val == null) return;
    var now = Date.now();
    // DESFASE DE RELOJES entre los dos dispositivos: el latido lo escribe el rival con SU
    // reloj cada 8s, así que su diferencia con el mío lo mide — y es una medida INDEPENDIENTE
    // de los lotes de eventos que hay que juzgar (por eso no se puede sacar de su propio evTs:
    // eso anularía la guarda). Se queda con el MÁXIMO visto = la observación más fresca; error
    // siempre hacia «el rival es más nuevo», que es el lado seguro (nunca descartar de más).
    var off = val - now;
    if (S.peerClockOff == null || off > S.peerClockOff) S.peerClockOff = off;
    if (S._oppSeenVal !== val) { S._oppSeenVal = val; S._oppSeenAt = now; hideReconnecting(); return; }
    if (now - (S.wakeAt || 0) < S.WAKE_GRACE) { S._oppSeenAt = now; return; }   // acabo de despertar
    var quiet = now - (S._oppSeenAt || now);
    if (quiet > S.LOSS_MS) endMatchOver(S.role, 'disconnect', true);
    else if (quiet > S.RECON_MS) showReconnecting();
  }
  window._pvpCheckPresence = checkPresence;   // hook de test

  // ═══ TANDA 4: RELOJ POR TURNO (Pocket real: 90s/turno, verificado Game8/Pokémon Zone) ═══
  // Cada cliente cuenta EN LOCAL desde que le llega el turno (sin depender del reloj del
  // rival). Solo el cliente del jugador EN TURNO auto-termina; el otro solo lo muestra.
  // AFK: 3 turnos seguidos SIN ninguna acción → derrota (el tope global de 20 min de
  // Pocket queda pendiente como refinamiento).
  S.TURN_MS = 90000;
  S.afkCount = 0;
  function paintDbg() {}
  // UN chip: el reloj del jugador EN TURNO (tenue en el turno del rival). Se coloca bajo el
  // marcador de J2 (arriba), a su X, sobre el tablero (posición fijada por JS cada tick).
  function positionTimer() {
    var el = document.getElementById('pvp-turn-timer');
    if (!el) return;
    var bar = document.getElementById('bar-p2');
    if (!bar) return;
    var idn = bar.querySelector('.bar-identity') || bar;
    var rb = bar.getBoundingClientRect(), ri = idn.getBoundingClientRect();
    if (!rb.width) return;
    el.style.left = Math.round(ri.left + ri.width / 2) + 'px';   // X: centrado en el marcador de J2
    el.style.top  = Math.round(rb.bottom + 6) + 'px';            // Y: justo debajo de la barra de J2
  }
  if (!window.__pvpTimerResizeBound) { window.__pvpTimerResizeBound = 1; window.addEventListener('resize', function () { positionTimer(); positionOptsBtn(); }); }
  function timerEl() {
    var el = document.getElementById('pvp-turn-timer');
    if (!el) {
      el = document.createElement('div');
      el.id = 'pvp-turn-timer';
      el.innerHTML = '<span class="pt-ico">⏱</span><span class="pt-num"></span><span class="pt-total"></span>';
      document.body.appendChild(el);
    }
    positionTimer();
    return el;
  }
  function clearTurnTimer() {
    if (S.turnTick) { clearInterval(S.turnTick); S.turnTick = null; }
    var el = document.getElementById('pvp-turn-timer');
    if (el) el.remove();
  }

  // ═══ RELOJ DE LA FASE DE COLOCACIÓN ═══
  // Sin él, un rival que se va a hacer café dejaba la partida colgada para siempre: no hay
  // reloj hasta que empieza el primer turno. Dura lo que diga el FORMATO (Estándar 45s,
  // Advanced 60s) y se ancla a un instante COMPARTIDO (`setupAt`, publicado por el host)
  // para que los dos vean el mismo número y una reconexión no lo reinicie.
  // AGOTARLO = DERROTA (decisión de Daniel). Si ninguno de los dos ha colocado, empate.
  function clearSetupTimer() {
    if (S.setupTick) { clearInterval(S.setupTick); S.setupTick = null; }
    var el = document.getElementById('pvp-turn-timer');
    if (el && el.classList.contains('setup')) el.remove();
  }
  function armSetupTimer(at) {
    if (!S.active || S.over || S.placementReleased) return;
    if (!S.SETUP_MS) S.SETUP_MS = fmtClock().setup;   // defensivo (partida montada sin matchBegin)
    if (at) S.setupAt = at;
    if (!S.setupAt) {
      S.setupAt = Date.now();
      // el host es el ancla: publica el instante y el invitado lo adopta por onRoom
      if (S.role === 'host' && window.pbPvp && S.code) {
        try { window.pbPvp.set(S.code, { setupAt: S.setupAt }); } catch (e) {}
      }
    }
    if (S.setupTick) clearInterval(S.setupTick);
    // El ancla la publica el HOST con su reloj → para el invitado es AJENA (hay que corregirla
    // y acotarla); a partir de aquí el que cuenta es mi reloj.
    S.setupBase = sharedElapsed(S.setupAt, S.SETUP_MS, S.role !== 'host');
    S.setupArmedAt = Date.now();
    var paint = function () {
      if (!S.active || S.over || S.placementReleased) { clearSetupTimer(); return; }
      var gone = S.setupBase + (Date.now() - S.setupArmedAt);
      var left = Math.max(0, Math.ceil((S.SETUP_MS - gone) / 1000));
      var el = timerEl();
      el.classList.add('setup', 'mine');
      el.classList.toggle('low', left <= 10);
      el.querySelector('.pt-num').textContent = left + 's';
      if (left <= 0) onSetupTimeout();
    };
    paint();
    S.setupTick = setInterval(paint, 1000);
  }
  function onSetupTimeout() {
    if (!S.active || S.over || S.placementReleased) return;
    // Red: aunque el ancla llegue vencida, nadie pierde sin que este cliente haya visto pasar
    // el tiempo de verdad (con el reloj del otro atrasado, esto era una derrota instantánea).
    if (Date.now() - (S.setupArmedAt || 0) < graceMs(S.SETUP_MS)) return;
    // Los DOS han colocado justo al filo: la liberación ya está en marcha (tarda ~0,8s por
    // la secuencia de revelado) → nadie pierde por ese margen.
    if (S.readySent && S.oppDone) return;
    var opp = S.role === 'host' ? 'guest' : 'host';
    var iReady = !!S.readySent;
    if (!iReady && !S.oppDone) { endMatchOver('draw', 'setupTimeout', true); return; }
    if (!iReady) { endMatchOver(opp, 'setupTimeout', true); return; }   // declaro MI derrota
    // Yo listo y el rival no: es ÉL quien debe declararse. Le doy un margen por si está
    // desconectado (su cliente no puede declarar nada) y entonces lo declaro yo.
    if (!S.setupGraceAt) { S.setupGraceAt = Date.now(); return; }
    if (Date.now() - S.setupGraceAt > 6000) endMatchOver(S.role, 'setupTimeout', true);
  }
  window._pvpArmSetupTimer = armSetupTimer;   // hooks de test
  window._pvpSetupTimeout = onSetupTimeout;
  window._pvpClearSetupTimer = clearSetupTimer;

  // ═══ TOPE GLOBAL POR JUGADOR (Pocket real: 20 min; Advanced 30 por formato) ═══
  // Se acumula el tiempo de MIS turnos y se publica en la sala (`clock.{rol}`) para que
  // sobreviva a una reconexión y el rival pueda verlo. Al agotarse: gana quien más puntos
  // tenga; empate si van iguales (como el juego real).
  // Lo gastado en el turno EN CURSO, contado con mi reloj y con techo: por muy desfasada que
  // venga el ancla, nadie puede quemarse el tope global de la partida en un solo turno.
  function turnSpent() {
    if (!S.turnArmedAt) return 0;
    return Math.min((S.turnBase || 0) + Math.max(0, Date.now() - S.turnArmedAt), (S.TURN_MS || 90000) * 2);
  }
  function commitTurnTime() {
    if (!S.turnMine || !S.turnArmedAt) return;
    if (!S.used) S.used = { host: 0, guest: 0 };
    S.used[S.role] = (S.used[S.role] || 0) + turnSpent();
    if (window.pbPvp && S.code && !S.over) {
      var patch = { clock: {} };
      patch.clock[S.role] = S.used[S.role];
      try { window.pbPvp.set(S.code, patch).catch(function () {}); } catch (e) {}
    }
  }
  function usedLive() {
    var base = (S.used && S.used[S.role]) || 0;
    return base + (S.turnMine ? turnSpent() : 0);
  }
  function matchTimeUp() {
    if (!S.active || S.over) return;
    clearTurnTimer();
    var sc = window._pbScores || {};
    var mine = sc.p1 || 0, theirs = sc.p2 || 0;
    var opp = S.role === 'host' ? 'guest' : 'host';
    var winner = mine > theirs ? S.role : (theirs > mine ? opp : 'draw');
    endMatchOver(winner, 'timeout', true);
  }
  window._pvpCommitTurnTime = commitTurnTime;   // hooks de test
  window._pvpUsedLive = usedLive;
  window._pvpMatchTimeUp = matchTimeUp;
  // El reloj de turno NO vive en un contador local (se reiniciaba a 90s al recargar): se ancla
  // a un instante COMPARTIDO (turnAt) que el jugador ACTIVO fija y publica en la sala, y que el
  // rival y cualquier RECONEXIÓN LEEN → ambos ven el mismo tiempo y una recarga lo conserva.
  function publishTurnAt(at) {
    if (!S.code || !window.pbPvp || S.over) return;
    window.pbPvp.update(S.code, { turnAt: at, turnAtBy: S.role }).catch(function () {});
  }
  function startTurnTimer(mine, atOverride, atFromPeer) {
    if (!S.active || S.over || !S.placementReleased) return;
    // El turno deja de ser mío: consolidar lo que he gastado (tope global) antes de nada.
    if (S.turnMine && !mine) commitTurnTime();
    clearSetupTimer();
    clearTurnTimer();
    S.turnMine = !!mine;
    if (atOverride != null) {
      S.turnAt = atOverride;                 // reanudar / adoptar el compartido → NO reiniciar
      S.turnBase = sharedElapsed(atOverride, S.TURN_MS, !!atFromPeer);
    } else if (mine) {
      S.turnAt = Date.now();                 // mi turno arranca AHORA → fijarlo y compartirlo
      S.turnBase = 0;
      publishTurnAt(S.turnAt);
    } else {
      S.turnAt = Date.now();                 // turno del rival recién iniciado: aprox (se corrige al llegar SU turnAt por onRoom)
      S.turnBase = 0;
    }
    S.turnArmedAt = Date.now();
    if (mine) S.actedThisTurn = false;
    // botón de turno atenuado cuando NO es tu turno (el guard real vive en endTurn)
    var etBtn = document.getElementById('btn-end-turn');
    if (etBtn) etBtn.classList.toggle('pvp-wait', !mine);
    S._lowSfxDone = false;
    var paint = function () {
      var left = Math.max(0, Math.ceil((S.TURN_MS - turnSpent()) / 1000));
      var el = timerEl();
      el.classList.remove('setup');
      el.querySelector('.pt-num').textContent = left + 's';
      el.classList.toggle('mine', S.turnMine);   // tu turno: normal · turno del rival: tenue
      // Tope global del jugador EN TURNO: solo se enseña cuando ya queda poco (si no, es ruido).
      var tot = el.querySelector('.pt-total');
      if (tot && S.MATCH_MS) {
        var who = S.turnMine ? usedLive() : ((S.used && S.used[S.role === 'host' ? 'guest' : 'host']) || 0);
        var rest = Math.max(0, S.MATCH_MS - who);
        var showTot = rest <= 5 * 60000;
        tot.textContent = showTot ? (Math.floor(rest / 60000) + ':' + ('0' + Math.floor((rest % 60000) / 1000)).slice(-2)) : '';
        el.classList.toggle('has-total', showTot);
        if (S.turnMine && rest <= 0) { matchTimeUp(); return; }
      }
      var low = S.turnMine && left <= 10;
      el.classList.toggle('low', low);
      if (low && !S._lowSfxDone) { S._lowSfxDone = true; try { window.sfx && window.sfx('pvp.timerLow'); } catch (e) {} }   // SFX una vez al llegar a 10s
      if (left <= 0 && S.turnMine) {
        // Red: un ancla vencida no puede comerse el turno nada más empezarlo (con el reloj del
        // rival atrasado el turno se auto-terminaba al instante y no se podía hacer nada). El
        // reloj se queda a 0s —SIN matar el tick— y vence cuando ESTE cliente ha visto pasar
        // el tiempo de verdad.
        if (Date.now() - S.turnArmedAt >= graceMs(S.TURN_MS)) autoEndTurn();
      } else if (left <= 0) { clearInterval(S.turnTick); S.turnTick = null; }   // reloj del rival: informativo
    };
    paint();
    S.turnTick = setInterval(paint, 1000);
  }
  function autoEndTurn() {
    if (!S.active || S.over || !S.turnMine) return;
    clearTurnTimer();
    // elección interactiva en vuelo (promoción/objetivo) → margen extra y reintenta
    if (window._pbAwaitingPromote || S.choiceArmed) {
      startTurnTimer(true, Date.now() - (S.TURN_MS - 8000));
      return;
    }
    if (!S.actedThisTurn) {
      S.afkCount += 1;
      if (S.afkCount >= 3) { endMatchOver(S.role === 'host' ? 'guest' : 'host', 'afk', true); return; }
    } else {
      S.afkCount = 0;
    }
    window._boardNotice && window._boardNotice(T2('pvp.turnTimeout'));
    window.endTurn && window.endTurn();
  }
  window._pvpStartTurnTimer = startTurnTimer;   // hooks de test
  window._pvpAutoEndTurn = autoEndTurn;

  // ═══ TANDA 6a: PUBLISH RÁPIDO (latencia) ═══
  // La señal del checkpoint del deshacer tarda ~1,1s (su debounce). Este observer propio
  // publica a los ~300ms de calma tras una mutación del tablero, con los MISMOS guards
  // (mitad-de-acción) y el MISMO dedupe por firma → el camino lento simplemente deduplica.
  var FAST_MS = 300;
  var _fastT = null, _fastObs = null;
  function armFastPublish() {
    if (_fastObs) return;
    var root = document.getElementById('page-wrap');
    if (!root || typeof MutationObserver === 'undefined') return;
    _fastObs = new MutationObserver(function () {
      if (!S.active || S.applying || S.replaying || S.evRunning || S.over) return;
      if (_fastT) clearTimeout(_fastT);
      _fastT = setTimeout(function () {
        _fastT = null;
        if (!S.active || S.applying || S.replaying || S.evRunning || S.over) return;
        if (window._pvpChoiceActive && window._pvpChoiceActive()) return;   // mitad de acción → publicará el settle
        if (!window._pvpBuildPayload) return;
        try { window._pvpOnSettled(window._pvpBuildPayload()); } catch (e) {}
      }, FAST_MS);
    });
    // sin 'style' en el filtro: los tilts/vuelos en vivo lo mutan sin parar (ruido);
    // los cambios de estado real llegan por childList/data-*/class
    _fastObs.observe(root, { childList: true, subtree: true, attributes: true,
      attributeFilter: ['data-hp-cur', 'data-hp-max', 'data-energy-type', 'class'] });
  }
  function disarmFastPublish() {
    if (_fastT) { clearTimeout(_fastT); _fastT = null; }
    if (_fastObs) { try { _fastObs.disconnect(); } catch (e) {} _fastObs = null; }
  }

  // Hooks de test
  window._pvpPubFrom = pubFromPayload;
  window._pvpPayloadFrom = payloadFromPub;
  window._pvpApplyPub = applyPub;
  window._pvpApplyOppSide = applyOppSide;   // hook de test (lado del rival durante la colocación)
  window._pvpSwapSides = swapSides;
})();
