-- Fase 2 · issue #6 spec v1.1 (CPO, 20/11, punto 2; D12 A) · passo 2l della linea «sviluppatore-b»: «Disdici».
-- Un incontro confermato si disdice così:
--   - almeno 6 ore prima → torna «da fissare», le caparre restano bloccate e si può riproporre (stesso limite di 3
--     controproposte in tutto). I crediti tornano a entrambi solo alla scadenza senza nuovo appuntamento confermato
--     (già in incontro_aggiornato) o con «Annulla l'incontro»;
--   - meno di 6 ore prima → buca di chi disdice, come al check-in: l'altra persona riprende i suoi 10 più 7, Presente 3
--     (spec v1, «Regole»). Con «Sono in difficoltà» (#7) l'incontro va invece in revisione: passo successivo;
--   - dall'ora dell'incontro in poi la disdetta non c'è più: decide il check-in.
-- Chi ha disdetto e quando restano nell'incontro (disdetto_da, disdetto_il): servono per dire all'altra persona
-- «<nome> ha disdetto l'appuntamento». Valori uguali a api/incontro.js (disdettaGratisOre 6, 7 + 3).
-- Solo aggiunte: due colonne vuote e una funzione nuova, che solo il server chiama.

alter table public.incontri
  add column disdetto_da uuid references auth.users (id) on delete set null,
  add column disdetto_il timestamptz;

-- Risposte: disdetto, disdetto_tardi, non_nella_porta, nessun_incontro, incontro_scaduto, incontro_chiuso,
-- non_confermato, troppo_tardi.
create function public.disdici_incontro(p_porta uuid, p_persona uuid) returns text
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
      disdetto_da = p_persona, disdetto_il = now()
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
