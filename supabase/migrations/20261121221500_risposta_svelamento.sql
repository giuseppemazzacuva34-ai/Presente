-- Svelamento, passo 8b-1 (issue #65, regola dell'esito del CPO del 21/11, D48 A; linea «sviluppatore»).
-- Solo database, prima delle richieste del Worker e delle schermate del sì/no (8b-2, 8b-3).
--   · rispondi_svelamento(porta, persona, 'si'|'no'): «Vuoi incontrare <nome>?» dopo lo svelamento, una sola volta.
--     Risposte: risposto, doppio_si, gia_risposto, non_svelata, tempo_scaduto, porta_chiusa, non_nella_porta,
--     risposta_non_valida. «risposto» è identica per un sì e per un no, e non dice mai se l'altra persona ha risposto.
--   · Doppio sì → esito «doppio_si» subito (caparre ancora bloccate: si passa all'incontro, #6).
--   · Ogni altro caso (sì + no, no + no, uno che non risponde) → nessun esito prima delle 48 ore dalla fine dello
--     svelamento; poi «chiusa» per entrambi e caparre restituite a entrambi nello stesso momento (porta_da_chiudere).
--   · Una risposta data non si cambia, nemmeno scrivendo nel database (trigger svelamenti_risposta_ferma).
--   · Sospensione di uno dei due durante le 48 ore: porta chiusa e caparre restituite subito (come prima), ma per
--     l'altra persona la porta resta «svelata» fino alla fine delle 48 ore e poi l'esito è «chiusa». Chi non aveva
--     ancora risposto riceve «risposto» (solo l'orario si salva): nessun indizio prima del tempo.
--   · svelamento_di() aggiunge «esiti»: doppio sì subito, «chiusa» solo dalla fine delle 48 ore, per 7 giorni.
--     Mai il motivo (sospensione → «chiusa»), mai le risposte. «ho_risposto» ora si legge dall'orario della risposta.
-- Nessuna colonna nuova. Solo il server (ruolo di servizio), mai il telefono.

-- Una risposta ha sempre il suo orario; una risposta data non cambia (si cancella solo con l'esito, l'orario resta).
alter table public.svelamenti
  add constraint risposta_a_con_orario check (risposta_a is null or risposta_a_il is not null),
  add constraint risposta_b_con_orario check (risposta_b is null or risposta_b_il is not null);

create function public.svelamenti_risposta_ferma() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if (old.risposta_a_il is not null and new.risposta_a_il is distinct from old.risposta_a_il)
     or (old.risposta_b_il is not null and new.risposta_b_il is distinct from old.risposta_b_il)
     or (old.risposta_a is not null and new.risposta_a is distinct from old.risposta_a and new.esito is null)
     or (old.risposta_b is not null and new.risposta_b is distinct from old.risposta_b and new.esito is null) then
    raise exception 'risposta sì/no non modificabile';
  end if;
  return new;
end $$;
revoke all on function public.svelamenti_risposta_ferma() from public, anon, authenticated;
create trigger svelamenti_risposta_ferma before update on public.svelamenti
  for each row execute function public.svelamenti_risposta_ferma();

-- Come prima, più «chiusa» (fine delle 48 ore del sì/no senza doppio sì).
create or replace function public.chiudi_porta_svelamento(p_porta uuid, p_esito text) returns void
  language plpgsql set search_path = '' as $$
begin
  if p_esito not in ('scaduta', 'blocco', 'sospensione', 'chiusa') then
    raise exception 'esito di chiusura non previsto';
  end if;
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  update public.svelamenti set esito = p_esito, esito_il = now(), risposta_a = null, risposta_b = null
    where porta_id = p_porta and esito is null;
  perform public.restituisci_caparre(p_porta);
end $$;

-- Come prima (passo 8a), più: svelamento finito da 48 ore senza doppio sì → «chiusa».
create or replace function public.porta_da_chiudere(p_porta uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select case
    when public.bloccati_tra(p.a, p.b) then 'blocco'
    when public.sospeso(p.a) or public.sospeso(p.b) then 'sospensione'
    when s.finito_il is not null and now() >= s.finito_il + interval '48 hours' then 'chiusa'
    when now() >= p.aperta_il + interval '48 hours'
      and (s.iniziato_il is null or public.svelamento_fermo(s)) then 'scaduta'
  end
  from public.porte p left join public.svelamenti s on s.porta_id = p.id
  where p.id = p_porta and s.esito is null
$$;

create function public.rispondi_svelamento(p_porta uuid, p_persona uuid, p_risposta text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_s public.svelamenti;
  v_sono_a boolean;
  v_chiudi text;
begin
  if p_risposta is null or p_risposta not in ('si', 'no') then
    return 'risposta_non_valida';
  end if;
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  v_sono_a := p_persona = v_porta.a;
  select * into v_s from public.svelamenti where porta_id = p_porta for update;
  if not found or v_s.finito_il is null then
    return case when found and v_s.esito is not null then 'porta_chiusa' else 'non_svelata' end;
  end if;
  if (case when v_sono_a then v_s.risposta_a_il else v_s.risposta_b_il end) is not null then
    return 'gia_risposto';
  end if;
  if v_s.esito is null then
    v_chiudi := public.porta_da_chiudere(p_porta);
    if v_chiudi is not null then
      perform public.chiudi_porta_svelamento(p_porta, v_chiudi);
      if v_chiudi = 'chiusa' then
        return 'tempo_scaduto';
      end if;
      select * into v_s from public.svelamenti where porta_id = p_porta;
    end if;
  end if;
  -- Sospensione dentro le 48 ore: per chi resta nulla cambia fino alla fine (si salva solo l'orario).
  if v_s.esito = 'sospensione' and now() < v_s.finito_il + interval '48 hours' then
    if v_sono_a then
      update public.svelamenti set risposta_a_il = now() where porta_id = p_porta;
    else
      update public.svelamenti set risposta_b_il = now() where porta_id = p_porta;
    end if;
    return 'risposto';
  end if;
  if v_s.esito is not null then
    return 'porta_chiusa';
  end if;
  if v_sono_a then
    update public.svelamenti set risposta_a = p_risposta, risposta_a_il = now() where porta_id = p_porta
      returning * into v_s;
  else
    update public.svelamenti set risposta_b = p_risposta, risposta_b_il = now() where porta_id = p_porta
      returning * into v_s;
  end if;
  if v_s.risposta_a = 'si' and v_s.risposta_b = 'si' then
    update public.svelamenti set esito = 'doppio_si', esito_il = now(), risposta_a = null, risposta_b = null
      where porta_id = p_porta;
    return 'doppio_si';
  end if;
  return 'risposto';
end $$;

-- Come prima (passo 8a), più «esiti». «svelate» comprende anche le porte chiuse da una sospensione finché non
-- finiscono le 48 ore, e «ho_risposto» si legge dall'orario della risposta.
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
    -- Porte svelate in attesa del sì/no. Solo se ho già risposto, mai cosa, mai se l'altra persona ha risposto.
    'svelate', coalesce((
      select jsonb_agg(jsonb_build_object(
          'porta', p.id,
          'con', case when p.a = p_utente then p.b else p.a end,
          'nome', pr.nome,
          'eta', extract(year from age(pr.data_nascita))::int,
          'tipo', s.tipo,
          'finito_il', s.finito_il,
          'risposta_scade_il', s.finito_il + interval '48 hours',
          'ho_risposto', (case when p.a = p_utente then s.risposta_a_il else s.risposta_b_il end) is not null)
        order by s.finito_il desc, p.id)
      from public.porte p
      join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.finito_il is not null
        and (s.esito is null or (s.esito = 'sospensione' and now() < s.finito_il + interval '48 hours'))
    ), '[]'::jsonb),
    -- Esito del sì/no, uguale per entrambi: «doppio_si» subito, «chiusa» dalla fine delle 48 ore. Per 7 giorni.
    'esiti', coalesce((
      select jsonb_agg(jsonb_build_object(
          'porta', e.porta,
          'con', e.con,
          'nome', pr.nome,
          'eta', extract(year from age(pr.data_nascita))::int,
          'esito', e.esito,
          'esito_il', e.esito_il)
        order by e.esito_il desc, e.porta)
      from (
        select p.id as porta,
          case when p.a = p_utente then p.b else p.a end as con,
          case when s.esito = 'doppio_si' then 'doppio_si' else 'chiusa' end as esito,
          case when s.esito = 'doppio_si' then s.esito_il else s.finito_il + interval '48 hours' end as esito_il
        from public.porte p
        join public.svelamenti s on s.porta_id = p.id
        where (p.a = p_utente or p.b = p_utente)
          and s.finito_il is not null
          and s.esito in ('doppio_si', 'chiusa', 'sospensione')
      ) e
      left join public.profili pr on pr.id = e.con
      where e.esito_il <= now() and e.esito_il > now() - interval '7 days'
    ), '[]'::jsonb));
end $$;

revoke all on function public.chiudi_porta_svelamento(uuid, text) from public, anon, authenticated;
revoke all on function public.porta_da_chiudere(uuid) from public, anon, authenticated;
revoke all on function public.rispondi_svelamento(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.svelamento_di(uuid) from public, anon, authenticated;
grant execute on function public.chiudi_porta_svelamento(uuid, text) to service_role;
grant execute on function public.porta_da_chiudere(uuid) to service_role;
grant execute on function public.rispondi_svelamento(uuid, uuid, text) to service_role;
grant execute on function public.svelamento_di(uuid) to service_role;
