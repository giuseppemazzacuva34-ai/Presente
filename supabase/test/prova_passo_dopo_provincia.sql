-- Segnalazione di Giuseppe (24/11, primo accesso da tester): al passo «Chi cerchi» l'app dice «Prima scegli la tua
-- provincia» anche se la provincia è già salvata. L'app salva il passo con un upsert (insert … on conflict do update):
-- Postgres esegue PRIMA il trigger «before insert» sulla riga proposta, che ha solo id e passo (provincia vuota),
-- e controlla_provincia() la rifiutava. Qui si prova l'upsert come lo fa l'app. Dati inventati.
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
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'passo-a@example.com'),
  ('9b9b9b9b-0000-4000-8000-00000000009b', 'passo-b@example.com');
select pg_temp.come('9a9a9a9a-0000-4000-8000-00000000009a');
-- Passi 3-5 come l'app: data di nascita, passo, profilo con provincia, passo 5.
insert into public.profili (id, data_nascita) values ('9a9a9a9a-0000-4000-8000-00000000009a', '1990-01-01')
  on conflict (id) do update set data_nascita = excluded.data_nascita;
insert into public.profili (id, nome, provincia, provincia_origine, paese, mi_presento_come)
  values ('9a9a9a9a-0000-4000-8000-00000000009a', 'Ada', 'MI', 'scelta', 'IT', 'donna')
  on conflict (id) do update set nome = excluded.nome, provincia = excluded.provincia, provincia_origine = excluded.provincia_origine,
    paese = excluded.paese, mi_presento_come = excluded.mi_presento_come;
insert into public.profili (id, passo) values ('9a9a9a9a-0000-4000-8000-00000000009a', 5)
  on conflict (id) do update set passo = excluded.passo;
-- Passo 6 («Chi cerchi»): solo id e passo, la provincia c'è già nella riga salvata.
insert into public.profili (id, passo) values ('9a9a9a9a-0000-4000-8000-00000000009a', 6)
  on conflict (id) do update set passo = excluded.passo;
select pg_temp.ok((select passo = 6 and provincia = 'MI' from public.profili where id = '9a9a9a9a-0000-4000-8000-00000000009a'),
  'passo 6 salvato con upsert quando la provincia è già nella riga');
-- La regola resta: senza provincia salvata non si va oltre il passo 5, né con upsert né con update.
select pg_temp.come('9b9b9b9b-0000-4000-8000-00000000009b');
select pg_temp.ok(pg_temp.rifiutato($q$insert into public.profili (id, passo) values ('9b9b9b9b-0000-4000-8000-00000000009b', 6)
  on conflict (id) do update set passo = excluded.passo$q$), 'nuova riga senza provincia al passo 6: rifiutata');
insert into public.profili (id, passo) values ('9b9b9b9b-0000-4000-8000-00000000009b', 5)
  on conflict (id) do update set passo = excluded.passo;
select pg_temp.ok(pg_temp.rifiutato($q$insert into public.profili (id, passo) values ('9b9b9b9b-0000-4000-8000-00000000009b', 6)
  on conflict (id) do update set passo = excluded.passo$q$), 'riga senza provincia, upsert al passo 6: rifiutato');
select pg_temp.ok(pg_temp.rifiutato($q$update public.profili set passo = 6 where id = '9b9b9b9b-0000-4000-8000-00000000009b'$q$),
  'riga senza provincia, update al passo 6: rifiutato');
rollback;
