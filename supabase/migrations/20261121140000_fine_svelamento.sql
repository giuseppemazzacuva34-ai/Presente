-- Svelamento, passo 8a (issue #65, spec v1 del CPO, passi 7-8, «Regole» e «Casi limite»; linea «sviluppatore»).
-- Solo database, prima delle schermate del sì/no (8b). Tre buchi trovati il 21/11 (commento sulla #65):
--   · fine_svelamento(porta, persona): il database non sapeva quando il video era finito (finito_il lo scriveva solo
--     «Chiudi e segnala»). Il Worker la chiama quando il Durable Object dice che i 10 secondi sono passati; con le foto
--     vale subito. Segna finito_il e la durata (10 o 0): da qui partono le 48 ore del sì/no. Prima dei 10 secondi dal
--     server: «non_ancora». Idempotente («finito» anche ripetendo e per l'altra persona).
--     Risposte: finito, non_ancora, non_iniziato, non_nella_porta, porta_chiusa.
--   · torna_a_quando(porta, persona): dopo 3 cadute, o se uno non si collega a svelamento iniziato, si torna al passo 4
--     («Quando?»; spec: «si può riprovare quante volte si vuole dentro le 48 ore»). Restano caparre e scelte; si
--     azzerano inizio, tipo, tentativi, ingressi, «pronto» e orari. A svelamento finito non cambia nulla (vale).
--     Risposte: quando, finito, non_iniziato, non_nella_porta, porta_chiusa.
--   · svelamento fermo: iniziato da oltre 15 minuti (come SCADENZA_MS del Durable Object) e mai finito. Prima la porta
--     spariva da svelamento_di() e la scadenza delle 48 ore non la chiudeva più (caparre ferme). Ora torna da sola al
--     passo 4 e, dopo le 48 ore, la porta scade con le caparre restituite a entrambi, senza penale.
--   · svelamento_di() aggiunge «svelate»: porte con lo svelamento finito e senza esito, con nome, età, tipo, fine,
--     scadenza del sì/no (fine + 48 ore) e «ho_risposto». Mai le risposte, né la propria né quella dell'altra persona.
-- Il sì/no e l'esito (con la regola che il CPO conferma entro il 23/11) arrivano nel passo successivo.
-- Nessun dato nuovo salvato, nessuna colonna nuova. Solo il server (ruolo di servizio), mai il telefono.

create function public.svelamento_fermo(s public.svelamenti) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(s.iniziato_il is not null and s.finito_il is null and s.esito is null
    and now() - s.iniziato_il > interval '15 minutes', false)
$$;

-- Passo 4 da capo. Caparre, scelte e risposte (vuote) restano; il resto si azzera.
create function public.rimetti_a_quando(p_porta uuid) returns void
  language sql security definer set search_path = '' as $$
  update public.svelamenti
    set iniziato_il = null, tipo = null, tentativi = 0, entrato_a_il = null, entrato_b_il = null,
        pronto_a_il = null, pronto_b_il = null, fascia_fissata = null, fasce_a = '{}', fasce_b = '{}'
    where porta_id = p_porta and finito_il is null and esito is null
$$;

-- Come prima, più: la scadenza delle 48 ore vale anche per uno svelamento fermo. Uno iniziato da meno di 15 minuti
-- prima della scadenza si completa (spec, «Casi limite»).
create or replace function public.porta_da_chiudere(p_porta uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select case
    when public.bloccati_tra(p.a, p.b) then 'blocco'
    when public.sospeso(p.a) or public.sospeso(p.b) then 'sospensione'
    when now() >= p.aperta_il + interval '48 hours'
      and (s.iniziato_il is null or public.svelamento_fermo(s)) then 'scaduta'
  end
  from public.porte p left join public.svelamenti s on s.porta_id = p.id
  where p.id = p_porta and s.esito is null
$$;

-- Come prima, più: uno svelamento fermo torna al passo 4 invece di dire «gia_iniziato».
create or replace function public.porta_aperta_per(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_s public.svelamenti;
  v_chiudi text;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select * into v_s from public.svelamenti where porta_id = p_porta;
  if v_s.esito is not null then
    return case when v_s.esito = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  v_chiudi := public.porta_da_chiudere(p_porta);
  if v_chiudi is not null then
    perform public.chiudi_porta_svelamento(p_porta, v_chiudi);
    return case when v_chiudi = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  if public.svelamento_fermo(v_s) then
    perform public.rimetti_a_quando(p_porta);
  elsif v_s.iniziato_il is not null then
    return 'gia_iniziato';
  end if;
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  return null;
end $$;

-- Come prima (passo 6c), ma uno svelamento fermo non risulta più «iniziato» per chi era dentro.
create or replace function public.entra_svelamento(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_errore text;
  v_porta public.porte;
  v_s public.svelamenti;
  v_mio timestamptz;
  v_suo timestamptz;
  v_tipo text;
begin
  -- Svelamento già iniziato con me dentro: chi aspettava scopre che l'altra persona è arrivata.
  select s.* into v_s from public.svelamenti s join public.porte p on p.id = s.porta_id
    where s.porta_id = p_porta and p_persona in (p.a, p.b);
  if found and v_s.iniziato_il is not null and v_s.esito is null and v_s.finito_il is null
     and not public.svelamento_fermo(v_s)
     and (select case when p.a = p_persona then v_s.entrato_a_il else v_s.entrato_b_il end
          from public.porte p where p.id = p_porta) >= v_s.iniziato_il - interval '10 minutes' then
    return 'iniziato_' || v_s.tipo;
  end if;

  v_errore := public.porta_aperta_per(p_porta, p_persona);
  if v_errore is not null then
    return v_errore;
  end if;
  select * into v_porta from public.porte where id = p_porta;
  select * into v_s from public.svelamenti where porta_id = p_porta for update;
  if v_s.caparra_a_il is null or v_s.caparra_b_il is null then
    return 'manca_caparra';
  end if;
  if p_persona = v_porta.a then
    v_mio := v_s.entrato_a_il; v_suo := v_s.entrato_b_il;
  else
    v_mio := v_s.entrato_b_il; v_suo := v_s.entrato_a_il;
  end if;
  -- Sono già dentro da meno di 10 minuti e l'altra persona no: aspetto, e i 10 minuti non ripartono.
  if v_mio is not null and now() - v_mio < interval '10 minutes'
     and (v_suo is null or now() - v_suo >= interval '10 minutes') then
    return 'in_attesa';
  end if;
  -- Si entra solo nel momento o con l'altra persona che aspetta da meno di 10 minuti.
  if not public.momento_svelamento(v_s) and (v_suo is null or now() - v_suo >= interval '10 minutes') then
    return case when v_mio is not null then 'non_arrivato' else 'non_ancora' end;
  end if;
  if p_persona = v_porta.a then
    update public.svelamenti set entrato_a_il = now() where porta_id = p_porta;
  else
    update public.svelamenti set entrato_b_il = now() where porta_id = p_porta;
  end if;
  if v_suo is null or now() - v_suo >= interval '10 minutes' then
    return 'in_attesa';
  end if;
  -- Ci sono tutti e due: lo svelamento inizia. «Preferisco le foto» di uno vale per entrambi.
  v_tipo := case when 'foto' in (v_s.scelta_a, v_s.scelta_b) then 'foto' else 'video' end;
  update public.svelamenti set iniziato_il = now(), tentativi = tentativi + 1, tipo = v_tipo where porta_id = p_porta;
  return 'iniziato_' || v_tipo;
end $$;

-- Controlli comuni a fine_svelamento e torna_a_quando: null = svelamento iniziato, non finito, porta aperta.
create function public.svelamento_in_corso(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_s public.svelamenti;
  v_chiudi text;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select * into v_s from public.svelamenti where porta_id = p_porta for update;
  if not found then
    return 'non_iniziato';
  end if;
  if v_s.esito is not null then
    return 'porta_chiusa';
  end if;
  v_chiudi := public.porta_da_chiudere(p_porta);
  if v_chiudi is not null then
    perform public.chiudi_porta_svelamento(p_porta, v_chiudi);
    return 'porta_chiusa';
  end if;
  if v_s.finito_il is not null then
    return 'finito';
  end if;
  if public.svelamento_fermo(v_s) then
    perform public.rimetti_a_quando(p_porta);
    return 'non_iniziato';
  end if;
  if v_s.iniziato_il is null then
    return 'non_iniziato';
  end if;
  return null;
end $$;

create function public.fine_svelamento(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_errore text;
  v_s public.svelamenti;
begin
  v_errore := public.svelamento_in_corso(p_porta, p_persona);
  if v_errore is not null then
    return v_errore;
  end if;
  select * into v_s from public.svelamenti where porta_id = p_porta;
  -- I 10 secondi li conta il Durable Object; qui solo un limite dal server: mai una fine prima di 10 secondi dall'inizio.
  if v_s.tipo = 'video' and now() - v_s.iniziato_il < interval '10 seconds' then
    return 'non_ancora';
  end if;
  update public.svelamenti
    set finito_il = now(), durata_secondi = case when v_s.tipo = 'video' then 10 else 0 end
    where porta_id = p_porta;
  return 'finito';
end $$;

create function public.torna_a_quando(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_errore text;
begin
  v_errore := public.svelamento_in_corso(p_porta, p_persona);
  if v_errore is not null then
    return v_errore;
  end if;
  perform public.rimetti_a_quando(p_porta);
  return 'quando';
end $$;

-- { saldo, porte: [... come prima ...], svelate: [{ porta, con, nome, eta, tipo, finito_il, risposta_scade_il,
--   ho_risposto }] }. Prima di leggere sistema le porte di chi chiede: chiude quelle da chiudere e rimette al passo 4
-- gli svelamenti fermi.
create or replace function public.svelamento_di(p_utente uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_porta uuid;
  v_chiudi text;
begin
  for v_porta in
    select p.id from public.porte p left join public.svelamenti s on s.porta_id = p.id
    where (p.a = p_utente or p.b = p_utente) and s.esito is null
    order by p.id
  loop
    v_chiudi := public.porta_da_chiudere(v_porta);
    if v_chiudi is not null then
      perform public.chiudi_porta_svelamento(v_porta, v_chiudi);
    elsif (select public.svelamento_fermo(s) from public.svelamenti s where s.porta_id = v_porta) then
      perform public.rimetti_a_quando(v_porta);
    end if;
  end loop;

  return jsonb_build_object(
    'saldo', public.saldo_crediti(p_utente),
    'porte', coalesce((
      select jsonb_agg(jsonb_build_object(
          'porta', p.id,
          'con', case when p.a = p_utente then p.b else p.a end,
          'nome', pr.nome,
          'eta', extract(year from age(pr.data_nascita))::int,
          'aperta_il', p.aperta_il,
          'scade_il', p.aperta_il + interval '48 hours',
          'mia_caparra', (case when p.a = p_utente then s.caparra_a_il else s.caparra_b_il end) is not null,
          'sua_caparra', (case when p.a = p_utente then s.caparra_b_il else s.caparra_a_il end) is not null,
          'mia_scelta', coalesce(case when p.a = p_utente then s.scelta_a else s.scelta_b end, 'video'),
          'mie_fasce', to_jsonb(coalesce(case when p.a = p_utente then s.fasce_a else s.fasce_b end, '{}'::timestamptz[])),
          'fascia_fissata', case when s.fascia_fissata + interval '30 minutes' > now() then s.fascia_fissata end,
          'mio_pronto', coalesce(now() - (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) < interval '5 minutes', false),
          'suo_pronto', coalesce(now() - (case when p.a = p_utente then s.pronto_b_il else s.pronto_a_il end) < interval '5 minutes', false),
          'pronto_scade_il', case when now() - (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) < interval '5 minutes'
            then (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) + interval '5 minutes' end,
          'momento', public.momento_svelamento(s),
          'tipo', case when public.momento_svelamento(s)
            then case when 'foto' in (coalesce(s.scelta_a, 'video'), coalesce(s.scelta_b, 'video')) then 'foto' else 'video' end end)
        order by p.aperta_il desc, p.id)
      from public.porte p
      left join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.esito is null
        and s.iniziato_il is null
    ), '[]'::jsonb),
    -- Passo 8a: porte svelate in attesa del sì/no. Solo se ho già risposto, mai cosa.
    'svelate', coalesce((
      select jsonb_agg(jsonb_build_object(
          'porta', p.id,
          'con', case when p.a = p_utente then p.b else p.a end,
          'nome', pr.nome,
          'eta', extract(year from age(pr.data_nascita))::int,
          'tipo', s.tipo,
          'finito_il', s.finito_il,
          'risposta_scade_il', s.finito_il + interval '48 hours',
          'ho_risposto', (case when p.a = p_utente then s.risposta_a else s.risposta_b end) is not null)
        order by s.finito_il desc, p.id)
      from public.porte p
      join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.esito is null
        and s.finito_il is not null
    ), '[]'::jsonb));
end $$;

revoke all on function public.svelamento_fermo(public.svelamenti) from public, anon, authenticated;
revoke all on function public.rimetti_a_quando(uuid) from public, anon, authenticated;
revoke all on function public.porta_da_chiudere(uuid) from public, anon, authenticated;
revoke all on function public.porta_aperta_per(uuid, uuid) from public, anon, authenticated;
revoke all on function public.entra_svelamento(uuid, uuid) from public, anon, authenticated;
revoke all on function public.svelamento_in_corso(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fine_svelamento(uuid, uuid) from public, anon, authenticated;
revoke all on function public.torna_a_quando(uuid, uuid) from public, anon, authenticated;
revoke all on function public.svelamento_di(uuid) from public, anon, authenticated;
grant execute on function public.svelamento_fermo(public.svelamenti) to service_role;
grant execute on function public.rimetti_a_quando(uuid) to service_role;
grant execute on function public.svelamento_in_corso(uuid, uuid) to service_role;
grant execute on function public.fine_svelamento(uuid, uuid) to service_role;
grant execute on function public.torna_a_quando(uuid, uuid) to service_role;
grant execute on function public.entra_svelamento(uuid, uuid) to service_role;
grant execute on function public.svelamento_di(uuid) to service_role;
