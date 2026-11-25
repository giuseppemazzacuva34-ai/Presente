-- Test del cerchio diviso tra uomini e donne nel database (issue #380, spec v1 del CPO del 23/11, punto 2), passo 5a
-- della linea CTO. Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- gruppi_stanza(p_persona) dice solo in quale metà del cerchio sta ogni persona VISIBILE a chi guarda (le stesse di
-- stati_stanza: stessa stanza aperta, compatibili, senza blocchi, non sospese, non uscite): «uomini», «donne» o
-- «altre» (non binario, «preferisco descrivermi», nessuna risposta). Mai la descrizione scritta a mano. Solo il server.
\set ON_ERROR_STOP on
create function pg_temp.come(utente uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
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
  select ('6a6a6a6a-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- Il gruppo di p(altro) visto da p(chi): 'assente' se chi guarda non lo vede.
create function pg_temp.gruppo(chi integer, altro integer) returns text language sql as $$
  select coalesce((select g.gruppo from public.gruppi_stanza(pg_temp.p(chi)) g where g.utente_id = pg_temp.p(altro)), 'assente')
$$;

begin;
-- Stanza A (aperta): p1 donna, p2 uomo, p3 non binario, p4 «mi descrivo», p5 donna (bloccata da p1).
-- p6 donna nella stanza B (aperta).
insert into auth.users (id, email) select pg_temp.p(n), 'gruppi' || n || '@example.com' from generate_series(1, 6) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Prova', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(2), 'Prova', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(3), 'Prova', '1990-01-01', 'MI', 'non_binario'),
  (pg_temp.p(4), 'Prova', '1990-01-01', 'MI', 'mi_descrivo'),
  (pg_temp.p(5), 'Prova', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(6), 'Prova', '1990-01-01', 'MI', 'donna');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select pg_temp.p(n), '{donne,uomini,non_binari}', now(), '1.5', 18, 99, 'italia' from generate_series(1, 6) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6a6a6a6a-0000-4000-8000-00000000000a', 'italia', now() - interval '2 days', now() + interval '3 days'),
  ('6a6a6a6a-0000-4000-8000-00000000000b', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select '6a6a6a6a-0000-4000-8000-00000000000a', pg_temp.p(n) from generate_series(1, 5) n;
insert into public.membri_stanza (stanza_id, utente_id) values ('6a6a6a6a-0000-4000-8000-00000000000b', pg_temp.p(6));
insert into public.blocchi (chi, bloccato) values (pg_temp.p(1), pg_temp.p(5));

-- Il telefono e la chiave anon non lanciano la funzione: passa dal Worker.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.gruppi_stanza(auth.uid())$$),
  'gruppi: il telefono non lancia la funzione (solo il server)');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.gruppi_stanza('6a6a6a6a-0000-4000-8000-000000000001')$$),
  'gruppi: la chiave anon riceve un rifiuto');
reset role;

set local role service_role;
select pg_temp.ok(pg_temp.gruppo(1, 2) = 'uomini', 'gruppi: uomo → «uomini»');
select pg_temp.ok(pg_temp.gruppo(2, 1) = 'donne', 'gruppi: donna → «donne»');
select pg_temp.ok(pg_temp.gruppo(1, 3) = 'altre' and pg_temp.gruppo(1, 4) = 'altre',
  'gruppi: non binario e «mi descrivo» → «altre»');
select pg_temp.ok(pg_temp.gruppo(1, 1) = 'assente', 'gruppi: chi guarda non è nell''elenco');
select pg_temp.ok(pg_temp.gruppo(1, 5) = 'assente' and pg_temp.gruppo(5, 1) = 'assente',
  'gruppi: con un blocco le due persone non si vedono');
select pg_temp.ok(pg_temp.gruppo(1, 6) = 'assente' and pg_temp.gruppo(6, 1) = 'assente',
  'gruppi: chi è in un''altra stanza non si vede');
select pg_temp.ok((select count(*) from public.gruppi_stanza(pg_temp.p(1))) = 3,
  'gruppi: solo le persone visibili, come stati_stanza');
select pg_temp.ok(not exists (select 1 from public.gruppi_stanza(pg_temp.p(1)) g where g.gruppo not in ('uomini', 'donne', 'altre')),
  'gruppi: solo tre valori possibili, mai la descrizione scritta a mano');
reset role;

-- Stanza chiusa: nessuno.
update public.stanze set chiude_il = now() - interval '1 minute' where id = '6a6a6a6a-0000-4000-8000-00000000000a';
set local role service_role;
select pg_temp.ok(not exists (select 1 from public.gruppi_stanza(pg_temp.p(1))), 'gruppi: a stanza chiusa non si vede nessuno');
rollback;
