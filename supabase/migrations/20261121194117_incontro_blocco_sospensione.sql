-- Fase 2 · issue #7 spec v1.1 (CPO, 30/10; D51 A) · passo 16a della linea «sviluppatore-b».
-- «Blocco»: appuntamento annullato senza penale per nessuno. «Sospensione»: appuntamenti annullati senza penale per
-- l'altra persona; come per porte e svelamenti (risposta del CPO del 13/11) le caparre tornano a entrambi.
-- Si aggiunge un controllo in fondo a incontro_aggiornato (chiamata da proposta, risposta, check-in, disdetta,
-- stato e chiudi_incontri_finiti): se tra i due c'è un blocco o uno è sospeso, l'incontro ancora aperto si chiude
-- «annullato» (esito già previsto) e le caparre tornano a entrambi (restituisci_caparre, mai due volte).
-- Le chiusure per tempo restano prima: una buca già avvenuta resta una buca. All'altra persona non si dice il motivo.
-- Scelta tecnica: stessa funzione, ridefinita con il resto identico al passo 2j; nessun SQL distruttivo.

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
  -- Passo 16a (#7): blocco tra i due o persona sospesa → «annullato», caparre a entrambi, nessuna penale.
  -- Dopo le chiusure per tempo: una buca già avvenuta resta una buca.
  if v_i.esito is null then
    select * into v_porta from public.porte where id = p_porta;
    if public.bloccati_tra(v_porta.a, v_porta.b) or public.sospeso(v_porta.a) or public.sospeso(v_porta.b) then
      update public.incontri set esito = 'annullato', esito_il = now()
        where porta_id = p_porta returning * into v_i;
      perform public.restituisci_caparre(p_porta);
    end if;
  end if;
  return v_i;
end $$;

revoke all on function public.incontro_aggiornato(uuid) from public, anon, authenticated;
grant execute on function public.incontro_aggiornato(uuid) to service_role;
