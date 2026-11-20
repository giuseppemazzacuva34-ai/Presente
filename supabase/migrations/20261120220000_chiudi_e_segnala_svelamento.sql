-- Svelamento, passo 7d-3a (issue #65, spec v1 del CPO, «Casi limite»: «Chiudi e segnala» durante il video chiude in
-- meno di 1 secondo, blocca i due per sempre, apre la segnalazione (#7), caparre restituite a entrambi; D32 A).
--   · chiudi_e_segnala_svelamento(porta, persona): chi è nella porta, a video iniziato e non finito, chiude la porta con
--     esito «chiudi_e_segnala», blocca subito l'altra persona (tabella blocchi di D32 A: immediato, definitivo, l'altra
--     persona non lo sa) e restituisce le caparre a ENTRAMBI, mai una penale. La segnalazione con il motivo la scrive
--     poi il modulo della #7 (/app/api/segnala, origine «chiudi_e_segnala»): il blocco resta anche se chi segnala non
--     completa il modulo.
--     Risposte: chiusa (anche ripetendo: idempotente per chi ha chiuso), non_nella_porta, non_iniziato (prima
--     dell'inizio o svelamento con le foto), finito (video iniziato da oltre 15 minuti, come SCADENZA_MS del Durable
--     Object), porta_chiusa (porta già chiusa per altro, o per l'altra persona: non si dice mai il motivo).
-- Non si salva nient'altro: nessun audio, video, immagine o testo. Solo il server (ruolo di servizio), mai il telefono.

create function public.chiudi_e_segnala_svelamento(p_porta uuid, p_persona uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  v_porta public.porte;
  v_s public.svelamenti;
  v_altra uuid;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  v_altra := case when p_persona = v_porta.a then v_porta.b else v_porta.a end;
  select * into v_s from public.svelamenti where porta_id = p_porta for update;
  if not found then
    return 'non_iniziato';
  end if;
  if v_s.esito is not null then
    -- Solo chi ha chiuso ritrova «chiusa»: per l'altra persona la porta è chiusa e basta.
    if v_s.esito = 'chiudi_e_segnala' and exists (select 1 from public.blocchi where chi = p_persona and bloccato = v_altra) then
      return 'chiusa';
    end if;
    return 'porta_chiusa';
  end if;
  if v_s.iniziato_il is null or v_s.tipo is distinct from 'video' then
    return 'non_iniziato';
  end if;
  if v_s.finito_il is not null or now() - v_s.iniziato_il > interval '15 minutes' then
    return 'finito';
  end if;
  update public.svelamenti
    set esito = 'chiudi_e_segnala', esito_il = now(), finito_il = now(), risposta_a = null, risposta_b = null
    where porta_id = p_porta;
  -- Chi ha già eliminato l'account non si blocca (non c'è più).
  if exists (select 1 from auth.users where id = v_altra) then
    insert into public.blocchi (chi, bloccato) values (p_persona, v_altra) on conflict do nothing;
  end if;
  perform public.restituisci_caparre(p_porta);
  return 'chiusa';
end $$;

revoke all on function public.chiudi_e_segnala_svelamento(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chiudi_e_segnala_svelamento(uuid, uuid) to service_role;
