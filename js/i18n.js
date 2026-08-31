/* ══════════════════════════════════════════════════════════════════
   js/i18n.js — Motor de internacionalización (UI multilingüe)

   Idiomas: es (por defecto, el original), en, ja.
   Las traducciones viven en data/i18n.js  (window.I18N_DICT).

   USO desde HTML estático (lo aplica applyI18n al cargar y al cambiar idioma):
     <span data-i18n="nav.board">Tablero</span>          → textContent
     <div  data-i18n-html="draft.startDesc">…</div>       → innerHTML (permite <br>/<b>)
     <button data-i18n-attr="title:nav.settings">…</button> → atributos (title, aria-label…)

   USO desde JS (cadenas dinámicas):
     window.t('draft.round', { n: 3 })   →  "Ronda 3" / "Round 3" / "ラウンド 3"
     window.i18n.setLang('en')           →  cambia idioma + reaplica + evento 'langchange'

   Las vistas que pintan HTML dinámico deben escuchar 'langchange' y re-renderizar.
   Carga ANTES que shared.js/main.js (y después de data/i18n.js).
══════════════════════════════════════════════════════════════════ */
;(function () {
  'use strict';

  const STORE = 'pocketboard_lang_v1';
  const LANGS = ['es', 'en', 'ja', 'it', 'fr', 'pt', 'ko'];
  const FALLBACK = 'es';  // idioma original (completo) → respaldo para claves sin traducir
  const INITIAL = 'en';   // idioma al abrir sin idioma de navegador reconocido
  const ABBR = { es: 'ES', en: 'EN', ja: 'JA', it: 'IT', fr: 'FR', pt: 'PT', ko: 'KO' };

  // Banderas SVG (NO emoji: los emoji de bandera no se ven en Windows → saldrían
  // las letras "PT"/"ES"). SVG inline = se ven igual en todos los navegadores.
  // en → Reino Unido · pt → Brasil (la traducción es portugués de Brasil).
  const FLAGS = {
    es: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#c60b1e"/><rect y="4" width="24" height="8" fill="#ffc400"/></svg>',
    en: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#012169"/><path d="M0 0l24 16M24 0L0 16" stroke="#fff" stroke-width="3.2"/><path d="M0 0l24 16M24 0L0 16" stroke="#c8102e" stroke-width="1.6"/><path d="M12 0v16M0 8h24" stroke="#fff" stroke-width="5"/><path d="M12 0v16M0 8h24" stroke="#c8102e" stroke-width="3"/></svg>',
    ja: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#fff"/><circle cx="12" cy="8" r="4.4" fill="#bc002d"/></svg>',
    it: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#fff"/><rect width="8" height="16" fill="#009246"/><rect x="16" width="8" height="16" fill="#ce2b37"/></svg>',
    fr: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#fff"/><rect width="8" height="16" fill="#0055a4"/><rect x="16" width="8" height="16" fill="#ef4135"/></svg>',
    pt: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#009c3b"/><path d="M12 2.2 22 8 12 13.8 2 8Z" fill="#ffdf00"/><circle cx="12" cy="8" r="3" fill="#002776"/></svg>',
    ko: '<svg viewBox="0 0 24 16"><rect width="24" height="16" fill="#fff"/><circle cx="12" cy="8" r="4" fill="#cd2e3a"/><path d="M12 8a2 2 0 0 1 4 0 4 4 0 0 1-8 0 2 2 0 0 1 4 0z" fill="#0047a0"/></svg>'
  };
  function flagHtml(code) { return '<span class="lang-flag" aria-hidden="true">' + (FLAGS[code] || '') + '</span>'; }

  // Diccionarios por idioma — los pone data/i18n.js
  const DICT = (window.I18N_DICT = window.I18N_DICT || { es: {}, en: {}, ja: {}, it: {}, fr: {}, pt: {}, ko: {} });

  let _lang = (function () {
    try {
      const s = localStorage.getItem(STORE);
      if (s && LANGS.indexOf(s) !== -1) return s;
    } catch (e) {}
    // Sin preferencia guardada (primera visita) → autodetectar el idioma del
    // navegador: si es uno de los soportados (it/es/ja/en) se abre en él, si no
    // cae a INITIAL (inglés). Así un visitante italiano aterriza en italiano.
    try {
      const cands = [].concat(navigator.languages || [], navigator.language || []);
      for (let i = 0; i < cands.length; i++) {
        const code = String(cands[i] || '').slice(0, 2).toLowerCase();
        if (LANGS.indexOf(code) !== -1) return code;
      }
    } catch (e) {}
    return INITIAL;
  })();

  // t(clave, vars) → cadena traducida. Interpola {var}. Fallback: idioma actual →
  // español (siempre completo) → la propia clave (así un fallo canta, no rompe).
  function t(key, vars) {
    if (key == null) return '';
    const cur = DICT[_lang] || {};
    const base = DICT[FALLBACK] || {};
    let s = cur[key];
    if (s == null) s = base[key];
    if (s == null) s = key;
    if (vars) {
      s = s.replace(/\{(\w+)\}/g, function (m, k) {
        return vars[k] != null ? vars[k] : m;
      });
    }
    return s;
  }

  function getLang() { return _lang; }

  function setLang(lang) {
    if (LANGS.indexOf(lang) === -1 || lang === _lang) return;
    _lang = lang;
    try { localStorage.setItem(STORE, lang); } catch (e) {}
    document.documentElement.setAttribute('lang', lang);
    applyI18n();
    syncLangSwitch();
    // Las vistas dinámicas (tablero, draft, Cartas, Mazos) re-renderizan aquí.
    try { window.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } })); }
    catch (e) {}
  }

  // Aplica traducciones a todo el HTML estático marcado con data-i18n*.
  function applyI18n(root) {
    root = root || document;
    root.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        const ix = pair.indexOf(':');
        if (ix < 0) return;
        const attr = pair.slice(0, ix).trim();
        const key = pair.slice(ix + 1).trim();
        if (attr && key) el.setAttribute(attr, t(key));
      });
    });
  }

  // ── Selector de idioma de la barra: botón compacto (#lang-current) que muestra la
  //    abreviatura del idioma actual + desplegable flotante (#lang-menu con [data-lang]).
  //    También admite cualquier #lang-switch heredado (lista de botones [data-lang]).
  function setMenuOpen(open) {
    const sel = document.getElementById('lang-select');
    if (!sel) return;
    sel.classList.toggle('open', open);
    const btn = document.getElementById('lang-current');
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  window._closeLangMenu = function () { setMenuOpen(false); };
  // Antepone la bandera (y envuelve el nombre) en cada botón de idioma — una sola vez.
  function decorateLangButtons() {
    document.querySelectorAll('#lang-menu [data-lang], #lang-switch [data-lang], .drawer-lang[data-lang]').forEach(function (b) {
      if (b._flagged) return; b._flagged = true;
      const code = b.getAttribute('data-lang');
      const name = b.textContent.trim();
      b.textContent = '';
      b.insertAdjacentHTML('afterbegin', flagHtml(code) + '<span class="lang-name">' + name + '</span>');
    });
  }
  function syncLangSwitch() {
    const cur = document.getElementById('lang-current');
    if (cur) cur.innerHTML = flagHtml(_lang) + '<span class="lang-code">' + (ABBR[_lang] || _lang.toUpperCase()) + '</span>';
    document.querySelectorAll('#lang-menu [data-lang], #lang-switch [data-lang], .drawer-lang[data-lang]').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-lang') === _lang);
    });
  }
  function wireLangSwitch() {
    document.querySelectorAll('#lang-menu [data-lang], #lang-switch [data-lang]').forEach(function (b) {
      if (b._wired) return; b._wired = true;
      b.addEventListener('click', function () { setLang(b.getAttribute('data-lang')); setMenuOpen(false); });
    });
    const cur = document.getElementById('lang-current');
    if (cur && !cur._wired) {
      cur._wired = true;
      cur.addEventListener('click', function (e) {
        e.stopPropagation();
        const sel = document.getElementById('lang-select');
        const willOpen = !(sel && sel.classList.contains('open'));
        // Abrir el idioma cierra el popup de ajustes (no se superponen).
        if (willOpen && window._closeSettingsPopup) window._closeSettingsPopup();
        setMenuOpen(willOpen);
      });
      document.addEventListener('click', function () { setMenuOpen(false); });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenuOpen(false); });
    }
    decorateLangButtons();
    syncLangSwitch();
  }

  window.t = t;
  window.i18n = {
    t: t, getLang: getLang, setLang: setLang,
    applyI18n: applyI18n, langs: LANGS, fallback: FALLBACK,
  };

  document.documentElement.setAttribute('lang', _lang);
  function init() { applyI18n(); wireLangSwitch(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
