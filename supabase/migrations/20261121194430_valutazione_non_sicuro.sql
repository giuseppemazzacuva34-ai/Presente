-- Fase 2 · issue #7 spec v1.1 (CPO, 30/10), «Priorità» e criterio dell'issue · passo 16b della linea «sviluppatore-b».
-- «Non mi sono sentita/o al sicuro» nella valutazione (#6, D20 A) fa partire subito un controllo: con «No» alla
-- domanda privata valuta_incontro crea una segnalazione «non_al_sicuro» (origine «valutazione», priorità 1 ora)
-- contro l'altra persona. La risposta all'app resta «racconta» («Vuoi raccontarci cosa è successo?»).
-- L'altra persona non lo sa mai (la segnalazione non è leggibile dal telefono). Scelta tecnica: stessa funzione
-- ridefinita, resto identico; nessun SQL distruttivo.

create or replace function public.valuta_incontro(p_porta uuid, p_persona uuid, p_presentato text, p_foto_sue text,
  p_come_in_chiamata text, p_sicuro boolean) returns text
  language plpgsql set search_path = '' as $$
declare
  v_giorni constant integer := 7;
  v_porta public.porte;
  v_i public.incontri;
begin
  select * into v_porta from public.porte where id = p_porta;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select * into v_i from public.incontri where porta_id = p_porta;
  if not found then
    return 'nessun_incontro';
  end if;
  if v_i.esito is distinct from 'avvenuto' then
    return 'non_avvenuto';
  end if;
  if now() > v_i.esito_il + make_interval(days => v_giorni) then
    return 'chiusa';
  end if;
  if p_presentato is null or p_presentato not in ('si', 'in_ritardo', 'no')
     or p_foto_sue is null or p_foto_sue not in ('si', 'non_sicuro', 'no')
     or p_come_in_chiamata is null or p_come_in_chiamata not in ('si', 'piu_o_meno', 'no')
     or p_sicuro is null then
    return 'risposta_non_valida';
  end if;
  insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro)
    values (p_porta, p_persona, case when p_persona = v_porta.a then v_porta.b else v_porta.a end,
            p_presentato, p_foto_sue, p_come_in_chiamata, p_sicuro)
    on conflict (porta_id, persona) do nothing;
  if not found then
    return 'gia_fatta';
  end if;
  -- Passo 16b (#7): «No» alla sicurezza → subito una segnalazione da 1 ora contro l'altra persona (avviso al
  -- responsabile della sicurezza dai trigger delle segnalazioni). Nessun racconto e nessun blocco automatico.
  if not p_sicuro then
    perform public.nuova_segnalazione(p_persona, case when p_persona = v_porta.a then v_porta.b else v_porta.a end,
      'non_al_sicuro', 'valutazione', null, false);
  end if;
  return case when p_sicuro then 'grazie' else 'racconta' end;
end $$;

revoke all on function public.valuta_incontro(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.valuta_incontro(uuid, uuid, text, text, text, boolean) to service_role;
