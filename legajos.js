/* =========================================================
   LEGAJOS NEUROLAR (solo administración)
   - Legajos de Profesionales y de Pacientes
   - Lista ordenada de la A a la Z
   - Buscador por Nombre y Apellido o por DNI
   - Ver, editar, crear, eliminar e imprimir legajos

   Usa la misma conexión de Firebase que turnos.js
   (por eso este archivo se carga DESPUÉS de turnos.js).
   ========================================================= */
(function () {
  'use strict';

  // Si Firebase no está configurado, no hacemos nada.
  if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) return;

  const db = firebase.firestore();
  const auth = firebase.auth();
  const $ = (id) => document.getElementById(id);

  /* ---------- Configuración ---------- */
  const COLECCION = {
    profesionales: 'legajos_profesionales',
    pacientes: 'legajos_pacientes'
  };

  const ESTADOS = {
    profesionales: ['Activo', 'Licencia', 'Inactivo'],
    pacientes: ['En tratamiento', 'En pausa', 'Alta']
  };

  const NOMBRE_TIPO = {
    profesionales: { singular: 'profesional', plural: 'profesionales', titulo: 'Legajo de profesional' },
    pacientes: { singular: 'paciente', plural: 'pacientes', titulo: 'Legajo de paciente' }
  };

  // Las áreas se toman de turnos.js; si no estuvieran, se usa esta lista.
  const AREAS_LEG = (typeof AREAS !== 'undefined' && AREAS.length) ? AREAS : [
    'Fonoaudiología', 'Kinesiología', 'Fisiatría', 'Terapia Ocupacional', 'Psicología', 'Psicopedagogía'
  ];

  /* ---------- Utilidades ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const sinTildes = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const normal = (s) => sinTildes(s).toLowerCase().trim();
  const val = (v) => String(v == null ? '' : v).trim();

  function setMsg(texto, tipo) {
    const el = $('legMsg');
    el.textContent = texto || '';
    el.className = 'form-msg' + (tipo ? ' ' + tipo : '');
  }

  function fechaCorta(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '';
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  function nombreCompleto(l) {
    return [val(l.apellido), val(l.nombre)].filter(Boolean).join(', ');
  }

  // Orden alfabético A-Z por apellido y después por nombre (respeta tildes y la ñ)
  function ordenar(lista) {
    lista.sort((a, b) =>
      val(a.apellido).localeCompare(val(b.apellido), 'es', { sensitivity: 'base' }) ||
      val(a.nombre).localeCompare(val(b.nombre), 'es', { sensitivity: 'base' })
    );
  }

  /* ---------- Estado ---------- */
  let tipo = 'profesionales';                       // pestaña activa
  const datos = { profesionales: [], pacientes: [] };
  const cargado = { profesionales: false, pacientes: false };
  let modoBusqueda = 'nombre';                      // 'nombre' o 'dni'
  let actual = null;                                // legajo abierto (null = ninguno)
  let esNuevo = false;
  let editando = false;
  let sucio = false;

  const vistaLista = $('legLista');
  const vistaDetalle = $('legDetalle');
  const inputBuscar = $('legBuscar');

  /* =========================================================
     CAMBIO DE SECCIÓN: Turnos / Legajos
     ========================================================= */
  function confirmarSalirDetalle() {
    return !sucio || confirm('Tenés cambios sin guardar en el legajo. ¿Querés descartarlos?');
  }

  document.querySelectorAll('.sec-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const sec = btn.dataset.sec;
      if (btn.classList.contains('active')) return;
      if (sec === 'turnos' && !confirmarSalirDetalle()) return;
      setMsg('');
      document.querySelectorAll('.sec-tab').forEach((b) => b.classList.toggle('active', b === btn));
      $('seccionTurnos').hidden = sec !== 'turnos';
      $('seccionLegajos').hidden = sec !== 'legajos';
      if (sec === 'legajos') abrirLista();
    });
  });

  /* =========================================================
     LISTA
     ========================================================= */
  async function cargarLista(forzar) {
    if (cargado[tipo] && !forzar) { renderLista(); return; }
    const t = tipo;
    setMsg('Cargando legajos...');
    try {
      const snap = await db.collection(COLECCION[t]).get();
      datos[t] = snap.docs.map((d) => Object.assign({ id: d.id }, d.data()));
      ordenar(datos[t]);
      cargado[t] = true;
      setMsg('');
    } catch (err) {
      console.error(err);
      if (err.code === 'permission-denied') {
        setMsg('Firebase no permite leer los legajos todavía: falta pegar las reglas nuevas (Firestore Database → Reglas).', 'error');
      } else {
        setMsg('No se pudieron cargar los legajos. Revisá tu conexión.', 'error');
      }
    }
    if (t === tipo) renderLista();
  }

  function abrirLista() {
    vistaDetalle.hidden = true;
    vistaLista.hidden = false;
    actual = null; esNuevo = false; editando = false; sucio = false;
    cargarLista(false);
  }

  // ¿El legajo coincide con lo escrito en el buscador?
  function coincide(l, texto) {
    if (!texto) return true;
    if (modoBusqueda === 'dni') {
      return String(l.dni || '').indexOf(texto.replace(/\D/g, '')) !== -1;
    }
    const base = normal(val(l.apellido) + ' ' + val(l.nombre));
    return normal(texto).split(/\s+/).filter(Boolean).every((p) => base.indexOf(p) !== -1);
  }

  function badgeEstado(estado) {
    const e = val(estado);
    if (!e) return '<span class="badge badge-gris">Sin estado</span>';
    const verde = ['Activo', 'En tratamiento'];
    const amarillo = ['Licencia', 'En pausa'];
    const clase = verde.indexOf(e) !== -1 ? 'badge-verde' : amarillo.indexOf(e) !== -1 ? 'badge-amarillo' : 'badge-gris';
    return '<span class="badge ' + clase + '">' + esc(e) + '</span>';
  }

  function renderLista() {
    const texto = inputBuscar.value;
    const lista = datos[tipo].filter((l) => coincide(l, texto));
    const total = datos[tipo].length;
    const nom = NOMBRE_TIPO[tipo];

    // Encabezado de la tabla según el tipo
    $('legTh3').textContent = tipo === 'profesionales' ? 'Área / Rol' : 'Obra social';

    // Contador
    let resumen;
    if (!cargado[tipo]) resumen = '';
    else if (texto) resumen = lista.length + ' de ' + total + ' ' + nom.plural + ' · orden A-Z';
    else resumen = total + (total === 1 ? ' ' + nom.singular : ' ' + nom.plural) + ' · orden A-Z';
    $('legContador').textContent = resumen;

    const tbody = $('legTbody');
    if (!cargado[tipo]) { tbody.innerHTML = ''; return; }

    if (!lista.length) {
      const txt = total
        ? 'No hay ' + nom.plural + ' que coincidan con la búsqueda.'
        : 'Todavía no hay legajos de ' + nom.plural + '. Usá “+ Nuevo legajo” para crear el primero.';
      tbody.innerHTML = '<tr><td colspan="5" class="tabla-vacia">' + txt + '</td></tr>';
      return;
    }

    tbody.innerHTML = lista.map((l) => {
      const col3 = tipo === 'profesionales' ? val(l.area) : val(l.obraSocial);
      return '<tr>' +
        '<td class="leg-nombre">' + esc(nombreCompleto(l)) + '</td>' +
        '<td>' + esc(l.dni) + '</td>' +
        '<td>' + (col3 ? esc(col3) : '<span class="leg-vacio">—</span>') + '</td>' +
        '<td>' + badgeEstado(l.estado) + '</td>' +
        '<td class="leg-acciones">' +
          '<button type="button" class="btn-mini" data-ver="' + esc(l.id) + '">Ver</button>' +
          '<button type="button" class="btn-mini btn-mini-fuerte" data-editar="' + esc(l.id) + '">Editar</button>' +
        '</td>' +
      '</tr>';
    }).join('');
  }

  /* ----- Pestañas Profesionales / Pacientes ----- */
  document.querySelectorAll('.leg-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.tipo === tipo && vistaDetalle.hidden) return;
      if (!confirmarSalirDetalle()) return;
      setMsg('');
      document.querySelectorAll('.leg-tab').forEach((b) => b.classList.toggle('active', b === btn));
      tipo = btn.dataset.tipo;
      inputBuscar.value = '';
      abrirLista();
    });
  });

  /* ----- Buscador ----- */
  function actualizarPlaceholder() {
    inputBuscar.placeholder = modoBusqueda === 'dni'
      ? 'Escribí el DNI (solo números)'
      : 'Escribí nombre y/o apellido';
    inputBuscar.inputMode = modoBusqueda === 'dni' ? 'numeric' : 'text';
  }

  document.querySelectorAll('input[name="legFiltro"]').forEach((r) => {
    r.addEventListener('change', () => {
      modoBusqueda = r.value;
      if (modoBusqueda === 'dni') inputBuscar.value = inputBuscar.value.replace(/\D/g, '');
      actualizarPlaceholder();
      renderLista();
      inputBuscar.focus();
    });
  });

  inputBuscar.addEventListener('input', () => {
    if (modoBusqueda === 'dni') inputBuscar.value = inputBuscar.value.replace(/\D/g, '').slice(0, 8);
    renderLista();
  });

  // Enter dentro del buscador no debe enviar nada
  $('legBuscador').addEventListener('submit', (e) => e.preventDefault());

  /* ----- Ver / Editar desde la lista ----- */
  $('legTbody').addEventListener('click', (e) => {
    const bVer = e.target.closest('[data-ver]');
    const bEd = e.target.closest('[data-editar]');
    const id = bVer ? bVer.dataset.ver : bEd ? bEd.dataset.editar : null;
    if (!id) return;
    const l = datos[tipo].find((x) => x.id === id);
    if (l) abrirDetalle(l, false, !!bEd);
  });

  $('legNuevo').addEventListener('click', () => abrirDetalle({}, true, true));

  /* =========================================================
     DETALLE: ver / editar / crear
     ========================================================= */
  function campo(etiqueta, nombre, valor, extra) {
    extra = extra || {};
    const tipoInput = extra.type || 'text';
    return '<label class="leg-campo' + (extra.ancho ? ' ' + extra.ancho : '') + '">' +
      '<span>' + etiqueta + (extra.req ? ' <b>*</b>' : '') + '</span>' +
      '<input type="' + tipoInput + '" data-f="' + nombre + '" value="' + esc(valor) + '"' +
        (extra.max ? ' maxlength="' + extra.max + '"' : '') +
        (extra.modo ? ' inputmode="' + extra.modo + '"' : '') +
        (extra.ph ? ' placeholder="' + esc(extra.ph) + '"' : '') +
        (extra.list ? ' list="' + extra.list + '"' : '') +
      '>' +
    '</label>';
  }

  function selector(etiqueta, nombre, opciones, valor, req, vacio) {
    const ops = (vacio ? '<option value="">' + vacio + '</option>' : '') + opciones.map((o) =>
      '<option value="' + esc(o) + '"' + (o === valor ? ' selected' : '') + '>' + esc(o) + '</option>'
    ).join('');
    return '<label class="leg-campo"><span>' + etiqueta + (req ? ' <b>*</b>' : '') + '</span>' +
      '<select data-f="' + nombre + '">' + ops + '</select></label>';
  }

  function formularioHtml(l) {
    const prof = tipo === 'profesionales';
    let h = '<fieldset class="leg-form" id="legFieldset"' + (editando ? '' : ' disabled') + '>';

    h += '<h4>Datos personales</h4><div class="leg-grid">';
    h += campo('Apellido', 'apellido', l.apellido, { req: true });
    h += campo('Nombre', 'nombre', l.nombre, { req: true });
    h += campo('DNI', 'dni', l.dni, { req: true, max: 8, modo: 'numeric', ph: 'Sin puntos' });
    h += campo('Fecha de nacimiento', 'fechaNacimiento', l.fechaNacimiento, { type: 'date' });
    h += campo('Teléfono', 'telefono', l.telefono, { type: 'tel' });
    h += campo('Correo electrónico', 'email', l.email, { type: 'email' });
    h += campo('Domicilio', 'domicilio', l.domicilio, { ancho: 'ancho-2' });
    h += '</div>';

    if (prof) {
      h += '<h4>Datos profesionales</h4><div class="leg-grid">';
      h += selector('Área', 'area', AREAS_LEG, l.area, true, 'Elegir área…');
      h += campo('Matrícula', 'matricula', l.matricula);
      h += campo('Fecha de ingreso', 'fechaIngreso', l.fechaIngreso, { type: 'date' });
      h += selector('Estado', 'estado', ESTADOS.profesionales, l.estado || 'Activo', true);
      h += '</div>';
    } else {
      const areasSel = Array.isArray(l.areas) ? l.areas : [];
      h += '<h4>Datos del paciente</h4><div class="leg-grid">';
      h += campo('Obra social', 'obraSocial', l.obraSocial);
      h += campo('N.º de afiliado', 'nroAfiliado', l.nroAfiliado);
      h += campo('Derivado por', 'derivadoPor', l.derivadoPor);
      h += selector('Estado', 'estado', ESTADOS.pacientes, l.estado || 'En tratamiento', true);
      h += campo('Diagnóstico', 'diagnostico', l.diagnostico, { ancho: 'ancho-2' });
      h += '</div>';
      h += '<div class="leg-campo leg-areas"><span>Áreas en tratamiento</span><div class="leg-checks">' +
        AREAS_LEG.map((a) =>
          '<label class="leg-check"><input type="checkbox" data-areas value="' + esc(a) + '"' +
          (areasSel.indexOf(a) !== -1 ? ' checked' : '') + '> ' + esc(a) + '</label>'
        ).join('') + '</div></div>';
      h += '<h4>Contacto de emergencia / familiar responsable</h4><div class="leg-grid">';
      h += campo('Nombre y apellido', 'contactoNombre', l.contactoNombre);
      h += campo('Vínculo', 'contactoVinculo', l.contactoVinculo, { ph: 'Ej.: madre, hijo/a' });
      h += campo('Teléfono', 'contactoTelefono', l.contactoTelefono, { type: 'tel' });
      h += '</div>';
    }

    h += '<h4>Observaciones</h4>';
    h += '<label class="leg-campo"><textarea data-f="observaciones" rows="4" placeholder="Notas internas del legajo">' + esc(l.observaciones) + '</textarea></label>';
    h += '</fieldset>';
    return h;
  }

  function abrirDetalle(l, nuevo, paraEditar) {
    actual = l;
    esNuevo = nuevo;
    editando = paraEditar;
    sucio = false;
    vistaLista.hidden = true;
    vistaDetalle.hidden = false;
    renderDetalle();
    setMsg('');
    const tarjeta = vistaDetalle.closest('.modal-card');
    if (tarjeta) tarjeta.scrollTop = 0;
  }

  function renderDetalle() {
    const nom = NOMBRE_TIPO[tipo];
    const titulo = esNuevo ? 'Nuevo legajo de ' + nom.singular : nombreCompleto(actual);
    $('legDetTitulo').textContent = titulo;
    $('legDetSub').textContent = esNuevo
      ? 'Completá los datos. Los campos con * son obligatorios.'
      : nom.titulo + ' · DNI ' + val(actual.dni) + (editando ? ' · editando' : ' · solo lectura');

    $('legForm').innerHTML = formularioHtml(actual);

    // El DNI es la identificación del legajo: solo se escribe al crearlo
    const dniInput = $('legForm').querySelector('[data-f="dni"]');
    if (dniInput && !esNuevo) dniInput.disabled = true;

    // Última actualización
    let pie = '';
    if (actual.actualizado && typeof actual.actualizado.toDate === 'function') {
      pie = 'Última actualización: ' + actual.actualizado.toDate().toLocaleString('es-AR');
    }
    $('legPie').textContent = pie;

    // Botones según el modo
    $('legBtnEditar').hidden = editando;
    $('legBtnGuardar').hidden = !editando;
    $('legBtnCancelar').hidden = !editando || esNuevo;
    $('legBtnEliminar').hidden = esNuevo;
    $('legBtnImprimir').hidden = esNuevo;
  }

  // Cualquier cambio en el formulario marca "sin guardar"
  $('legForm').addEventListener('input', () => { if (editando) sucio = true; });
  $('legForm').addEventListener('change', () => { if (editando) sucio = true; });
  $('legForm').addEventListener('input', (e) => {
    if (e.target.dataset.f === 'dni') e.target.value = e.target.value.replace(/\D/g, '');
  });

  $('legVolver').addEventListener('click', () => {
    if (!confirmarSalirDetalle()) return;
    abrirLista();
  });

  $('legBtnEditar').addEventListener('click', () => {
    editando = true;
    renderDetalle();
    setMsg('');
  });

  $('legBtnCancelar').addEventListener('click', () => {
    if (!confirmarSalirDetalle()) return;
    editando = false;
    sucio = false;
    renderDetalle();
    setMsg('');
  });

  /* ----- Guardar ----- */
  function leerFormulario() {
    const out = {};
    $('legForm').querySelectorAll('[data-f]').forEach((el) => { out[el.dataset.f] = val(el.value); });
    if (tipo === 'pacientes') {
      out.areas = Array.from($('legForm').querySelectorAll('[data-areas]:checked')).map((c) => c.value);
    }
    return out;
  }

  $('legBtnGuardar').addEventListener('click', async () => {
    const d = leerFormulario();
    if (!esNuevo) d.dni = val(actual.dni);   // el DNI no cambia en legajos existentes

    if (!d.apellido || !d.nombre) { setMsg('Completá el apellido y el nombre.', 'error'); return; }
    if (!/^\d{7,8}$/.test(d.dni)) { setMsg('Ingresá un DNI válido (7 u 8 números, sin puntos).', 'error'); return; }
    if (tipo === 'profesionales' && !d.area) { setMsg('Elegí el área del profesional.', 'error'); return; }
    if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) { setMsg('El correo electrónico no parece válido.', 'error'); return; }

    const btn = $('legBtnGuardar');
    btn.disabled = true;
    setMsg('Guardando...');
    try {
      const ref = db.collection(COLECCION[tipo]).doc(d.dni);
      const ahora = firebase.firestore.FieldValue.serverTimestamp();

      if (esNuevo) {
        const existe = await ref.get();
        if (existe.exists) {
          setMsg('Ya existe un legajo con ese DNI. Buscalo en la lista para editarlo.', 'error');
          return;
        }
        d.creado = ahora;
      } else if (actual.creado) {
        d.creado = actual.creado;
      }
      d.actualizado = ahora;

      await ref.set(d);

      // Volvemos a leer el legajo para tener las fechas reales
      const guardado = await ref.get();
      const nuevoLegajo = Object.assign({ id: guardado.id }, guardado.data());
      datos[tipo] = datos[tipo].filter((x) => x.id !== nuevoLegajo.id);
      datos[tipo].push(nuevoLegajo);
      ordenar(datos[tipo]);

      actual = nuevoLegajo;
      esNuevo = false;
      editando = false;
      sucio = false;
      renderDetalle();
      setMsg('Legajo guardado ✔', 'ok');
    } catch (err) {
      console.error(err);
      if (err.code === 'permission-denied') {
        setMsg('Firebase no permite guardar legajos: falta pegar las reglas nuevas (Firestore Database → Reglas).', 'error');
      } else {
        setMsg('No se pudo guardar. Revisá tu conexión e intentá de nuevo.', 'error');
      }
    } finally {
      btn.disabled = false;
    }
  });

  /* ----- Eliminar ----- */
  $('legBtnEliminar').addEventListener('click', async () => {
    const nom = nombreCompleto(actual);
    if (!confirm('¿Eliminar el legajo de ' + nom + '? Esta acción no se puede deshacer.\n\nSi solo dejó de atenderse, es mejor cambiar el estado en lugar de eliminarlo.')) return;
    setMsg('Eliminando...');
    try {
      await db.collection(COLECCION[tipo]).doc(actual.id).delete();
      datos[tipo] = datos[tipo].filter((x) => x.id !== actual.id);
      sucio = false;
      abrirLista();
      setMsg('Legajo eliminado ✔', 'ok');
    } catch (err) {
      console.error(err);
      setMsg('No se pudo eliminar el legajo. Revisá tu conexión.', 'error');
    }
  });

  /* =========================================================
     IMPRIMIR FICHA (o guardar como PDF)
     ========================================================= */
  function datoImp(etiqueta, valor, ancho) {
    const v = Array.isArray(valor) ? valor.join(', ') : val(valor);
    return '<div class="print-dato' + (ancho ? ' ancho' : '') + '"><span>' + esc(etiqueta) + '</span>' +
      (v ? esc(v) : '—') + '</div>';
  }

  function seccionImp(titulo, contenido) {
    return '<h2>' + esc(titulo) + '</h2><div class="print-ficha-datos">' + contenido + '</div>';
  }

  function fichaHtml(l) {
    const prof = tipo === 'profesionales';
    const nom = NOMBRE_TIPO[tipo];

    let h = '<div class="print-head">' +
      '<img src="img/logo.png" alt="Neurolar" class="print-logo">' +
      '<div class="print-title"><h1>' + esc(nom.titulo) + '</h1><p>Centro de Rehabilitación Neurológica</p></div>' +
    '</div>';

    h += '<div class="print-ficha">';
    h += '<p class="print-nombre">' + esc(nombreCompleto(l)) + '</p>';

    h += seccionImp('Datos personales',
      datoImp('DNI', l.dni) +
      datoImp('Fecha de nacimiento', fechaCorta(l.fechaNacimiento)) +
      datoImp('Teléfono', l.telefono) +
      datoImp('Correo electrónico', l.email) +
      datoImp('Domicilio', l.domicilio, true));

    if (prof) {
      h += seccionImp('Datos profesionales',
        datoImp('Área', l.area) +
        datoImp('Estado', l.estado) +
        datoImp('Matrícula', l.matricula) +
        datoImp('Fecha de ingreso', fechaCorta(l.fechaIngreso)));
    } else {
      h += seccionImp('Datos del paciente',
        datoImp('Estado', l.estado) +
        datoImp('Obra social', l.obraSocial) +
        datoImp('N.º de afiliado', l.nroAfiliado) +
        datoImp('Derivado por', l.derivadoPor) +
        datoImp('Diagnóstico', l.diagnostico, true) +
        datoImp('Áreas en tratamiento', l.areas, true));
      h += seccionImp('Contacto de emergencia / familiar responsable',
        datoImp('Nombre y apellido', l.contactoNombre) +
        datoImp('Vínculo', l.contactoVinculo) +
        datoImp('Teléfono', l.contactoTelefono));
    }

    h += '<h2>Observaciones</h2><div class="print-obs">' + (val(l.observaciones) ? esc(l.observaciones) : '—') + '</div>';
    h += '</div>';

    h += '<div class="print-firma"><div>Firma y aclaración</div></div>';
    h += '<div class="print-foot">' +
      '<span>Documento confidencial · uso interno de Neurolar</span>' +
      '<span>Impreso el ' + esc(new Date().toLocaleString('es-AR')) + '</span>' +
    '</div>';
    return h;
  }

  $('legBtnImprimir').addEventListener('click', () => {
    if (!actual || esNuevo) return;
    if (sucio) {
      setMsg('Guardá los cambios antes de imprimir la ficha.', 'error');
      return;
    }
    setMsg('');
    $('printArea').innerHTML = fichaHtml(actual);

    // El título de la página se usa como nombre sugerido del PDF
    const tituloOriginal = document.title;
    const nombreArchivo = 'Legajo_' + sinTildes(nombreCompleto(actual)).replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') + '_' + val(actual.dni);
    document.title = nombreArchivo;
    window.addEventListener('afterprint', function restaurar() {
      document.title = tituloOriginal;
      window.removeEventListener('afterprint', restaurar);
    });
    window.print();
  });

  /* ----- Al cerrar sesión se borra todo lo cargado ----- */
  auth.onAuthStateChanged((user) => {
    if (user) return;
    datos.profesionales = []; datos.pacientes = [];
    cargado.profesionales = false; cargado.pacientes = false;
    actual = null; esNuevo = false; editando = false; sucio = false;
    inputBuscar.value = '';
    vistaDetalle.hidden = true;
    vistaLista.hidden = false;
    $('legTbody').innerHTML = '';
    // Vuelve a mostrar la sección de turnos
    document.querySelectorAll('.sec-tab').forEach((b) => b.classList.toggle('active', b.dataset.sec === 'turnos'));
    $('seccionTurnos').hidden = false;
    $('seccionLegajos').hidden = true;
    setMsg('');
  });

  actualizarPlaceholder();
})();