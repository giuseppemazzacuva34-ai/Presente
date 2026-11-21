-- Fase 2 · issue #331 spec v1 (CPO, 21/11), parte A · decisioni_giuseppe_20_11_evoluzione, D145 A · linea «sviluppatore-c».
-- Il registro dei crediti conta in COIN (1 € = 10 Coin). Accordo del CTO del 21/11 per toccare caparra (#65) e buca (#6).
-- In beta i Coin sono un CONTATORE INTERNO di prova: nessun pagamento vero.
--   stanza «Al buio» −80 (decisione di Giuseppe, non ×10) · caparra −100/+100 · buca +70 a chi ha aspettato e 30 a
--   Presente (trattenuti) · Coin di prova dal pannello 10–5000.
-- Gli importi stanno in quattro funzioni costanti (coin_caparra, coin_buca_ricevuta, coin_buca_presente, coin_stanza):
-- chi in futuro ridefinisce le funzioni della caparra o della buca usa queste, non i numeri.
-- I nomi interni (crediti_movimenti, colonna crediti, saldo_crediti, crediti_presente) restano: la spec li ammette e
-- cambiarli toccherebbe il codice di tutte le linee.
--
-- Scelte tecniche (nessun SQL distruttivo, nessuna riga del registro modificata o cancellata):
-- 1. Il registro è in sola aggiunta: i saldi già presenti (Coin di prova in beta) passano a Coin con UN movimento in più
--    per persona, «conversione_coin» = 9 × saldo (così il saldo diventa ×10). Una sola conversione per persona.
-- 2. I vincoli sugli importi si sostituiscono con versioni in Coin «not valid»: valgono per ogni riga nuova, le righe
--    vecchie restano come sono (fanno parte della storia e sono già convertite dal movimento del punto 1).
-- 3. incontri.crediti_presente: le buche già chiuse passano da 3 a 30 (stessa unità del registro), poi il vincolo
--    chiede 30.
-- 4. blocca_caparra, restituisci_caparre, incontro_aggiornato (versione del passo 16a, linea B) e disdici_incontro
--    (versione del passo 2p, linea B) si ridefiniscono identiche, cambiano solo gli importi.

create function public.coin_caparra() returns integer language sql immutable set search_path = '' as $$ select 100 $$;
create function public.coin_buca_ricevuta() returns integer language sql immutable set search_path = '' as $$ select 70 $$;
create function public.coin_buca_presente() returns integer language sql immutable set search_path = '' as $$ select 30 $$;
create function public.coin_stanza() returns integer language sql immutable set search_path = '' as $$ select 80 $$;

-- 1. Tipi e importi in Coin.
alter table public.crediti_movimenti drop constraint crediti_movimenti_tipo_check;
alter table public.crediti_movimenti add constraint crediti_movimenti_tipo_check
  check (tipo in ('assegnati_beta', 'caparra_bloccata', 'caparra_restituita', 'stanza', 'buca_ricevuta', 'conversione_coin'));
alter table public.crediti_movimenti drop constraint importi_previsti;
-- La conversione entra solo in questa migrazione (vincolo aggiunto dopo, sotto).
insert into public.crediti_movimenti (persona, tipo, crediti)
  select persona, 'conversione_coin', 9 * sum(crediti)::integer from public.crediti_movimenti
  group by persona having sum(crediti) > 0;
alter table public.crediti_movimenti add constraint importi_previsti check (
  (tipo = 'assegnati_beta' and crediti between 10 and 5000 and porta_id is null)
  or (tipo = 'caparra_bloccata' and crediti = -100 and porta_id is not null)
  or (tipo = 'caparra_restituita' and crediti = 100 and porta_id is not null)
  or (tipo = 'stanza' and crediti = -80 and porta_id is null)
  or (tipo = 'buca_ricevuta' and crediti = 70 and porta_id is not null)) not valid;
create unique index crediti_una_conversione on public.crediti_movimenti (persona) where tipo = 'conversione_coin';

-- 3. I Coin trattenuti da Presente con una buca.
alter table public.incontri drop constraint buca_a_presente;
update public.incontri set crediti_presente = 30 where crediti_presente = 3;
alter table public.incontri add constraint buca_a_presente check (
  (esito in ('buca_a', 'buca_b') and crediti_presente = 30)
  or (esito is distinct from 'buca_a' and esito is distinct from 'buca_b' and crediti_presente = 0));

-- 4. Funzioni con gli importi in Coin.
create or replace function public.blocca_caparra(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if exists (select 1 from public.svelamenti where porta_id = p_porta and esito is not null)
     or exists (select 1 from public.crediti_movimenti where porta_id = p_porta and tipo = 'caparra_restituita') then
    return 'porta_chiusa';
  end if;
  if exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = p_persona and tipo = 'caparra_bloccata') then
    return 'gia_bloccata';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crediti:' || p_persona::text, 0));
  if public.saldo_crediti(p_persona) < public.coin_caparra() then
    return 'crediti_insufficienti';
  end if;
  insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
    values (p_persona, 'caparra_bloccata', -public.coin_caparra(), p_porta);
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  if p_persona = v_porta.a then
    update public.svelamenti set caparra_a_il = now() where porta_id = p_porta;
  else
    update public.svelamenti set caparra_b_il = now() where porta_id = p_porta;
  end if;
  return 'bloccata';
end $$;

create or replace function public.restituisci_caparre(p_porta uuid) returns integer
  language plpgsql set search_path = '' as $$
declare
  v_quante integer;
begin
  perform 1 from public.porte where id = p_porta for update;
  insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
    select b.persona, 'caparra_restituita', public.coin_caparra(), p_porta from public.crediti_movimenti b
    where b.porta_id = p_porta and b.tipo = 'caparra_bloccata'
      and not exists (select 1 from public.crediti_movimenti r
        where r.porta_id = p_porta and r.persona = b.persona and r.tipo = 'caparra_restituita');
  get diagnostics v_quante = row_count;
  return v_quante;
end $$;

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
      esito_il = now(), crediti_presente = public.coin_buca_presente()
      where porta_id = p_porta returning * into v_i;
    -- Solo se la caparra di chi ha aspettato era bloccata e non ancora restituita (mai Coin dal nulla).
    if exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_chi_aspetta and tipo = 'caparra_bloccata')
       and not exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_chi_aspetta and tipo = 'caparra_restituita') then
      insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values
        (v_chi_aspetta, 'caparra_restituita', public.coin_caparra(), p_porta),
        (v_chi_aspetta, 'buca_ricevuta', public.coin_buca_ricevuta(), p_porta);
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
    esito_il = now(), crediti_presente = public.coin_buca_presente(), disdetto_da = p_persona, disdetto_il = now()
    where porta_id = p_porta;
  -- Solo se la caparra dell'altra persona era bloccata e non ancora restituita (mai Coin dal nulla).
  if exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_altro and tipo = 'caparra_bloccata')
     and not exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = v_altro and tipo = 'caparra_restituita') then
    insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values
      (v_altro, 'caparra_restituita', public.coin_caparra(), p_porta),
      (v_altro, 'buca_ricevuta', public.coin_buca_ricevuta(), p_porta);
  end if;
  return 'disdetto_tardi';
end $$;

revoke all on function public.coin_caparra() from public, anon, authenticated;
revoke all on function public.coin_buca_ricevuta() from public, anon, authenticated;
revoke all on function public.coin_buca_presente() from public, anon, authenticated;
revoke all on function public.coin_stanza() from public, anon, authenticated;
grant execute on function public.coin_caparra() to service_role;
grant execute on function public.coin_buca_ricevuta() to service_role;
grant execute on function public.coin_buca_presente() to service_role;
grant execute on function public.coin_stanza() to service_role;
revoke all on function public.blocca_caparra(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restituisci_caparre(uuid) from public, anon, authenticated;
revoke all on function public.incontro_aggiornato(uuid) from public, anon, authenticated;
revoke all on function public.disdici_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.blocca_caparra(uuid, uuid) to service_role;
grant execute on function public.restituisci_caparre(uuid) to service_role;
grant execute on function public.incontro_aggiornato(uuid) to service_role;
grant execute on function public.disdici_incontro(uuid, uuid) to service_role;
