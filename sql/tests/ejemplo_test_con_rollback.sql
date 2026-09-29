-- =====================================================================
-- Patrón de prueba: escenarios reales, resultado legible y MARCHA ATRÁS de todo.
-- El bloque termina con una excepción: el mensaje trae el resultado y la base queda intacta.
-- Se puede ejecutar contra datos reales sin ensuciarlos. (Ejemplo: seguridad del móvil de confianza.)
-- =====================================================================
do $$
declare r text := E'\n'; v_a uuid; v_b uuid; v_llave text; j json;
begin
  select id into v_a from operarios where activo and tipo = 'operario' order by nombre limit 1;
  select id into v_b from operarios where activo and tipo = 'operario' and id <> v_a order by nombre limit 1;
  update operarios set pin = crypt('4321', gen_salt('bf', 10)) where id in (v_a, v_b);

  set local role anon;                                        -- ¡Se prueba con el rol público REAL!
  r := r||'1 recordar móvil con PIN malo: '||(recordar_movil(v_a,'0000')->>'resultado')||E'\n';        -- esperado: incorrecto
  v_llave := recordar_movil(v_a,'4321','test')->>'llave';
  r := r||'2 llave de '||length(v_llave)||' caracteres (esperado 64)'||E'\n';
  r := r||'3 estado con la llave, sin PIN: '||(estado_fichaje(v_a,null,v_llave)->>'resultado')||E'\n';  -- esperado: ok
  r := r||'4 usar SU llave para fichar a OTRO: '||(fichar(v_b,'entrada',null,v_llave)->>'resultado')||E'\n'; -- esperado: llave_invalida
  r := r||'5 llave inventada: '||(estado_fichaje(v_a,null,'abc123')->>'resultado')||E'\n';
  begin perform * from dispositivos_confianza; r := r||'6 anon lee las llaves: PERMITIDO (MAL)'||E'\n';
  exception when others then r := r||'6 anon lee las llaves: bloqueado (OK)'||E'\n'; end;
  reset role;

  -- Idempotencia: el mismo id enviado dos veces no duplica
  set local role anon;
  j := fichar(v_a,'entrada',null,v_llave,null,null,null,'t','11111111-1111-1111-1111-111111111111', now() - interval '45 seconds');
  j := fichar(v_a,'entrada',null,v_llave,null,null,null,'t','11111111-1111-1111-1111-111111111111', now() - interval '45 seconds');
  reset role;
  r := r||'7 mismo fichaje enviado dos veces -> filas: '||(select count(*) from fichajes where id = '11111111-1111-1111-1111-111111111111')||' (esperado 1)'||E'\n';

  raise exception 'RESULTADOS (todo deshecho): %', r;      -- <- aquí se deshace todo
end $$;
