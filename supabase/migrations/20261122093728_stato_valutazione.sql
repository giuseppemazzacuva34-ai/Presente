-- Fase 2 · issue #6 spec v1 (CPO, 3/11, «Valutazione (D20)») · passo 3e della linea «sviluppatore-b».
-- Dopo l'incontro avvenuto (check-in di entrambi) lo stato dice al telefono se mostrare le 4 domande: azione «valuta»
-- finché la persona non ha risposto ed entro 7 giorni dall'esito (stesso limite di valuta_incontro). «Non ora» non
-- chiude nulla: la domanda resta finché è aperta. Mai le risposte, né le proprie né quelle dell'altra persona.
-- Solo «create or replace» della funzione dello stato del passo 2p (stessa firma, stesso resto), nessun dato toccato.
-- Valori uguali a api/incontro.js e api/valutazione.js (test/stato_valutazione_database.test.mjs).

create or replace function public.stato_incontro(p_porta uuid, p_persona uuid) returns jsonb
  language plpgsql set search_path = '' as $$
declare
  v_controproposte constant integer := 3;
  v_giorni constant integer := 7;
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
  elsif v_i.esito = 'avvenuto' and now() <= v_i.esito_il + make_interval(days => v_giorni)
        and not exists (select 1 from public.valutazioni where porta_id = p_porta and persona = p_persona) then
    -- Passo 3e (D20): le 4 domande finché la persona non ha risposto; «Non ora» non chiude, si chiude a 7 giorni.
    v_azioni := '["valuta"]'::jsonb;
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
