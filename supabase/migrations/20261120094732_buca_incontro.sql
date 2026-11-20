-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D12 A) · passo 2j della linea «sviluppatore-b»: la buca nel database.
-- Alla fine della finestra del check-in (orario + 30 minuti + ritardo dichiarato) un incontro confermato si chiude:
--   - uno solo ha fatto «Sono qui» → buca dell'altro (esito buca_a / buca_b): chi ha aspettato riprende i suoi 10
--     (caparra_restituita) più 7 (buca_ricevuta), Presente 3 (crediti_presente), chi manca perde i suoi 10;
--   - nessuno dei due → esito «nessun_checkin», caparre restituite a entrambi, nessuna penale.
-- Si chiude alla prima lettura (incontro_aggiornato, usata da stato, proposta e check-in) oppure con
-- chiudi_incontri_finiti(), da chiamare periodicamente dal server. Contestazione (24 ore) e disdetta: passi successivi.
-- Valori uguali a api/incontro.js (finestra 30 minuti, 7 + 3). Solo il server chiama queste funzioni.

create or replace function public.incontro_aggiornato(p_porta uuid) returns public.incontri
  language plpgsql set search_path = '' as $$
declare
  v_dopo constant integer := 30; -- minuti dopo l'ora in cui si può ancora fare «Sono qui»
  v_i public.incontri;
  v_porta public.porte;
  v_chi_aspetta uuid;
begin
  select * into v_i from public.incontri where porta_id = p_porta for update;
  if not found or v_i.esito is not null then
    return v_i;
  end if;
  if v_i.stato <> 'confermato' and now() > v_i.scadenza then
    update public.incontri set stato = 'da_fissare', orario = null, locale = null, luogo_libero = null, proposto_da = null,
      proposto_il = null, esito = 'scaduto', esito_il = now()
      where porta_id = p_porta returning * into v_i;
    perform public.restituisci_caparre(p_porta);
    return v_i;
  end if;
  if v_i.stato = 'proposto' and now() > least(v_i.proposto_il + interval '48 hours', v_i.scadenza) then
    update public.incontri set stato = 'da_fissare', orario = null, locale = null, luogo_libero = null, proposto_da = null,
      proposto_il = null
      where porta_id = p_porta returning * into v_i;
  end if;
  -- Passo 2j: finestra del check-in finita (i check-in di entrambi chiudono già l'incontro come «avvenuto»).
  if v_i.stato = 'confermato' and now() >= v_i.orario + make_interval(mins => v_dopo + v_i.ritardo_minuti) then
    select * into v_porta from public.porte where id = p_porta for update;
    if v_i.checkin_a_il is null and v_i.checkin_b_il is null then
      update public.incontri set stato = 'concluso', esito = 'nessun_checkin', esito_il = now()
        where porta_id = p_porta returning * into v_i;
      perform public.restituisci_caparre(p_porta);
      return v_i;
    end if;
    v_chi_aspetta := case when v_i.checkin_a_il is not null then v_porta.a else v_porta.b end;
    update public.incontri set stato = 'concluso', esito = case when v_chi_aspetta = v_porta.a then 'buca_b' else 'buca_a' end,
      esito_il = now(), crediti_presente = 3
      where porta_id = p_porta returning * into v_i;
    -- Solo se la caparra di chi ha aspettato era bloccata e non ancora restituita (mai crediti dal nulla).
    if exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_chi_aspetta and tipo = 'caparra_bloccata')
       and not exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_chi_aspetta and tipo = 'caparra_restituita') then
      insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values
        (v_chi_aspetta, 'caparra_restituita', 10, p_porta),
        (v_chi_aspetta, 'buca_ricevuta', 7, p_porta);
    end if;
  end if;
  return v_i;
end $$;

create or replace function public.checkin_incontro(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_prima constant integer := 30;
  v_dopo constant integer := 30;
  v_porta public.porte;
  v_i public.incontri;
  v_sono_a boolean;
  v_segnale text;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  v_sono_a := p_persona = v_porta.a;
  if not exists (select 1 from public.incontri where porta_id = p_porta) then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito = 'avvenuto' then
    return 'avvenuto';
  elsif v_i.esito in ('buca_a', 'buca_b', 'nessun_checkin') then
    return 'troppo_tardi'; -- la finestra è finita e l'incontro si è appena chiuso (passo 2j)
  elsif v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato <> 'confermato' then
    return 'non_confermato';
  end if;
  if (v_sono_a and v_i.checkin_a_il is not null) or (not v_sono_a and v_i.checkin_b_il is not null) then
    return 'gia_fatto';
  end if;
  if now() < v_i.orario - make_interval(mins => v_prima) then
    return 'troppo_presto';
  end if;
  if now() >= v_i.orario + make_interval(mins => v_dopo + v_i.ritardo_minuti) then
    return 'troppo_tardi';
  end if;

  if v_sono_a then
    update public.incontri set checkin_a_il = now() where porta_id = p_porta returning * into v_i;
  else
    update public.incontri set checkin_b_il = now() where porta_id = p_porta returning * into v_i;
  end if;
  if v_i.checkin_a_il is null or v_i.checkin_b_il is null then
    return 'sono_qui';
  end if;
  -- Tutti e due: il segnale (a caso dalla lista), incontro avvenuto, caparre sbloccate subito.
  select parola into v_segnale from public.parole_segnale order by random() limit 1;
  update public.incontri set segnale = v_segnale, stato = 'concluso', esito = 'avvenuto', esito_il = now()
    where porta_id = p_porta;
  perform public.restituisci_caparre(p_porta);
  return 'avvenuto';
end $$;

-- Lavoro periodico: chiude gli incontri finiti che nessuno ha aperto (finestra del check-in passata, o scadenza senza
-- appuntamento confermato). Ritorna quanti ne ha chiusi. Rifarlo non cambia nulla.
create function public.chiudi_incontri_finiti() returns integer
  language plpgsql set search_path = '' as $$
declare
  v_porta uuid;
  v_quanti integer := 0;
begin
  for v_porta in
    select porta_id from public.incontri
    where esito is null
      and ((stato = 'confermato' and now() >= orario + make_interval(mins => 30 + ritardo_minuti))
           or (stato <> 'confermato' and now() > scadenza))
    order by porta_id
  loop
    if (public.incontro_aggiornato(v_porta)).esito is not null then
      v_quanti := v_quanti + 1;
    end if;
  end loop;
  return v_quanti;
end $$;

revoke all on function public.incontro_aggiornato(uuid) from public, anon, authenticated;
grant execute on function public.incontro_aggiornato(uuid) to service_role;
revoke all on function public.checkin_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.checkin_incontro(uuid, uuid) to service_role;
revoke all on function public.chiudi_incontri_finiti() from public, anon, authenticated;
grant execute on function public.chiudi_incontri_finiti() to service_role;
