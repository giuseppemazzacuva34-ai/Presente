-- Test delle segnalazioni nel database (issue #7, spec v1.1 del CPO, D32 A, D51 A). Linea «sviluppatore-b».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
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
  ('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', 'sa@example.com'),
  ('7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'sb@example.com'),
  ('7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', 'sc@example.com');

-- Il telefono non legge e non scrive le segnalazioni e non lancia la funzione del server.
select pg_temp.come('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.segnalazioni$$)
  and pg_temp.rifiutato($$insert into public.segnalazioni (da, contro, motivo, origine, scade_il)
    values (auth.uid(), '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'insulti', 'scheda', now())$$),
  'segnalazioni: il telefono non legge e non scrive le segnalazioni (solo il server)');
select pg_temp.ok(pg_temp.rifiutato($$select public.nuova_segnalazione(auth.uid(), '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b',
  'insulti', 'scheda', null, true)$$), 'segnalazioni: il telefono non lancia la funzione del server');
reset role;

set local role service_role;
-- «Minacce» dalla scheda con la casella «Blocca anche» spuntata: priorità 1 ora e blocco.
select pg_temp.ok(public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b',
  'minacce_pericolo', 'scheda', '  Mi ha minacciata.  ', true) is not null, 'segnalazioni: Ada segnala Bea per minacce');
select pg_temp.ok((select scade_il - creata_il from public.segnalazioni where motivo = 'minacce_pericolo') = interval '1 hour',
  'segnalazioni: minacce → revisione entro 1 ora');
select pg_temp.ok((select testo from public.segnalazioni where motivo = 'minacce_pericolo') = 'Mi ha minacciata.',
  'segnalazioni: il racconto si salva senza spazi ai lati');
select pg_temp.ok(exists (select 1 from public.blocchi where chi = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a'
  and bloccato = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b'), 'segnalazioni: con la casella spuntata parte anche il blocco');
-- Senza casella: niente blocco. «Insulti» → 24 ore, «Altro» → 72 ore. Racconto vuoto = nessun racconto.
select public.nuova_segnalazione('7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'insulti', 'dopo_chiamata', '   ', false);
select public.nuova_segnalazione('7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', 'altro', 'scheda', null, false);
select pg_temp.ok(not exists (select 1 from public.blocchi where chi = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'),
  'segnalazioni: senza la casella non si blocca');
select pg_temp.ok((select scade_il - creata_il from public.segnalazioni where motivo = 'insulti') = interval '24 hours'
  and (select scade_il - creata_il from public.segnalazioni where motivo = 'altro') = interval '72 hours'
  and (select testo from public.segnalazioni where motivo = 'insulti') is null,
  'segnalazioni: insulti 24 ore, altro 72 ore, racconto vuoto non salvato');
-- «Chiudi e segnala» blocca sempre, anche con la casella tolta.
select public.nuova_segnalazione('7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c', 'soldi', 'chiudi_e_segnala', null, false);
select pg_temp.ok(exists (select 1 from public.blocchi where chi = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b'
  and bloccato = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c'), 'segnalazioni: «Chiudi e segnala» blocca sempre');
-- Segnalare due volte chi è già bloccato non dà errore (il blocco resta uno).
select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'insulti', 'storico_chiamate', null, true);
select pg_temp.ok((select count(*) from public.blocchi where chi = '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a') = 1,
  'segnalazioni: una persona già bloccata si può ancora segnalare');
-- «Sono in difficoltà» senza persona collegata: priorità 1 ora, nessun blocco.
select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', null, 'sono_in_difficolta', 'sono_in_difficolta', null, true);
select pg_temp.ok((select scade_il - creata_il from public.segnalazioni where motivo = 'sono_in_difficolta' and contro is null) = interval '1 hour',
  'segnalazioni: «Sono in difficoltà» senza persona, priorità 1 ora');
-- Regole sui dati.
select pg_temp.ok(pg_temp.rifiutato($$select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
  '7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', 'insulti', 'scheda', null, false)$$), 'segnalazioni: mai contro se stessi');
select pg_temp.ok(pg_temp.rifiutato($$select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
  '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'inventato', 'scheda', null, false)$$)
  and pg_temp.rifiutato($$select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
  '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'insulti', 'inventata', null, false)$$),
  'segnalazioni: solo motivi e punti di partenza dell''elenco');
select pg_temp.ok(pg_temp.rifiutato($$select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
  null, 'insulti', 'scheda', null, false)$$), 'segnalazioni: senza persona solo «Sono in difficoltà»');
select pg_temp.ok(pg_temp.rifiutato($$select public.nuova_segnalazione('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a',
  '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b', 'insulti', 'scheda', repeat('x', 1001), false)$$),
  'segnalazioni: racconto al massimo di 1000 caratteri');
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'segnalazioni') is not distinct from
  array['aperta_il', 'chiusa_il', 'contro', 'creata_il', 'da', 'esito', 'id', 'motivo', 'origine', 'scade_il', 'testo'],
  'segnalazioni: solo i campi della spec (niente diario, questionario o «la richiameresti?»)');
reset role;

-- L'account eliminato di chi è segnalato non cancella le segnalazioni aperte su di lui (spec #7, «Cosa si salva»).
delete from auth.users where id = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b';
select pg_temp.ok((select count(*) from public.segnalazioni where contro = '7b7b7b7b-7b7b-4b7b-8b7b-7b7b7b7b7b7b') = 3,
  'segnalazioni: restano anche se chi è segnalato elimina l''account');
rollback;
