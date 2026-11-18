-- Test della proposta d'incontro nel database (issue #6 passo 2b; spec v1 del CPO del 3/11, punti 2 e 3, «Regole»,
-- «Criteri di accettazione»). proponi_incontro e rispondi_incontro: orari ammessi anche via API, un solo luogo,
-- 3 controproposte in tutto, proposta che scade dopo 48 ore, conferma, «Annulla l'incontro» con crediti restituiti,
-- incontro scaduto senza conferma con crediti restituiti e nessuna penale. Linea «sviluppatore-b».
-- Dati inventati, Postgres di prova.
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
-- Un orario di Roma «giorni» giorni dopo oggi (ora di Roma), all'ora e ai minuti dati.
create function pg_temp.roma(giorni integer, ora integer, minuti integer default 0) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'Europe/Rome') + make_interval(days => giorni, hours => ora, mins => minuti))
    at time zone 'Europe/Rome'
$$;

begin;
insert into auth.users (id, email) values
  ('8a8a8a8a-0000-4000-8000-00000000008a', 'pa@example.com'), ('8b8b8b8b-0000-4000-8000-00000000008b', 'pb@example.com'),
  ('8c8c8c8c-0000-4000-8000-00000000008c', 'pc@example.com'), ('8d8d8d8d-0000-4000-8000-00000000008d', 'pd@example.com'),
  ('8e8e8e8e-0000-4000-8000-00000000008e', 'pe@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('8a8a8a8a-0000-4000-8000-00000000008a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('8b8b8b8b-0000-4000-8000-00000000008b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('8c8c8c8c-0000-4000-8000-00000000008c', 'Carlo', '1985-01-01', 'PA', 'uomo'),
  ('8d8d8d8d-0000-4000-8000-00000000008d', 'Dario', '1985-01-01', 'TO', 'uomo'),
  ('8e8e8e8e-0000-4000-8000-00000000008e', 'Elio', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5f5f5f5f-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Ada-Bruno (doppio sì da poco), Ada-Carlo (doppio sì di marzo: incontro già scaduto), Ada-Dario (doppio sì da poco),
-- Ada-Elio (nessun doppio sì).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8f8f8f8f-0000-4000-8000-0000000000ab', '5f5f5f5f-0000-4000-8000-000000000001',
   '8a8a8a8a-0000-4000-8000-00000000008a', '8b8b8b8b-0000-4000-8000-00000000008b', now() - interval '1 hour'),
  ('8f8f8f8f-0000-4000-8000-0000000000ac', '5f5f5f5f-0000-4000-8000-000000000001',
   '8a8a8a8a-0000-4000-8000-00000000008a', '8c8c8c8c-0000-4000-8000-00000000008c', now() - interval '1 hour'),
  ('8f8f8f8f-0000-4000-8000-0000000000ad', '5f5f5f5f-0000-4000-8000-000000000001',
   '8a8a8a8a-0000-4000-8000-00000000008a', '8d8d8d8d-0000-4000-8000-00000000008d', now() - interval '1 hour'),
  ('8f8f8f8f-0000-4000-8000-0000000000ae', '5f5f5f5f-0000-4000-8000-000000000001',
   '8a8a8a8a-0000-4000-8000-00000000008a', '8e8e8e8e-0000-4000-8000-00000000008e', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta('8a8a8a8a-0000-4000-8000-00000000008a', 30);
select public.assegna_crediti_beta('8b8b8b8b-0000-4000-8000-00000000008b', 10);
select public.assegna_crediti_beta('8c8c8c8c-0000-4000-8000-00000000008c', 10);
select public.assegna_crediti_beta('8d8d8d8d-0000-4000-8000-00000000008d', 10);
select public.blocca_caparra('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a');
select public.blocca_caparra('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b');
select public.blocca_caparra('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a');
select public.blocca_caparra('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c');
select public.blocca_caparra('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a');
select public.blocca_caparra('8f8f8f8f-0000-4000-8000-0000000000ad', '8d8d8d8d-0000-4000-8000-00000000008d');
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('8f8f8f8f-0000-4000-8000-0000000000ab', '8f8f8f8f-0000-4000-8000-0000000000ad');
update public.svelamenti set iniziato_il = '2026-03-09 18:30:00+00', tentativi = 1, tipo = 'foto', durata_secondi = 10,
  finito_il = '2026-03-09 18:40:00+00', esito = 'doppio_si', esito_il = '2026-03-09 19:00:00+00'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac';
reset role;

-- Il telefono non chiama le funzioni dell'incontro: passano solo dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab',
  '8a8a8a8a-0000-4000-8000-00000000008a', now(), 'bar-1', null)$$), 'proponi_incontro: il telefono non la chiama');
select pg_temp.ok(pg_temp.rifiutato($$select public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab',
  '8b8b8b8b-0000-4000-8000-00000000008b', 'accetto')$$), 'rispondi_incontro: il telefono non la chiama');
reset role;

set local role service_role;
-- Chi può proporre: solo le due persone della porta, solo dopo il doppio sì.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8e8e8e8e-0000-4000-8000-00000000008e',
  pg_temp.roma(2, 19), 'bar-1', null) = 'non_nella_porta', 'proposta: chi non è nella porta non propone');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ae', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), 'bar-1', null) = 'nessun_incontro', 'proposta: senza doppio sì nessun incontro');

-- Orari rifiutati anche via API: prima di domani, fuori 10:00–23:00, non sulla mezz'ora, dopo la scadenza.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  null, 'bar-1', null) = 'orario_non_valido', 'proposta: orario mancante');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(0, 10), 'bar-1', null) = 'prima_di_domani', 'proposta: oggi no, da domani alle 10:00');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 9, 30), 'bar-1', null) = 'fuori_orario', 'proposta: prima delle 10:00 no');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 23, 30), 'bar-1', null) = 'fuori_orario', 'proposta: dopo le 23:00 no');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 18, 10), 'bar-1', null) = 'non_sul_passo', 'proposta: solo ogni 30 minuti');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 18) + interval '1 second', 'bar-1', null) = 'non_sul_passo', 'proposta: niente secondi');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(11, 12), 'bar-1', null) = 'dopo_la_scadenza', 'proposta: non dopo la scadenza (10 giorni)');
-- Dove: un locale consigliato oppure un altro luogo pubblico scritto (max 80 caratteri), mai tutti e due, mai nessuno.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), null, null) = 'luogo_non_valido', 'proposta: serve un luogo');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), 'bar-1', 'Piazza Castello') = 'luogo_non_valido', 'proposta: un solo luogo');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), null, repeat('x', 81)) = 'luogo_non_valido', 'proposta: luogo scritto al massimo 80 caratteri');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), '   ', null) = 'luogo_non_valido', 'proposta: un luogo fatto di spazi non vale');
select pg_temp.ok((select stato from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab') = 'da_fissare',
  'proposta: dopo i rifiuti l''incontro resta da fissare');

-- Proposta valida.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), null, '  Caffè in piazza Castello  ') = 'proposto', 'proposta: Ada propone giorno, ora e luogo');
select pg_temp.ok((select stato = 'proposto' and orario = pg_temp.roma(2, 19) and luogo_libero = 'Caffè in piazza Castello'
    and locale is null and proposto_da = '8a8a8a8a-0000-4000-8000-00000000008a' and proposto_il is not null and controproposte = 0
  from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab'), 'proposta: salvata (luogo senza spazi ai lati)');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(3, 19), 'bar-1', null) = 'attendi_risposta', 'proposta: chi ha proposto aspetta la risposta');
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  'accetto') = 'non_puoi_rispondere', 'risposta: chi ha proposto non accetta da solo');
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  'forse') = 'risposta_non_valida', 'risposta: solo «accetto» o «annulla»');

-- «Propongo un'altra data»: Bruno controproposta 1.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  pg_temp.roma(3, 20, 30), 'bar-2', null) = 'controproposto', 'controproposta: Bruno propone un''altra data');
select pg_temp.ok((select controproposte = 1 and proposto_da = '8b8b8b8b-0000-4000-8000-00000000008b' and locale = 'bar-2'
    and luogo_libero is null from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab'),
  'controproposta: contata, il nuovo luogo sostituisce il vecchio');

-- Una proposta senza risposta scade dopo 48 ore: si torna a «da fissare», le controproposte già fatte restano contate.
update public.incontri set proposto_il = now() - interval '48 hours 1 minute' where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab';
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  'accetto') = 'proposta_scaduta', 'proposta: dopo 48 ore senza risposta non si accetta più');
select pg_temp.ok((select stato = 'da_fissare' and orario is null and locale is null and proposto_da is null and controproposte = 1
  from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab'), 'proposta scaduta: si torna a «da fissare»');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(4, 19), 'bar-1', null) = 'proposto', 'proposta scaduta: si può proporre di nuovo (non è una controproposta)');

-- Controproposte 2 e 3, poi alla quarta solo «Accetto» o «Annulla».
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  pg_temp.roma(4, 21), 'bar-2', null) = 'controproposto', 'controproposta 2');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(5, 19), 'bar-1', null) = 'controproposto', 'controproposta 3');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  pg_temp.roma(5, 21), 'bar-2', null) = 'controproposte_finite', 'controproposta 4: rifiutata, restano Accetto e Annulla');
select pg_temp.ok((select controproposte = 3 and orario = pg_temp.roma(5, 19) from public.incontri
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab'), 'controproposta 4: la proposta di Ada resta quella valida');

-- Accettare un orario già passato non si può: la proposta decade.
update public.incontri set orario = now() - interval '1 hour' where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab';
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  'accetto') = 'orario_passato', 'risposta: un orario già passato non si accetta');
select pg_temp.ok((select stato from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab') = 'da_fissare',
  'orario passato: si torna a «da fissare»');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(5, 19), 'bar-1', null) = 'proposto', 'dopo l''orario passato Ada propone di nuovo');

-- «Accetto»: incontro confermato.
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  'accetto') = 'confermato', 'risposta: Bruno accetta');
select pg_temp.ok((select stato = 'confermato' and confermato_il is not null and orario = pg_temp.roma(5, 19) and esito is null
  from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ab'), 'confermato: giorno, ora e luogo fissati');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  pg_temp.roma(6, 19), 'bar-2', null) = 'gia_confermato', 'confermato: niente nuove proposte (prima si disdice)');
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ab', '8b8b8b8b-0000-4000-8000-00000000008b',
  'accetto') = 'nessuna_proposta', 'confermato: nessuna proposta a cui rispondere');
select pg_temp.ok(public.saldo_crediti('8b8b8b8b-0000-4000-8000-00000000008b') = 0,
  'confermato: la caparra resta bloccata fino all''incontro');

-- «Annulla l'incontro» (Ada-Dario): incontro chiuso, caparre restituite a entrambi, nessuna penale.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(2, 19), 'bar-1', null) = 'proposto', 'annulla: Ada propone a Dario');
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ad', '8d8d8d8d-0000-4000-8000-00000000008d',
  'annulla') = 'annullato', 'annulla: Dario annulla l''incontro');
select pg_temp.ok((select esito = 'annullato' and esito_il is not null and crediti_presente = 0 from public.incontri
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ad'), 'annulla: esito salvato, niente a Presente');
select pg_temp.ok(public.saldo_crediti('8d8d8d8d-0000-4000-8000-00000000008d') = 10, 'annulla: i 10 crediti tornano a Dario');
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a',
  pg_temp.roma(3, 19), 'bar-1', null) = 'incontro_chiuso', 'annulla: dopo non si propone più');

-- Scadenza passata senza conferma (Ada-Carlo, doppio sì di marzo): «scaduto», crediti a entrambi, nessuna penale.
select pg_temp.ok(public.proponi_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c',
  pg_temp.roma(2, 19), 'bar-1', null) = 'incontro_scaduto', 'scadenza: non si propone dopo la scadenza dell''incontro');
select pg_temp.ok((select esito = 'scaduto' and crediti_presente = 0 from public.incontri
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac'), 'scadenza: esito «scaduto»');
select pg_temp.ok(public.saldo_crediti('8c8c8c8c-0000-4000-8000-00000000008c') = 10, 'scadenza: i 10 crediti tornano a Carlo');
-- Ada: 30 assegnati − 3 caparre + 2 restituite (Dario, Carlo) = 20; quella con Bruno resta bloccata.
select pg_temp.ok(public.saldo_crediti('8a8a8a8a-0000-4000-8000-00000000008a') = 20, 'crediti: il conto di Ada torna');
select pg_temp.ok(public.rispondi_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a',
  'accetto') = 'incontro_scaduto', 'scadenza: dopo non si risponde più (stesso motivo per tutti e due)');
reset role;

rollback;
