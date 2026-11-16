-- Test: alla sera delle porte (domenica 21:00) si cancellano le risposte «La richiameresti?» della stanza chiusa
-- (issue #5, spec v1.1, criterio «le risposte "la richiameresti?" della stanza sono cancellate»). Linea «sviluppatore-c».
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('c1c1c1c1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'rs' || n || '@example.com' from generate_series(1, 4) n;
insert into public.profili (id, nome, data_nascita, citta)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'Milano' from generate_series(1, 4) n;
-- Stanza A chiusa un minuto fa (persone 1 e 2), stanza C ancora aperta (persone 3 e 4).
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-00000000000a', 'italia', now() - interval '7 days', now() - interval '1 minute'),
  ('7f7f7f7f-0000-4000-8000-00000000000c', 'italia', now() - interval '1 day', now() + interval '6 days');
insert into public.membri_stanza (stanza_id, utente_id) values
  ('7f7f7f7f-0000-4000-8000-00000000000a', pg_temp.p(1)), ('7f7f7f7f-0000-4000-8000-00000000000a', pg_temp.p(2)),
  ('7f7f7f7f-0000-4000-8000-00000000000c', pg_temp.p(3)), ('7f7f7f7f-0000-4000-8000-00000000000c', pg_temp.p(4));
insert into public.chiamate (chi, con, inizio, durata, esito) values
  (pg_temp.p(1), pg_temp.p(2), now() - interval '2 days', 600, 'tempo_scaduto'),
  (pg_temp.p(3), pg_temp.p(4), now() - interval '2 hours', 600, 'tempo_scaduto');
insert into public.richiameresti (utente_id, chiamata_chi, chiamata_inizio, stanza_id, risposta)
  select pg_temp.p(1), chi, inizio, '7f7f7f7f-0000-4000-8000-00000000000a'::uuid, 'si' from public.chiamate where chi = pg_temp.p(1)
  union all
  select pg_temp.p(2), chi, inizio, '7f7f7f7f-0000-4000-8000-00000000000a'::uuid, 'no' from public.chiamate where chi = pg_temp.p(1)
  union all
  select pg_temp.p(3), chi, inizio, '7f7f7f7f-0000-4000-8000-00000000000c'::uuid, 'si' from public.chiamate where chi = pg_temp.p(3);

set local role service_role;
select public.apri_porte();
reset role;

select pg_temp.ok((select count(*) from public.richiameresti where stanza_id = '7f7f7f7f-0000-4000-8000-00000000000a') = 0,
  'sera: alle 21:00 le risposte «La richiameresti?» della stanza chiusa sono cancellate');
select pg_temp.ok((select count(*) from public.richiameresti where stanza_id = '7f7f7f7f-0000-4000-8000-00000000000c') = 1,
  'sera: le risposte di una stanza ancora aperta restano (servono ai suggerimenti della settimana)');
rollback;
