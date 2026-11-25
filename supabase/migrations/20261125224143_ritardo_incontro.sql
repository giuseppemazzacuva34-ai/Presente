-- Fase 2 · issue #6 spec v1 (CPO, 3/11, «Casi limite») · linea «sviluppatore-b».
-- «Arrivo in ritardo»: +15 o +30 minuti, una volta sola per incontro, sposta la finestra del check-in (le colonne
-- ritardo_minuti e ritardo_di esistono già dalla 20261118093957_incontri; check-in e buca le usano già).
--   ritardo_incontro(porta, persona, minuti) → text
--     ritardo · errori: non_nella_porta · nessun_incontro · incontro_chiuso · non_confermato · ritardo_non_valido
--     · ritardo_gia_usato · gia_fatto (chi ha già detto «Sono qui» è già lì) · troppo_tardi
-- Si può dire da quando l'appuntamento è confermato fino alla fine della finestra del check-in senza ritardo
-- (30 minuti dopo l'ora, fine esclusa). Valori uguali a INCONTRO.ritardi e checkinDopoMinuti in api/incontro.js.
-- La notifica all'altra persona arriva in un passo successivo. La funzione la chiama SOLO il server.
-- Lo stato (create or replace, stessa firma, resto uguale alla 20261122093728) aggiunge l'azione «ritardo» e
-- «ritardo_mio» (vero o falso: mai l'id di chi l'ha dichiarato).

create function public.ritardo_incontro(p_porta uuid, p_persona uuid, p_minuti integer) returns text
  language plpgsql set search_path = '' as $$
declare
  v_dopo constant integer := 30;
  v_porta public.porte;
  v_i public.incontri;
  v_sono_a boolean;
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
  if v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato <> 'confermato' then
    return 'non_confermato';
  end if;
  if p_minuti is null or p_minuti not in (15, 30) then
    return 'ritardo_non_valido';
  end if;
  if v_i.ritardo_minuti <> 0 then
    return 'ritardo_gia_usato';
  end if;
  if (v_sono_a and v_i.checkin_a_il is not null) or (not v_sono_a and v_i.checkin_b_il is not null) then
    return 'gia_fatto';
  end if;
  if now() >= v_i.orario + make_interval(mins => v_dopo) then
    return 'troppo_tardi';
  end if;
  update public.incontri set ritardo_minuti = p_minuti, ritardo_di = p_persona where porta_id = p_porta;
  return 'ritardo';
end $$;

revoke all on function public.ritardo_incontro(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.ritardo_incontro(uuid, uuid, integer) to service_role;

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
      -- «Arrivo in ritardo»: una volta sola per incontro, non a chi è già lì, fino a 30 minuti dopo l'ora.
      if v_i.ritardo_minuti = 0 and not v_mio and now() < v_i.orario + make_interval(mins => v_dopo) then
        v_azioni := v_azioni || '["ritardo"]'::jsonb;
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
    'ritardo_mio', v_i.ritardo_minuti <> 0 and v_i.ritardo_di is not distinct from p_persona,
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
