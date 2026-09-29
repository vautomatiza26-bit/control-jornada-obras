-- =====================================================================
-- 02 · Identidad sin cuentas: PIN -> "móvil de confianza" -> enlace de activación
--  · El móvil guarda una llave aleatoria de 256 bits; en la base solo se guarda su hash SHA-256.
--  · Un móvil recuerda a UNA persona, así que nadie tiene guardados a varios compañeros.
--  · Sin PIN, el móvil se activa con un enlace personal de un solo uso.
-- (La función _comprobar_pin_trabajador -bcrypt, bloqueo tras 5 fallos- se omite por brevedad.)
-- =====================================================================

-- Comprueba la credencial: la llave del móvil o, si no hay, el PIN.
create or replace function public._comprobar_credencial(p_operario uuid, p_pin text, p_llave text)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if p_llave is not null and p_llave <> '' then
    select id into v_id from dispositivos_confianza
     where operario_id = p_operario and revocado_en is null
       and llave_hash = encode(digest(p_llave, 'sha256'), 'hex');
    if v_id is null then return 'llave_invalida'; end if;
    if not exists (select 1 from operarios where id = p_operario and activo and tipo = 'operario') then
      return 'no_autorizado';               -- una baja anula el acceso aunque el móvil siga activado
    end if;
    update dispositivos_confianza set ultimo_uso = now() where id = v_id;
    return 'ok';
  end if;
  return public._comprobar_pin_trabajador(p_operario, p_pin);
end $$;

-- Registrar este móvil (exige el PIN). Devuelve la llave UNA vez; en la base solo queda su hash.
create or replace function public.recordar_movil(p_operario uuid, p_pin text, p_dispositivo text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_res text; v_llave text;
begin
  v_res := public._comprobar_pin_trabajador(p_operario, p_pin);
  if v_res <> 'ok' then return json_build_object('resultado', v_res); end if;
  v_llave := encode(gen_random_bytes(32), 'hex');   -- 256 bits: imposible de adivinar
  insert into dispositivos_confianza (operario_id, llave_hash, dispositivo)
  values (p_operario, encode(digest(v_llave, 'sha256'), 'hex'), left(p_dispositivo, 200));
  return json_build_object('resultado', 'ok', 'llave', v_llave);
end $$;

-- Admin: crear enlace (anula los anteriores sin usar). Devuelve el código UNA vez.
create or replace function public.crear_enlace_activacion(p_operario uuid)
returns text language plpgsql security definer set search_path = public, extensions as $$
declare v_codigo text;
begin
  if auth.uid() is null then raise exception 'No autorizado'; end if;
  if not exists (select 1 from operarios where id = p_operario and activo and tipo = 'operario') then
    raise exception 'Solo se pueden crear enlaces para trabajadores activos';
  end if;
  update enlaces_activacion set anulado_en = now()
   where operario_id = p_operario and usado_en is null and anulado_en is null;
  v_codigo := encode(gen_random_bytes(24), 'hex');
  insert into enlaces_activacion (operario_id, codigo_hash) values (p_operario, encode(digest(v_codigo, 'sha256'), 'hex'));
  return v_codigo;
end $$;

-- App: activar el móvil con el código del enlace. Un solo uso.
create or replace function public.activar_movil(p_codigo text, p_dispositivo text default null)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare e record; v_llave text; v_nombre text;
begin
  select * into e from enlaces_activacion
   where codigo_hash = encode(digest(coalesce(p_codigo,''), 'sha256'), 'hex') for update;   -- bloquea la fila: dos aperturas a la vez no pasan las dos
  if not found then return json_build_object('resultado','no_existe'); end if;
  if e.usado_en is not null then return json_build_object('resultado','ya_usado'); end if;
  if e.anulado_en is not null then return json_build_object('resultado','anulado'); end if;
  if e.expira_en < now() then return json_build_object('resultado','caducado'); end if;
  select nombre into v_nombre from operarios where id = e.operario_id and activo and tipo = 'operario';
  if v_nombre is null then return json_build_object('resultado','no_autorizado'); end if;

  update enlaces_activacion set usado_en = now() where id = e.id;
  v_llave := encode(gen_random_bytes(32), 'hex');
  insert into dispositivos_confianza (operario_id, llave_hash, dispositivo)
  values (e.operario_id, encode(digest(v_llave, 'sha256'), 'hex'), left(p_dispositivo, 200));
  return json_build_object('resultado','ok','operario_id',e.operario_id,'nombre',v_nombre,'llave',v_llave);
end $$;

-- Permisos: solo lo que la app necesita, y solo a quien corresponde
revoke execute on function public._comprobar_credencial(uuid,text,text) from public, anon, authenticated;
revoke execute on function public.recordar_movil(uuid,text,text)  from public;
revoke execute on function public.crear_enlace_activacion(uuid)   from public, anon;
revoke execute on function public.activar_movil(text,text)        from public;
grant  execute on function public.recordar_movil(uuid,text,text)  to anon, authenticated;
grant  execute on function public.crear_enlace_activacion(uuid)   to authenticated;
grant  execute on function public.activar_movil(text,text)        to anon, authenticated;
