-- Test di conteggi_famiglie() (issue #471 parte C, spec v1 del CPO: soglia di 36 per famiglia). Dati inventati.
-- Solo numeri per area e famiglia; nessun id; chiamabile solo dal server.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('72727272-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.conto(area text, fam text) returns integer language sql as $$
  select coalesce((select totale from public.conteggi_famiglie() where codice = area and famiglia = fam), 0)
$$;
create function pg_temp.donne(area text, fam text) returns integer language sql as $$
  select coalesce((select donne from public.conteggi_famiglie() where codice = area and famiglia = fam), 0)
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'famiglie' || n || '@example.com' from generate_series(1, 9) n;
-- 1-2: uomo→uomini (Bologna e Ferrara: stessa area), 3: donna→donne (Milano), 4: donna→uomini (Milano),
-- 5: uomo→donne (Milano), 6: non binario→non binari (Milano), 7: donna→donne e uomini (ponte, Milano),
-- 8: uomo→uomini ma iscrizione non finita (non conta), 9: uomo→uomini all'estero (nessuna area).
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Uno', '1990-01-01', 'BO', 'uomo'), (pg_temp.p(2), 'Due', '1990-01-01', 'FE', 'uomo'),
  (pg_temp.p(3), 'Tre', '1990-01-01', 'MI', 'donna'), (pg_temp.p(4), 'Quattro', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(5), 'Cinque', '1990-01-01', 'MI', 'uomo'), (pg_temp.p(6), 'Sei', '1990-01-01', 'MI', 'non_binario'),
  (pg_temp.p(7), 'Sette', '1990-01-01', 'MI', 'donna'), (pg_temp.p(8), 'Otto', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(9), 'Nove', '1990-01-01', 'EE', 'uomo');
update public.profili set passo = 11 where id <> pg_temp.p(8) and id::text like '72727272-%';
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio) values
  (pg_temp.p(1), '{uomini}', now(), '1.5', 18, 99, 'italia'), (pg_temp.p(2), '{uomini}', now(), '1.5', 18, 99, 'citta'),
  (pg_temp.p(3), '{donne}', now(), '1.5', 18, 99, 'italia'), (pg_temp.p(4), '{uomini}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(5), '{donne}', now(), '1.5', 18, 99, 'italia'), (pg_temp.p(6), '{non_binari}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(7), '{donne,uomini}', now(), '1.5', 18, 99, 'italia'), (pg_temp.p(8), '{uomini}', now(), '1.5', 18, 99, 'italia'),
  (pg_temp.p(9), '{uomini}', now(), '1.5', 18, 99, 'estero');

select pg_temp.ok(pg_temp.conto('bologna', 'uomini') = 2, 'dedicata uomini a Bologna: Bologna + Ferrara (stessa area)');
select pg_temp.ok(pg_temp.conto('bologna', 'mista') = 0, 'chi cerca il proprio genere non entra nel conto della mista');
select pg_temp.ok(pg_temp.conto('milano', 'donne') = 1 and pg_temp.donne('milano', 'donne') = 1, 'dedicata donne a Milano');
select pg_temp.ok(pg_temp.conto('milano', 'mista') = 2 and pg_temp.donne('milano', 'mista') = 1, 'mista a Milano: 2 profili, 1 donna');
select pg_temp.ok(pg_temp.conto('milano', 'aperta') = 1, 'aperta a Milano');
select pg_temp.ok(pg_temp.conto('milano', 'ponte') = 1, 'più scelte = ponte');
select pg_temp.ok(pg_temp.conto('milano', 'uomini') = 0, 'iscrizione non finita: non conta');
select pg_temp.ok((select count(*) from public.conteggi_famiglie() where codice is null) = 0, 'estero: nessuna area');
select pg_temp.ok((select string_agg(a.attname, ',' order by a.attnum) from pg_proc f
  cross join lateral unnest(f.proargnames) with ordinality a(attname, attnum)
  where f.proname = 'conteggi_famiglie') = 'codice,famiglia,totale,donne', 'solo numeri: codice, famiglia, totale, donne (nessun id)');
select pg_temp.ok(not has_function_privilege('authenticated', 'public.conteggi_famiglie()', 'execute')
  and not has_function_privilege('anon', 'public.conteggi_famiglie()', 'execute')
  and has_function_privilege('service_role', 'public.conteggi_famiglie()', 'execute'), 'solo il server può chiamarla');
rollback;
