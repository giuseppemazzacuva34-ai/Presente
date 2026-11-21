-- Test di «Annulla l'incontro» (issue #6, spec v1.1 del CPO del 20/11, punto 2). Linea «sviluppatore-b», passo 2n.
-- «Annulli l'incontro? Non potrete più fissarlo. I crediti tornano a entrambi.»
--   - da «da fissare» (anche dopo una disdetta) o con una proposta in corso, da tutte e due le persone;
--   - crediti restituiti subito a entrambi; nessuna nuova proposta possibile, anche via API;
--   - un appuntamento confermato prima si disdice («Disdici»), poi si può annullare.
-- Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('a22a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('a22aa22a-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.saldo(n integer) returns integer language sql as $$ select public.saldo_crediti(pg_temp.p(n)) $$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'annulla' || n || '@example.com' from generate_series(1, 9) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('a22a5555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porte 1: p1–p2 (da fissare), 2: p3–p4 (proposta di p3), 3: p5–p6 (confermato), 4: p7–p8 (già scaduto).
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'a22a5555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '2 days'
  from generate_series(1, 4) n;

set local role service_role;
select public.assegna_crediti_beta(pg_temp.p(n), 300) from generate_series(1, 8) n;
select public.blocca_caparra(pg_temp.porta((n + 1) / 2), pg_temp.p(n)) from generate_series(1, 8) n;
update public.svelamenti set iniziato_il = now() - interval '1 day 20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '1 day 19 minutes', esito = 'doppio_si', esito_il = now() - interval '1 day'
  where porta_id in (select pg_temp.porta(n) from generate_series(1, 4) n);
insert into public.incontri (porta_id, scadenza) values (pg_temp.porta(1), now() + interval '5 days');
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il)
  values (pg_temp.porta(2), now() + interval '5 days', 'proposto', now() + interval '2 days', 'Bar della piazza', pg_temp.p(3), now());
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il)
  values (pg_temp.porta(3), now() + interval '5 days', 'confermato', now() + interval '2 days', 'Bar della piazza', pg_temp.p(5),
          now() - interval '1 day', now());
insert into public.incontri (porta_id, scadenza) values (pg_temp.porta(4), now() - interval '1 minute');

-- 0. Solo le due persone della porta.
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(1), pg_temp.p(9)) = 'non_nella_porta', 'annulla: solo le due persone della porta');

-- 1. Da «da fissare»: crediti subito a entrambi, poi nessuna nuova proposta.
select pg_temp.ok(pg_temp.saldo(1) = 200 and pg_temp.saldo(2) = 200, 'annulla: prima le caparre sono bloccate');
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(1), pg_temp.p(1)) = 'annullato', 'annulla da «da fissare»: esito «annullato»');
select pg_temp.ok((select esito = 'annullato' and esito_il is not null from public.incontri where porta_id = pg_temp.porta(1)),
  'annulla da «da fissare»: incontro chiuso come «annullato»');
select pg_temp.ok(pg_temp.saldo(1) = 300 and pg_temp.saldo(2) = 300, 'annulla: crediti restituiti subito a entrambi');
select pg_temp.ok(public.proponi_incontro(pg_temp.porta(1), pg_temp.p(2),
    ((((now() at time zone 'Europe/Rome')::date + 2) + time '19:00') at time zone 'Europe/Rome'), null, 'Caffè del corso') = 'incontro_chiuso',
  'annulla: dopo, nessuna nuova proposta possibile');
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(1), pg_temp.p(2)) = 'incontro_chiuso', 'annulla: due volte no');
select pg_temp.ok(pg_temp.saldo(1) = 300 and pg_temp.saldo(2) = 300, 'annulla: due volte non crea crediti');

-- 2. Con una proposta in corso, anche chi l'ha fatta può annullare.
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(2), pg_temp.p(3)) = 'annullato', 'annulla: chi ha proposto può annullare');
select pg_temp.ok(pg_temp.saldo(3) = 300 and pg_temp.saldo(4) = 300, 'annulla con proposta: crediti a entrambi');

-- 3. Confermato: prima «Disdici».
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(3), pg_temp.p(6)) = 'gia_confermato', 'annulla: un appuntamento confermato prima si disdice');
select pg_temp.ok(pg_temp.saldo(5) = 200 and pg_temp.saldo(6) = 200, 'annulla: confermato, nessun credito si muove');
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(3), pg_temp.p(6)) = 'disdetto', 'annulla: prima la disdetta in tempo');
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(3), pg_temp.p(5)) = 'annullato', 'annulla: dopo la disdetta si può annullare');
select pg_temp.ok(pg_temp.saldo(5) = 300 and pg_temp.saldo(6) = 300, 'annulla dopo la disdetta: crediti a entrambi');

-- 4. Già scaduto: niente da annullare (i crediti sono già tornati).
select pg_temp.ok(public.annulla_incontro(pg_temp.porta(4), pg_temp.p(7)) = 'incontro_scaduto', 'annulla: incontro scaduto');
select pg_temp.ok(pg_temp.saldo(7) = 300 and pg_temp.saldo(8) = 300, 'annulla: scaduto, crediti restituiti una volta sola');

reset role;
select pg_temp.ok(not has_function_privilege('authenticated', 'public.annulla_incontro(uuid, uuid)', 'execute'),
  'annulla: solo il server la chiama');
rollback;
