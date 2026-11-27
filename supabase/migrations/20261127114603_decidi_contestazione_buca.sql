-- Fase 2 · issue #6 spec v1.4 (CPO, 27/11; D51 A) · linea «sviluppatore-b»: decisione su «Ero lì» / «Non riesco».
--   - Decide solo un moderatore (in beta Giuseppe), mai su una porta in cui è una delle due persone («propria»).
--   - Caso 1 («Non riesco» mandato nella finestra, esito «contestato»): accolta → caparre restituite a entrambi
--     (100 + 100), nessun 70/30; respinta → buca normale (100 + 70 a chi ha aspettato, 30 a Presente).
--     Finché la finestra non è finita non si decide («non_ancora»).
--   - Caso 2 (buca già pagata, «Ero lì» entro 24 ore): respinta → nulla si muove; accolta → solo nella funzione
--     buca_accolta_dopo_pagamento, che oggi non muove nulla e risponde «in attesa di D156» (decisione di Giuseppe).
--   - Una decisione sola: la riga si blocca e si decide solo se è ancora «in_attesa».
-- Solo aggiunte: nessuna funzione esistente cambia. Tutto solo dal server (service_role).

-- Caso 2 accolto: l'unico punto che cambierà con D156 (A, B o C). Oggi: nessun movimento, false = non applicato.
create function public.buca_accolta_dopo_pagamento(p_porta uuid, p_persona uuid) returns boolean
  language plpgsql set search_path = '' as $$
begin
  return false;
end $$;
revoke all on function public.buca_accolta_dopo_pagamento(uuid, uuid) from public, anon, authenticated;
grant execute on function public.buca_accolta_dopo_pagamento(uuid, uuid) to service_role;

-- Risposte: accolta, respinta, gia_decisa, non_trovata, non_moderatore, propria, non_ancora, in_attesa_d156.
create function public.decidi_contestazione_buca(p_id uuid, p_decisore uuid, p_accolta boolean) returns text
  language plpgsql set search_path = '' as $$
declare
  v_c public.contestazioni_buca;
  v_porta public.porte;
  v_i public.incontri;
  v_chi_aspetta uuid;
begin
  if not public.e_moderatore(p_decisore) then
    return 'non_moderatore';
  end if;
  if p_accolta is null then
    return 'non_trovata';
  end if;
  select * into v_c from public.contestazioni_buca where id = p_id;
  if not found then
    return 'non_trovata';
  end if;
  select * into v_porta from public.porte where id = v_c.porta_id;
  if p_decisore in (v_porta.a, v_porta.b) then
    return 'propria';
  end if;
  v_i := public.incontro_aggiornato(v_c.porta_id); -- chiude per tempo se serve e blocca l'incontro
  select * into v_c from public.contestazioni_buca where id = p_id for update;
  if v_c.stato <> 'in_attesa' then
    return 'gia_decisa';
  end if;
  if v_c.fase = 'prima_della_buca' and v_i.esito is null then
    return 'non_ancora';
  end if;

  if v_c.fase = 'dopo_buca' and p_accolta then
    if not public.buca_accolta_dopo_pagamento(v_c.porta_id, v_c.persona) then
      return 'in_attesa_d156';
    end if;
  elsif v_i.esito = 'contestato' and p_accolta then
    perform public.restituisci_caparre(v_c.porta_id);
  elsif v_i.esito = 'contestato' then
    -- Respinta: la buca che era rimasta sospesa si paga adesso, come in incontro_aggiornato.
    v_chi_aspetta := case when v_c.persona = v_porta.a then v_porta.b else v_porta.a end;
    update public.incontri set esito = case when v_chi_aspetta = v_porta.a then 'buca_b' else 'buca_a' end,
      esito_il = now(), crediti_presente = public.coin_buca_presente()
      where porta_id = v_c.porta_id;
    if exists (select 1 from public.crediti_movimenti where porta_id = v_c.porta_id and persona = v_chi_aspetta and tipo = 'caparra_bloccata')
       and not exists (select 1 from public.crediti_movimenti where porta_id = v_c.porta_id and persona = v_chi_aspetta and tipo = 'caparra_restituita') then
      insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values
        (v_chi_aspetta, 'caparra_restituita', public.coin_caparra(), v_c.porta_id),
        (v_chi_aspetta, 'buca_ricevuta', public.coin_buca_ricevuta(), v_c.porta_id);
    end if;
  end if;
  -- Altri esiti (per esempio «avvenuto» o «nessun_checkin»): le caparre sono già tornate, si registra solo la decisione.
  update public.contestazioni_buca set stato = case when p_accolta then 'accolta' else 'respinta' end,
    deciso_da = p_decisore, deciso_il = now()
    where id = p_id;
  return case when p_accolta then 'accolta' else 'respinta' end;
end $$;
revoke all on function public.decidi_contestazione_buca(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.decidi_contestazione_buca(uuid, uuid, boolean) to service_role;
