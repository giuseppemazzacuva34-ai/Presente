-- Test della scelta «Videochiamata di 10 secondi» / «Preferisco le foto» (issue #65 passo 3a; spec v1 del CPO, passo 3
-- e «Casi limite»). scelta_svelamento: si salva solo per sé, si cambia fino all'inizio dello svelamento, mai su una
-- porta chiusa, scaduta o di altri. svelamento_di: dice la propria scelta, mai quella dell'altra persona.
-- Linea «sviluppatore». Dati inventati, Postgres di prova.
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

begin;
insert into auth.users (id, email) values
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'va@example.com'), ('5b5b5b5b-0000-4000-8000-00000000005b', 'vb@example.com'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'vc@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'Vera', '1990-01-01', 'TO', 'donna'),
  ('5b5b5b5b-0000-4000-8000-00000000005b', 'Bice', '1988-06-01', 'TO', 'donna'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'Ciro', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour'),
  ('7e7e7e7e-0000-4000-8000-000000000002', 'italia', now() - interval '10 days', now() - interval '3 days');
-- Porte: Vera-Bice (aperta da 1 ora), Vera-Ciro (aperta da 3 giorni: 48 ore passate).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8d8d8d8d-0000-4000-8000-0000000000ab', '7e7e7e7e-0000-4000-8000-000000000001',
   '5a5a5a5a-0000-4000-8000-00000000005a', '5b5b5b5b-0000-4000-8000-00000000005b', now() - interval '1 hour'),
  ('8d8d8d8d-0000-4000-8000-0000000000ac', '7e7e7e7e-0000-4000-8000-000000000002',
   '5a5a5a5a-0000-4000-8000-00000000005a', '5c5c5c5c-0000-4000-8000-00000000005c', now() - interval '3 days');

-- Il telefono non chiama la funzione.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a', 'foto')$$),
  'scelta_svelamento: il telefono non la chiama');
reset role;
set local role service_role;

-- Predefinita: video.
select pg_temp.ok((select p ->> 'mia_scelta' = 'video' from jsonb_array_elements(public.svelamento_di('5a5a5a5a-0000-4000-8000-00000000005a') -> 'porte') p
  where p ->> 'porta' = '8d8d8d8d-0000-4000-8000-0000000000ab'), 'svelamento_di: scelta predefinita «video»');

-- Vera sceglie le foto: cambia solo la sua colonna; Bice resta «video».
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a', 'foto') = 'salvata',
  'scelta_svelamento: Vera sceglie le foto');
select pg_temp.ok((select scelta_a = 'foto' and scelta_b = 'video' from public.svelamenti where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ab'),
  'scelta_svelamento: salvata solo per Vera');
select pg_temp.ok((select p ->> 'mia_scelta' = 'foto' from jsonb_array_elements(public.svelamento_di('5a5a5a5a-0000-4000-8000-00000000005a') -> 'porte') p
  where p ->> 'porta' = '8d8d8d8d-0000-4000-8000-0000000000ab'), 'svelamento_di: Vera vede «foto»');
select pg_temp.ok((select p ->> 'mia_scelta' = 'video' and not p ? 'sua_scelta' and not p ? 'scelta_a' and not p ? 'scelta_b'
  from jsonb_array_elements(public.svelamento_di('5b5b5b5b-0000-4000-8000-00000000005b') -> 'porte') p),
  'svelamento_di: Bice vede solo la sua scelta, mai quella di Vera');

-- Si cambia idea quante volte si vuole prima dell'inizio.
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a', 'video') = 'salvata',
  'scelta_svelamento: Vera torna al video');
select pg_temp.ok((select scelta_a = 'video' from public.svelamenti where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ab'),
  'scelta_svelamento: di nuovo «video» nel database');

-- Valori sbagliati e persone fuori dalla porta: niente.
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a', 'audio') = 'scelta_non_valida'
  and public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a', null) = 'scelta_non_valida',
  'scelta_svelamento: solo «video» o «foto»');
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5c5c5c5c-0000-4000-8000-00000000005c', 'foto') = 'non_nella_porta'
  and public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ff', '5a5a5a5a-0000-4000-8000-00000000005a', 'foto') = 'non_nella_porta',
  'scelta_svelamento: porta di altri o inesistente → non_nella_porta');

-- Porta scaduta (48 ore passate, mai iniziata): chiusa, la scelta non si salva.
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a', 'foto') = 'porta_scaduta',
  'scelta_svelamento: porta scaduta');
select pg_temp.ok((select esito = 'scaduta' and scelta_a = 'video' from public.svelamenti where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ac'),
  'scelta_svelamento: la porta scaduta si chiude e la scelta non cambia');

-- Dopo l'inizio dello svelamento la scelta resta ferma.
select public.assegna_crediti_beta('5a5a5a5a-0000-4000-8000-00000000005a', 10);
select public.assegna_crediti_beta('5b5b5b5b-0000-4000-8000-00000000005b', 10);
select public.caparra_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a');
select public.caparra_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5b5b5b5b-0000-4000-8000-00000000005b');
reset role;
update public.svelamenti set iniziato_il = now(), tipo = 'video', tentativi = 1 where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ab';
set local role service_role;
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5b5b5b5b-0000-4000-8000-00000000005b', 'foto') = 'gia_iniziato'
  and (select scelta_b = 'video' from public.svelamenti where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ab'),
  'scelta_svelamento: dopo l''inizio non cambia più');

-- Porta chiusa da un blocco: «porta_chiusa», mai il motivo.
reset role;
update public.svelamenti set iniziato_il = null, tipo = null, tentativi = 0 where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ab';
insert into public.blocchi (chi, bloccato) values ('5b5b5b5b-0000-4000-8000-00000000005b', '5a5a5a5a-0000-4000-8000-00000000005a');
set local role service_role;
select pg_temp.ok(public.scelta_svelamento('8d8d8d8d-0000-4000-8000-0000000000ab', '5a5a5a5a-0000-4000-8000-00000000005a', 'foto') = 'porta_chiusa',
  'scelta_svelamento: porta con un blocco → porta_chiusa');
select pg_temp.ok((select esito = 'blocco' from public.svelamenti where porta_id = '8d8d8d8d-0000-4000-8000-0000000000ab')
  and public.saldo_crediti('5a5a5a5a-0000-4000-8000-00000000005a') = 10 and public.saldo_crediti('5b5b5b5b-0000-4000-8000-00000000005b') = 10,
  'scelta_svelamento: porta chiusa e crediti restituiti a entrambi');

reset role;
rollback;
