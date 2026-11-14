-- Test degli effetti di blocco e sospensione nella stanza (issue #7 spec v1.1, «Regole»: sospensione → la persona
-- sparisce dalle stanze, chiavi annullate; blocco → non si vedono più in stanza). Linea «sviluppatore-b».
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
create function pg_temp.vede(chi uuid) returns text[] language plpgsql as $$
declare r text[];
begin
  perform pg_temp.come(chi);
  select coalesce(array_agg(nome order by nome), '{}') into r from public.compagni_di_stanza();
  reset role;
  return r;
end $$;

begin;
-- Ugo cerca donne; Ada, Bea e Cia cercano uomini. Stessa stanza aperta, tutti si sono chiamati con Ugo.
insert into auth.users (id, email) values
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'sa@example.com'), ('9b9b9b9b-0000-4000-8000-00000000009b', 'sb@example.com'),
  ('9c9c9c9c-0000-4000-8000-00000000009c', 'sc@example.com'), ('9d9d9d9d-0000-4000-8000-00000000009d', 'su@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'Ada', '1990-01-01', 'MI', 'donna'),
  ('9b9b9b9b-0000-4000-8000-00000000009b', 'Bea', '1990-01-01', 'MI', 'donna'),
  ('9c9c9c9c-0000-4000-8000-00000000009c', 'Cia', '1990-01-01', 'MI', 'donna'),
  ('9d9d9d9d-0000-4000-8000-00000000009d', 'Ugo', '1990-01-01', 'MI', 'uomo');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select id, case when nome = 'Ugo' then 'donne' else 'uomini' end, now(), '1.5', 25, 50, 'italia' from public.profili
  where id::text like '9_9_9_9_-0000-%';
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5a5a5a5a-0000-4000-8000-000000000001', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select '5a5a5a5a-0000-4000-8000-000000000001', id from public.profili where id::text like '9_9_9_9_-0000-%';
insert into public.chiamate (chi, con, inizio, durata, esito)
  select '9d9d9d9d-0000-4000-8000-00000000009d', id, now() - interval '1 day' - (ascii(nome) * interval '1 hour') / 100, 300, 'chiusa'
  from public.profili
  where id::text like '9_9_9_9_-0000-%' and nome <> 'Ugo';

select pg_temp.ok(pg_temp.vede('9d9d9d9d-0000-4000-8000-00000000009d') = array['Ada', 'Bea', 'Cia'],
  'stanza: prima di tutto Ugo vede Ada, Bea e Cia');

-- 1. Blocco: Bea blocca Ugo. Non si vedono più, in nessuno dei due versi.
insert into public.blocchi (chi, bloccato) values ('9b9b9b9b-0000-4000-8000-00000000009b', '9d9d9d9d-0000-4000-8000-00000000009d');
select pg_temp.ok(pg_temp.vede('9d9d9d9d-0000-4000-8000-00000000009d') = array['Ada', 'Cia'],
  'blocco: chi è stato bloccato non vede più chi l''ha bloccato');
select pg_temp.ok(pg_temp.vede('9b9b9b9b-0000-4000-8000-00000000009b') = '{}'::text[],
  'blocco: chi blocca non vede più la persona bloccata');

-- 2. Sospensione: Ada e Ugo si sono dati la chiave; Cia segnala Ugo per minacce → sospensione cautelare.
set local role service_role;
select pg_temp.ok(public.dai_chiave('9a9a9a9a-0000-4000-8000-00000000009a', '9d9d9d9d-0000-4000-8000-00000000009d', null) = 'ok'
  and public.dai_chiave('9d9d9d9d-0000-4000-8000-00000000009d', '9a9a9a9a-0000-4000-8000-00000000009a', null) = 'ok',
  'sospensione: prima, Ada e Ugo si danno la chiave');
select public.nuova_segnalazione('9c9c9c9c-0000-4000-8000-00000000009c', '9d9d9d9d-0000-4000-8000-00000000009d',
  'minacce_pericolo', 'scheda', null, false);
select pg_temp.ok(public.sospeso('9d9d9d9d-0000-4000-8000-00000000009d'), 'sospensione: Ugo è sospeso');
select pg_temp.ok(not exists (select 1 from public.chiavi where da = '9d9d9d9d-0000-4000-8000-00000000009d'
  or a = '9d9d9d9d-0000-4000-8000-00000000009d'), 'sospensione: chiavi date e ricevute da Ugo annullate');
select pg_temp.ok(pg_temp.rifiutato($$select public.dai_chiave('9a9a9a9a-0000-4000-8000-00000000009a',
  '9d9d9d9d-0000-4000-8000-00000000009d', null)$$)
  and pg_temp.rifiutato($$select public.dai_chiave('9d9d9d9d-0000-4000-8000-00000000009d',
  '9c9c9c9c-0000-4000-8000-00000000009c', null)$$)
  and not exists (select 1 from public.chiavi where da = '9d9d9d9d-0000-4000-8000-00000000009d'
  or a = '9d9d9d9d-0000-4000-8000-00000000009d'),
  'sospensione: nessuna chiave nuova verso o da chi è sospeso, neanche dal server');
reset role;
select pg_temp.ok(pg_temp.vede('9a9a9a9a-0000-4000-8000-00000000009a') = '{}'::text[]
  and pg_temp.vede('9c9c9c9c-0000-4000-8000-00000000009c') = '{}'::text[],
  'sospensione: Ugo sparisce dalla stanza degli altri');

-- 3. Una persona toglie la sospensione: Ugo torna visibile a chi non l'ha bloccato (le chiavi annullate non tornano).
update public.sospensioni set tolta_il = now() where persona = '9d9d9d9d-0000-4000-8000-00000000009d';
select pg_temp.ok(pg_temp.vede('9a9a9a9a-0000-4000-8000-00000000009a') = array['Ugo']
  and pg_temp.vede('9b9b9b9b-0000-4000-8000-00000000009b') = '{}'::text[],
  'sospensione tolta: Ugo torna nella stanza di Ada, non in quella di Bea che l''ha bloccato');
select pg_temp.ok(not exists (select 1 from public.chiavi where a = '9d9d9d9d-0000-4000-8000-00000000009d'),
  'sospensione tolta: le chiavi annullate non tornano');
rollback;
