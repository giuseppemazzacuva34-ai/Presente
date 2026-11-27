-- Test di «Cambia luogo» (issue #6, spec v1 del CPO del 3/11, «Casi limite»: «Locale chiuso o cambiato all'ultimo»):
-- fino a 1 ora prima dell'appuntamento confermato una persona propone un altro luogo; serve la conferma dell'altra;
-- senza conferma resta il luogo vecchio. cambia_luogo e rispondi_cambio_luogo le chiama SOLO il server; lo stato dice
-- al telefono se mostrare «Cambia luogo» (azione «cambia_luogo») o la richiesta da confermare («rispondi_cambio»),
-- mai l'id di chi l'ha chiesta. Linea «sviluppatore-b». Dati inventati, Postgres di prova.
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
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'la@example.com'), ('9b9b9b9b-0000-4000-8000-00000000009b', 'lb@example.com'),
  ('9c9c9c9c-0000-4000-8000-00000000009c', 'lc@example.com'), ('9d9d9d9d-0000-4000-8000-00000000009d', 'ld@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('9b9b9b9b-0000-4000-8000-00000000009b', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('9c9c9c9c-0000-4000-8000-00000000009c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('9d9d9d9d-0000-4000-8000-00000000009d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000009', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (incontro tra 3 ore), Bea-Dino (incontro tra 50 minuti), Anna-Dino (da fissare).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9f9f9f9f-0000-4000-8000-0000000000ac', '6e6e6e6e-0000-4000-8000-000000000009',
   '9a9a9a9a-0000-4000-8000-00000000009a', '9c9c9c9c-0000-4000-8000-00000000009c', now() - interval '1 hour'),
  ('9f9f9f9f-0000-4000-8000-0000000000bd', '6e6e6e6e-0000-4000-8000-000000000009',
   '9b9b9b9b-0000-4000-8000-00000000009b', '9d9d9d9d-0000-4000-8000-00000000009d', now() - interval '1 hour'),
  ('9f9f9f9f-0000-4000-8000-0000000000ad', '6e6e6e6e-0000-4000-8000-000000000009',
   '9a9a9a9a-0000-4000-8000-00000000009a', '9d9d9d9d-0000-4000-8000-00000000009d', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta(p, 300) from (values ('9a9a9a9a-0000-4000-8000-00000000009a'::uuid),
  ('9b9b9b9b-0000-4000-8000-00000000009b'::uuid), ('9c9c9c9c-0000-4000-8000-00000000009c'::uuid),
  ('9d9d9d9d-0000-4000-8000-00000000009d'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from (values
  ('9f9f9f9f-0000-4000-8000-0000000000ac'::uuid, '9a9a9a9a-0000-4000-8000-00000000009a'::uuid),
  ('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c'),
  ('9f9f9f9f-0000-4000-8000-0000000000bd', '9b9b9b9b-0000-4000-8000-00000000009b'),
  ('9f9f9f9f-0000-4000-8000-0000000000bd', '9d9d9d9d-0000-4000-8000-00000000009d'),
  ('9f9f9f9f-0000-4000-8000-0000000000ad', '9a9a9a9a-0000-4000-8000-00000000009a'),
  ('9f9f9f9f-0000-4000-8000-0000000000ad', '9d9d9d9d-0000-4000-8000-00000000009d')) v(porta, persona);
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('9f9f9f9f-0000-4000-8000-0000000000ac', '9f9f9f9f-0000-4000-8000-0000000000bd',
                     '9f9f9f9f-0000-4000-8000-0000000000ad');
select public.apri_incontro(p) from (values ('9f9f9f9f-0000-4000-8000-0000000000ac'::uuid),
  ('9f9f9f9f-0000-4000-8000-0000000000bd'::uuid), ('9f9f9f9f-0000-4000-8000-0000000000ad'::uuid)) v(p);
update public.incontri set stato = 'confermato', orario = now() + interval '3 hours', luogo_libero = 'Bar della piazza',
  proposto_da = '9a9a9a9a-0000-4000-8000-00000000009a', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '50 minutes', luogo_libero = 'Caffè del parco',
  proposto_da = '9b9b9b9b-0000-4000-8000-00000000009b', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000bd';
reset role;

-- Il telefono non chiama le funzioni e non legge la tabella: passa dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac',
  '9a9a9a9a-0000-4000-8000-00000000009a', null, 'Libreria del corso')$$), 'cambia luogo: il telefono non lo chiama');
select pg_temp.ok(pg_temp.rifiutato($$select public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac',
  '9c9c9c9c-0000-4000-8000-00000000009c', 'accetto')$$), 'rispondi cambio: il telefono non lo chiama');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.cambi_luogo$$), 'cambi_luogo: il telefono non legge la tabella');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac',
  '9a9a9a9a-0000-4000-8000-00000000009a', null, 'Libreria del corso')$$), 'cambia luogo: chiave anon rifiutata');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.cambi_luogo$$), 'cambi_luogo: chiave anon rifiutata');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.cambi_luogo'::regclass),
  'cambi_luogo: regole per riga attive');

set local role service_role;
-- Errori: chi non è nella porta, senza appuntamento confermato, luogo non valido o uguale a quello di adesso.
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9b9b9b9b-0000-4000-8000-00000000009b',
  null, 'Libreria del corso') = 'non_nella_porta', 'cambia luogo: chi non è nella porta no');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ad', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, 'Libreria del corso') = 'non_confermato', 'cambia luogo: senza appuntamento confermato no');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, '   ') = 'luogo_non_valido', 'cambia luogo: luogo vuoto no');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  'loc-1', 'Libreria del corso') = 'luogo_non_valido', 'cambia luogo: mai locale e luogo scritto insieme');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, repeat('x', 81)) = 'luogo_non_valido', 'cambia luogo: al massimo 80 caratteri');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, ' Bar della piazza ') = 'stesso_luogo', 'cambia luogo: uguale a quello di adesso no');
-- Meno di 1 ora prima: troppo tardi (Bea-Dino tra 50 minuti).
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000bd', '9b9b9b9b-0000-4000-8000-00000000009b',
  null, 'Libreria del corso') = 'troppo_tardi', 'cambia luogo: meno di 1 ora prima no');
select pg_temp.ok((public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000bd', '9b9b9b9b-0000-4000-8000-00000000009b')
  -> 'azioni') ? 'cambia_luogo' is false, 'stato: meno di 1 ora prima nessun «Cambia luogo»');
select pg_temp.ok(not exists (select 1 from public.cambi_luogo), 'cambi_luogo: gli errori non salvano nulla');

-- Lo stato prima: «Cambia luogo» per tutti e due, nessuna richiesta in corso.
select pg_temp.ok((public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a')
  -> 'azioni') ? 'cambia_luogo', 'stato: Anna vede «Cambia luogo»');
select pg_temp.ok((public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c')
  -> 'azioni') ? 'cambia_luogo', 'stato: anche Ciro vede «Cambia luogo»');
select pg_temp.ok(public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a')
  -> 'cambio_luogo' = 'null'::jsonb, 'stato: nessuna richiesta in corso');

-- Anna chiede di cambiare: il luogo vecchio resta finché Ciro non conferma.
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, ' Libreria del corso ') = 'proposto', 'cambia luogo: Anna propone la Libreria del corso');
select pg_temp.ok((select luogo_libero = 'Bar della piazza' from public.incontri
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac'), 'cambia luogo: senza conferma resta il luogo vecchio');
select pg_temp.ok((select luogo_libero = 'Libreria del corso' and locale is null from public.cambi_luogo
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac'), 'cambi_luogo: salvato senza spazi');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, 'Museo') = 'attendi_risposta', 'cambia luogo: Anna aspetta la risposta di Ciro');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  null, 'Museo') = 'rispondi_prima', 'cambia luogo: Ciro risponde prima alla richiesta di Anna');
-- Lo stato: Anna vede la sua richiesta in attesa, Ciro la vede da confermare; mai l'id di Anna.
select pg_temp.ok((select (s -> 'cambio_luogo' ->> 'mio')::boolean and s -> 'cambio_luogo' ->> 'luogo' = 'Libreria del corso'
  and not (s -> 'azioni') ? 'cambia_luogo' and not (s -> 'azioni') ? 'rispondi_cambio'
  from public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a') s),
  'stato: Anna vede la sua richiesta in attesa');
select pg_temp.ok((select not (s -> 'cambio_luogo' ->> 'mio')::boolean and (s -> 'azioni') ? 'rispondi_cambio'
  and not (s -> 'azioni') ? 'cambia_luogo' and s ->> 'luogo' = 'Bar della piazza'
  and (s -> 'cambio_luogo' ->> 'scade')::timestamptz = (select orario - interval '1 hour' from public.incontri
                                                          where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac')
  from public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c') s),
  'stato: Ciro la vede da confermare entro 1 ora prima');
select pg_temp.ok(public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c')::text
  !~ '9a9a9a9a-0000-4000-8000-00000000009a', 'stato: mai l''id di chi ha chiesto il cambio');

-- Risposte: solo l'altra persona, solo «accetto» o «rifiuto».
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  'accetto') = 'non_puoi_rispondere', 'rispondi cambio: chi l''ha chiesto non conferma da solo');
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  'forse') = 'risposta_non_valida', 'rispondi cambio: solo accetto o rifiuto');
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9b9b9b9b-0000-4000-8000-00000000009b',
  'accetto') = 'non_nella_porta', 'rispondi cambio: chi non è nella porta no');
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000bd', '9d9d9d9d-0000-4000-8000-00000000009d',
  'accetto') = 'nessun_cambio', 'rispondi cambio: senza richiesta no');

-- Ciro rifiuta: resta il luogo vecchio e si può chiedere di nuovo.
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  'rifiuto') = 'rifiutato', 'rispondi cambio: Ciro rifiuta');
select pg_temp.ok((select luogo_libero = 'Bar della piazza' from public.incontri
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac')
  and not exists (select 1 from public.cambi_luogo where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac'
    and risposta is null),
  'rispondi cambio: dopo il rifiuto resta il luogo vecchio');
select pg_temp.ok((select risposta = 'rifiuto' and risposto_il is not null from public.cambi_luogo
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac'), 'cambi_luogo: il rifiuto resta scritto');

-- Ciro chiede un locale consigliato, Anna accetta: il luogo cambia, l'orario e lo stato no.
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  'loc-7', null) = 'proposto', 'cambia luogo: Ciro propone un locale consigliato');
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  'accetto') = 'cambiato', 'rispondi cambio: Anna accetta');
select pg_temp.ok((select locale = 'loc-7' and luogo_libero is null and stato = 'confermato' and esito is null
  and orario > now() + interval '2 hours' from public.incontri where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac')
  and not exists (select 1 from public.cambi_luogo where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac'
    and risposta is null),
  'rispondi cambio: nuovo luogo, stesso orario, richiesta chiusa');
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  'accetto') = 'nessun_cambio', 'rispondi cambio: una volta sola');

-- Senza conferma entro 1 ora prima resta il luogo vecchio: la richiesta non vale più.
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, 'Libreria del corso') = 'proposto', 'cambia luogo: Anna chiede ancora');
update public.incontri set orario = now() + interval '59 minutes' where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac';
update public.cambi_luogo set per_orario = now() + interval '59 minutes' where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac';
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  'accetto') = 'troppo_tardi', 'rispondi cambio: meno di 1 ora prima non si conferma più');
select pg_temp.ok((select locale = 'loc-7' from public.incontri where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac'),
  'rispondi cambio: resta il luogo vecchio');
select pg_temp.ok((select s -> 'cambio_luogo' = 'null'::jsonb and not (s -> 'azioni') ? 'rispondi_cambio'
  from public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c') s),
  'stato: la richiesta scaduta non si vede più');

-- Una richiesta fatta per un altro orario non vale più (l'appuntamento è cambiato).
update public.incontri set orario = now() + interval '5 hours' where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac';
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  'accetto') = 'nessun_cambio', 'rispondi cambio: richiesta per un altro orario non vale');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c',
  null, 'Museo') = 'proposto', 'cambia luogo: una richiesta vecchia non blocca una nuova');

-- A incontro chiuso no.
update public.incontri set esito = 'annullato', esito_il = now() where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac';
select pg_temp.ok(public.rispondi_cambio_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  'accetto') = 'incontro_chiuso', 'rispondi cambio: a incontro chiuso no');
select pg_temp.ok(public.cambia_luogo('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a',
  null, 'Libreria del corso') = 'incontro_chiuso', 'cambia luogo: a incontro chiuso no');
reset role;
rollback;
