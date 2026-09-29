// Nodo Code de n8n · Aviso de las 9:30: qué mensaje se envía a partir del resumen que calcula la base de datos.
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Aviso de las 9:30: quién no ha fichado la entrada, por obra.
//  - Obra con actividad (fichó al menos uno): se listan los que faltan.
//  - Obra donde NO ha fichado nadie (festivo local, parada...): una sola línea, sin listar uno a uno.
//  - Ausentes (vacaciones, baja, permiso): no cuentan; solo se indica quiénes son.
const d = $input.first().json;
const lista   = d.sin_entrada || [];
const paradas = d.obras_sin_actividad || [];
const aus     = d.ausentes || [];
const TIPO = { vacaciones:'vacaciones', baja:'baja', permiso:'permiso', otro:'otro' };
const bloqueAus = aus.length
  ? `\n🏖 Ausentes hoy (no cuentan): ${aus.length}\n` + aus.map(a => `• ${a.nombre} — ${TIPO[a.tipo] || a.tipo} hasta el ${a.hasta}`).join('\n') + '\n'
  : '';
if (!lista.length && !paradas.length)
  return [{ json: { texto: `✅ ${d.fecha}: todos han fichado la entrada (${d.total}).\n` + bloqueAus } }];

let t = `⏰ SIN FICHAR LA ENTRADA — ${d.fecha} 9:30\n`;
if (lista.length) {
  t += `${lista.length} sin fichar en obras con actividad (de ${d.total} esperados)\n`;
  const porObra = {};
  for (const p of lista) (porObra[p.obra] ||= []).push(p.nombre);
  for (const [obra, nombres] of Object.entries(porObra))
    t += `\n📍 ${obra} (${nombres.length})\n` + nombres.map(x => `• ${x}`).join('\n') + '\n';
}
if (paradas.length) {
  t += `\n🚧 OBRAS SIN NINGÚN FICHAJE (${paradas.length}) — ¿festivo o parada?\n`;
  t += paradas.map(o => o.total <= 2 ? `• ${o.obra} — ${o.nombres.join(', ')}` : `• ${o.obra} — ${o.total} personas`).join('\n') + '\n';
  t += `Si hoy se trabaja allí, llama a la obra.\n`;
}
t += bloqueAus;
return [{ json: { texto: t.slice(0, 4000) } }];
