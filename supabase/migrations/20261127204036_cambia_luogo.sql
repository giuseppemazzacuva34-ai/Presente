-- Fase 2 · issue #6 spec v1 (CPO, 3/11, «Casi limite»: «Locale chiuso o cambiato all'ultimo») · linea «sviluppatore-b».
-- «Cambia luogo»: con l'appuntamento confermato, fino a 1 ora prima, una persona propone un altro luogo (un locale
-- consigliato oppure un altro luogo pubblico scritto, max 80 caratteri, mai tutti e due, come proponi_incontro);
-- serve la conferma dell'altra persona, sempre entro 1 ora prima; senza conferma resta il luogo vecchio. Una
-- richiesta alla volta; vale solo per l'orario per cui è stata fatta. Giorno e ora non cambiano.
--   cambia_luogo(porta, persona, locale, luogo) → text
--     proposto · errori: non_nella_porta · nessun_incontro · incontro_chiuso · non_confermato · troppo_tardi
--     · luogo_non_valido · stesso_luogo · attendi_risposta (la mia è in attesa) · rispondi_prima (c'è quella dell'altro)
--   rispondi_cambio_luogo(porta, persona, risposta 'accetto' | 'rifiuto') → text
--     cambiato · rifiutato · errori: risposta_non_valida · non_nella_porta · nessun_incontro · incontro_chiuso
--     · non_confermato · nessun_cambio · non_puoi_rispondere · troppo_tardi
-- Le chiama SOLO il server. La tabella tiene solo l'ultima richiesta per incontro (anche rifiutata: niente delete).
-- La notifica all'altra persona arriva in un passo successivo. Valore uguale a INCONTRO.cambioLuogoPrimaMinuti in
-- api/incontro.js (test/cambia_luogo_database.test.mjs).
-- Lo stato (create or replace, stessa firma, resto uguale alla 20261125224143) aggiunge le azioni «cambia_luogo» e
-- «rispondi_cambio» e «cambio_luogo»: { mio, locale, luogo, scade } | null (mai l'id di chi l'ha chiesto).

create table public.cambi_luogo (
  porta_id uuid primary key references public.incontri (porta_id) on delete cascade,
  proposto_da uuid not null references auth.users (id) on delete cascade,
  proposto_il timestamptz not null default now(),
  per_orario timestamptz not null, -- l'orario dell'appuntamento quando è stata chiesta: se cambia, la richiesta non vale
  locale text check (char_length(locale) between 1 and 80),
  luogo_libero text check (char_length(luogo_libero) between 1 and 80),
  risposta text check (risposta in ('accetto', 'rifiuto')),
  risposto_il timestamptz,
  constraint un_solo_luogo check ((locale is null) <> (luogo_libero is null)),
  constraint risposta_con_ora check ((risposta is null) = (risposto_il is null))
);
alter table public.cambi_luogo enable row level security;
revoke all on public.cambi_luogo from public, anon, authenticated;
grant select, insert, update on public.cambi_luogo to service_role;
-- Nessuna regola per authenticated: il telefono riceve la richiesta solo dal Worker, dentro lo stato dell'incontro.

create function public.cambia_luogo(p_porta uuid, p_persona uuid, p_locale text, p_luogo text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_prima_cambio constant integer := 60;
  v_porta public.porte;
  v_i public.incontri;
  v_c public.cambi_luogo;
  v_locale text := nullif(btrim(p_locale), '');
  v_luogo text := nullif(btrim(p_luogo), '');
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if not exists (select 1 from public.incontri where porta_id = p_porta) then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato <> 'confermato' then
    return 'non_confermato';
  end if;
  if now() >= v_i.orario - make_interval(mins => v_prima_cambio) then
    return 'troppo_tardi';
  end if;
  select * into v_c from public.cambi_luogo where porta_id = p_porta;
  if found and v_c.risposta is null and v_c.per_orario = v_i.orario then
    return case when v_c.proposto_da = p_persona then 'attendi_risposta' else 'rispondi_prima' end;
  end if;
  if (v_locale is null) = (v_luogo is null) or char_length(coalesce(v_locale, v_luogo)) > 80 then
    return 'luogo_non_valido';
  end if;
  if v_locale is not distinct from v_i.locale and v_luogo is not distinct from v_i.luogo_libero then
    return 'stesso_luogo';
  end if;
  insert into public.cambi_luogo (porta_id, proposto_da, proposto_il, per_orario, locale, luogo_libero)
    values (p_porta, p_persona, now(), v_i.orario, v_locale, v_luogo)
    on conflict (porta_id) do update set proposto_da = excluded.proposto_da, proposto_il = excluded.proposto_il,
      per_orario = excluded.per_orario, locale = excluded.locale, luogo_libero = excluded.luogo_libero,
      risposta = null, risposto_il = null;
  return 'proposto';
end $$;

revoke all on function public.cambia_luogo(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.cambia_luogo(uuid, uuid, text, text) to service_role;

create function public.rispondi_cambio_luogo(p_porta uuid, p_persona uuid, p_risposta text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_prima_cambio constant integer := 60;
  v_porta public.porte;
  v_i public.incontri;
  v_c public.cambi_luogo;
begin
  if p_risposta is null or p_risposta not in ('accetto', 'rifiuto') then
    return 'risposta_non_valida';
  end if;
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if not exists (select 1 from public.incontri where porta_id = p_porta) then
    return 'nessun_incontro';
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.esito is not null then
    return 'incontro_chiuso';
  elsif v_i.stato <> 'confermato' then
    return 'non_confermato';
  end if;
  select * into v_c from public.cambi_luogo where porta_id = p_porta for update;
  if not found or v_c.risposta is not null or v_c.per_orario <> v_i.orario then
    return 'nessun_cambio';
  elsif v_c.proposto_da = p_persona then
    return 'non_puoi_rispondere';
  elsif now() >= v_i.orario - make_interval(mins => v_prima_cambio) then
    return 'troppo_tardi';
  end if;
  update public.cambi_luogo set risposta = p_risposta, risposto_il = now() where porta_id = p_porta;
  if p_risposta = 'rifiuto' then
    return 'rifiutato';
  end if;
  update public.incontri set locale = v_c.locale, luogo_libero = v_c.luogo_libero where porta_id = p_porta;
  return 'cambiato';
end $$;

revoke all on function public.rispondi_cambio_luogo(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rispondi_cambio_luogo(uuid, uuid, text) to service_role;

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
    'cambio_luogo', v_cambio);
end $$;

revoke all on function public.stato_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stato_incontro(uuid, uuid) to service_role;
