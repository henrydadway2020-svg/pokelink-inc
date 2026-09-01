/* ══════════════════════════════════════════════════════════════════════════
   firebase-module.js — MÓDULO ONLINE REAL (Auth + Firestore).
   Reemplaza al stub "MODO LOCAL" que vivía inline en index.html. Define
   window.pbAuth / pbRooms / pbPvp / pbPresence con la MISMA forma que
   esperan auth.js, draft-multi.js, pvp.js, pvp-sync.js y presence.js.

   Requiere que ANTES de este script se hayan cargado, en este orden:
     1) firebase-app-compat.js, firebase-auth-compat.js, firebase-firestore-compat.js
     2) shared.js (hace firebase.initializeApp(firebaseConfig))

   Colecciones Firestore usadas (crear con estas reglas de seguridad):
     rooms/{code}                    — salas de Draft 1v1
     pvpGames/{code}                 — partidas PvP del tablero
     pvpGames/{code}/priv/{uid}      — datos privados por jugador (mano oculta, etc.)
     presence/{uid}                  — latido de presencia (online / en partida)

   NOTA: window.pbDB (guardado en la nube de mazos/tierlists, usado por
   cloud-sync.js) NO se implementa aquí todavía. cloud-sync.js comprueba
   `if (!window.pbDB) return` en cada punto de entrada, así que seguir sin
   él es seguro: simplemente no habrá guardado en la nube por ahora.
══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) {
    console.error('[firebase-module] firebase no está inicializado — revisa el orden de los <script> en index.html.');
    return;
  }

  var auth = firebase.auth();
  var db = firebase.firestore();
  var googleProvider = new firebase.auth.GoogleAuthProvider();

  // Ventana de «sigue en línea»: un latido de presencia más viejo que esto
  // se considera desconectado. DEBE ser mayor que el latido lento de
  // presence.js (25 s) — ver comentario en ese archivo.
  var PRESENCE_WINDOW_MS = 45000;

  // ────────────────────────── pbAuth ──────────────────────────
  var pbAuth = {
    ready: false,
    user: null,
    current: function () { return auth.currentUser; },

    signInGoogle: function () {
      return auth.signInWithPopup(googleProvider);
    },
    reauthenticateGoogle: function () {
      var u = auth.currentUser;
      if (!u) return Promise.reject({ code: 'auth/no-current-user' });
      return u.reauthenticateWithPopup(googleProvider);
    },
    signInCustomToken: function (token) {
      return auth.signInWithCustomToken(token);
    },
    signInAnonymous: function () {
      return auth.signInAnonymously();
    },
    getIdToken: function (forceRefresh) {
      var u = auth.currentUser;
      if (!u) return Promise.reject({ code: 'auth/no-current-user' });
      return u.getIdToken(!!forceRefresh);
    },
    getIdTokenResult: function (forceRefresh) {
      var u = auth.currentUser;
      if (!u) return Promise.reject({ code: 'auth/no-current-user' });
      return u.getIdTokenResult(!!forceRefresh);
    },
    // Sin Firebase App Check configurado por ahora: devolvemos '' (igual que
    // el fallback que ya usa auth.js cuando esta función no existe).
    getAppCheckToken: function () {
      return Promise.resolve('');
    },
    // Discord requiere un backend propio (custom token + endpoints de
    // link/unlink) que este proyecto todavía no tiene: siempre false.
    getAccessMethods: function () {
      var u = auth.currentUser;
      if (!u) return Promise.resolve({ ready: true, google: false, discord: false, current: '', recent: false, authTimeMs: 0 });
      var google = (u.providerData || []).some(function (p) { return p && p.providerId === 'google.com'; });
      var lastSignIn = (u.metadata && u.metadata.lastSignInTime) ? Date.parse(u.metadata.lastSignInTime) : 0;
      return Promise.resolve({
        ready: true,
        google: google,
        discord: false,
        current: google ? 'google' : (u.isAnonymous ? 'anonymous' : ''),
        recent: false,
        authTimeMs: lastSignIn || 0
      });
    },
    signOutUser: function () {
      return auth.signOut();
    },
    deleteAccount: function () {
      var u = auth.currentUser;
      if (!u) return Promise.reject({ code: 'auth/no-current-user' });
      return u.delete();
    }
  };
  window.pbAuth = pbAuth;

  auth.onAuthStateChanged(function (user) {
    pbAuth.ready = true;
    pbAuth.user = user;
    window.dispatchEvent(new CustomEvent('pb-auth', { detail: user }));
  });

  // ─────────────────── Fábrica genérica Firestore (rooms / pvpGames) ───────────────────
  function makeCollection(name) {
    var col = db.collection(name);
    return {
      get: function (key) {
        return col.doc(String(key)).get().then(function (snap) {
          return snap.exists ? snap.data() : null;
        });
      },
      // No pisa una sala/partida ya existente con el mismo código (colisión
      // de código aleatorio) — falla con 'already-exists' si el doc ya está.
      create: function (key, data) {
        var ref = col.doc(String(key));
        return db.runTransaction(function (tx) {
          return tx.get(ref).then(function (snap) {
            if (snap.exists) { var e = new Error('room-exists'); e.code = 'already-exists'; throw e; }
            tx.set(ref, data);
          });
        });
      },
      // merge:true → parchea solo las claves indicadas (incluido poner una
      // clave a null), sin pisar el resto del documento.
      set: function (key, patch) {
        return col.doc(String(key)).set(patch, { merge: true });
      },
      update: function (key, patch) {
        return col.doc(String(key)).update(patch);
      },
      remove: function (key) {
        return col.doc(String(key)).delete();
      },
      // Devuelve la función de desuscripción, tal y como esperan
      // draft-multi.js / pvp-sync.js (state.unsub = pbRooms.watch(...)).
      watch: function (key, cb) {
        return col.doc(String(key)).onSnapshot(
          function (snap) { cb(snap.exists ? snap.data() : null); },
          function () { cb(undefined); }   // error de red/permisos
        );
      }
    };
  }

  window.pbRooms = makeCollection('rooms');

  var pvpBase = makeCollection('pvpGames');
  pvpBase.getPriv = function (code, uid) {
    return db.collection('pvpGames').doc(String(code)).collection('priv').doc(String(uid))
      .get().then(function (snap) { return snap.exists ? snap.data() : null; });
  };
  pvpBase.setPriv = function (code, uid, data) {
    return db.collection('pvpGames').doc(String(code)).collection('priv').doc(String(uid))
      .set(data, { merge: true });
  };
  window.pbPvp = pvpBase;

  // ────────────────────────── pbPresence ──────────────────────────
  var presenceCol = db.collection('presence');
  window.pbPresence = {
    beat: function (uid, inMatch) {
      return presenceCol.doc(String(uid)).set({
        t: firebase.firestore.FieldValue.serverTimestamp(),
        m: !!inMatch
      }, { merge: true });
    },
    leave: function (uid) {
      return presenceCol.doc(String(uid)).delete();
    },
    counts: function () {
      var cutoff = firebase.firestore.Timestamp.fromMillis(Date.now() - PRESENCE_WINDOW_MS);
      return presenceCol.where('t', '>', cutoff).get().then(function (qs) {
        var online = 0, inMatch = 0;
        qs.forEach(function (doc) {
          online++;
          if (doc.data().m) inMatch++;
        });
        return { online: online, inMatch: inMatch };
      });
    }
  };
})();
