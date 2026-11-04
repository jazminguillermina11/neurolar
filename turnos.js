/* =========================================================
   TURNOS NEUROLAR
   Consulta de turnos por DNI (pública) y administración
   con contraseña (solo personal autorizado).
   ========================================================= */

/* 1) PEGÁ ACÁ LOS DATOS QUE TE DA FIREBASE */
const firebaseConfig = {
  apiKey: "AIzaSyCyN3tvQawG9UsOlWcxIa1PLIRDvUJDwVU",
  authDomain: "neurolar-2f1ce.firebaseapp.com",
  projectId:  "neurolar-2f1ce",
  appId: "1:427284342168:web:473d6375ef41a6e6d5f7ed"
};

/* 2) Áreas que aparecen en la lista desplegable del panel */
const AREAS = [
  'Fonoaudiología',
  'Kinesiología',
  'Fisiatría',
  'Terapia Ocupacional',
  'Psicología',
  'Psicopedagogía'
];

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  /* ---------- Utilidades ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const pad = (n) => String(n).padStart(2, '0');

  function dateAISO(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isoADate(iso) {
    const p = String(iso).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  function hoyISO() {
    return dateAISO(new Date());
  }

  // ¿Es una fecha completa y razonable (AAAA-MM-DD, año 2000 a 2100)?
  function fechaValida(v) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
    const y = Number(String(v).slice(0, 4));
    return y >= 2000 && y <= 2100;
  }

  const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

  function fechaLarga(iso) {
    return mayuscula(isoADate(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' }));
  }

  function fechaConAnio(iso) {
    return mayuscula(isoADate(iso).toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
  }

  // Para proteger la privacidad, el paciente ve solo "Nombre I."
  function nombreCorto(n) {
    const p = String(n || '').trim().split(/\s+/);
    if (p.length < 2) return p[0] || '';
    return p[0] + ' ' + p[p.length - 1].charAt(0).toUpperCase() + '.';
  }

  function sinTildes(s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function setMsg(el, texto, tipo) {
    el.textContent = texto || '';
    el.className = 'form-msg' + (tipo ? ' ' + tipo : '');
  }
  const loginMsg = (t, tipo) => setMsg($('loginMsg'), t, tipo);
  const panelMsg = (t, tipo) => setMsg($('panelMsg'), t, tipo);

  /* ---------- Conexión con Firebase ---------- */
  const configurado = !Object.keys(firebaseConfig).some((k) => String(firebaseConfig[k]).indexOf('PEGAR') !== -1);
  let db = null;
  let auth = null;

  if (configurado && typeof firebase !== 'undefined') {
    try {
      firebase.initializeApp(firebaseConfig);
      db = firebase.firestore();
      auth = firebase.auth();
    } catch (e) {
      console.error('Error al iniciar Firebase:', e);
    }
  }
  const listo = !!(db && auth);

  /* =========================================================
     PARTE PÚBLICA: buscar turno por DNI
     ========================================================= */
  const formDni = $('formDni');
  const dniInput = $('dniInput');
  const resultado = $('resultado');

  function aviso(texto, tipo) {
    resultado.innerHTML = '<div class="aviso ' + (tipo || '') + '">' + esc(texto) + '</div>';
  }

  function cardTurno(t) {
    return '<div class="turno-card">' +
      '<div class="turno-hora">' + esc(t.horario) + '<small>' + esc(t.turno) + '</small></div>' +
      '<div class="turno-info">' +
        '<h4>' + esc(t.area) + '</h4>' +
        '<p><strong>Profesional:</strong> ' + esc(t.medico) + '</p>' +
        '<p><strong>Fecha:</strong> ' + esc(fechaLarga(t.fecha)) + '</p>' +
        '<p><strong>Paciente:</strong> ' + esc(nombreCorto(t.paciente)) + '</p>' +
      '</div></div>';
  }

  dniInput.addEventListener('input', () => {
    dniInput.value = dniInput.value.replace(/\D/g, '');
  });

  formDni.addEventListener('submit', async (e) => {
    e.preventDefault();
    const dni = dniInput.value.replace(/\D/g, '');

    if (dni.length < 7 || dni.length > 8) {
      aviso('Ingresá un DNI válido (7 u 8 números, sin puntos).', 'error');
      return;
    }
    if (!listo) {
      aviso('El sistema de turnos todavía no está disponible. Comunicate con nosotros por teléfono o WhatsApp.', 'error');
      return;
    }

    aviso('Buscando tus turnos...');
    try {
      const snap = await db.collection('pacientes').doc(dni).collection('turnos').get();
      const hoy = hoyISO();
      const turnos = snap.docs
        .map((d) => d.data())
        .filter((t) => t.fecha >= hoy)
        .sort((a, b) => (a.fecha + a.horario).localeCompare(b.fecha + b.horario));

      if (!turnos.length) {
        aviso('No encontramos turnos próximos para ese DNI. Si creés que es un error, comunicate con nosotros.');
        return;
      }
      resultado.innerHTML = turnos.map(cardTurno).join('');
    } catch (err) {
      console.error(err);
      aviso('No pudimos consultar los turnos en este momento. Intentá de nuevo más tarde.', 'error');
    }
  });

  /* =========================================================
     PARTE PRIVADA: administración (con contraseña)
     ========================================================= */
  const modal = $('adminModal');
  const vistaLogin = $('vistaLogin');
  const vistaPanel = $('vistaPanel');
  const tbody = $('tbodyTurnos');
  const inputBuscar = $('buscarFecha');
  const selFiltro = $('filtroProf');

  let todos = [];          // todos los turnos guardados
  let filas = [];          // filas que se están editando (fecha + turno actual)
  let turnoActual = 'Mañana';
  let fechaActual = hoyISO();
  let filtroProf = '';     // profesional elegido en el filtro ('' = todos)
  let guardando = 0;       // guardados en curso
  let contadorFilas = 0;   // para darle un identificador propio a cada fila

  // Estado de una fila: 'vacia' (nueva y sin datos), 'incompleta' o 'ok'
  function estadoFila(f) {
    const sinDatos = !f.horario && !f.area && !String(f.medico || '').trim() && !String(f.paciente || '').trim() && !f.dni;
    if (sinDatos && !f.id) return 'vacia';
    const dniOk = String(f.dni || '').length >= 7 && String(f.dni || '').length <= 8;
    if (!fechaValida(f.fecha) || !f.horario || !f.area || !String(f.medico || '').trim() || !String(f.paciente || '').trim() || !dniOk) return 'incompleta';
    return 'ok';
  }

  // ¿Hay algo que todavía no se guardó (guardando o filas a medio completar)?
  function haySinGuardar() {
    return guardando > 0 || filas.some((f) => estadoFila(f) === 'incompleta');
  }

  function confirmarDescartar() {
    return !haySinGuardar() || confirm('Hay filas incompletas o guardándose que todavía no se guardaron. ¿Querés salir igual?');
  }

  /* ----- Abrir / cerrar ventana ----- */
  function abrirModal() {
    modal.hidden = false;
    document.body.style.overflow = 'hidden';
    if (!listo) {
      loginMsg('El sistema todavía no está configurado (falta pegar los datos de Firebase en turnos.js).', 'error');
      return;
    }
    if (auth.currentUser) cargarPanel();
  }

  function cerrarModal() {
    if (!confirmarDescartar()) return;
    modal.hidden = true;
    document.body.style.overflow = '';
  }

  $('btnAdmin').addEventListener('click', abrirModal);
  $('adminCerrar').addEventListener('click', cerrarModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) cerrarModal(); });

  /* ----- Ingreso con correo y contraseña ----- */
  $('formLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!listo) { loginMsg('El sistema todavía no está configurado.', 'error'); return; }
    loginMsg('Ingresando...');
    try {
      await auth.signInWithEmailAndPassword($('loginEmail').value.trim(), $('loginPass').value);
      $('loginPass').value = '';
      loginMsg('');
    } catch (err) {
      console.error(err);
      if (err.code === 'auth/operation-not-supported-in-this-environment') {
        loginMsg('Abrí la página con Live Server o desde internet. No funciona con doble clic en el archivo.', 'error');
      } else if (err.code === 'auth/too-many-requests') {
        loginMsg('Demasiados intentos. Esperá unos minutos y probá de nuevo.', 'error');
      } else {
        loginMsg('Correo o contraseña incorrectos.', 'error');
      }
    }
  });

  $('btnSalir').addEventListener('click', () => {
    if (confirmarDescartar()) auth.signOut();
  });

  if (listo) {
    auth.onAuthStateChanged((user) => {
      vistaLogin.hidden = !!user;
      vistaPanel.hidden = !user;
      if (user && !modal.hidden) cargarPanel();
    });
  }

  /* ----- Cargar datos ----- */
  async function cargarTodos() {
    const snap = await db.collectionGroup('turnos').get();
    todos = snap.docs.map((d) => Object.assign(
      { id: d.id, dniOriginal: d.ref.parent.parent.id },
      d.data()
    ));

    refrescarMedicos();
  }

  // Sugerencias de médicos ya cargados
  function refrescarMedicos() {
    const medicos = Array.from(new Set(todos.map((t) => t.medico).filter(Boolean))).sort();
    $('listaMedicos').innerHTML = medicos.map((m) => '<option value="' + esc(m) + '">').join('');
  }

  async function cargarPanel() {
    panelMsg('Cargando turnos...');
    try {
      await cargarTodos();
      armarFilas();
      panelMsg('');
    } catch (err) {
      console.error(err);
      if (err.code === 'permission-denied') {
        await auth.signOut();
        loginMsg('Esa cuenta no tiene permisos de administración.', 'error');
      } else {
        panelMsg('No se pudieron cargar los turnos. Revisá tu conexión.', 'error');
      }
    }
  }

  function armarFilas() {
    filas = todos
      .filter((t) => t.fecha === fechaActual && t.turno === turnoActual)
      .sort((a, b) => (a.horario || '').localeCompare(b.horario || ''))
      .map((t) => Object.assign({ _k: ++contadorFilas }, t));
    actualizarFecha();
    actualizarFiltro();
    renderTabla();
  }

  /* =========================================================
     FECHA: flechas y buscador
     ========================================================= */
  function etiquetaRelativa(iso) {
    const hoy = isoADate(hoyISO());
    const dif = Math.round((isoADate(iso) - hoy) / 86400000);
    if (dif === 0) return 'Hoy';
    if (dif === 1) return 'Mañana';
    if (dif === -1) return 'Ayer';
    return '';
  }

  function actualizarFecha() {
    const d = isoADate(fechaActual);
    inputBuscar.value = fechaActual;
    $('fechaDia').textContent = mayuscula(d.toLocaleDateString('es-AR', { weekday: 'long' }));
    $('fechaNum').textContent = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
    const rel = etiquetaRelativa(fechaActual);
    $('fechaAnio').textContent = d.getFullYear() + (rel ? ' · ' + rel : '');
  }

  function cambiarFecha(iso) {
    if (!iso || iso === fechaActual) { actualizarFecha(); return; }
    if (!confirmarDescartar()) { actualizarFecha(); return; }
    fechaActual = iso;
    filtroProf = '';
    armarFilas();
    panelMsg('');
  }

  // Mueve de a un día hábil (salta sábados y domingos)
  function moverDia(delta) {
    const d = isoADate(fechaActual);
    do {
      d.setDate(d.getDate() + delta);
    } while (d.getDay() === 0 || d.getDay() === 6);
    cambiarFecha(dateAISO(d));
  }

  $('fechaPrev').addEventListener('click', () => moverDia(-1));
  $('fechaNext').addEventListener('click', () => moverDia(1));

  // Buscador: los turnos de esa fecha se muestran solo al tocar "Ver turnos"
  $('formBuscarFecha').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!fechaValida(inputBuscar.value)) {
      panelMsg('Elegí una fecha válida para buscar.', 'error');
      return;
    }
    cambiarFecha(inputBuscar.value);
  });

  /* ----- Filtro por profesional ----- */
  // Profesionales con turnos guardados en la fecha y el turno elegidos
  function profesionalesDelDia() {
    return Array.from(new Set(
      todos
        .filter((t) => t.fecha === fechaActual && t.turno === turnoActual)
        .map((t) => String(t.medico || '').trim())
        .filter(Boolean)
    )).sort((a, b) => a.localeCompare(b, 'es'));
  }

  function actualizarFiltro() {
    const lista = profesionalesDelDia();
    if (filtroProf && lista.indexOf(filtroProf) === -1) lista.push(filtroProf);
    selFiltro.innerHTML = '<option value="">Todos los profesionales</option>' + lista.map((m) =>
      '<option value="' + esc(m) + '"' + (m === filtroProf ? ' selected' : '') + '>' + esc(m) + '</option>'
    ).join('');

    const n = todos.filter((t) => t.fecha === fechaActual && t.turno === turnoActual).length;
    $('turnoActualTxt').textContent = 'Turno ' + turnoActual.toLowerCase() + ' · ' + n + (n === 1 ? ' turno' : ' turnos');
  }

  selFiltro.addEventListener('change', () => {
    filtroProf = selFiltro.value;
    renderTabla();
  });

  /* ----- Tabla tipo Excel ----- */
  function opcionesArea(sel) {
    return '<option value="">Elegir área…</option>' + AREAS.map((a) =>
      '<option value="' + esc(a) + '"' + (a === sel ? ' selected' : '') + '>' + esc(a) + '</option>'
    ).join('');
  }

  function renderTabla() {
    // Solo se muestran las filas del profesional elegido (o todas)
    const visibles = filas.filter((f) => !filtroProf || String(f.medico || '').trim() === filtroProf);

    if (!visibles.length) {
      const txt = filtroProf
        ? 'Este profesional no tiene turnos en este día y turno. Usá “+ Agregar fila”.'
        : 'No hay turnos cargados para este día y turno. Probá con el otro turno o usá “+ Agregar fila”.';
      tbody.innerHTML = '<tr><td colspan="7" class="tabla-vacia">' + txt + '</td></tr>';
      return;
    }

    tbody.innerHTML = visibles.map((f) => {
      return '<tr data-k="' + f._k + '">' +
        '<td><input type="date" data-campo="fecha" value="' + esc(f.fecha) + '"></td>' +
        '<td><input type="time" data-campo="horario" value="' + esc(f.horario) + '"></td>' +
        '<td><select data-campo="area">' + opcionesArea(f.area) + '</select></td>' +
        '<td><input type="text" data-campo="medico" list="listaMedicos" value="' + esc(f.medico) + '" placeholder="Profesional"></td>' +
        '<td><input type="text" data-campo="paciente" value="' + esc(f.paciente) + '" placeholder="Apellido y nombre"></td>' +
        '<td><input type="text" data-campo="dni" inputmode="numeric" maxlength="8" value="' + esc(f.dni) + '" placeholder="DNI"></td>' +
        '<td class="col-del"><button type="button" class="btn-del" data-del="' + f._k + '" title="Eliminar fila">🗑️</button></td>' +
      '</tr>';
    }).join('');
  }

  function agregarFila(focoCampo) {
    // La fila nueva viene con la fecha que se está viendo y, si hay filtro, con ese profesional
    filas.push({ _k: ++contadorFilas, id: null, dniOriginal: null, fecha: fechaActual, horario: '', area: '', medico: filtroProf, paciente: '', dni: '' });
    renderTabla();
    const ultima = tbody.lastElementChild;
    const campo = ultima && ultima.querySelector('[data-campo="' + (focoCampo || 'horario') + '"]');
    if (campo) campo.focus();
  }

  const filaDe = (el) => {
    const tr = el.closest('tr');
    const k = tr ? Number(tr.dataset.k) : NaN;
    return filas.find((f) => f._k === k);
  };

  tbody.addEventListener('input', (e) => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    const f = filaDe(e.target);
    if (!f) return;
    let v = e.target.value;
    if (campo === 'dni') {
      v = v.replace(/\D/g, '');
      e.target.value = v;
    }
    f[campo] = v;
  });

  /* ----- Guardado automático ----- */
  // Se guarda cada fila apenas se termina de editar un campo (al salir del campo
  // o al elegir una opción) y la fila está completa.
  tbody.addEventListener('change', (e) => {
    if (!e.target.dataset.campo) return;
    const f = filaDe(e.target);
    if (f) guardarFila(f);
  });

  function guardarFila(f) {
    const est = estadoFila(f);
    if (est === 'vacia') return;
    if (est === 'incompleta') {
      panelMsg('Completá fecha, horario, área, profesional, paciente y DNI: la fila se guarda sola cuando está completa.');
      return;
    }
    // Referencia fija desde el primer guardado (así un segundo cambio actualiza el mismo turno)
    const turnosDe = (dni) => db.collection('pacientes').doc(dni).collection('turnos');
    if (!f.id) f.id = turnosDe(f.dni).doc().id;

    guardando++;
    panelMsg('Guardando...');
    // Cola por fila: los cambios de una misma fila se guardan en orden
    f._cola = (f._cola || Promise.resolve()).then(async () => {
      if (estadoFila(f) !== 'ok') return;
      const datos = {
        fecha: f.fecha,
        turno: turnoActual,
        horario: f.horario,
        area: f.area,
        medico: f.medico.trim(),
        paciente: f.paciente.trim(),
        dni: f.dni
      };
      const batch = db.batch();
      batch.set(turnosDe(datos.dni).doc(f.id), datos);
      // Si cambió el DNI de un turno ya guardado, se borra el registro viejo
      if (f.dniOriginal && f.dniOriginal !== datos.dni) {
        batch.delete(turnosDe(f.dniOriginal).doc(f.id));
      }
      await batch.commit();
      f.dniOriginal = datos.dni;

      todos = todos.filter((t) => t.id !== f.id);
      todos.push(Object.assign({ id: f.id, dniOriginal: datos.dni }, datos));
      refrescarMedicos();
      actualizarFiltro();

      // Si se cambió la fecha, el turno ya no pertenece a este día: sale de la tabla
      if (datos.fecha !== fechaActual) {
        quitarFila(f);
        panelMsg('Guardado ✔ · el turno pasó al ' + fechaLarga(datos.fecha) + ' (buscalo con el buscador de fecha).', 'ok');
      } else {
        panelMsg('Guardado ✔', 'ok');
      }
    }).catch((err) => {
      console.error(err);
      panelMsg('No se pudo guardar. Revisá tu conexión y volvé a tocar el campo.', 'error');
    }).finally(() => {
      guardando--;
    });
  }

  // Saca una fila de la tabla sin redibujar todo (para no perder el foco)
  function quitarFila(f) {
    filas = filas.filter((x) => x !== f);
    const tr = tbody.querySelector('tr[data-k="' + f._k + '"]');
    if (tr) tr.remove();
    if (!tbody.querySelector('tr[data-k]')) renderTabla();
  }

  /* ----- Eliminar (también automático) ----- */
  tbody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const f = filas.find((x) => x._k === Number(btn.dataset.del));
    if (!f) return;

    // Fila nueva sin guardar: se descarta directamente
    if (!f.id) { quitarFila(f); return; }

    if (!confirm('¿Eliminar este turno? Se borra de inmediato.')) return;
    guardando++;
    panelMsg('Eliminando...');
    f._cola = (f._cola || Promise.resolve()).then(async () => {
      const dni = f.dniOriginal || f.dni;
      await db.collection('pacientes').doc(dni).collection('turnos').doc(f.id).delete();
      todos = todos.filter((t) => t.id !== f.id);
      refrescarMedicos();
      actualizarFiltro();
      quitarFila(f);
      panelMsg('Turno eliminado ✔', 'ok');
    }).catch((err) => {
      console.error(err);
      panelMsg('No se pudo eliminar. Revisá tu conexión e intentá de nuevo.', 'error');
    }).finally(() => {
      guardando--;
    });
  });

  // Enter = bajar a la fila de abajo (en la última, crea una nueva)
  tbody.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.dataset.campo) return;
    e.preventDefault();
    const campo = e.target.dataset.campo;
    const siguiente = e.target.closest('tr').nextElementSibling;
    if (!siguiente) { agregarFila(campo); return; }
    const destino = siguiente.querySelector('[data-campo="' + campo + '"]');
    if (destino) destino.focus();
  });

  $('btnAgregar').addEventListener('click', () => agregarFila('horario'));

  /* ----- Cambiar de turno (mañana / tarde) ----- */
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.turno === turnoActual) return;
      if (!confirmarDescartar()) return;
      document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      turnoActual = btn.dataset.turno;
      filtroProf = '';
      armarFilas();
      panelMsg('');
    });
  });

  /* =========================================================
     AGENDA POR PROFESIONAL: imprimir / guardar como PDF
     ========================================================= */

  // Devuelve los turnos guardados del profesional elegido (o null si falta algo)
  function datosAgenda() {
    if (haySinGuardar()) {
      panelMsg('Esperá a que termine de guardarse (o completá las filas incompletas) antes de imprimir.', 'error');
      return null;
    }
    if (!filtroProf) {
      panelMsg('Elegí un profesional en el filtro: la agenda se imprime de a uno.', 'error');
      return null;
    }
    const lista = todos
      .filter((t) => t.fecha === fechaActual && t.turno === turnoActual && String(t.medico || '').trim() === filtroProf)
      .sort((a, b) => (a.horario || '').localeCompare(b.horario || ''));
    if (!lista.length) {
      panelMsg('Ese profesional no tiene turnos guardados en esta fecha y turno.', 'error');
      return null;
    }
    panelMsg('');
    return lista;
  }

  // Nombre sugerido para el PDF: Agenda_Apellido_2026-10-29_Manana
  function nombreArchivo() {
    const prof = sinTildes(filtroProf).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return 'Agenda_' + prof + '_' + fechaActual + '_' + sinTildes(turnoActual);
  }

  $('btnImprimir').addEventListener('click', () => {
    const lista = datosAgenda();
    if (!lista) return;

    const filasHtml = lista.map((t) =>
      '<tr><td>' + esc(t.horario) + '</td><td>' + esc(t.area) + '</td><td>' + esc(t.paciente) + '</td><td>' + esc(t.dni) + '</td></tr>'
    ).join('');

    $('printArea').innerHTML =
      '<div class="print-head">' +
        '<img src="img/logo.png" alt="Neurolar" class="print-logo">' +
        '<div class="print-title"><h1>Agenda de turnos</h1><p>Centro de Rehabilitación Neurológica</p></div>' +
      '</div>' +
      '<div class="print-meta">' +
        '<p><strong>Profesional:</strong> ' + esc(filtroProf) + '</p>' +
        '<p><strong>Fecha:</strong> ' + esc(fechaConAnio(fechaActual)) + '</p>' +
        '<p><strong>Turno:</strong> ' + esc(turnoActual) + '</p>' +
      '</div>' +
      '<table class="print-table">' +
        '<thead><tr><th>Horario</th><th>Área</th><th>Paciente</th><th>DNI</th></tr></thead>' +
        '<tbody>' + filasHtml + '</tbody>' +
      '</table>' +
      '<div class="print-foot">' +
        '<span>Total de turnos: ' + lista.length + '</span>' +
        '<span>Impreso el ' + esc(new Date().toLocaleString('es-AR')) + '</span>' +
      '</div>';

    // El título de la página se usa como nombre sugerido del PDF
    const tituloOriginal = document.title;
    document.title = nombreArchivo();
    window.addEventListener('afterprint', function restaurar() {
      document.title = tituloOriginal;
      window.removeEventListener('afterprint', restaurar);
    });
    window.print();
  });
})();