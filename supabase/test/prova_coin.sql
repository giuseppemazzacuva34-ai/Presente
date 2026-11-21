-- Test dei Coin nel registro (issue #331 spec v1 del CPO, parte A; decisioni_giuseppe_20_11_evoluzione, D145 A).
-- Linea «sviluppatore-c». Movimenti in Coin: stanza −80, caparra −100/+100, buca +70 a chi aspetta e 30 a Presente,
-- crediti di prova 10–5000. I nomi interni (crediti_movimenti, saldo_crediti) restano. Dati inventati, Postgres di prova.
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
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('c0140000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('c014c014-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.saldo(n integer) returns integer language sql as $$ select public.saldo_crediti(pg_temp.p(n)) $$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'coin' || n || '@example.com' from generate_series(1, 6) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('c0145555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porta 1: p1–p2 (buca di p2 al check-in), 2: p3–p4 (disdetta tardi di p4), 3: p5–p6 (caparra e restituzione).
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'c0145555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '2 days'
  from generate_series(1, 3) n;

set local role service_role;
-- Costanti in Coin, una sola fonte (uguali a api/coin.js).
select pg_temp.ok(public.coin_caparra() = 100 and public.coin_buca_ricevuta() = 70 and public.coin_buca_presente() = 30
  and public.coin_stanza() = 80, 'coin: caparra 100, buca 70 + 30, stanza 80');

-- Coin di prova della beta: da 10 a 5000 (200 all'ingresso, D145 A).
select pg_temp.ok(pg_temp.rifiutato($$select public.assegna_crediti_beta(pg_temp.p(1), 9)$$), 'coin beta: meno di 10 rifiutati');
select pg_temp.ok(pg_temp.rifiutato($$select public.assegna_crediti_beta(pg_temp.p(1), 5001)$$), 'coin beta: più di 5000 rifiutati');
select public.assegna_crediti_beta(pg_temp.p(n), 200) from generate_series(1, 6) n;
select pg_temp.ok(pg_temp.saldo(1) = 200, 'coin beta: 200 Coin nel saldo');

-- Stanza «Al buio»: −80, mai −9.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti) values (pg_temp.p(1), 'stanza', -9)$$),
  'stanza: il vecchio importo −9 non entra più');
insert into public.crediti_movimenti (persona, tipo, crediti) values (pg_temp.p(1), 'stanza', -80);
select pg_temp.ok(pg_temp.saldo(1) = 120, 'stanza: −80 Coin');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
  values (pg_temp.p(3), 'caparra_bloccata', -10, pg_temp.porta(2))$$), 'caparra: il vecchio importo −10 non entra più');

-- Caparra: −100 bloccati, +100 restituiti.
select pg_temp.ok(public.blocca_caparra(pg_temp.porta(3), pg_temp.p(5)) = 'bloccata', 'caparra: bloccata');
select pg_temp.ok(pg_temp.saldo(5) = 100, 'caparra: −100 Coin');
-- Con 40 Coin la caparra non si blocca.
insert into public.crediti_movimenti (persona, tipo, crediti) values (pg_temp.p(6), 'stanza', -80), (pg_temp.p(6), 'stanza', -80);
select pg_temp.ok(pg_temp.saldo(6) = 40 and public.blocca_caparra(pg_temp.porta(3), pg_temp.p(6)) = 'crediti_insufficienti',
  'caparra: con 40 Coin risponde «crediti_insufficienti»');
select pg_temp.ok(public.restituisci_caparre(pg_temp.porta(3)) = 1, 'caparra: una restituzione');
select pg_temp.ok(pg_temp.saldo(5) = 200, 'caparra: +100 Coin restituiti');

-- Buca al check-in: chi ha aspettato +100 +70, Presente 30, chi manca −100.
select public.blocca_caparra(pg_temp.porta(n), pg_temp.p(2 * n - 1)), public.blocca_caparra(pg_temp.porta(n), pg_temp.p(2 * n))
  from generate_series(1, 2) n;
update public.svelamenti set iniziato_il = now() - interval '1 day 20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '1 day 19 minutes', esito = 'doppio_si', esito_il = now() - interval '1 day'
  where porta_id in (pg_temp.porta(1), pg_temp.porta(2));
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il) values
  (pg_temp.porta(1), now() + interval '5 days', 'confermato', now() - interval '31 minutes', 'Bar della piazza',
   pg_temp.p(1), now() - interval '2 days', now() - interval '1 day'),
  (pg_temp.porta(2), now() + interval '5 days', 'confermato', now() + interval '2 hours', 'Bar della piazza',
   pg_temp.p(3), now() - interval '2 days', now() - interval '1 day');
update public.incontri set checkin_a_il = now() - interval '40 minutes' where porta_id = pg_temp.porta(1);
select pg_temp.ok((public.incontro_aggiornato(pg_temp.porta(1))).esito = 'buca_b', 'buca: esito buca_b');
select pg_temp.ok(pg_temp.saldo(1) = 120 - 100 + 100 + 70 and pg_temp.saldo(2) = 100, 'buca: +100 +70 a chi aspetta, −100 a chi manca');
select pg_temp.ok((select crediti_presente from public.incontri where porta_id = pg_temp.porta(1)) = 30, 'buca: 30 Coin a Presente');

-- Disdetta a meno di 6 ore: stessa buca in Coin.
select pg_temp.ok(public.disdici_incontro(pg_temp.porta(2), pg_temp.p(4)) = 'disdetto_tardi', 'disdetta tardi: buca di chi disdice');
select pg_temp.ok(pg_temp.saldo(3) = 270 and pg_temp.saldo(4) = 100
  and (select crediti_presente from public.incontri where porta_id = pg_temp.porta(2)) = 30, 'disdetta tardi: +170 all''altra persona, 30 a Presente');
select pg_temp.ok(pg_temp.saldo(1) + pg_temp.saldo(2) + 30 = 120 + 200 + 0 and pg_temp.saldo(3) + pg_temp.saldo(4) + 30 = 400,
  'buca: la somma dei Coin torna');
reset role;
rollback;
