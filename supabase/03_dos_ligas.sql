-- =====================================================================
-- El Desafío · dos ligas (Precon los sábados y Bracket 3 los jueves)
-- Ejecutar UNA vez en el SQL Editor. No borra datos: lo existente queda
-- como liga 'precon'.
-- =====================================================================
alter table public.vinculos      add column if not exists liga text not null default 'precon' check (liga in ('precon','b3'));
alter table public.votos         add column if not exists liga text not null default 'precon' check (liga in ('precon','b3'));
alter table public.inscripciones add column if not exists liga text not null default 'precon' check (liga in ('precon','b3'));

-- Un jugador puede estar vinculado / inscrito / reportando en cada liga por separado
alter table public.vinculos      drop constraint if exists vinculos_pkey,      add primary key (user_id, liga);
alter table public.votos         drop constraint if exists votos_pkey,         add primary key (user_id, liga);
alter table public.inscripciones drop constraint if exists inscripciones_pkey, add primary key (user_id, liga);
