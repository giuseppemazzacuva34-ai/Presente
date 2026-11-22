-- Test: «Sì, racconto» dopo «No» alla sicurezza nella valutazione (issue #6 spec v1 punto 4; #7 spec v1.1 «Priorità»).
-- Linea «sviluppatore-b», passo 3g.
--   - il racconto si aggiunge alla segnalazione «non_al_sicuro» già partita, senza crearne un'altra;
--   - una volta sola; testo vuoto o oltre 1000 caratteri rifiutato; chi non è nella porta non trova nulla;
--   - senza «No» alla sicurezza non c'è nessuna segnalazione da completare; chiusa dal pannello → non si tocca.
-- Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('b3a90000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('b3a9b3a9-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'racconto' || n || '@example.com' from generate_series(1, 7) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('b3a95555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'b3a95555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '3 days'
  from generate_series(1, 3) n;
set local role service_role;
update public.svelamenti set iniziato_il = now() - interval '2 days', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '2 days', esito = 'doppio_si', esito_il = now() - interval '2 days'
  where porta_id in (pg_temp.porta(1), pg_temp.porta(2), pg_temp.porta(3));
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il,
                             checkin_a_il, checkin_b_il, esito, esito_il)
  select pg_temp.porta(n), now() + interval '5 days', 'concluso', now() - interval '3 hours', 'Bar della piazza', pg_temp.p(2 * n - 1),
         now() - interval '2 days', now() - interval '1 day', now() - interval '3 hours', now() - interval '3 hours',
         'avvenuto', now() - interval '3 hours'
  from generate_series(1, 3) n;

-- 1. «No» alla sicurezza, poi il racconto: stessa segnalazione, nessuna nuova.
select pg_temp.ok(public.valuta_incontro(pg_temp.porta(1), pg_temp.p(1), 'si', 'si', 'si', false) = 'racconta', 'parte la segnalazione');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(1), pg_temp.p(1), '   ') = 'testo_non_valido', 'testo vuoto rifiutato');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(1), pg_temp.p(1), repeat('x', 1001)) = 'testo_non_valido', 'oltre 1000 caratteri rifiutato');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(1), pg_temp.p(7), 'Mi ha seguita') = 'non_nella_porta', 'chi non è nella porta: niente');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(1), pg_temp.p(2), 'Mi ha seguita') = 'nessuna_segnalazione',
  'l''altra persona non può scrivere nella segnalazione contro di sé');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(1), pg_temp.p(1), '  Mi ha seguita fino a casa.  ') = 'raccontato', 'racconto aggiunto');
select pg_temp.ok((select count(*) = 1 and min(testo) = 'Mi ha seguita fino a casa.' and min(scade_il) <= now() + interval '1 hour'
  from public.segnalazioni where da = pg_temp.p(1)), 'una sola segnalazione, con il racconto, ancora da 1 ora');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(1), pg_temp.p(1), 'Altro') = 'gia_raccontato'
  and (select min(testo) = 'Mi ha seguita fino a casa.' from public.segnalazioni where da = pg_temp.p(1)), 'una volta sola');

-- 2. «Sì» alla sicurezza: niente da completare.
select pg_temp.ok(public.valuta_incontro(pg_temp.porta(2), pg_temp.p(3), 'si', 'si', 'si', true) = 'grazie', 'al sicuro');
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(2), pg_temp.p(3), 'Niente') = 'nessuna_segnalazione'
  and not exists (select 1 from public.segnalazioni where da = pg_temp.p(3)), 'al sicuro: nessuna segnalazione da completare');

-- 3. Segnalazione già chiusa dal pannello: non si tocca.
select pg_temp.ok(public.valuta_incontro(pg_temp.porta(3), pg_temp.p(5), 'si', 'si', 'si', false) = 'racconta', 'parte la seconda');
update public.segnalazioni set esito = 'archiviata', chiusa_il = now() where da = pg_temp.p(5);
select pg_temp.ok(public.racconta_valutazione(pg_temp.porta(3), pg_temp.p(5), 'Tardi') = 'nessuna_segnalazione'
  and (select testo is null from public.segnalazioni where da = pg_temp.p(5)), 'chiusa: il racconto non si aggiunge');
rollback;
