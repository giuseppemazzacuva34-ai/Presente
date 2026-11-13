-- Test della sospensione cautelare, della sospensione automatica e degli avvisi al responsabile della sicurezza
-- (issue #7 spec v1.1 del CPO, D32 A, D51 A). Linea «sviluppatore-b». Dati inventati, Postgres di prova.
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
  ('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', 'pa@example.com'),
  ('8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b', 'pb@example.com'),
  ('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', 'pc@example.com'),
  ('8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d', 'pd@example.com'),
  ('8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', 'pe@example.com');

-- Il telefono non legge sospensioni e avvisi e non lancia le funzioni del server.
select pg_temp.come('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.sospensioni$$)
  and pg_temp.rifiutato($$select * from public.avvisi_sicurezza$$)
  and pg_temp.rifiutato($$select public.sospeso(auth.uid())$$)
  and pg_temp.rifiutato($$select public.avvisi_da_ripetere()$$),
  'sospensioni: il telefono non vede sospensioni e avvisi (solo il server)');
reset role;

set local role service_role;
-- 1. «Minacce» (una sola segnalazione): sospensione cautelare subito, revisione entro 48 ore, avviso al responsabile.
select public.nuova_segnalazione('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b',
  'minacce_pericolo', 'scheda', null, false);
select pg_temp.ok(public.sospeso('8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b'), 'sospensioni: «Minacce» sospende subito in via cautelare');
select pg_temp.ok((select tipo = 'cautelare' and rivedere_entro - iniziata_il = interval '48 hours'
  from public.sospensioni where persona = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b'), 'sospensioni: cautelare, revisione entro 48 ore');
select pg_temp.ok(not public.sospeso('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a'), 'sospensioni: chi segnala non è sospeso');
select pg_temp.ok((select count(*) from public.avvisi_sicurezza a join public.segnalazioni s on s.id = a.segnalazione_id
  where s.motivo = 'minacce_pericolo' and a.perche = 'nuova' and a.inviato_il is null) = 1,
  'sospensioni: priorità 1 ora → un avviso al responsabile in coda');
-- Una seconda segnalazione cautelare sulla stessa persona non apre una seconda sospensione.
select public.nuova_segnalazione('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b',
  'diffusione_immagini', 'scheda', null, false);
select pg_temp.ok((select count(*) from public.sospensioni where persona = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b' and tolta_il is null) = 1,
  'sospensioni: una sola sospensione attiva per persona');
select pg_temp.ok((select count(*) from public.avvisi_sicurezza a join public.segnalazioni s on s.id = a.segnalazione_id
  where s.motivo = 'diffusione_immagini') = 0, 'sospensioni: diffusione di immagini (24 ore) non manda l''avviso da 1 ora');

-- 2. Sospensione automatica (D32): 2 gravi da persone DIVERSE in 30 giorni; dalla stessa persona no.
select public.nuova_segnalazione('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d', 'insulti', 'scheda', null, false);
select public.nuova_segnalazione('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d', 'soldi', 'scheda', null, false);
select pg_temp.ok(not public.sospeso('8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d'), 'sospensioni: due gravi dalla stessa persona non sospendono');
select public.nuova_segnalazione('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d', 'altro', 'scheda', null, false);
select pg_temp.ok(not public.sospeso('8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d'), 'sospensioni: una segnalazione da 72 ore non conta come grave');
select public.nuova_segnalazione('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d', 'contenuti_sessuali', 'scheda', null, false);
select pg_temp.ok(public.sospeso('8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d')
  and (select tipo from public.sospensioni where persona = '8d8d8d8d-8d8d-4d8d-8d8d-8d8d8d8d8d8d') = 'automatica',
  'sospensioni: due gravi da persone diverse in 30 giorni sospendono in automatico');
-- Le archiviate (infondate) e quelle più vecchie di 30 giorni non contano.
select public.nuova_segnalazione('8a8a8a8a-8a8a-4a8a-8a8a-8a8a8a8a8a8a', '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', 'insulti', 'scheda', null, false);
update public.segnalazioni set esito = 'archiviata', chiusa_il = now() where contro = '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';
select public.nuova_segnalazione('8c8c8c8c-8c8c-4c8c-8c8c-8c8c8c8c8c8c', '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', 'insulti', 'scheda', null, false);
select pg_temp.ok(not public.sospeso('8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e'), 'sospensioni: una segnalazione archiviata non conta');
update public.segnalazioni set creata_il = now() - interval '31 days' where contro = '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';
update public.segnalazioni set esito = null, chiusa_il = null where contro = '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e';
select public.nuova_segnalazione('8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b', '8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', 'insulti', 'scheda', null, false);
select pg_temp.ok(not public.sospeso('8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e'), 'sospensioni: segnalazioni di più di 30 giorni fa non contano');

-- 3. «Sono in difficoltà» senza persona: avviso al responsabile, nessuna sospensione.
select public.nuova_segnalazione('8e8e8e8e-8e8e-4e8e-8e8e-8e8e8e8e8e8e', null, 'sono_in_difficolta', 'sono_in_difficolta', null, false);
select pg_temp.ok((select count(*) from public.avvisi_sicurezza a join public.segnalazioni s on s.id = a.segnalazione_id
  where s.motivo = 'sono_in_difficolta') = 1, 'sospensioni: «Sono in difficoltà» avvisa il responsabile');

-- 4. Avvisi da ripetere: segnalazione da 1 ora non aperta dopo 30 minuti; sospensione non rivista dopo 48 ore, ogni 12 ore.
update public.avvisi_sicurezza set inviato_il = now();
select pg_temp.ok((select count(*) from public.avvisi_da_ripetere()) = 0, 'sospensioni: nessun avviso da ripetere subito');
update public.segnalazioni set creata_il = now() - interval '31 minutes' where motivo = 'sono_in_difficolta';
update public.avvisi_sicurezza set creato_il = now() - interval '31 minutes', inviato_il = now() - interval '31 minutes';
select pg_temp.ok((select count(*) from public.avvisi_da_ripetere() where perche = 'non_aperta') = 2,
  'sospensioni: dopo 30 minuti senza apertura, nuovo avviso per le segnalazioni da 1 ora');
update public.segnalazioni set aperta_il = now() where motivo in ('sono_in_difficolta', 'minacce_pericolo');
select pg_temp.ok((select count(*) from public.avvisi_da_ripetere() where perche = 'non_aperta') = 0,
  'sospensioni: una segnalazione aperta da una persona non si riavvisa');
update public.sospensioni set iniziata_il = now() - interval '49 hours', rivedere_entro = now() - interval '1 hour'
  where persona = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b';
select pg_temp.ok((select count(*) from public.avvisi_da_ripetere() where perche = 'revisione_scaduta') = 1,
  'sospensioni: sospensione non rivista dopo 48 ore → nuovo avviso');
insert into public.avvisi_sicurezza (sospensione_id, perche, creato_il, inviato_il)
  select id, 'revisione_scaduta', now() - interval '1 hour', now() - interval '1 hour' from public.sospensioni
  where persona = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b';
select pg_temp.ok((select count(*) from public.avvisi_da_ripetere() where perche = 'revisione_scaduta') = 0,
  'sospensioni: dopo un avviso di revisione il prossimo arriva fra 12 ore');
update public.avvisi_sicurezza set creato_il = now() - interval '13 hours' where perche = 'revisione_scaduta';
select pg_temp.ok((select count(*) from public.avvisi_da_ripetere() where perche = 'revisione_scaduta') = 1,
  'sospensioni: 12 ore dopo, ancora un avviso (la sospensione resta finché una persona decide)');
update public.sospensioni set tolta_il = now() where persona = '8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b';
select pg_temp.ok(not public.sospeso('8b8b8b8b-8b8b-4b8b-8b8b-8b8b8b8b8b8b')
  and (select count(*) from public.avvisi_da_ripetere() where perche = 'revisione_scaduta') = 0,
  'sospensioni: tolta da una persona, nessun altro avviso');

-- 5. Gli avvisi non contengono dati personali: solo riferimenti.
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'avvisi_sicurezza') is not distinct from
  array['creato_il', 'id', 'inviato_il', 'perche', 'segnalazione_id', 'sospensione_id'],
  'sospensioni: l''avviso porta solo riferimenti, mai nomi, email o racconti');
reset role;
rollback;
