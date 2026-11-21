-- Fase 2 · issue #6 · spec v1.1 punto 1 · D143 B. Linea «sviluppatore-b», passo 2u.
-- locali_incontro(porta, persona) per il Worker (GET /app/api/incontro): in una sola lettura
--   { locali: locali_per_persona(persona), scelto: { nome, indirizzo, da_verificare } | null }
-- «scelto» è il locale della proposta o dell'appuntamento, per tutte e due le persone (anche chi è fuori Milano vede il
-- nome del locale che l'altra persona ha proposto). null se la persona non è nella porta. Solo server. Solo aggiunte.
create function public.locali_incontro(p_porta uuid, p_persona uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'locali', public.locali_per_persona(p_persona),
    'scelto', (select jsonb_build_object('nome', l.nome, 'indirizzo', l.indirizzo, 'da_verificare', l.stato <> 'visitato')
      from public.incontri i join public.locali l on l.id::text = i.locale where i.porta_id = p.id))
  from public.porte p
  where p.id = p_porta and p_persona is not null and p_persona in (p.a, p.b)
$$;
revoke all on function public.locali_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.locali_incontro(uuid, uuid) to service_role;
