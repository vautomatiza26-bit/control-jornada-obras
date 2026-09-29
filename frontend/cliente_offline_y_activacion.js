/* =====================================================================================
 * Extracto del cliente (JavaScript sin frameworks): lo que resuelve los problemas difíciles.
 *   · Aviso informativo con constancia de lectura (también sin conexión)
 *   · Fichaje sin conexión: cola local + sincronización + idempotencia (id generado en el móvil)
 *   · "Móvil de confianza": la llave se guarda en el móvil; en la base solo su hash
 *   · Activación del móvil con un enlace de un solo uso
 *
 * Es un EXTRACTO: depende de variables y funciones del resto de la app (state, app, supabaseClient,
 * renderLogin, renderInicioTrabajador, showToast...). Sirve para leer las decisiones, no para ejecutarlo tal cual.
 * ===================================================================================== */

// =================== AVISO INFORMATIVO (registro de jornada y ubicación) ===================
// BORRADOR: revisar con un profesional de protección de datos ANTES del lanzamiento.
// El texto se edita aquí. Si lo cambias, sube AVISO_VERSION (1 -> 2): se volverá a pedir a todos.
const AVISO_VERSION = 1;
// Interruptor de la ubicación: false = la app NO pide ni guarda la ubicación (el fichaje funciona igual, sin GPS)
const USAR_UBICACION = true;
const AVISO_TITULO = 'Antes de empezar: tus datos al fichar';
const AVISO_TEXTO = [
  ['Qué se guarda.', 'Cada vez que fichas (entrada, pausa o salida) se guarda tu nombre, la fecha y la hora y, si el móvil lo permite, la ubicación en ese momento y el modelo de móvil.'],
  ['Ubicación.', 'Solo se toma en el instante en que pulsas el botón de fichar. La app no te sigue ni te localiza durante el día. Si no das permiso de ubicación, puedes fichar igualmente.'],
  ['Para qué.', 'Para llevar el registro de jornada que exige la ley y comprobar que los fichajes son correctos. No se usan para ninguna otra finalidad.'],
  ['Quién lo ve.', 'La oficina de [Empresa]. Los datos se guardan en los servicios que la empresa tiene contratados para el registro horario y el almacenamiento (Jibble y Supabase).'],
  ['Cuánto tiempo.', 'Se conservan 4 años, como exige la ley.'],
  ['Tus derechos.', 'Puedes pedir en la oficina que te enseñen tus fichajes, que corrijan un error y ejercer tus derechos de protección de datos. Responsable: [Nombre de la empresa]']
];
const claveAviso = (id) => `app_aviso_v${AVISO_VERSION}_${id}`;
const CLAVE_ACEPT_COLA = 'app_aceptaciones_pendientes';
function avisoLeidoLocal(id){ try { return localStorage.getItem(claveAviso(id)) === '1'; } catch(e){ return false; } }
function marcarAvisoLeido(id){ try { localStorage.setItem(claveAviso(id), '1'); } catch(e){} }
// ¿Ha leído ya este trabajador la versión actual del aviso?
function avisoAlDia(){
  if(!state.user) return true;
  if(avisoLeidoLocal(state.user.id)) return true;
  if(state.fichaje && Number(state.fichaje.aviso_v || 0) >= AVISO_VERSION){ marcarAvisoLeido(state.user.id); return true; }
  return false;
}
async function enviarAceptacion(operarioId, horaMovil){
  const g = llaveGuardada();
  const cred = (g && g.operarioId === operarioId) ? { p_llave: g.llave } : { p_pin: state.pin };
  try{
    const { data, error } = await supabaseClient.rpc('aceptar_aviso', { p_operario: operarioId, p_version: AVISO_VERSION, ...cred,
      p_dispositivo: (navigator.userAgent || '').slice(0, 200), p_hora_movil: horaMovil });
    if(error) return esErrorDeRed(error) ? 'red' : 'error';
    return data && data.resultado === 'ok' ? 'ok' : 'error';
  }catch(e){ return 'red'; }
}
// Aceptaciones hechas sin conexión: se envían solas al volver la señal (solo con móvil activado)
let enviandoAceptaciones = false;
async function enviarAceptacionesPendientes(){
  if(enviandoAceptaciones) return;
  const cola = leerJSON(CLAVE_ACEPT_COLA) || [];
  if(!cola.length) return;
  const g = llaveGuardada(); if(!g) return;
  enviandoAceptaciones = true;
  try{
    const restantes = [];
    for(const a of cola){
      if(a.operario_id !== g.operarioId) continue;
      try{
        const { error } = await supabaseClient.rpc('aceptar_aviso', { p_operario: a.operario_id, p_version: a.version, p_llave: g.llave,
          p_dispositivo: (navigator.userAgent || '').slice(0, 200), p_hora_movil: a.hora });
        if(error && esErrorDeRed(error)) restantes.push(a);
      }catch(e){ restantes.push(a); }
    }
    guardarJSON(CLAVE_ACEPT_COLA, restantes);
  } finally { enviandoAceptaciones = false; }
}
function renderAviso(){
  app.innerHTML = `<div style="padding:1.25rem 1.1rem 2.5rem;max-width:520px;margin:0 auto;">
    <h1 class="title" style="font-size:22px;margin-bottom:1rem;">${AVISO_TITULO}</h1>
    ${AVISO_TEXTO.map(([t, x]) => `<p style="font-size:14.5px;line-height:1.55;margin:0 0 .85rem;"><b>${t}</b> ${x}</p>`).join('')}
    <button class="big-btn primary" id="btn-aviso-ok" style="margin-top:1rem;"><i class="ti ti-check"></i> He leído esta información</button>
    <button class="big-btn ghost" id="btn-aviso-dudas" style="margin-top:.6rem;">Tengo dudas: volver</button>
  </div>`;
  document.getElementById('btn-aviso-dudas').addEventListener('click', ()=>{ state.user = null; state.pin = null; renderLogin(); });
  document.getElementById('btn-aviso-ok').addEventListener('click', async ()=>{
    const btn = document.getElementById('btn-aviso-ok'); btn.disabled = true;
    const id = state.user.id, hora = new Date().toISOString();
    const r = await enviarAceptacion(id, hora);
    const g = llaveGuardada(), conLlave = g && g.operarioId === id;
    if(r === 'ok'){ marcarAvisoLeido(id); }
    else if(r === 'red' && conLlave){            // sin conexión: se guarda y se envía después
      const cola = leerJSON(CLAVE_ACEPT_COLA) || [];
      cola.push({ operario_id: id, version: AVISO_VERSION, hora });
      guardarJSON(CLAVE_ACEPT_COLA, cola); marcarAvisoLeido(id);
    }else{
      btn.disabled = false;
      showToast('No se pudo guardar. Comprueba la cobertura e inténtalo de nuevo.');
      return;
    }
    renderInicioTrabajador();
  });
}

// =================== SIN CONEXIÓN ===================
// Los fichajes sin cobertura se guardan en una "cola" en el móvil y se envían solos al volver la conexión.
const CLAVE_DATOS  = 'app_datos_basicos';
const CLAVE_COLA   = 'app_cola_fichajes';
const CLAVE_AVISOS = 'app_fichajes_no_registrados';
const claveEstado  = (id) => 'app_estado_' + id;
function leerJSON(k){ try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch(e){ return null; } }
function guardarJSON(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch(e){ return false; } }
const leerCola = () => leerJSON(CLAVE_COLA) || [];
function nuevoId(){
  if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
}
// ¿El fallo es por falta de conexión (y no un "no" del servidor)?
function esErrorDeRed(error){
  return !navigator.onLine || /fetch|network|load failed|timeout/i.test(String(error?.message || error || ''));
}
const SIGUIENTE_ESTADO = { entrada:'trabajando', pausa_inicio:'en_pausa', pausa_fin:'trabajando', salida:'fuera' };
function guardarEstadoLocal(operarioId, f){ if(f) guardarJSON(claveEstado(operarioId), f); }

let sincronizando = false;
async function sincronizarCola(){
  if(sincronizando) return;
  await enviarAceptacionesPendientes();
  let cola = leerCola();
  if(!cola.length) return;
  const g = llaveGuardada();
  sincronizando = true;
  let cambios = false;
  try{
    while(cola.length){
      const f = cola[0];
      if(!g || g.operarioId !== f.operario_id){ cola.shift(); continue; }   // sin llave de ese trabajador: no se puede enviar
      let data, error;
      try{
        ({ data, error } = await supabaseClient.rpc('fichar', {
          p_operario: f.operario_id, p_tipo: f.tipo, p_llave: g.llave,
          p_lat: f.lat, p_lng: f.lng, p_precision: f.precision,
          p_dispositivo: f.dispositivo, p_id: f.id, p_hora_movil: f.hora }));
      }catch(e){ error = e; }
      if(error){ if(esErrorDeRed(error)) break; }        // sigue sin conexión: se reintenta más tarde
      else if(data && data.resultado !== 'ok'){
        // El servidor no lo acepta (hora fuera de plazo, paso incoherente...): queda registrado para la oficina
        const avisos = leerJSON(CLAVE_AVISOS) || [];
        avisos.push({ tipo: f.tipo, hora: f.hora, motivo: data.resultado });
        guardarJSON(CLAVE_AVISOS, avisos);
      }
      cola.shift(); guardarJSON(CLAVE_COLA, cola); cambios = true;
    }
  } finally { sincronizando = false; }
  if(cambios && !leerCola().length){
    state.offline = false;
    showToast('Fichajes sin conexión enviados correctamente.');
    if(document.querySelector('.estado-fichaje') && state.user) refrescarEstadoYMostrarInicio();
  }
}
window.addEventListener('online', sincronizarCola);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible') sincronizarCola(); });
setInterval(sincronizarCola, 30000);

// =================== MÓVIL DE CONFIANZA ===================
// El trabajador pone su PIN UNA vez; el móvil guarda una "llave" (no el PIN) y ya no se lo vuelve a pedir.
// Un móvil solo recuerda a UNA persona (su dueño): así nadie puede tener guardados a varios compañeros
// en su teléfono y fichar por ellos.
const CLAVE_LLAVE = 'app_llave_movil';
function llaveGuardada(){
  try { return JSON.parse(localStorage.getItem(CLAVE_LLAVE) || 'null'); } catch(e){ return null; }
}
function guardarLlave(operarioId, llave){
  try { localStorage.setItem(CLAVE_LLAVE, JSON.stringify({ operarioId, llave })); return true; } catch(e){ return false; }
}
function borrarLlave(){ try { localStorage.removeItem(CLAVE_LLAVE); } catch(e){} }
// Credencial para las llamadas al servidor: la llave si este móvil es suyo; si no, el PIN tecleado
function credencial(){
  const g = llaveGuardada();
  if(g && state.user && g.operarioId === state.user.id) return { p_llave: g.llave };
  return { p_pin: state.pin };
}

// Sin conexión: se usa el último estado guardado en el móvil (solo para el dueño del móvil)
function entrarSinConexion(persona){
  state.user = persona; state.pin = null; state.offline = true;
  state.fichaje = leerJSON(claveEstado(persona.id)) || { estado:'fuera', entrada_hoy:false };
  renderInicioTrabajador();
}

async function entrarTrabajador(persona){
  const g = llaveGuardada();
  // Móvil recordado para esta persona: entra directo, sin PIN
  if(g && g.operarioId === persona.id){
    try{
      const { data, error } = await supabaseClient.rpc('estado_fichaje', { p_operario: persona.id, p_llave: g.llave });
      if(!error && data && data.resultado === 'ok'){
        state.user = persona; state.pin = null; state.fichaje = data; state.offline = false;
        guardarEstadoLocal(persona.id, data);
        renderInicioTrabajador();
        return;
      }
      if(error && esErrorDeRed(error)){ entrarSinConexion(persona); return; }
      if(!error && data && data.resultado === 'llave_invalida'){
        borrarLlave();   // la anularon desde administración (móvil nuevo, PIN cambiado...)
        showToast('Tienes que volver a poner tu PIN en este móvil.');
      }else{
        showToast('No se pudo conectar. Revisa la cobertura.');
        return;
      }
    }catch(e){ entrarSinConexion(persona); return; }
  }
  // Sin llave (o anulada): PIN
  pedirPin(persona, ()=>{
    state.user = persona;
    const yaHayDueno = llaveGuardada();
    if(!yaHayDueno) ofrecerRecordarMovil(persona);
    else renderInicioTrabajador();   // este móvil ya es de otra persona: no se recuerda a nadie más
  }, async (pin)=>{
    try{
      const { data, error } = await supabaseClient.rpc('estado_fichaje', { p_operario: persona.id, p_pin: pin });
      if(error) return 'error';
      if(data.resultado === 'ok') state.fichaje = data;
      return data.resultado;
    }catch(e){ return 'error'; }
  });
}

function ofrecerRecordarMovil(persona){
  app.innerHTML = `<div class="confirm-wrap">
    <div class="confirm-check" style="background:var(--green-bg);"><i class="ti ti-device-mobile" style="font-size:40px;color:var(--green);"></i></div>
    <div class="confirm-title">¿Este móvil es tuyo?</div>
    <div style="font-size:14px;color:var(--text-soft);margin:0 0 1.5rem;line-height:1.5;max-width:320px;">
      Si es tuyo, no te volveremos a pedir el PIN en este móvil.<br>
      <b>No lo marques en el móvil de un compañero.</b>
    </div>
    <button class="big-btn primary" id="btn-si-mio"><i class="ti ti-check"></i> Sí, es mi móvil</button>
    <button class="big-btn ghost" id="btn-no-mio" style="margin-top:10px;">No, es de otra persona</button>
  </div>`;
  document.getElementById('btn-no-mio').addEventListener('click', renderInicioTrabajador);
  document.getElementById('btn-si-mio').addEventListener('click', async ()=>{
    const btn = document.getElementById('btn-si-mio'); btn.disabled = true;
    try{
      const { data, error } = await supabaseClient.rpc('recordar_movil', {
        p_operario: persona.id, p_pin: state.pin, p_dispositivo: (navigator.userAgent || '').slice(0, 200) });
      if(!error && data && data.resultado === 'ok' && guardarLlave(persona.id, data.llave)){
        state.pin = null;   // ya no hace falta tenerlo en memoria
        showToast('Listo: este móvil ya te recuerda.');
      }else{
        showToast('No se pudo recordar el móvil. Seguirás usando el PIN.');
      }
    }catch(e){ showToast('No se pudo recordar el móvil. Seguirás usando el PIN.'); }
    renderInicioTrabajador();
  });
}

// =================== ACTIVACIÓN POR ENLACE ===================
// La oficina envía por WhatsApp un enlace personal ?activar=CODIGO. Al abrirlo, el móvil queda
// recordado para ese trabajador sin que tenga que saber ningún PIN. El enlace sirve UNA vez.
async function procesarActivacion(codigo){
  // Quitar el código de la dirección: si guarda la página en favoritos, no se guarda el enlace
  history.replaceState(null, '', location.pathname);
  app.innerHTML = `<div class="loading-wrap" style="min-height:70vh;"><div class="spinner"></div><div style="margin-top:10px;color:var(--text-soft);">Activando tu móvil…</div></div>`;
  let data, error;
  try{
    ({ data, error } = await supabaseClient.rpc('activar_movil', {
      p_codigo: codigo, p_dispositivo: (navigator.userAgent || '').slice(0, 200) }));
  }catch(e){ error = e; }

  if(!error && data && data.resultado === 'ok'){
    const anterior = llaveGuardada();
    guardarLlave(data.operario_id, data.llave);
    const persona = state.operarios.find(p => p.id === data.operario_id);
    const nombreCorto = (data.nombre || '').split(' ')[0];
    app.innerHTML = `<div class="confirm-wrap">
      <div class="confirm-check"><svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg></div>
      <div class="confirm-title">Hola, ${nombreCorto}</div>
      <div style="font-size:15px;margin:0.25rem 0 1rem;">Tu móvil ya está activado.</div>
      <div style="font-size:13.5px;color:var(--text-soft);line-height:1.55;max-width:330px;margin-bottom:1.5rem;">
        A partir de ahora entra en la app y pulsa <b>"Entrar como ${data.nombre}"</b>. No necesitas PIN.<br><br>
        💡 Consejo: en el menú del navegador pulsa <b>"Añadir a pantalla de inicio"</b> para tener la app como un icono más.
        ${anterior && anterior.operarioId !== data.operario_id ? '<br><br>Este móvil estaba registrado para otra persona; ahora es tuyo.' : ''}
      </div>
      <button class="big-btn primary" id="btn-empezar"><i class="ti ti-arrow-right"></i> Empezar</button>
    </div>`;
    document.getElementById('btn-empezar').addEventListener('click', ()=>{
      if(persona) entrarTrabajador(persona); else renderLogin();
    });
    return;
  }

  // Enlace ya usado pero este móvil ya está activado: probablemente lo ha vuelto a abrir desde WhatsApp.
  // No es un error: seguimos con normalidad.
  if(!error && data && data.resultado === 'ya_usado' && llaveGuardada()){
    renderLogin();
    return;
  }
  const mensajes = {
    ya_usado:  'Este enlace ya se ha usado. Si no fuiste tú quien lo abrió, avisa a la oficina.',
    caducado:  'Este enlace ha caducado. Pide uno nuevo a la oficina.',
    anulado:   'Este enlace ya no vale porque hay uno más nuevo. Usa el último que te enviaron.',
    no_existe: 'Este enlace no es válido. Comprueba que lo has abierto entero.',
    no_autorizado: 'Este enlace no se puede usar. Contacta con la oficina.'
  };
  app.innerHTML = `<div class="confirm-wrap">
    <div class="confirm-check" style="background:var(--amber-bg);"><i class="ti ti-alert-triangle" style="font-size:40px;color:var(--amber);"></i></div>
    <div class="confirm-title">No se pudo activar</div>
    <div style="font-size:14px;color:var(--text-soft);line-height:1.5;max-width:320px;margin-bottom:1.5rem;">
      ${error ? 'No hay conexión. Vuelve a abrir el enlace cuando tengas cobertura.' : (mensajes[data?.resultado] || 'Error inesperado.')}
    </div>
    <button class="big-btn ghost" id="btn-ir-inicio">Ir a la app</button>
  </div>`;
  document.getElementById('btn-ir-inicio').addEventListener('click', renderLogin);
}

