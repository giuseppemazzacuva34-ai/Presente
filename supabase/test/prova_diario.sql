-- Test del diario privato nel database (issue #5, spec v1.1 del CPO, passi 2-3; D51 A). Linea «sviluppatore-c».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: il diario lo legge e lo scrive solo chi lo scrive; nessuna funzione del server lo legge (nemmeno il ruolo di
-- servizio); solo dopo una chiamata che conta (>= 60 s); max 1000 caratteri; si conserva finché l'utente non lo
-- cancella o elimina l'account (un diario di 7 mesi prima è ancora leggibile).
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
create function pg_temp.rifiutato(comando text) returns boolean language plpgsql as $$
begin
  execute comando;
  return false;
exception when others then
  return true;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('d1d1d1d1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'di' || n || '@example.com' from generate_series(1, 3) n;
-- 1 ha chiamato 2 per 300 s (ieri) e per 30 s (caduta, oggi); 2 ha chiamato 1 sette mesi fa per 120 s.
insert into public.chiamate (chi, con, inizio, durata, esito) values
  (pg_temp.p(1), pg_temp.p(2), '2026-11-13 18:00+00', 300, 'tempo_scaduto'),
  (pg_temp.p(1), pg_temp.p(2), '2026-11-14 09:00+00', 30, 'caduta'),
  (pg_temp.p(2), pg_temp.p(1), '2026-04-10 18:00+00', 120, 'chiusa');

select pg_temp.come(pg_temp.p(1));
insert into public.diario (con, chiamata_il, durata, testo)
  values (pg_temp.p(2), '2026-11-13 18:00+00', 300, 'Ride come mia sorella.');
insert into public.diario (con, chiamata_il, durata, testo)
  values (pg_temp.p(2), '2026-04-10 18:00+00', 120, 'Prima chiamata, sette mesi fa.');
select pg_temp.ok((select count(*) from public.diario) = 2
  and (select utente_id from public.diario limit 1) = pg_temp.p(1),
  'diario: chi ha fatto la chiamata scrive le sue note (anche per una chiamata ricevuta)');
select pg_temp.ok((select testo from public.diario where chiamata_il = '2026-04-10 18:00+00') = 'Prima chiamata, sette mesi fa.',
  'diario: una nota di 7 mesi prima è ancora leggibile dal proprietario');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.diario (con, chiamata_il, durata, testo)
    values ('d1d1d1d1-0000-4000-8000-000000000002', '2026-11-14 09:00+00', 30, 'caduta')$$)
  and pg_temp.rifiutato($$insert into public.diario (con, chiamata_il, durata, testo)
    values ('d1d1d1d1-0000-4000-8000-000000000003', '2026-11-13 18:00+00', 300, 'mai chiamato')$$)
  and pg_temp.rifiutato($$insert into public.diario (con, chiamata_il, durata, testo)
    values ('d1d1d1d1-0000-4000-8000-000000000002', '2026-11-13 18:00+00', 900, 'durata finta')$$),
  'diario: niente note per una chiamata caduta (< 60 s), per chi non hai chiamato o con una durata inventata');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.diario (utente_id, con, chiamata_il, durata, testo)
    values ('d1d1d1d1-0000-4000-8000-000000000002', 'd1d1d1d1-0000-4000-8000-000000000001', '2026-11-13 18:00+00', 300, 'a nome di 2')$$),
  'diario: non si scrive a nome di un altro');
select pg_temp.ok(pg_temp.rifiutato(format($$insert into public.diario (con, chiamata_il, durata, testo)
    values ('d1d1d1d1-0000-4000-8000-000000000002', '2026-11-13 18:00+00', 300, %L)$$, repeat('a', 1001)))
  and pg_temp.rifiutato($$insert into public.diario (con, chiamata_il, durata, testo)
    values ('d1d1d1d1-0000-4000-8000-000000000002', '2026-11-13 18:00+00', 300, '   ')$$),
  'diario: massimo 1000 caratteri, niente note vuote');
update public.diario set testo = 'Ride come mia cugina.' where chiamata_il = '2026-11-13 18:00+00';
select pg_temp.ok((select testo from public.diario where chiamata_il = '2026-11-13 18:00+00') = 'Ride come mia cugina.'
  and pg_temp.rifiutato($$update public.diario set con = 'd1d1d1d1-0000-4000-8000-000000000003'$$)
  and pg_temp.rifiutato($$update public.diario set durata = 900$$),
  'diario: si modifica solo il testo');
reset role;

-- 2 (l'altra persona) non vede niente, nemmeno quante note ci sono; nemmeno chi non ha accesso.
select pg_temp.come(pg_temp.p(2));
with cambiate as (update public.diario set testo = 'x' where true returning 1)
select pg_temp.ok((select count(*) from cambiate) = 0 and (select count(*) from public.diario) = 0,
  'diario: l''altra persona non legge né modifica le note di chi le ha scritte');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.diario$$), 'diario: senza accesso nessuna lettura');
reset role;
-- Nemmeno il server: nessun algoritmo, supporto o pannello lo legge.
set local role service_role;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.diario$$)
  and pg_temp.rifiutato($$select count(*) from public.diario$$),
  'diario: il ruolo di servizio (suggerimenti, stanze, supporto, pannello) non lo legge');
reset role;
select pg_temp.ok(not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* '\mdiario\M'),
  'diario: nessuna funzione del database nomina il diario');

-- «Elimina»: la nota non esiste più.
select pg_temp.come(pg_temp.p(1));
delete from public.diario where chiamata_il = '2026-04-10 18:00+00';
reset role;
select pg_temp.ok((select count(*) from public.diario where utente_id = pg_temp.p(1)) = 1,
  'diario: «Elimina» cancella la nota dal database');
-- «Elimina il mio account»: il diario sparisce; quello di chi resta perde solo l'id di chi se n'è andato.
insert into public.chiamate (chi, con, inizio, durata, esito) values (pg_temp.p(3), pg_temp.p(1), '2026-11-12 18:00+00', 200, 'chiusa');
select pg_temp.come(pg_temp.p(3));
insert into public.diario (con, chiamata_il, durata, testo) values (pg_temp.p(1), '2026-11-12 18:00+00', 200, 'Simpatica.');
reset role;
delete from auth.users where id = pg_temp.p(1);
select pg_temp.ok(not exists (select 1 from public.diario where utente_id = pg_temp.p(1))
  and (select con from public.diario where utente_id = pg_temp.p(3)) is null
  and (select testo from public.diario where utente_id = pg_temp.p(3)) = 'Simpatica.',
  'diario: con «Elimina il mio account» il diario non esiste più; le note degli altri restano, senza il suo id');
rollback;
