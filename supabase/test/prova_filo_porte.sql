-- Test del numero delle porte per il Filo e per la schermata 36 (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 6a
-- della linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati,
-- orologio finto. Spec: alle 21:00 il server conta le coppie con chiave reciproca (la stessa regola della sera delle
-- porte, #5), il numero si salva una volta sola e non cambia; prima delle 21:00 nessuno lo legge; il Filo legge solo
-- l'intero, mai chi; la schermata 36 non compare nelle stanze senza Filo.
-- Stanza della settimana del cambio d'ora: apre lunedì 23/3/2026 9:00 CET = 08:00 UTC, chiude domenica 29/3
-- 21:00 CEST = 19:00 UTC.
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
  select ('f4f4f4f4-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f4f4f4f4-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
-- Il numero che il Filo p(1) legge per la stanza s(n) all'ora data (null = non ancora / non più).
create function pg_temp.filo(n integer, ora text) returns integer language sql as $$
  select public.porte_stanza_filo(pg_temp.p(1), pg_temp.s(n), ora::timestamptz)
$$;
-- Il numero della schermata 36 per la persona n all'ora data (null = la schermata non compare).
create function pg_temp.membro(n integer, ora text) returns integer language sql as $$
  select m.porte from public.porte_stanza_membro(pg_temp.p(n), ora::timestamptz) m
$$;

begin;
-- p(1) Filo della stanza 1. Stanza 1: p(2)..p(13), 12 persone finte (prova finta D141). Stanza 2 senza Filo: p(14),
-- p(15). p(16) non è in nessuna stanza.
insert into auth.users (id, email) select pg_temp.p(n), 'fp' || n || '@example.com' from generate_series(1, 16) n;
insert into public.profili (id, nome, data_nascita, citta)
  select pg_temp.p(n), 'Nome' || chr(96 + n), '1990-01-01', 'Milano' from generate_series(1, 16) n;
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il)
  select pg_temp.s(n), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00'
  from generate_series(1, 2) n;
insert into public.membri_stanza (stanza_id, utente_id)
  select pg_temp.s(1), pg_temp.p(n) from generate_series(2, 13) n;
insert into public.membri_stanza (stanza_id, utente_id) values (pg_temp.s(2), pg_temp.p(14)), (pg_temp.s(2), pg_temp.p(15));
insert into public.fili_stanza (stanza_id, filo) values (pg_temp.s(1), pg_temp.p(1));
-- Stanza 1: chiavi reciproche 2↔3, 4↔5, 6↔7; chiave non ricambiata 8→9. Stanza 2: 14↔15.
insert into public.chiavi (stanza_id, da, a) values
  (pg_temp.s(1), pg_temp.p(2), pg_temp.p(3)), (pg_temp.s(1), pg_temp.p(3), pg_temp.p(2)),
  (pg_temp.s(1), pg_temp.p(4), pg_temp.p(5)), (pg_temp.s(1), pg_temp.p(5), pg_temp.p(4)),
  (pg_temp.s(1), pg_temp.p(6), pg_temp.p(7)), (pg_temp.s(1), pg_temp.p(7), pg_temp.p(6)),
  (pg_temp.s(1), pg_temp.p(8), pg_temp.p(9)),
  (pg_temp.s(2), pg_temp.p(14), pg_temp.p(15)), (pg_temp.s(2), pg_temp.p(15), pg_temp.p(14));

-- Il telefono non chiama le funzioni.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.errore(format('select public.porte_stanza_filo(%L, %L, now())', pg_temp.p(1), pg_temp.s(1)))
  is not null, 'porte filo: il telefono non chiama la funzione del Filo');
select pg_temp.ok(pg_temp.errore(format('select * from public.porte_stanza_membro(%L, now())', pg_temp.p(2)))
  is not null, 'porte filo: il telefono non chiama la funzione della schermata 36');
reset role;

set local role service_role;
-- Prima delle 21:00 (e prima che il server apra le porte) nessuno legge il numero.
select pg_temp.ok(pg_temp.filo(1, '2026-03-29 18:59+00') is null and pg_temp.membro(2, '2026-03-29 18:59+00') is null,
  'porte filo: prima delle 21:00 né il Filo né i membri leggono il numero');
-- Alle 21:00 ma con le porte non ancora aperte dal server: ancora nulla.
select pg_temp.ok(pg_temp.filo(1, '2026-03-29 19:00+00') is null and pg_temp.membro(2, '2026-03-29 19:00+00') is null,
  'porte filo: finché il server non ha aperto le porte il numero non c''è');
reset role;

-- Il server apre le porte (lavoro della domenica, #5). Le stanze del test sono già chiuse per l'orologio vero.
select public.apri_porte();

set local role service_role;
select pg_temp.ok(pg_temp.filo(1, '2026-03-29 18:59+00') is null,
  'porte filo: anche con le porte aperte, prima delle 21:00 il Filo non legge');
select pg_temp.ok(pg_temp.filo(1, '2026-03-29 19:00+00') = 3,
  'porte filo: alle 21:00 il Filo legge solo il numero (3 chiavi reciproche su 12 persone)');
select pg_temp.ok(pg_temp.filo(1, '2026-03-29 19:00+00')
  = (select count(*)::integer from public.porte p where p.stanza_id = pg_temp.s(1)),
  'porte filo: il numero coincide con le porte della sera delle porte');
select pg_temp.ok(pg_temp.membro(2, '2026-03-29 19:00+00') = 3 and pg_temp.membro(9, '2026-03-30 18:59+00') = 3,
  'porte filo: ogni membro della stanza vede lo stesso numero dalle 21:00 per un giorno');
select pg_temp.ok(pg_temp.membro(2, '2026-03-30 19:00+00') is null,
  'porte filo: il giorno dopo la schermata 36 non compare più');
select pg_temp.ok(pg_temp.filo(1, '2026-04-05 18:59+00') = 3 and pg_temp.filo(1, '2026-04-05 19:00+00') is null,
  'porte filo: il Filo legge il numero fino a 7 giorni dopo la chiusura, poi più nulla');
select pg_temp.ok(pg_temp.membro(14, '2026-03-29 19:00+00') is null,
  'porte filo: stanza senza Filo, la schermata 36 non compare');
select pg_temp.ok(pg_temp.membro(16, '2026-03-29 19:00+00') is null and pg_temp.membro(1, '2026-03-29 19:00+00') is null,
  'porte filo: chi non è membro (nessuna stanza, il Filo stesso) non ha la schermata 36');
select pg_temp.ok(pg_temp.errore(format('select public.porte_stanza_filo(%L, %L, %L)', pg_temp.p(1), pg_temp.s(2),
  '2026-03-29 19:00+00')) like '%non_filo%',
  'porte filo: il Filo non legge il numero di una stanza che non segue');
select pg_temp.ok(pg_temp.errore(format('select public.porte_stanza_filo(%L, %L, %L)', pg_temp.p(2), pg_temp.s(1),
  '2026-03-29 19:00+00')) like '%non_filo%',
  'porte filo: un membro non legge il numero come se fosse il Filo');
-- La funzione del Filo restituisce un solo intero: nessun nome, nessuna coppia.
select pg_temp.ok((select format_type(p.prorettype, null) from pg_proc p where p.proname = 'porte_stanza_filo') = 'integer',
  'porte filo: per il Filo esce solo un intero, mai chi');
reset role;

-- Il numero si salva una volta sola e non cambia: rifare apri_porte non apre porte doppie e non lo tocca.
select public.apri_porte();
set local role service_role;
select pg_temp.ok(pg_temp.filo(1, '2026-03-29 20:00+00') = 3, 'porte filo: rifare l''apertura non cambia il numero');
reset role;

-- Chi è sospeso non vede la schermata 36 (come per la sera delle porte).
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('f4f4f4f4-0000-4000-8000-000000000901', pg_temp.p(2), pg_temp.p(4), 'insulti', 'scheda', now(), now() + interval '1 day');
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(4), 'cautelare', 'f4f4f4f4-0000-4000-8000-000000000901', now() + interval '1 day');
set local role service_role;
select pg_temp.ok(pg_temp.membro(4, '2026-03-29 19:30+00') is null and pg_temp.membro(2, '2026-03-29 19:30+00') = 3,
  'porte filo: chi è sospeso non vede la schermata 36, gli altri sì');
reset role;
rollback;
