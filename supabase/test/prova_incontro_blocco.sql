-- Test di blocco e sospensione sugli appuntamenti (issue #7 spec v1.1, «Blocco» e «Sospensione»; criteri
-- «Una sospensione chiude porte, svelamenti e appuntamenti con le restituzioni previste» e «appuntamento annullato
-- senza penale per nessuno»). Linea «sviluppatore-b», passo 16a.
--   - blocco tra i due o persona sospesa: l'incontro non ancora concluso si chiude «annullato», caparre a entrambi;
--   - una buca già avvenuta prima del blocco resta una buca (chi ha aspettato riceve 10 + 7);
--   - dopo, nessuna proposta, risposta o check-in possibile.
-- Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('b16a0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('b16ab16a-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.saldo(n integer) returns integer language sql as $$ select public.saldo_crediti(pg_temp.p(n)) $$;
create function pg_temp.esito(n integer) returns text language sql as $$
  select esito from public.incontri where porta_id = pg_temp.porta(n)
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'bloccoincontro' || n || '@example.com' from generate_series(1, 8) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('b16a5555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porte 1: p1–p2 (confermato), 2: p3–p4 (da fissare), 3: p5–p6 (buca di p6 già avvenuta), 4: p7–p8 (nessun problema).
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'b16a5555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '2 days'
  from generate_series(1, 4) n;

set local role service_role;
select public.assegna_crediti_beta(pg_temp.p(n), 30) from generate_series(1, 8) n;
select public.blocca_caparra(pg_temp.porta((n + 1) / 2), pg_temp.p(n)) from generate_series(1, 8) n;
update public.svelamenti set iniziato_il = now() - interval '1 day 20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '1 day 19 minutes', esito = 'doppio_si', esito_il = now() - interval '1 day'
  where porta_id in (select pg_temp.porta(n) from generate_series(1, 4) n);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il)
  values (pg_temp.porta(1), now() + interval '5 days', 'confermato', now() + interval '2 days', 'Bar della piazza', pg_temp.p(1),
          now() - interval '1 day', now());
insert into public.incontri (porta_id, scadenza) values (pg_temp.porta(2), now() + interval '5 days');
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il, checkin_a_il)
  values (pg_temp.porta(3), now() + interval '5 days', 'confermato', now() - interval '2 hours', 'Bar della piazza', pg_temp.p(5),
          now() - interval '1 day', now() - interval '20 hours', now() - interval '2 hours');
insert into public.incontri (porta_id, scadenza) values (pg_temp.porta(4), now() + interval '5 days');

-- 1. Blocco con un appuntamento confermato: annullato, crediti a entrambi, nessuna penale.
reset role;
insert into public.blocchi (chi, bloccato) values (pg_temp.p(2), pg_temp.p(1));
set local role service_role;
select pg_temp.ok(pg_temp.saldo(1) = 20 and pg_temp.saldo(2) = 20, 'blocco: prima le caparre sono bloccate');
select public.incontro_aggiornato(pg_temp.porta(1));
select pg_temp.ok(pg_temp.esito(1) = 'annullato', 'blocco: l''appuntamento confermato si chiude «annullato»');
select pg_temp.ok(pg_temp.saldo(1) = 30 and pg_temp.saldo(2) = 30, 'blocco: crediti restituiti a entrambi');
select pg_temp.ok(public.checkin_incontro(pg_temp.porta(1), pg_temp.p(1)) <> 'fatto'
  and (select checkin_a_il is null from public.incontri where porta_id = pg_temp.porta(1)), 'blocco: niente check-in dopo');
select public.incontro_aggiornato(pg_temp.porta(1));
select pg_temp.ok(pg_temp.saldo(1) = 30 and pg_temp.saldo(2) = 30, 'blocco: due volte non crea crediti');

-- 2. Sospensione (cautelare) di una delle due persone: «da fissare» annullato, crediti a entrambi.
select public.nuova_segnalazione(pg_temp.p(3), pg_temp.p(4), 'minacce_pericolo', 'scheda', null, false);
select pg_temp.ok(public.sospeso(pg_temp.p(4)), 'sospensione: p4 è sospesa');
select pg_temp.ok(public.proponi_incontro(pg_temp.porta(2), pg_temp.p(3),
    ((((now() at time zone 'Europe/Rome')::date + 2) + time '19:00') at time zone 'Europe/Rome'), null, 'Caffè del corso') = 'incontro_chiuso',
  'sospensione: nessuna nuova proposta');
select pg_temp.ok(pg_temp.esito(2) = 'annullato', 'sospensione: incontro «annullato»');
select pg_temp.ok(pg_temp.saldo(3) = 30 and pg_temp.saldo(4) = 30, 'sospensione: nessuna penale, crediti a entrambi');

-- 3. Buca già avvenuta prima del blocco: resta una buca (chi ha aspettato non perde i 7 crediti).
reset role;
insert into public.blocchi (chi, bloccato) values (pg_temp.p(5), pg_temp.p(6));
set local role service_role;
select public.incontro_aggiornato(pg_temp.porta(3));
select pg_temp.ok(pg_temp.esito(3) = 'buca_b', 'buca prima del blocco: resta «buca»');
select pg_temp.ok(pg_temp.saldo(5) = 37 and pg_temp.saldo(6) = 20, 'buca prima del blocco: 10 + 7 a chi ha aspettato');

-- 4. Nessun blocco né sospensione: l'incontro resta aperto.
select public.incontro_aggiornato(pg_temp.porta(4));
select pg_temp.ok(pg_temp.esito(4) is null and pg_temp.saldo(7) = 20, 'senza problemi: l''incontro resta aperto');
rollback;
