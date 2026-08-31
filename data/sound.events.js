/* ══════════════════════════════════════════════════════════════
   SOUND EVENTS  (data/sound.events.js)
   Catálogo de TODOS los momentos de la web que tienen — o podrían
   tener — efecto de sonido. Es la fuente del panel (sound_admin.html).
   Cada entrada:
     { id, cat, label, desc, def, wired }
       · desc  = en qué momento EXACTO ocurre (sobre todo los ambiguos)
       · def   = sonido por defecto (built-in de _SND_DATA) o null
       · wired = true → ya suena en la web · false → momento «potencial»
                 sin enganchar aún (asignarle sonido todavía no hará nada).
   El panel guarda overrides en window.SOUND_MAP (data/sound.map.js); los
   mp3 asignados de la carpeta van a window.SOUND_DATA (data/sound.data.js).
   Tablero: id = nombre de sonido (lo aplica playSound, sin tocar sus ~88
   llamadas). Draft/cartas/mazos: vía sfx('id').
══════════════════════════════════════════════════════════════ */
window.SFX_EVENTS = [
  // ── TABLERO (familias de sonido; cada una cubre un tipo de momento) ──
  { id:'cardGrab',     cat:'Tablero', label:'Mover una carta', wired:true, def:'cardGrab',
    desc:'Cualquier movimiento de carta: jugar al activo/banca, robar, devolver, reordenar la mano.' },
  { id:'energySpawn',  cat:'Tablero', label:'Aparece energía de zona', wired:true, def:'energySpawn',
    desc:'Sale el orbe de energía del turno en la zona de energía.' },
  { id:'energyPlaced', cat:'Tablero', label:'Colocar / mover energía', wired:true, def:'energyPlaced',
    desc:'Sueltas una energía sobre un Pokémon (o la mueves entre Pokémon / al descarte).' },
  { id:'board.energyPickup', cat:'Tablero', label:'Coger energía', wired:true, def:null,
    desc:'Al tocar / empezar a arrastrar una energía de la zona para equiparla (tap o drag).' },
  { id:'evolve',       cat:'Tablero', label:'Evolucionar Pokémon', wired:true, def:'evolve',
    desc:'Al soltar una evolución sobre su Pokémon base.' },
  { id:'deckShuffle',  cat:'Tablero', label:'Barajar / crear mazo', wired:true, def:'deckShuffle',
    desc:'Barajar el mazo, crear/cargar uno, y devolver un Pokémon al mazo.' },
  { id:'draw5',        cat:'Tablero', label:'Robo múltiple (mano)', wired:true, def:null,
    desc:'Robar varias cartas a la vez (mano inicial de 5). Ahora SIN sonido — asígnale un mp3.' },
  { id:'cardsBack',    cat:'Tablero', label:'Resetear el tablero', wired:true, def:'cardsBack',
    desc:'Vaciar/resetear: todas las cartas vuelven al mazo.' },
  { id:'scorePoint',   cat:'Tablero', label:'Marcar punto / KO', wired:true, def:'scorePoint',
    desc:'Se suma un punto (incluye el KO que lo concede).' },
  { id:'coinFlip',     cat:'Tablero', label:'Tirar moneda', wired:true, def:'coinFlip',
    desc:'Lanzar la moneda (cara/cruz) durante la partida.' },
  { id:'turnDecision', cat:'Tablero', label:'Decidir quién empieza', wired:true, def:'turnDecision',
    desc:'La moneda inicial que decide el primer turno.' },
  { id:'trainerReveal',cat:'Tablero', label:'Revelar entrenador / impacto', wired:true, def:'trainerReveal',
    desc:'Flash al revelar una carta de entrenador / impacto de ataque.' },
  { id:'notification', cat:'Tablero', label:'Aviso / abrir descartes', wired:true, def:'notification',
    desc:'Toasts informativos y abrir el panel de descartes.' },
  { id:'goBack',       cat:'Tablero', label:'Cancelar / inválido', wired:true, def:'goBack',
    desc:'Cancelar una acción, quitar algo, o soltar una carta donde no va.' },
  { id:'board.equipTool', cat:'Tablero', label:'Equipar herramienta', wired:true, def:'cardGrab',
    desc:'Soltar una herramienta sobre un Pokémon (queda equipada).' },
  { id:'board.retreat',   cat:'Tablero', label:'Retirada', wired:true, def:null,
    desc:'Botón «Retirada»: descarta las energías del activo. Ahora SIN sonido — asígnale uno.' },
  { id:'board.endTurn',   cat:'Tablero', label:'Botón de turno (iniciar / pasar)', wired:true, def:null,
    desc:'Pulsar el botón grande de turno: empezar la partida o pasar el turno. Ahora SIN sonido.' },
  { id:'board.turnChange', cat:'Tablero', label:'Cambio de turno (barrido)', wired:true, def:null,
    desc:'El turno cambia de lado: barrido hexagonal sobre el tapete. Suena en LOS DOS clientes de una partida online.' },

  // ── MECÁNICAS aspiracionales (aún NO programadas; suenan cuando se implementen) ──
  { id:'board.destroyTool', cat:'Mecánicas', label:'Destruir / quitar herramienta', wired:false, def:null,
    desc:'Retirar o destruir una herramienta equipada (aún no programado).' },
  { id:'board.attack',      cat:'Mecánicas', label:'Atacar', wired:false, def:null,
    desc:'Lanzar un ataque de un Pokémon (aún no programado como mecánica).' },
  { id:'board.ability',     cat:'Mecánicas', label:'Usar habilidad', wired:true, def:null,
    desc:'Activar la habilidad de un Pokémon (aún no programado).' },
  { id:'board.promote',     cat:'Mecánicas', label:'Promover de la banca', wired:false, def:null,
    desc:'Subir un Pokémon de la banca al activo tras un KO (aún no programado).' },
  { id:'board.damage',      cat:'Mecánicas', label:'Poner daño', wired:false, def:null,
    desc:'Colocar/cambiar contadores de daño en un Pokémon (aún no programado).' },
  { id:'board.heal',        cat:'Mecánicas', label:'Curar daño', wired:true, def:null,
    desc:'Quitar daño / curar un Pokémon.' },
  { id:'board.ko',          cat:'Mecánicas', label:'Noqueado (KO)', wired:true, def:null,
    desc:'Un Pokémon es noqueado.' },
  { id:'board.buff',        cat:'Mecánicas', label:'Subida de stat (buffo)', wired:true, def:null,
    desc:'Se aplica un buffo a un Pokémon (halo verde).' },
  { id:'board.debuff',      cat:'Mecánicas', label:'Bajada de stat (debuffo)', wired:true, def:null,
    desc:'Se aplica un debuffo a un Pokémon (halo rojo). Sonido aproximado — cámbialo si quieres.' },
  { id:'board.atkNoDmg',    cat:'Mecánicas', label:'Ataque sin daño', wired:true, def:null,
    desc:'Ataque que no hace daño (solo efecto). Los ataques con daño suenan por TIPO (board.atk<Tipo>[Ex], retuneables aquí abajo).' },
  { id:'board.statusPoison',cat:'Mecánicas', label:'Aplicar veneno', wired:false, def:null,
    desc:'Marcar envenenado (aún no programado).' },
  { id:'board.statusSleep', cat:'Mecánicas', label:'Aplicar sueño', wired:false, def:null,
    desc:'Marcar dormido (aún no programado).' },
  { id:'board.statusParaly',cat:'Mecánicas', label:'Aplicar parálisis', wired:false, def:null,
    desc:'Marcar paralizado (aún no programado).' },
  { id:'board.statusConf',  cat:'Mecánicas', label:'Aplicar confusión', wired:false, def:null,
    desc:'Marcar confundido (aún no programado).' },
  { id:'board.statusBurn',  cat:'Mecánicas', label:'Aplicar quemadura', wired:false, def:null,
    desc:'Marcar quemado (aún no programado).' },
  { id:'board.victory',     cat:'Mecánicas', label:'Victoria (3 puntos)', wired:false, def:null,
    desc:'Ganar la partida al llegar a 3 puntos (aún no programado como evento propio).' },
  { id:'board.defeat',      cat:'Mecánicas', label:'Derrota', wired:false, def:null,
    desc:'Perder la partida (aún no programado).' },

  // ── GLOBAL / UI ──
  { id:'tab',          cat:'Global', label:'Cambiar de pestaña', wired:true, def:'tab',
    desc:'Pulsar una pestaña del nav superior (también abrir el buscador lateral).' },
  { id:'ui.modalOpen', cat:'Global', label:'Abrir popup / ajustes', wired:false, def:null,
    desc:'Abrir el menú de ajustes, escenarios u otros popups.' },
  { id:'ui.modalClose',cat:'Global', label:'Cerrar popup', wired:false, def:null,
    desc:'Cerrar un popup/overlay.' },
  { id:'ui.toggle',    cat:'Global', label:'Interruptor / chip', wired:false, def:null,
    desc:'Activar un toggle o chip de filtro.' },
  { id:'ui.hoverCard', cat:'Global', label:'Hover sobre una carta', wired:false, def:null,
    desc:'Pasar el ratón por encima de una carta (sutil).' },

  // ── DRAFT (todos cableados vía sfx) ──
  { id:'draft.selectPack', cat:'Draft', label:'Seleccionar el sobre (viaje online)', wired:true, def:null,
    desc:'El sobre viaja del hub al fondo al pulsar «Jugar online» (matchmaking de draft).' },
  { id:'draft.openPack', cat:'Draft', label:'Abrir el sobre', wired:true, def:'packOpen',
    desc:'Clic en el sobre: empieza el corte y la apertura.' },
  { id:'draft.cardsOut', cat:'Draft', label:'Cartas salen del sobre', wired:true, def:'packShine',
    desc:'Las 5 cartas emergen del sobre y se despliegan.' },
  { id:'draft.lucky',    cat:'Draft', label:'Brillo de oferta dorada', wired:true, def:'packShine',
    desc:'Cuando una ronda trae una oferta «doble» (suerte).' },
  { id:'draft.round',    cat:'Draft', label:'Nueva ronda', wired:true, def:'nextCard',
    desc:'Cambio de ronda (el flash «Ronda N»).' },
  { id:'draft.pick',     cat:'Draft', label:'Elegir carta', wired:true, def:'cardGrab',
    desc:'Pickear una opción normal.' },
  { id:'draft.pickRare', cat:'Draft', label:'Elegir línea doble', wired:true, def:'pullRare',
    desc:'Pickear una oferta doble/de suerte.' },
  { id:'draft.pickEx',   cat:'Draft', label:'Elegir carta ex', wired:true, def:'placeRare',
    desc:'Pickear una opción cuyo Pokémon es ex.' },
  { id:'draft.land',     cat:'Draft', label:'Carta aterriza en el mazo', wired:true, def:null,
    desc:'La carta elegida cae en su hueco de la barra. Ahora SIN sonido — asígnale uno.' },
  { id:'draft.hover',    cat:'Draft', label:'Hover sobre una opción', wired:true, def:null,
    desc:'Pasar el ratón por una de las 5 opciones. Ahora SIN sonido — asígnale uno.' },
  { id:'draft.deckFull', cat:'Draft', label:'Se completa el mazo (20)', wired:true, def:'collect',
    desc:'Al pickear la carta 20 (mazo lleno).' },
  { id:'draft.complete', cat:'Draft', label:'Pantalla final / celebración', wired:true, def:'totalCards',
    desc:'Aparece el mazo completo con la celebración.' },
  { id:'draft.save',     cat:'Draft', label:'Guardar mazo drafteado', wired:true, def:'claim',
    desc:'Confirmar guardar el mazo del draft en la biblioteca.' },
  { id:'draft.abandon',  cat:'Draft', label:'Abandonar el draft', wired:true, def:'goBack',
    desc:'Confirmar abandonar el draft en curso.' },
  { id:'draft.rerollPress',   cat:'Draft', label:'Reroll — pulsar el botón', wired:true, def:null,
    desc:'Al hundir el botón de mezclar: «thump» mecánico grave. Ahora SIN sonido — asígnale un mp3.' },
  { id:'draft.rerollGo',      cat:'Draft', label:'Reroll — soltar (rebarajar)', wired:true, def:null,
    desc:'Al soltar y aparecer las 5 cartas nuevas: metálico nítido + swoosh. Ahora SIN sonido.' },
  { id:'draft.rerollBlocked', cat:'Draft', label:'Reroll — sin usos (bloqueado)', wired:true, def:null,
    desc:'Al pulsar sin rerolls: «atascado» + tono de error grave. Ahora SIN sonido.' },
  { id:'draft.timerTick', cat:'Draft', label:'Timer — cuenta atrás (últimos 3s)', wired:true, def:'tab',
    desc:'Multijugador: «tic» por segundo en los últimos 3 segundos del reloj de oleada (estrés). Asígnale un tic seco si quieres.' },

  // ── CARTAS (pestaña buscador) ──
  { id:'cards.addDeck',    cat:'Cartas', label:'Añadir carta al mazo', wired:true, def:null,
    desc:'Sumar una copia al mazo desde el buscador. Ahora SIN sonido — asígnale uno.' },
  { id:'cards.removeDeck', cat:'Cartas', label:'Quitar carta del mazo', wired:true, def:null,
    desc:'Clic derecho en la píldora del mazo para quitar una copia. Ahora SIN sonido.' },
  { id:'cards.search',     cat:'Cartas', label:'Buscar / filtrar', wired:false, def:null,
    desc:'Escribir en el buscador o aplicar un filtro avanzado.' },
  { id:'cards.viewToggle', cat:'Cartas', label:'Cambiar grid / tabla', wired:false, def:null,
    desc:'Alternar entre vista de cuadrícula y tabla.' },
  { id:'cards.sendBoard',  cat:'Cartas', label:'Enviar resultados al tablero', wired:false, def:null,
    desc:'Mandar la búsqueda actual al tablero.' },

  // ── MAZOS (biblioteca) ──
  { id:'mazos.open',   cat:'Mazos', label:'Abrir un mazo', wired:true, def:null,
    desc:'Abrir el detalle de un mazo de la biblioteca. Ahora SIN sonido — asígnale uno.' },
  { id:'mazos.play',   cat:'Mazos', label:'Probar mazo', wired:true, def:null,
    desc:'Botón «Probar» del detalle (lo carga en el tablero). Ahora SIN sonido.' },
  { id:'mazos.edit',   cat:'Mazos', label:'Editar mazo', wired:true, def:null,
    desc:'Botón «Editar» del detalle. Ahora SIN sonido.' },
  { id:'mazos.export', cat:'Mazos', label:'Exportar imagen', wired:true, def:null,
    desc:'Botón «Exportar» (genera la imagen 1920×1080). Ahora SIN sonido.' },
  { id:'mazos.delete', cat:'Mazos', label:'Borrar mazo', wired:true, def:null,
    desc:'Botón «Eliminar» del detalle. Ahora SIN sonido.' },
  { id:'mazos.share',  cat:'Mazos', label:'Compartir mazo', wired:false, def:null,
    desc:'Copiar link / texto del mazo para compartir.' },
];

// Sonidos built-in disponibles (de _SND_DATA en main.js) — para el desplegable.
window.SFX_BUILTIN = [
  'cardGrab', 'energySpawn', 'energyPlaced', 'evolve', 'deckShuffle', 'cardsBack',
  'scorePoint', 'notification', 'tab', 'goBack', 'coinFlip', 'turnDecision',
  'trainerReveal', 'packOpen', 'nextCard', 'pullRare', 'collect', 'placeRare',
  'claim', 'packShine', 'totalCards',
];

window._sfxIndex = {};
window.SFX_EVENTS.forEach(function (e) { window._sfxIndex[e.id] = e; });
