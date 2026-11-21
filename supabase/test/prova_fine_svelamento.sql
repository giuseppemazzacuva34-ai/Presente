-- Test del passo 8a (issue #65, spec v1 del CPO, passi 7-8 e «Casi limite»; linea «sviluppatore»):
--   · fine_svelamento(porta, persona): il Worker segna la fine quando il Durable Object dice che i 10 secondi sono
--     passati (o subito, con le foto). finito_il e durata; le 48 ore del sì/no partono da qui.
--   · torna_a_quando(porta, persona): dopo 3 cadute, o se uno non si collega a svelamento iniziato, si torna al passo 4
--     («Quando?»): si riprova quante volte si vuole dentro le 48 ore.
--   · uno svelamento iniziato e mai finito da oltre 15 minuti torna da solo al passo 4; dopo le 48 ore la porta scade
--     e le caparre tornano a entrambi (prima restavano ferme).
--   · svelamento_di() elenca a parte le porte svelate («svelate»): nome, età, quando scade il sì/no, «hai risposto».
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
create function pg_temp.fine(persona uuid) returns text language sql as $$
  select public.fine_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', persona)
$$;
create function pg_temp.torna(persona uuid) returns text language sql as $$
  select public.torna_a_quando('8f8f8f8f-0000-4000-8000-0000000003ab', persona)
$$;
create function pg_temp.riga() returns public.svelamenti language sql as $$
  select * from public.svelamenti where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab'
$$;
create function pg_temp.saldo(persona uuid) returns integer language sql as $$
  select public.saldo_crediti(persona)
$$;

begin;
insert into auth.users (id, email) values
  ('7a7a7a7a-0000-4000-8000-00000000037a', 'fa@example.com'), ('7b7b7b7b-0000-4000-8000-00000000037b', 'fb@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000037c', 'fc@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000037a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000037b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('7c7c7c7c-0000-4000-8000-00000000037c', 'Ciro', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000301', 'italia', now() - interval '7 days', now() - interval '1 hour');
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8f8f8f8f-0000-4000-8000-0000000003ab', '7f7f7f7f-0000-4000-8000-000000000301',
   '7a7a7a7a-0000-4000-8000-00000000037a', '7b7b7b7b-0000-4000-8000-00000000037b', now() - interval '2 hours');

-- Il telefono non chiama le funzioni nuove.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a')$$), 'fine: il telefono non la chiama');
select pg_temp.ok(pg_temp.rifiutato($$select pg_temp.torna('7a7a7a7a-0000-4000-8000-00000000037a')$$), 'torna_a_quando: il telefono non la chiama');
reset role;
set local role service_role;

select pg_temp.ok(pg_temp.fine('7c7c7c7c-0000-4000-8000-00000000037c') = 'non_nella_porta', 'fine: persona fuori dalla porta → non_nella_porta');
select pg_temp.ok(pg_temp.torna('7c7c7c7c-0000-4000-8000-00000000037c') = 'non_nella_porta', 'torna_a_quando: persona fuori → non_nella_porta');
select pg_temp.ok(pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a') = 'non_iniziato', 'fine: senza svelamento → non_iniziato');
select pg_temp.ok(pg_temp.torna('7a7a7a7a-0000-4000-8000-00000000037a') = 'non_iniziato', 'torna_a_quando: senza svelamento → non_iniziato');

-- Caparre, tutti e due pronti, tutti e due dentro: il video inizia.
select public.assegna_crediti_beta('7a7a7a7a-0000-4000-8000-00000000037a', 100);
select public.assegna_crediti_beta('7b7b7b7b-0000-4000-8000-00000000037b', 100);
select public.caparra_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a');
select public.caparra_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7b7b7b7b-0000-4000-8000-00000000037b');
select public.fasce_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a',
  array[date_trunc('hour', now()) + interval '3 hours']);
select public.pronto_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a');
select public.pronto_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7b7b7b7b-0000-4000-8000-00000000037b');
select public.entra_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a');
select pg_temp.ok(public.entra_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7b7b7b7b-0000-4000-8000-00000000037b') = 'iniziato_video',
  'preparazione: video iniziato');

-- Prima dei 10 secondi la fine non si segna.
select pg_temp.ok(pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a') = 'non_ancora', 'fine: prima dei 10 secondi → non_ancora');
select pg_temp.ok((pg_temp.riga()).finito_il is null, 'fine: finito_il ancora vuoto');

-- Torna a «Quando?» (3 cadute): tutto come al passo 4, caparre e scelte restano, tentativi a zero.
select pg_temp.ok(pg_temp.torna('7b7b7b7b-0000-4000-8000-00000000037b') = 'quando', 'torna_a_quando: video iniziato → quando');
select pg_temp.ok((select iniziato_il is null and tipo is null and tentativi = 0 and entrato_a_il is null and entrato_b_il is null
    and pronto_a_il is null and pronto_b_il is null and fascia_fissata is null and cardinality(fasce_a) = 0 and cardinality(fasce_b) = 0
    and caparra_a_il is not null and caparra_b_il is not null and esito is null and finito_il is null
  from pg_temp.riga()), 'torna_a_quando: passo 4 da capo, caparre ancora bloccate');
select pg_temp.ok(pg_temp.saldo('7a7a7a7a-0000-4000-8000-00000000037a') = 0 and pg_temp.saldo('7b7b7b7b-0000-4000-8000-00000000037b') = 0,
  'torna_a_quando: i crediti restano bloccati');
select pg_temp.ok(pg_temp.torna('7a7a7a7a-0000-4000-8000-00000000037a') = 'non_iniziato', 'torna_a_quando: ripetuto → non_iniziato');
-- La porta torna nell'elenco delle porte in attesa, con la scelta che si può di nuovo cambiare.
select pg_temp.ok(jsonb_array_length(public.svelamento_di('7a7a7a7a-0000-4000-8000-00000000037a')->'porte') = 1,
  'torna_a_quando: la porta torna tra quelle in attesa');
select pg_temp.ok(public.scelta_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a', 'video') = 'salvata',
  'torna_a_quando: la scelta si può di nuovo cambiare');

-- Si riprova quante volte si vuole: 4 avvii di fila non superano il limite dei 3 tentativi.
do $$
declare i int;
begin
  for i in 1..4 loop
    perform public.pronto_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a');
    perform public.pronto_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7b7b7b7b-0000-4000-8000-00000000037b');
    perform public.entra_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a');
    if public.entra_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7b7b7b7b-0000-4000-8000-00000000037b') <> 'iniziato_video' then
      raise exception 'ERRORE avvio % non riuscito', i;
    end if;
    if i < 4 then perform public.torna_a_quando('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a'); end if;
  end loop;
end $$;
select pg_temp.ok((pg_temp.riga()).tentativi = 1, 'torna_a_quando: dopo 4 avvii il video riparte, 1 tentativo');

-- Dopo i 10 secondi la fine si segna; ripetere non cambia nulla.
reset role;
update public.svelamenti set iniziato_il = now() - interval '40 seconds' where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
set local role service_role;
select pg_temp.ok(pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a') = 'finito', 'fine: dopo i 10 secondi → finito');
select pg_temp.ok((select finito_il is not null and durata_secondi = 10 and esito is null from pg_temp.riga()), 'fine: finito_il e 10 secondi');
select pg_temp.ok(pg_temp.fine('7b7b7b7b-0000-4000-8000-00000000037b') = 'finito', 'fine: anche l''altra persona → finito');
select pg_temp.ok(pg_temp.torna('7b7b7b7b-0000-4000-8000-00000000037b') = 'finito', 'torna_a_quando: a svelamento finito → finito (vale)');
select pg_temp.ok((pg_temp.riga()).iniziato_il is not null, 'torna_a_quando: lo svelamento finito non si cancella');
-- «Chiudi e segnala» dopo la fine non vale più.
select pg_temp.ok(public.chiudi_e_segnala_svelamento('8f8f8f8f-0000-4000-8000-0000000003ab', '7a7a7a7a-0000-4000-8000-00000000037a') = 'finito',
  'fine: dopo la fine niente «Chiudi e segnala»');

-- svelamento_di: la porta svelata esce dalle porte in attesa ed entra in «svelate», senza le risposte.
select pg_temp.ok(jsonb_array_length(public.svelamento_di('7a7a7a7a-0000-4000-8000-00000000037a')->'porte') = 0,
  'svelamento_di: la porta svelata non è più in attesa');
select pg_temp.ok((select v->>'nome' = 'Bruno' and (v->>'eta')::int >= 18 and v->>'con' = '7b7b7b7b-0000-4000-8000-00000000037b'
    and (v->>'ho_risposto')::boolean = false
    and abs(extract(epoch from (v->>'risposta_scade_il')::timestamptz - ((pg_temp.riga()).finito_il + interval '48 hours'))) < 1
    and not (v ? 'risposta') and not (v ? 'sua_risposta') and not (v ? 'risposta_a') and not (v ? 'risposta_b')
  from jsonb_array_elements(public.svelamento_di('7a7a7a7a-0000-4000-8000-00000000037a')->'svelate') v),
  'svelamento_di: «svelate» con nome, età, scadenza a 48 ore dalla fine, «hai risposto», mai le risposte');
select pg_temp.ok((select (v->>'ho_risposto')::boolean from jsonb_array_elements(public.svelamento_di('7b7b7b7b-0000-4000-8000-00000000037b')->'svelate') v) = false,
  'svelamento_di: anche Bruno vede la porta svelata');
select pg_temp.ok(jsonb_array_length(public.svelamento_di('7c7c7c7c-0000-4000-8000-00000000037c')->'svelate') = 0,
  'svelamento_di: chi non è nella porta non la vede');
reset role;
update public.svelamenti set risposta_a = 'si', risposta_a_il = now() where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
set local role service_role;
select pg_temp.ok((select (v->>'ho_risposto')::boolean from jsonb_array_elements(public.svelamento_di('7a7a7a7a-0000-4000-8000-00000000037a')->'svelate') v)
    and not (select (v->>'ho_risposto')::boolean from jsonb_array_elements(public.svelamento_di('7b7b7b7b-0000-4000-8000-00000000037b')->'svelate') v),
  'svelamento_di: «hai risposto» solo per chi ha risposto; l''altra persona non sa nulla');

-- Svelamento con le foto: la fine si segna subito, durata 0.
reset role;
-- (Dal passo 8b-1 una risposta data non si cambia: per riusare la stessa porta qui il controllo si spegne un momento.)
alter table public.svelamenti disable trigger svelamenti_risposta_ferma;
update public.svelamenti set iniziato_il = now(), finito_il = null, durata_secondi = null, tipo = 'foto', risposta_a = null,
  risposta_a_il = null where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
alter table public.svelamenti enable trigger svelamenti_risposta_ferma;
set local role service_role;
select pg_temp.ok(pg_temp.fine('7b7b7b7b-0000-4000-8000-00000000037b') = 'finito', 'fine: con le foto → finito subito');
select pg_temp.ok((pg_temp.riga()).durata_secondi = 0, 'fine: con le foto durata 0');

-- Svelamento iniziato e mai finito da oltre 15 minuti: torna da solo al passo 4 (lettura di svelamento_di).
reset role;
update public.svelamenti set iniziato_il = now() - interval '16 minutes', finito_il = null, durata_secondi = null, tipo = 'video',
  entrato_a_il = now() - interval '16 minutes', entrato_b_il = now() - interval '16 minutes'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
set local role service_role;
select pg_temp.ok(pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a') = 'non_iniziato', 'fine: oltre 15 minuti senza fine → non_iniziato (si riparte)');
select pg_temp.ok((select iniziato_il is null and tentativi = 0 and esito is null from pg_temp.riga()), 'fine: oltre 15 minuti → passo 4');
reset role;
update public.svelamenti set iniziato_il = now() - interval '16 minutes', tentativi = 2, tipo = 'video'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
set local role service_role;
select pg_temp.ok(jsonb_array_length(public.svelamento_di('7b7b7b7b-0000-4000-8000-00000000037b')->'porte') = 1,
  'svelamento_di: lo svelamento fermo da oltre 15 minuti torna tra le porte in attesa');
select pg_temp.ok((pg_temp.riga()).iniziato_il is null, 'svelamento_di: e nel database è di nuovo al passo 4');

-- Iniziato a ridosso della scadenza (da 5 minuti, 48 ore passate): si completa, la porta non scade.
reset role;
update public.svelamenti set iniziato_il = now() - interval '5 minutes', tentativi = 1, tipo = 'video'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
update public.porte set aperta_il = now() - interval '48 hours 3 minutes' where id = '8f8f8f8f-0000-4000-8000-0000000003ab';
set local role service_role;
select pg_temp.ok(public.porta_da_chiudere('8f8f8f8f-0000-4000-8000-0000000003ab') is null, 'scadenza: iniziato da 5 minuti → si completa');
select pg_temp.ok(pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a') = 'finito', 'scadenza: la fine vale anche dopo le 48 ore');

-- Iniziato e mai finito, 48 ore passate: la porta scade e le caparre tornano a entrambi (prima restavano ferme).
reset role;
update public.svelamenti set iniziato_il = now() - interval '20 minutes', finito_il = null, durata_secondi = null
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000003ab';
set local role service_role;
select pg_temp.ok(jsonb_array_length(public.svelamento_di('7a7a7a7a-0000-4000-8000-00000000037a')->'porte') = 0,
  'scadenza: svelamento fermo dopo le 48 ore → porta non più in attesa');
select pg_temp.ok((pg_temp.riga()).esito = 'scaduta', 'scadenza: esito «scaduta»');
select pg_temp.ok(pg_temp.saldo('7a7a7a7a-0000-4000-8000-00000000037a') = 100 and pg_temp.saldo('7b7b7b7b-0000-4000-8000-00000000037b') = 100,
  'scadenza: crediti restituiti a entrambi, nessuna penale');
select pg_temp.ok(pg_temp.fine('7a7a7a7a-0000-4000-8000-00000000037a') = 'porta_chiusa', 'fine: porta chiusa → porta_chiusa');
select pg_temp.ok(pg_temp.torna('7a7a7a7a-0000-4000-8000-00000000037a') = 'porta_chiusa', 'torna_a_quando: porta chiusa → porta_chiusa');

reset role;
rollback;
