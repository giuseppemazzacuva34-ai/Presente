-- Fase 2 · issue #6 spec v1.1 (CPO, 20/11, punto 2) · passo 2n della linea «sviluppatore-b»: «Annulla l'incontro».
-- «Annulli l'incontro? Non potrete più fissarlo. I crediti tornano a entrambi.» (la conferma la chiede l'app)
--   - si può da «da fissare» (anche dopo una disdetta) o con una proposta in corso, da tutte e due le persone
--     (anche da chi ha proposto: altrimenti dopo una disdetta i crediti resterebbero bloccati fino alla scadenza);
--   - crediti restituiti subito a entrambi (restituisci_caparre, mai due volte); esito «annullato», che già ferma
--     ogni nuova proposta e risposta (proponi_incontro e rispondi_incontro rispondono «incontro_chiuso»);
--   - un appuntamento confermato prima si disdice («Disdici», passo 2l): qui «gia_confermato».
-- Scelta tecnica: funzione a parte e non una risposta di rispondi_incontro, che vale solo per chi riceve la proposta.
-- Solo aggiunte: una funzione nuova, che solo il server chiama.

-- Risposte: annullato, non_nella_porta, nessun_incontro, incontro_scaduto, incontro_chiuso, gia_confermato.
create function public.annulla_incontro(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_i public.incontri;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  perform 1 from public.incontri where porta_id = p_porta;
  if not found then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito = 'scaduto' then
    return 'incontro_scaduto';
  elsif v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato = 'confermato' then
    return 'gia_confermato';
  end if;
  update public.incontri set stato = 'da_fissare', orario = null, locale = null, luogo_libero = null, proposto_da = null,
    proposto_il = null, esito = 'annullato', esito_il = now()
    where porta_id = p_porta;
  perform public.restituisci_caparre(p_porta);
  return 'annullato';
end $$;

revoke all on function public.annulla_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.annulla_incontro(uuid, uuid) to service_role;
