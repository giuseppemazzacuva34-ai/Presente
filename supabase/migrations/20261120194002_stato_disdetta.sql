-- Fase 2 · issue #6 spec v1.1 (CPO, 20/11, punto 2) · passo 2p della linea «sviluppatore-b».
-- Lo stato dell'incontro dice al telefono quali pulsanti mostrare per la disdetta e l'annullamento:
--   - «disdici» a incontro confermato fino all'ora dell'incontro (anche insieme a «sono_qui»); dopo decide il check-in;
--   - «annulla_incontro» da «da fissare» (anche dopo una disdetta) e a chi ha fatto una proposta ancora senza
--     risposta (chi la riceve ha già «annulla» tra le risposte);
--   - «disdetta» (null se non c'è): { mia, il, orario } finché non c'è un nuovo appuntamento confermato, per il
--     messaggio «<nome> ha disdetto l'appuntamento di <giorno>. Potete fissarne un altro entro il <data>.»
--     Mai l'id di chi ha disdetto: solo «mia» sì/no.
-- Per dire «di <giorno>» serve l'orario disdetto, che la disdetta in tempo cancellava: nuova colonna orario_disdetto,
-- scritta da disdici_incontro (stessa funzione del passo 2l, cambia solo quella riga).
-- Solo aggiunte: una colonna vuota e due funzioni sostituite con la stessa firma («create or replace»), nessun dato
-- toccato. Valori uguali a api/incontro.js (test/stato_disdetta_database.test.mjs).

alter table public.incontri
  add column orario_disdetto timestamptz;

create or replace function public.disdici_incontro(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_ore_gratis constant integer := 6;
  v_porta public.porte;
  v_i public.incontri;
  v_altro uuid;
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
  elsif v_i.stato <> 'confermato' then
    return 'non_confermato';
  elsif now() >= v_i.orario then
    return 'troppo_tardi';
  end if;

  if v_i.orario - now() >= make_interval(hours => v_ore_gratis) then
    update public.incontri set stato = 'da_fissare', orario = null, locale = null, luogo_libero = null, proposto_da = null,
      proposto_il = null, confermato_il = null, ritardo_minuti = 0, ritardo_di = null,
      disdetto_da = p_persona, disdetto_il = now(), orario_disdetto = v_i.orario
      where porta_id = p_porta;
    return 'disdetto';
  end if;

  -- Meno di 6 ore: buca di chi disdice.
  v_altro := case when p_persona = v_porta.a then v_porta.b else v_porta.a end;
  update public.incontri set stato = 'concluso', esito = case when p_persona = v_porta.a then 'buca_a' else 'buca_b' end,
    esito_il = now(), crediti_presente = 3, disdetto_da = p_persona, disdetto_il = now()
    where porta_id = p_porta;
  -- Solo se la caparra dell'altra persona era bloccata e non ancora restituita (mai crediti dal nulla).
  if exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_altro and tipo = 'caparra_bloccata')
     and not exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_altro and tipo = 'caparra_restituita') then
    insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values
      (v_altro, 'caparra_restituita', 10, p_porta),
      (v_altro, 'buca_ricevuta', 7, p_porta);
  end if;
  return 'disdetto_tardi';
end $$;

revoke all on function public.disdici_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.disdici_incontro(uuid, uuid) to service_role;

create or replace function public.stato_incontro(p_porta uuid, p_persona uuid) returns jsonb
  language plpgsql set search_path = '' as $$
declare
  v_controproposte constant integer := 3;
  v_prima constant integer := 30;
  v_dopo constant integer := 30;
  v_porta public.porte;
  v_i public.incontri;
  v_rimaste integer;
  v_azioni jsonb := '[]'::jsonb;
  v_sono_a boolean;
  v_mio boolean;
  v_altro boolean;
  v_da timestamptz;
  v_fino timestamptz;
  v_disdetta jsonb;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return jsonb_build_object('errore', 'non_nella_porta');
  end if;
  if public.apri_incontro(p_porta) is null then
    return jsonb_build_object('errore', 'nessun_incontro');
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  v_rimaste := greatest(v_controproposte - v_i.controproposte, 0);
  v_sono_a := p_persona = v_porta.a;
  v_mio := case when v_sono_a then v_i.checkin_a_il is not null else v_i.checkin_b_il is not null end;
  v_altro := case when v_sono_a then v_i.checkin_b_il is not null else v_i.checkin_a_il is not null end;
  if v_i.stato in ('confermato', 'concluso') and v_i.orario is not null then
    v_da := v_i.orario - make_interval(mins => v_prima);
    v_fino := v_i.orario + make_interval(mins => v_dopo + v_i.ritardo_minuti);
  end if;
  if v_i.esito is null then
    if v_i.stato = 'da_fissare' then
      v_azioni := '["proponi", "annulla_incontro"]'::jsonb;
    elsif v_i.stato = 'proposto' and v_i.proposto_da is distinct from p_persona then
      v_azioni := case when v_rimaste > 0 then '["accetto", "altra_data", "annulla"]'::jsonb
                       else '["accetto", "annulla"]'::jsonb end;
    elsif v_i.stato = 'proposto' then
      v_azioni := '["annulla_incontro"]'::jsonb;
    elsif v_i.stato = 'confermato' then
      if not v_mio and now() >= v_da and now() < v_fino then
        v_azioni := v_azioni || '["sono_qui"]'::jsonb;
      end if;
      if now() < v_i.orario then
        v_azioni := v_azioni || '["disdici"]'::jsonb;
      end if;
    end if;
    if v_i.stato <> 'confermato' and v_i.disdetto_da is not null then
      v_disdetta := jsonb_build_object(
        'mia', v_i.disdetto_da = p_persona,
        'il', v_i.disdetto_il,
        'orario', v_i.orario_disdetto);
    end if;
  end if;
  return jsonb_build_object(
    'stato', v_i.stato,
    'scadenza', v_i.scadenza,
    'orario', v_i.orario,
    'locale', v_i.locale,
    'luogo', v_i.luogo_libero,
    'proposta_mia', v_i.stato = 'proposto' and v_i.proposto_da = p_persona,
    'proposta_scade', case when v_i.stato = 'proposto' then least(v_i.proposto_il + interval '48 hours', v_i.scadenza) end,
    'controproposte_rimaste', v_rimaste,
    'azioni', v_azioni,
    'ritardo_minuti', v_i.ritardo_minuti,
    'esito', v_i.esito,
    'checkin_mio', v_mio,
    'checkin_altro', v_altro,
    'checkin_da', v_da,
    'checkin_fino', v_fino,
    'segnale', case when v_i.checkin_a_il is not null and v_i.checkin_b_il is not null then v_i.segnale end,
    'disdetta', v_disdetta);
end $$;

revoke all on function public.stato_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stato_incontro(uuid, uuid) to service_role;
