/* ══════════════════════════════════════════════════════════════════
   js/deck-qr.js — Código 2D de mazos compatible con Pokémon TCG Pocket

   Genera el mismo tipo de código que la función «Compartir con código 2D»
   del juego (formato descifrado y validado el 2026-08-01): Pocket lo
   escanea con «Crear nueva» → «Escanear código» y carga el mazo.

   Payload (base64 estándar dentro de un QR con corrección H):
     [u8 nEntrenadores][nEntrenadores × u24be (10.000.000 + idInterno)]
     [u8 nPokemon]     [nPokemon × u24be idInterno]
     [u8 nEnergias]    [u8 tipo...]  (planta1 fuego2 agua3 rayo4 psíquico5 lucha6 oscuro7 metal8)

   - Los ids internos vienen de data/qr_ids.js (gen_qr_ids.py); los
     entrenadores (objetos/partidarios/herramientas/estadios/fósiles) ya
     llevan el offset +10M en la tabla → aquí solo se separa por valor.
   - El código ignora el arte (todas las impresiones comparten id interno)
     y NO lleva el nombre del mazo.
   - Depende de js/qr-vendor.js (window.qrcode) y data/qr_ids.js.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const T = (k, v) => (window.t ? window.t(k, v) : k);
  // Orden canónico de Pocket: índice + 1 = byte de energía del payload
  const ENERGY_ORDER = ['grass', 'fire', 'water', 'lightning', 'psychic', 'fighting', 'darkness', 'metal'];

  // ── Payload ──────────────────────────────────────────────────────
  // deck: { name, cards:[{id,name,...} con duplicados], energyTypes? }
  // → { payload, omitted:[nombres sin equivalente en Pocket], nCards }
  function payloadFor(deck) {
    const ids = window.QR_IDS || {};
    const trainers = [], pokemon = [], omitted = [], custom = [];
    (deck.cards || []).forEach(c => {
      const val = c && c.id ? ids[c.id] : undefined;
      if (val === undefined) {
        var _nm = (window.cardName ? window.cardName(c) : null) || (c && c.name) || '?';
        if (c && (c.custom || c._temp)) custom.push(_nm); else omitted.push(_nm);
        return;
      }
      (val >= 10000000 ? trainers : pokemon).push(val);
    });
    if (!trainers.length && !pokemon.length) return { payload: null, omitted, custom, nCards: 0 };

    let types = (deck.energyTypes && deck.energyTypes.length)
      ? Array.from(deck.energyTypes)
      : (window.inferDeckEnergies ? Array.from(window.inferDeckEnergies(deck.cards || [])) : []);
    const energies = ENERGY_ORDER.map((t, i) => types.includes(t) ? i + 1 : 0).filter(Boolean);

    const bytes = [];
    const push24 = v => { bytes.push((v >> 16) & 255, (v >> 8) & 255, v & 255); };
    bytes.push(trainers.length); trainers.forEach(push24);
    bytes.push(pokemon.length);  pokemon.forEach(push24);
    bytes.push(energies.length); energies.forEach(e => bytes.push(e));
    return {
      payload: btoa(String.fromCharCode.apply(null, bytes)),
      omitted,
      custom,
      nCards: trainers.length + pokemon.length,
    };
  }

  // ── Render estilizado (puntos + degradado azul + logo pokelink) ──
  // La corrección H (30%) absorbe el hueco del logo, igual que en el QR
  // oficial de Pocket (verificado con el decodificador de Vision).
  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // targetPx: lado deseado en píxeles (el real se redondea al módulo más cercano).
  // Lo usa la imagen del mazo, que lo pinta MUCHO más grande que el modal.
  function draw(canvas, payload, targetPx) {
    const qr = window.qrcode(0, 'H');
    qr.addData(payload, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    const QUIET = 4;
    const S = Math.max(6, Math.round((targetPx || 760) / (n + 2 * QUIET)));
    const W = (n + 2 * QUIET) * S;
    canvas.width = canvas.height = W;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, W);
    const grad = ctx.createLinearGradient(0, 0, 0, W);
    grad.addColorStop(0, '#3ab3e8');
    grad.addColorStop(1, '#1e4ed8');
    ctx.fillStyle = grad;

    // Hueco central para el logo (~23% del lado, dentro del margen de la corrección H)
    const L = Math.round(n * 0.23);
    const l0 = Math.floor((n - L) / 2);
    const inFinder = (r, c) => (r < 7 && c < 7) || (r < 7 && c >= n - 7) || (r >= n - 7 && c < 7);
    const inLogo   = (r, c) => r >= l0 && r < l0 + L && c >= l0 && c < l0 + L;

    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (!qr.isDark(r, c) || inFinder(r, c) || inLogo(r, c)) continue;
      ctx.beginPath();
      ctx.arc((c + QUIET + 0.5) * S, (r + QUIET + 0.5) * S, S * 0.37, 0, Math.PI * 2);
      ctx.fill();
    }

    // Finders redondeados (anillo + centro), como los del código de Pocket
    [[0, 0], [n - 7, 0], [0, n - 7]].forEach(([fr, fc]) => {
      const x = (fc + QUIET) * S, y = (fr + QUIET) * S, u = 7 * S;
      ctx.fillStyle = grad;
      rrect(ctx, x, y, u, u, 2.1 * S); ctx.fill();
      ctx.fillStyle = '#ffffff';
      rrect(ctx, x + 1.15 * S, y + 1.15 * S, u - 2.3 * S, u - 2.3 * S, 1.4 * S); ctx.fill();
      ctx.fillStyle = grad;
      rrect(ctx, x + 2.2 * S, y + 2.2 * S, u - 4.4 * S, u - 4.4 * S, 0.9 * S); ctx.fill();
    });

    // Logo pokelink (las 2 cartas del favicon) dibujado a mano en el hueco
    const box = L * S * 0.86;                        // glifo ~86% del hueco
    const bx = (l0 + QUIET) * S + (L * S - box) / 2;
    const by = (l0 + QUIET) * S + (L * S - box) / 2;
    const u = box / 32;                              // unidad del viewBox 32×32 del logo real
    ctx.lineWidth = 2.4 * u;
    ctx.strokeStyle = '#4dabff';
    rrect(ctx, bx + 7 * u, by + 5 * u, 13 * u, 18 * u, 2.5 * u); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    rrect(ctx, bx + 13 * u, by + 9 * u, 13 * u, 18 * u, 2.5 * u); ctx.fill();
    ctx.strokeStyle = '#ff6b6b';
    rrect(ctx, bx + 13 * u, by + 9 * u, 13 * u, 18 * u, 2.5 * u); ctx.stroke();
    return canvas;
  }

  // ── Modal ────────────────────────────────────────────────────────
  function show(deck) {
    const res = payloadFor(deck || {});
    if (!res.payload) { window.pbToast && window.pbToast(T('qr.empty')); return; }

    const overlay = document.createElement('div');
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal qr-modal';

    const title = document.createElement('div');
    title.className = 'pb-modal-title';
    title.textContent = T('qr.title');

    const name = document.createElement('div');
    name.className = 'qr-deck-name';
    name.textContent = deck.name || '';

    const bloqueado = res.custom.length > 0;

    const canvas = document.createElement('canvas');
    canvas.className = 'qr-canvas';
    if (!bloqueado) draw(canvas, res.payload);

    const hint = document.createElement('div');
    hint.className = 'qr-hint';
    hint.textContent = T('qr.hint');

    // Aviso de bloqueo: qué pasa y POR QUÉ CARTAS (sin esto parecía que el código fallaba)
    const blocked = document.createElement('div');
    if (bloqueado) {
      blocked.className = 'qr-blocked';
      const t = document.createElement('div');
      t.className = 'qr-blocked-title';
      t.textContent = T('qr.customBlocked');
      const ul = document.createElement('ul');
      ul.className = 'qr-blocked-list';
      const cuenta = new Map();                      // una línea por carta, con «×2» si hay copias
      res.custom.forEach(n => cuenta.set(n, (cuenta.get(n) || 0) + 1));
      cuenta.forEach((n, nombre) => {
        const li = document.createElement('li');
        li.textContent = n > 1 ? (nombre + ' ×' + n) : nombre;
        ul.appendChild(li);
      });
      const why = document.createElement('div');
      why.className = 'qr-blocked-why';
      why.textContent = T('qr.customWhy');
      blocked.appendChild(t); blocked.appendChild(ul); blocked.appendChild(why);
    }

    function close() { document.removeEventListener('keydown', esc, true); overlay.classList.remove('open'); setTimeout(() => overlay.remove(), 180); }
    function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }
    document.addEventListener('keydown', esc, true);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    // Botones de ICONO (descargar / cerrar), centrados — sin texto
    const actions = document.createElement('div');
    actions.className = 'qr-actions';
    const iconBtn = (svg, label, handler) => {
      const b = document.createElement('button');
      b.className = 'qr-icon-btn';
      b.innerHTML = svg;
      b.title = label;
      b.setAttribute('aria-label', label);
      b.onclick = handler;
      return b;
    };
    actions.appendChild(iconBtn(
      '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 3v9M6.2 8.6l3.8 3.8 3.8-3.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 14.5v1.4a1.6 1.6 0 0 0 1.6 1.6h9.8a1.6 1.6 0 0 0 1.6-1.6v-1.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      T('mazos.shareImage'),
      () => {
        canvas.toBlob(b => {
          if (!b) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(b);
          a.download = ((deck.name || 'deck').replace(/[^\wÀ-ɏ぀-ヿ一-鿿-]+/g, '_') || 'deck') + '_2D.png';
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        });
      }));
    actions.appendChild(iconBtn(
      '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>',
      T('overlay.close'),
      close));
    if (bloqueado) { const dl = actions.firstElementChild; if (dl) dl.remove(); }   // no hay código que descargar

    box.appendChild(title);
    if (deck.name) box.appendChild(name);
    if (bloqueado) { box.appendChild(blocked); }
    else { box.appendChild(canvas); box.appendChild(hint); }
    if (!bloqueado && res.omitted.length) {
      const om = document.createElement('div');
      om.className = 'qr-omitted';
      om.textContent = T('qr.omitted', { n: res.omitted.length });
      box.appendChild(om);
    }
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  // ══════════════════════════════════════════════════════════════
  // IMPORTAR: código 2D (de Pocket, nuestro o de otra web) → mazo
  // ══════════════════════════════════════════════════════════════

  // Espejo del RAR_ORDER de Cartas: al importar se elige la impresión BASE
  // (rareza más baja) de cada carta, porque el código no distingue el arte.
  const RAR_ORDER = ['◊', '◊◊', '◊◊◊', '◊◊◊◊', 'AR', 'SAR', 'IM', '✸', '✸✸', '♕', 'Promo'];
  const rarRank = id => {
    const c = window.dbLookup && window.dbLookup({ id });
    const i = c ? RAR_ORDER.indexOf(c.rarity) : -1;
    return i < 0 ? 99 : i;
  };

  let _rev = null;   // id interno → [ids nuestros] (perezoso; QR_IDS es estático por sesión)
  function revMap() {
    if (_rev) return _rev;
    _rev = {};
    const ids = window.QR_IDS || {};
    for (const id in ids) (_rev[ids[id]] = _rev[ids[id]] || []).push(id);
    return _rev;
  }

  // base64 → { pkVals, trVals, energies } | null si no es un payload de mazo válido
  // (validación estricta: así el escáner ignora QRs ajenos sin dar falsos positivos)
  function parsePayload(str) {
    let bytes;
    try {
      const bin = atob(String(str || '').trim());
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } catch (e) { return null; }
    let i = 0;
    if (bytes.length < 4) return null;
    const rd = () => { const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]; i += 3; return v; };
    const nt = bytes[i++];
    if (nt > 30 || bytes.length < 1 + nt * 3 + 1) return null;
    const trVals = [];
    for (let k = 0; k < nt; k++) { const v = rd(); if (v < 10000000) return null; trVals.push(v); }
    const np = bytes[i++];
    if (np > 30 || bytes.length < i + np * 3 + 1) return null;
    const pkVals = [];
    for (let k = 0; k < np; k++) { const v = rd(); if (v >= 10000000) return null; pkVals.push(v); }
    const ne = bytes[i++];
    if (ne > 3 || bytes.length !== i + ne) return null;
    const energies = [];
    for (let k = 0; k < ne; k++) { const e = bytes[i++]; if (e < 1 || e > 8) return null; energies.push(ENERGY_ORDER[e - 1]); }
    if (!trVals.length && !pkVals.length) return null;
    return { pkVals, trVals, energies };
  }

  // parsed → { cards (objetos DB, pokémon primero como en Pocket), energyTypes, unknown }
  function decodeToDeck(parsed) {
    const rev = revMap();
    const cards = [], seen = {};
    let unknown = 0;
    parsed.pkVals.concat(parsed.trVals).forEach(v => {
      const ours = rev[v];
      if (!ours || !ours.length) { unknown++; return; }
      // impresión base cacheada por valor (rareza más baja, luego id)
      const id = seen[v] || (seen[v] = ours.slice().sort((a, b) => (rarRank(a) - rarRank(b)) || (a < b ? -1 : 1))[0]);
      const rec = window.dbLookup && window.dbLookup({ id });
      if (!rec) { unknown++; return; }
      cards.push(Object.assign({}, rec));
    });
    return { cards, energyTypes: parsed.energies, unknown };
  }

  // Imagen/vídeo → payload parseado | null. BarcodeDetector nativo si existe;
  // si no, jsQR probando varias escalas (reducir mucho FUNDE los puntos
  // estilizados en módulos sólidos → jsQR lee también los QR "bonitos").
  async function decodeImage(src, quick) {
    try {
      if (window.BarcodeDetector) {
        const det = new BarcodeDetector({ formats: ['qr_code'] });
        const found = await det.detect(src);
        for (const c of found) { const p = parsePayload(c.rawValue); if (p) return p; }
      }
    } catch (e) { /* sin soporte real → jsQR */ }
    if (!window.jsQR) return null;
    const w0 = src.videoWidth || src.naturalWidth || src.width;
    const h0 = src.videoHeight || src.naturalHeight || src.height;
    if (!w0 || !h0) return null;
    const scales = quick ? [700] : [900, 1400, 550, 340];
    for (const target of scales) {
      const sc = Math.min(1, target / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      cx.drawImage(src, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h);
      const q = window.jsQR(d.data, w, h, { inversionAttempts: 'attemptBoth' });
      if (q && q.data) { const p = parsePayload(q.data); if (p) return p; }
    }
    return null;
  }

  // ── Modal de escaneo: cámara / subir / pegar / arrastrar ─────────
  function scanImport(onDeck) {
    const overlay = document.createElement('div');
    overlay.className = 'pb-modal-overlay';
    const box = document.createElement('div');
    box.className = 'pb-modal qr-modal qr-scan-modal';

    const title = document.createElement('div');
    title.className = 'pb-modal-title';
    title.textContent = T('qr.scanTitle');

    const video = document.createElement('video');
    video.className = 'qr-scan-video';
    video.muted = true;
    video.setAttribute('playsinline', '');
    video.style.display = 'none';

    const status = document.createElement('div');
    status.className = 'qr-status';
    status.style.display = 'none';

    const camBtn = document.createElement('button');
    camBtn.className = 'pb-btn qr-scan-main';
    camBtn.textContent = T('qr.useCamera');

    const upBtn = document.createElement('button');
    upBtn.className = 'pb-btn qr-scan-main';
    upBtn.textContent = T('qr.upload');

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/*';
    file.style.display = 'none';

    const drop = document.createElement('div');
    drop.className = 'qr-drop';
    drop.textContent = T('qr.pasteHint');

    const cam = { on: false, stream: null, timer: null };
    function stopCamera() {
      cam.on = false;
      if (cam.timer) { clearTimeout(cam.timer); cam.timer = null; }
      if (cam.stream) { cam.stream.getTracks().forEach(t => t.stop()); cam.stream = null; }
      video.srcObject = null;
      video.style.display = 'none';
      status.style.display = 'none';
      camBtn.style.display = upBtn.style.display = drop.style.display = '';
    }
    function close() {
      stopCamera();
      document.removeEventListener('keydown', esc, true);
      document.removeEventListener('paste', onPaste, true);
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 180);
    }
    function esc(e) { if (e.key === 'Escape') { e.stopPropagation(); close(); } }

    function finish(parsed) {
      const res = decodeToDeck(parsed);
      if (!res.cards.length) { window.pbToast && window.pbToast(T('qr.notDeck')); return; }
      close();
      onDeck(res);
    }
    function tryImageSource(src) {
      decodeImage(src).then(p => {
        if (p) finish(p);
        else window.pbToast && window.pbToast(T('qr.notDeck'));
      });
    }
    function handleFile(f) {
      if (!f || !/^image\//.test(f.type)) return;
      const img = new Image();
      img.onload = () => { tryImageSource(img); URL.revokeObjectURL(img.src); };
      img.src = URL.createObjectURL(f);
    }
    function onPaste(e) {
      const items = (e.clipboardData && e.clipboardData.files) || [];
      if (items.length) { e.preventDefault(); handleFile(items[0]); }
    }

    camBtn.onclick = () => {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        window.pbToast && window.pbToast(T('qr.cameraError'));
        return;
      }
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false })
        .then(stream => {
          cam.on = true;
          cam.stream = stream;
          video.srcObject = stream;
          video.style.display = '';
          status.style.display = '';
          status.textContent = T('qr.scanning');
          camBtn.style.display = upBtn.style.display = drop.style.display = 'none';
          video.play();
          const tick = () => {
            if (!cam.on) return;
            if (video.readyState >= 2) {
              decodeImage(video, true).then(p => {
                if (p && cam.on) { finish(p); return; }
                cam.timer = setTimeout(tick, 280);
              });
            } else cam.timer = setTimeout(tick, 280);
          };
          tick();
        })
        // http por IP LAN / permiso denegado / sin cámara → mismo aviso
        .catch(() => { window.pbToast && window.pbToast(T('qr.cameraError')); });
    };
    upBtn.onclick = () => file.click();
    file.onchange = () => { handleFile(file.files && file.files[0]); file.value = ''; };
    box.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
    box.addEventListener('dragleave', () => drop.classList.remove('over'));
    box.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; handleFile(f); });
    document.addEventListener('paste', onPaste, true);
    document.addEventListener('keydown', esc, true);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    const actions = document.createElement('div');
    actions.className = 'pb-modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'pb-btn';
    cancel.textContent = T('common.cancel');
    cancel.onclick = close;
    actions.appendChild(cancel);

    box.appendChild(title);
    box.appendChild(video);
    box.appendChild(status);
    box.appendChild(camBtn);
    box.appendChild(upBtn);
    box.appendChild(file);
    box.appendChild(drop);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
  }

  window.pbDeckQR = {
    show, scanImport,
    _payloadFor: payloadFor, _draw: draw,
    _parsePayload: parsePayload, _decodeToDeck: decodeToDeck, _decodeImage: decodeImage,
  };
})();
