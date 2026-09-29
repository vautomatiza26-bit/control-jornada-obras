-- =====================================================================
-- 03 · Fichar, con reintentos seguros y fichajes sin conexión
--  · p_id lo genera el móvil: si reintenta, la base lo reconoce y NO duplica (idempotencia).
--  · Un fichaje que trae p_hora_movil viene de la cola sin conexión: se guarda con esa hora, marcado
--    `sin_conexion`, con límites (no en el futuro, no más de 48 h atrás). Lo que no se acepta queda en
--    `fichajes_rechazados` para revisión humana.
--  · Se valida la SECUENCIA (entrada -> pausa -> fin de pausa -> salida).
-- (La función _estado_trabajador, que calcula fuera/trabajando/en_pausa, se omite por brevedad.)
-- =====================================================================
create or replace function public.fichar(
  p_operario uuid, p_tipo text, p_pin text default null, p_llave text default null,
  p_lat double precision default null, p_lng double precision default null,
  p_precision real default null, p_dispositivo text default null,
  p_id uuid default null, p_hora_movil timestamptz default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_res text; v_estado text; v_permitidos text[]; v_id uuid; v_hora timestamptz; v_sin_conexion boolean;
begin
  v_res := public._comprobar_credencial(p_operario, p_pin, p_llave);
  if v_res <> 'ok' then return json_build_object('resultado', v_res); end if;

  -- Reintento de un fichaje que ya llegó: no se duplica, se responde "ok"
  if p_id is not null then
    select id, hora into v_id, v_hora from fichajes where id = p_id and operario_id = p_operario;
    if v_id is not null then
      return json_build_object('resultado','ok','id',v_id,'hora',v_hora,'tipo',p_tipo,'repetido',true);
    end if;
  end if;

  v_sin_conexion := p_hora_movil is not null;       -- lo decide el ORIGEN del fichaje, no un umbral de tiempo
  if v_sin_conexion then
    if p_hora_movil > now() + interval '2 minutes' or p_hora_movil < now() - interval '48 hours' then
      insert into fichajes_rechazados (id, operario_id, tipo, hora_movil, motivo, latitud, longitud)
      values (coalesce(p_id, gen_random_uuid()), p_operario, p_tipo, p_hora_movil, 'hora_fuera_de_plazo', p_lat, p_lng)
      on conflict (id) do nothing;
      return json_build_object('resultado','hora_fuera_de_plazo');
    end if;
  end if;

  select estado into v_estado from public._estado_trabajador(p_operario);
  v_permitidos := case v_estado
    when 'fuera'      then array['entrada']
    when 'trabajando' then array['pausa_inicio','salida']
    when 'en_pausa'   then array['pausa_fin'] end;
  if not (p_tipo = any(v_permitidos)) then
    if v_sin_conexion then
      insert into fichajes_rechazados (id, operario_id, tipo, hora_movil, motivo, latitud, longitud)
      values (coalesce(p_id, gen_random_uuid()), p_operario, p_tipo, p_hora_movil, 'paso_no_valido (estado: '||v_estado||')', p_lat, p_lng)
      on conflict (id) do nothing;
    end if;
    return json_build_object('resultado','paso_no_valido','estado',v_estado);
  end if;

  if p_lat is null or p_lng is null or abs(p_lat) > 90 or abs(p_lng) > 180 then
    p_lat := null; p_lng := null; p_precision := null;     -- ubicación opcional: si es inválida, se ficha sin ella
  end if;

  -- hora del móvil, sin permitir que quede en el futuro respecto al servidor
  v_hora := case when v_sin_conexion then least(p_hora_movil, clock_timestamp()) else clock_timestamp() end;
  insert into fichajes (id, operario_id, tipo, hora, fecha, latitud, longitud, precision_m, dispositivo, sin_conexion)
  values (coalesce(p_id, gen_random_uuid()), p_operario, p_tipo, v_hora,
          (v_hora at time zone 'Europe/Madrid')::date, p_lat, p_lng, p_precision, left(p_dispositivo, 200), v_sin_conexion)
  returning id, hora into v_id, v_hora;
  return json_build_object('resultado','ok','id',v_id,'hora',v_hora,'tipo',p_tipo,'sin_conexion',v_sin_conexion);
end $$;
revoke execute on function public.fichar(uuid,text,text,text,double precision,double precision,real,text,uuid,timestamptz) from public;
grant  execute on function public.fichar(uuid,text,text,text,double precision,double precision,real,text,uuid,timestamptz) to anon, authenticated;

-- Aviso informativo: constancia de lectura (la primera aceptación es la que vale)
create or replace function public.aceptar_aviso(
  p_operario uuid, p_version int, p_pin text default null, p_llave text default null,
  p_dispositivo text default null, p_hora_movil timestamptz default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_res text;
begin
  v_res := public._comprobar_credencial(p_operario, p_pin, p_llave);
  if v_res <> 'ok' then return json_build_object('resultado', v_res); end if;
  insert into aviso_aceptaciones (operario_id, version, hora_movil, dispositivo)
  values (p_operario, p_version,
          case when p_hora_movil between now() - interval '30 days' and now() + interval '2 minutes' then p_hora_movil end,
          left(p_dispositivo, 200))
  on conflict (operario_id, version) do nothing;
  return json_build_object('resultado', 'ok');
end $$;
revoke execute on function public.aceptar_aviso(uuid,int,text,text,text,timestamptz) from public;
grant  execute on function public.aceptar_aviso(uuid,int,text,text,text,timestamptz) to anon, authenticated;
