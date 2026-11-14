-- Test: porte con una persona sospesa (issue #5 spec v1.1, «Casi limite»: chiave a chi lascia la stanza
-- per sospensione → «Non è più nella stanza»; issue #7 «Sospensione»). Linea «sviluppatore-c».
-- porta_aperta e porte_di (e quindi la sera) non mostrano le porte con una persona sospesa; tornano se la
--    sospensione viene tolta. Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;

begin;
insert into auth.users (id, email) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'ka@example.com'), ('7b7b7b7b-0000-4000-8000-00000000007b', 'kb@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'kc@example.com'), ('7d7d7d7d-0000-4000-8000-00000000007d', 'ku@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000007b', 'Bea', '1990-01-01', 'TO', 'donna'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'Cia', '1990-01-01', 'TO', 'donna'),
  ('7d7d7d7d-0000-4000-8000-00000000007d', 'Ugo', '1990-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6a6a6a6a-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '6 days'),
  ('6a6a6a6a-0000-4000-8000-000000000002', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select s, p.id from public.profili p,
    unnest(array['6a6a6a6a-0000-4000-8000-000000000001', '6a6a6a6a-0000-4000-8000-000000000002']::uuid[]) s
  where p.id::text like '7_7_7_7_-0000-%';
insert into public.chiamate (chi, con, inizio, durata, esito)
  select '7d7d7d7d-0000-4000-8000-00000000007d', id, now() - interval '1 day' - ascii(nome) * interval '1 minute', 300, 'chiusa'
  from public.profili where id::text like '7_7_7_7_-0000-%' and nome <> 'Ugo';
-- Una porta della settimana prima tra Ada e Ugo.
insert into public.porte (stanza_id, a, b, aperta_il) values
  ('6a6a6a6a-0000-4000-8000-000000000001', '7a7a7a7a-0000-4000-8000-00000000007a', '7d7d7d7d-0000-4000-8000-00000000007d',
   now() - interval '6 days');

set local role service_role;
select pg_temp.ok(exists (select 1 from public.porta_aperta('7a7a7a7a-0000-4000-8000-00000000007a',
  '7d7d7d7d-0000-4000-8000-00000000007d')), 'prima: la porta tra Ada e Ugo è aperta');

-- Cia segnala Ugo per minacce → sospensione cautelare.
select public.nuova_segnalazione('7c7c7c7c-0000-4000-8000-00000000007c', '7d7d7d7d-0000-4000-8000-00000000007d',
  'minacce_pericolo', 'scheda', null, false);
select pg_temp.ok(public.sospeso('7d7d7d7d-0000-4000-8000-00000000007d'), 'Ugo è sospeso');

select pg_temp.ok(not exists (select 1 from public.porta_aperta('7a7a7a7a-0000-4000-8000-00000000007a',
  '7d7d7d7d-0000-4000-8000-00000000007d')), 'porta_aperta: nessuna porta con chi è sospeso');
select pg_temp.ok(not exists (select 1 from public.porte_di('7a7a7a7a-0000-4000-8000-00000000007a'))
  and not exists (select 1 from public.porte_di('7d7d7d7d-0000-4000-8000-00000000007d')),
  'porte_di: la porta con chi è sospeso non compare, per nessuno dei due');

reset role;
update public.sospensioni set tolta_il = now() where persona = '7d7d7d7d-0000-4000-8000-00000000007d';
set local role service_role;
select pg_temp.ok(exists (select 1 from public.porta_aperta('7d7d7d7d-0000-4000-8000-00000000007d',
  '7a7a7a7a-0000-4000-8000-00000000007a')) and exists (select 1 from public.porte_di('7a7a7a7a-0000-4000-8000-00000000007a')),
  'sospensione tolta: la porta torna visibile');
select pg_temp.ok(public.dai_chiave('7b7b7b7b-0000-4000-8000-00000000007b', '7d7d7d7d-0000-4000-8000-00000000007d', null)
  = 'ok', 'sospensione tolta: le chiavi si possono dare di nuovo');
reset role;
rollback;
