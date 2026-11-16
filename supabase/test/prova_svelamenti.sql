-- Test dello svelamento nel database (issue #65, spec v1 del CPO; D48 A). Linea «sviluppatore».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
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

begin;
-- Eva (2a) e Fede (2b): porta aperta domenica 15/11 alle 21 di Roma.
insert into auth.users (id, email) values
  ('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', 'sa@example.com'),
  ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', 'sb@example.com');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5e5e5e5e-0000-4000-8000-0000000000a1', 'italia', '2026-11-09 08:00+00', '2026-11-15 20:00+00');
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9f9f9f9f-0000-4000-8000-000000000001', '5e5e5e5e-0000-4000-8000-0000000000a1',
   '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', '2026-11-15 20:00+00');

-- Il telefono non legge e non scrive lo svelamento: tutto passa dal Worker.
select pg_temp.come('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.svelamenti$$)
  and pg_temp.rifiutato($$insert into public.svelamenti (porta_id) values ('9f9f9f9f-0000-4000-8000-000000000001')$$),
  'svelamenti: il telefono non legge e non scrive (solo il server)');
reset role;
select pg_temp.come('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a');
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.svelamenti$$), 'svelamenti: niente senza accesso');
reset role;

set local role service_role;
insert into public.svelamenti (porta_id) values ('9f9f9f9f-0000-4000-8000-000000000001');
select pg_temp.ok((select scelta_a = 'video' and scelta_b = 'video' and tentativi = 0 and cardinality(fasce_a) = 0
  from public.svelamenti), 'svelamenti: si parte con il video (predefinito), nessuna fascia, nessun tentativo');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.svelamenti (porta_id) values ('9f9f9f9f-0000-4000-8000-000000000001')$$),
  'svelamenti: uno solo per porta');

-- Fasce: al massimo 3 a testa.
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set fasce_a = array['2026-11-16 18:00+00','2026-11-16 18:30+00',
  '2026-11-16 19:00+00','2026-11-16 19:30+00']::timestamptz[]$$), 'svelamenti: non più di 3 fasce a testa');
update public.svelamenti set fasce_a = array['2026-11-16 18:00+00','2026-11-16 18:30+00']::timestamptz[];

-- Senza caparra di entrambi lo svelamento non si avvia, nemmeno scrivendo direttamente nel database.
update public.svelamenti set caparra_a_il = '2026-11-15 21:00+00';
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set iniziato_il = '2026-11-16 18:00+00', tipo = 'video', tentativi = 1$$),
  'svelamenti: senza la caparra di entrambi non si avvia');
update public.svelamenti set caparra_b_il = '2026-11-15 22:00+00', scelta_b = 'foto';
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set scelta_a = 'audio'$$), 'svelamenti: solo «video» o «foto»');

-- Risposte solo dopo la fine dello svelamento.
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set risposta_a = 'si', risposta_a_il = '2026-11-16 19:00+00'$$),
  'svelamenti: nessuna risposta prima della fine dello svelamento');
update public.svelamenti set iniziato_il = '2026-11-16 18:00+00', tipo = 'foto', tentativi = 1;
-- La scelta si può cambiare solo fino all'inizio dello svelamento.
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set scelta_b = 'video'$$),
  'svelamenti: dopo l''inizio la scelta video/foto non cambia più');
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set durata_secondi = 11$$), 'svelamenti: il video dura al massimo 10 secondi');
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set tentativi = 4$$), 'svelamenti: al massimo 3 tentativi');
update public.svelamenti set durata_secondi = 10, finito_il = '2026-11-16 18:01+00';
update public.svelamenti set risposta_a = 'si', risposta_a_il = '2026-11-16 19:00+00';
update public.svelamenti set risposta_b = 'no', risposta_b_il = '2026-11-16 20:00+00';

-- Esito: le singole risposte devono sparire nello stesso momento; restano solo gli orari e l'esito.
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set esito = 'chiusa', esito_il = '2026-11-16 20:00+00'$$),
  'svelamenti: non si scrive l''esito lasciando le singole risposte');
update public.svelamenti set esito = 'chiusa', esito_il = '2026-11-16 20:00+00', risposta_a = null, risposta_b = null;
select pg_temp.ok((select risposta_a is null and risposta_b is null and risposta_a_il is not null and risposta_b_il is not null
  and esito = 'chiusa' from public.svelamenti), 'svelamenti: dopo l''esito restano orari ed esito, non le risposte');
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set risposta_a = 'si'$$),
  'svelamenti: dopo l''esito nessuno può riscrivere una risposta');
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set esito = 'forse'$$), 'svelamenti: esiti solo quelli previsti');

-- Se la porta sparisce (account eliminato) sparisce anche lo svelamento.
delete from public.porte where id = '9f9f9f9f-0000-4000-8000-000000000001';
select pg_temp.ok(not exists (select 1 from public.svelamenti), 'svelamenti: tolta la porta, tolto lo svelamento');
reset role;
rollback;
