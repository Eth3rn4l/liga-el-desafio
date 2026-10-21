-- Permisos de la Data API (desde el 30-10-2026 Supabase ya no los da solos a las tablas NUEVAS).
-- Las tablas del proyecto actual ya los tienen: este archivo solo hace falta si se crea un proyecto nuevo
-- (o se vuelven a crear las tablas) con 01..06. Correrlo al final, después de 06_google.sql.
-- Quién puede leer o escribir qué fila lo siguen decidiendo las políticas RLS de 01..06; esto solo abre la puerta de la API,
-- igual que hacía Supabase antes del cambio.
do $$
declare t text;
begin
  foreach t in array array['liga','historial','vinculos','votos','inscripciones','perfiles','admins','contactos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('grant select, insert, update, delete on public.%I to anon, authenticated, service_role', t);
    end if;
  end loop;
end $$;
