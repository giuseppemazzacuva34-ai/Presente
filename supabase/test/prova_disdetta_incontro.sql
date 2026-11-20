-- Test della disdetta di un incontro confermato (issue #6, spec v1.1 del CPO del 20/11, punto 2; D12 A).
-- Linea «sviluppatore-b». Regole:
--   - «Disdici» almeno 6 ore prima → l'incontro torna «da fissare», le caparre restano bloccate, si può riproporre
--     (stesso limite di 3 controproposte in tutto); chi ha disdetto resta scritto per avvisare l'altra persona;
--   - alla scadenza senza nuovo appuntamento confermato → crediti restituiti a entrambi (già in incontro_aggiornato);
--   - meno di 6 ore prima → buca di chi disdice (10 + 7 all'altro, 3 a Presente; spec v1, «Regole»);
--   - dopo l'ora dell'incontro decide il check-in, non la disdetta.
-- Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('d15d0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('d15dd15d-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.saldo(n integer) returns integer language sql as $$ select public.saldo_crediti(pg_temp.p(n)) $$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'disdetta' || n || '@example.com' from generate_series(1, 9) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('d15d5555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porte 1: p1–p2 (disdetta in tempo), 2: p3–p4 (disdetta tardi), 3: p5–p6 (ora passata), 4: p7–p8 (non confermato).
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'd15d5555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '2 days'
  from generate_series(1, 4) n;

set local role service_role;
select public.assegna_crediti_beta(pg_temp.p(n), 30) from generate_series(1, 8) n;
select public.blocca_caparra(pg_temp.porta((n + 1) / 2), pg_temp.p(n)) from generate_series(1, 8) n;
update public.svelamenti set iniziato_il = now() - interval '1 day 20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '1 day 19 minutes', esito = 'doppio_si', esito_il = now() - interval '1 day'
  where porta_id in (select pg_temp.porta(n) from generate_series(1, 4) n);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il, controproposte)
  select pg_temp.porta(n), now() + interval '5 days', 'confermato', now() + interval '2 days', 'Bar della piazza',
         pg_temp.p(2 * n - 1), now() - interval '2 days', now() - interval '1 day', 1
  from generate_series(1, 3) n;
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il)
  values (pg_temp.porta(4), now() + interval '5 days', 'proposto', now() + interval '2 days', 'Bar della piazza', pg_temp.p(7), now());
update public.incontri set orario = now() + interval '5 hours 59 minutes' where porta_id = pg_temp.porta(2);
update public.incontri set orario = now() - interval '5 minutes' where porta_id = pg_temp.porta(3);

-- 0. Chi non è nella porta non disdice; senza appuntamento confermato non c'è nulla da disdire.
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(1), pg_temp.p(9)) = 'non_nella_porta', 'disdetta: solo le due persone della porta');
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(4), pg_temp.p(8)) = 'non_confermato', 'disdetta: una proposta non confermata non si disdice');

-- 1. In tempo (2 giorni prima): «da fissare», caparre ancora bloccate, controproposte fatte restano contate.
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(1), pg_temp.p(2)) = 'disdetto', 'disdetta in tempo: esito «disdetto»');
select pg_temp.ok((select stato = 'da_fissare' and esito is null and orario is null and luogo_libero is null and proposto_da is null
    and confermato_il is null and controproposte = 1 and disdetto_da = pg_temp.p(2) and disdetto_il is not null
  from public.incontri where porta_id = pg_temp.porta(1)), 'disdetta in tempo: torna «da fissare» e ricorda chi ha disdetto');
select pg_temp.ok(pg_temp.saldo(1) = 20 and pg_temp.saldo(2) = 20, 'disdetta in tempo: le caparre restano bloccate');
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(1), pg_temp.p(1)) = 'non_confermato', 'disdetta in tempo: due volte no');
-- Si può riproporre.
select pg_temp.ok(public.proponi_incontro(pg_temp.porta(1), pg_temp.p(1),
    ((((now() at time zone 'Europe/Rome')::date + 2) + time '19:00') at time zone 'Europe/Rome'), null, 'Caffè del corso') = 'proposto',
  'disdetta in tempo: si può fissare un altro appuntamento');
-- Alla scadenza senza nuovo appuntamento confermato: crediti a entrambi.
update public.incontri set scadenza = now() - interval '1 minute' where porta_id = pg_temp.porta(1);
select pg_temp.ok((public.incontro_aggiornato(pg_temp.porta(1))).esito = 'scaduto', 'disdetta in tempo: alla scadenza l''incontro scade');
select pg_temp.ok(pg_temp.saldo(1) = 30 and pg_temp.saldo(2) = 30, 'disdetta in tempo: alla scadenza crediti restituiti a entrambi');

-- 2. Meno di 6 ore prima: buca di chi disdice (p4): p3 riprende 10 + 7, Presente 3.
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(2), pg_temp.p(4)) = 'disdetto_tardi', 'disdetta tardi: esito «disdetto_tardi»');
select pg_temp.ok((select stato = 'concluso' and esito = 'buca_b' and crediti_presente = 3 and disdetto_da = pg_temp.p(4)
  from public.incontri where porta_id = pg_temp.porta(2)), 'disdetta tardi: buca di chi disdice, 3 crediti a Presente');
select pg_temp.ok(pg_temp.saldo(3) = 37 and pg_temp.saldo(4) = 20, 'disdetta tardi: chi resta riprende 10 più 7');
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(2), pg_temp.p(3)) = 'incontro_chiuso', 'disdetta tardi: incontro chiuso');

-- 3. Dopo l'ora dell'incontro la disdetta non c'è più: decide il check-in.
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(3), pg_temp.p(5)) = 'troppo_tardi', 'disdetta: dopo l''ora decide il check-in');
select pg_temp.ok(pg_temp.saldo(5) = 20 and pg_temp.saldo(6) = 20, 'disdetta: dopo l''ora nessun credito si muove');

-- 4. Il telefono non chiama la funzione.
reset role;
set local role authenticated;
select pg_temp.ok(not has_function_privilege('authenticated', 'public.disdici_incontro(uuid, uuid)', 'execute'),
  'disdetta: solo il server la chiama');
reset role;
rollback;
