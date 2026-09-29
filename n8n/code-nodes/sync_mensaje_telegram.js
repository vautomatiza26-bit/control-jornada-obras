// Nodo Code de n8n · Mensaje final: en modo real solo avisa de lo NUEVO y no repite avisos pendientes (memoria del flujo).
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Mensaje de Telegram. En modo real solo avisa si hay algo NUEVO que contar (y no repite los avisos pendientes).
let simulacion = false;
try { $('Simulación (a mano)').first(); simulacion = true; } catch (e) { simulacion = false; }
const res = $('Sincronizar app').first().json;
const cr  = $('Recoger altas').first().json;
const vin = $('Vincular en la app').first().json || {};
const lista = (a) => a.map(n => `• ${n}`).join('\n');
const memoria = $getWorkflowStaticData('global');
memoria.avisados = memoria.avisados || {};
const ahora = Date.now();
// Aviso repetible como máximo cada 24 h por clave
const nuevoAviso = (clave, horas = 24) => {
  if (simulacion) return true;
  if (ahora - (memoria.avisados[clave] || 0) < horas * 3600 * 1000) return false;
  memoria.avisados[clave] = ahora; return true;
};

let t = '';
if (simulacion) {
  t += `🧪 SIMULACIÓN — no se ha cambiado nada\nHoja maestra: ${res.total_hoja} trabajadores\n`;
  const sec = (tit, arr) => { if (arr && arr.length) t += `\n${tit} (${arr.length})\n${lista(arr)}\n`; };
  sec('➕ Se crearían en la app', res.crear);
  sec('⛔ Se darían de baja en la app', res.desactivar);
  sec('♻️ Se reactivarían', res.reactivar);
  sec('🔗 Se vincularían por nombre (se les guardaría el DNI)', res.vincular_dni);
  sec('❓ Nombres ambiguos: no se tocarían', res.ambiguos);
  sec('ℹ️ Activos en la app que NO están en la hoja (no se tocan)', res.solo_en_app);
  sec('🔗 Se vincularían con su perfil de Jibble', cr.p_pares.map(p => `${p.nombre}`));
  sec('➕ Se darían de alta en Jibble automáticamente', cr.sim_crear);
  if (res.bloqueo) t += `\n🚫 En modo real se BLOQUEARÍA por seguridad (${res.bloqueo}).\n`;
  if (!cr.jibbleOk) t += `\n⚠️ No se pudo leer Jibble.\n`;
  if (t.split('\n').length < 5) t += '\nTodo coincide: no habría cambios.';
  return [{ json: { texto: t.slice(0, 4000) } }];
}

// ---- Modo real ----
if (res.bloqueo) {
  const clave = 'bloqueo:' + res.bloqueo + ':' + [...(res.desactivar || []), ...(res.crear || []), ...(res.reactivar || [])].join('|');
  if (nuevoAviso(clave, 6)) {
    t += `\n🚫 SINCRONIZACIÓN BLOQUEADA por seguridad (${res.bloqueo === 'demasiadas_bajas' ? 'demasiadas bajas de golpe' : 'demasiadas altas de golpe'}).\nNo se ha cambiado nada. Revisa la hoja maestra.\n`;
    if (res.desactivar?.length) t += `\nBajas pedidas (${res.desactivar.length}):\n${lista(res.desactivar)}\n`;
    if ((res.crear || []).length) t += `\nAltas pedidas (${res.crear.length}):\n${lista(res.crear)}\n`;
    if ((res.reactivar || []).length) t += `\nReactivaciones (${res.reactivar.length}):\n${lista(res.reactivar)}\n`;
  }
} else if (res.aplicado) {
  if (res.crear?.length)      t += `\n➕ ALTA — ya aparecen en la app (${res.crear.length}):\n${lista(res.crear)}\nFalta: mandarles su enlace de activación (Admin → Operarios → Enlace) y asignarles obra.\n`;
  if (res.desactivar?.length) t += `\n⛔ BAJA — ya no aparecen en la app y su móvil ha dejado de valer (${res.desactivar.length}):\n${lista(res.desactivar)}\n`;
  if (res.reactivar?.length)  t += `\n♻️ REACTIVADOS (${res.reactivar.length}):\n${lista(res.reactivar)}\nSu móvil se anuló al darlos de baja: mándales un enlace nuevo.\n`;
  if (res.vincular_dni?.length && res.vincular_dni.length > 0 && nuevoAviso('vinculo:' + res.vincular_dni.join('|'), 24 * 365))
    t += `\n🔗 Vinculados a la hoja por nombre (${res.vincular_dni.length}):\n${lista(res.vincular_dni)}\n`;
}
if ((res.ambiguos || []).length && nuevoAviso('ambiguos:' + res.ambiguos.join('|')))
  t += `\n❓ Nombres ambiguos en la hoja (no se han tocado):\n${lista(res.ambiguos)}\n`;
if ((cr.creados || []).length)
  t += `\n➕ DADOS DE ALTA EN JIBBLE automáticamente (${cr.creados.length}):\n${lista(cr.creados)}\nSin invitación. Sus fichajes en espera se reenvían solos.\n`;
const yaExistian = cr.p_pares.map(p => p.nombre).filter(n => !(cr.creados || []).includes(n));
if ((vin.vinculados || 0) > 0 && yaExistian.length)
  t += `\n🔗 Vinculados con su perfil de Jibble (${yaExistian.length}):\n${lista(yaExistian)}\nSus fichajes en espera se reenvían solos.\n`;
const fallos = (cr.errores_jibble || []).filter(n => nuevoAviso('errjibble:' + n, 6));
if (fallos.length)
  t += `\n⚠️ NO SE PUDO DAR DE ALTA EN JIBBLE (${fallos.length}):\n${lista(fallos)}\nSe reintentará solo. Si persiste, dalos de alta a mano en Jibble → People → Add members, sin invitación.\n`;
const faltan = (cr.faltan || []).filter(n => nuevoAviso('jibble:' + n));
if (faltan.length)
  t += `\n⏳ FALTA DARLOS DE ALTA EN JIBBLE (${faltan.length}):\n${lista(faltan)}\nHay que hacerlo a mano: Jibble → People → Add members, con ese nombre exacto y SIN invitación. En cuanto lo hagas se vinculan solos (máx. 10 min).\n`;
if (!cr.jibbleOk && (res.nuevos_sin_jibble || []).length && nuevoAviso('jibble-caido', 6))
  t += `\n⚠️ No se pudo leer Jibble para vincular a los nuevos.\n`;
if (!t.trim()) return [];
return [{ json: { texto: ('📋 PLANTILLA — hoja maestra ➜ app' + t).slice(0, 4000) } }];
