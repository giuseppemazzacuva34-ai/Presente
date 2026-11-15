-- Test della stanza chiusa in sola lettura (issue #5 spec v1.1 passo 9): dalla chiusura (domenica 21:00) a lunedì
-- 9:00 di Roma si vedono ancora i compagni della stanza appena chiusa; dopo, niente. Linea «sviluppatore».
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
create function pg_temp.chiusa(chi uuid) returns text[] language plpgsql as $$
declare r text[];
begin
  perform pg_temp.come(chi);
  select coalesce(array_agg(nome order by nome), '{}') into r from public.compagni_stanza_chiusa();
  reset role;
  return r;
end $$;
create function pg_temp.aperta(chi uuid) returns text[] language plpgsql as $$
declare r text[];
begin
  perform pg_temp.come(chi);
  select coalesce(array_agg(nome order by nome), '{}') into r from public.compagni_di_stanza();
  reset role;
  return r;
end $$;

begin;
insert into auth.users (id, email) values
  ('8a8a8a8a-0000-4000-8000-00000000008a', 'ca@example.com'), ('8b8b8b8b-0000-4000-8000-00000000008b', 'cb@example.com'),
  ('8d8d8d8d-0000-4000-8000-00000000008d', 'cu@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('8a8a8a8a-0000-4000-8000-00000000008a', 'Ada', '1990-01-01', 'MI', 'donna'),
  ('8b8b8b8b-0000-4000-8000-00000000008b', 'Bea', '1990-01-01', 'MI', 'donna'),
  ('8d8d8d8d-0000-4000-8000-00000000008d', 'Ugo', '1990-01-01', 'MI', 'uomo');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select id, case when nome = 'Ugo' then 'donne' else 'uomini' end, now(), '1.5', 25, 50, 'italia' from public.profili
  where id::text like '8_8_8_8_-0000-%';
-- Stanza chiusa un'ora fa: la sua «lunedì 9:00» è sempre dopo adesso.
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5c5c5c5c-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour');
insert into public.membri_stanza (stanza_id, utente_id)
  select '5c5c5c5c-0000-4000-8000-000000000001', id from public.profili where id::text like '8_8_8_8_-0000-%';

select pg_temp.ok(pg_temp.aperta('8d8d8d8d-0000-4000-8000-00000000008d') = '{}'::text[],
  'stanza chiusa: compagni_di_stanza() non dà più nessuno');
select pg_temp.ok(pg_temp.chiusa('8d8d8d8d-0000-4000-8000-00000000008d') = array['Ada', 'Bea'],
  'stanza chiusa: fino a lunedì 9:00 Ugo vede ancora Ada e Bea in sola lettura');
select pg_temp.ok(pg_temp.chiusa('8a8a8a8a-0000-4000-8000-00000000008a') = array['Ugo'],
  'stanza chiusa: Ada vede solo le persone compatibili (Ugo)');

-- Blocco e sospensione valgono anche nella stanza chiusa.
insert into public.blocchi (chi, bloccato) values ('8b8b8b8b-0000-4000-8000-00000000008b', '8d8d8d8d-0000-4000-8000-00000000008d');
select pg_temp.ok(pg_temp.chiusa('8d8d8d8d-0000-4000-8000-00000000008d') = array['Ada'],
  'stanza chiusa: chi ti ha bloccato non si vede più');

-- Mentre la stanza è aperta, compagni_stanza_chiusa() non dà niente.
update public.stanze set apre_il = now() - interval '1 day', chiude_il = now() + interval '1 day' where id = '5c5c5c5c-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.chiusa('8d8d8d8d-0000-4000-8000-00000000008d') = '{}'::text[]
  and pg_temp.aperta('8d8d8d8d-0000-4000-8000-00000000008d') = array['Ada'],
  'stanza aperta: niente sola lettura, i compagni arrivano da compagni_di_stanza()');

-- Il calcolo della fine: domenica 21:00 → lunedì 9:00 di Roma, anche con il cambio d'ora.
select pg_temp.ok(public.fine_sola_lettura(timestamptz '2026-11-15 21:00 Europe/Rome') = timestamptz '2026-11-16 09:00 Europe/Rome',
  'fine della sola lettura: domenica 21:00 → lunedì 9:00 di Roma');
select pg_temp.ok(public.fine_sola_lettura(timestamptz '2026-10-25 21:00 Europe/Rome') = timestamptz '2026-10-26 09:00 Europe/Rome',
  'fine della sola lettura: giusta anche la domenica del cambio d''ora');

-- Chiusa da 3 giorni: il lunedì 9:00 dopo la chiusura è passato, non si vede più nessuno.
update public.stanze set apre_il = now() - interval '9 days', chiude_il = now() - interval '3 days'
  where id = '5c5c5c5c-0000-4000-8000-000000000001';
select pg_temp.ok(pg_temp.chiusa('8d8d8d8d-0000-4000-8000-00000000008d') = '{}'::text[],
  'stanza chiusa da prima di lunedì 9:00: non si vede più');

-- Chi non è collegato non può leggere.
select pg_temp.ok(not has_function_privilege('anon', 'public.compagni_stanza_chiusa()', 'execute'),
  'stanza chiusa: anon non può usarla');
rollback;
