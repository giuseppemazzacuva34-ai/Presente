-- Test delle chiavi nel database (issue #5, spec v1.1 del CPO, D14 A, D51 A). Linea «sviluppatore-c».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Attenzione: in un solo SELECT le sottoquery possono girare PRIMA delle funzioni che scrivono: si controlla
-- sempre in un'istruzione separata.
-- Persone: Ada (2a), Bea (2b), Cia (2c), Dea (2d), Eva (2e) nella stanza aperta; Fra (2f) e Gio (30) in una stanza
-- che chiude tra 30 secondi (chiavi già chiuse).
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
insert into auth.users (id, email)
  select ('2' || c || '2' || c || '2' || c || '2' || c || '-0000-4000-8000-00000000000' || c)::uuid, 'k' || c || '@example.com'
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f']) c;
insert into auth.users (id, email) values ('30303030-0000-4000-8000-000000000030', 'k0@example.com');
insert into public.profili (id, nome, data_nascita, citta)
  select id, 'Prova', '1990-01-01', 'Milano' from auth.users where email like 'k%@example.com';
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000001', 'italia', now() - interval '3 days', now() + interval '2 days'),
  ('6e6e6e6e-0000-4000-8000-000000000002', 'italia', now() - interval '3 days', now() + interval '30 seconds');
insert into public.membri_stanza (stanza_id, utente_id)
  select '6e6e6e6e-0000-4000-8000-000000000001', id from auth.users
  where email in ('ka@example.com', 'kb@example.com', 'kc@example.com', 'kd@example.com', 'ke@example.com');
insert into public.membri_stanza (stanza_id, utente_id)
  select '6e6e6e6e-0000-4000-8000-000000000002', id from auth.users where email in ('kf@example.com', 'k0@example.com');
-- Chiamate che contano (≥ 60 s): Ada con Bea, Cia, Dea; Fra con Gio. Ada ed Eva solo una chiamata caduta di 40 s.
insert into public.chiamate (chi, con, inizio, durata, esito) values
  ('2a2a2a2a-0000-4000-8000-00000000000a', '2b2b2b2b-0000-4000-8000-00000000000b', now() - interval '2 days', 900, 'tempo_scaduto'),
  ('2c2c2c2c-0000-4000-8000-00000000000c', '2a2a2a2a-0000-4000-8000-00000000000a', now() - interval '2 days', 61, 'chiusa'),
  ('2a2a2a2a-0000-4000-8000-00000000000a', '2d2d2d2d-0000-4000-8000-00000000000d', now() - interval '1 day', 300, 'chiusa'),
  ('2b2b2b2b-0000-4000-8000-00000000000b', '2a2a2a2a-0000-4000-8000-00000000000a', now() - interval '1 day', 300, 'chiusa'),
  ('2a2a2a2a-0000-4000-8000-00000000000a', '2e2e2e2e-0000-4000-8000-00000000000e', now() - interval '20 hours', 40, 'caduta'),
  ('2f2f2f2f-0000-4000-8000-00000000000f', '30303030-0000-4000-8000-000000000030', now() - interval '1 day', 300, 'chiusa');

-- Il telefono non legge e non scrive le chiavi e non lancia le funzioni del server.
select pg_temp.come('2a2a2a2a-0000-4000-8000-00000000000a');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.chiavi$$)
  and pg_temp.rifiutato($$insert into public.chiavi (stanza_id, da, a) values ('6e6e6e6e-0000-4000-8000-000000000001',
    auth.uid(), '2b2b2b2b-0000-4000-8000-00000000000b')$$),
  'chiavi: il telefono non legge e non scrive le chiavi (solo il server)');
select pg_temp.ok(pg_temp.rifiutato($$select public.dai_chiave(auth.uid(), '2b2b2b2b-0000-4000-8000-00000000000b', null)$$)
  and pg_temp.rifiutato($$select public.riprendi_chiave(auth.uid(), '2b2b2b2b-0000-4000-8000-00000000000b')$$)
  and pg_temp.rifiutato($$select public.cambia_frase(auth.uid(), '2b2b2b2b-0000-4000-8000-00000000000b', 'ciao')$$)
  and pg_temp.rifiutato($$select * from public.le_mie_chiavi(auth.uid())$$),
  'chiavi: il telefono non lancia le funzioni del server');
reset role;

set local role service_role;
-- Dare: solo a chi hai chiamato (≥ 60 s), mai a se stessi, mai fuori dalla stanza.
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2b2b2b2b-0000-4000-8000-00000000000b',
  '  Mi hai fatto   ridere.  ') = 'ok', 'chiavi: Ada dà una chiave a Bea con una frase');
select pg_temp.ok((select frase from public.chiavi where da = '2a2a2a2a-0000-4000-8000-00000000000a') = 'Mi hai fatto ridere.',
  'chiavi: la frase si salva senza spazi doppi né ai lati');
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2b2b2b2b-0000-4000-8000-00000000000b', null) = 'gia_data',
  'chiavi: mai due chiavi alla stessa persona');
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2e2e2e2e-0000-4000-8000-00000000000e', null) = 'non_chiamato',
  'chiavi: no a chi hai sentito solo per una chiamata caduta sotto i 60 secondi');
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2a2a2a2a-0000-4000-8000-00000000000a', null) = 'non_valida',
  'chiavi: mai a se stessi');
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2f2f2f2f-0000-4000-8000-00000000000f', null) = 'non_nella_stanza',
  'chiavi: mai a chi non è nella tua stanza');
-- Frase: niente contatti, al massimo 140 caratteri. Una frase rifiutata non salva la chiave.
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'scrivimi al 333 123 4567') = 'contatti'
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'ada@esempio') = 'contatti'
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'guarda https://x') = 'contatti'
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'vai su www punto') = 'contatti'
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'il mio sito ada.it') = 'contatti'
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'cercami su Instagram') = 'contatti'
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', repeat('x', 141)) = 'troppo_lunga',
  'chiavi: frasi con contatti o troppo lunghe rifiutate');
select pg_temp.ok(not exists (select 1 from public.chiavi where a = '2c2c2c2c-0000-4000-8000-00000000000c'),
  'chiavi: frase con telefono, @, link, www, .it, social o oltre 140 caratteri rifiutata e chiave non data');
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'Ci vediamo alle 21 in 2') = 'ok',
  'chiavi: poche cifre nella frase vanno bene');
-- Al massimo 2 chiavi.
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2d2d2d2d-0000-4000-8000-00000000000d', null) = 'finite',
  'chiavi: mai una terza chiave');
-- le_mie_chiavi: solo quelle date da me, mai quelle ricevute.
select pg_temp.ok((select count(*) from public.le_mie_chiavi('2a2a2a2a-0000-4000-8000-00000000000a')) = 2,
  'chiavi: Ada vede le 2 chiavi che ha dato');
select pg_temp.ok(public.dai_chiave('2b2b2b2b-0000-4000-8000-00000000000b', '2a2a2a2a-0000-4000-8000-00000000000a', null) = 'ok',
  'chiavi: Bea dà una chiave ad Ada');
select pg_temp.ok((select count(*) from public.le_mie_chiavi('2a2a2a2a-0000-4000-8000-00000000000a')) = 2
  and (select array_agg(a) from public.le_mie_chiavi('2b2b2b2b-0000-4000-8000-00000000000b')) = array['2a2a2a2a-0000-4000-8000-00000000000a'::uuid],
  'chiavi: nessuno vede le chiavi ricevute (nessuno scopre un no, né un sì prima delle 21)');
-- Riprendere e cambiare la frase: solo la propria.
select pg_temp.ok(public.cambia_frase('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'Nuova frase') = 'ok',
  'chiavi: cambia_frase risponde ok');
select pg_temp.ok((select frase from public.chiavi where da = '2a2a2a2a-0000-4000-8000-00000000000a' and a = '2c2c2c2c-0000-4000-8000-00000000000c') = 'Nuova frase',
  'chiavi: Ada cambia la frase per Cia');
select pg_temp.ok(public.cambia_frase('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', 'telegram') = 'contatti'
  and public.cambia_frase('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c', '') = 'ok',
  'chiavi: frase con contatti rifiutata, frase vuota accettata');
select pg_temp.ok((select frase from public.chiavi where da = '2a2a2a2a-0000-4000-8000-00000000000a' and a = '2c2c2c2c-0000-4000-8000-00000000000c') is null,
  'chiavi: anche la frase cambiata non ha contatti; vuota = nessuna frase');
select pg_temp.ok(public.cambia_frase('2c2c2c2c-0000-4000-8000-00000000000c', '2a2a2a2a-0000-4000-8000-00000000000a', 'ciao') = 'non_data'
  and public.riprendi_chiave('2c2c2c2c-0000-4000-8000-00000000000c', '2a2a2a2a-0000-4000-8000-00000000000a') = 'non_data',
  'chiavi: non si cambia né si riprende una chiave che non hai dato');
select pg_temp.ok(public.riprendi_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2c2c2c2c-0000-4000-8000-00000000000c') = 'ok',
  'chiavi: Ada riprende la chiave a Cia');
select pg_temp.ok(not exists (select 1 from public.chiavi where da = '2a2a2a2a-0000-4000-8000-00000000000a' and a = '2c2c2c2c-0000-4000-8000-00000000000c')
  and public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2d2d2d2d-0000-4000-8000-00000000000d', null) = 'ok',
  'chiavi: la chiave ripresa non lascia traccia e torna disponibile');
-- Dalle 20:59:00 (un minuto prima della chiusura) tutto è chiuso, anche via API.
select pg_temp.ok(public.dai_chiave('2f2f2f2f-0000-4000-8000-00000000000f', '30303030-0000-4000-8000-000000000030', null) = 'chiuse',
  'chiavi: nell''ultimo minuto non si danno chiavi');
reset role;
insert into public.chiavi (stanza_id, da, a) values
  ('6e6e6e6e-0000-4000-8000-000000000002', '2f2f2f2f-0000-4000-8000-00000000000f', '30303030-0000-4000-8000-000000000030');
set local role service_role;
select pg_temp.ok(public.riprendi_chiave('2f2f2f2f-0000-4000-8000-00000000000f', '30303030-0000-4000-8000-000000000030') = 'chiuse'
  and public.cambia_frase('2f2f2f2f-0000-4000-8000-00000000000f', '30303030-0000-4000-8000-000000000030', 'ciao') = 'chiuse',
  'chiavi: nell''ultimo minuto non si riprendono e la frase non cambia');
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'chiavi') is not distinct from
  array['a', 'da', 'data_il', 'frase', 'stanza_id'],
  'chiavi: solo i campi della spec (chi, a chi, stanza, quando, frase)');
reset role;

-- Blocco da una parte o dall'altra: le chiavi tra i due spariscono in silenzio.
insert into public.blocchi (chi, bloccato) values ('2b2b2b2b-0000-4000-8000-00000000000b', '2a2a2a2a-0000-4000-8000-00000000000a');
select pg_temp.ok(not exists (select 1 from public.chiavi where '2a2a2a2a-0000-4000-8000-00000000000a' in (da, a)
  and '2b2b2b2b-0000-4000-8000-00000000000b' in (da, a)), 'chiavi: un blocco annulla le chiavi tra i due');
set local role service_role;
select pg_temp.ok(public.dai_chiave('2a2a2a2a-0000-4000-8000-00000000000a', '2b2b2b2b-0000-4000-8000-00000000000b', null) = 'non_nella_stanza',
  'chiavi: dopo un blocco non si dà la chiave (stessa risposta di «non è più nella stanza»)');
reset role;

-- Chi lascia la stanza: la chiave torna disponibile a chi l'aveva data.
delete from public.membri_stanza where utente_id = '2d2d2d2d-0000-4000-8000-00000000000d';
select pg_temp.ok(not exists (select 1 from public.chiavi where a = '2d2d2d2d-0000-4000-8000-00000000000d'),
  'chiavi: la chiave a chi lascia la stanza torna disponibile');
rollback;
