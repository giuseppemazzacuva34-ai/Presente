-- Test: «Non mi sono sentita/o al sicuro» nella valutazione fa partire subito un controllo (issue #7, criterio
-- dell'issue e spec v1.1 «Priorità»: 1 ora; #6 spec v1 punto 4). Linea «sviluppatore-b», passo 16b.
--   - con «No» alla sicurezza il server crea subito una segnalazione «non_al_sicuro», origine «valutazione», da 1 ora,
--     contro l'altra persona, senza racconto e senza blocco; il responsabile della sicurezza riceve l'avviso;
--   - con «Sì» nessuna segnalazione; una seconda valutazione («gia_fatta») non ne crea un'altra.
-- Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('b16b0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('b16bb16b-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'nonsicuro' || n || '@example.com' from generate_series(1, 4) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('b16b5555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'b16b5555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '3 days'
  from generate_series(1, 2) n;
set local role service_role;
update public.svelamenti set iniziato_il = now() - interval '2 days', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '2 days', esito = 'doppio_si', esito_il = now() - interval '2 days'
  where porta_id in (pg_temp.porta(1), pg_temp.porta(2));
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il,
                             checkin_a_il, checkin_b_il, esito, esito_il)
  select pg_temp.porta(n), now() + interval '5 days', 'concluso', now() - interval '3 hours', 'Bar della piazza', pg_temp.p(2 * n - 1),
         now() - interval '2 days', now() - interval '1 day', now() - interval '3 hours', now() - interval '3 hours',
         'avvenuto', now() - interval '3 hours'
  from generate_series(1, 2) n;

-- 1. «No» alla sicurezza: segnalazione da 1 ora contro l'altra persona, subito.
select pg_temp.ok(public.valuta_incontro(pg_temp.porta(1), pg_temp.p(1), 'si', 'si', 'si', false) = 'racconta',
  'non al sicuro: la risposta resta «racconta»');
select pg_temp.ok((select count(*) = 1 from public.segnalazioni where da = pg_temp.p(1)), 'non al sicuro: una segnalazione');
select pg_temp.ok((select contro = pg_temp.p(2) and motivo = 'non_al_sicuro' and origine = 'valutazione' and testo is null
    and scade_il <= now() + interval '1 hour'
  from public.segnalazioni where da = pg_temp.p(1)), 'non al sicuro: contro l''altra persona, «valutazione», 1 ora, senza racconto');
select pg_temp.ok(not exists (select 1 from public.blocchi where chi = pg_temp.p(1)), 'non al sicuro: nessun blocco automatico');
select pg_temp.ok(exists (select 1 from public.avvisi_sicurezza a join public.segnalazioni s on s.id = a.segnalazione_id
  where s.da = pg_temp.p(1)), 'non al sicuro: avviso al responsabile della sicurezza');
select pg_temp.ok(public.valuta_incontro(pg_temp.porta(1), pg_temp.p(1), 'si', 'si', 'si', false) = 'gia_fatta'
  and (select count(*) = 1 from public.segnalazioni where da = pg_temp.p(1)), 'non al sicuro: due volte, una sola segnalazione');

-- 2. «Sì»: nessuna segnalazione.
select pg_temp.ok(public.valuta_incontro(pg_temp.porta(2), pg_temp.p(3), 'si', 'si', 'si', true) = 'grazie'
  and not exists (select 1 from public.segnalazioni where da = pg_temp.p(3)), 'al sicuro: nessuna segnalazione');
rollback;
