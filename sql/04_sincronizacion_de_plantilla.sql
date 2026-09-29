-- =====================================================================
-- 04 · Sincronizar la plantilla desde una hoja maestra (reconciliación idempotente)
--  La hoja manda y la app se deja igual. Nunca se borra: solo se desactiva.
--  Salvaguardas: modo SIMULACIÓN (p_aplicar=false), límite de bajas/altas por ejecución y
--  emparejamiento por DNI o, si no hay, por nombre normalizado SOLO si el candidato es único.
-- =====================================================================

-- Palabras de un nombre sin tildes, mayúsculas ni orden: "PÉREZ Gil, Ana" = "ana gil perez"
create or replace function public._palabras(p text) returns text[] language sql immutable as $$
  select coalesce(array_agg(w order by w), '{}'::text[]) from (
    select w from unnest(regexp_split_to_array(trim(regexp_replace(
      translate(lower(coalesce(p,'')), 'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
      '[^a-z ]', ' ', 'g')), '\s+')) as w
    where length(w) > 1) s;
$$;

create or replace function public.sincronizar_plantilla(
  p_lista jsonb, p_aplicar boolean default false, p_max_bajas int default 3, p_max_altas int default 5)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  h jsonb; x jsonb; v_dni text; v_nom text; v_tel text; v_baja boolean; v_pal text[];
  v_id uuid; v_cand uuid[]; v_activo boolean; v_nombre_app text; v_vincular boolean; v_nuevo uuid; v_w text[];
  a_crear jsonb := '[]'; a_desact jsonb := '[]'; a_reactiv jsonb := '[]'; a_vincular jsonb := '[]'; a_ambig jsonb := '[]';
  tocados uuid[] := '{}'; v_bloqueo text := null; v_solo jsonb; v_sin_jibble jsonb;
begin
  if p_lista is null or jsonb_typeof(p_lista) <> 'array' or jsonb_array_length(p_lista) = 0 then
    return jsonb_build_object('error', 'lista_vacia');
  end if;

  -- FASE 1: planificar (no cambia nada)
  for h in select value from jsonb_array_elements(p_lista) loop
    v_dni := upper(regexp_replace(coalesce(h->>'dni',''), '[^A-Za-z0-9]', '', 'g'));
    v_nom := trim(coalesce(h->>'nombre',''));
    v_tel := nullif(trim(coalesce(h->>'telefono','')), '');
    v_baja := coalesce((h->>'baja')::boolean, false);
    if v_dni = '' or v_nom = '' then continue; end if;

    v_id := null; v_vincular := false;
    select operario_id into v_id from operarios_privado where dni = v_dni;       -- 1º por DNI
    if v_id is null then                                                          -- 2º por nombre (candidato único)
      v_pal := _palabras(v_nom); v_cand := '{}';
      if cardinality(v_pal) >= 2 then
        select coalesce(array_agg(o.id), '{}') into v_cand from operarios o
         where o.tipo = 'operario'
           and not exists (select 1 from operarios_privado p where p.operario_id = o.id)
           and cardinality(_palabras(o.nombre)) >= 2
           and (_palabras(o.nombre) <@ v_pal or v_pal <@ _palabras(o.nombre));
      end if;
      if cardinality(v_cand) > 1 then a_ambig := a_ambig || to_jsonb(v_nom); continue;
      elsif cardinality(v_cand) = 1 then v_id := v_cand[1]; v_vincular := true; end if;
    end if;

    if v_id is not null then
      if v_id = any(tocados) then a_ambig := a_ambig || to_jsonb(v_nom); continue; end if;
      tocados := tocados || v_id;
      select activo, nombre into v_activo, v_nombre_app from operarios where id = v_id;
      if v_vincular then a_vincular := a_vincular || jsonb_build_array(jsonb_build_object('id', v_id, 'dni', v_dni, 'tel', v_tel, 'nombre', v_nombre_app)); end if;
      if v_baja and v_activo then
        a_desact := a_desact || jsonb_build_array(jsonb_build_object('id', v_id, 'nombre', v_nombre_app));
      elsif not v_baja and not v_activo then
        a_reactiv := a_reactiv || jsonb_build_array(jsonb_build_object('id', v_id, 'nombre', v_nombre_app));
      end if;
    elsif not v_baja then
      a_crear := a_crear || jsonb_build_array(jsonb_build_object('nombre', v_nom, 'dni', v_dni, 'tel', v_tel));
    end if;
  end loop;

  -- Salvaguardas: si la hoja tuviera un fallo, no se desmonta la plantilla de golpe
  if jsonb_array_length(a_desact) > p_max_bajas then v_bloqueo := 'demasiadas_bajas';
  elsif jsonb_array_length(a_crear) + jsonb_array_length(a_reactiv) > p_max_altas then v_bloqueo := 'demasiadas_altas'; end if;

  -- Activos en la app que no están en la hoja: solo informativo (no se tocan)
  select coalesce(jsonb_agg(nombre order by nombre), '[]') into v_solo
    from operarios where tipo = 'operario' and activo and not (id = any(tocados));

  -- FASE 2: aplicar
  if p_aplicar and v_bloqueo is null then
    for x in select value from jsonb_array_elements(a_vincular) loop
      insert into operarios_privado (operario_id, dni, telefono) values ((x->>'id')::uuid, x->>'dni', x->>'tel') on conflict do nothing;
    end loop;
    for x in select value from jsonb_array_elements(a_crear) loop
      v_w := regexp_split_to_array(initcap(lower(trim(x->>'nombre'))), '\s+');
      insert into operarios (nombre, iniciales, tipo, activo)
      values (array_to_string(v_w, ' '),
              case when cardinality(v_w) >= 2 then upper(left(v_w[1],1) || left(v_w[2],1)) else upper(left(v_w[1],2)) end,
              'operario', true)
      returning id into v_nuevo;
      insert into operarios_privado (operario_id, dni, telefono) values (v_nuevo, x->>'dni', x->>'tel') on conflict do nothing;
    end loop;
    for x in select value from jsonb_array_elements(a_desact) loop
      update operarios set activo = false where id = (x->>'id')::uuid;
      update dispositivos_confianza set revocado_en = now() where operario_id = (x->>'id')::uuid and revocado_en is null;
      update enlaces_activacion set anulado_en = now() where operario_id = (x->>'id')::uuid and usado_en is null and anulado_en is null;
    end loop;
    for x in select value from jsonb_array_elements(a_reactiv) loop
      update operarios set activo = true where id = (x->>'id')::uuid;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre), '[]') into v_sin_jibble
    from operarios where tipo = 'operario' and activo and jibble_person_id is null;

  return jsonb_build_object(
    'aplicado', (p_aplicar and v_bloqueo is null), 'bloqueo', v_bloqueo, 'total_hoja', jsonb_array_length(p_lista),
    'crear',        jsonb_path_query_array(a_crear,    '$[*].nombre'),
    'desactivar',   jsonb_path_query_array(a_desact,   '$[*].nombre'),
    'reactivar',    jsonb_path_query_array(a_reactiv,  '$[*].nombre'),
    'vincular_dni', jsonb_path_query_array(a_vincular, '$[*].nombre'),   -- solo nombres: el DNI nunca sale en los avisos
    'ambiguos', a_ambig, 'solo_en_app', v_solo, 'nuevos_sin_jibble', v_sin_jibble);
end $$;

-- Candado anti-duplicados: solo UNA ejecución puede crear a la persona en el sistema externo (reserva de 30 min).
-- El UPDATE bloquea la fila: si dos ejecuciones llegan a la vez, la segunda no cumple el WHERE y ve "en curso".
create or replace function public.reservar_creacion_jibble(p_ids jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x text; v_res jsonb := '[]'; v_curso jsonb := '[]'; n int;
begin
  if p_ids is null or jsonb_typeof(p_ids) <> 'array' then
    return jsonb_build_object('reservados', '[]'::jsonb, 'en_curso', '[]'::jsonb);
  end if;
  for x in select jsonb_array_elements_text(p_ids) loop
    update operarios_privado p set jibble_creando_desde = now()
      from operarios o
     where o.id = p.operario_id and p.operario_id = x::uuid
       and o.activo and o.tipo = 'operario' and o.jibble_person_id is null
       and (p.jibble_creando_desde is null or p.jibble_creando_desde < now() - interval '30 minutes');
    get diagnostics n = row_count;
    if n = 1 then v_res := v_res || to_jsonb(x);
    elsif exists (select 1 from operarios_privado where operario_id = x::uuid and jibble_creando_desde >= now() - interval '30 minutes')
      then v_curso := v_curso || to_jsonb(x);
    end if;
  end loop;
  return jsonb_build_object('reservados', v_res, 'en_curso', v_curso);
end $$;

-- Tras crear/encontrar a la persona en el sistema externo: enlazarla y reintentar sus fichajes en espera
create or replace function public.vincular_jibble_lote(p_pares jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare x jsonb; n int; v_ok int := 0; v_fallos jsonb := '[]';
begin
  if p_pares is null or jsonb_typeof(p_pares) <> 'array' then return jsonb_build_object('vinculados', 0); end if;
  for x in select value from jsonb_array_elements(p_pares) loop
    begin
      update operarios set jibble_person_id = (x->>'jibble_person_id')::uuid
       where id = (x->>'operario_id')::uuid and jibble_person_id is null;
      get diagnostics n = row_count;
      if n = 1 then
        v_ok := v_ok + 1;
        update fichajes set jibble_estado = 'pendiente', jibble_intentos = 0, jibble_error = null
         where operario_id = (x->>'operario_id')::uuid and jibble_estado in ('pendiente','error');
      end if;
    exception when others then
      v_fallos := v_fallos || to_jsonb(coalesce(x->>'operario_id','?'));
    end;
  end loop;
  return jsonb_build_object('vinculados', v_ok, 'fallos', v_fallos);
end $$;

-- Solo el rol de servicio (n8n) puede llamarlas
revoke execute on function public.sincronizar_plantilla(jsonb,boolean,int,int) from public, anon, authenticated;
revoke execute on function public.reservar_creacion_jibble(jsonb)              from public, anon, authenticated;
revoke execute on function public.vincular_jibble_lote(jsonb)                  from public, anon, authenticated;
grant  execute on function public.sincronizar_plantilla(jsonb,boolean,int,int) to service_role;
grant  execute on function public.reservar_creacion_jibble(jsonb)              to service_role;
grant  execute on function public.vincular_jibble_lote(jsonb)                  to service_role;
