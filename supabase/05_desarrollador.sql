-- =====================================================================
-- El Desafío · rol desarrollador y ligas de testeo
-- Ejecutar UNA vez en Supabase → SQL Editor → Run. No borra datos.
-- =====================================================================

-- 1) Rol de cada organizador: 'organizador' (por defecto) o 'desarrollador'
alter table public.admins add column if not exists rol text not null default 'organizador';
alter table public.admins drop constraint if exists admins_rol_check;
alter table public.admins add constraint admins_rol_check check (rol in ('organizador', 'desarrollador'));

create or replace function public.es_dev() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and rol = 'desarrollador');
$$;
grant execute on function public.es_dev() to anon, authenticated;

-- 2) di.bahamondez@duocuc.cl queda como desarrollador (sigue siendo organizador)
insert into public.admins (user_id, rol)
select id, 'desarrollador' from auth.users where lower(email) = 'di.bahamondez@duocuc.cl'
on conflict (user_id) do update set rol = 'desarrollador';

-- 3) Las ligas de testeo guardan inscripciones, vínculos y reportes aparte (precon_test, b3_test)
do $$
declare r record;
begin
  for r in select conrelid::regclass as tabla, conname from pg_constraint
           where contype = 'c' and conrelid in ('public.vinculos'::regclass, 'public.votos'::regclass, 'public.inscripciones'::regclass)
             and pg_get_constraintdef(oid) ilike '%liga%'
  loop
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
  end loop;
end $$;
alter table public.vinculos      add constraint vinculos_liga_check      check (liga in ('precon', 'b3', 'precon_test', 'b3_test'));
alter table public.votos         add constraint votos_liga_check         check (liga in ('precon', 'b3', 'precon_test', 'b3_test'));
alter table public.inscripciones add constraint inscripciones_liga_check check (liga in ('precon', 'b3', 'precon_test', 'b3_test'));

-- Comprobación: debe mostrar tu correo con rol 'desarrollador'
select u.email, a.rol from public.admins a join auth.users u on u.id = a.user_id order by a.rol, u.email;
