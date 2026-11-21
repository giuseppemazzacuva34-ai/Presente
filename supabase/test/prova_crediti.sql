-- Test del saldo crediti e della caparra (issue #65 passo 3; D18 A, D12 A; risposta CPO 13/11). Linea «sviluppatore».
-- In beta i crediti sono un contatore interno, senza soldi veri. Dati inventati, Postgres di prova.
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

begin;
insert into auth.users (id, email) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 'ca@example.com'),
  ('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', 'cb@example.com'),
  ('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', 'cc@example.com');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5e5e5e5e-0000-4000-8000-0000000000c1', 'italia', '2026-11-09 08:00+00', '2026-11-15 20:00+00');
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9c9c9c9c-0000-4000-8000-000000000001', '5e5e5e5e-0000-4000-8000-0000000000c1',
   '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', '2026-11-15 20:00+00'),
  ('9c9c9c9c-0000-4000-8000-000000000002', '5e5e5e5e-0000-4000-8000-0000000000c1',
   '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', '2026-11-15 20:00+00');

-- Il telefono non vede e non scrive il registro, né chiama le funzioni.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.crediti_movimenti$$), 'crediti: il telefono non legge il registro');
select pg_temp.ok(pg_temp.rifiutato($$select public.saldo_crediti('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a')$$), 'crediti: il telefono non chiama saldo_crediti');
select pg_temp.ok(pg_temp.rifiutato($$select public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a')$$),
  'crediti: il telefono non blocca caparre da solo');
reset role;
set local role service_role;

select pg_temp.ok(public.saldo_crediti('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 0, 'crediti: saldo iniziale 0');
-- Con meno di 10 crediti non si blocca nulla.
select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 'crediti_insufficienti',
  'caparra: con 0 crediti risponde «crediti_insufficienti»');
select pg_temp.ok(not exists (select 1 from public.crediti_movimenti) and not exists (select 1 from public.svelamenti),
  'caparra: con crediti insufficienti nessuna riga scritta');

-- Crediti di prova della beta (dal pannello).
select public.assegna_crediti_beta('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 150);
select public.assegna_crediti_beta('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', 100);
select pg_temp.ok(pg_temp.rifiutato($$select public.assegna_crediti_beta('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', 0)$$), 'crediti beta: solo quantità positive');
select pg_temp.ok(pg_temp.rifiutato($$select public.assegna_crediti_beta('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', 5001)$$), 'crediti beta: al massimo 5000 Coin alla volta');
select pg_temp.ok(public.saldo_crediti('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 150, 'crediti: saldo dopo i crediti di prova');

-- Solo chi è nella porta blocca la caparra.
select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c') = 'non_nella_porta',
  'caparra: chi non è nella porta non blocca nulla');

select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 'bloccata',
  'caparra: con 150 Coin se ne bloccano 100');
select pg_temp.ok(public.saldo_crediti('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 50, 'caparra: saldo disponibile 150 - 100 = 50');
select pg_temp.ok((select caparra_a_il is not null and caparra_b_il is null from public.svelamenti
  where porta_id = '9c9c9c9c-0000-4000-8000-000000000001'), 'caparra: lo svelamento segna l''orario della caparra di a');
-- Una sola caparra per persona e porta.
select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 'gia_bloccata',
  'caparra: la seconda volta non scala altri crediti');
select pg_temp.ok(public.saldo_crediti('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 50, 'caparra: saldo invariato dopo il doppio tocco');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 'caparra_bloccata', -10, '9c9c9c9c-0000-4000-8000-000000000001')$$),
  'caparra: il database rifiuta una seconda caparra per la stessa porta');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 'caparra_bloccata', -7)$$), 'caparra: vale sempre 100 Coin e sempre con la porta');
-- Il saldo non va mai sotto zero, nemmeno scrivendo nel registro.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 'stanza', -80)$$), 'crediti: il saldo non va mai sotto zero');
-- Il registro non si modifica: si aggiungono righe.
select pg_temp.ok(pg_temp.rifiutato($$update public.crediti_movimenti set crediti = 100$$), 'crediti: le righe del registro non si modificano');

-- Seconda porta della stessa sera: caparra indipendente, ma servono altri 10 crediti.
select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000002', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 'crediti_insufficienti',
  'caparra: due porte = due caparre (50 Coin non bastano per la seconda)');

-- Porta chiusa: nessuna nuova caparra.
select public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b');
select pg_temp.ok(public.saldo_crediti('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b') = 0
  and (select caparra_b_il is not null from public.svelamenti where porta_id = '9c9c9c9c-0000-4000-8000-000000000001'),
  'caparra: anche b blocca i suoi 100');

-- Restituzione (un no, il silenzio, scadenza, blocco, sospensione): torna a entrambi, una volta sola, nessuna penale.
select pg_temp.ok(public.restituisci_caparre('9c9c9c9c-0000-4000-8000-000000000001') = 2, 'restituzione: 2 caparre restituite');
select pg_temp.ok(public.saldo_crediti('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 150
  and public.saldo_crediti('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b') = 100, 'restituzione: saldi tornati come prima');
select pg_temp.ok(public.restituisci_caparre('9c9c9c9c-0000-4000-8000-000000000001') = 0, 'restituzione: la seconda volta non restituisce nulla');
select pg_temp.ok(not exists (select 1 from public.crediti_movimenti where tipo like 'penale%' or tipo like 'buca%'),
  'restituzione: nessuna riga di penale nel registro');
-- Dopo la restituzione la porta non accetta più caparre.
select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000001', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 'porta_chiusa',
  'caparra: dopo la restituzione la porta è chiusa per le caparre');
-- Porta senza caparre: restituzione = 0.
select pg_temp.ok(public.restituisci_caparre('9c9c9c9c-0000-4000-8000-000000000002') = 0, 'restituzione: porta senza caparre, nulla da fare');

-- Esito già deciso: niente caparra.
insert into public.svelamenti (porta_id, esito, esito_il) values ('9c9c9c9c-0000-4000-8000-000000000002', 'scaduta', now());
select pg_temp.ok(public.blocca_caparra('9c9c9c9c-0000-4000-8000-000000000002', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a') = 'porta_chiusa',
  'caparra: con l''esito già deciso non si blocca nulla');

reset role;
rollback;
