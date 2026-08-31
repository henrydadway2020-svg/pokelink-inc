/* ══════════════════════════════════════════════════════════════
   cloud-sync.js — Sincronización del estado del usuario en la nube (Firestore)
   Depende de window.pbAuth / evento 'pb-auth' y de window.pbDB (módulo de index.html).
   Documento /users/{uid} = { settings:{clave:valor}, lists:{clave:[items]}, updatedAt }.

   AJUSTES (valores sueltos: idioma, color de tapete): la NUBE MANDA — al entrar se
   aplican los de la cuenta; al cambiar uno, se guarda (debounce). Cada clave lleva un
   "applier" para aplicarla en vivo.

   LISTAS (escenarios, tierlists, Mis Mazos): la 1ª vez en un dispositivo se FUSIONAN (unión por
   id, sin perder nada de la nube ni de local); a partir de ahí la nube manda (replace),
   así se propagan los borrados. Al cambiar una lista, se sube. (Caveat conocido v1: si
   borras en un dispositivo y otro estaba desactualizado offline, ese ítem puede
   reaparecer al sincronizar el dispositivo viejo — raro en listas personales.)

   Sin sesión: no toca nada (todo sigue en local como hoy).
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // ── Ajustes (clave localStorage → cómo aplicarla en vivo al traerla) ──
  var APPLIERS = {
    'pocketboard_lang_v1': function (v) { if (window.i18n && window.i18n.setLang) window.i18n.setLang(v); },
    'pocketboard_felt_v1': function (v) { if (window.pickPreset) window.pickPreset(v); },   // color del tapete
    // Modo de reglas (sandbox/normal): el default es siempre 'normal'; el sandbox SOLO
    // persiste para usuarios con sesión → se sincroniza aquí (la nube manda al entrar).
    'pocketboard_rules_mode_v1': function (v) { if (window.pbSetRulesMode) window.pbSetRulesMode(v); },
    // Tierlist «Fijar» (anclar/encoger al bajar): preferencia guardada en la cuenta.
    'pocketboard_tl_collapse_v1': function (v) { if (window._tlSetCollapse) window._tlSetCollapse(v === '1'); },
    // Mazo activo (id del mazo elegido para jugar, modelo TCG Live). El applier persiste + refresca el hub.
    'pocketboard_active_deck_v1': function (v) { try { if (v != null) localStorage.setItem('pocketboard_active_deck_v1', String(v)); } catch (e) {} if (window._jugarRefresh) window._jugarRefresh(); },
    // Marca por cuenta: ya se decidió (regalo o no) la baraja de bienvenida.
    // Viaja con los ajustes para que borrarla no haga reaparecer el regalo en otro dispositivo.
    'pocketboard_welcome_deck_v1': function (v) { try { if (v != null) localStorage.setItem('pocketboard_welcome_deck_v1', String(v)); } catch (e) {} },
    // Perfil / Maestría Pokémon: emblemas equipados + misiones reclamadas
    'pocketboard_emblems_v1': function (v) { try { if (v != null) localStorage.setItem('pocketboard_emblems_v1', String(v)); } catch (e) {} if (window._perfilInitialised && window._perfilRefresh) window._perfilRefresh(); },
    'pocketboard_missions_v1': function (v) { try { if (v != null) localStorage.setItem('pocketboard_missions_v1', String(v)); } catch (e) {} if (window._perfilInitialised && window._perfilRefresh) window._perfilRefresh(); },
    // Mazo de emotes de partida (hasta 10 ids del catálogo de js/mastery.js)
    'pocketboard_emote_deck_v1': function (v) { try { if (v != null) localStorage.setItem('pocketboard_emote_deck_v1', String(v)); } catch (e) {} if (window._perfilInitialised && window._perfilRefresh) window._perfilRefresh(); }
  };
  var SYNC_KEYS = Object.keys(APPLIERS);
  // Dueño de las listas que están materializadas en este navegador. No se sube:
  // sirve para que iniciar una segunda cuenta no fusione ni suba los mazos de la
  // primera. Sin marca (instalaciones anteriores) se conserva la adopción histórica.
  var LOCAL_OWNER_KEY = 'pbsync_local_owner_v1';
  var UNSIGNED_OWNER_KEY = 'pbsync_unsigned_owner_v1';
  var NAMESPACE_PREFIX = 'pbsync_namespace_v1_';
  var WELCOME_PENDING_PREFIX = 'pbsync_welcome_pending_v1_';
  // Outbox mínimo por cuenta. Conserva qué campos locales aún no han quedado
  // confirmados en Firestore, incluso si Firebase cierra la sesión desde otra pestaña.
  var DIRTY_PREFIX = 'pbsync_dirty_v1_';
  var REMOTE_VERSION_PREFIX = 'pbsync_remote_version_v1_';
  var ACCOUNT_SETTING_KEYS = [
    'pocketboard_active_deck_v1', 'pocketboard_welcome_deck_v1',
    'pocketboard_emblems_v1', 'pocketboard_missions_v1', 'pocketboard_emote_deck_v1'
  ];

  // ── Listas (clave localStorage → campo de timestamp para resolver conflictos por id) ──
  var LIBRARY_KEY = 'pocketboard_library_v1';   // su ORDEN es dato del usuario (ver listMerge)
  var LIST_KEYS = {
    'pocketboard_scenarios_v1': 'ts',
    'pocketboard_tierlists_v1': 'savedAt',
    'pocketboard_library_v1':   'savedAt',  // Mis Mazos (cada mazo lleva id + savedAt)
    'pocketboard_favorites_v1': 'savedAt',  // cartas favoritas ({id, savedAt})
    'pocketboard_pvp_history_v1': 'ts'      // historial PvP propio ({id, ts, result, reason, opp})
  };

  // ── Mapas de progreso (merge por clave; ni cloud-wins ni lista) ──
  // cues (pistas de gestos): { cueId:{shown,done} } → merge = OR(done), max(shown).
  var MERGE_KEYS = {
    'pocketboard_cues_v1': function (cloud, local) {
      var out = {}, ids = {};
      [cloud, local].forEach(function (o) { Object.keys(o || {}).forEach(function (id) { ids[id] = 1; }); });
      Object.keys(ids).forEach(function (id) {
        var c = (cloud && cloud[id]) || {}, l = (local && local[id]) || {};
        out[id] = { shown: Math.max(c.shown || 0, l.shown || 0), done: !!(c.done || l.done) };
      });
      return out;
    }
  };
  function namespaceKeys() {
    return Object.keys(LIST_KEYS).concat(ACCOUNT_SETTING_KEYS, Object.keys(MERGE_KEYS));
  }
  function namespaceKey(owner, key) { return NAMESPACE_PREFIX + encodeURIComponent(owner) + '::' + key; }
  function namespaceSentinel(owner) { return NAMESPACE_PREFIX + encodeURIComponent(owner) + '::__exists'; }
  function namespaceExists(owner) {
    if (!owner) return false;
    try {
      if (localStorage.getItem(namespaceSentinel(owner)) === '1') return true;
      return namespaceKeys().some(function (k) { return localStorage.getItem(namespaceKey(owner, k)) != null; });
    } catch (e) { return false; }
  }
  function materializedHasAccountData() {
    try { return namespaceKeys().some(function (k) { return localStorage.getItem(k) != null; }); }
    catch (e) { return false; }
  }
  function hasAdoptedUid(uid) {
    try {
      return Object.keys(LIST_KEYS).some(function (k) { return localStorage.getItem('pbsync_' + uid + '_' + k) === '1'; });
    } catch (e) { return false; }
  }
  // Mueve, no copia: las cuentas inactivas ocupan una sola vez el espacio de
  // localStorage y el estado materializado pertenece siempre a un único dueño.
  function captureNamespace(owner) {
    if (!owner) return true;
    var moved = [];
    _applying = true;
    try {
      namespaceKeys().forEach(function (k) {
        var nk = namespaceKey(owner, k), value = localStorage.getItem(k);
        if (value == null) { localStorage.removeItem(nk); return; }
        // Quita primero el origen: así nunca hace falta duplicar una biblioteca
        // grande cuando localStorage está cerca de su cuota.
        localStorage.removeItem(k);
        try { localStorage.setItem(nk, value); }
        catch (e) { localStorage.setItem(k, value); throw e; }
        moved.push({ key: k, namespaced: nk, value: value });
      });
      localStorage.setItem(namespaceSentinel(owner), '1');
      return true;
    } catch (e) {
      moved.slice().reverse().forEach(function (it) {
        try {
          var value = localStorage.getItem(it.namespaced);
          localStorage.removeItem(it.namespaced);
          if (value != null) localStorage.setItem(it.key, value);
        } catch (ignore) {}
      });
      try { localStorage.removeItem(namespaceSentinel(owner)); } catch (ignore) {}
      diag(e);
      return false;
    } finally { _applying = false; }
  }
  function restoreNamespace(owner) {
    if (!owner) return true;
    var moved = [];
    _applying = true;
    try {
      namespaceKeys().forEach(function (k) {
        var nk = namespaceKey(owner, k), value = localStorage.getItem(nk);
        localStorage.removeItem(k);
        if (value != null) {
          localStorage.removeItem(nk);
          try { localStorage.setItem(k, value); }
          catch (e) { localStorage.setItem(nk, value); throw e; }
          moved.push({ key: k, namespaced: nk, value: value });
        }
      });
      localStorage.removeItem(namespaceSentinel(owner));
      return true;
    } catch (e) {
      // Deja el namespace destino exactamente como estaba para que el caller
      // pueda restaurar con seguridad el dueño anterior.
      moved.slice().reverse().forEach(function (it) {
        try {
          var value = localStorage.getItem(it.key);
          localStorage.removeItem(it.key);
          if (value != null) localStorage.setItem(it.namespaced, value);
        } catch (ignore) {}
      });
      diag(e);
      return false;
    }
    finally { _applying = false; }
  }
  function emptyNamespace(owner) {
    if (!owner) return;
    try {
      namespaceKeys().forEach(function (k) { localStorage.removeItem(namespaceKey(owner, k)); });
      localStorage.setItem(namespaceSentinel(owner), '1');
    } catch (e) { diag(e); }
  }
  function unsignedOwner() {
    try { return localStorage.getItem(UNSIGNED_OWNER_KEY) || 'guest'; } catch (e) { return 'guest'; }
  }
  function setUnsignedOwner(owner) {
    try { localStorage.setItem(UNSIGNED_OWNER_KEY, owner || 'guest'); } catch (e) {}
  }
  function switchNamespace(nextOwner, allowGuestCarry) {
    var currentOwner = localOwner();
    if (!nextOwner || currentOwner === nextOwner) return true;
    if (allowGuestCarry && currentOwner === 'guest' && !namespaceExists(nextOwner) && !hasAdoptedUid(nextOwner)) {
      // Primera alta desde un invitado real: adopta sus mazos como hacía el sync
      // histórico, pero deja un espacio invitado vacío para restaurarlo al salir.
      emptyNamespace('guest');
      setLocalOwner(nextOwner);
      return true;
    }
    if (!captureNamespace(currentOwner)) return false;
    if (!restoreNamespace(nextOwner)) {
      restoreNamespace(currentOwner);
      setLocalOwner(currentOwner);
      return false;
    }
    setLocalOwner(nextOwner);
    return true;
  }
  function pendingKey(uid) { return WELCOME_PENDING_PREFIX + encodeURIComponent(uid || ''); }
  function welcomePending(uid) {
    try { return !!uid && localStorage.getItem(pendingKey(uid)) === '1'; } catch (e) { return false; }
  }
  function setWelcomePending(uid) {
    try { if (uid) localStorage.setItem(pendingKey(uid), '1'); } catch (e) {}
  }
  function clearWelcomePending(uid) {
    try { if (uid) localStorage.removeItem(pendingKey(uid)); } catch (e) {}
  }
  function dirtyPrefix(uid) { return DIRTY_PREFIX + encodeURIComponent(uid || '') + '::'; }
  function dirtyStorageKey(uid, kind, key) {
    return dirtyPrefix(uid) + encodeURIComponent(kind) + '::' + encodeURIComponent(key);
  }
  function dirtyToken() {
    try { if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID(); } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2) + '-' + Math.random().toString(36).slice(2);
  }
  // Exclusión corta entre pestañas del mismo origen. Web Locks cierra la ventana
  // TOCTOU entre validar/aplicar un pull y confirmar una escritura. En navegadores
  // sin la API se mantienen las defensas causales por token/version.
  function withSyncLock(uid, task) {
    var run = function () { return task(); };
    try {
      if (navigator.locks && navigator.locks.request) {
        return navigator.locks.request('pokelink-cloud-sync::' + String(uid || ''), { mode: 'exclusive' }, run);
      }
    } catch (e) {}
    return Promise.resolve().then(run);
  }
  function remoteVersionKey(uid, kind, key) {
    return REMOTE_VERSION_PREFIX + encodeURIComponent(uid || '') + '::' + encodeURIComponent(kind) + '::' + encodeURIComponent(key);
  }
  function knownRemoteVersion(uid, kind, key) {
    try { return localStorage.getItem(remoteVersionKey(uid, kind, key)) || ''; } catch (e) { return ''; }
  }
  function rememberRemoteVersions(uid, versions, snapshot) {
    ['settings', 'lists', 'merges'].forEach(function (kind) {
      Object.keys((versions && versions[kind]) || {}).forEach(function (key) {
        var entry = null;
        for (var i = 0; i < (snapshot || []).length; i++) {
          if (snapshot[i] && snapshot[i].kind === kind && snapshot[i].key === key) { entry = snapshot[i]; break; }
        }
        // El ack puede llegar después que el de una edición posterior en otra
        // pestaña. Solo su token vigente puede mover la base remota conocida;
        // así una confirmación antigua nunca la hace retroceder.
        if (!entry || !dirtyEntryCurrent(uid, entry)) return;
        try { localStorage.setItem(remoteVersionKey(uid, kind, key), String(versions[kind][key] || '')); } catch (e) {}
      });
    });
  }
  function rememberPulledVersions(uid, versions, skipDirty) {
    var byKind = { settings: SYNC_KEYS, lists: Object.keys(LIST_KEYS), merges: Object.keys(MERGE_KEYS) };
    ['settings', 'lists', 'merges'].forEach(function (kind) {
      byKind[kind].forEach(function (key) {
        if (skipDirty && hasDirtyField(uid, kind, key)) return;
        var value = String(((versions && versions[kind]) || {})[key] || '');
        try {
          if (value) localStorage.setItem(remoteVersionKey(uid, kind, key), value);
          else localStorage.removeItem(remoteVersionKey(uid, kind, key));
        } catch (e) {}
      });
    });
  }
  function knownVersionSnapshot(uid) {
    var out = {}, byKind = { settings: SYNC_KEYS, lists: Object.keys(LIST_KEYS), merges: Object.keys(MERGE_KEYS) };
    ['settings', 'lists', 'merges'].forEach(function (kind) {
      out[kind] = {};
      byKind[kind].forEach(function (key) { out[kind][key] = knownRemoteVersion(uid, kind, key); });
    });
    return out;
  }
  function pullSnapshotBecameStale(uid, started, incoming) {
    var stale = false;
    ['settings', 'lists', 'merges'].forEach(function (kind) {
      Object.keys((started && started[kind]) || {}).forEach(function (key) {
        if (stale) return;
        var before = String(started[kind][key] || '');
        var current = knownRemoteVersion(uid, kind, key);
        var received = String(((incoming && incoming[kind]) || {})[key] || '');
        // Si una confirmación avanzó la base mientras este getDoc estaba en
        // vuelo, una respuesta distinta de esa base pertenece al pasado.
        if (current !== before && received !== current) stale = true;
      });
    });
    return stale;
  }
  function dirtyHash(value) {
    var s = String(value == null ? '' : value), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return s.length.toString(36) + '-' + (h >>> 0).toString(36);
  }
  // Una clave independiente por uid/canal/campo evita el read-modify-write de un
  // JSON compartido: dos pestañas pueden marcar campos distintos sin pisarse.
  function markDirty(uid, kind, key, value, persistValue, atomicMeta) {
    if (!uid || !kind || !key) return null;
    var storageKey = dirtyStorageKey(uid, kind, key), previous = null;
    try { previous = JSON.parse(localStorage.getItem(storageKey)); } catch (e) {}
    var bases = [knownRemoteVersion(uid, kind, key)];
    if (previous && previous.version) bases = bases.concat(previous.bases || [], [previous.version]);
    bases = bases.filter(function (v, i, arr) { return arr.indexOf(v) === i; });
    var token = dirtyToken();
    var entry = { uid: uid, kind: kind, key: key, token: token, version: token, bases: bases };
    // Los ajustes generales no están namespaced: conservar aquí el valor exacto
    // impide que un cambio posterior de otra cuenta se atribuya al uid anterior.
    if (kind === 'settings' || persistValue) {
      entry.value = value == null ? null : String(value);
      if (persistValue) entry.detached = true;
    } else if (value != null) entry.hash = dirtyHash(value);
    if (atomicMeta && atomicMeta.group && Array.isArray(atomicMeta.keys)) {
      entry.atomicGroup = String(atomicMeta.group);
      entry.atomicKeys = atomicMeta.keys.map(function (field) {
        return { group: String((field && field.group) || ''), key: String((field && field.key) || '') };
      }).filter(function (field) { return field.group && field.key; });
    }
    try {
      entry.storageKey = storageKey;
      localStorage.setItem(entry.storageKey, JSON.stringify(entry));
      return entry;
    } catch (e) { return null; }
  }
  function markDirtyBatch(specs) {
    var touched = [], markers = [];
    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i], storageKey = dirtyStorageKey(spec.uid, spec.kind, spec.key), before = null;
      try { before = localStorage.getItem(storageKey); } catch (e) {}
      var marker = markDirty(spec.uid, spec.kind, spec.key, spec.value, spec.persistValue,
        spec.atomicGroup ? { group: spec.atomicGroup, keys: spec.atomicKeys || [] } : null);
      if (!marker) {
        touched.slice().reverse().forEach(function (it) {
          try {
            var current = JSON.parse(localStorage.getItem(it.storageKey));
            if (!current || current.token !== it.marker.token) return; // otra pestaña ya lo sustituyó
            localStorage.removeItem(it.storageKey);
            if (it.before != null) localStorage.setItem(it.storageKey, it.before);
          } catch (ignore) {}
        });
        return null;
      }
      touched.push({ storageKey: storageKey, before: before, marker: marker });
      markers.push(marker);
    }
    return markers;
  }
  function dirtySnapshot(uid, kinds, onlyKey) {
    var wanted = kinds || ['settings', 'lists', 'merges'];
    if (!Array.isArray(wanted)) wanted = [wanted];
    var base = dirtyPrefix(uid), out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var storageKey = localStorage.key(i);
        if (!storageKey || storageKey.indexOf(base) !== 0) continue;
        var entry;
        try { entry = JSON.parse(localStorage.getItem(storageKey)); } catch (e) { entry = null; }
        if (!entry || entry.uid !== uid || wanted.indexOf(entry.kind) < 0) continue;
        if (onlyKey != null && entry.key !== onlyKey) continue;
        entry.storageKey = storageKey;
        out.push(entry);
      }
    } catch (e) {}
    return out;
  }
  function hasDirtyField(uid, kind, key) { return dirtySnapshot(uid, kind, key).length > 0; }
  function clearDirtySnapshot(uid, snapshot) {
    (snapshot || []).forEach(function (entry) {
      if (!entry || entry.uid !== uid || !entry.storageKey) return;
      try {
        var current = JSON.parse(localStorage.getItem(entry.storageKey));
        if (!current || current.token !== entry.token) return;
        if (entry.hash) {
          var raw = localOwner() === uid ? localStorage.getItem(entry.key) : localStorage.getItem(namespaceKey(uid, entry.key));
          if (dirtyHash(raw) !== entry.hash) return;
        }
        localStorage.removeItem(entry.storageKey);
      } catch (e) {}
    });
  }
  var _mergeTimers = {};
  function readObj(key)  { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { return {}; } }
  function writeObj(key, o) { _applying = true; try { localStorage.setItem(key, JSON.stringify(o)); } catch (e) {} _applying = false; }
  function sendMerge(entry, intento) {
    if (!entry || !window.pbDB) return Promise.resolve(false);
    return queueSave(entry.uid, entry.payload, entry.dirty).then(function (result) {
      if (!result.saved) return true;
      // Solo se retira del outbox lo que el servidor CONFIRMÓ. Un campo rechazado
      // conserva su marca: mientras exista, el pull no puede revertir la edición, y
      // el acuse acaba de dejar la versión buena, así que el reintento sí entra.
      clearDirtySnapshot(entry.uid, result.confirmed || entry.dirty);
      if ((result.rejected || []).length && (intento || 0) < 2) return sendMerge(entry, (intento || 0) + 1);
      return true;
    }).catch(function (err) { diag(err); return false; });
  }
  function pushMerge(key) {
    if (!_uid || !window.pbDB || localOwner() !== _uid) return;
    var raw = localStorage.getItem(key);
    var marker = markDirty(_uid, 'merges', key, raw == null ? JSON.stringify(readObj(key)) : raw);
    var o = { merges: {}, updatedAt: Date.now() };
    o.merges[key] = readObj(key);
    sendMerge({ uid: _uid, payload: o, dirty: marker ? [marker] : [] });
  }
  function schedulePushMerge(key, rawValue) {
    if (!_uid || localOwner() !== _uid) return;
    if (_mergeTimers[key]) clearTimeout(_mergeTimers[key].timer);
    var raw = rawValue == null ? localStorage.getItem(key) : String(rawValue);
    var marker = markDirty(_uid, 'merges', key, raw);
    var payload = { merges: {}, updatedAt: Date.now() };
    try { payload.merges[key] = JSON.parse(raw) || {}; } catch (e) { payload.merges[key] = readObj(key); }
    var entry = { uid: _uid, payload: payload, dirty: marker ? [marker] : [], timer: null };
    entry.timer = setTimeout(function () {
      if (_mergeTimers[key] !== entry) return;
      delete _mergeTimers[key];
      sendMerge(entry);
    }, 800);
    _mergeTimers[key] = entry;
    return marker;
  }

  // Re-pinta las vistas abiertas tras aplicar una lista venida de la nube
  // (al iniciar sesión sobre todo). Sin esto, el cambio solo se vería al reabrir.
  function refreshList(key) {
    if (key === 'pocketboard_library_v1') {
      if (window.renderDeckLibrary) try { window.renderDeckLibrary(); } catch (e) {}        // sidebar «Mis Mazos»
      if (window._mazosRefreshIfOpen) try { window._mazosRefreshIfOpen(); } catch (e) {}    // pestaña Mazos
      // Los ajustes (incl. mazo activo) se aplican ANTES que las listas: al llegar la biblioteca,
      // re-resuelve el mazo activo en el hub «Jugar» (su id pudo aplicarse sin biblioteca aún).
      if (window._jugarRefresh) try { window._jugarRefresh(); } catch (e) {}
    }
    if (key === 'pocketboard_favorites_v1') {
      if (window.pbFavInvalidate) window.pbFavInvalidate();                                 // caché de favoritas
      if (window._cvFilter) try { window._cvFilter(); } catch (e) {}                        // re-pinta estrellas/filtro en Cartas
    }
  }

  var _uid = null;
  var _applying = false;   // true mientras aplicamos lo de la nube → no re-empujar (evita bucle)
  var _pushTimer = null;
  var _listTimers = {};
  var _errShown = false;   // diagnóstico: mostrar el 1er error de sync (no spamear)
  var DIAG = false;        // toasts de diagnóstico de cloud-save (Sync ↑/↓ mazos) — OFF (validado)
  var _authResolved = false;

  function localOwner() {
    try { return localStorage.getItem(LOCAL_OWNER_KEY) || ''; } catch (e) { return ''; }
  }
  function setLocalOwner(uid) {
    try { localStorage.setItem(LOCAL_OWNER_KEY, String(uid || '')); } catch (e) {}
  }
  function clearForeignAccountSettings() {
    _applying = true;
    try { ACCOUNT_SETTING_KEYS.forEach(function (k) { localStorage.removeItem(k); }); } catch (e) {}
    _applying = false;
  }
  // Firebase Auth sí distingue un alta real de una cuenta antigua cuyo documento
  // /users/{uid} se hubiera borrado o nunca se hubiese creado.
  function authUserIsFresh(uid) {
    var u = (window.pbAuth && window.pbAuth.user) || null;
    var md = u && u.uid === uid && u.metadata;
    if (!md || !md.creationTime || !md.lastSignInTime) return false;
    var created = Date.parse(md.creationTime), signed = Date.parse(md.lastSignInTime);
    var age = Date.now() - created;
    return isFinite(created) && isFinite(signed) && Math.abs(signed - created) <= 120000 && age >= -300000 && age <= 900000;
  }

  function diag(err) {
    var code = (err && (err.code || err.message)) ? (err.code || err.message) : 'error';
    if (window.console) console.warn('[cloud-sync]', err);
    if (window.pbToast && !_errShown && window.pbFlag && window.pbFlag('debug')) { _errShown = true; window.pbToast('Sync: ' + code); }
  }

  function dirtyEntryCurrent(uid, entry) {
    if (!entry || entry.uid !== uid || !entry.storageKey) return false;
    try {
      var current = JSON.parse(localStorage.getItem(entry.storageKey));
      if (!current || current.token !== entry.token) return false;
      if (entry.hash) {
        var raw = localOwner() === uid ? localStorage.getItem(entry.key) : localStorage.getItem(namespaceKey(uid, entry.key));
        if (dirtyHash(raw) !== entry.hash) return false;
      }
      return true;
    } catch (e) { return false; }
  }
  function guardedPayload(uid, payload, snapshot) {
    if (!snapshot || !snapshot.length) return payload;
    var active = snapshot.filter(function (entry) { return dirtyEntryCurrent(uid, entry); });
    if (!active.length) return null;
    var out = { updatedAt: payload.updatedAt || Date.now() };
    active.forEach(function (entry) {
      var group = entry.kind;
      if (!payload[group] || !Object.prototype.hasOwnProperty.call(payload[group], entry.key)) return;
      if (!out[group]) out[group] = {};
      out[group][entry.key] = payload[group][entry.key];
    });
    return (out.settings || out.lists || out.merges) ? out : null;
  }
  function versionsForSnapshot(snapshot) {
    var out = {};
    (snapshot || []).forEach(function (entry) {
      if (!entry || !entry.kind || !entry.key || !entry.version) return;
      if (!out[entry.kind]) out[entry.kind] = {};
      out[entry.kind][entry.key] = { version: entry.version, bases: (entry.bases || []).slice() };
    });
    return out;
  }
  function atomicStateForSnapshot(snapshot) {
    var groups = {}, broken = [], keys = [];
    (snapshot || []).forEach(function (entry) {
      if (!entry || !entry.atomicGroup || !Array.isArray(entry.atomicKeys)) return;
      var id = String(entry.atomicGroup);
      if (!groups[id]) groups[id] = { entries: [], keys: entry.atomicKeys };
      groups[id].entries.push(entry);
      if (entry.atomicKeys.length > groups[id].keys.length) groups[id].keys = entry.atomicKeys;
    });
    Object.keys(groups).forEach(function (id) {
      var group = groups[id];
      var complete = group.keys.length && group.keys.every(function (field) {
        return group.entries.some(function (entry) { return entry.kind === field.group && entry.key === field.key; });
      });
      if (!complete) { broken = broken.concat(group.entries); return; }
      group.keys.forEach(function (field) {
        if (!keys.some(function (known) { return known.group === field.group && known.key === field.key; })) {
          keys.push({ group: field.group, key: field.key });
        }
      });
    });
    return { keys: keys, broken: broken };
  }
  function liveSnapshotForSave(uid, snapshot) {
    var out = [];
    (snapshot || []).forEach(function (entry) {
      if (!entry || !entry.storageKey) return;
      var current = null;
      try { current = JSON.parse(localStorage.getItem(entry.storageKey)); } catch (e) {}
      if (!current || current.uid !== uid || current.token !== entry.token) return;
      if (current.hash) {
        var raw = localOwner() === uid ? localStorage.getItem(current.key) : localStorage.getItem(namespaceKey(uid, current.key));
        if (dirtyHash(raw) !== current.hash) return;
      }
      // markDirty es síncrono y pudo leer la base justo antes de que un pull
      // legítimo la avanzara. Para este envío usamos una copia rebasada dentro
      // del lock; no reescribimos el marker y por tanto no podemos pisar otro tab.
      var known = knownRemoteVersion(uid, current.kind, current.key);
      current.bases = (current.bases || []).slice();
      if (current.bases.indexOf(known) < 0) current.bases.push(known);
      current.storageKey = entry.storageKey;
      out.push(current);
    });
    return out;
  }
  // No deja una cadena local bloqueada para siempre. La operación subyacente puede
  // terminar tarde, pero saveVersioned hará que el servidor descarte una versión vieja.
  function boundedSave(promise, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        resolve({ saved: false, timedOut: true });
      }, ms);
      Promise.resolve(promise).then(function (value) {
        if (settled) return;
        settled = true; clearTimeout(timer); resolve({ saved: true, ack: value || null });
      }, function (err) {
        if (settled) return;
        settled = true; clearTimeout(timer); reject(err);
      });
    });
  }

  // El servidor puede ACEPTAR unos campos y RECHAZAR otros (la versión base que
  // llevábamos ya no era la vigente). Antes se daba por guardado todo lo que
  // respondiera: se borraba el outbox y la edición se perdía EN SILENCIO — seguía en
  // pantalla, nunca llegaba a la nube y la siguiente lectura la revertía sin que
  // nadie la reclamara. Un campo solo cuenta como guardado si el acuse dice que la
  // versión remota es AHORA la nuestra.
  function ackSplit(result, snapshot) {
    var todo = (snapshot || []).slice();
    if (!result || !result.saved) return { ok: [], ko: todo };
    var rv = (result.versioned && result.ack) ? result.ack.remoteVersions : null;
    if (!rv) return { ok: todo, ko: [] };   // sin detalle por campo: como hasta ahora
    var ok = [], ko = [];
    todo.forEach(function (entry) {
      var got = (rv[entry.kind] || {})[entry.key];
      if (got == null || String(got) === String(entry.version)) ok.push(entry);
      else ko.push(entry);
    });
    return { ok: ok, ko: ko };
  }

  // Serializa dentro de esta pestaña; Firestore resuelve las carreras entre
  // pestañas con versiones condicionales por campo. La generación invalida
  // continuaciones antiguas tras un cambio de identidad.
  var _saveChains = {};
  var _saveGeneration = {};
  function queueSave(uid, payload, snapshot, options) {
    var generation = _saveGeneration[uid] || 0;
    var previous = _saveChains[uid] || Promise.resolve();
    var next = previous.catch(function () {}).then(function () {
      // La sección crítica solo prepara token, payload y bases. Se libera ANTES
      // de Firestore para no bloquear otras pestañas durante red/reintentos.
      return withSyncLock(uid, function () {
        if (generation !== (_saveGeneration[uid] || 0)) return { result: { saved: false, skipped: true } };
        var liveSnapshot = liveSnapshotForSave(uid, snapshot);
        var currentPayload = (snapshot && snapshot.length && !liveSnapshot.length)
          ? null : guardedPayload(uid, payload, liveSnapshot);
        if (!currentPayload) return { result: { saved: false, skipped: true } };
        return { payload: currentPayload, snapshot: liveSnapshot };
      }).then(function (prepared) {
        if (prepared.result) return prepared.result;
        if (generation !== (_saveGeneration[uid] || 0)) return { saved: false, skipped: true };
        if (!window.pbDB || !window.pbDB.save) throw new Error('cloud-save-unavailable');
        var liveSnapshot = prepared.snapshot;
        var versioned = !!(liveSnapshot.length && window.pbDB.saveVersioned);
        var savePromise = versioned
          ? window.pbDB.saveVersioned(uid, prepared.payload, versionsForSnapshot(liveSnapshot), options || {})
          : window.pbDB.save(uid, prepared.payload);
        return boundedSave(savePromise, 1800).then(function (result) {
          result.versioned = versioned;
          result.snapshot = liveSnapshot;
          var reparto = ackSplit(result, liveSnapshot);
          result.confirmed = reparto.ok;
          result.rejected = reparto.ko;
          if (result.saved && result.ack && result.ack.remoteVersions) {
            return withSyncLock(uid, function () {
              rememberRemoteVersions(uid, result.ack.remoteVersions, liveSnapshot);
              return result;
            });
          }
          return result;
        });
      });
    });
    _saveChains[uid] = next;
    next.then(function () {
      if (_saveChains[uid] === next) delete _saveChains[uid];
    }, function () {
      if (_saveChains[uid] === next) delete _saveChains[uid];
    });
    return next;
  }

  /* ── Ajustes ── */
  function applyKey(key, value) {
    _applying = true;
    try {
      if (APPLIERS[key]) APPLIERS[key](value);   // el applier ya persiste (p.ej. setLang)
      else localStorage.setItem(key, value);
    } catch (e) {}
    _applying = false;
  }
  function collectLocal() {
    var out = {};
    SYNC_KEYS.forEach(function (k) {
      var v = localStorage.getItem(k);
      if (v != null) out[k] = v;
    });
    return out;
  }
  function settingsFromDirty(snapshot) {
    var out = {};
    (snapshot || []).forEach(function (entry) {
      if (entry.kind === 'settings' && entry.value != null) out[entry.key] = entry.value;
    });
    return out;
  }
  function push() {
    if (!_uid || !window.pbDB || localOwner() !== _uid) return;
    SYNC_KEYS.forEach(function (k) {
      var value = localStorage.getItem(k);
      if (value != null) markDirty(_uid, 'settings', k, value);
    });
    var snapshot = dirtySnapshot(_uid, 'settings');
    sendSettings({ uid: _uid, payload: { settings: settingsFromDirty(snapshot), updatedAt: Date.now() }, dirty: snapshot });
  }
  function sendSettings(entry, intento) {
    if (!entry || !window.pbDB) return Promise.resolve(false);
    return queueSave(entry.uid, entry.payload, entry.dirty).then(function (result) {
      if (!result.saved) return true;
      // Solo se retira del outbox lo que el servidor CONFIRMÓ. Un campo rechazado
      // conserva su marca: mientras exista, el pull no puede revertir la edición, y
      // el acuse acaba de dejar la versión buena, así que el reintento sí entra.
      clearDirtySnapshot(entry.uid, result.confirmed || entry.dirty);
      if ((result.rejected || []).length && (intento || 0) < 2) return sendSettings(entry, (intento || 0) + 1);
      return true;
    }).catch(function (err) { diag(err); return false; });
  }
  function schedulePush(key, value) {
    if (!_uid || localOwner() !== _uid) return;
    if (_pushTimer) clearTimeout(_pushTimer.timer);
    var marker = key ? markDirty(_uid, 'settings', key, value) : null;
    var snapshot = dirtySnapshot(_uid, 'settings');
    var pendingSettings = settingsFromDirty(snapshot);
    if (!Object.keys(pendingSettings).length) pendingSettings = collectLocal();
    var entry = { uid: _uid, payload: { settings: pendingSettings, updatedAt: Date.now() }, dirty: snapshot, timer: null };
    entry.timer = setTimeout(function () {
      if (_pushTimer !== entry) return;
      _pushTimer = null;
      sendSettings(entry);
    }, 800);
    _pushTimer = entry;
    return marker;
  }

  /* ── Listas ── */
  function readList(key) { try { return JSON.parse(localStorage.getItem(key)) || []; } catch (e) { return []; } }
  function writeList(key, arr) {
    _applying = true;
    try { localStorage.setItem(key, JSON.stringify(arr)); } catch (e) {}
    _applying = false;
  }
  // Unión por id; en conflicto gana el de timestamp mayor.
  // `keepOrder` (Mis Mazos): el ORDEN del array es un dato del usuario — es el orden en que
  // ha colocado sus mazos a mano. Con la ordenación por timestamp, la primera adopción de la
  // cuenta en un dispositivo lo destruía y subía la pérdida a la nube. Con keepOrder se
  // conserva el orden de `a` (la nube manda) y lo que solo existía en local va al final.
  function listMerge(a, b, tsField, keepOrder) {
    var byId = {};
    [a, b].forEach(function (arr) {
      (arr || []).forEach(function (it) {
        if (!it || it.id == null) return;
        var ex = byId[it.id];
        if (!ex || (Number(it[tsField]) || 0) >= (Number(ex[tsField]) || 0)) byId[it.id] = it;
      });
    });
    if (keepOrder) {
      var out = [], visto = {};
      [a, b].forEach(function (arr) {
        (arr || []).forEach(function (it) {
          if (!it || it.id == null || visto[it.id]) return;
          visto[it.id] = 1; out.push(byId[it.id]);
        });
      });
      return out;
    }
    return Object.keys(byId).map(function (k) { return byId[k]; })
      .sort(function (x, y) { return (Number(y[tsField]) || 0) - (Number(x[tsField]) || 0); });
  }
  function pullList(uid, key, cloudArr, allowLocalMerge, deferPush) {
    // Una edición local hecha mientras Firestore leía tiene prioridad temporal;
    // su outbox la subirá y una lectura anterior no puede reemplazarla.
    if (hasDirtyField(uid, 'lists', key)) return false;
    var adoptedFlag = 'pbsync_' + uid + '_' + key, adopted = false;
    try { adopted = localStorage.getItem(adoptedFlag) === '1'; } catch (e) {}
    if (allowLocalMerge === false) {
      // Cambio de cuenta: nunca adoptar lo que quedó materializado para otro uid.
      writeList(key, Array.isArray(cloudArr) ? cloudArr : []);
      try { localStorage.setItem(adoptedFlag, '1'); } catch (e) {}
      refreshList(key);
      return;
    }
    if (!adopted) {
      // 1ª vez en este dispositivo: unir nube + local (sin perder nada)
      var merged = listMerge(cloudArr || [], readList(key), LIST_KEYS[key], key === LIBRARY_KEY);
      writeList(key, merged);
      try { localStorage.setItem(adoptedFlag, '1'); } catch (e) {}
      // No crear una escritura vacía que pueda competir con la baraja de bienvenida.
      var needsPush = cloudArr !== undefined || merged.length;
      if (needsPush && !deferPush) pushList(key);   // sube la unión a la nube
      refreshList(key);
      return needsPush;
    } else if (cloudArr !== undefined) {
      // ya adoptado: la nube manda → propaga borrados/ediciones
      rescueDropped(key, readList(key), cloudArr);   // red: lo que la nube se lleva, no se pierde
      writeList(key, cloudArr);
      refreshList(key);
    }
    return false;
  }
  /* ── Red de seguridad: la nube manda, pero no a costa de perder trabajo ──────────────
     «La nube manda» es lo que propaga los borrados entre dispositivos, y es correcto. Pero si
     una subida no llegó a completarse (el móvil mata la pestaña al cambiar de app), el pull
     siguiente se lleva por delante mazos que el usuario sí había creado. Antes de que eso
     ocurra se guarda una copia de lo que desaparece: el daño pasa de irreversible a
     recuperable. No cambia lo que se ve: solo deja de ser definitivo.
     Se guarda en LOCAL y no se sincroniza (es un salvavidas de este dispositivo). */
  var RESCUE_KEYS = { 'pocketboard_library_v1': 1, 'pocketboard_tierlists_v1': 1, 'pocketboard_scenarios_v1': 1 };
  var RESCUE_MAX = 60;
  function rescueKeyFor(key) { return key + '__rescue'; }
  function rescueDropped(key, localArr, cloudArr) {
    try {
      if (!RESCUE_KEYS[key] || !Array.isArray(localArr) || !Array.isArray(cloudArr)) return;
      var enNube = {};
      cloudArr.forEach(function (it) { if (it && it.id != null) enNube[it.id] = 1; });
      var perdidos = localArr.filter(function (it) { return it && it.id != null && !enNube[it.id]; });
      if (!perdidos.length) return;
      var ahora = Date.now();
      var prev = [];
      try { prev = JSON.parse(localStorage.getItem(rescueKeyFor(key))) || []; } catch (e) {}
      var yaEsta = {};
      prev.forEach(function (r) { if (r && r.item && r.item.id != null) yaEsta[r.item.id] = 1; });
      perdidos.forEach(function (it) { if (!yaEsta[it.id]) prev.push({ at: ahora, item: it }); });
      if (prev.length > RESCUE_MAX) prev = prev.slice(prev.length - RESCUE_MAX);
      localStorage.setItem(rescueKeyFor(key), JSON.stringify(prev));
      diag('rescate: ' + perdidos.length + ' de ' + key);
    } catch (e) {}
  }
  /* Lo que se salvó, para poder devolverlo. `pbRescuedDecks()` lista; `pbRestoreRescued(id)`
     devuelve uno a la biblioteca (y de ahí sube a la nube como cualquier mazo). */
  window.pbRescuedDecks = function (key) {
    key = key || 'pocketboard_library_v1';
    try { return JSON.parse(localStorage.getItem(rescueKeyFor(key))) || []; } catch (e) { return []; }
  };
  window.pbRestoreRescued = function (id, key) {
    key = key || 'pocketboard_library_v1';
    var guardados = window.pbRescuedDecks(key);
    var enc = guardados.filter(function (r) { return r && r.item && String(r.item.id) === String(id); })[0];
    if (!enc) return false;
    var lista = readList(key);
    if (!lista.some(function (d) { return d && String(d.id) === String(id); })) {
      var item = JSON.parse(JSON.stringify(enc.item));
      item.savedAt = Date.now();          // más nuevo que la nube: la fusión lo conserva
      lista.push(item);
      writeList(key, lista);
      schedulePushList(key);
      refreshList(key);
    }
    var resto = guardados.filter(function (r) { return !(r && r.item && String(r.item.id) === String(id)); });
    try { localStorage.setItem(rescueKeyFor(key), JSON.stringify(resto)); } catch (e) {}
    return true;
  };
  function sendList(entry, intento) {
    if (!entry || !window.pbDB) return Promise.resolve(false);
    return queueSave(entry.uid, entry.payload, entry.dirty).then(function (result) {
      if (!result.saved) return true;
      // Solo se retira del outbox lo que el servidor CONFIRMÓ. Un campo rechazado
      // conserva su marca: mientras exista, el pull no puede revertir la edición, y
      // el acuse acaba de dejar la versión buena, así que el reintento sí entra.
      clearDirtySnapshot(entry.uid, result.confirmed || entry.dirty);
      if ((result.rejected || []).length && (intento || 0) < 2) return sendList(entry, (intento || 0) + 1);
      if (DIAG && entry.key === 'pocketboard_library_v1' && window.pbToast) window.pbToast('Sync ↑ mazos: ' + entry.count);
      return true;
    }).catch(function (err) { diag(err); return false; });
  }
  function pushList(key) {
    if (!_uid || !window.pbDB || localOwner() !== _uid) return;
    var obj = { lists: {}, updatedAt: Date.now() };
    var arr = readList(key);
    var raw = localStorage.getItem(key);
    var marker = markDirty(_uid, 'lists', key, raw == null ? JSON.stringify(arr) : raw);
    obj.lists[key] = arr;
    sendList({ uid: _uid, key: key, count: arr.length, payload: obj, dirty: marker ? [marker] : [] });
  }
  function schedulePushList(key, rawValue) {
    if (!_uid || localOwner() !== _uid) return;
    if (_listTimers[key]) clearTimeout(_listTimers[key].timer);
    var raw = rawValue == null ? localStorage.getItem(key) : String(rawValue);
    var arr;
    try { arr = JSON.parse(raw) || []; } catch (e) { arr = readList(key); }
    var marker = markDirty(_uid, 'lists', key, raw);
    var payload = { lists: {}, updatedAt: Date.now() };
    payload.lists[key] = arr;
    var entry = { uid: _uid, key: key, count: arr.length, payload: payload, dirty: marker ? [marker] : [], timer: null };
    entry.timer = setTimeout(function () {
      if (_listTimers[key] !== entry) return;
      delete _listTimers[key];
      sendList(entry);
    }, 800);
    _listTimers[key] = entry;
    return marker;
  }
  function detachPending(uid) {
    var entries = [];
    if (_pushTimer && (!uid || _pushTimer.uid === uid)) {
      clearTimeout(_pushTimer.timer); entries.push(_pushTimer); _pushTimer = null;
    }
    Object.keys(_listTimers).forEach(function (k) {
      var entry = _listTimers[k];
      if (entry && (!uid || entry.uid === uid)) { clearTimeout(entry.timer); entries.push(entry); delete _listTimers[k]; }
    });
    Object.keys(_mergeTimers).forEach(function (k) {
      var entry = _mergeTimers[k];
      if (entry && (!uid || entry.uid === uid)) { clearTimeout(entry.timer); entries.push(entry); delete _mergeTimers[k]; }
    });
    return entries;
  }
  function dirtyPayload(uid) {
    var entries = dirtySnapshot(uid), atomic = atomicStateForSnapshot(entries);
    var payload = { updatedAt: Date.now() }, has = false;
    var settings = {};
    entries.forEach(function (entry) {
      if (entry.kind === 'settings' && entry.value != null) { settings[entry.key] = entry.value; has = true; }
    });
    if (Object.keys(settings).length) payload.settings = settings;
    var lists = {};
    entries.forEach(function (entry) {
      if (entry.kind === 'lists') {
        if (entry.detached && entry.value != null) {
          try { lists[entry.key] = JSON.parse(entry.value) || []; } catch (e) { lists[entry.key] = []; }
        } else lists[entry.key] = readList(entry.key);
        has = true;
      }
    });
    if (Object.keys(lists).length) payload.lists = lists;
    var merges = {};
    entries.forEach(function (entry) {
      if (entry.kind === 'merges') {
        if (entry.detached && entry.value != null) {
          try { merges[entry.key] = JSON.parse(entry.value) || {}; } catch (e) { merges[entry.key] = {}; }
        } else merges[entry.key] = readObj(entry.key);
        has = true;
      }
    });
    if (Object.keys(merges).length) payload.merges = merges;
    return {
      has: has, payload: payload, dirty: entries,
      atomicBroken: atomic.broken,
      options: atomic.keys.length ? { atomicKeys: atomic.keys } : {}
    };
  }
  function flushDirty(uid, fallbackEntries, pass) {
    if (!uid || !window.pbDB || localOwner() !== uid) return Promise.resolve(false);
    pass = pass || 0;
    var current = dirtyPayload(uid);
    // Si otra escritura sustituyó solo una pieza de un lote atómico, las piezas
    // antiguas restantes ya no describen un estado válido. Se descartan por token;
    // la edición nueva sobrevive y después un pull vuelve a decidir la bienvenida.
    if (current.atomicBroken && current.atomicBroken.length) {
      clearDirtySnapshot(uid, current.atomicBroken);
      return pass < 4 ? flushDirty(uid, fallbackEntries, pass + 1) : Promise.resolve(false);
    }
    if (current.has) {
      return queueSave(uid, current.payload, current.dirty, current.options).then(function (result) {
        var atomicRequested = current.options && current.options.atomicKeys && current.options.atomicKeys.length;
        var atomicConflict = atomicRequested && result.versioned && (!result.ack || result.ack.atomicComplete !== true);
        // Igual que en send*: solo se retira lo confirmado. Lo rechazado sigue en el
        // outbox y la recursión de abajo lo reintenta ya con la base que dio el acuse.
        // EXCEPCIÓN: un lote atómico rechazado (la baraja de bienvenida) se retira
        // ENTERO a propósito — ahí la nube gana por diseño y volver a insistir pisaría
        // el mazo que ya tenga la cuenta; quien decide luego es el pull.
        if (result.saved) clearDirtySnapshot(uid, atomicConflict ? current.dirty : (result.confirmed || current.dirty));
        if (result.timedOut) return false;
        // La transacción garantizó que el núcleo no se escribió parcialmente.
        // Se retira este intento y se deja welcomePending para que el pull decida.
        if (atomicConflict) {
          if (dirtySnapshot(uid).length) return pass < 4 ? flushDirty(uid, [], pass + 1) : false;
          return true;
        }
        if (dirtySnapshot(uid).length) return pass < 4 ? flushDirty(uid, [], pass + 1) : false;
        return true;
      }).catch(function (err) { diag(err); return false; });
    }
    // Si localStorage estaba sin espacio para crear el outbox, no perder los
    // payloads que aún vivían en los timers de esta pestaña.
    var entries = fallbackEntries || [];
    if (!entries.length) return Promise.resolve(true);
    var chain = Promise.resolve(true);
    entries.forEach(function (entry) {
      chain = chain.then(function (ok) {
        if (!ok) return false;
        return queueSave(uid, entry.payload, entry.dirty).then(function (result) { return !result.timedOut; });
      });
    });
    return chain.catch(function (err) { diag(err); return false; });
  }
  // Vacía y ESPERA el outbox mientras la cuenta todavía está autenticada.
  // signOutUser usa esta promesa antes de pedirle a Firebase que cierre sesión.
  function flushPending(uid) {
    uid = uid || _uid;
    var entries = detachPending(uid);
    return flushDirty(uid, entries);
  }
  window.pbCloudFlushPending = function () { return flushPending(_uid); };
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushPending(_uid);
  });
  window.addEventListener('pagehide', function () { flushPending(_uid); });

  /* ── Traer todo al iniciar sesión ── */
  function emitSyncReady(uid, data, isNew, error) {
    try {
      window.dispatchEvent(new CustomEvent('pb-sync-ready', {
        detail: { uid: uid, data: data || {}, isNew: !!isNew, error: error || null }
      }));
    } catch (e) {}
  }
  var _freshPullTimers = {};
  function scheduleFreshPull(uid) {
    if (!uid || _freshPullTimers[uid]) return;
    _freshPullTimers[uid] = setTimeout(function () {
      delete _freshPullTimers[uid];
      if (uid === _uid && localOwner() === uid) pull(uid);
    }, 60);
  }
  function pull(uid) {
    if (!window.pbDB) return;
    var startedVersions = knownVersionSnapshot(uid);
    window.pbDB.load(uid).then(function (raw) {
      return withSyncLock(uid, function () {
        if (uid !== _uid || localOwner() !== uid) return; // cambió la sesión/namespace mientras cargaba
        var freshNow = raw == null && authUserIsFresh(uid);
        if (freshNow) setWelcomePending(uid);
        // Si la red falló durante el primer guardado, este marcador local conserva
        // la elegibilidad aunque ya exista un doc parcial o hayan pasado unos minutos.
        var isNew = freshNow || welcomePending(uid);
        var data = raw || {};
        if (pullSnapshotBecameStale(uid, startedVersions, data.syncVersions || {})) {
          scheduleFreshPull(uid);
          return;
        }
        // Un campo editado mientras leíamos conserva tanto su contenido como su
        // base; el ack o el siguiente pull resolverán después ese campo concreto.
        rememberPulledVersions(uid, data.syncVersions || {}, true);
        var owner = localOwner();
        var foreignLocal = !!owner && owner !== uid;
        if (foreignLocal) clearForeignAccountSettings();
        try { window.dispatchEvent(new CustomEvent('pb-doc', { detail: data })); } catch (e) {}   // perfil → auth.js

        // Ajustes: la nube manda; si no hay, sube lo local.
        if (data.settings) {
          SYNC_KEYS.forEach(function (k) {
            if (!hasDirtyField(uid, 'settings', k) && data.settings[k] != null && data.settings[k] !== localStorage.getItem(k)) applyKey(k, data.settings[k]);
          });
        } else if (!isNew) {
          // En un alta real, la escritura atómica de bienvenida ya incluye todos
          // los ajustes. No crear antes un documento vacío que impida reintentar.
          push();
        }
        // Listas: fusión en la adopción, luego la nube manda.
        var cl = data.lists || {};
        if (DIAG && window.pbToast) { var _lib = cl['pocketboard_library_v1']; window.pbToast('Sync ↓ mazos: ' + (_lib ? _lib.length : 0)); }
        var deferredLists = [];
        Object.keys(LIST_KEYS).forEach(function (k) {
          if (pullList(uid, k, cl[k], !foreignLocal, isNew)) deferredLists.push(k);
        });
        var deferWelcomeWrites = isNew && !readList('pocketboard_library_v1').length;
        if (!deferWelcomeWrites) deferredLists.forEach(pushList);
        // Mapas de progreso (cues): fusiona nube+local (OR done / max shown) y re-sube la unión.
        var mg = data.merges || {};
        Object.keys(MERGE_KEYS).forEach(function (k) {
          if (hasDirtyField(uid, 'merges', k)) return;
          writeObj(k, MERGE_KEYS[k](mg[k] || {}, foreignLocal ? {} : readObj(k)));
          // El commit de bienvenida incluye estos mapas. No crear antes un doc
          // parcial que convertiría el alta en «cuenta existente» tras un fallo.
          if (!deferWelcomeWrites) pushMerge(k);
        });
        setLocalOwner(uid);
        // Consumidores como la baraja de bienvenida solo actúan DESPUÉS de que ajustes
        // y biblioteca hayan quedado resueltos. Evita adelantarse a un mazo de la nube.
        emitSyncReady(uid, data, isNew, null);
      });
    }).catch(function (err) {
      diag(err);
      if (uid === _uid) emitSyncReady(uid, {}, false, err || new Error('sync'));
    });
  }

  // Captura genérica: escritura a una clave sincronizada → empuja a la nube.
  var _origSet = localStorage.setItem.bind(localStorage);
  function reaffirmLocalWrite(uid, entry, key, raw) {
    if (!entry || !uid) return;
    withSyncLock(uid, function () {
      if (uid !== _uid || localOwner() !== uid) return;
      var current = null;
      try { current = JSON.parse(localStorage.getItem(entry.storageKey)); } catch (e) {}
      if (!current || current.token !== entry.token) return; // ya existe una edición posterior
      // Un pull que obtuvo el lock antes pudo escribir entre el setItem visible y
      // la creación del marker. Reafirmar el valor capturado hace que la edición
      // local vuelva a ganar y que su hash/outbox sigan siendo coherentes.
      try {
        if (localStorage.getItem(key) !== String(raw)) {
          _applying = true;
          _origSet(key, String(raw));
          if (APPLIERS[key]) try { APPLIERS[key](String(raw)); } catch (ignore) {}
          _applying = false;
          if (LIST_KEYS.hasOwnProperty(key)) refreshList(key);
        }
      } catch (e) { _applying = false; }
    }).catch(function (err) { diag(err); });
  }
  try {
    localStorage.setItem = function (k, v) {
      _origSet(k, v);
      if (_applying || !_uid || localOwner() !== _uid) return;
      var uid = _uid, marker = null;
      if (SYNC_KEYS.indexOf(k) >= 0) marker = schedulePush(k, v);
      else if (LIST_KEYS.hasOwnProperty(k)) marker = schedulePushList(k, v);
      else if (MERGE_KEYS.hasOwnProperty(k)) marker = schedulePushMerge(k, v);
      if (marker) reaffirmLocalWrite(uid, marker, k, v);
    };
  } catch (e) {}

  // Persistencia específica del alta: baraja + activo + marca viajan en UNA sola
  // escritura. Solo después del éxito se materializan localmente y se repinta.
  // Así otro dispositivo nunca puede recibir la marca sin recibir también la baraja.
  window.pbCloudCommitWelcome = function (uid, record, activeId, marker) {
    if (!uid || uid !== _uid || localOwner() !== uid || !window.pbDB || !record) {
      return Promise.reject(new Error('welcome-sync-unavailable'));
    }
    var before = readList('pocketboard_library_v1');
    if (before.length) return Promise.resolve({ created: false, reason: 'local-has-decks', library: before });

    var settings = collectLocal();
    settings['pocketboard_active_deck_v1'] = String(activeId);
    settings['pocketboard_welcome_deck_v1'] = String(marker);
    var lists = {};
    Object.keys(LIST_KEYS).forEach(function (k) { lists[k] = readList(k); });
    lists['pocketboard_library_v1'] = [record];
    var merges = {};
    Object.keys(MERGE_KEYS).forEach(function (k) { merges[k] = readObj(k); });

    var welcomeCore = [
      { group: 'lists', key: 'pocketboard_library_v1' },
      { group: 'settings', key: 'pocketboard_active_deck_v1' },
      { group: 'settings', key: 'pocketboard_welcome_deck_v1' }
    ];
    var welcomeGroup = dirtyToken(), welcomeSpecs = [];
    function welcomeSpec(uidValue, kind, key, value, persistValue) {
      var core = welcomeCore.some(function (field) { return field.group === kind && field.key === key; });
      return {
        uid: uidValue, kind: kind, key: key, value: value, persistValue: !!persistValue,
        atomicGroup: core ? welcomeGroup : '', atomicKeys: core ? welcomeCore : null
      };
    }
    Object.keys(settings).forEach(function (k) { welcomeSpecs.push(welcomeSpec(uid, 'settings', k, settings[k], false)); });
    Object.keys(lists).forEach(function (k) { welcomeSpecs.push(welcomeSpec(uid, 'lists', k, JSON.stringify(lists[k]), true)); });
    Object.keys(merges).forEach(function (k) { welcomeSpecs.push(welcomeSpec(uid, 'merges', k, JSON.stringify(merges[k]), true)); });
    var welcomeDirty = markDirtyBatch(welcomeSpecs);
    if (!welcomeDirty) return Promise.reject(new Error('welcome-outbox-unavailable'));

    return queueSave(uid, { settings: settings, lists: lists, merges: merges, updatedAt: Date.now() }, welcomeDirty, { atomicKeys: welcomeCore }).then(function (result) {
      if (!result.saved) throw new Error('welcome-save-stale');
      // Una biblioteca modificada por otra pestaña/dispositivo invalida TODO el
      // trío crítico. Retiramos este intento (la nube gana), conservamos la
      // elegibilidad y releemos antes de decidir si reintentar o sellar sin regalo.
      if (result.versioned && (!result.ack || result.ack.atomicComplete !== true)) {
        clearDirtySnapshot(uid, welcomeDirty);
        if (uid === _uid && localOwner() === uid) setTimeout(function () { pull(uid); }, 0);
        return { created: false, reason: 'cloud-conflict', retrying: true };
      }
      clearDirtySnapshot(uid, welcomeDirty);
      clearWelcomePending(uid);
      if (uid !== _uid || localOwner() !== uid) return { created: true, stale: true, library: [record] };
      // Si otra pestaña creó algo mientras Firestore guardaba, conservar ambos y
      // reenviar la unión en vez de sobrescribir el mazo recién creado.
      var latest = readList(LIBRARY_KEY);
      var finalLibrary = listMerge([record], latest, LIST_KEYS[LIBRARY_KEY], true);
      var finalActive = latest.length ? (localStorage.getItem('pocketboard_active_deck_v1') || String(activeId)) : String(activeId);
      _applying = true;
      try {
        _origSet('pocketboard_library_v1', JSON.stringify(finalLibrary));
        _origSet('pocketboard_active_deck_v1', finalActive);
        _origSet('pocketboard_welcome_deck_v1', String(marker));
      } finally { _applying = false; }
      setLocalOwner(uid);
      refreshList('pocketboard_library_v1');

      if (finalLibrary.length > 1) {
        var followup = { lists: {}, settings: {}, updatedAt: Date.now() };
        followup.lists['pocketboard_library_v1'] = finalLibrary;
        followup.settings['pocketboard_active_deck_v1'] = finalActive;
        var followupDirty = [];
        var listMarker = markDirty(uid, 'lists', 'pocketboard_library_v1', JSON.stringify(finalLibrary));
        var activeMarker = markDirty(uid, 'settings', 'pocketboard_active_deck_v1', finalActive);
        if (listMarker) followupDirty.push(listMarker);
        if (activeMarker) followupDirty.push(activeMarker);
        queueSave(uid, followup, followupDirty).then(function (saveResult) {
          if (saveResult.saved) clearDirtySnapshot(uid, followupDirty);
        }).catch(function (err) { diag(err); schedulePushList('pocketboard_library_v1'); });
      }
      return { created: true, library: finalLibrary };
    });
  };
  window.pbClearWelcomePending = clearWelcomePending;

  var _syncRetryTimers = {};
  function syncAccount(uid) {
    if (!uid || uid !== _uid || localOwner() !== uid) return;
    if (_syncRetryTimers[uid]) { clearTimeout(_syncRetryTimers[uid]); delete _syncRetryTimers[uid]; }
    flushDirty(uid).then(function (ok) {
      if (uid !== _uid || localOwner() !== uid) return;
      if (ok) { pull(uid); return; }
      var err = new Error('pending-sync-failed');
      emitSyncReady(uid, {}, false, err);
      _syncRetryTimers[uid] = setTimeout(function () {
        delete _syncRetryTimers[uid];
        syncAccount(uid);
      }, 4000);
    });
  }

  // Sesión: al entrar, traer la nube; al salir, parar.
  window.addEventListener('pb-auth', function (e) {
    var user = e.detail;
    // El invitado anónimo del draft multijugador NO sincroniza preferencias.
    var nextUid = (user && !user.isAnonymous) ? user.uid : null;
    // onAuthStateChanged llega DESPUÉS de que Firebase haya cambiado de identidad:
    // aquí solo aparcamos timers. El outbox persistente se reintenta al volver a
    // autenticar ese uid; intentar escribir ahora violaría las reglas de Firestore.
    if (_uid && _uid !== nextUid) {
      detachPending(_uid);
      // Una escritura offline puede dejar su Promise pendiente indefinidamente.
      // La llamada ya está en la cola interna de Firestore; soltamos solo nuestra
      // cadena JS para que un futuro login del mismo uid pueda reintentar el outbox.
      _saveGeneration[_uid] = (_saveGeneration[_uid] || 0) + 1;
      delete _saveChains[_uid];
    }

    var owner = localOwner();
    if (!owner) {
      if (!_authResolved && nextUid) {
        // Primer callback con una sesión ya restaurada: el estado legacy visible
        // pertenece a esa misma cuenta.
        setUnsignedOwner('guest');
        emptyNamespace('guest');
        setLocalOwner(nextUid);
      } else {
        // Primer callback deslogueado. Si ya había datos al desplegar esta versión,
        // se guardan como «legacy» y nunca se adjudican a otra cuenta por accidente.
        owner = materializedHasAccountData() ? 'legacy' : 'guest';
        setUnsignedOwner(owner);
        setLocalOwner(owner);
      }
      owner = localOwner();
    }

    var targetOwner = nextUid || unsignedOwner();
    var canAdoptGuest = !!nextUid && owner === 'guest';
    if (!switchNamespace(targetOwner, canAdoptGuest)) {
      _uid = null;
      _authResolved = true;
      diag(new Error('namespace-switch-failed'));
      return;
    }

    _uid = nextUid;
    _authResolved = true;
    Object.keys(LIST_KEYS).forEach(refreshList);
    if (window._jugarRefresh) try { window._jugarRefresh(); } catch (ignore) {}
    if (_uid) syncAccount(_uid);
  });
})();
