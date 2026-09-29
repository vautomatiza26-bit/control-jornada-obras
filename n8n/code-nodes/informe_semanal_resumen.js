// Nodo Code de n8n · Resumen corto para el chat; el detalle va en Excel.
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Resumen corto para Telegram. El detalle va en el Excel.
const d = $input.first().json;
const n = (x) => Number(x).toLocaleString('es-ES', { maximumFractionDigits: 1 });
const trab = d.trabajadores || [], obras = d.obras || [];
const conFichajes = trab.filter(t => Number(t.horas_fichadas) > 0).length;
const hFich = trab.reduce((s, t) => s + Number(t.horas_fichadas), 0);
const hPart = obras.reduce((s, o) => s + Number(o.horas), 0);
const hVal  = obras.reduce((s, o) => s + Number(o.horas_validadas), 0);
const sinCerrar = trab.reduce((s, t) => s + Number(t.sin_cerrar), 0);

let t = `📊 INFORME SEMANAL — ${d.desde} al ${d.hasta}\n\n`;
t += `⏱ Horas fichadas: ${n(hFich)} h (${conFichajes} trabajadores)\n`;
t += `📋 Horas en partes: ${n(hPart)} h · validadas: ${n(hVal)} h\n`;
if (obras.length) {
  t += `\n🏗 Por obra (según partes):\n`;
  t += obras.map(o => `• ${o.obra}: ${n(o.horas)} h (${o.trabajadores} trab.)`).join('\n') + '\n';
}
if (sinCerrar) t += `\n⚠️ ${sinCerrar} jornada(s) sin cerrar: sus horas no están contadas.\n`;
t += `\n📧 El Excel con el detalle se ha enviado por email.`;
return [{ json: { texto: t.slice(0, 4000) } }];
