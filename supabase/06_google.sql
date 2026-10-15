-- =====================================================================
-- El Desafío · cuentas con Google
-- Ejecutar UNA vez en Supabase → SQL Editor → Run. No borra datos.
-- =====================================================================

-- 1) Al crear la cuenta se arma el perfil. Con Google el nombre viene del perfil de Google;
--    si no sirve (muy corto, raro), no se crea y la página le pide nombre y apellido al jugador.
create or replace function public.nuevo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  completo text := trim(coalesce(md->>'full_name', md->>'name', ''));
  n text := trim(coalesce(nullif(md->>'nombre', ''), nullif(md->>'given_name', ''), split_part(completo, ' ', 1)));
  a text := trim(coalesce(nullif(md->>'apellido', ''), nullif(md->>'family_name', ''),
                          nullif(trim(substr(completo, length(split_part(completo, ' ', 1)) + 1)), '')));
begin
  if char_length(coalesce(n, '')) between 2 and 40 and char_length(coalesce(a, '')) between 2 and 40 then
    begin
      insert into public.perfiles (id, nombre, apellido, apodo)
      values (new.id, n, a, nullif(trim(coalesce(md->>'apodo', '')), ''))
      on conflict (id) do nothing;
    exception when others then null;   -- nunca impedir que se cree la cuenta
    end;
  end if;
  return new;
end $$;

-- 2) El jugador puede crear su propio perfil (para quien entra con Google sin nombre completo)
drop policy if exists "crear perfil" on public.perfiles;
create policy "crear perfil" on public.perfiles for insert with check (id = auth.uid());
