/* ══════════════════════════════════════════════════════════════
   auth.js — UI de cuenta / login con Google y Discord
   La capa Firebase vive en el <script type="module"> de index.html
   (window.pbAuth + evento 'pb-auth').
   Tras la auditoría de Ajustes (2026-06-18): la cuenta NO ocupa la barra.
   El botón único de la barra (#app-gear-btn) es un ENGRANAJE sin sesión y
   TU FOTO con sesión; abre el popup de Ajustes, que lleva arriba la sección
   de Cuenta y debajo los Efectos. La pantalla de login (#auth-overlay) sigue.
   Estética: pestaña Cartas (system-ui, neutro). Re-pinta en 'pb-auth'/'langchange'.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  function el(id) { return document.getElementById(id); }
  function T(k) { return (window.t ? window.t(k) : k); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var ICON = {
    person: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="5" r="2.6" stroke="currentColor" stroke-width="1.4"/><path d="M2.8 13.5c0-2.5 2.3-4 5.2-4s5.2 1.5 5.2 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    out:    '<svg viewBox="0 0 16 16" fill="none"><path d="M6 2.5H3.5A1.5 1.5 0 0 0 2 4v8a1.5 1.5 0 0 0 1.5 1.5H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M10 11l3-3-3-3M13 8H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  var GEAR = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3.1" stroke="currentColor" stroke-width="1.6"/><path d="M19.4 12.9c.04-.3.06-.6.06-.9s-.02-.6-.06-.9l1.9-1.5a.5.5 0 0 0 .12-.6l-1.8-3.1a.5.5 0 0 0-.6-.22l-2.2.9a6.9 6.9 0 0 0-1.55-.9l-.35-2.4a.5.5 0 0 0-.5-.42h-3.6a.5.5 0 0 0-.5.42l-.35 2.4c-.56.23-1.08.53-1.55.9l-2.2-.9a.5.5 0 0 0-.6.22l-1.8 3.1a.5.5 0 0 0 .12.6l1.9 1.5c-.04.3-.06.6-.06.9s.02.6.06.9l-1.9 1.5a.5.5 0 0 0-.12.6l1.8 3.1a.5.5 0 0 0 .6.22l2.2-.9c.47.37.99.67 1.55.9l.35 2.4a.5.5 0 0 0 .5.42h3.6a.5.5 0 0 0 .5-.42l.35-2.4c.56-.23 1.08-.53 1.55-.9l2.2.9a.5.5 0 0 0 .6-.22l1.8-3.1a.5.5 0 0 0-.12-.6l-1.9-1.5z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  // Isotipo monocromo oficial de Discord (Clyde). currentColor permite que el
  // mismo SVG viva en el botón de login y en la sección de métodos del perfil.
  var DISCORD_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.516.074.074 0 0 0-.079.037c-.211.376-.445.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.618-1.25.077.077 0 0 0-.078-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.319 13.58.1 18.058a.082.082 0 0 0 .031.056c2.053 1.508 4.041 2.423 5.993 3.03a.078.078 0 0 0 .084-.028c.462-.63.873-1.295 1.226-1.994a.076.076 0 0 0-.042-.106 12.3 12.3 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .079.009c.12.099.246.198.373.292a.077.077 0 0 1-.007.128c-.598.343-1.22.645-1.873.891a.077.077 0 0 0-.041.107c.36.698.772 1.363 1.225 1.993a.076.076 0 0 0 .084.029c1.961-.607 3.95-1.522 6.002-3.03a.077.077 0 0 0 .031-.055c.501-5.177-.838-9.674-3.548-13.66a.061.061 0 0 0-.031-.029ZM8.02 15.331c-1.183 0-2.157-1.086-2.157-2.419s.955-2.419 2.157-2.419c1.211 0 2.176 1.095 2.157 2.419 0 1.333-.956 2.419-2.157 2.419Zm7.975 0c-1.183 0-2.157-1.086-2.157-2.419s.955-2.419 2.157-2.419c1.211 0 2.176 1.095 2.157 2.419 0 1.333-.946 2.419-2.157 2.419Z"/></svg>';

  /* ── Contrato del OAuth de Discord ────────────────────────────────────────
     Configurable para poder apuntar a emuladores/preview sin tocar la lógica.
     El navegador solo recibe un handoff opaco de un uso; el code de Discord se
     consume servidor-servidor y el custom token de Firebase solo llega por POST. */
  var DISCORD_FUNCTIONS = 'https://europe-west1-tcg-pocket-hub.cloudfunctions.net/';
  var DISCORD_CONFIG = Object.assign({
    startUrl: DISCORD_FUNCTIONS + 'discordAuthStart',
    callbackUrl: DISCORD_FUNCTIONS + 'discordAuthCallback',
    exchangeUrl: DISCORD_FUNCTIONS + 'discordAuthExchange',
    completeUrl: DISCORD_FUNCTIONS + 'discordAuthCompleteRegistration',
    statusUrl: DISCORD_FUNCTIONS + 'discordAuthStatus',
    unlinkUrl: DISCORD_FUNCTIONS + 'discordAuthUnlink',
    deleteUrl: DISCORD_FUNCTIONS + 'discordAuthDeleteAccount',
    messageType: 'tcgmini:discord-auth',
    handoffParam: 'discord_handoff',
    errorParam: 'discord_error'
  }, window.PB_DISCORD_AUTH_CONFIG || {});
  window.PB_DISCORD_AUTH_CONFIG = DISCORD_CONFIG;

  // Hasta verificar el OAuth real, visible solo en localhost y previews. Para
  // publicarlo bastará PB_FLAGS.discordAuth=true; false siempre gana.
  function discordEnabled() {
    if (window.PB_FLAGS && typeof window.PB_FLAGS.discordAuth === 'boolean') return window.PB_FLAGS.discordAuth;
    var localOrigin = location.origin === 'http://localhost:8799' || location.origin === 'http://127.0.0.1:8799';
    return localOrigin || location.hostname === 'beta.tcgmini.pages.dev';
  }

  var pbProfile = {};   // {displayName, friendCode} de la cuenta (Firestore); llega por 'pb-doc'
  // El invitado del draft multijugador usa sesión ANÓNIMA: NO debe contar como cuenta
  // para la barra/cuenta/perfil (sí tiene uid, que el draft usa vía window.pbAuth).
  function curUser() {
    var u = (window.pbAuth && window.pbAuth.user) || null;
    return (u && u.isAnonymous) ? null : u;
  }
  function dName(u) {
    if (!u) return '';
    return (pbProfile && pbProfile.displayName) || u.displayName || (u.email ? u.email.split('@')[0] : T('auth.account'));
  }
  function initial(u) { var n = dName(u).trim(); return (n ? n.charAt(0) : '?').toUpperCase(); }

  // ── Avatar: icono propio elegido en «Mi perfil» (assets/avatars) > foto de
  // Google > inicial. El id elegido vive en pbProfile.avatar (sincronizado). ──
  function iconList() { return (window.PROFILE_ICONS || []); }
  function iconUrl(id) { return (window._normImg ? window._normImg((window.PROFILE_ICON_BASE || 'assets/avatars/') + id + '.png') : (window.PROFILE_ICON_BASE || 'assets/avatars/') + id + '.png'); }
  function iconValid(id) { return !!id && iconList().some(function (ic) { return ic.id === id; }); }
  function customAvatar() { return (pbProfile && iconValid(pbProfile.avatar)) ? pbProfile.avatar : ''; }
  function avatarSrc(u) {
    var c = customAvatar();
    if (c) return iconUrl(c);
    return (u && u.photoURL) || '';
  }
  function avatar(u) {
    var src = avatarSrc(u);
    if (src) return '<img class="auth-avatar" src="' + esc(src) + '" alt="" referrerpolicy="no-referrer">';
    return '<span class="auth-avatar auth-avatar--letter">' + esc(initial(u)) + '</span>';
  }

  /* ── Botón de la barra: SIEMPRE el engranaje ──────────────────────────────
     Ajustes son ajustes: la cuenta (foto, correo, cerrar sesión…) vive en la pestaña
     Perfil, que es donde uno la busca. Antes el engranaje se convertía en tu foto y
     colgaba de él un menú de cuenta, mezclando dos cosas distintas. */
  function setGearBtn() {
    var btn = el('app-gear-btn'); if (!btn) return;
    btn.innerHTML = GEAR;
    btn.classList.remove('has-account');
  }


  function renderBar() {
    setGearBtn(); renderProfilePanel();
  }

  /* ── Panel de CUENTA de la pestaña Perfil ─────────────────────────────────
     La pestaña Perfil se re-pinta entera con innerHTML (medallero-view), así que este
     panel se MONTA en los huecos que deja: #pf-account (identidad), #pf-friendcode y
     #pf-account-actions. Lo llama renderBar (cambios de sesión/perfil) y el propio
     medallero tras cada render. La lógica sigue viviendo aquí: una sola fuente. */
  var CLIP = '<svg viewBox="0 0 16 16" fill="none"><rect x="5.5" y="5.5" width="8" height="8" rx="1.6" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 5.5V4A1.5 1.5 0 0 0 9 2.5H4A1.5 1.5 0 0 0 2.5 4v5A1.5 1.5 0 0 0 4 10.5h1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var PENCIL_S = '<svg viewBox="0 0 16 16" fill="none"><path d="M11.5 2.6l1.9 1.9-7 7-2.4.5.5-2.4 7-7z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

  // Los providerData de Firebase sí registran Google; Discord entra mediante
  // custom token y se reconoce por el claim tcgminiProvider que emite el backend.
  // Se cachea por uid para no pedir un token cada vez que Perfil se re-renderiza.
  var methodsCache = Object.create(null);
  var methodsPending = Object.create(null);
  var methodsEpoch = 0;
  var RECENT_AUTH_MS = 4 * 60 * 1000; // margen frente al límite servidor de 5 min
  function syncProviderIds(u) {
    return ((u && u.providerData) || []).map(function (p) { return p && p.providerId; }).filter(Boolean);
  }
  function methodState(u) {
    if (!u) return { ready: true, google: false, discord: false, current: '', recent: false, authTimeMs: 0 };
    var ids = syncProviderIds(u);
    var cached = methodsCache[u.uid];
    return cached || {
      ready: false,
      google: ids.indexOf('google.com') >= 0,
      // Un usuario real sin providerData solo puede venir del custom token de
      // Discord en esta app. El token asíncrono confirmará el claim enseguida.
      discord: ids.length === 0,
      current: ids.indexOf('google.com') >= 0 ? 'google' : (ids.length === 0 ? 'discord' : ''),
      recent: false,
      authTimeMs: 0
    };
  }
  function accessIsRecent(methods, nowMs) {
    var authTimeMs = Number(methods && methods.authTimeMs) || 0;
    var age = Number(nowMs == null ? Date.now() : nowMs) - authTimeMs;
    return authTimeMs > 0 && age >= 0 && age < RECENT_AUTH_MS;
  }
  function refreshAccessMethods(u, force) {
    if (!u || !(window.pbAuth && window.pbAuth.getAccessMethods)) return Promise.resolve(methodState(u));
    if (!force && methodsCache[u.uid] && methodsCache[u.uid].ready) return Promise.resolve(methodsCache[u.uid]);
    if (methodsPending[u.uid]) return methodsPending[u.uid];
    var epoch = methodsEpoch;
    var pending = window.pbAuth.getAccessMethods(!!force).then(function (next) {
      if (methodsPending[u.uid] === pending) delete methodsPending[u.uid];
      if (epoch !== methodsEpoch) return methodState(u);
      var prev = methodsCache[u.uid];
      next = Object.assign({ ready: true, google: false, discord: false, current: '', recent: false, authTimeMs: 0 }, next || {});
      methodsCache[u.uid] = next;
      if (!prev || prev.google !== next.google || prev.discord !== next.discord || prev.current !== next.current || prev.authTimeMs !== next.authTimeMs) {
        renderProfilePanel();
      }
      return next;
    }, function () {
      if (methodsPending[u.uid] === pending) delete methodsPending[u.uid];
      return methodState(u);
    });
    methodsPending[u.uid] = pending;
    return pending;
  }
  function invalidateAccessMethods() {
    methodsEpoch++;
    methodsCache = Object.create(null);
    methodsPending = Object.create(null);
  }
  function markDiscordConnected(u) {
    if (!u) return;
    var cur = methodState(u);
    methodsCache[u.uid] = { ready: true, google: !!cur.google, discord: true, current: 'discord',
      recent: true, authTimeMs: Date.now() };
  }
  function accessMethodsHtml(u) {
    if (!u || !discordEnabled()) return '';
    var m = methodState(u);
    var html = '<div class="prof-auth-methods">' +
      '<span class="prof-auth-methods-title">' + esc(T('auth.signInMethods')) + '</span>' +
      '<div class="prof-auth-methods-list">';
    if (m.google) html += '<span class="prof-auth-method"><span class="prof-auth-dot"></span>Google</span>';
    if (m.discord) {
      html += '<span class="prof-auth-method prof-auth-method--discord">' + DISCORD_ICON + '<span>Discord</span><i aria-hidden="true">✓</i></span>';
      // Separar Discord de la cuenta no puede exigir borrarla: sin este botón,
      // el único camino era el borrado, que se lleva mazos y progreso por delante.
      if (m.google) {
        html += '<button type="button" class="prof-unlink-discord" id="pf-unlink-discord">' +
          esc(T('auth.unlinkDiscord')) + '</button>';
      }
    }
    // Esperar al claim evita que una cuenta ya vinculada vea un destello del botón.
    if (m.ready && m.google && !m.discord) {
      html += '<button type="button" class="prof-connect-discord" id="pf-connect-discord">' +
        DISCORD_ICON + '<span class="auth-d-label">' + esc(T('auth.connectDiscord')) + '</span></button>';
    }
    return html + '</div></div>';
  }

  function renderProfilePanel() {
    var host = el('pf-account');
    var fcHost = el('pf-friendcode');
    var acHost = el('pf-account-actions');
    if (!host && !fcHost && !acHost) return;   // la pestaña Perfil no está montada
    var u = curUser();
    if (host) {
      host.innerHTML = u
        ? '<button type="button" id="prof-pfp-btn" class="pf-avatar" title="' + esc(T('profile.changeAvatar')) + '">' +
            '<span id="prof-pfp"></span>' +
            '<span class="prof-pfp-edit" aria-hidden="true">' + PENCIL_S + '</span>' +
          '</button>' +
          '<button type="button" id="prof-name-display" class="prof-name-display pf-name"></button>' +
          '<span id="prof-email" class="prof-email"></span>' +
          '<div id="prof-avatars" class="prof-collapsed"></div>'
        : '<div class="pf-avatar pf-avatar--empty"><span class="pf-letter">?</span></div>' +
          '<button type="button" id="pf-signin" class="pf-signin">' + ICON.person +
          '<span>' + esc(T('auth.signIn')) + '</span></button>';
    }
    if (fcHost) {
      fcHost.style.display = u ? '' : 'none';
      if (u) fcHost.innerHTML =
        '<span class="pf-fc-label">' + esc(T('profile.friendCode')) + '</span>' +
        '<div class="prof-fc-row">' +
          '<button type="button" id="prof-fc-display" class="prof-inline-row"></button>' +
          '<button type="button" id="prof-fc-copy" class="prof-icon-btn" title="' + esc(T('profile.copyFc')) + '">' + CLIP + '</button>' +
        '</div>';
    }
    if (acHost) {
      acHost.style.display = u ? '' : 'none';
      if (u) acHost.innerHTML =
        accessMethodsHtml(u) +
        '<div class="prof-account-links">' +
          '<button type="button" class="prof-link" id="pf-export">' + esc(T('account.download')) + '</button>' +
          '<button type="button" class="prof-link" id="pf-signout">' + esc(T('auth.signOut')) + '</button>' +
          '<button type="button" class="prof-link prof-link--danger" id="pf-delete">' + esc(T('account.delete')) + '</button>' +
        '</div>';
    }
    if (u) { renderPfp(); renderNameLine(); renderFcLine(); renderAvatarPicker(); collapseAvatars(); }
    wireProfile();
    var si = el('pf-signin');   if (si) si.addEventListener('click', openLogin);
    var ex = el('pf-export');   if (ex) ex.addEventListener('click', exportData);
    var so = el('pf-signout');  if (so) so.addEventListener('click', doSignOut);
    var de = el('pf-delete');   if (de) de.addEventListener('click', deleteAccount);
    var dc = el('pf-connect-discord'); if (dc) dc.addEventListener('click', connectDiscord);
    var du = el('pf-unlink-discord'); if (du) du.addEventListener('click', unlinkDiscord);
    if (u && discordEnabled()) refreshAccessMethods(u, false);
  }
  window.pbRenderProfilePanel = renderProfilePanel;

  /* ── Sección de cuenta en el drawer móvil ── */
  function renderDrawer() {
    var host = el('drawer-account'); if (!host) return;
    var u = curUser();
    if (!u) {
      host.innerHTML =
        '<button class="drawer-account-signin" id="drawer-signin" type="button">' +
          ICON.person + '<span>' + esc(T('auth.signIn')) + '</span></button>';
      var b = el('drawer-signin');
      if (b) b.addEventListener('click', function () {
        if (window.closeAppDrawer) window.closeAppDrawer();
        openLogin();
      });
    } else {
      // La tarjeta ES el acceso a Perfil (donde vive todo lo de la cuenta, incluido
      // cerrar sesión): un solo destino en vez de tres botones que decían lo mismo.
      host.innerHTML =
        '<button class="drawer-account-card" id="drawer-profile" type="button">' + avatar(u) +
          '<div class="drawer-account-id"><span class="drawer-account-name">' + esc(dName(u)) + '</span>' +
          '<span class="drawer-account-email">' + esc(u.email || '') + '</span></div>' +
          '<span class="drawer-account-go" aria-hidden="true">›</span></button>';
      var pf = el('drawer-profile');
      if (pf) pf.addEventListener('click', function () { if (window.closeAppDrawer) window.closeAppDrawer(); openProfile(); });
    }
  }

  function closePopup() {
    if (window._closeSettingsPopup) { window._closeSettingsPopup(); return; }
    var p = el('sb-settings-popup'); if (p) p.classList.remove('open');
    var g = el('app-gear-btn'); if (g) g.classList.remove('active');
  }

  /* ── Pantalla de login ── */
  function openLogin() {
    var ov = el('auth-overlay'); if (!ov) return;
    var discordBtn = el('auth-discord-btn'); if (discordBtn) discordBtn.hidden = !discordEnabled();
    ov.style.display = 'flex';
    requestAnimationFrame(function () { ov.classList.add('open'); });
    document.body.style.overflow = 'hidden';
    syncAuthBusyUi();
  }
  function closeLogin() {
    var ov = el('auth-overlay'); if (!ov) return;
    cancelDiscordChoice();
    cancelDiscordFlow();
    ov.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { if (!ov.classList.contains('open')) ov.style.display = 'none'; }, 240);
  }

  var authBusy = '';
  var authBusyLabel = '';
  var discordFlow = null;
  var discordChoice = null;
  var discordFallback = null;
  var authResolved = false;
  var deletingAccount = false;
  var DISCORD_FLOW_STORE = 'tcgmini_discord_auth_v1';
  var DISCORD_FLOW_CHANNEL = 'tcgmini_discord_auth_result_v1';
  var DISCORD_POST_TIMEOUT_MS = 20000;
  var DISCORD_FLOW_TTL_MS = 12 * 60 * 1000;
  var discordResultChannel = null;
  try {
    if (typeof window.BroadcastChannel === 'function') {
      discordResultChannel = new window.BroadcastChannel(DISCORD_FLOW_CHANNEL);
    }
  } catch (e) { discordResultChannel = null; }

  function syncAuthBusyUi() {
    var busy = !!authBusy || deletingAccount;
    var specs = [
      { id: 'auth-google-btn', kind: 'google', label: '.auth-g-label', idle: 'auth.continueGoogle' },
      { id: 'auth-discord-btn', kind: 'discord', label: '.auth-d-label', idle: 'auth.continueDiscord' },
      { id: 'pf-connect-discord', kind: 'discord', label: '.auth-d-label', idle: 'auth.connectDiscord' }
    ];
    specs.forEach(function (s) {
      var btn = el(s.id); if (!btn) return;
      btn.disabled = busy;
      btn.classList.toggle('busy', busy && authBusy === s.kind);
      var label = btn.querySelector(s.label);
      if (label) label.textContent = (busy && authBusy === s.kind && authBusyLabel) ? T(authBusyLabel) : T(s.idle);
    });
    ['pf-signout', 'pf-delete'].forEach(function (id) {
      var button = el(id); if (button) button.disabled = busy;
    });
    var close = el('auth-close'); if (close) close.disabled = false; // cancelar siempre sigue disponible
  }
  function setAuthBusy(kind, labelKey) {
    authBusy = kind || '';
    authBusyLabel = labelKey || '';
    syncAuthBusyUi();
  }
  function clearAuthBusy() { setAuthBusy('', ''); }

  function authErr(code, message) {
    var e = new Error(message || code || 'Discord auth error');
    e.code = code || 'discord/error';
    return e;
  }
  function benignAuthError(err) {
    var code = err && err.code ? String(err.code) : '';
    return code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request' ||
      code === 'discord/cancelled' || code === 'discord/popup-closed-by-user';
  }
  // El mensaje debe nombrar lo que ha fallado, no el botón que no se pulsó.
  // App Check y el bloqueo de ventanas emergentes le pasan igual a Google y a
  // Discord: antes CUALQUIER código con «appcheck» acababa en el texto de
  // Discord, así que un login de Google roto por App Check se anunciaba como
  // «Discord no está disponible» y mandaba a buscar el fallo donde no estaba.
  function authErrorKey(err, mode, provider) {
    var code = err && err.code ? String(err.code) : '';
    var normalized = code.toLowerCase();
    var appCheckFailed = normalized.indexOf('app-check') >= 0 || normalized.indexOf('app_check') >= 0 || normalized.indexOf('appcheck') >= 0;
    if (appCheckFailed) return 'auth.verifyFailed';
    if (normalized.indexOf('popup-blocked') >= 0) return 'auth.popupBlocked';
    // Lo que queda solo lo produce el flujo de Discord. Un error de Firebase
    // («auth/…») dentro de ese flujo es de la sesión, no del proveedor.
    if (provider === 'google' || code.indexOf('auth/') === 0) return 'auth.error';
    if (code.indexOf('last_sign_in_method') >= 0) return 'auth.unlinkLastMethod';
    if (code.indexOf('already_linked') >= 0 || code.indexOf('already-linked') >= 0 || code.indexOf('account_mismatch') >= 0) return 'auth.discordAlreadyLinked';
    if (code.indexOf('handoff') >= 0 || code.indexOf('binding') >= 0 || code.indexOf('state') >= 0 || code.indexOf('invalid_response') >= 0) return 'auth.discordStateError';
    if (code.indexOf('oauth_failed') >= 0 || code.indexOf('unavailable') >= 0 || code.indexOf('network') >= 0 || code.indexOf('timeout') >= 0 || code.indexOf('http_5') >= 0) return 'auth.discordUnavailable';
    if (mode === 'link') return 'auth.discordLinkError';
    return 'auth.error';
  }
  function showAuthError(err, mode, provider) {
    if (benignAuthError(err) || !window.pbToast) return;
    var code = err && err.code ? String(err.code) : '';
    var msg = T(authErrorKey(err, mode, provider));
    if (code && window.pbFlag && window.pbFlag('debug')) msg += ' (' + code + ')';
    window.pbToast(msg);
  }

  function withDiscordTimeout(work, controller, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        try { if (controller) controller.abort(); } catch (e) {}
        reject(authErr('discord/timeout'));
      }, timeoutMs);
      Promise.resolve(work).then(function (value) {
        if (done) return;
        done = true; clearTimeout(timer); resolve(value);
      }, function (err) {
        if (done) return;
        done = true; clearTimeout(timer); reject(err);
      });
    });
  }

  function jsonPost(url, body, idToken) {
    if (!url || !window.fetch) return Promise.reject(authErr('discord/unavailable'));
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (idToken) headers.Authorization = 'Bearer ' + idToken;
    var controller = typeof window.AbortController === 'function' ? new window.AbortController() : null;
    var appCheck = (window.pbAuth && window.pbAuth.getAppCheckToken)
      ? window.pbAuth.getAppCheckToken(false) : Promise.resolve('');
    var request = appCheck.then(function (appCheckToken) {
      if (!appCheckToken) throw authErr('discord/app_check_required');
      if (appCheckToken) headers['X-Firebase-AppCheck'] = appCheckToken;
      var options = {
        method: 'POST', mode: 'cors', credentials: 'omit', headers: headers,
        body: JSON.stringify(body || {})
      };
      if (controller) options.signal = controller.signal;
      return fetch(url, options);
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch (e) { throw authErr('discord/invalid_response'); }
        if (!res.ok || data.ok === false) {
          var nested = data.error && typeof data.error === 'object' ? data.error.code : data.error;
          var backendCode = String(nested || data.code || ('http_' + res.status)).replace(/^discord\//, '');
          throw authErr('discord/' + backendCode, data.message);
        }
        return data;
      });
    });
    return withDiscordTimeout(request, controller, DISCORD_POST_TIMEOUT_MS).catch(function (err) {
      if (err && err.code) throw err;
      throw authErr('discord/network', err && err.message);
    });
  }

  function createDiscordFlowId() {
    try {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      return Array.prototype.map.call(bytes, function (n) { return ('0' + n.toString(16)).slice(-2); }).join('');
    } catch (e) {
      return String(Date.now()) + '-' + String(Math.random()).slice(2);
    }
  }

  // BroadcastChannel solo transporta el resultado mínimo entre dos ventanas del
  // MISMO origin cuando Discord ha cortado window.opener. Nunca replica el handoff,
  // browserBinding ni el custom token de Firebase.
  function safeDiscordNoticeResult(result) {
    var safe = {};
    if (result && typeof result.status === 'string') safe.status = result.status.slice(0, 40);
    if (result && typeof result.reauthToken === 'string' && result.reauthToken.length >= 20 && result.reauthToken.length <= 512) {
      safe.reauthToken = result.reauthToken;
    }
    return safe;
  }
  function discordNoticeMatches(data, flow) {
    return !!(data && data.type === DISCORD_FLOW_CHANNEL && flow &&
      typeof flow.flowId === 'string' && flow.flowId.length >= 20 &&
      data.flowId === flow.flowId);
  }
  function notifyOriginalDiscordFlow(flowId, ok, result, errorCode) {
    if (!discordResultChannel || typeof flowId !== 'string' || flowId.length < 20) return false;
    try {
      discordResultChannel.postMessage({
        type: DISCORD_FLOW_CHANNEL,
        flowId: flowId,
        ok: !!ok,
        result: ok ? safeDiscordNoticeResult(result) : {},
        error: ok ? '' : String(errorCode || 'discord/error').slice(0, 100)
      });
      return true;
    } catch (e) { return false; }
  }

  function storedDiscordFlow() {
    try {
      var parsed = JSON.parse(sessionStorage.getItem(DISCORD_FLOW_STORE) || 'null');
      if (!parsed || Date.now() - Number(parsed.startedAt || 0) > DISCORD_FLOW_TTL_MS) return null;
      if (['signin', 'link', 'reauth'].indexOf(parsed.mode) < 0) return null;
      return parsed;
    } catch (e) { return null; }
  }
  function rememberDiscordFlow(mode) {
    var data = { mode: mode, returnUrl: location.href, startedAt: Date.now(), flowId: createDiscordFlowId() };
    try { sessionStorage.setItem(DISCORD_FLOW_STORE, JSON.stringify(data)); } catch (e) {}
    return data;
  }
  function rememberBrowserBinding(browserBinding) {
    if (typeof browserBinding !== 'string' || browserBinding.length < 20 || browserBinding.length > 512) {
      throw authErr('discord/invalid_response');
    }
    if (discordFlow) discordFlow.browserBinding = browserBinding;
    try {
      var data = storedDiscordFlow() || {};
      data.browserBinding = browserBinding;
      sessionStorage.setItem(DISCORD_FLOW_STORE, JSON.stringify(data));
    } catch (e) {
      // Sin sessionStorage el popup normal sigue seguro con la copia en memoria;
      // solo se pierde el fallback de navegación.
    }
    return browserBinding;
  }
  function mirrorDiscordFlowToPopup(popup) {
    if (!popup || !discordFlow) return;
    try {
      var data = storedDiscordFlow() || {
        mode: discordFlow.mode, returnUrl: location.href,
        startedAt: discordFlow.startedAt, flowId: discordFlow.flowId
      };
      data.browserBinding = discordFlow.browserBinding;
      // about:blank hereda nuestro origin hasta navegar a Discord. La copia vive
      // en el sessionStorage propio del popup y reaparece solo si vuelve a tcgmini.
      popup.sessionStorage.setItem(DISCORD_FLOW_STORE, JSON.stringify(data));
    } catch (e) {}
  }
  function forgetDiscordFlow() {
    try { sessionStorage.removeItem(DISCORD_FLOW_STORE); } catch (e) {}
  }
  function exactCallbackOrigin() {
    try { return new URL(DISCORD_CONFIG.callbackUrl, location.href).origin; }
    catch (e) { return ''; }
  }
  function oauthReturnUrl() {
    // El fragmento queda reservado al handoff de fallback. La ruta original se
    // conserva en sessionStorage y se restaura antes de procesar la respuesta.
    return location.origin + location.pathname + location.search;
  }

  function openDiscordPopup() {
    var w = 520, h = 720;
    var left = Math.max(0, Math.round((window.screenX || 0) + ((window.outerWidth || w) - w) / 2));
    var top = Math.max(0, Math.round((window.screenY || 0) + ((window.outerHeight || h) - h) / 2));
    var popup = null;
    try {
      // Se abre EN EL MISMO gesto del usuario, antes de pedir tokens o hacer fetch:
      // así Chrome/Safari no lo consideran un popup tardío.
      popup = window.open('about:blank', 'tcgmini-discord-auth',
        'popup=yes,width=' + w + ',height=' + h + ',left=' + left + ',top=' + top + ',resizable=yes,scrollbars=yes');
      if (popup) {
        popup.document.title = 'TCGmini';
        popup.document.body.textContent = T('auth.discordPreparing');
        popup.document.body.style.cssText = 'margin:0;min-height:100vh;display:grid;place-items:center;background:#15151c;color:rgba(255,255,255,.72);font:600 14px system-ui,sans-serif';
      }
    } catch (e) { popup = null; }
    return popup;
  }

  function settleDiscordFlow(ok, value) {
    var flow = discordFlow;
    if (!flow) return;
    discordFlow = null;
    if (flow.timer) clearInterval(flow.timer);
    if (flow.popup && !flow.popup.closed) { try { flow.popup.close(); } catch (e) {} }
    forgetDiscordFlow();
    (ok ? flow.resolve : flow.reject)(value);
  }
  function cancelDiscordFlow() {
    if (!discordFlow) return;
    settleDiscordFlow(false, authErr('discord/cancelled'));
  }
  function handleDiscordFlowNotice(data) {
    var flow = discordFlow;
    if (!discordNoticeMatches(data, flow)) return false;
    flow.processing = true;
    if (flow.timer) { clearInterval(flow.timer); flow.timer = 0; }
    if (data.ok) settleDiscordFlow(true, data.result || {});
    else settleDiscordFlow(false, authErr(data.error || 'discord/error'));
    return true;
  }
  if (discordResultChannel) {
    discordResultChannel.onmessage = function (event) { handleDiscordFlowNotice(event && event.data); };
  }

  function startDiscordFlow(mode, options) {
    options = options || {};
    if (!discordEnabled()) return Promise.reject(authErr('discord/unavailable'));
    if (discordFlow) return Promise.reject(authErr('discord/cancelled'));
    if (!(window.pbAuth && window.pbAuth.getIdToken)) return Promise.reject(authErr('discord/unavailable'));

    var popup = options.sameTab ? null : openDiscordPopup();
    // Un flujo de borrado necesita volver a ESTA promesa; navegar toda la pestaña
    // perdería la confirmación. Login y link sí tienen fallback de retorno.
    if (!popup && mode === 'reauth') return Promise.reject(authErr('discord/popup-blocked'));
    var remembered = rememberDiscordFlow(mode);

    var promise = new Promise(function (resolve, reject) {
      discordFlow = {
        mode: mode, popup: popup, processing: false, resolve: resolve, reject: reject, timer: 0,
        flowId: remembered.flowId, startedAt: remembered.startedAt, browserBinding: ''
      };
    });
    var tokenPromise = mode === 'signin' ? Promise.resolve('') : window.pbAuth.getIdToken(!!options.forceRefresh);
    tokenPromise.then(function (idToken) {
      return jsonPost(DISCORD_CONFIG.startUrl, { mode: mode, returnUrl: oauthReturnUrl() }, idToken);
    }).then(function (data) {
      if (!discordFlow) return;
      rememberBrowserBinding(data.browserBinding);
      mirrorDiscordFlowToPopup(discordFlow.popup);
      var target;
      try { target = new URL(data.authorizeUrl); } catch (e) { throw authErr('discord/invalid_response'); }
      if (target.protocol !== 'https:' || !/(^|\.)discord\.com$/i.test(target.hostname)) throw authErr('discord/invalid_response');
      if (discordFlow.popup) discordFlow.popup.location.replace(target.href);
      else location.assign(target.href); // bloqueado: OAuth en esta pestaña y vuelta por fragmento
    }).catch(function (err) {
      if (discordFlow) settleDiscordFlow(false, err);
    });

    if (popup) {
      discordFlow.timer = setInterval(function () {
        if (!discordFlow || discordFlow.processing) return;
        if (Date.now() - discordFlow.startedAt > DISCORD_FLOW_TTL_MS) {
          settleDiscordFlow(false, authErr('discord/timeout')); return;
        }
        var closed = false;
        try { closed = popup.closed; } catch (e) {}
        if (closed) settleDiscordFlow(false, authErr('discord/popup-closed-by-user'));
      }, 350);
    }
    return promise;
  }

  function acceptDiscordFirebaseToken(data) {
    if (!data || !data.firebaseToken || !(window.pbAuth && window.pbAuth.signInCustomToken)) {
      return Promise.reject(authErr('discord/invalid_response'));
    }
    return window.pbAuth.signInCustomToken(data.firebaseToken).then(function (credential) {
      var u = (credential && credential.user) || curUser();
      markDiscordConnected(u);
      return data;
    });
  }

  function completeDiscordRegistration(registrationToken, action, browserBinding) {
    if (typeof browserBinding !== 'string' || browserBinding.length < 20 || browserBinding.length > 512) {
      return Promise.reject(authErr('discord/browser_binding_mismatch'));
    }
    var tokenPromise = action === 'link' ? window.pbAuth.getIdToken(false) : Promise.resolve('');
    return tokenPromise.then(function (idToken) {
      return jsonPost(DISCORD_CONFIG.completeUrl,
        { registrationToken: registrationToken, action: action, browserBinding: browserBinding }, idToken);
    }).then(acceptDiscordFirebaseToken);
  }

  function hideDiscordChoice() {
    var choice = el('auth-discord-choice');
    var providers = el('auth-provider-actions');
    if (choice) choice.hidden = true;
    if (providers) providers.hidden = false;
    var card = el('auth-card'); if (card) card.classList.remove('auth-choosing-discord');
    ['auth-discord-keep-google', 'auth-discord-create', 'auth-discord-choice-cancel'].forEach(function (id) {
      var b = el(id); if (b) { b.disabled = false; b.classList.remove('busy'); }
    });
  }
  function cancelDiscordChoice() {
    if (!discordChoice) { hideDiscordChoice(); return; }
    var reject = discordChoice.reject;
    discordChoice = null;
    hideDiscordChoice();
    reject(authErr('discord/cancelled'));
  }
  function chooseDiscordRegistration(registrationToken, browserBinding) {
    clearAuthBusy();
    openLogin();
    var choice = el('auth-discord-choice'), providers = el('auth-provider-actions');
    if (!choice) return Promise.reject(authErr('discord/invalid_response'));
    if (providers) providers.hidden = true;
    choice.hidden = false;
    var card = el('auth-card'); if (card) card.classList.add('auth-choosing-discord');

    return new Promise(function (resolve, reject) {
      discordChoice = { reject: reject };
      var keep = el('auth-discord-keep-google');
      var create = el('auth-discord-create');
      var cancel = el('auth-discord-choice-cancel');
      function choose(action, button) {
        if (!discordChoice) return;
        [keep, create, cancel].forEach(function (b) { if (b) b.disabled = true; });
        if (button) button.classList.add('busy');
        var work;
        if (action === 'link') {
          // La llamada ocurre directamente en el click: el popup de Google conserva
          // activación de usuario. Solo tras elegir cuenta se enlaza explícitamente.
          work = window.pbAuth.signInGoogle().then(function () {
            return completeDiscordRegistration(registrationToken, 'link', browserBinding);
          });
        } else {
          work = completeDiscordRegistration(registrationToken, 'create', browserBinding);
        }
        work.then(function (result) {
          discordChoice = null; hideDiscordChoice(); resolve(result);
        }, function (err) {
          discordChoice = null; hideDiscordChoice(); reject(err);
        });
      }
      if (keep) keep.onclick = function () { choose('link', keep); };
      if (create) create.onclick = function () { choose('create', create); };
      if (cancel) cancel.onclick = cancelDiscordChoice;
      setTimeout(function () { if (keep) keep.focus(); }, 60);
    });
  }

  function completeDiscordHandoff(handoff, mode, browserBinding) {
    if (!handoff || typeof handoff !== 'string' || handoff.length > 2048) {
      return Promise.reject(authErr('discord/invalid_handoff'));
    }
    if (typeof browserBinding !== 'string' || browserBinding.length < 20 || browserBinding.length > 512) {
      return Promise.reject(authErr('discord/browser_binding_mismatch'));
    }
    return jsonPost(DISCORD_CONFIG.exchangeUrl,
      { handoff: handoff, browserBinding: browserBinding }).then(function (data) {
      var resolvedMode = (data.mode === 'link' || data.mode === 'signin' || data.mode === 'reauth') ? data.mode : mode;
      if (data.status === 'existing' || data.status === 'created' || data.status === 'linked') {
        return acceptDiscordFirebaseToken(data);
      }
      if (data.status === 'registration_required' && data.registrationToken) {
        if (resolvedMode === 'link') return completeDiscordRegistration(data.registrationToken, 'link', browserBinding);
        if (resolvedMode === 'signin') return chooseDiscordRegistration(data.registrationToken, browserBinding);
      }
      if (data.status === 'reauthenticated' && data.reauthToken) return data;
      // El backend solo devuelve este status cuando el mapping ya pertenece al
      // UID esperado por Start. Es un enlace idempotente, no el conflicto 409
      // discord_already_linked (que jsonPost conserva como error específico).
      if (data.status === 'already_linked') return data;
      throw authErr('discord/invalid_response');
    });
  }

  window.addEventListener('message', function (event) {
    var flow = discordFlow;
    if (!flow || !flow.popup || event.source !== flow.popup) return;
    if (event.origin !== exactCallbackOrigin()) return;
    var data = event.data || {};
    if (data.type !== DISCORD_CONFIG.messageType) return;
    flow.processing = true;
    if (flow.timer) { clearInterval(flow.timer); flow.timer = 0; }
    try { flow.popup.close(); } catch (e) {}
    if (data.error) {
      settleDiscordFlow(false, authErr(data.error === 'cancelled' ? 'discord/cancelled' : 'discord/' + data.error));
      return;
    }
    if (!data.handoff) { settleDiscordFlow(false, authErr('discord/invalid_response')); return; }
    completeDiscordHandoff(data.handoff, flow.mode, flow.browserBinding).then(function (result) {
      settleDiscordFlow(true, result);
    }, function (err) {
      settleDiscordFlow(false, err);
    });
  });

  function consumeDiscordFallback() {
    var raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return null;
    var params;
    try { params = new URLSearchParams(raw); } catch (e) { return null; }
    var handoff = params.get(DISCORD_CONFIG.handoffParam);
    var error = params.get(DISCORD_CONFIG.errorParam);
    if (!handoff && !error) return null;
    var stored = storedDiscordFlow();
    params.delete(DISCORD_CONFIG.handoffParam);
    params.delete(DISCORD_CONFIG.errorParam);

    // Retirar el handoff de la barra ANTES de cualquier fetch. Si existía un
    // hash propio (#deck=...), se restaura desde el valor guardado del mismo origin.
    var clean = location.pathname + location.search + (params.toString() ? '#' + params.toString() : '');
    if (stored && stored.returnUrl) {
      try {
        var previous = new URL(stored.returnUrl, location.href);
        if (previous.origin === location.origin) clean = previous.pathname + previous.search + previous.hash;
      } catch (e2) {}
    }
    try { history.replaceState(history.state, '', clean); } catch (e3) {}
    if (error) return { error: error, browserBinding: stored && stored.browserBinding,
      mode: (stored && stored.mode) || 'signin', flowId: stored && stored.flowId };
    return { handoff: handoff, browserBinding: stored && stored.browserBinding,
      mode: (stored && stored.mode) || 'signin', flowId: stored && stored.flowId };
  }

  function processDiscordFallback() {
    if (!authResolved || !discordFallback) return;
    var payload = discordFallback;
    discordFallback = null;
    if (payload.error) {
      forgetDiscordFlow(); clearAuthBusy();
      if (payload.error !== 'cancelled') showAuthError(authErr('discord/' + payload.error), payload.mode, 'discord');
      notifyOriginalDiscordFlow(payload.flowId, false, null,
        payload.error === 'cancelled' ? 'discord/cancelled' : 'discord/' + payload.error);
      return;
    }
    if ((payload.mode === 'link' || payload.mode === 'reauth') && !curUser()) {
      forgetDiscordFlow(); showAuthError(authErr('discord/invalid_handoff'), payload.mode, 'discord'); return;
    }
    setAuthBusy('discord', 'auth.discordConnecting');
    completeDiscordHandoff(payload.handoff, payload.mode, payload.browserBinding).then(function (result) {
      forgetDiscordFlow();
      var completedMode = result && result.status === 'reauthenticated' ? 'reauth' :
        ((result && result.status === 'linked') || (result && result.status === 'already_linked') ? 'link' : payload.mode);
      if (completedMode === 'link') {
        var u = curUser(); markDiscordConnected(u); renderProfilePanel();
        if (window.pbToast) window.pbToast(T('auth.discordConnected'));
      } else if (completedMode === 'signin') closeLogin();
      notifyOriginalDiscordFlow(payload.flowId, true, result, '');
    }).catch(function (err) {
      forgetDiscordFlow(); showAuthError(err, payload.mode, 'discord');
      notifyOriginalDiscordFlow(payload.flowId, false, null, err && err.code);
    }).then(clearAuthBusy);
  }

  function doGoogleSignIn() {
    if (authBusy) return;
    if (!(window.pbAuth && window.pbAuth.signInGoogle)) {
      if (window.pbToast) window.pbToast(T('auth.error'));
      return;
    }
    setAuthBusy('google', 'auth.signingIn');
    window.pbAuth.signInGoogle().then(function () {
      closeLogin();
    }).catch(function (err) {
      showAuthError(err, 'signin', 'google');
    }).then(clearAuthBusy);
  }

  function doDiscordSignIn() {
    if (authBusy || !discordEnabled()) return;
    setAuthBusy('discord', 'auth.discordPreparing');
    startDiscordFlow('signin').then(function () {
      closeLogin();
    }).catch(function (err) {
      showAuthError(err, 'signin', 'discord');
    }).then(clearAuthBusy);
  }

  function connectDiscord() {
    if (authBusy || !discordEnabled() || !curUser()) return;
    var u = curUser();
    var methods = methodState(u);
    var start;
    if (methods.google && !accessIsRecent(methods, Date.now()) && window.pbAuth && window.pbAuth.reauthenticateGoogle) {
      // Una sesión antigua debe demostrar Google primero. Esa reautenticación
      // consume el gesto/popup; Discord continúa en la misma pestaña y vuelve
      // por fragmento, evitando que el navegador bloquee un segundo popup tardío.
      setAuthBusy('google', 'auth.signingIn');
      start = window.pbAuth.reauthenticateGoogle().then(function () {
        setAuthBusy('discord', 'auth.discordConnecting');
        return startDiscordFlow('link', { sameTab: true, forceRefresh: true });
      });
    } else {
      setAuthBusy('discord', 'auth.discordConnecting');
      start = startDiscordFlow('link');
    }
    start.then(function () {
      var u = curUser(); markDiscordConnected(u);
      renderProfilePanel();
      if (window.pbToast) window.pbToast(T('auth.discordConnected'));
    }).catch(function (err) {
      showAuthError(err, 'link', 'discord');
    }).then(clearAuthBusy);
  }

  // Un «se borrará todo» abstracto no frena a nadie. Decir CUÁNTO se pierde sí:
  // se cuenta lo guardado en este dispositivo, que es espejo de la cuenta.
  function deletionSummary() {
    function n(clave) {
      try {
        var raw = localStorage.getItem(clave);
        var arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr.length : 0;
      } catch (e) { return 0; }
    }
    var decks = n('pocketboard_library_v1');
    var tiers = n('pocketboard_tierlists_v1');
    var scenarios = n('pocketboard_scenarios_v1');
    if (!decks && !tiers && !scenarios) return '';
    return '\n\n' + T('account.deleteSummary', { decks: decks, tiers: tiers, scenarios: scenarios });
  }

  function unlinkDiscord() {
    if (authBusy || !discordEnabled() || !curUser()) return;
    var pregunta = (window.pbConfirm
      ? window.pbConfirm({ title: T('auth.unlinkTitle'), message: T('auth.unlinkMsg'),
          okLabel: T('auth.unlinkDiscord'), cancelLabel: T('common.cancel') })
      : Promise.resolve(window.confirm(T('auth.unlinkMsg'))));
    pregunta.then(function (yes) {
        if (!yes) return;
        var u = curUser(); if (!u) return;
        var methods = methodState(u);
        setAuthBusy('discord', 'auth.discordConnecting');
        // El servidor exige sesión reciente. Reautentica el método que SE QUEDA.
        var start = (!accessIsRecent(methods, Date.now()) && window.pbAuth && window.pbAuth.reauthenticateGoogle)
          ? window.pbAuth.reauthenticateGoogle() : Promise.resolve();
        return start
          .then(function () { return window.pbAuth.getIdToken(true); })
          .then(function (idToken) { return jsonPost(DISCORD_CONFIG.unlinkUrl, {}, idToken); })
          .then(function () {
            invalidateAccessMethods();
            return refreshAccessMethods(curUser(), true);
          })
          .then(function () {
            renderProfilePanel();
            if (window.pbToast) window.pbToast(T('auth.discordUnlinked'));
          })
          .catch(function (err) { showAuthError(err, 'unlink', 'discord'); })
          .then(clearAuthBusy);
      });
  }

  function reauthenticateDiscord() {
    if (!discordEnabled()) return Promise.reject(authErr('discord/unavailable'));
    setAuthBusy('discord', 'auth.discordConnecting');
    return startDiscordFlow('reauth').then(function (result) {
      if (!result || !result.reauthToken) throw authErr('discord/invalid_response');
      return result.reauthToken;
    }).then(function (token) {
      clearAuthBusy(); return token;
    }, function (err) {
      clearAuthBusy(); throw err;
    });
  }

  function doSignOut() {
    if (deletingAccount) return;
    closePopup();
    if (window.closeAppDrawer) window.closeAppDrawer();
    if (window.pbAuth && window.pbAuth.signOutUser) window.pbAuth.signOutUser();
  }

  function showPrivacy() {
    var about = el('about-overlay');
    if (about) {
      about.classList.remove('open');
      about.style.display = 'none';
    }
    var ov = el('privacy-overlay');
    if (!ov) { if (window.pbToast) window.pbToast(T('auth.privacyPending')); return; }
    ov.style.display = 'flex';
    requestAnimationFrame(function () { ov.classList.add('open'); });
    document.body.style.overflow = 'hidden';
  }
  function closePrivacy() {
    var ov = el('privacy-overlay'); if (!ov) return;
    ov.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { if (!ov.classList.contains('open')) ov.style.display = 'none'; }, 240);
  }

  /* ── Descargar mis datos (export JSON) ── */
  function exportData() {
    var u = curUser();
    function ls(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return localStorage.getItem(k); } }
    var data = {
      app: 'TCGmini', exportedAt: new Date().toISOString(),
      account: u ? { email: u.email, displayName: (pbProfile && pbProfile.displayName) || u.displayName || '', friendCode: (pbProfile && pbProfile.friendCode) || '' } : null,
      decks: ls('pocketboard_library_v1') || [],
      scenarios: ls('pocketboard_scenarios_v1') || [],
      tierlists: ls('pocketboard_tierlists_v1') || [],
      settings: { lang: localStorage.getItem('pocketboard_lang_v1'), effects: ls('pocketboard_fx_v1'), matColor: localStorage.getItem('pocketboard_felt_v1') }
    };
    try {
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = 'tcgmini-datos.json';
      document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    } catch (e) { if (window.pbToast) window.pbToast(T('auth.error')); }
  }

  /* ── Borrar mi cuenta (con confirmación) ── */
  function deleteAccount() {
    if (deletingAccount || !(window.pbAuth && window.pbAuth.deleteAccount)) return;
    deletingAccount = true;
    syncAuthBusyUi();
    closeProfile();   // cerrar el perfil para que el diálogo de confirmación quede limpio
    var go = function (ok) {
      if (!ok) { deletingAccount = false; syncAuthBusyUi(); return; }
      window.pbAuth.deleteAccount().then(function () {
        if (window.pbToast) window.pbToast(T('account.deleted'));
      }).catch(function (err) {
        var code = err && err.code ? err.code : '';
        if (!benignAuthError(err) && window.pbToast) window.pbToast(T('auth.error') + ((code && window.pbFlag && window.pbFlag('debug')) ? ' (' + code + ')' : ''));
      }).then(function () {
        deletingAccount = false;
        syncAuthBusyUi();
      });
    };
    if (window.pbConfirm) {
      var aviso = T('account.deleteConfirm') + deletionSummary();
      window.pbConfirm({ title: T('account.deleteTitle'), message: aviso, okLabel: T('account.deleteBtn'), cancelLabel: T('common.cancel') }).then(go, function () { go(false); });
    } else { go(window.confirm(T('account.deleteConfirm') + deletionSummary())); }
  }

  /* ── Acerca de ── */
  function showAbout() {
    closePopup();
    var ov = el('about-overlay'); if (!ov) return;
    ov.style.display = 'flex';
    requestAnimationFrame(function () { ov.classList.add('open'); });
    document.body.style.overflow = 'hidden';
  }
  function closeAbout() {
    var ov = el('about-overlay'); if (!ov) return;
    ov.classList.remove('open');
    document.body.style.overflow = '';
    setTimeout(function () { if (!ov.classList.contains('open')) ov.style.display = 'none'; }, 240);
  }

  /* ── Mi perfil: avatar grande + «cambiar», nombre y código de amigo editables
       INLINE (clic → input, commit en blur/Enter, como el nombre del tablero) y
       GUARDADO INMEDIATO a la cuenta (sin botón Guardar). ── */
  var PENCIL = '<svg class="prof-pencil" viewBox="0 0 16 16" fill="none"><path d="M11.4 2.5l2.1 2.1-7.2 7.2-2.7.6.6-2.7 7.2-7.2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>';

  // Persiste un cambio parcial del perfil de inmediato y re-pinta la barra/drawer.
  function persistProfile(patch) {
    var u = curUser(); if (!u) return;
    pbProfile = Object.assign({}, pbProfile, patch);
    if (window.pbDB && u.uid) window.pbDB.save(u.uid, { profile: pbProfile, updatedAt: Date.now() }).catch(function () {});
    renderBar(); renderDrawer();
  }

  function renderPfp() {
    var host = el('prof-pfp'); if (!host) return;
    var u = curUser(), src = avatarSrc(u);
    host.innerHTML = src
      ? '<img src="' + esc(src) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="prof-pfp-letter">' + esc(initial(u)) + '</span>';
  }
  function renderNameLine() {
    var b = el('prof-name-display'); if (!b) return;
    var u = curUser();
    var name = (pbProfile && pbProfile.displayName) || (u && u.displayName) || (u && u.email ? u.email.split('@')[0] : '');
    b.innerHTML = '<span class="prof-name-text">' + esc(name || T('profile.noName')) + '</span>' + PENCIL;
    var em = el('prof-email'); if (em) em.textContent = (u && u.email) || '';
  }
  function renderFcLine() {
    var b = el('prof-fc-display'); if (!b) return;
    var fc = (pbProfile && pbProfile.friendCode) || '';
    b.innerHTML = (fc
      ? '<span class="prof-fc-text">' + esc(fc) + '</span>'
      : '<span class="prof-fc-text prof-empty">' + esc(T('profile.fcPlaceholder')) + '</span>') + PENCIL;
    var cp = el('prof-fc-copy'); if (cp) cp.style.display = fc ? '' : 'none';
  }
  function copyFriendCode() {
    var fc = (pbProfile && pbProfile.friendCode) || ''; if (!fc) return;
    var done = function () { if (window.pbToast) window.pbToast(T('profile.fcCopied')); };
    var fallback = function () {
      try {
        var ta = document.createElement('textarea'); ta.value = fc; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); done();
      } catch (e) {}
    };
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(fc).then(done, fallback); return; } } catch (e2) {}
    fallback();
  }

  // Edición inline genérica: reemplaza el contenido del botón por un <input> y
  // confirma en blur/Enter (Escape cancela). Mismo gesto que el nombre del tablero.
  function inlineEdit(btn, current, opts) {
    if (btn.querySelector('input')) return;
    var inp = document.createElement('input');
    inp.type = 'text'; inp.value = current; inp.className = opts.inputClass || 'prof-inline-input';
    inp.maxLength = opts.maxLen || 40; inp.spellcheck = false; inp.autocomplete = 'off';
    if (opts.placeholder) inp.placeholder = opts.placeholder;
    btn.innerHTML = ''; btn.appendChild(inp);
    inp.focus(); inp.select();
    var done = false;
    function commit(cancel) {
      if (done) return; done = true;
      opts.onCommit(cancel ? current : inp.value.trim().slice(0, opts.maxLen || 40));
    }
    inp.addEventListener('blur', function () { commit(false); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') inp.blur();
      else if (e.key === 'Escape') commit(true);
      e.stopPropagation();
    });
    inp.addEventListener('click', function (e) { e.stopPropagation(); });
  }

  /* ── Selector de avatar (rejilla, OCULTA hasta pulsar la foto / «cambiar») ── */
  function renderAvatarPicker() {
    var host = el('prof-avatars'); if (!host) return;
    var cur = customAvatar(), u = curUser();
    var defInner = (u && u.photoURL)
      ? '<img src="' + esc(u.photoURL) + '" alt="" referrerpolicy="no-referrer">'
      : '<span class="prof-av-letter">' + esc(initial(u)) + '</span>';
    var html = '<button type="button" class="prof-av prof-av--default' + (cur ? '' : ' selected') +
      '" data-av="" title="' + esc(T('profile.avatarDefault')) + '">' + defInner + '</button>';
    iconList().forEach(function (ic) {
      html += '<button type="button" class="prof-av' + (cur === ic.id ? ' selected' : '') +
        '" data-av="' + esc(ic.id) + '" title="' + esc(ic.name) + '">' +
        '<img loading="lazy" src="' + esc(iconUrl(ic.id)) + '" alt="' + esc(ic.name) + '"></button>';
    });
    host.innerHTML = html;
    host.querySelectorAll('.prof-av').forEach(function (bt) {
      bt.addEventListener('click', function () {
        var id = bt.getAttribute('data-av') || '';
        persistProfile({ avatar: iconValid(id) ? id : '' });
        renderPfp();
        var sel = host.querySelector('.prof-av.selected'); if (sel) sel.classList.remove('selected');
        bt.classList.add('selected');
        collapseAvatars();   // al elegir, se cierra la rejilla
      });
    });
  }
  function avatarsOpen()    { var h = el('prof-avatars'); return !!(h && !h.classList.contains('prof-collapsed')); }
  function expandAvatars()  { var h = el('prof-avatars'); if (h) h.classList.remove('prof-collapsed'); }
  function collapseAvatars(){ var h = el('prof-avatars'); if (h) h.classList.add('prof-collapsed'); }

  // Se re-cablea en CADA montaje: la pestaña Perfil se re-pinta con innerHTML, así que los
  // nodos son nuevos cada vez (no se acumulan listeners: los viejos mueren con su nodo).
  function wireProfile() {
    var pfp = el('prof-pfp-btn');
    if (pfp) pfp.addEventListener('click', function () { avatarsOpen() ? collapseAvatars() : expandAvatars(); });
    var nm = el('prof-name-display');
    if (nm) nm.addEventListener('click', function () {
      var u = curUser();
      inlineEdit(nm, (pbProfile && pbProfile.displayName) || (u && u.displayName) || '',
        { maxLen: 20, placeholder: T('profile.noName'), inputClass: 'prof-inline-input prof-inline-input--name',
          onCommit: function (val) { persistProfile({ displayName: val }); renderNameLine(); } });
    });
    var fc = el('prof-fc-display');
    if (fc) fc.addEventListener('click', function () {
      inlineEdit(fc, (pbProfile && pbProfile.friendCode) || '',
        { maxLen: 24, placeholder: T('profile.fcPlaceholder'), onCommit: function (val) { persistProfile({ friendCode: val }); renderFcLine(); } });
    });
    var cp = el('prof-fc-copy');
    if (cp) cp.addEventListener('click', function (e) { e.stopPropagation(); copyFriendCode(); });
  }

  // «Mi perfil» ya no es un modal: es la pestaña Perfil. Se conservan los nombres por si
  // algún sitio antiguo los llama.
  function openProfile() {
    closePopup();
    if (window.closeAppDrawer) window.closeAppDrawer();
    if (window.switchAppTab) window.switchAppTab('perfil');
  }
  function closeProfile() {}

  /* ── Expuesto para los onclick inline del HTML ── */
  window.pbOpenLogin      = openLogin;
  window.pbCloseLogin     = closeLogin;
  window.pbDoGoogleSignIn = doGoogleSignIn;
  window.pbDoDiscordSignIn = doDiscordSignIn;
  window.pbConnectDiscord = connectDiscord;
  window.pbUnlinkDiscord = unlinkDiscord;
  window.pbDiscordReauthenticate = reauthenticateDiscord;
  // Superficie deliberadamente pequeña para tests/emulador y para integrar el
  // backend sin exponer ni conservar custom tokens en window/localStorage.
  window.pbDiscordAuth = {
    enabled: discordEnabled,
    begin: startDiscordFlow,
    finishHandoff: completeDiscordHandoff,
    isRecentAccess: accessIsRecent,
    config: DISCORD_CONFIG
  };
  window.pbSignOut        = doSignOut;
  window.pbShowPrivacy    = showPrivacy;
  window.pbShowAbout      = showAbout;
  window.pbCloseAbout     = closeAbout;
  window.pbOpenProfile    = openProfile;
  window.pbCloseProfile   = closeProfile;
  window.pbClosePrivacy   = closePrivacy;
  window.pbExportData     = exportData;
  window.pbDeleteAccount  = deleteAccount;
  // Info de cuenta para el draft multijugador (uid + nombre + friend code; anon=invitado)
  // Info del perfil para otras vistas (pestaña Perfil / Maestría Pokémon):
  // nombre visible (misma precedencia que el modal) + avatar actual + inicial.
  window.pbProfileInfo = function () {
    var u = curUser();
    return { logged: !!u, name: u ? dName(u) : '', avatar: u ? avatarSrc(u) : '', initial: u ? initial(u) : '?',
             friendCode: (pbProfile && pbProfile.friendCode) || '' };
  };

  window.pbAccount = function () {
    var u = (window.pbAuth && window.pbAuth.user) || null;
    if (!u) return null;
    return {
      uid: u.uid,
      anon: !!u.isAnonymous,
      name: dName(u),
      friendCode: (pbProfile && pbProfile.friendCode) || '',
      avatar: avatarSrc(u)
    };
  };

  /* ── Eventos ── */
  window.addEventListener('pb-auth', function () {
    authResolved = true;
    invalidateAccessMethods();
    if (!curUser()) pbProfile = {};
    renderBar(); renderDrawer();
    processDiscordFallback();
  });
  // El perfil de la cuenta llega con el documento de Firestore (lo emite cloud-sync).
  window.addEventListener('pb-doc', function (e) { pbProfile = (e.detail && e.detail.profile) || {}; renderBar(); renderDrawer(); });
  window.addEventListener('langchange', function () { renderBar(); renderDrawer(); syncAuthBusyUi(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var lo = el('auth-overlay');
      if (lo && lo.classList.contains('open')) { closeLogin(); return; }
      var ab = el('about-overlay');
      if (ab && ab.classList.contains('open')) { closeAbout(); return; }
      var pv = el('privacy-overlay');
      if (pv && pv.classList.contains('open')) closePrivacy();
    }
  });

  // El callback sin opener vuelve por fragmento con un handoff opaco. Se retira
  // ahora mismo de la URL y se intercambia cuando Firebase resuelva la sesión.
  discordFallback = consumeDiscordFallback();

  // Pintura inicial (el estado real llega con 'pb-auth' cuando el módulo de Firebase resuelve)
  renderBar();
  renderDrawer();
})();
