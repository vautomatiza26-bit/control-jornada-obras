-- =====================================================================
-- 01 · Esquema y seguridad (versión didáctica y simplificada)
-- Idea: la app pública NO accede a las tablas. Todo pasa por funciones RPC.
-- Por eso: RLS activado en todo, sin permisos para `anon`, y funciones `security definer`.
-- =====================================================================

-- Núcleo (simplificado): trabajadores y fichajes
create table if not exists public.operarios (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  iniciales        text not null,
  activo           boolean not null default true,
  tipo             text not null default 'operario',
  categoria        text default 'Oficial',
  obra_actual_id   uuid,
  pin              text,                          -- bcrypt (crypt/gen_salt), nunca en claro
  jibble_person_id uuid unique,                   -- enlace con el sistema de registro horario
  creado_en        timestamptz not null default now()
);

create table if not exists public.fichajes (
  id            uuid primary key default gen_random_uuid(),   -- lo genera el MÓVIL: permite reintentos sin duplicar
  operario_id   uuid not null references public.operarios(id),
  tipo          text not null check (tipo in ('entrada','pausa_inicio','pausa_fin','salida')),
  hora          timestamptz not null default clock_timestamp(),   -- hora del servidor (salvo fichajes sin conexión)
  fecha         date not null default (now() at time zone 'Europe/Madrid')::date,
  latitud       double precision, longitud double precision, precision_m real,
  dispositivo   text,
  sin_conexion  boolean not null default false,
  jibble_estado text not null default 'pendiente',            -- pendiente | enviado | error
  jibble_intentos int not null default 0,
  jibble_error  text,
  creado_en     timestamptz not null default now()
);

-- Registro INMUTABLE (ejemplo ilustrativo): no se borra y no se cambian los datos esenciales.
-- Los campos de sincronización (jibble_*) sí pueden actualizarse.
create or replace function public.fichajes_inmutables() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Los fichajes no se pueden borrar'; end if;
  if new.operario_id is distinct from old.operario_id or new.tipo is distinct from old.tipo
     or new.hora is distinct from old.hora or new.fecha is distinct from old.fecha then
    raise exception 'Los datos esenciales de un fichaje no se pueden modificar';
  end if;
  return new;
end $$;
create trigger fichajes_inmutables before update or delete on public.fichajes
  for each row execute function public.fichajes_inmutables();

-- Llaves de "móvil de confianza": solo se guarda el HASH; un móvil = una persona
create table if not exists public.dispositivos_confianza (
  id uuid primary key default gen_random_uuid(),
  operario_id uuid not null references public.operarios(id) on delete cascade,
  llave_hash text not null unique,
  dispositivo text,
  creado_en timestamptz not null default now(),
  ultimo_uso timestamptz,
  revocado_en timestamptz
);

-- Enlaces de activación: un solo uso, caducan a los 7 días, solo se guarda el hash del código
create table if not exists public.enlaces_activacion (
  id uuid primary key default gen_random_uuid(),
  operario_id uuid not null references public.operarios(id) on delete cascade,
  codigo_hash text not null unique,
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null default now() + interval '7 days',
  usado_en timestamptz,
  anulado_en timestamptz
);

-- Fichajes sin conexión que el servidor no pudo aceptar: quedan para revisión humana
create table if not exists public.fichajes_rechazados (
  id uuid primary key, operario_id uuid references public.operarios(id) on delete cascade,
  tipo text, hora_movil timestamptz, motivo text, latitud double precision, longitud double precision,
  recibido_en timestamptz not null default now()
);

-- Datos personales sensibles APARTE: ningún rol de cliente puede leerlos (solo el rol de servicio de n8n)
create table if not exists public.operarios_privado (
  operario_id uuid primary key references public.operarios(id) on delete cascade,
  dni text not null unique,
  telefono text,
  jibble_creando_desde timestamptz,        -- candado anti-duplicados (ver 04)
  creado_en timestamptz not null default now()
);

-- Constancia de que cada trabajador leyó el aviso informativo (versionado)
create table if not exists public.aviso_aceptaciones (
  operario_id uuid not null references public.operarios(id) on delete cascade,
  version int not null,
  aceptado_en timestamptz not null default now(),
  hora_movil timestamptz, dispositivo text,
  primary key (operario_id, version)
);

create table if not exists public.ausencias (
  id uuid primary key default gen_random_uuid(),
  operario_id uuid not null references public.operarios(id) on delete cascade,
  tipo text not null check (tipo in ('vacaciones','baja','permiso','otro')),
  desde date not null, hasta date not null, nota text,
  creado_en timestamptz not null default now(),
  check (hasta >= desde)
);

-- RLS en todo. Sin políticas para `anon`: la app solo llama a funciones.
alter table public.operarios              enable row level security;
alter table public.fichajes               enable row level security;
alter table public.dispositivos_confianza enable row level security;
alter table public.enlaces_activacion     enable row level security;
alter table public.fichajes_rechazados    enable row level security;
alter table public.operarios_privado      enable row level security;
alter table public.aviso_aceptaciones     enable row level security;
alter table public.ausencias              enable row level security;

revoke all on public.fichajes, public.dispositivos_confianza, public.enlaces_activacion,
              public.fichajes_rechazados, public.aviso_aceptaciones, public.ausencias from anon;
revoke all on public.operarios_privado from anon, authenticated;    -- ni siquiera el panel admin

-- El panel de administración (usuario autenticado) gestiona lo que le toca
create policy "admin gestiona ausencias"  on public.ausencias              for all    to authenticated using (true) with check (true);
create policy "admin gestiona enlaces"    on public.enlaces_activacion     for all    to authenticated using (true) with check (true);
create policy "admin gestiona dispositivos" on public.dispositivos_confianza for all  to authenticated using (true) with check (true);
create policy "admin lee aceptaciones"    on public.aviso_aceptaciones     for select to authenticated using (true);
