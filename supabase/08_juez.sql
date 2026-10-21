-- =====================================================================
-- El Desafío · rol JUEZ
-- El juez entra como cualquier jugador, pero además puede asignar puntos negativos
-- (warnings y restas de puntos con motivo). Los organizadores también pueden.
-- Correr una vez en Supabase → SQL Editor. Se puede volver a correr sin problema.
-- =====================================================================

-- 1) Quiénes son jueces
create table if not exists public.jueces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  creado  timestamptz not null default now()
);
alter table public.jueces enable row level security;
drop policy if exists "ver juez" on public.jueces;
create policy "ver juez" on public.jueces for select using (user_id = auth.uid() or public.es_admin());
drop policy if exists "admin jueces" on public.jueces;
create policy "admin jueces" on public.jueces for all using (public.es_admin()) with check (public.es_admin());

-- 2) ¿La cuenta actual es juez (u organizador)?
create or replace function public.es_juez() returns boolean
language sql stable security definer set search_path = public as $$
  select public.es_admin() or exists (select 1 from public.jueces where user_id = auth.uid());
$$;
grant execute on function public.es_juez() to anon, authenticated;

-- 3) Sanciones que pone el juez (una fila por jugador y liga; la página del organizador las suma a la fecha)
create table if not exists public.sanciones (
  id          text not null,
  liga        text not null default 'precon',
  data        jsonb not null,
  actualizado timestamptz not null default now(),
  primary key (id, liga)
);
alter table public.sanciones drop constraint if exists sanciones_liga_check;
alter table public.sanciones add constraint sanciones_liga_check check (liga in ('precon', 'b3', 'precon_test', 'b3_test'));
alter table public.sanciones enable row level security;
drop policy if exists "ver sanciones" on public.sanciones;
create policy "ver sanciones" on public.sanciones for select using (true);
drop policy if exists "juez sanciones" on public.sanciones;
create policy "juez sanciones" on public.sanciones for all using (public.es_juez()) with check (public.es_juez());

grant select on public.sanciones to anon;
grant select, insert, update, delete on public.sanciones to authenticated, service_role;
grant select on public.jueces to authenticated;
grant select, insert, update, delete on public.jueces to service_role;
grant insert, update, delete on public.jueces to authenticated;

do $$ begin
  begin alter publication supabase_realtime add table public.sanciones; exception when duplicate_object then null; end;
end $$;

-- 4) Para nombrar a un juez (cambia el correo):
-- insert into public.jueces (user_id) select id from auth.users where lower(email) = 'correo@del-juez.cl' on conflict do nothing;
-- Para quitarle el rol:
-- delete from public.jueces where user_id = (select id from auth.users where lower(email) = 'correo@del-juez.cl');
-- Ver los jueces:
-- select u.email from public.jueces j join auth.users u on u.id = j.user_id;
