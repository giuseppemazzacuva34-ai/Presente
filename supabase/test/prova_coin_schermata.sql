-- Test della schermata «I tuoi Coin» già vista (issue #331 spec v1 del CPO, parte B.5: «non si ripresenta da sola
-- dopo il primo ingresso»). Linea «sviluppatore-c». Solo il server legge e scrive; il telefono non vede la tabella.
-- Dati inventati, Postgres di prova.
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

begin;
insert into auth.users (id, email) values
  ('c0170000-0000-4000-8000-000000000001', 'coinvista1@example.com'),
  ('c0170000-0000-4000-8000-000000000002', 'coinvista2@example.com');

select pg_temp.ok(public.coin_schermata_vista('c0170000-0000-4000-8000-000000000001') = false,
  'coin: all''inizio la schermata non è ancora vista');
select public.segna_coin_schermata_vista('c0170000-0000-4000-8000-000000000001');
select pg_temp.ok(public.coin_schermata_vista('c0170000-0000-4000-8000-000000000001') = true,
  'coin: dopo «Continua» risulta vista');
select public.segna_coin_schermata_vista('c0170000-0000-4000-8000-000000000001');
select pg_temp.ok((select count(*) from public.coin_schermate_viste
  where persona = 'c0170000-0000-4000-8000-000000000001') = 1, 'coin: segnarla due volte lascia una riga sola');
select pg_temp.ok(public.coin_schermata_vista('c0170000-0000-4000-8000-000000000002') = false,
  'coin: vale solo per chi l''ha vista');
select pg_temp.ok(public.coin_schermata_vista(null) = false, 'coin: persona mancante non risulta vista');

-- Il telefono (anon o authenticated) non legge né scrive la tabella e non chiama le funzioni.
select pg_temp.come('c0170000-0000-4000-8000-000000000002');
select pg_temp.ok(pg_temp.rifiutato('select * from public.coin_schermate_viste'), 'coin: la tabella non si legge dal telefono');
select pg_temp.ok(pg_temp.rifiutato($q$insert into public.coin_schermate_viste (persona) values ('c0170000-0000-4000-8000-000000000002')$q$),
  'coin: la tabella non si scrive dal telefono');
select pg_temp.ok(pg_temp.rifiutato($q$select public.segna_coin_schermata_vista('c0170000-0000-4000-8000-000000000002')$q$),
  'coin: segna_coin_schermata_vista solo dal server');
select pg_temp.ok(pg_temp.rifiutato($q$select public.coin_schermata_vista('c0170000-0000-4000-8000-000000000001')$q$),
  'coin: coin_schermata_vista solo dal server');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.coin_schermate_viste'::regclass),
  'coin: regole per riga attive sulla tabella');
rollback;
