-- Fase 2 · issue #65 spec v1 (CPO; D48 A) · passo 5a della linea «sviluppatore»: «Quando» (spec, passo 4).
--   · «Sono pronto ora»: pronto_svelamento(porta, persona) segna l'orario; vale 5 minuti, il tempo che l'altra persona
--     ha per entrare. Serve la caparra di entrambi (senza, lo svelamento non si avvia). Risposte: pronto,
--     entrambi_pronti, manca_caparra, non_nella_porta, porta_chiusa, porta_scaduta, gia_iniziato.
--   · «Scegli un orario»: fasce_svelamento(porta, persona, fasce) salva da 1 a 3 inizi di fascia da 30 minuti
--     (allineati a :00 o :30, non ancora iniziati, finiti entro le 48 ore) per chi chiede, e fissa la prima fascia
--     comune ai due (o la toglie se non ce n'è più). Serve la propria caparra. Risposte: salvate, fissata,
--     fasce_non_valide, manca_caparra, non_nella_porta, porta_chiusa, porta_scaduta, gia_iniziato.
--   · svelamento_di(persona): come prima più mie_fasce, fascia_fissata, mio_pronto, suo_pronto, pronto_scade_il.
--     Le fasce dell'altra persona non escono mai: si vede solo la fascia fissata.
-- Prima di tutto, come caparra e scelta, la porta si chiude se c'è un blocco, una persona sospesa o sono passate
-- 48 ore (crediti restituiti a entrambi). Le notifiche («<nome> è pronta per lo svelamento», 10 minuti prima e
-- all'inizio della fascia) arrivano in un passo successivo. Solo il server (ruolo di servizio), mai il telefono.
-- Valori uguali a api/svelamento.js (5 minuti, 3 fasce da 30 minuti): test/quando_svelamento_database.test.mjs li confronta.

alter table public.svelamenti
  add column pronto_a_il timestamptz,
  add column pronto_b_il timestamptz;

-- Controlli comuni: porta di chi chiede, ancora aperta, non iniziata. null = si può procedere.
create function public.porta_aperta_per(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_esito text;
  v_iniziato timestamptz;
  v_chiudi text;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select esito, iniziato_il into v_esito, v_iniziato from public.svelamenti where porta_id = p_porta;
  if v_esito is not null then
    return case when v_esito = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  if v_iniziato is not null then
    return 'gia_iniziato';
  end if;
  v_chiudi := public.porta_da_chiudere(p_porta);
  if v_chiudi is not null then
    perform public.chiudi_porta_svelamento(p_porta, v_chiudi);
    return case when v_chiudi = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  return null;
end $$;

create function public.pronto_svelamento(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_errore text;
  v_porta public.porte;
  v_s public.svelamenti;
  v_suo timestamptz;
begin
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
    update public.svelamenti set pronto_a_il = now() where porta_id = p_porta;
    v_suo := v_s.pronto_b_il;
  else
    update public.svelamenti set pronto_b_il = now() where porta_id = p_porta;
    v_suo := v_s.pronto_a_il;
  end if;
  if v_suo is not null and v_suo <= now() and now() - v_suo < interval '5 minutes' then
    return 'entrambi_pronti';
  end if;
  return 'pronto';
end $$;

create function public.fasce_svelamento(p_porta uuid, p_persona uuid, p_fasce timestamptz[]) returns text
  language plpgsql set search_path = '' as $$
declare
  v_errore text;
  v_porta public.porte;
  v_s public.svelamenti;
  v_fine timestamptz;
  v_fasce timestamptz[];
  v_comune timestamptz;
begin
  v_errore := public.porta_aperta_per(p_porta, p_persona);
  if v_errore is not null then
    return v_errore;
  end if;
  select * into v_porta from public.porte where id = p_porta;
  select * into v_s from public.svelamenti where porta_id = p_porta for update;
  if (case when p_persona = v_porta.a then v_s.caparra_a_il else v_s.caparra_b_il end) is null then
    return 'manca_caparra';
  end if;
  v_fine := v_porta.aperta_il + interval '48 hours';
  if p_fasce is null or cardinality(p_fasce) < 1 or cardinality(p_fasce) > 3
     or exists (select 1 from unnest(p_fasce) f
                where f is null or mod(extract(epoch from f), 1800) <> 0 or f < now() or f < v_porta.aperta_il
                   or f + interval '30 minutes' > v_fine) then
    return 'fasce_non_valide';
  end if;
  v_fasce := array(select distinct f from unnest(p_fasce) f order by f);
  if p_persona = v_porta.a then
    update public.svelamenti set fasce_a = v_fasce where porta_id = p_porta returning * into v_s;
  else
    update public.svelamenti set fasce_b = v_fasce where porta_id = p_porta returning * into v_s;
  end if;
  -- Prima fascia comune ancora da iniziare e finita entro la scadenza (come primaFasciaComune in api/svelamento.js).
  select min(f) into v_comune from unnest(v_s.fasce_a) f
  where f = any (v_s.fasce_b) and f >= now() and f + interval '30 minutes' <= v_fine;
  update public.svelamenti set fascia_fissata = v_comune where porta_id = p_porta;
  return case when v_comune is null then 'salvate' else 'fissata' end;
end $$;

-- { saldo, porte: [{ porta, con, nome, eta, aperta_il, scade_il, mia_caparra, sua_caparra, mia_scelta,
--                    mie_fasce, fascia_fissata, mio_pronto, suo_pronto, pronto_scade_il }] }.
create or replace function public.svelamento_di(p_utente uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_porta uuid;
  v_chiudi text;
begin
  -- Prima si sistemano le porte di chi chiede: scadute, con un blocco o con una persona sospesa.
  for v_porta in
    select p.id from public.porte p left join public.svelamenti s on s.porta_id = p.id
    where (p.a = p_utente or p.b = p_utente) and s.esito is null
    order by p.id
  loop
    v_chiudi := public.porta_da_chiudere(v_porta);
    if v_chiudi is not null then
      perform public.chiudi_porta_svelamento(v_porta, v_chiudi);
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
          -- Passo 3a: solo la propria scelta (predefinita «video» anche senza riga); mai quella dell'altra persona.
          'mia_scelta', coalesce(case when p.a = p_utente then s.scelta_a else s.scelta_b end, 'video'),
          -- Passo 5a: le proprie fasce e quella fissata; mai le fasce dell'altra persona.
          'mie_fasce', to_jsonb(coalesce(case when p.a = p_utente then s.fasce_a else s.fasce_b end, '{}'::timestamptz[])),
          'fascia_fissata', case when s.fascia_fissata + interval '30 minutes' > now() then s.fascia_fissata end,
          'mio_pronto', coalesce(now() - (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) < interval '5 minutes', false),
          'suo_pronto', coalesce(now() - (case when p.a = p_utente then s.pronto_b_il else s.pronto_a_il end) < interval '5 minutes', false),
          'pronto_scade_il', case when now() - (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) < interval '5 minutes'
            then (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) + interval '5 minutes' end)
        order by p.aperta_il desc, p.id)
      from public.porte p
      left join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.esito is null
        and s.iniziato_il is null -- quando lo svelamento è iniziato la porta passa alle schermate successive (4c)
    ), '[]'::jsonb));
end $$;

revoke all on function public.porta_aperta_per(uuid, uuid) from public, anon, authenticated;
revoke all on function public.pronto_svelamento(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fasce_svelamento(uuid, uuid, timestamptz[]) from public, anon, authenticated;
revoke all on function public.svelamento_di(uuid) from public, anon, authenticated;
grant execute on function public.porta_aperta_per(uuid, uuid) to service_role;
grant execute on function public.pronto_svelamento(uuid, uuid) to service_role;
grant execute on function public.fasce_svelamento(uuid, uuid, timestamptz[]) to service_role;
grant execute on function public.svelamento_di(uuid) to service_role;
