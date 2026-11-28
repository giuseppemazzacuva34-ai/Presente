-- Fase 2 · issue #6 spec v1 del CPO (3/11), «Casi limite» · «Foto non sue» (D51 A) · linea «sviluppatore-b».
-- «2 "No" da persone diverse → controllo: la persona deve scattare una foto nell'app entro 7 giorni; finché non lo fa
-- non entra in nuove stanze. Revisione di Giuseppe, ricorso possibile.» v1.3: un «No» con contestazione accolta non conta.
--   · Il controllo si calcola, non si scrive: «No» a «le foto erano sue?» visibili (stessa regola alla cieca di
--     no_visibili), non accolti, da almeno 2 persone diverse, dopo l'ultima verifica della foto.
--   · Scadenza: 7 giorni da quando il secondo «No» è diventato visibile (solo da mostrare: il blocco resta finché
--     un moderatore non verifica).
--   · Niente nuove stanze: «Ci sarò lunedì» rifiutato (errore «controllo_foto») e righe_settimana salta chi è in
--     controllo (stessa funzione di 20261108220000, solo un filtro in più), così anche una conferma fatta prima resta fuori.
--   · verifica_foto(moderatore, persona): un moderatore (in beta Giuseppe), mai su sé stesso, chiude il controllo.
--     La foto scattata nell'app e il pannello sono passi successivi.
-- Tutto solo dal server (service_role); il telefono non legge chi ha detto «No». Solo aggiunte, più righe_settimana.

create table public.verifiche_foto (
  id uuid primary key default gen_random_uuid(),
  persona uuid not null references auth.users (id) on delete cascade,
  verificata_da uuid not null,
  verificata_il timestamptz not null default now()
);
create index verifiche_foto_persona on public.verifiche_foto (persona, verificata_il desc);
alter table public.verifiche_foto enable row level security;
revoke all on public.verifiche_foto from public, anon, authenticated;
grant select, insert on public.verifiche_foto to service_role;
-- Nessuna regola per authenticated: il telefono passa solo dal Worker.

-- { attivo: false } oppure { attivo: true, scade_il }. Mai chi, mai quale incontro.
create function public.controllo_foto(p_persona uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with ultima as (
    select max(v.verificata_il) as il from public.verifiche_foto v where v.persona = p_persona
  ),
  no_validi as (
    select n.rispondente, min(n.visibile_dal) as dal
    from public.no_visibili(p_persona) n, ultima u
    where n.domanda = 'foto_sue'
      and (u.il is null or n.visibile_dal > u.il)
      and not exists (select 1 from public.contestazioni_no_valutazioni cv
                      join public.contestazioni_no c on c.id = cv.contestazione_id and c.stato = 'accolta'
                      where cv.porta_id = n.porta_id and cv.rispondente = n.rispondente and cv.domanda = n.domanda)
    group by n.rispondente
  ),
  secondo as (
    select dal from no_validi order by dal offset 1 limit 1
  )
  select case when exists (select 1 from secondo)
    then jsonb_build_object('attivo', true, 'scade_il', (select dal + interval '7 days' from secondo))
    else jsonb_build_object('attivo', false) end
$$;
revoke all on function public.controllo_foto(uuid) from public, anon, authenticated;
grant execute on function public.controllo_foto(uuid) to service_role;

create function public.in_controllo_foto(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_persona is not null and coalesce((public.controllo_foto(p_persona) ->> 'attivo')::boolean, false)
$$;
revoke all on function public.in_controllo_foto(uuid) from public, anon, authenticated;
grant execute on function public.in_controllo_foto(uuid) to service_role;

-- Nessuna conferma nuova per chi è in controllo, qualunque strada si usi.
create function public.conferme_stanza_controllo_foto() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if public.in_controllo_foto(new.utente_id) then
    raise exception 'controllo_foto' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.conferme_stanza_controllo_foto() from public, anon, authenticated;
create trigger conferme_stanza_controllo_foto before insert on public.conferme_stanza
  for each row execute function public.conferme_stanza_controllo_foto();

-- Risposte: verificata, nessun_controllo, non_moderatore, propria.
create function public.verifica_foto(p_moderatore uuid, p_persona uuid) returns text
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_moderatore) then
    return 'non_moderatore';
  end if;
  if p_persona is not null and p_persona = p_moderatore and public.in_controllo_foto(p_persona) then
    return 'propria';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('verifica_foto:' || coalesce(p_persona::text, ''), 0)); -- doppi tocchi
  if not public.in_controllo_foto(p_persona) then
    return 'nessun_controllo';
  end if;
  insert into public.verifiche_foto (persona, verificata_da) values (p_persona, p_moderatore);
  return 'verificata';
end $$;
revoke all on function public.verifica_foto(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verifica_foto(uuid, uuid) to service_role;

-- Lavoro del lunedì: come in 20261108220000_lavoro_lunedi.sql, in più senza chi è in controllo foto.
create or replace function public.righe_settimana(apre timestamptz) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with confermati as (
    select c.utente_id, c.confermata_il from public.conferme_stanza c
    where c.apre_il = apre and not public.in_controllo_foto(c.utente_id)
  ),
  passate as (
    select s.id, s.apre_il from public.stanze s where s.apre_il < apre and s.apre_il >= apre - interval '28 days'
  )
  select jsonb_build_object(
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profilo', jsonb_build_object('id', p.id, 'nome', p.nome, 'data_nascita', p.data_nascita, 'citta', p.citta,
          'provincia', case when p.provincia_in_vigore_dal > apre then p.provincia_precedente else p.provincia end,
          'paese', p.paese, 'mi_presento_come', p.mi_presento_come, 'passo', p.passo),
        'filtri', case when f.utente_id is null then null else jsonb_build_object('cerco', f.cerco,
          'consenso_cerco_il', f.consenso_cerco_il, 'eta_min', f.eta_min, 'eta_max', f.eta_max, 'raggio', f.raggio) end,
        'questionario', coalesce((select jsonb_agg(jsonb_build_object('versione', q.versione, 'in_vigore_dal', q.in_vigore_dal,
          'risposte', q.risposte, 'importanza', q.importanza)) from public.questionario q where q.utente_id = p.id), '[]'::jsonb)
      ) order by p.id)
      from confermati c join public.profili p on p.id = c.utente_id
      left join public.filtri f on f.utente_id = p.id), '[]'::jsonb),
    'iscrizioni', coalesce((select jsonb_object_agg(c.utente_id, c.confermata_il) from confermati c), '{}'::jsonb),
    'stanze_precedenti', coalesce((select jsonb_object_agg(x.utente_id, x.quante) from (
      select m.utente_id, count(*) as quante from public.membri_stanza m join public.stanze s on s.id = m.stanza_id
      where s.apre_il < apre
      group by m.utente_id) x), '{}'::jsonb),
    'storico', coalesce((select jsonb_agg(jsonb_build_object('stanza_id', m.stanza_id, 'utente_id', m.utente_id, 'apre_il', ps.apre_il))
      from public.membri_stanza m join passate ps on ps.id = m.stanza_id), '[]'::jsonb)
  )
$$;
revoke all on function public.righe_settimana(timestamptz) from public, anon, authenticated;
grant execute on function public.righe_settimana(timestamptz) to service_role;
