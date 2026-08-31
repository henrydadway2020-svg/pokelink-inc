/* ══════════════════════════════════════════════════════════════
   MOBILE NAV — drawer del menú hamburguesa (Tanda 1: marco móvil)
   Depende de: switchAppTab (cards-view.js), window.i18n (i18n.js).
   Ajustes = sub-página del drawer (mueve .sb-settings-inner del popup al host).
   El drawer solo es alcanzable cuando se ve el burger (≤1024px: tablet + móvil),
   pero la lógica es global e inofensiva en desktop.
══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  function el(id) { return document.getElementById(id); }

  var drawer  = el('app-drawer');
  var burger  = el('app-nav-burger');
  if (!drawer) return;

  // ── Abrir / cerrar ──────────────────────────────────────────
  function isOpen() { return drawer.classList.contains('open'); }

  function open() {
    if (isOpen()) return;
    var panel = el('app-drawer-panel');
    if (panel) panel.classList.remove('show-settings');   // abre siempre en la página principal
    syncActiveTab();
    syncActiveLang();
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    if (burger) burger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';   // bloquea scroll detrás
  }

  function close() {
    if (!isOpen()) return;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    if (burger) burger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    var panel = el('app-drawer-panel');
    if (panel) panel.classList.remove('show-settings');
    relocateSettingsOut();   // devuelve el contenido al popup (para el engranaje de desktop)
  }

  function toggle() { isOpen() ? close() : open(); }

  // Exponer para los onclick inline del HTML
  window.toggleAppDrawer = toggle;
  window.openAppDrawer   = open;
  window.closeAppDrawer  = close;

  // ── Navegación entre secciones ──────────────────────────────
  drawer.querySelectorAll('.drawer-tab').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var tab = btn.getAttribute('data-tab');
      close();
      // Barajas / Meta comparten vista: mismo camino que el nav de escritorio (fuerzan su lado)
      if (tab === 'mazos' && window._mazosOpenMine) return window._mazosOpenMine();
      if (tab === 'meta'  && window._mazosOpenMeta) return window._mazosOpenMeta();
      if (window.switchAppTab) window.switchAppTab(tab);
    });
  });

  // Refleja la sección activa leyendo la pestaña activa del nav superior
  function syncActiveTab() {
    var activeNav = document.querySelector('#app-nav-tabs .app-tab.active');
    var current = activeNav ? activeNav.id.replace('app-tab-', '') : null;
    drawer.querySelectorAll('.drawer-tab').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === current);
    });
  }

  // ── Idioma ──────────────────────────────────────────────────
  drawer.querySelectorAll('.drawer-lang').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var lang = btn.getAttribute('data-lang');
      if (window.i18n && window.i18n.setLang) window.i18n.setLang(lang);
      syncActiveLang();
    });
  });

  function syncActiveLang() {
    var cur = (window.i18n && window.i18n.getLang) ? window.i18n.getLang() : null;
    drawer.querySelectorAll('.drawer-lang').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === cur);
    });
  }
  window.addEventListener('langchange', syncActiveLang);

  // ── Ajustes como SUB-PÁGINA del drawer (con botón atrás) ──
  // El contenido real (.sb-settings-inner) se MUEVE del popup al host del drawer
  // al abrir Ajustes y se devuelve al cerrar el drawer (el popup flotante se
  // reserva para el engranaje de desktop). Así los toggles/botones (por id) viven.
  var _settingsAnchor = null;
  function relocateSettingsIn() {
    var host = el('app-drawer-settings-host');
    if (!host) return;
    var inner = document.querySelector('#sb-settings-popup .sb-settings-inner');
    if (inner && inner.parentNode !== host) {
      if (!_settingsAnchor && inner.parentNode) {
        _settingsAnchor = document.createComment('sbs');
        inner.parentNode.insertBefore(_settingsAnchor, inner);
      }
      host.appendChild(inner);
    }
  }
  function relocateSettingsOut() {
    var host = el('app-drawer-settings-host');
    var inner = host && host.querySelector('.sb-settings-inner');
    if (inner && _settingsAnchor && _settingsAnchor.parentNode) {
      _settingsAnchor.parentNode.insertBefore(inner, _settingsAnchor);
    }
  }
  window.openDrawerSettings = function () {
    relocateSettingsIn();
    var panel = el('app-drawer-panel');
    if (panel) panel.classList.add('show-settings');
  };
  window.closeDrawerSettings = function () {
    var panel = el('app-drawer-panel');
    if (panel) panel.classList.remove('show-settings');
  };

  // ── Cerrar con Escape (primero la sub-página de ajustes, luego el drawer) ──
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !isOpen()) return;
    var panel = el('app-drawer-panel');
    if (panel && panel.classList.contains('show-settings')) window.closeDrawerSettings();
    else close();
  });

  // Estado inicial de idioma
  syncActiveLang();
})();
