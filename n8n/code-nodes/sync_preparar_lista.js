// Nodo Code de n8n · Convierte la hoja (una fila por DOCUMENTO) en una lista de personas (una por DNI). Detecta el modo simulación.
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Una fila por trabajador (la hoja tiene una fila por DOCUMENTO de cada trabajador).
// Regla (la misma que usa el flujo de cruce): si ALGUNA fila de esa persona dice "Baja", es baja
// (el /baja del Flujo 4 marca todas sus filas; el /alta las vuelve a marcar todas como Alta).
let simulacion = false;
try { $('Simulación (a mano)').first(); simulacion = true; } catch (e) { simulacion = false; }

const valor = (r, col) => { const k = Object.keys(r).find(k => k.trim() === col); return k ? String(r[k] ?? '').trim() : ''; };
const porDni = new Map();
for (const it of $input.all()) {
  const r = it.json;
  const dni = valor(r, 'DNI').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nombre = valor(r, 'Nombre');
  if (!dni || !nombre) continue;
  const previo = porDni.get(dni) || { dni, nombre, telefono: '', baja: false };
  previo.baja = previo.baja || valor(r, 'Alta/Baja').toLowerCase() === 'baja';
  previo.telefono = previo.telefono || valor(r, 'Telefono');
  porDni.set(dni, previo);
}
const lista = [...porDni.values()];
if (!lista.length) throw new Error('La hoja maestra no ha devuelto ningún trabajador con DNI y nombre');
return [{ json: { p_lista: lista, p_aplicar: !simulacion } }];
