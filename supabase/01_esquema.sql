-- =====================================================================
-- El Desafío · base de datos para la versión en Netlify
-- Pegar completo en Supabase → SQL Editor → Run (una sola vez)
-- =====================================================================

-- ---------- Cuentas de jugador ----------------------------------------
create table public.perfiles (
  id         uuid primary key references auth.users on delete cascade,
  nombre     text not null check (char_length(nombre)   between 2 and 40),
  apellido   text not null check (char_length(apellido) between 2 and 40),
  apodo      text check (apodo is null or char_length(apodo) between 2 and 20),
  creado_en  timestamptz not null default now()
);

-- Organizadores (Hans y tú). Se agregan a mano después.
create table public.admins (
  user_id uuid primary key references auth.users on delete cascade
);

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Al crear la cuenta se arma el perfil con los datos del formulario
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, nombre, apellido, apodo)
  values (new.id,
          trim(coalesce(new.raw_user_meta_data->>'nombre', '')),
          trim(coalesce(new.raw_user_meta_data->>'apellido', '')),
          nullif(trim(coalesce(new.raw_user_meta_data->>'apodo', '')), ''));
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.nuevo_usuario();

-- ---------- Liga (mismo formato que la página actual) -----------------
-- liga 'estado' = jornada en curso; version sube sola en cada cambio
create table public.liga (
  id          text primary key,
  data        jsonb not null,
  version     bigint not null default 1,
  actualizado timestamptz not null default now()
);

create or replace function public.subir_version() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.actualizado := now();
  return new;
end $$;

create trigger liga_version before update on public.liga
  for each row execute function public.subir_version();

-- Fechas cerradas (estadísticas e históricos)
create table public.historial (
  id        text primary key,
  data      jsonb not null,
  creado_en timestamptz not null default now()
);

-- Cuenta ↔ jugador de la liga
create table public.vinculos (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  pid         text not null,
  deck        jsonb,
  actualizado timestamptz not null default now()
);

-- Reporte de mesa de cada jugador
create table public.votos (
  user_id     uuid primary key default auth.uid() references auth.users on delete cascade,
  data        jsonb not null,
  actualizado timestamptz not null default now()
);

-- Inscripción del día hecha por el propio jugador
create table public.inscripciones (
  user_id   uuid primary key default auth.uid() references auth.users on delete cascade,
  data      jsonb not null,
  creado_en timestamptz not null default now()
);

-- ---------- Permisos (RLS) ---------------------------------------------
alter table public.perfiles      enable row level security;
alter table public.admins        enable row level security;
alter table public.liga          enable row level security;
alter table public.historial     enable row level security;
alter table public.vinculos      enable row level security;
alter table public.votos         enable row level security;
alter table public.inscripciones enable row level security;

-- Perfiles: cada uno ve y edita el suyo; el organizador ve todos
create policy "ver perfil"    on public.perfiles for select using (id = auth.uid() or public.es_admin());
create policy "editar perfil" on public.perfiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Admins: cada cuenta puede saber si es organizador
create policy "soy admin" on public.admins for select using (user_id = auth.uid());

-- Liga e historial: cualquiera ve, solo el organizador escribe
create policy "ver liga"      on public.liga      for select using (true);
create policy "admin liga"    on public.liga      for all using (public.es_admin()) with check (public.es_admin());
create policy "ver historial" on public.historial for select using (true);
create policy "admin hist"    on public.historial for all using (public.es_admin()) with check (public.es_admin());

-- Vínculos: el jugador maneja el suyo; el organizador ve y borra
create policy "ver vinculo"    on public.vinculos for select using (user_id = auth.uid() or public.es_admin());
create policy "crear vinculo"  on public.vinculos for insert with check (user_id = auth.uid());
create policy "editar vinculo" on public.vinculos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "borrar vinculo" on public.vinculos for delete using (user_id = auth.uid() or public.es_admin());

-- Votos: los jugadores con cuenta ven los reportes (consenso de mesa)
create policy "ver votos"    on public.votos for select to authenticated using (true);
create policy "crear voto"   on public.votos for insert with check (user_id = auth.uid());
create policy "editar voto"  on public.votos for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "borrar voto"  on public.votos for delete using (user_id = auth.uid() or public.es_admin());

-- Inscripciones: el jugador la suya; el organizador todas
create policy "ver inscripcion"    on public.inscripciones for select using (user_id = auth.uid() or public.es_admin());
create policy "crear inscripcion"  on public.inscripciones for insert with check (user_id = auth.uid());
create policy "editar inscripcion" on public.inscripciones for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "borrar inscripcion" on public.inscripciones for delete using (user_id = auth.uid() or public.es_admin());

grant select on public.liga, public.historial to anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on function public.es_admin() to anon, authenticated;

-- ---------- Tiempo real (reloj, mesas y reportes al instante) ---------
alter publication supabase_realtime add table public.liga, public.votos, public.inscripciones, public.vinculos;
