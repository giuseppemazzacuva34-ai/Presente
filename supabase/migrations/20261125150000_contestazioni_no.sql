-- Fase 2 · issue #6 spec v1.3 (CPO, 22/11; D20 A, D51 A) · linea «sviluppatore-b»: «Contesta» accanto a
-- «Una persona ha risposto no a: <domanda>».
--   - Testo 10-500 caratteri (spazi ai lati esclusi); entro 14 giorni da quando il «No» è visibile (cioè scoperto
--     alla cieca: dalla risposta della persona stessa su quell'incontro o dopo 7 giorni dall'incontro);
--     una sola volta per ogni «No». Una contestazione copre tutti i «No» visibili e non ancora contestati di quella
--     domanda: chi contesta vede una riga per domanda, mai i singoli incontri.
--   - Chi contesta non riceve mai id, nome o data dell'altra persona; chi ha risposto non sa nulla della contestazione.
--   - Decide una persona (in beta Giuseppe, dal pannello). Accolta: quei «No» non contano più nel riepilogo e nei
--     bollini. Respinta: il «No» resta, nessun secondo ricorso.
-- Solo aggiunte, più il riepilogo che ora salta i «No» accolti. Tutto solo dal server (service_role).

create table public.contestazioni_no (
  id uuid primary key default gen_random_uuid(),
  persona uuid not null references auth.users (id) on delete cascade, -- chi contesta (la persona valutata)
  domanda text not null check (domanda in ('presentato', 'foto_sue', 'come_in_chiamata')),
  testo text not null check (char_length(testo) between 10 and 500),
  inviata_il timestamptz not null default now(),
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'accolta', 'respinta')),
  deciso_da uuid,
  deciso_il timestamptz,
  constraint decisione_completa check ((stato = 'in_attesa') = (deciso_il is null))
);
create index contestazioni_no_persona on public.contestazioni_no (persona);
create index contestazioni_no_in_attesa on public.contestazioni_no (inviata_il) where stato = 'in_attesa';

-- I singoli «No» coperti: la chiave impedisce di contestare due volte lo stesso «No».
create table public.contestazioni_no_valutazioni (
  porta_id uuid not null,
  rispondente uuid not null,
  domanda text not null check (domanda in ('presentato', 'foto_sue', 'come_in_chiamata')),
  contestazione_id uuid not null references public.contestazioni_no (id) on delete cascade,
  primary key (porta_id, rispondente, domanda),
  foreign key (porta_id, rispondente) references public.valutazioni (porta_id, persona) on delete cascade
);
create index contestazioni_no_valutazioni_contestazione on public.contestazioni_no_valutazioni (contestazione_id);

alter table public.contestazioni_no enable row level security;
alter table public.contestazioni_no_valutazioni enable row level security;
revoke all on public.contestazioni_no, public.contestazioni_no_valutazioni from public, anon, authenticated;
grant select, insert, update, delete on public.contestazioni_no, public.contestazioni_no_valutazioni to service_role;
-- Nessuna regola per authenticated: il telefono passa solo dal Worker.

-- I «No» che una persona vede (stessa regola alla cieca di riepilogo_valutazioni), con da quando li vede.
create function public.no_visibili(p_persona uuid)
  returns table (porta_id uuid, rispondente uuid, domanda text, visibile_dal timestamptz)
  language sql stable set search_path = '' as $$
  with scoperte as (
    select v.porta_id, v.persona, v.presentato, v.foto_sue, v.come_in_chiamata,
           greatest(v.creato_il, least(m.creato_il, i.esito_il + interval '7 days')) as dal
    from public.valutazioni v
    join public.incontri i on i.porta_id = v.porta_id
    left join public.valutazioni m on m.porta_id = v.porta_id and m.persona = p_persona
    where v.valutato = p_persona
      and (m.persona is not null or now() > i.esito_il + interval '7 days')
  )
  select s.porta_id, s.persona, d.domanda, s.dal
  from scoperte s
  cross join lateral (values ('presentato', s.presentato), ('foto_sue', s.foto_sue),
                             ('come_in_chiamata', s.come_in_chiamata)) d(domanda, risposta)
  where d.risposta = 'no'
$$;
revoke all on function public.no_visibili(uuid) from public, anon, authenticated;
grant execute on function public.no_visibili(uuid) to service_role;

-- Risposte: inviata, testo_non_valido, domanda_non_valida, nessun_no (nessun «No» visibile, già contestato o oltre 14 giorni).
create function public.contesta_no(p_persona uuid, p_domanda text, p_testo text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_testo text := btrim(coalesce(p_testo, ''));
  v_id uuid;
begin
  if p_domanda is null or p_domanda not in ('presentato', 'foto_sue', 'come_in_chiamata') then
    return 'domanda_non_valida';
  end if;
  if char_length(v_testo) < 10 or char_length(v_testo) > 500 then
    return 'testo_non_valido';
  end if;
  if p_persona is null then
    return 'nessun_no';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('contesta_no:' || p_persona::text, 0)); -- doppi tocchi
  if not exists (
    select 1 from public.no_visibili(p_persona) n
    where n.domanda = p_domanda and now() <= n.visibile_dal + interval '14 days'
      and not exists (select 1 from public.contestazioni_no_valutazioni c
                      where c.porta_id = n.porta_id and c.rispondente = n.rispondente and c.domanda = n.domanda)) then
    return 'nessun_no';
  end if;
  insert into public.contestazioni_no (persona, domanda, testo) values (p_persona, p_domanda, v_testo) returning id into v_id;
  insert into public.contestazioni_no_valutazioni (porta_id, rispondente, domanda, contestazione_id)
    select n.porta_id, n.rispondente, n.domanda, v_id
    from public.no_visibili(p_persona) n
    where n.domanda = p_domanda and now() <= n.visibile_dal + interval '14 days'
    on conflict do nothing;
  return 'inviata';
end $$;
revoke all on function public.contesta_no(uuid, text, text) from public, anon, authenticated;
grant execute on function public.contesta_no(uuid, text, text) to service_role;

-- Per ogni domanda con un «No» visibile o una contestazione: { contestabile, stato dell'ultima contestazione }.
-- Mai id, nomi o date.
create function public.stato_contestazioni_no(p_persona uuid) returns jsonb
  language sql stable set search_path = '' as $$
  with domande as (
    select n.domanda from public.no_visibili(p_persona) n
    union
    select c.domanda from public.contestazioni_no c where c.persona = p_persona
  )
  select coalesce(jsonb_object_agg(d.domanda, jsonb_build_object(
    'contestabile', exists (
      select 1 from public.no_visibili(p_persona) n
      where n.domanda = d.domanda and now() <= n.visibile_dal + interval '14 days'
        and not exists (select 1 from public.contestazioni_no_valutazioni c
                        where c.porta_id = n.porta_id and c.rispondente = n.rispondente and c.domanda = n.domanda)),
    'stato', (select c.stato from public.contestazioni_no c where c.persona = p_persona and c.domanda = d.domanda
              order by c.inviata_il desc limit 1))), '{}'::jsonb)
  from domande d
$$;
revoke all on function public.stato_contestazioni_no(uuid) from public, anon, authenticated;
grant execute on function public.stato_contestazioni_no(uuid) to service_role;

-- Decisione: accolta, respinta, gia_decisa, non_trovata.
create function public.decidi_contestazione_no(p_id uuid, p_decisore uuid, p_accolta boolean) returns text
  language plpgsql set search_path = '' as $$
begin
  if p_accolta is null then
    return 'non_trovata';
  end if;
  update public.contestazioni_no
    set stato = case when p_accolta then 'accolta' else 'respinta' end, deciso_da = p_decisore, deciso_il = now()
    where id = p_id and stato = 'in_attesa';
  if found then
    return case when p_accolta then 'accolta' else 'respinta' end;
  end if;
  return case when exists (select 1 from public.contestazioni_no where id = p_id) then 'gia_decisa' else 'non_trovata' end;
end $$;
revoke all on function public.decidi_contestazione_no(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.decidi_contestazione_no(uuid, uuid, boolean) to service_role;

-- Riepilogo (stessa firma e stessa uscita di 20261121095500): un «No» con contestazione accolta non conta più.
create or replace function public.riepilogo_valutazioni(p_persona uuid) returns jsonb
  language plpgsql stable set search_path = '' as $$
declare
  v_giorni constant integer := 7;
  v_bollini_dopo constant integer := 3;
  v_valutati integer;
  v_presentato integer;
  v_foto integer;
  v_chiamata integer;
  v_no jsonb;
begin
  with scoperte as (
    select v.presentato, v.foto_sue, v.come_in_chiamata,
           exists (select 1 from public.contestazioni_no_valutazioni a join public.contestazioni_no c on c.id = a.contestazione_id
                   where a.porta_id = v.porta_id and a.rispondente = v.persona and a.domanda = 'presentato' and c.stato = 'accolta') as ann_presentato,
           exists (select 1 from public.contestazioni_no_valutazioni a join public.contestazioni_no c on c.id = a.contestazione_id
                   where a.porta_id = v.porta_id and a.rispondente = v.persona and a.domanda = 'foto_sue' and c.stato = 'accolta') as ann_foto,
           exists (select 1 from public.contestazioni_no_valutazioni a join public.contestazioni_no c on c.id = a.contestazione_id
                   where a.porta_id = v.porta_id and a.rispondente = v.persona and a.domanda = 'come_in_chiamata' and c.stato = 'accolta') as ann_chiamata
    from public.valutazioni v
    join public.incontri i on i.porta_id = v.porta_id
    where v.valutato = p_persona
      and (exists (select 1 from public.valutazioni m where m.porta_id = v.porta_id and m.persona = p_persona)
           or now() > i.esito_il + make_interval(days => v_giorni))
  )
  select count(*), count(*) filter (where presentato <> 'no' or ann_presentato), count(*) filter (where foto_sue = 'si'),
         count(*) filter (where come_in_chiamata = 'si'),
         to_jsonb(array_remove(array[
           case when bool_or(come_in_chiamata = 'no' and not ann_chiamata) then 'come_in_chiamata' end,
           case when bool_or(foto_sue = 'no' and not ann_foto) then 'foto_sue' end,
           case when bool_or(presentato = 'no' and not ann_presentato) then 'presentato' end], null))
    into v_valutati, v_presentato, v_foto, v_chiamata, v_no
    from scoperte;
  return jsonb_build_object(
    'valutati', v_valutati,
    'bollini', case when v_valutati >= v_bollini_dopo then
      jsonb_build_object('presentato', v_presentato, 'foto_sue', v_foto, 'come_in_chiamata', v_chiamata) end,
    'no_ricevuti', coalesce(v_no, '[]'::jsonb));
end $$;
revoke all on function public.riepilogo_valutazioni(uuid) from public, anon, authenticated;
grant execute on function public.riepilogo_valutazioni(uuid) to service_role;
