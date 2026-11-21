-- Test della tabella «locali» (issue #6, spec v1.1 del CPO del 20/11, punto 1). Linea «sviluppatore-b», passo 2s.
-- Tabella vuota per i locali consigliati: nessun dato personale, sola lettura per gli utenti e solo i locali
-- «visitato»; scrive solo il server. Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
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
create function pg_temp.come(utente uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

begin;
select pg_temp.ok((select count(*) from public.locali where stato = 'visitato') = 0, 'locali: nessun locale «visitato» all''inizio');
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.locali'::regclass), 'locali: regole per riga attive');

set local role service_role;
insert into public.locali (nome, indirizzo, provincia, area, tipo, fascia, stato) values
  ('Caffè Prova', 'Via Inventata 1', 'MI', null, 'caffè', 'fino a 10 €', 'visitato'),
  ('Bar Prova', 'Via Inventata 2', 'MI', null, 'bar', null, 'da_visitare'),
  ('Enoteca Prova', 'Via Inventata 3', 'TO', null, 'enoteca', null, 'escluso');
select pg_temp.ok((select stato from public.locali where nome = 'Bar Prova') = 'da_visitare', 'locali: il server scrive');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.locali (nome, indirizzo, provincia, area, tipo, stato)
  values ('X', 'Via 1', 'MI', 'milano', 'discoteca', 'visitato')$$), 'locali: tipo fuori elenco rifiutato');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.locali (nome, indirizzo, provincia, area, tipo, stato)
  values ('X', 'Via 1', 'MI', 'milano', 'bar', 'aperto')$$), 'locali: stato fuori elenco rifiutato');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.locali (nome, indirizzo, provincia, area, tipo, stato)
  values ('X', 'Via 1', 'ZZ', 'milano', 'bar', 'visitato')$$), 'locali: provincia che non esiste rifiutata');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.locali (nome, indirizzo, provincia, area, tipo, stato)
  values ('X', 'Via 1', 'MI', 'torino', 'bar', 'visitato')$$), 'locali: area diversa da quella della provincia rifiutata');
select pg_temp.ok((select area from public.locali where nome = 'Caffè Prova') = 'milano', 'locali: l''area la mette il database dalla provincia');
reset role;

insert into auth.users (id, email) values ('1ca11000-0000-4000-8000-000000000001', 'locali1@example.com');
select pg_temp.come('1ca11000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*) from public.locali) = 1, 'locali: chi usa l''app vede solo i locali «visitato»');
select pg_temp.ok((select nome from public.locali) = 'Caffè Prova', 'locali: è quello visitato');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.locali (nome, indirizzo, provincia, area, tipo, stato)
  values ('X', 'Via 1', 'MI', 'milano', 'bar', 'visitato')$$), 'locali: chi usa l''app non aggiunge');
select pg_temp.ok(pg_temp.rifiutato($$update public.locali set stato = 'visitato' where true$$), 'locali: chi usa l''app non cambia lo stato');
select pg_temp.ok(pg_temp.rifiutato($$delete from public.locali where true$$), 'locali: chi usa l''app non cancella');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select count(*) from public.locali$$), 'locali: chi non ha fatto l''accesso non legge');
reset role;
rollback;
