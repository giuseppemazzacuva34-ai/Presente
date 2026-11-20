-- Test: chiamata caduta senza rientro dopo almeno 60 secondi (issue #4, spec v1.4 del CPO, 20/11).
-- Stesso finale di una chiamata normale: «La richiameresti?» si propone e si salva; sotto i 60 secondi no.
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('ca1d0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'cl' || n || '@example.com' from generate_series(1, 4) n;
insert into public.profili (id, nome, data_nascita, citta)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'Milano' from generate_series(1, 4) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('ca1d0000-0000-4000-8000-0000000000aa', 'italia', now() - interval '1 day', now() + interval '6 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'ca1d0000-0000-4000-8000-0000000000aa', pg_temp.p(n) from generate_series(1, 4) n;
-- 1 → 2: caduta a 61 s (conta). 3 → 4: caduta a 59 s (non conta).
insert into public.chiamate (chi, con, inizio, durata, esito) values
  (pg_temp.p(1), pg_temp.p(2), now() - interval '10 minutes', 61, 'caduta'),
  (pg_temp.p(3), pg_temp.p(4), now() - interval '10 minutes', 59, 'caduta');

set local role service_role;
select pg_temp.ok((select count(*) from public.richiameresti_da_riproporre(pg_temp.p(2)) where chi = pg_temp.p(1)) = 1,
  'caduta lunga: «La richiameresti?» si propone come dopo una chiamata normale');
select pg_temp.ok(public.salva_richiameresti(pg_temp.p(1), pg_temp.p(1), (select inizio from public.chiamate where chi = pg_temp.p(1)), 'si'),
  'caduta lunga: la risposta si salva');
select pg_temp.ok((select count(*) from public.richiameresti_da_riproporre(pg_temp.p(4))) = 0
  and not public.salva_richiameresti(pg_temp.p(3), pg_temp.p(3), (select inizio from public.chiamate where chi = pg_temp.p(3)), 'si'),
  'caduta a 59 s: nessuna domanda, nessuna risposta salvata (non conta)');
reset role;
rollback;
