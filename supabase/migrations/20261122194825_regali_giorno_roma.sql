-- Giorno dei limiti dei regali = giorno di calendario di Roma, da mezzanotte a mezzanotte, anche nelle notti del
-- cambio d'ora (issue #331, risposta del CPO del 22/11). Linea «sviluppatore-c», passo 8d.
-- Stessa regola di prima, spostata in una funzione che si prova con un orologio finto (supabase/test/prova_regali_giorno.sql).
-- manda_regalo resta identica tranne la riga di v_oggi; permessi invariati (create or replace li conserva).

create function public.inizio_giorno_roma(p_ora timestamptz) returns timestamptz
  language sql stable strict set search_path = '' as $$
  select date_trunc('day', p_ora at time zone 'Europe/Rome') at time zone 'Europe/Rome'
$$;
revoke all on function public.inizio_giorno_roma(timestamptz) from public, anon, authenticated;
grant execute on function public.inizio_giorno_roma(timestamptz) to service_role;

create or replace function public.manda_regalo(p_da uuid, p_a uuid, p_regalo text, p_chiave uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  v_coin integer := public.coin_regalo(p_regalo);
  v_oggi constant timestamptz := public.inizio_giorno_roma(now());
  s public.stanze;
  v_movimento bigint;
begin
  if v_coin is null then return 'regalo_sconosciuto'; end if;
  if p_da is null or p_a is null or p_chiave is null or p_da = p_a then return 'dati_mancanti'; end if;
  -- Un regalo alla volta per chi manda: due richieste insieme non superano i limiti né il saldo.
  perform pg_advisory_xact_lock(hashtextextended('crediti:' || p_da::text, 0));
  if exists (select 1 from public.regali r where r.da = p_da and r.chiave = p_chiave) then return 'ok'; end if;
  s := public.stanza_aperta_di(p_da);
  if s.id is null then return 'stanza_chiusa'; end if;
  if not exists (select 1 from public.membri_stanza m where m.stanza_id = s.id and m.utente_id = p_a) then
    return 'non_nella_stanza';
  end if;
  if not public.compatibili_tra(p_da, p_a) then return 'non_compatibile'; end if;
  if public.bloccati_tra(p_da, p_a) then return 'blocco'; end if;
  if exists (select 1 from public.segnalazioni g
             where (g.da = p_da and g.contro = p_a) or (g.da = p_a and g.contro = p_da)) then
    return 'segnalazione';
  end if;
  if public.sospeso(p_da) or public.sospeso(p_a) then return 'sospensione'; end if;
  if (select count(*) from public.regali r where r.da = p_da and r.a = p_a and r.mandato_il >= v_oggi) >= 3 then
    return 'limite_persona';
  end if;
  if (select count(*) from public.regali r where r.da = p_da and r.mandato_il >= v_oggi) >= 10 then
    return 'limite_giorno';
  end if;
  if public.saldo_crediti(p_da) < v_coin then return 'saldo'; end if;
  insert into public.crediti_movimenti (persona, tipo, crediti) values (p_da, 'regalo', -v_coin)
    returning id into v_movimento;
  insert into public.regali (chiave, da, a, stanza_id, regalo, coin, movimento_id)
    values (p_chiave, p_da, p_a, s.id, p_regalo, v_coin, v_movimento);
  return 'ok';
end $$;
