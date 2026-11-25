-- Test di «Voglio incontrare» a più scelte (issue #471, spec v1 del CPO, parte B; criteri 5 e 10).
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
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
  select ('71717171-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
-- Criterio 5: la conversione del testo di prima (la stessa usata dalla migrazione) non perde niente.
select pg_temp.ok(public.cerco_da_testo('tutti') = array['donne', 'uomini', 'non_binari']
  and public.cerco_da_testo('donne') = array['donne'] and public.cerco_da_testo('uomini') = array['uomini']
  and public.cerco_da_testo(null) is null, 'migrazione: tutti → tre scelte, donne → [donne], uomini → [uomini], vuoto resta vuoto');
select pg_temp.ok((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'filtri'
  and column_name = 'cerco') = 'ARRAY', '«cerco» è un elenco');

insert into auth.users (id, email) select pg_temp.p(n), 'voglio' || n || '@example.com' from generate_series(1, 5) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Uno', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(2), 'Due', '1990-01-01', 'MI', 'non_binario'),
  (pg_temp.p(3), 'Tre', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(4), 'Quattro', '1990-01-01', 'MI', 'mi_descrivo'),
  (pg_temp.p(5), 'Cinque', '1990-01-01', 'MI', 'uomo');

-- Solo scelte note, almeno una, mai senza consenso.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa)
  values ('71717171-0000-4000-8000-000000000001', '{}', now(), '1.5')$$), 'elenco vuoto rifiutato');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa)
  values ('71717171-0000-4000-8000-000000000001', '{tutti}', now(), '1.5')$$), 'valore sconosciuto («tutti») rifiutato');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.filtri (utente_id, cerco)
  values ('71717171-0000-4000-8000-000000000001', '{uomini}')$$), 'senza consenso non si salva');

insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio) values
  (pg_temp.p(1), '{uomini,non_binari}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(2), '{uomini}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(3), '{donne,uomini}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(4), '{donne,uomini,non_binari}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(5), '{donne}', now(), '1.5', 18, 99, 'italia');

select pg_temp.ok(public.rientra_nei_filtri(pg_temp.p(1), pg_temp.p(2)) and public.rientra_nei_filtri(pg_temp.p(2), pg_temp.p(1)),
  'uomo → [uomini, non_binari] e persona non binaria → [uomini]: compatibili');
select pg_temp.ok(public.rientra_nei_filtri(pg_temp.p(1), pg_temp.p(4)), '«mi descrivo» conta come non binario per gli altri');
select pg_temp.ok(not public.rientra_nei_filtri(pg_temp.p(1), pg_temp.p(3)), 'uomo → [uomini, non_binari] non rientra con una donna');
select pg_temp.ok(public.rientra_nei_filtri(pg_temp.p(3), pg_temp.p(5)) and public.rientra_nei_filtri(pg_temp.p(5), pg_temp.p(3)),
  'donna → [donne, uomini] e uomo → [donne]: compatibili');
select pg_temp.ok(not public.rientra_nei_filtri(pg_temp.p(5), pg_temp.p(4)), 'uomo → [donne] non rientra con chi si descrive');

-- Il consenso: cambiare le scelte rinnova la data, toglierle la cancella (requisito 3 del CISO, anche con l'elenco).
update public.filtri set consenso_cerco_il = '2020-01-01' where utente_id = pg_temp.p(5);
select pg_temp.ok((select consenso_cerco_il from public.filtri where utente_id = pg_temp.p(5)) = now(), 'data del consenso: la decide il server');
update public.filtri set cerco = null where utente_id = pg_temp.p(5);
select pg_temp.ok((select consenso_cerco_il from public.filtri where utente_id = pg_temp.p(5)) is null, 'consenso ritirato: data cancellata');
rollback;
