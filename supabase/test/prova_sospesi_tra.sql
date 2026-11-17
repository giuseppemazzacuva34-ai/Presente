-- Test di sospesi_tra(): quali persone di un elenco sono fuori adesso (sospensione cautelare o automatica, sanzione in
-- corso, uscita dalla stanza). Serve alle chiamate (#4), che oggi leggono solo la tabella sospensioni. Issue #7,
-- «Regole» › Sospensione: chiamate impossibili. Linea «sviluppatore-b», passo 14c. Dati inventati.
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
  select ('f5f5f5f5-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'st' || n || '@example.com' from generate_series(1, 9) n;

-- Il telefono non la lancia.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.p(1), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato(format($$select * from public.sospesi_tra(array[%L]::uuid[])$$, pg_temp.p(1))),
  'sospesi_tra: il telefono non la usa (solo il server)');
reset role;

set local role service_role;
-- 2: sospensione cautelare (minacce); 3: sanzione di 7 giorni decisa da una persona; 4: nessuna.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'minacce_pericolo', 'scheda', null, false);
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'soldi', 'scheda', null, false) as s3 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s3', 'sospensione_7', 'soldi', 'chiedeva regali');
select pg_temp.ok((select coalesce(array_agg(persona order by persona), '{}') from public.sospesi_tra(array[pg_temp.p(2), pg_temp.p(3), pg_temp.p(4)]))
  = array[pg_temp.p(2), pg_temp.p(3)], 'sospesi_tra: cautelare e sanzione in corso sì, chi non ha nulla no');
select pg_temp.ok((select count(*) from public.sospesi_tra(array[]::uuid[])) = 0 and (select count(*) from public.sospesi_tra(null)) = 0,
  'sospesi_tra: elenco vuoto → nessuno');
rollback;
