-- Test di prima_stanza_usata (issue #349 / spec #331 v1.1 punto 5, linea «sviluppatore-b»): il foglio «Coin quasi
-- finiti» non compare a chi non ha ancora usato la prima stanza in regalo. Solo il server chiama la funzione.
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
  ('b0349000-0000-4000-8000-000000000001', 'primastanza1@example.com'),
  ('b0349000-0000-4000-8000-000000000002', 'primastanza2@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('b0349000-0000-4000-8000-000000000001', 'Prova', '1990-01-01', 'MI', 'donna'),
  ('b0349000-0000-4000-8000-000000000002', 'Prova', '1990-01-01', 'MI', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('b0349000-0000-4000-8000-0000000000a1', 'italia', now() - interval '3 days', now() + interval '2 days');
insert into public.membri_stanza (stanza_id, utente_id, gratis) values
  ('b0349000-0000-4000-8000-0000000000a1', 'b0349000-0000-4000-8000-000000000001', true);

select pg_temp.ok(public.prima_stanza_usata('b0349000-0000-4000-8000-000000000001') = true,
  'prima stanza: chi è entrato in una stanza l''ha usata');
select pg_temp.ok(public.prima_stanza_usata('b0349000-0000-4000-8000-000000000002') = false,
  'prima stanza: chi non è mai entrato in una stanza non l''ha usata');
select pg_temp.ok(public.prima_stanza_usata(null) = false, 'prima stanza: persona mancante → no');

select pg_temp.come('b0349000-0000-4000-8000-000000000001');
select pg_temp.ok(pg_temp.rifiutato($q$select public.prima_stanza_usata('b0349000-0000-4000-8000-000000000001')$q$),
  'prima stanza: prima_stanza_usata solo dal server');
reset role;
rollback;
