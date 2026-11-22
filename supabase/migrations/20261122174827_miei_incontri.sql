-- Fase 2 · issue #6 spec v1 (CPO, 3/11), punto 1 «Vi incontrate» · passo 3k della linea «sviluppatore-b».
-- miei_incontri(persona): l'elenco degli incontri di una persona, per raggiungere dalla home la schermata «Il vostro
-- incontro» (proposta, check-in, valutazione) per tutta la durata dell'incontro (10 o 30 giorni), anche quando l'esito
-- della porta non si vede più. Comprende gli incontri senza esito e quelli chiusi da meno di 7 giorni (il tempo della
-- valutazione, D20). Per ognuno solo: porta, nome dell'altra persona, stato, scadenza, orario, esito. Mai email, età,
-- id dell'altra persona, foto, segnale, check-in o crediti (quelli li dà stato_incontro, porta per porta).
-- Solo il server (ruolo di servizio). security definer come svelamento_di: legge il nome da profili, che il ruolo di
-- servizio non legge direttamente; l'esecuzione è concessa solo al ruolo di servizio. Nessuna tabella nuova, nessuna modifica ai dati.

create function public.miei_incontri(p_persona uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'porta', i.porta_id,
      'nome', pr.nome,
      'stato', i.stato,
      'scadenza', i.scadenza,
      'orario', i.orario,
      'esito', i.esito)
    order by (i.esito is not null), coalesce(i.orario, i.scadenza), i.porta_id), '[]'::jsonb)
  from public.incontri i
  join public.porte p on p.id = i.porta_id
  left join public.profili pr on pr.id = case when p.a = p_persona then p.b else p.a end
  where (p.a = p_persona or p.b = p_persona)
    and (i.esito is null or i.esito_il > now() - interval '7 days');
$$;

revoke all on function public.miei_incontri(uuid) from public, anon, authenticated;
grant execute on function public.miei_incontri(uuid) to service_role;
