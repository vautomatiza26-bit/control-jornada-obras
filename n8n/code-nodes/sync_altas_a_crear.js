// Nodo Code de n8n · Decide a quién hay que crear en el sistema externo: solo lo que la base de datos ha reservado para ESTA ejecución.
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Personas que este ciclo debe CREAR en Jibble: solo las que la base de datos ha reservado para esta ejecución.
const cr  = $('Cruzar con Jibble').first().json;
const res = $input.first().json;                 // { reservados: [...], en_curso: [...] }
const nombres = new Map(cr.faltan.map(f => [f.operario_id, f.nombre]));
const items = (res.reservados || []).map(id => ({ json: { crear: true, operario_id: id, nombre: nombres.get(id) } }));
return items.length ? items : [{ json: { crear: false } }];
