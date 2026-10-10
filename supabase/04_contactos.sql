-- =====================================================================
-- El Desafío · correos de jugadores (solo organizadores)
-- Ejecutar UNA vez en el SQL Editor. No borra datos.
-- Los correos dejan de guardarse en el estado público de la liga.
-- =====================================================================
create table if not exists public.contactos (
  id          text primary key,             -- nombre del jugador normalizado
  data        jsonb not null,               -- {nombre, email, actualizado}
  actualizado timestamptz not null default now()
);
alter table public.contactos enable row level security;
drop policy if exists "admin contactos" on public.contactos;
create policy "admin contactos" on public.contactos
  for all using (public.es_admin()) with check (public.es_admin());
