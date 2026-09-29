// Nodo Code de n8n · Empareja los trabajadores sin perfil externo con las personas activas del sistema de registro horario.
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Empareja los trabajadores de la app que aún NO tienen perfil de Jibble con las personas ACTIVAS de Jibble.
const res = $('Sincronizar app').first().json;
if (res.error) throw new Error('La sincronización devolvió: ' + res.error);
let simulacion = false;
try { $('Simulación (a mano)').first(); simulacion = true; } catch (e) { simulacion = false; }

let personas = [], jibbleOk = true;
for (const it of $input.all()) {
  if (it.json && Array.isArray(it.json.value)) personas = personas.concat(it.json.value);
  else if (it.json && it.json.error) jibbleOk = false;      // Jibble falló: no se vincula nada, se avisa aparte
}
if (!personas.length) jibbleOk = false;

const palabras = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
const incl = (a, b) => a.every(w => b.includes(w));
const coinciden = (a, b) => a.length >= 2 && b.length >= 2 && (incl(a, b) || incl(b, a));

const activas = personas.filter(p => !p.removedAt).map(p => ({ id: p.id, nombre: p.fullName, w: palabras(p.fullName) }));
const pares = [], faltan = [], ambiguos = [], usadas = new Set();
for (const t of (res.nuevos_sin_jibble || [])) {
  if (!jibbleOk) { faltan.push({ operario_id: t.id, nombre: t.nombre }); continue; }
  const w = palabras(t.nombre);
  const cand = activas.filter(p => !usadas.has(p.id) && coinciden(w, p.w));
  if (cand.length === 1) { pares.push({ operario_id: t.id, jibble_person_id: cand[0].id, nombre: t.nombre }); usadas.add(cand[0].id); }
  else if (cand.length > 1) ambiguos.push(t.nombre);
  else faltan.push({ operario_id: t.id, nombre: t.nombre });
}
// Solo se crea en Jibble si se pudo LEER Jibble (si no, se podrían crear duplicados) y no es simulación
return [{ json: { p_pares: pares, faltan, ambiguos_jibble: ambiguos, jibbleOk, simulacion, crear_permitido: jibbleOk && !simulacion } }];
