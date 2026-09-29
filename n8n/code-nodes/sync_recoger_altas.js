// Nodo Code de n8n · Junta los emparejados con los recién creados y separa lo que queda para hacer a mano.
// (Extracto: lee datos de nodos anteriores con $('Nombre del nodo'); no se ejecuta fuera de n8n.)

// Junta las personas emparejadas con las recién creadas en Jibble.
const cr  = $('Cruzar con Jibble').first().json;
const res = $('Reservar altas').first().json;
const previstos = $('Altas a crear').all().map(i => i.json).filter(x => x.crear);
const pares = [...cr.p_pares], creados = [], errores = [];
if (previstos.length) {
  const resp = $input.all();                     // una respuesta de Jibble por cada persona, en el mismo orden
  previstos.forEach((p, i) => {
    const r = resp[i] ? resp[i].json : {};
    const b = r.body !== undefined ? r.body : r;
    if ((r.statusCode === 201 || r.statusCode === 200) && b && b.id) {
      pares.push({ operario_id: p.operario_id, jibble_person_id: b.id, nombre: p.nombre });
      creados.push(p.nombre);
    } else errores.push(`${p.nombre} (código ${r.statusCode ?? 'sin respuesta'})`);
  });
}
const reservados = new Set(res.reservados || []), enCurso = new Set(res.en_curso || []);
// A mano solo queda lo que NO se puede crear solo (p. ej. si no se pudo leer Jibble o no viene de la hoja)
const faltanManual = cr.faltan.filter(f => !reservados.has(f.operario_id) && !enCurso.has(f.operario_id)).map(f => f.nombre);
return [{ json: {
  p_pares: pares, creados, errores_jibble: errores, faltan: cr.simulacion ? [] : faltanManual,
  sim_crear: cr.simulacion ? cr.faltan.map(f => f.nombre) : [],
  ambiguos_jibble: cr.ambiguos_jibble, jibbleOk: cr.jibbleOk, simulacion: cr.simulacion } }];
