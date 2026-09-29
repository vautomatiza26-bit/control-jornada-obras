-- =====================================================================
-- 05 · Avisos e informes: la lógica vive en SQL, n8n solo orquesta y envía
-- =====================================================================

-- Aviso de las 9:30, por obra. Si en una obra NO ha fichado nadie (festivo local, parada...), se resume en
-- una línea en lugar de listar a cada persona. Con obras en varias comunidades un calendario de festivos no
-- sirve: lo decide lo que ocurre. Las ausencias (vacaciones, bajas...) descuentan a la persona.
create or replace function public.control_fichajes()
returns json language sql stable security definer set search_path = public as $$
  with hoy as (select (now() at time zone 'Europe/Madrid')::date as d),
  ausentes as (
    select distinct on (a.operario_id) a.operario_id, a.tipo, a.hasta
    from ausencias a, hoy where hoy.d between a.desde and a.hasta
    order by a.operario_id, a.hasta desc),
  plantilla as (
    select o.id, o.nombre, coalesce(ob.nombre, 'Sin obra asignada') as obra
    from operarios o left join obras ob on ob.id = o.obra_actual_id
    where o.activo and o.tipo = 'operario'),
  entradas as (select distinct f.operario_id from fichajes f, hoy where f.fecha = hoy.d and f.tipo = 'entrada'),
  ultimo as (
    select distinct on (operario_id) operario_id, tipo, hora from fichajes
    where hora > now() - interval '16 hours' order by operario_id, hora desc),
  esperadas as (select p.* from plantilla p where p.id not in (select operario_id from ausentes)),
  obras_paradas as (
    select obra from esperadas group by obra
    having count(*) filter (where id in (select operario_id from entradas)) = 0)
  select json_build_object(
    'fecha', (select to_char(d, 'DD/MM/YYYY') from hoy),
    'total', (select count(*) from esperadas),
    'sin_entrada', (select coalesce(json_agg(json_build_object('nombre', p.nombre, 'obra', p.obra) order by p.obra, p.nombre), '[]'::json)
                    from esperadas p where p.id not in (select operario_id from entradas)
                      and p.obra not in (select obra from obras_paradas)),
    'obras_sin_actividad', (select coalesce(json_agg(json_build_object('obra', x.obra, 'total', x.total, 'nombres', x.nombres) order by x.obra), '[]'::json)
                    from (select p.obra, count(*) as total, json_agg(p.nombre order by p.nombre) as nombres
                          from esperadas p where p.obra in (select obra from obras_paradas) group by p.obra) x),
    'ausentes', (select coalesce(json_agg(json_build_object('nombre', p.nombre, 'tipo', a.tipo, 'hasta', to_char(a.hasta,'DD/MM')) order by a.tipo, p.nombre), '[]'::json)
                 from plantilla p join ausentes a on a.operario_id = p.id),
    'abiertas', (select coalesce(json_agg(json_build_object(
                    'nombre', p.nombre, 'obra', p.obra,
                    'estado', case u.tipo when 'pausa_inicio' then 'en pausa' else 'trabajando' end,
                    'desde', to_char(u.hora at time zone 'Europe/Madrid', 'HH24:MI')) order by p.obra, p.nombre), '[]'::json)
                 from plantilla p join ultimo u on u.operario_id = p.id
                 where u.tipo in ('entrada', 'pausa_fin', 'pausa_inicio'))
  );
$$;
revoke execute on function public.control_fichajes() from public, anon, authenticated;
grant  execute on function public.control_fichajes() to service_role;

-- Informe de horas entre dos fechas. Las horas se calculan con una ventana (lead) sobre los fichajes:
-- cada tramo va de una entrada / fin de pausa a la siguiente pausa / salida. Una jornada sin cerrar no suma horas.
-- (Versión reducida a las horas fichadas; el informe real añade también las horas de los partes por obra.)
create or replace function public.informe_horas(p_desde date, p_hasta date)
returns json language sql stable security definer set search_path = public as $$
  with ev as (
    select f.operario_id, f.fecha, f.tipo, f.hora,
           lead(f.tipo) over w as sig_tipo, lead(f.hora) over w as sig_hora
    from fichajes f where f.fecha between p_desde and p_hasta
    window w as (partition by f.operario_id order by f.hora)),
  tramos as (
    select operario_id, fecha,
      case when sig_tipo in ('pausa_inicio','salida') and sig_hora - hora < interval '16 hours'
           then extract(epoch from sig_hora - hora) / 3600.0 end as horas,
      (sig_tipo is null or sig_tipo not in ('pausa_inicio','salida')) as abierto
    from ev where tipo in ('entrada','pausa_fin')),
  fich as (
    select operario_id, round(sum(coalesce(horas,0))::numeric, 2) as horas_fichadas,
           count(distinct fecha) as dias, count(*) filter (where abierto) as sin_cerrar
    from tramos group by operario_id)
  select json_build_object('desde', p_desde, 'hasta', p_hasta,
    'trabajadores', (select coalesce(json_agg(json_build_object(
        'nombre', o.nombre, 'dias', coalesce(f.dias,0), 'horas_fichadas', coalesce(f.horas_fichadas,0),
        'sin_cerrar', coalesce(f.sin_cerrar,0)) order by f.horas_fichadas desc nulls last), '[]'::json)
      from operarios o left join fich f on f.operario_id = o.id where o.tipo = 'operario' and (o.activo or f.operario_id is not null)));
$$;
revoke execute on function public.informe_horas(date,date) from public, anon, authenticated;
grant  execute on function public.informe_horas(date,date) to service_role;
