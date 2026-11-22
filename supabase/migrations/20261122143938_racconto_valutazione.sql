-- Fase 2 · issue #6 spec v1 (CPO, 3/11) punto 4 «Valutazione (D20)» e issue #7 spec v1.1 «Priorità» · passo 3g della
-- linea «sviluppatore-b».
-- «Sì, racconto»: dopo «No» alla domanda privata sulla sicurezza valuta_incontro ha già creato una segnalazione
-- «non_al_sicuro» da 1 ora (passo 16b). Qui chi ha risposto può aggiungere il suo racconto a QUELLA segnalazione,
-- una volta sola e finché nessuno l'ha chiusa: niente seconda segnalazione, scadenza invariata.
-- Esiti: raccontato | testo_non_valido | non_nella_porta | nessuna_segnalazione | gia_raccontato.
-- Scelta tecnica: funzione nuova, solo per il server (service_role); nessuna tabella toccata nello schema.
create function public.racconta_valutazione(p_porta uuid, p_persona uuid, p_testo text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_testo text := btrim(coalesce(p_testo, ''));
  v_s public.segnalazioni;
begin
  select * into v_porta from public.porte where id = p_porta;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if v_testo = '' or char_length(v_testo) > 1000 then
    return 'testo_non_valido';
  end if;
  select * into v_s from public.segnalazioni
    where da = p_persona and contro = case when p_persona = v_porta.a then v_porta.b else v_porta.a end
      and motivo = 'non_al_sicuro' and origine = 'valutazione' and esito is null
    order by creata_il desc limit 1
    for update;
  if not found then
    return 'nessuna_segnalazione';
  end if;
  if v_s.testo is not null then
    return 'gia_raccontato';
  end if;
  update public.segnalazioni set testo = v_testo where id = v_s.id;
  return 'raccontato';
end $$;

revoke all on function public.racconta_valutazione(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.racconta_valutazione(uuid, uuid, text) to service_role;
