-- =====================================================================
-- El Desafío · ajuste de permisos (ejecutar UNA vez, después del primero)
-- Permite que la página de la liga muestre quién ya está vinculado,
-- los inscritos con cuenta y el avance de los reportes, y que el
-- organizador vincule a quienes se inscribieron con su cuenta.
-- No expone correos: solo nombre, mazo, resultado y el id interno.
-- =====================================================================
drop policy if exists "ver vinculo" on public.vinculos;
create policy "ver vinculos"   on public.vinculos for select using (true);
create policy "admin vinculos" on public.vinculos for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists "ver inscripcion" on public.inscripciones;
create policy "ver inscripciones" on public.inscripciones for select using (true);

drop policy if exists "ver votos" on public.votos;
create policy "ver votos" on public.votos for select using (true);

grant select on public.vinculos, public.inscripciones, public.votos to anon;
