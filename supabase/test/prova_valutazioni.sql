-- Test della valutazione dopo l'incontro (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; passo 3a).
-- valuta_incontro salva le 4 risposte (3 sui fatti + 1 privata sulla sicurezza) solo per un incontro avvenuto (check-in
-- di entrambi), una volta per persona, entro 7 giorni. La tabella è chiusa al telefono: solo il server legge.
-- Linea «sviluppatore-b». Dati inventati, Postgres di prova.
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
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'qa@example.com'), ('5b5b5b5b-0000-4000-8000-00000000005b', 'qb@example.com'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'qc@example.com'), ('5d5d5d5d-0000-4000-8000-00000000005d', 'qd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('5b5b5b5b-0000-4000-8000-00000000005b', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('5d5d5d5d-0000-4000-8000-00000000005d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000005', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (incontro tra 10 minuti), Bea-Dino (incontro tra 2 ore, poi con ritardo), Anna-Dino (da fissare).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('5f5f5f5f-0000-4000-8000-0000000000ac', '6e6e6e6e-0000-4000-8000-000000000005',
   '5a5a5a5a-0000-4000-8000-00000000005a', '5c5c5c5c-0000-4000-8000-00000000005c', now() - interval '1 hour'),
  ('5f5f5f5f-0000-4000-8000-0000000000bd', '6e6e6e6e-0000-4000-8000-000000000005',
   '5b5b5b5b-0000-4000-8000-00000000005b', '5d5d5d5d-0000-4000-8000-00000000005d', now() - interval '1 hour'),
  ('5f5f5f5f-0000-4000-8000-0000000000ad', '6e6e6e6e-0000-4000-8000-000000000005',
   '5a5a5a5a-0000-4000-8000-00000000005a', '5d5d5d5d-0000-4000-8000-00000000005d', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta(p, 30) from (values ('5a5a5a5a-0000-4000-8000-00000000005a'::uuid),
  ('5b5b5b5b-0000-4000-8000-00000000005b'::uuid), ('5c5c5c5c-0000-4000-8000-00000000005c'::uuid),
  ('5d5d5d5d-0000-4000-8000-00000000005d'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from (values
  ('5f5f5f5f-0000-4000-8000-0000000000ac'::uuid, '5a5a5a5a-0000-4000-8000-00000000005a'::uuid),
  ('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c'),
  ('5f5f5f5f-0000-4000-8000-0000000000bd', '5b5b5b5b-0000-4000-8000-00000000005b'),
  ('5f5f5f5f-0000-4000-8000-0000000000bd', '5d5d5d5d-0000-4000-8000-00000000005d'),
  ('5f5f5f5f-0000-4000-8000-0000000000ad', '5a5a5a5a-0000-4000-8000-00000000005a'),
  ('5f5f5f5f-0000-4000-8000-0000000000ad', '5d5d5d5d-0000-4000-8000-00000000005d')) v(porta, persona);
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('5f5f5f5f-0000-4000-8000-0000000000ac', '5f5f5f5f-0000-4000-8000-0000000000bd',
                     '5f5f5f5f-0000-4000-8000-0000000000ad');
select public.apri_incontro(p) from (values ('5f5f5f5f-0000-4000-8000-0000000000ac'::uuid),
  ('5f5f5f5f-0000-4000-8000-0000000000bd'::uuid), ('5f5f5f5f-0000-4000-8000-0000000000ad'::uuid)) v(p);
-- Incontri già confermati (gli orari vicini a «adesso» non si possono proporre: si scrivono direttamente).
update public.incontri set stato = 'confermato', orario = now() + interval '10 minutes', luogo_libero = 'Bar della piazza',
  proposto_da = '5a5a5a5a-0000-4000-8000-00000000005a', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '5f5f5f5f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '2 hours', luogo_libero = 'Caffè del parco',
  proposto_da = '5b5b5b5b-0000-4000-8000-00000000005b', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '5f5f5f5f-0000-4000-8000-0000000000bd';
reset role;

-- Anna e Ciro si incontrano davvero (due check-in); Anna-Dino «avvenuto» 8 giorni fa (valutazione chiusa).
set local role service_role;
select public.checkin_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a');
select public.checkin_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c');
reset role;
update public.incontri set stato = 'concluso', orario = now() - interval '8 days', luogo_libero = 'Bar vecchio',
  proposto_da = '5a5a5a5a-0000-4000-8000-00000000005a', proposto_il = now() - interval '9 days',
  confermato_il = now() - interval '9 days', checkin_a_il = now() - interval '8 days', checkin_b_il = now() - interval '8 days',
  esito = 'avvenuto', esito_il = now() - interval '8 days'
  where porta_id = '5f5f5f5f-0000-4000-8000-0000000000ad';

set local role service_role;
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5b5b5b5b-0000-4000-8000-00000000005b',
  'si', 'si', 'si', true) = 'non_nella_porta', 'chi non è nella porta non valuta');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000bd', '5b5b5b5b-0000-4000-8000-00000000005b',
  'si', 'si', 'si', true) = 'non_avvenuto', 'senza i due check-in niente valutazione');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ad', '5a5a5a5a-0000-4000-8000-00000000005a',
  'si', 'si', 'si', true) = 'chiusa', 'dopo 7 giorni la valutazione è chiusa');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a',
  'forse', 'si', 'si', true) = 'risposta_non_valida', 'risposta fuori dalla lista rifiutata');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a',
  'si', null, 'si', true) = 'risposta_non_valida', 'ogni risposta è obbligatoria');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a',
  'si', 'si', 'piu_o_meno', null) = 'risposta_non_valida', 'anche la domanda sulla sicurezza è obbligatoria');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a',
  'in_ritardo', 'si', 'piu_o_meno', true) = 'grazie', 'Anna valuta Ciro');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a',
  'si', 'si', 'si', true) = 'gia_fatta', 'una sola valutazione a testa');
select pg_temp.ok(public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c',
  'si', 'no', 'no', false) = 'racconta', 'con «No» alla sicurezza si propone di raccontare (#7)');
reset role;
select pg_temp.ok((select count(*) = 2 from public.valutazioni where porta_id = '5f5f5f5f-0000-4000-8000-0000000000ac'),
  'due valutazioni salvate');
select pg_temp.ok((select valutato = '5c5c5c5c-0000-4000-8000-00000000005c' and presentato = 'in_ritardo' and sicuro
  from public.valutazioni where persona = '5a5a5a5a-0000-4000-8000-00000000005a'), 'la valutazione di Anna riguarda Ciro');
select pg_temp.ok((select valutato = '5a5a5a5a-0000-4000-8000-00000000005a' and foto_sue = 'no' and not sicuro
  from public.valutazioni where persona = '5c5c5c5c-0000-4000-8000-00000000005c'), 'la valutazione di Ciro riguarda Anna');

-- Il telefono non legge e non scrive niente, neanche le proprie risposte (solo riepiloghi dal server).
set local role authenticated;
select set_config('request.jwt.claims', '{"sub": "5a5a5a5a-0000-4000-8000-00000000005a", "role": "authenticated"}', true);
select pg_temp.ok(pg_temp.rifiutato('select * from public.valutazioni'), 'telefono: valutazioni non leggibili');
select pg_temp.ok(pg_temp.rifiutato($q$select public.valuta_incontro('5f5f5f5f-0000-4000-8000-0000000000ac',
  '5a5a5a5a-0000-4000-8000-00000000005a', 'si', 'si', 'si', true)$q$), 'telefono: funzione non chiamabile');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato('select * from public.valutazioni'), 'anon: valutazioni non leggibili');
reset role;

-- Si cancellano con l'account.
delete from auth.users where id = '5c5c5c5c-0000-4000-8000-00000000005c';
select pg_temp.ok((select count(*) = 0 from public.valutazioni where '5c5c5c5c-0000-4000-8000-00000000005c' in (persona, valutato)),
  'account cancellato: spariscono le sue valutazioni e quelle su di lui');
rollback;
