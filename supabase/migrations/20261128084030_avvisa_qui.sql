-- Fase 2 · issue #6 spec v1 (CPO, 3/11, punto 6 «Check-in») · linea «sviluppatore-b».
-- «Avvisa <nome> che sei qui»: chi ha detto «Sono qui» e aspetta, dopo 15 minuti può avvisare l'altra persona, una
-- volta sola per incontro.
--   avvisa_sono_qui(porta, persona) → text
--     avvisato · errori: non_nella_porta · nessun_incontro · incontro_chiuso · non_confermato · non_ancora_qui
--     · gia_arrivato (l'altra persona ha già detto «Sono qui») · troppo_presto · gia_avvisato · troppo_tardi
-- Scelta tecnica: i 15 minuti partono dal più tardi tra il proprio «Sono qui» e l'ora dell'appuntamento (spostata
-- se l'ALTRA persona ha detto «Arrivo in ritardo»): prima dell'ora nessuno è in ritardo. Si può fino alla fine della
-- finestra del check-in (30 minuti dopo l'ora + ritardo, fine esclusa). Valori uguali a INCONTRO.avvisoQuiMinuti e
-- checkinDopoMinuti in api/incontro.js. La notifica vera all'altra persona arriva con D24; intanto lo stato gliela
-- dice (avvisato_altro). La funzione la chiama SOLO il server.
-- Lo stato (create or replace, stessa firma, resto uguale alla 20261127204036) aggiunge l'azione «avvisa_qui»,
-- «avviso_qui_da» (da quando si potrà) e «avvisato_mio» / «avvisato_altro» (vero o falso: mai id).

alter table public.incontri
  add column avviso_qui_a_il timestamptz,
  add column avviso_qui_b_il timestamptz;

-- Da quando chi è arrivato può avvisare: null se non è ancora lì o se l'altra persona è già arrivata.
create function public.avviso_qui_da(p_porta public.porte, p_i public.incontri, p_persona uuid) returns timestamptz
  language plpgsql stable set search_path = '' as $$
declare
  v_attesa constant integer := 15;
  v_sono_a boolean := p_persona = p_porta.a;
  v_mio timestamptz;
  v_altro timestamptz;
  v_ritardo integer := 0;
begin
  v_mio := case when v_sono_a then p_i.checkin_a_il else p_i.checkin_b_il end;
  v_altro := case when v_sono_a then p_i.checkin_b_il else p_i.checkin_a_il end;
  if p_i.orario is null or v_mio is null or v_altro is not null then
    return null;
  end if;
  if p_i.ritardo_minuti <> 0 and p_i.ritardo_di is distinct from p_persona then
    v_ritardo := p_i.ritardo_minuti;
  end if;
  return greatest(v_mio, p_i.orario + make_interval(mins => v_ritardo)) + make_interval(mins => v_attesa);
end $$;

revoke all on function public.avviso_qui_da(public.porte, public.incontri, uuid) from public, anon, authenticated;
grant execute on function public.avviso_qui_da(public.porte, public.incontri, uuid) to service_role;

create function public.avvisa_sono_qui(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_attesa constant integer := 15;
  v_dopo constant integer := 30;
  v_porta public.porte;
  v_i public.incontri;
  v_sono_a boolean;
  v_da timestamptz;
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
  if (v_sono_a and v_i.checkin_a_il is null) or (not v_sono_a and v_i.checkin_b_il is null) then
    return 'non_ancora_qui';
  end if;
  if (v_sono_a and v_i.checkin_b_il is not null) or (not v_sono_a and v_i.checkin_a_il is not null) then
    return 'gia_arrivato';
  end if;
  if (v_sono_a and v_i.avviso_qui_a_il is not null) or (not v_sono_a and v_i.avviso_qui_b_il is not null) then
    return 'gia_avvisato';
  end if;
  if now() >= v_i.orario + make_interval(mins => v_dopo + v_i.ritardo_minuti) then
    return 'troppo_tardi';
  end if;
  v_da := public.avviso_qui_da(v_porta, v_i, p_persona);
  if now() < v_da then
    return 'troppo_presto';
  end if;
  if v_sono_a then
    update public.incontri set avviso_qui_a_il = now() where porta_id = p_porta;
  else
    update public.incontri set avviso_qui_b_il = now() where porta_id = p_porta;
  end if;
  return 'avvisato';
end $$;

revoke all on function public.avvisa_sono_qui(uuid, uuid) from public, anon, authenticated;
grant execute on function public.avvisa_sono_qui(uuid, uuid) to service_role;

create or replace function public.stato_incontro(p_porta uuid, p_persona uuid) returns jsonb
  language plpgsql set search_path = '' as $$
declare
  v_controproposte constant integer := 3;
  v_giorni constant integer := 7;
  v_prima constant integer := 30;
  v_dopo constant integer := 30;
  v_prima_cambio constant integer := 60;
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
  v_c public.cambi_luogo;
  v_cambio jsonb;
  v_avviso_da timestamptz;
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
      -- «Avvisa <nome> che sei qui»: chi è lì e aspetta, dopo 15 minuti, una volta sola, fino a fine finestra.
      v_avviso_da := public.avviso_qui_da(v_porta, v_i, p_persona);
      if v_avviso_da is not null and now() >= v_avviso_da and now() < v_fino
         and (case when v_sono_a then v_i.avviso_qui_a_il is null else v_i.avviso_qui_b_il is null end) then
        v_azioni := v_azioni || '["avvisa_qui"]'::jsonb;
      end if;
      -- «Cambia luogo»: fino a 1 ora prima; una richiesta alla volta, valida solo per l'orario per cui è stata fatta.
      if now() < v_i.orario - make_interval(mins => v_prima_cambio) then
        select * into v_c from public.cambi_luogo
          where porta_id = p_porta and risposta is null and per_orario = v_i.orario;
        if not found then
          v_azioni := v_azioni || '["cambia_luogo"]'::jsonb;
        else
          v_cambio := jsonb_build_object(
            'mio', v_c.proposto_da = p_persona,
            'locale', v_c.locale,
            'luogo', v_c.luogo_libero,
            'scade', v_i.orario - make_interval(mins => v_prima_cambio));
          if v_c.proposto_da <> p_persona then
            v_azioni := v_azioni || '["rispondi_cambio"]'::jsonb;
          end if;
        end if;
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
    'disdetta', v_disdetta,
    'cambio_luogo', v_cambio,
    'avviso_qui_da', v_avviso_da,
    'avvisato_mio', case when v_sono_a then v_i.avviso_qui_a_il is not null else v_i.avviso_qui_b_il is not null end,
    'avvisato_altro', case when v_sono_a then v_i.avviso_qui_b_il is not null else v_i.avviso_qui_a_il is not null end);
end $$;


revoke all on function public.stato_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stato_incontro(uuid, uuid) to service_role;
