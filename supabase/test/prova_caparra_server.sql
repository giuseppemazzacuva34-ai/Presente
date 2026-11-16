-- Test della caparra dal server (issue #65 passo 4a; spec v1 del CPO, «Regole» e «Casi limite»; risposta CPO 13/11).
-- caparra_svelamento: prima di bloccare chiude le porte bloccate, con una persona sospesa o scadute (48 ore), e
-- restituisce le caparre a entrambi. svelamento_di: saldo e porte in attesa di svelamento di chi chiede.
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
  ('4a4a4a4a-0000-4000-8000-00000000004a', 'sa@example.com'), ('4b4b4b4b-0000-4000-8000-00000000004b', 'sb@example.com'),
  ('4c4c4c4c-0000-4000-8000-00000000004c', 'sc@example.com'), ('4d4d4d4d-0000-4000-8000-00000000004d', 'sd@example.com'),
  ('4e4e4e4e-0000-4000-8000-00000000004e', 'se@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('4a4a4a4a-0000-4000-8000-00000000004a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('4b4b4b4b-0000-4000-8000-00000000004b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('4c4c4c4c-0000-4000-8000-00000000004c', 'Carlo', '1985-01-01', 'TO', 'uomo'),
  ('4d4d4d4d-0000-4000-8000-00000000004d', 'Dario', '1985-01-01', 'TO', 'uomo'),
  ('4e4e4e4e-0000-4000-8000-00000000004e', 'Elio', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour'),
  ('6e6e6e6e-0000-4000-8000-000000000002', 'italia', now() - interval '10 days', now() - interval '3 days');
-- Porte: Ada-Bruno (aperta da 1 ora), Ada-Carlo (aperta da 1 ora), Ada-Dario (aperta da 1 ora),
-- Ada-Elio (aperta da 3 giorni: 48 ore passate).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9d9d9d9d-0000-4000-8000-0000000000ab', '6e6e6e6e-0000-4000-8000-000000000001',
   '4a4a4a4a-0000-4000-8000-00000000004a', '4b4b4b4b-0000-4000-8000-00000000004b', now() - interval '1 hour'),
  ('9d9d9d9d-0000-4000-8000-0000000000ac', '6e6e6e6e-0000-4000-8000-000000000001',
   '4a4a4a4a-0000-4000-8000-00000000004a', '4c4c4c4c-0000-4000-8000-00000000004c', now() - interval '1 hour'),
  ('9d9d9d9d-0000-4000-8000-0000000000ad', '6e6e6e6e-0000-4000-8000-000000000001',
   '4a4a4a4a-0000-4000-8000-00000000004a', '4d4d4d4d-0000-4000-8000-00000000004d', now() - interval '1 hour'),
  ('9d9d9d9d-0000-4000-8000-0000000000ae', '6e6e6e6e-0000-4000-8000-000000000002',
   '4a4a4a4a-0000-4000-8000-00000000004a', '4e4e4e4e-0000-4000-8000-00000000004e', now() - interval '3 days');

-- Il telefono non chiama queste funzioni.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ab', '4a4a4a4a-0000-4000-8000-00000000004a')$$),
  'caparra_svelamento: il telefono non la chiama');
select pg_temp.ok(pg_temp.rifiutato($$select public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a')$$),
  'svelamento_di: il telefono non la chiama');
reset role;
set local role service_role;

select public.assegna_crediti_beta('4a4a4a4a-0000-4000-8000-00000000004a', 50);
select public.assegna_crediti_beta('4b4b4b4b-0000-4000-8000-00000000004b', 10);
select public.assegna_crediti_beta('4c4c4c4c-0000-4000-8000-00000000004c', 10);
select public.assegna_crediti_beta('4d4d4d4d-0000-4000-8000-00000000004d', 10);

-- Stato prima di tutto: 4 porte di Ada, la più vecchia è scaduta e non compare.
select pg_temp.ok((public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') ->> 'saldo')::int = 50, 'svelamento_di: saldo di Ada 50');
select pg_temp.ok(jsonb_array_length(public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') -> 'porte') = 3,
  'svelamento_di: 3 porte in attesa (quella scaduta non compare)');
select pg_temp.ok((select p ->> 'nome' = 'Bruno' and (p ->> 'mia_caparra')::boolean = false and (p ->> 'sua_caparra')::boolean = false
    and (p ->> 'scade_il')::timestamptz = now() + interval '47 hours' and (p ->> 'eta')::int >= 18
    and not p ? 'email' and not p ? 'data_nascita'
  from jsonb_array_elements(public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') -> 'porte') p
  where p ->> 'porta' = '9d9d9d9d-0000-4000-8000-0000000000ab'),
  'svelamento_di: nome, età e scadenza a 48 ore; niente email né data di nascita');
select pg_temp.ok(jsonb_array_length(public.svelamento_di('4c4c4c4c-0000-4000-8000-00000000004c') -> 'porte') = 1
  and public.svelamento_di('4c4c4c4c-0000-4000-8000-00000000004c') -> 'porte' -> 0 ->> 'nome' = 'Ada',
  'svelamento_di: Carlo vede solo la sua porta, con il nome di Ada');

-- Caparra normale.
select pg_temp.ok(public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ab', '4a4a4a4a-0000-4000-8000-00000000004a') = 'bloccata',
  'caparra_svelamento: Ada blocca 10 crediti con Bruno');
select pg_temp.ok(public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ab', '4c4c4c4c-0000-4000-8000-00000000004c') = 'non_nella_porta',
  'caparra_svelamento: chi non è nella porta non blocca nulla');
select pg_temp.ok(public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ab', '4a4a4a4a-0000-4000-8000-00000000004a') = 'gia_bloccata',
  'caparra_svelamento: il secondo tocco non scala altri crediti');
select pg_temp.ok((select (p ->> 'mia_caparra')::boolean and not (p ->> 'sua_caparra')::boolean
  from jsonb_array_elements(public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') -> 'porte') p
  where p ->> 'porta' = '9d9d9d9d-0000-4000-8000-0000000000ab'), 'svelamento_di: Ada vede la sua caparra, non ancora quella di Bruno');
select pg_temp.ok((select not (p ->> 'mia_caparra')::boolean and (p ->> 'sua_caparra')::boolean
  from jsonb_array_elements(public.svelamento_di('4b4b4b4b-0000-4000-8000-00000000004b') -> 'porte') p),
  'svelamento_di: Bruno vede che Ada ha bloccato («Aspettiamo che anche…» al contrario)');
select pg_temp.ok((public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') ->> 'saldo')::int = 40, 'svelamento_di: saldo di Ada sceso a 40');

-- Sospensione dell'altro durante le 48 ore: porta chiusa, caparra restituita a entrambi (risposta CPO 13/11).
select public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ac', '4a4a4a4a-0000-4000-8000-00000000004a');
select public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ac', '4c4c4c4c-0000-4000-8000-00000000004c');
select pg_temp.ok(public.saldo_crediti('4c4c4c4c-0000-4000-8000-00000000004c') = 0, 'prima: Carlo ha bloccato i suoi 10');
select public.nuova_segnalazione('4b4b4b4b-0000-4000-8000-00000000004b', '4c4c4c4c-0000-4000-8000-00000000004c',
  'minacce_pericolo', 'scheda', null, false);
select pg_temp.ok(public.sospeso('4c4c4c4c-0000-4000-8000-00000000004c'), 'Carlo è sospeso');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') -> 'porte') p
  where p ->> 'porta' = '9d9d9d9d-0000-4000-8000-0000000000ac'), 'sospensione: la porta con Carlo non compare più ad Ada');
select pg_temp.ok((select esito = 'sospensione' and esito_il is not null from public.svelamenti
  where porta_id = '9d9d9d9d-0000-4000-8000-0000000000ac'), 'sospensione: porta chiusa con esito «sospensione»');
select pg_temp.ok(public.saldo_crediti('4c4c4c4c-0000-4000-8000-00000000004c') = 10
  and (public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') ->> 'saldo')::int = 40,
  'sospensione: 10 crediti tornati a Carlo e ad Ada (Ada: 50 - 10 con Bruno)');
select pg_temp.ok(public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ac', '4a4a4a4a-0000-4000-8000-00000000004a') = 'porta_chiusa',
  'sospensione: nessuna nuova caparra sulla porta chiusa');
select pg_temp.ok(not exists (select 1 from public.crediti_movimenti where tipo not in ('assegnati_beta', 'caparra_bloccata', 'caparra_restituita')),
  'sospensione: nessuna penale nel registro');

-- Blocco tra i due prima dello svelamento: porta chiusa, crediti restituiti.
select public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ad', '4d4d4d4d-0000-4000-8000-00000000004d');
insert into public.blocchi (chi, bloccato) values ('4a4a4a4a-0000-4000-8000-00000000004a', '4d4d4d4d-0000-4000-8000-00000000004d');
select pg_temp.ok(public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ad', '4a4a4a4a-0000-4000-8000-00000000004a') = 'porta_chiusa',
  'blocco: la caparra non si blocca, la porta è chiusa');
select pg_temp.ok((select esito = 'blocco' from public.svelamenti where porta_id = '9d9d9d9d-0000-4000-8000-0000000000ad')
  and public.saldo_crediti('4d4d4d4d-0000-4000-8000-00000000004d') = 10, 'blocco: esito «blocco» e 10 crediti tornati a Dario');

-- Porta scaduta (48 ore passate) senza svelamento: chiusa, nessuna caparra, nessuna penale.
select pg_temp.ok(public.caparra_svelamento('9d9d9d9d-0000-4000-8000-0000000000ae', '4a4a4a4a-0000-4000-8000-00000000004a') = 'porta_scaduta',
  'scadenza: dopo 48 ore la caparra non si blocca');
select pg_temp.ok((select esito = 'scaduta' from public.svelamenti where porta_id = '9d9d9d9d-0000-4000-8000-0000000000ae')
  and (public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') ->> 'saldo')::int = 40, 'scadenza: esito «scaduta», saldo di Ada invariato');

-- Restano solo le porte in attesa: per Ada quella con Bruno.
select pg_temp.ok(jsonb_array_length(public.svelamento_di('4a4a4a4a-0000-4000-8000-00000000004a') -> 'porte') = 1,
  'svelamento_di: alla fine per Ada resta solo la porta con Bruno');

-- La chiusura vale anche se nessuno tocca «Blocca»: svelamento_di sistema le porte scadute di chi la chiede.
update public.porte set aperta_il = now() - interval '49 hours' where id = '9d9d9d9d-0000-4000-8000-0000000000ab';
select pg_temp.ok(jsonb_array_length(public.svelamento_di('4b4b4b4b-0000-4000-8000-00000000004b') -> 'porte') = 0,
  'svelamento_di: la porta scaduta sparisce anche per Bruno');
select pg_temp.ok((select esito = 'scaduta' from public.svelamenti where porta_id = '9d9d9d9d-0000-4000-8000-0000000000ab')
  and public.saldo_crediti('4a4a4a4a-0000-4000-8000-00000000004a') = 50,
  'svelamento_di: porta scaduta chiusa e caparra restituita ad Ada (saldo di nuovo 50)');

reset role;
rollback;
