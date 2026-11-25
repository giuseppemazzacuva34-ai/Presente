-- Test: stati_stanza (#380, stanza viva) non mostra più chi ha lasciato la stanza (#381). Segnalato da «sviluppatore-b»
-- il 24/11 (plancia). Linea «sviluppatore» (a). Dati inventati.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('1a5c4d5c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.visti(chi uuid) returns integer language plpgsql as $$
declare r integer;
begin
  execute 'set local role service_role';
  select count(*) into r from public.stati_stanza(chi);
  reset role;
  return r;
end $$;

begin;
-- Stanza aperta: Ada (1) donna; Ugo (2), Leo (3) uomini. Donne e uomini si cercano a vicenda.
insert into auth.users (id, email) select pg_temp.p(n), 'uscite' || n || '@example.com' from generate_series(1, 3) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Ada', '1990-01-01', 'MI', 'donna'), (pg_temp.p(2), 'Ugo', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(3), 'Leo', '1990-01-01', 'MI', 'uomo');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select id, case mi_presento_come when 'uomo' then '{donne}' else '{uomini}' end::text[], now(), '1.5', 25, 50, 'italia'
  from public.profili where id in (select pg_temp.p(n) from generate_series(1, 3) n);
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('1a5c4d5c-5555-4000-8000-00000000000a', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select '1a5c4d5c-5555-4000-8000-00000000000a', pg_temp.p(n) from generate_series(1, 3) n;

select pg_temp.ok(pg_temp.visti(pg_temp.p(1)) = 2, 'stati: prima delle uscite Ada vede Ugo e Leo');
insert into public.lasciate_stanza (persona, stanza_id, motivo, testo, quando) values
  (pg_temp.p(3), '1a5c4d5c-5555-4000-8000-00000000000a', 'tempo', null, now() - interval '1 hour');
select pg_temp.ok(pg_temp.visti(pg_temp.p(1)) = 1, 'stati: Leo ha lasciato la stanza → Ada vede solo Ugo');
select pg_temp.ok(not exists (select 1 from public.stati_stanza(pg_temp.p(1)) where utente_id = pg_temp.p(3)),
  'stati: chi ha lasciato non compare tra gli stati');
select pg_temp.ok(pg_temp.visti(pg_temp.p(3)) = 0, 'stati: chi ha lasciato non vede più nessuno');
rollback;
