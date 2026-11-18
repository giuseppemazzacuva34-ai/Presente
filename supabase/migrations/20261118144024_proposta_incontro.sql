-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D17 A) · passo 2b della linea «sviluppatore-b».
-- Proposta e risposta dell'incontro dopo il doppio sì, decise dal server (anche via API, non solo nella schermata):
--   proponi_incontro(porta, persona, orario, locale, luogo_libero) → «Proponi quando e dove» e «Propongo un'altra data»
--   rispondi_incontro(porta, persona, risposta)                      → «Accetto» · «Annulla l'incontro»
-- Regole (spec punti 2 e 3, «Regole»): orario da domani alle 10:00 fino alla scadenza, ogni 30 minuti, tra 10:00 e
-- 23:00 in ora di Roma; un locale consigliato oppure un altro luogo pubblico scritto (max 80 caratteri), mai tutti e
-- due; 3 controproposte in tutto; una proposta senza risposta scade dopo 48 ore o alla scadenza dell'incontro, se prima;
-- senza conferma entro la scadenza l'incontro è «scaduto» e i crediti tornano a entrambi, senza penale; «Annulla
-- l'incontro» chiude l'incontro e restituisce i crediti a entrambi. Valori uguali a api/incontro.js
-- (test/proposta_incontro_database.test.mjs li confronta). Il locale è l'id della lista dei locali pilota: quando la
-- lista sarà nel database si controllerà anche che esista; ora si controlla solo la forma.
-- Disdetta, check-in, segnale e buca arrivano nei passi successivi. Solo il server chiama queste funzioni.

-- Se l'incontro è da chiudere per la scadenza (mai confermato entro la scadenza), lo chiude: esito «scaduto»,
-- caparre restituite a entrambi. Se la proposta in corso è scaduta (48 ore o scadenza), torna «da fissare».
-- Ritorna l'incontro aggiornato (bloccato per l'aggiornamento).
create function public.incontro_aggiornato(p_porta uuid) returns public.incontri
  language plpgsql set search_path = '' as $$
declare
  v_i public.incontri;
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
  return v_i;
end $$;

-- Risposte: proposto, controproposto, non_nella_porta, nessun_incontro, incontro_chiuso, incontro_scaduto,
-- gia_confermato, attendi_risposta, controproposte_finite, orario_non_valido, prima_di_domani, fuori_orario,
-- non_sul_passo, dopo_la_scadenza, luogo_non_valido (come controllaOrario in api/incontro.js).
create function public.proponi_incontro(p_porta uuid, p_persona uuid, p_orario timestamptz, p_locale text, p_luogo text)
  returns text language plpgsql set search_path = '' as $$
declare
  v_prima_ora constant integer := 10;
  v_ultima_ora constant integer := 23;
  v_passo constant integer := 30;
  v_controproposte constant integer := 3;
  v_porta public.porte;
  v_i public.incontri;
  v_oggi date;
  v_locale_roma timestamp;
  v_minuti integer;
  v_locale text := nullif(btrim(p_locale), '');
  v_luogo text := nullif(btrim(p_luogo), '');
  v_contro boolean := false;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if public.apri_incontro(p_porta) is null then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito = 'scaduto' then
    return 'incontro_scaduto';
  elsif v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato = 'confermato' then
    return 'gia_confermato';
  elsif v_i.stato = 'proposto' then
    if v_i.proposto_da = p_persona then
      return 'attendi_risposta';
    end if;
    if v_i.controproposte >= v_controproposte then
      return 'controproposte_finite';
    end if;
    v_contro := true;
  end if;

  -- Orario: da domani alle 10:00, tra 10:00 e 23:00 di Roma, sul passo di 30 minuti senza secondi, entro la scadenza.
  if p_orario is null then
    return 'orario_non_valido';
  end if;
  v_oggi := (now() at time zone 'Europe/Rome')::date;
  if p_orario < ((v_oggi + 1) + make_interval(hours => v_prima_ora)) at time zone 'Europe/Rome' then
    return 'prima_di_domani';
  end if;
  v_locale_roma := p_orario at time zone 'Europe/Rome';
  v_minuti := extract(hour from v_locale_roma)::integer * 60 + extract(minute from v_locale_roma)::integer;
  if v_minuti < v_prima_ora * 60 or v_minuti > v_ultima_ora * 60 then
    return 'fuori_orario';
  end if;
  if mod(v_minuti, v_passo) <> 0 or extract(second from v_locale_roma) <> 0 then
    return 'non_sul_passo';
  end if;
  if p_orario > v_i.scadenza then
    return 'dopo_la_scadenza';
  end if;
  -- Dove: uno solo tra locale consigliato e luogo scritto, al massimo 80 caratteri.
  if (v_locale is null) = (v_luogo is null) or char_length(coalesce(v_locale, v_luogo)) > 80 then
    return 'luogo_non_valido';
  end if;

  update public.incontri set stato = 'proposto', orario = p_orario, locale = v_locale, luogo_libero = v_luogo,
    proposto_da = p_persona, proposto_il = now(), controproposte = controproposte + (case when v_contro then 1 else 0 end)
    where porta_id = p_porta;
  return case when v_contro then 'controproposto' else 'proposto' end;
end $$;

-- Risposte: confermato, annullato, risposta_non_valida, non_nella_porta, nessun_incontro, incontro_chiuso,
-- incontro_scaduto, nessuna_proposta, proposta_scaduta, non_puoi_rispondere, orario_passato.
create function public.rispondi_incontro(p_porta uuid, p_persona uuid, p_risposta text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_i public.incontri;
  v_era_proposto boolean;
begin
  if p_risposta is null or p_risposta not in ('accetto', 'annulla') then
    return 'risposta_non_valida';
  end if;
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select stato = 'proposto' into v_era_proposto from public.incontri where porta_id = p_porta;
  if not found then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito = 'scaduto' then
    return 'incontro_scaduto';
  elsif v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato <> 'proposto' then
    return case when v_era_proposto then 'proposta_scaduta' else 'nessuna_proposta' end;
  elsif v_i.proposto_da = p_persona then
    return 'non_puoi_rispondere';
  end if;

  if p_risposta = 'annulla' then
    update public.incontri set stato = 'da_fissare', orario = null, locale = null, luogo_libero = null, proposto_da = null,
      proposto_il = null, esito = 'annullato', esito_il = now()
      where porta_id = p_porta;
    perform public.restituisci_caparre(p_porta);
    return 'annullato';
  end if;
  -- Un orario già passato non si conferma: la proposta decade e si torna a «da fissare».
  if v_i.orario <= now() then
    update public.incontri set stato = 'da_fissare', orario = null, locale = null, luogo_libero = null, proposto_da = null,
      proposto_il = null
      where porta_id = p_porta;
    return 'orario_passato';
  end if;
  update public.incontri set stato = 'confermato', confermato_il = now() where porta_id = p_porta;
  return 'confermato';
end $$;

revoke all on function public.incontro_aggiornato(uuid) from public, anon, authenticated;
revoke all on function public.proponi_incontro(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.rispondi_incontro(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.incontro_aggiornato(uuid) to service_role;
grant execute on function public.proponi_incontro(uuid, uuid, timestamptz, text, text) to service_role;
grant execute on function public.rispondi_incontro(uuid, uuid, text) to service_role;
