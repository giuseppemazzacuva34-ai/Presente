-- Test dell'ascolto dei vocali del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 5a della linea
-- «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati, orologio finto.
-- Spec: i vocali si leggono solo dai membri della stanza, tramite il server; il lunedì dalle 9:00 (apertura) a tutta
-- la settimana; la domenica dalle 21:00 (chiusura, schermata 36). Chi è sospeso o uscito non ascolta.
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
  select ('f3f3f3f3-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f3f3f3f3-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
-- Il file che la persona n può ascoltare all'ora data (null = niente).
create function pg_temp.file(n integer, tipo text, ora text) returns text language sql as $$
  select v.file from public.vocale_filo_membro(pg_temp.p(n), tipo, ora::timestamptz) v
$$;

begin;
-- p(1) Filo, p(2) e p(3) membri della stanza 1, p(4) membro della stanza 2 (senza vocali), p(5) non è in stanza.
insert into auth.users (id, email) select pg_temp.p(n), 'fa' || n || '@example.com' from generate_series(1, 5) n;
insert into public.profili (id, nome, data_nascita, citta) values
  (pg_temp.p(1), 'Silvia', '1980-01-01', 'Milano'), (pg_temp.p(2), 'Anna', '1990-01-01', 'Milano'),
  (pg_temp.p(3), 'Bruno', '1990-01-01', 'Milano'), (pg_temp.p(4), 'Carla', '1990-01-01', 'Milano'),
  (pg_temp.p(5), 'Dario', '1990-01-01', 'Milano');
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il)
  select pg_temp.s(n), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00'
  from generate_series(1, 2) n;
insert into public.membri_stanza (stanza_id, utente_id) values
  (pg_temp.s(1), pg_temp.p(2)), (pg_temp.s(1), pg_temp.p(3)), (pg_temp.s(2), pg_temp.p(4));
insert into public.fili_stanza (stanza_id, filo) values (pg_temp.s(1), pg_temp.p(1));
insert into public.vocali_filo (stanza_id, tipo, file, durata, testo, caricato_il) values
  (pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/lun.webm', 70, 'Benvenuti', '2026-03-23 07:00+00'),
  (pg_temp.s(1), 'domenica', pg_temp.s(1) || '/dom.webm', 48, 'A tra poco', '2026-03-29 17:00+00');

-- Il telefono non chiama la funzione.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.errore(format('select * from public.vocale_filo_membro(%L, %L, now())', pg_temp.p(2), 'lunedi'))
  is not null, 'ascolto filo: il telefono non chiama la funzione');
reset role;

set local role service_role;
select pg_temp.ok(pg_temp.file(2, 'lunedi', '2026-03-23 07:59+00') is null,
  'ascolto filo: prima delle 9:00 di lunedì il vocale non si ascolta');
select pg_temp.ok(pg_temp.file(2, 'lunedi', '2026-03-23 08:00+00') = pg_temp.s(1) || '/lun.webm'
  and pg_temp.file(3, 'lunedi', '2026-03-29 18:59+00') = pg_temp.s(1) || '/lun.webm',
  'ascolto filo: il vocale del lunedì si ascolta dalle 9:00 fino alla chiusura');
select pg_temp.ok(pg_temp.file(2, 'lunedi', '2026-03-29 19:00+00') is null,
  'ascolto filo: dopo la chiusura il vocale del lunedì non si ascolta più');
select pg_temp.ok((select row(v.durata, v.testo, v.filo_nome)::text from public.vocale_filo_membro(pg_temp.p(2), 'lunedi',
  '2026-03-24 10:00+00') v) = row(70, 'Benvenuti', 'Silvia')::text,
  'ascolto filo: con il file arrivano durata, testo del vocale e nome del Filo');
select pg_temp.ok(pg_temp.file(2, 'domenica', '2026-03-29 18:59+00') is null,
  'ascolto filo: il vocale della domenica non si ascolta prima delle 21:00');
select pg_temp.ok(pg_temp.file(2, 'domenica', '2026-03-29 19:00+00') = pg_temp.s(1) || '/dom.webm'
  and pg_temp.file(2, 'domenica', '2026-03-30 18:59+00') = pg_temp.s(1) || '/dom.webm',
  'ascolto filo: il vocale della domenica si ascolta dalle 21:00 per un giorno');
select pg_temp.ok(pg_temp.file(2, 'domenica', '2026-03-30 19:00+00') is null,
  'ascolto filo: il giorno dopo la sera delle porte il vocale della domenica non si ascolta più');
select pg_temp.ok(pg_temp.file(4, 'lunedi', '2026-03-24 10:00+00') is null
  and pg_temp.file(5, 'lunedi', '2026-03-24 10:00+00') is null
  and pg_temp.file(1, 'lunedi', '2026-03-24 10:00+00') is null,
  'ascolto filo: chi non è membro della stanza non ascolta (altra stanza, nessuna stanza)');
select pg_temp.ok(pg_temp.errore(format('select * from public.vocale_filo_membro(%L, %L, now())', pg_temp.p(2), 'martedi'))
  is not null, 'ascolto filo: tipo sconosciuto rifiutato');
reset role;

-- Chi è sospeso (o uscito dalla stanza) non ascolta.
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('f3f3f3f3-0000-4000-8000-000000000901', pg_temp.p(2), pg_temp.p(3), 'insulti', 'scheda', now(), now() + interval '1 day');
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(3), 'cautelare', 'f3f3f3f3-0000-4000-8000-000000000901', now() + interval '1 day');
set local role service_role;
select pg_temp.ok(pg_temp.file(3, 'lunedi', '2026-03-24 10:00+00') is null
  and pg_temp.file(2, 'lunedi', '2026-03-24 10:00+00') is not null,
  'ascolto filo: chi è sospeso o uscito non ascolta');
reset role;
rollback;
