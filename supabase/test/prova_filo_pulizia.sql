-- Test della pulizia dei vocali del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A: «I file dei vocali spariscono
-- 7 giorni dopo la chiusura»), passo 11a della linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un
-- Postgres di prova. Dati inventati, orologio finto.
-- Stanza 1: chiude domenica 29/3/2026 19:00 UTC → i vocali si tolgono dal 5/4 19:00 UTC. Stanza 2: chiude il 5/4.
\set ON_ERROR_STOP on
create function pg_temp.come(utente uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.errore(comando text) returns text language plpgsql as $$
begin
  execute comando;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('f6f6f6f6-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f6f6f6f6-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
create function pg_temp.scaduti(ora text) returns text language sql as $$
  select coalesce(string_agg(v.percorso, ',' order by v.percorso), '') from public.vocali_filo_scaduti(ora::timestamptz) v
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'fp' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profili (id, nome, data_nascita, citta) values
  (pg_temp.p(1), 'Silvia', '1980-01-01', 'Milano'), (pg_temp.p(2), 'Anna', '1990-01-01', 'Milano'),
  (pg_temp.p(3), 'Bruno', '1990-01-01', 'Milano');
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il) values
  (pg_temp.s(1), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00'),
  (pg_temp.s(2), 'citta', 'Milano', '2026-03-30 07:00+00', '2026-04-05 19:00+00', '2026-03-29 22:30+00');
insert into public.membri_stanza (stanza_id, utente_id) values (pg_temp.s(1), pg_temp.p(2)), (pg_temp.s(2), pg_temp.p(3));
insert into public.fili_stanza (stanza_id, filo) values (pg_temp.s(1), pg_temp.p(1)), (pg_temp.s(2), pg_temp.p(1));
insert into public.vocali_filo (stanza_id, tipo, file, durata, testo, caricato_il) values
  -- Come li salva salva_vocale_filo: «file» è già il percorso nel contenitore, <stanza>/<nome>.
  (pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/a1.webm', 70, 'Benvenuti', '2026-03-23 07:00+00'),
  (pg_temp.s(1), 'domenica', pg_temp.s(1) || '/a2.webm', 48, 'A tra poco', '2026-03-29 17:00+00'),
  (pg_temp.s(2), 'lunedi', pg_temp.s(2) || '/b1.webm', 60, 'Ciao', '2026-03-30 06:00+00');
insert into public.filo_benvenuti_visti (utente_id, stanza_id) values (pg_temp.p(2), pg_temp.s(1)), (pg_temp.p(3), pg_temp.s(2));
insert into public.filo_vocali_ascoltati (utente_id, stanza_id) values (pg_temp.p(2), pg_temp.s(1)), (pg_temp.p(3), pg_temp.s(2));

-- Il telefono non chiama le funzioni.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.errore('select * from public.vocali_filo_scaduti(now())') is not null
  and pg_temp.errore('select public.togli_vocali_filo(array[''x''], now())') is not null,
  'pulizia filo: il telefono non chiama le funzioni');
reset role;

set local role service_role;
select pg_temp.ok(pg_temp.scaduti('2026-04-05 18:59+00') = '',
  'pulizia filo: prima dei 7 giorni dalla chiusura nessun vocale da togliere');
select pg_temp.ok(pg_temp.scaduti('2026-04-05 19:00+00') = pg_temp.s(1) || '/a1.webm,' || pg_temp.s(1) || '/a2.webm',
  'pulizia filo: 7 giorni dopo la chiusura i due vocali della stanza (percorso nel contenitore)');

-- Si tolgono solo i percorsi dati E scaduti: un percorso non scaduto o inventato non toglie nulla.
select pg_temp.ok(public.togli_vocali_filo(array[pg_temp.s(1) || '/a1.webm', pg_temp.s(2) || '/b1.webm', 'x/y.webm'],
  '2026-04-05 19:00+00') = 1, 'pulizia filo: tolto solo il vocale scaduto tra quelli dati');
select pg_temp.ok(pg_temp.scaduti('2026-04-05 19:00+00') = pg_temp.s(1) || '/a2.webm'
  and (select count(*) from public.vocali_filo where stanza_id = pg_temp.s(2)) = 1,
  'pulizia filo: resta l''altro vocale scaduto (prossimo giro) e quello della stanza 2');
select pg_temp.ok(public.togli_vocali_filo(array[pg_temp.s(1) || '/a2.webm'], '2026-04-05 19:00+00') = 1
  and public.togli_vocali_filo(array[pg_temp.s(1) || '/a2.webm'], '2026-04-05 19:00+00') = 0
  and public.togli_vocali_filo(null, '2026-04-05 19:00+00') = 0,
  'pulizia filo: togliere due volte o senza percorsi non dà errori');
select pg_temp.ok(pg_temp.scaduti('2026-04-12 19:00+00') = pg_temp.s(2) || '/b1.webm',
  'pulizia filo: la stanza 2 tocca una settimana dopo');
reset role;
-- Con i vocali spariscono anche «già vista» e «già ascoltato» delle stanze scadute; quelli della stanza 2 restano.
select pg_temp.ok((select count(*) from public.filo_benvenuti_visti where stanza_id = pg_temp.s(1)) = 0
  and (select count(*) from public.filo_vocali_ascoltati where stanza_id = pg_temp.s(1)) = 0
  and (select count(*) from public.filo_benvenuti_visti where stanza_id = pg_temp.s(2)) = 1
  and (select count(*) from public.filo_vocali_ascoltati where stanza_id = pg_temp.s(2)) = 1,
  'pulizia filo: tolti anche «vista» e «ascoltato» delle stanze scadute, non delle altre');
rollback;
