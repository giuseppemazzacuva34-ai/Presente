-- Test del Filo assegnato per area (issue #360, spec v1.2 del CPO del 25/11): l'amministratore assegna un Filo a un'area
-- (una città o la Stanza Italia); a ogni composizione del lunedì tutte le stanze di quell'area ricevono quel Filo; il
-- cambio su una sola stanza vale solo per quella; area senza Filo = stanza senza Filo. Linea «sviluppatore-c».
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Persona 9 = amministratore, 1 = Filo di Milano, 5 = Filo della Stanza Italia, 6 = altro Filo, 2-4 = membri.
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
  select ('f8f8f8f8-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f8f8f8f8-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
create function pg_temp.filo(stanza uuid) returns uuid language sql as $$
  select f.filo from public.fili_stanza f where f.stanza_id = stanza
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'fr' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome, data_nascita, citta) values
  (pg_temp.p(1), 'Silvia', '1980-01-01', 'Milano'), (pg_temp.p(2), 'Anna', '1990-01-01', 'Milano'),
  (pg_temp.p(3), 'Bruno', '1990-01-01', 'Milano'), (pg_temp.p(4), 'Carlo', '1985-01-01', 'Roma'),
  (pg_temp.p(5), 'Marta', '1982-01-01', 'Bari'), (pg_temp.p(6), 'Luca', '1984-01-01', 'Milano');
insert into public.moderatori (persona) values (pg_temp.p(9));

-- Il telefono non legge le aree e non chiama le funzioni.
select pg_temp.come(pg_temp.p(9));
select pg_temp.ok(pg_temp.errore('select * from public.fili_area') is not null
  and pg_temp.errore('select * from public.fili_aree_amministratore(auth.uid())') is not null
  and pg_temp.errore(format('select public.assegna_filo_area(auth.uid(), %L, %L, %L, now())', 'citta', 'Milano', 'fr1@example.com')) is not null
  and pg_temp.errore(format('select public.togli_filo_area(auth.uid(), %L, %L)', 'citta', 'Milano')) is not null,
  'filo area: il telefono non legge le aree né chiama le funzioni');
reset role;

set local role service_role;
-- Solo l'amministratore.
select pg_temp.ok(pg_temp.errore(format('select * from public.fili_aree_amministratore(%L)', pg_temp.p(4))) = 'non_amministratore'
  and pg_temp.errore(format('select public.assegna_filo_area(%L, %L, %L, %L, now())', pg_temp.p(4), 'citta', 'Milano', 'fr1@example.com')) = 'non_amministratore'
  and pg_temp.errore(format('select public.togli_filo_area(%L, %L, %L)', pg_temp.p(4), 'citta', 'Milano')) = 'non_amministratore'
  and pg_temp.errore('select * from public.fili_aree_amministratore(null)') = 'non_amministratore',
  'filo area: chi non è amministratore è rifiutato');

-- Assegnare: area valida (città con nome, Italia senza), persona esistente per email.
select pg_temp.ok(pg_temp.errore(format('select public.assegna_filo_area(%L, %L, %L, %L, now())', pg_temp.p(9), 'citta', 'Milano', 'nessuno@example.com')) = 'persona'
  and pg_temp.errore(format('select public.assegna_filo_area(%L, %L, %L, %L, now())', pg_temp.p(9), 'citta', '  ', 'fr1@example.com')) = 'area'
  and pg_temp.errore(format('select public.assegna_filo_area(%L, %L, %L, %L, now())', pg_temp.p(9), 'italia', 'Milano', 'fr1@example.com')) = 'area'
  and pg_temp.errore(format('select public.assegna_filo_area(%L, %L, %L, %L, now())', pg_temp.p(9), 'regione', 'Lombardia', 'fr1@example.com')) = 'area'
  and pg_temp.errore(format('select public.assegna_filo_area(%L, null, null, %L, now())', pg_temp.p(9), 'fr1@example.com')) = 'area'
  and (select count(*) from public.fili_area) = 0,
  'filo area: rifiutata con area non valida o persona sconosciuta');
select public.assegna_filo_area(pg_temp.p(9), 'citta', ' milano ', ' FR6@example.com', '2026-03-28 10:00+00');
select public.assegna_filo_area(pg_temp.p(9), 'citta', 'Milano', 'fr1@example.com', '2026-03-28 11:00+00');
select public.assegna_filo_area(pg_temp.p(9), 'italia', null, 'fr5@example.com', '2026-03-28 11:00+00');
select pg_temp.ok((select count(*) from public.fili_area) = 2
  and (select a.filo_nome from public.fili_aree_amministratore(pg_temp.p(9)) a where a.tipo = 'citta' and lower(a.citta) = 'milano') = 'Silvia'
  and (select a.filo_nome from public.fili_aree_amministratore(pg_temp.p(9)) a where a.tipo = 'italia' and a.citta is null) = 'Marta',
  'filo area: un Filo per area (la seconda assegnazione sostituisce la prima, maiuscole e spazi non contano)');

-- Composizione del lunedì: tutte le stanze dell'area ricevono il Filo dell'area; un'area senza Filo resta senza.
-- Le stanze e i membri li scrive il lavoro del lunedì: qui come superutente.
reset role;
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il) values
  (pg_temp.s(1), 'citta', 'Milano', '2026-03-30 07:00+00', '2026-04-05 19:00+00', '2026-03-29 22:30+00'),
  (pg_temp.s(2), 'citta', 'Milano', '2026-03-30 07:00+00', '2026-04-05 19:00+00', '2026-03-29 22:30+00'),
  (pg_temp.s(3), 'citta', 'Roma', '2026-03-30 07:00+00', '2026-04-05 19:00+00', '2026-03-29 22:30+00'),
  (pg_temp.s(4), 'italia', null, '2026-03-30 07:00+00', '2026-04-05 19:00+00', '2026-03-29 22:30+00');
insert into public.membri_stanza (stanza_id, utente_id) values (pg_temp.s(1), pg_temp.p(2)), (pg_temp.s(2), pg_temp.p(3)),
  (pg_temp.s(3), pg_temp.p(4));
set local role service_role;
select pg_temp.ok(pg_temp.filo(pg_temp.s(1)) = pg_temp.p(1) and pg_temp.filo(pg_temp.s(2)) = pg_temp.p(1)
  and pg_temp.filo(pg_temp.s(3)) is null and pg_temp.filo(pg_temp.s(4)) = pg_temp.p(5)
  and (select f.assegnato_il from public.fili_stanza f where f.stanza_id = pg_temp.s(1)) = '2026-03-29 22:30+00',
  'filo area: alla composizione le stanze di Milano hanno il Filo di Milano, Italia il suo, Roma nessuno');

-- Il Filo dell'area che entra come membro in una stanza della sua area non ne è il Filo (la stanza resta senza).
reset role;
insert into public.membri_stanza (stanza_id, utente_id) values (pg_temp.s(4), pg_temp.p(5));
set local role service_role;
select pg_temp.ok(pg_temp.filo(pg_temp.s(4)) is null, 'filo area: un membro della stanza non ne diventa il Filo');

-- Il cambio su una sola stanza non tocca l'altra.
select public.assegna_filo_stanza(pg_temp.p(9), pg_temp.s(2), 'fr6@example.com', '2026-03-30 08:00+00');
select pg_temp.ok(pg_temp.filo(pg_temp.s(1)) = pg_temp.p(1) and pg_temp.filo(pg_temp.s(2)) = pg_temp.p(6)
  and (select f.filo from public.fili_area f where f.tipo = 'citta') = pg_temp.p(1),
  'filo area: il cambio su una stanza vale solo per quella');

-- Il lunedì dopo torna il Filo dell'area.
reset role;
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il) values
  (pg_temp.s(5), 'citta', 'MILANO', '2026-04-06 07:00+00', '2026-04-12 19:00+00', '2026-04-05 22:30+00');
set local role service_role;
select pg_temp.ok(pg_temp.filo(pg_temp.s(5)) = pg_temp.p(1), 'filo area: il lunedì dopo torna il Filo dell''area');

-- Togliere il Filo dall'area: le stanze già composte lo tengono, le nuove no.
select pg_temp.ok(public.togli_filo_area(pg_temp.p(9), 'citta', 'milano') and not public.togli_filo_area(pg_temp.p(9), 'citta', 'Milano'),
  'filo area: togliere vale una volta');
reset role;
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il) values
  (pg_temp.s(6), 'citta', 'Milano', '2026-04-13 07:00+00', '2026-04-19 19:00+00', '2026-04-12 22:30+00');
set local role service_role;
select pg_temp.ok(pg_temp.filo(pg_temp.s(6)) is null and pg_temp.filo(pg_temp.s(5)) = pg_temp.p(1),
  'filo area: tolto il Filo dall''area le stanze nuove sono senza Filo, quelle composte lo tengono');
rollback;
