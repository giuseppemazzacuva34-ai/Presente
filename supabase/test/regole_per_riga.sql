-- Test delle regole per riga (issue #2): con due account di prova, B non legge né modifica nulla di A.
-- Si esegue su un Postgres di prova con supabase_finto.sql e le migrazioni (scripts/test_supabase.sh). Dati inventati.
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
-- Prova un comando che DEVE fallire; restituisce true se è fallito.
create function pg_temp.rifiutato(comando text) returns boolean language plpgsql as $$
begin
  execute comando;
  return false;
exception when others then
  return true;
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.com');

-- A compila il suo profilo
begin;
select pg_temp.come('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
insert into public.profili (id, nome, data_nascita, citta, mi_presento_come) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Niccolò', '1995-03-02', 'Milano', 'uomo');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'donne', now(), '1.2', 25, 40, 'citta');
insert into public.questionario (utente_id, risposte, importanza) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"1":[0,1]}', '{"valori":3}');
insert into storage.objects (bucket_id, name, owner) values
  ('voci', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/presentazione', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('foto', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/foto-1', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.ok((select count(*) from public.profili) = 1 and (select count(*) from public.filtri) = 1
  and (select count(*) from public.questionario) = 1 and (select count(*) from storage.objects) = 2, 'A vede i suoi dati e i suoi file');
select pg_temp.ok((select in_vigore_dal from public.questionario) > now(), 'il questionario vale dalla prossima apertura del lunedì');
commit;

-- B non vede e non tocca nulla di A
begin;
select pg_temp.come('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.ok((select count(*) from public.profili) = 0, 'B non legge il profilo di A');
select pg_temp.ok((select count(*) from public.filtri) = 0, 'B non legge i filtri di A');
select pg_temp.ok((select count(*) from public.questionario) = 0, 'B non legge il questionario di A');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'B non vede voce e foto di A');
update public.profili set nome = 'Intruso' where true;
update public.filtri set cerco = 'tutti' where true;
update public.questionario set risposte = '{}' where true;
delete from storage.objects where true;
select pg_temp.ok(pg_temp.rifiutato($$insert into public.profili (id, nome) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Finto')$$), 'B non crea un profilo a nome di A');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.questionario (utente_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$), 'B non scrive risposte a nome di A');
select pg_temp.ok(pg_temp.rifiutato($$insert into storage.objects (bucket_id, name) values ('foto', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/foto-2')$$), 'B non carica file nella cartella di A');
select pg_temp.ok(pg_temp.rifiutato($$delete from public.profili$$), 'nessuno cancella righe del profilo a mano (si cancella l''account)');
commit;

select pg_temp.ok((select nome from public.profili) = 'Niccolò' and (select cerco from public.filtri) = 'donne'
  and (select risposte from public.questionario) = '{"1":[0,1]}' and (select count(*) from storage.objects) = 2,
  'i dati di A sono intatti dopo i tentativi di B');

-- Senza login (chiave anon) non si legge nulla
begin;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato('select 1 from public.profili') and pg_temp.rifiutato('select 1 from public.filtri')
  and pg_temp.rifiutato('select 1 from public.questionario'), 'senza login (anon) le tabelle non si leggono');
select pg_temp.ok((select count(*) from storage.objects) = 0, 'senza login (anon) nessun file');
commit;

-- Regole del profilo
begin;
select pg_temp.come('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.ok(pg_temp.rifiutato(format($$insert into public.profili (id, data_nascita) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', %L)$$, (current_date - interval '17 years')::date)), 'sotto i 18 anni il profilo non si crea');
select pg_temp.ok((select count(*) from public.profili) = 0, 'del minorenne non resta nessuna riga');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.filtri (utente_id, cerco) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'uomini')$$), '«cerco» senza consenso non si salva');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.filtri (utente_id, cerco, consenso_cerco_il) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'uomini', now())$$), 'il consenso vale solo con la versione dell''informativa');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.filtri (utente_id, eta_min, eta_max) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 40, 30)$$), 'età massima minore della minima: rifiutata');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.profili (id, nome) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'X')$$), 'nome di una sola lettera rifiutato');
commit;
begin;
select pg_temp.come('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set data_nascita = '1990-01-01'$$), 'la data di nascita non si modifica');
update public.profili set provincia = 'RM', passo = 7, domande_voce = '{4,0,7}';
select pg_temp.ok((select domande_voce from public.profili) = '{4,0,7}', 'A salva le 3 domande a voce scelte');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set domande_voce = '{1,2,3,4}'$$), 'più di 3 domande a voce: rifiutate');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set domande_voce = '{1,8}'$$), 'domanda a voce inesistente: rifiutata');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set domande_voce = '{2,2}'$$), 'la stessa domanda due volte: rifiutata');
select pg_temp.ok((select citta from public.profili) = 'Roma', 'A modifica il suo profilo');
commit;

-- Questionario: le righe già in vigore non si toccano (la stanza in corso non cambia)
-- Come se il lunedì fosse già passato (da amministratore, senza il controllo automatico che lo vieterebbe).
set session_replication_role = replica;
update public.questionario set in_vigore_dal = now() - interval '2 days';
set session_replication_role = origin;
begin;
select pg_temp.come('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
update public.questionario set risposte = '{"1":[5,6]}';
select pg_temp.ok((select risposte from public.questionario) = '{"1":[0,1]}', 'una modifica in settimana non cambia il questionario in vigore');
insert into public.questionario (utente_id, risposte, importanza) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '{"1":[5,6]}', '{"valori":3}');
select pg_temp.ok((select count(*) from public.questionario) = 2, 'la modifica diventa la versione del prossimo lunedì');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.questionario (utente_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$), 'una sola versione nuova per settimana');
select pg_temp.ok(pg_temp.rifiutato($$update public.questionario set in_vigore_dal = now() where in_vigore_dal > now()$$), 'la settimana di una versione non si sposta');
commit;

-- Tetto di grandezza del questionario (migrazione 20261029234100_limiti_sicurezza.sql)
begin;
select pg_temp.come('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.ok(pg_temp.rifiutato(format($$insert into public.questionario (utente_id, risposte) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', %L)$$,
  json_build_object('x', repeat('a', 20000))::text)), 'risposte troppo grandi: rifiutate');
commit;
select pg_temp.ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('controlla_profilo', 'controlla_questionario', 'prossima_apertura')), 'funzioni con search_path fisso');

-- Orario delle stanze: lunedì alle 9:00 di Roma, anche con il cambio d'ora
select pg_temp.ok(public.prossima_apertura('2026-10-29 12:00+00') = '2026-11-02 09:00 Europe/Rome'::timestamptz, 'giovedì 29/10 → lunedì 2/11 alle 9:00');
select pg_temp.ok(public.prossima_apertura('2026-11-02 07:59+00') = '2026-11-02 09:00 Europe/Rome'::timestamptz, 'lunedì alle 8:59 → lo stesso lunedì alle 9:00');
select pg_temp.ok(public.prossima_apertura('2026-11-02 08:00+00') = '2026-11-09 09:00 Europe/Rome'::timestamptz, 'lunedì alle 9:00 in punto → il lunedì dopo');
select pg_temp.ok(public.prossima_apertura('2027-03-23 12:00+00') = '2027-03-29 07:00+00'::timestamptz, 'martedì prima del cambio d''ora → lunedì dopo alle 9:00 di Roma (7:00 UTC)');
select pg_temp.ok(public.prossima_apertura('2026-10-23 12:00+00') = '2026-10-26 08:00+00'::timestamptz, 'fine dell''ora legale: lunedì 26/10 alle 9:00 di Roma = 8:00 UTC');
select pg_temp.ok(public.prossima_apertura('2027-03-26 12:00+00') = '2027-03-29 07:00+00'::timestamptz, 'dopo il passaggio all''ora legale: 9:00 di Roma = 7:00 UTC');

-- Cancellazione dell'account: righe collegate cancellate a cascata
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select pg_temp.ok((select count(*) from public.profili) = 0 and (select count(*) from public.filtri) = 0
  and (select count(*) from public.questionario) = 0, 'eliminando l''account spariscono profilo, filtri e questionario');

-- Ogni tabella pubblica ha le regole per riga attive
select pg_temp.ok(not exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity), 'tutte le tabelle pubbliche hanno le regole per riga attive');
select pg_temp.ok((select bool_and(not public) from storage.buckets where id in ('voci', 'foto')) and (select count(*) from storage.buckets) = 2,
  'voci e foto sono cartelle private');

-- Requisito 3 del CISO: la data del consenso a «cerco» la decide il server.
begin;
select pg_temp.come('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa)
  values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'tutti', '2020-01-01', '1.2');
select pg_temp.ok((select consenso_cerco_il from public.filtri where utente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = now(),
  'consenso: la data mandata dal telefono viene ignorata, vale l''ora del server');
update public.filtri set consenso_cerco_il = '2021-01-01', raggio = 'italia' where utente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.ok((select consenso_cerco_il from public.filtri where utente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = now(),
  'consenso: senza cambiare «cerco» la data non si può modificare');
update public.filtri set cerco = null where utente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.ok((select consenso_cerco_il from public.filtri where utente_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is null,
  'consenso ritirato: anche la data si svuota');
rollback;

-- Requisito 4 del CISO: al massimo 4 voci e 3 foto per persona (nomi fissi, migrazione 20261030230000).
begin;
select pg_temp.come('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into storage.objects (bucket_id, name, owner) values
  ('voci', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/presentazione', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('voci', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/risposta-1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('voci', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/risposta-2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('voci', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/risposta-3', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-2', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-3', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
select pg_temp.ok((select count(*) from storage.objects) = 7, 'B carica 4 voci e 3 foto con i nomi fissi');
select pg_temp.ok(pg_temp.rifiutato($$insert into storage.objects (bucket_id, name) values ('voci', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/risposta-4')$$), 'una quinta voce non si carica');
select pg_temp.ok(pg_temp.rifiutato($$insert into storage.objects (bucket_id, name) values ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-4')$$), 'una quarta foto non si carica');
select pg_temp.ok(pg_temp.rifiutato($$insert into storage.objects (bucket_id, name) values ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/altra.jpg')$$), 'un nome diverso da quelli fissi non si carica');
select pg_temp.ok(pg_temp.rifiutato($$insert into storage.objects (bucket_id, name) values ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/sotto/foto-1')$$), 'niente sottocartelle');
select pg_temp.ok(pg_temp.rifiutato($$insert into storage.objects (bucket_id, name) values ('foto', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-1')$$), 'lo stesso nome due volte non crea un secondo file');
select pg_temp.ok(pg_temp.rifiutato($$update storage.objects set name = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-9' where name like '%/foto-3'$$), 'rinominare con un nome non ammesso è rifiutato');
update storage.objects set created_at = now() where name = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/foto-1';
select pg_temp.ok((select count(*) from storage.objects where bucket_id = 'foto') = 3, 'sostituire una foto non aggiunge file');
rollback;

-- Revisione CISO (30/10): la data di accettazione delle regole la decide il server e poi non si cambia.
begin;
select pg_temp.come('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.profili (id, regole_accettate_il) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '2020-01-01');
select pg_temp.ok((select regole_accettate_il from public.profili where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = now(),
  'regole: la data mandata dal telefono viene ignorata, vale l''ora del server');
update public.profili set regole_accettate_il = '2021-01-01' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.ok((select regole_accettate_il from public.profili where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') = now(),
  'regole: una volta accettate la data non si sposta');
update public.profili set regole_accettate_il = null where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select pg_temp.ok((select regole_accettate_il from public.profili where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') is not null,
  'regole: una volta accettate la data non si cancella');
rollback;

-- Issue #3 (2/11): stanze. Il telefono non crea stanze; ognuno vede solo la sua; dei compagni solo nome, età e città.
begin;
insert into auth.users (id, email) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.com') on conflict do nothing;
insert into public.profili (id, nome, data_nascita, citta) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Niccolò', '1995-03-02', 'Milano') on conflict do nothing;
insert into auth.users (id, email) values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'c@example.com'),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'd@example.com');
insert into public.profili (id, nome, data_nascita, citta) values
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Bea', '1993-06-10', 'Roma'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Carlo', '1990-01-15', 'Torino');
insert into public.profili (id, nome) values ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Dora');
-- Da 3/11 si vedono solo i compatibili: A (uomo, cerca donne 25-40) e Bea (donna, cerca uomini) lo sono, raggio Italia.
update public.profili set mi_presento_come = 'uomo' where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.profili set mi_presento_come = 'donna' where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'donne', now(), '1.5', 25, 40, 'italia'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'uomini', now(), '1.5', 25, 45, 'italia')
  on conflict (utente_id) do update set cerco = excluded.cerco, eta_min = excluded.eta_min, eta_max = excluded.eta_max, raggio = excluded.raggio;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('11111111-1111-4111-8111-111111111111', 'italia', now() - interval '1 day', now() + interval '5 days'),
  ('22222222-2222-4222-8222-222222222222', 'italia', now() - interval '1 day', now() + interval '5 days');
insert into public.membri_stanza (stanza_id, utente_id, gratis) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true),
  ('11111111-1111-4111-8111-111111111111', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true),
  ('22222222-2222-4222-8222-222222222222', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
select pg_temp.ok(pg_temp.rifiutato($$insert into public.membri_stanza (stanza_id, utente_id) values ('22222222-2222-4222-8222-222222222222', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')$$),
  'stanze: nessuno entra senza data di nascita (requisito 2 del CISO)');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.membri_stanza (stanza_id, utente_id) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$),
  'stanze: una sola stanza alla volta');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.stanze (tipo, apre_il, chiude_il) values ('citta', now(), now() + interval '6 days')$$),
  'stanze: una stanza di città ha sempre la città');
select pg_temp.come('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
select pg_temp.ok((select count(*) from public.stanze) = 1 and (select count(*) from public.membri_stanza) = 1,
  'stanze: A vede solo la sua stanza e la sua riga');
select pg_temp.ok((select count(*) from public.compagni_di_stanza()) = 1
  and (select nome from public.compagni_di_stanza()) = 'Bea' and (select citta from public.compagni_di_stanza()) = 'Roma'
  and (select eta from public.compagni_di_stanza()) between 30 and 40,
  'stanze: A vede di Bea solo nome, età e città; Carlo (altra stanza) no');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.stanze (tipo, apre_il, chiude_il) values ('italia', now(), now() + interval '6 days')$$),
  'stanze: il telefono non crea stanze');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.membri_stanza (stanza_id, utente_id) values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$),
  'stanze: il telefono non si mette in una stanza da solo');
select pg_temp.ok(pg_temp.rifiutato($$delete from public.membri_stanza$$), 'stanze: il telefono non toglie nessuno');
select pg_temp.come('dddddddd-dddd-4ddd-8ddd-dddddddddddd');
select pg_temp.ok((select count(*) from public.compagni_di_stanza()) = 0 and (select count(*) from public.stanze) = 0,
  'stanze: chi non è in una stanza non vede nessuno');
rollback;

-- Issue #3, risposta del CPO del 3/11: nella stanza vedi solo chi è reciprocamente compatibile, anche chiamando l'API.
begin;
insert into auth.users (id, email) values
  ('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 'anna@example.com'), ('0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', 'bice@example.com'),
  ('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'carlo@example.com'), ('0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', 'dario@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 'Anna', '1995-05-05', 'MI', 'donna'),
  ('0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', 'Bice', '1994-04-04', 'MI', 'donna'),
  ('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'Carlo', '1992-02-02', 'RM', 'uomo'),
  ('0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', 'Dario', '1990-01-01', 'RM', 'uomo');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio) values
  ('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', 'uomini', now(), '1.5', 25, 45, 'italia'),
  ('0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', 'uomini', now(), '1.5', 25, 45, 'italia'),
  ('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', 'donne', now(), '1.5', 25, 45, 'italia'),
  ('0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d', 'donne', now(), '1.5', 33, 45, 'italia'); -- Anna e Bice fuori dalla sua età
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('33333333-3333-4333-8333-333333333333', 'italia', now() - interval '1 day', now() + interval '5 days');
insert into public.membri_stanza (stanza_id, utente_id) select '33333333-3333-4333-8333-333333333333', id from public.profili
  where id in ('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b', '0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c', '0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d');
select pg_temp.come('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a');
select pg_temp.ok((select array_agg(nome order by nome) from public.compagni_di_stanza()) = array['Carlo'],
  'per te: Anna vede solo Carlo (non Bice, che cerca anche lei uomini; non Dario, per cui lei è fuori età)');
select pg_temp.ok(pg_temp.rifiutato($$select public.compatibili_tra('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b')$$)
  and pg_temp.rifiutato($$select public.rientra_nei_filtri('0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a', '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b')$$),
  'per te: le funzioni del controllo non si chiamano dal telefono (non rivelano i filtri degli altri)');
select pg_temp.come('0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b');
select pg_temp.ok((select array_agg(nome order by nome) from public.compagni_di_stanza()) = array['Carlo'], 'per te: Bice non vede Anna');
select pg_temp.come('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c');
select pg_temp.ok((select array_agg(nome order by nome) from public.compagni_di_stanza()) = array['Anna', 'Bice'], 'per te: Carlo vede Anna e Bice, non Dario');
select pg_temp.come('0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d');
select pg_temp.ok((select count(*) from public.compagni_di_stanza()) = 0, 'per te: Dario non vede nessuno (compatibilità nei due versi)');
reset role;
update public.filtri set raggio = 'citta' where utente_id = '0b0b0b0b-0b0b-4b0b-8b0b-0b0b0b0b0b0b';
select pg_temp.come('0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c');
select pg_temp.ok((select array_agg(nome order by nome) from public.compagni_di_stanza()) = array['Anna'],
  'per te: se Bice vuole solo la sua provincia (Milano), Carlo di Roma non la vede più');
rollback;

-- Provincia (#2 v1.3, D84 A): obbligatoria per andare oltre il passo 5, regione dal server, un cambio ogni 7 giorni.
begin;
insert into auth.users (id, email) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'e@example.com');
select pg_temp.come('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
insert into public.profili (id, nome, data_nascita, passo) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Elsa', '1992-04-04', 5);
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set passo = 6$$), 'provincia: senza provincia non si passa al passo 6');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set provincia = 'XX'$$), 'provincia: sigla fuori tabella rifiutata');
update public.profili set provincia = 'MB', regione = 'Sicilia', provincia_origine = 'lista', passo = 6;
select pg_temp.ok((select regione from public.profili) = 'Lombardia' and (select citta from public.profili) = 'Monza e Brianza'
  and (select provincia_in_vigore_dal from public.profili) <= now(),
  'provincia: la regione la scrive il server (Lombardia, non quella mandata), la prima scelta vale subito');
select pg_temp.ok((select provincia_origine from public.profili) = 'scelta',
  'provincia: l''origine la scrive il server (il telefono manda «lista» ma resta «scelta», CISO 3/11)');
update public.profili set regione = 'Sicilia', provincia_cambiata_il = now() - interval '30 days';
select pg_temp.ok((select regione from public.profili) = 'Lombardia' and (select provincia_cambiata_il from public.profili) > now() - interval '1 minute',
  'provincia: il telefono non cambia regione né data del cambio');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set provincia = 'RM'$$), 'provincia: secondo cambio entro 7 giorni rifiutato');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set provincia = null$$), 'provincia: non si può togliere');
reset role;
-- Si simula che siano passati 8 giorni (solo nel test, con il controllo spento per un attimo).
alter table public.profili disable trigger profili_controlla_provincia;
update public.profili set provincia_cambiata_il = now() - interval '8 days' where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
alter table public.profili enable trigger profili_controlla_provincia;
select pg_temp.come('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');
update public.profili set provincia = 'EE';
select pg_temp.ok((select provincia_precedente from public.profili) = 'MB' and (select provincia_in_vigore_dal from public.profili) > now()
  and (select citta from public.profili) is null and (select regione from public.profili) is null,
  'provincia: dopo 7 giorni si cambia, vale dal lunedì dopo; la stanza in corso usa la precedente');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.province$$), 'provincia: la tabella delle province non si legge dal telefono');
rollback;

-- Issue #3: conferma d'ingresso alla stanza («Entra nella stanza»), entro domenica 23:59 di Roma.
begin;
insert into auth.users (id, email) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', 'c1@example.com'), ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2', 'c2@example.com');
select pg_temp.come('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1');
insert into public.conferme_stanza (utente_id, apre_il, confermata_il) values
  ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', '2020-01-06 09:00+01', '2020-01-01');
select pg_temp.ok((select apre_il from public.conferme_stanza) = public.prossima_apertura(now() + interval '9 hours')
  and (select confermata_il from public.conferme_stanza) > now() - interval '1 minute',
  'conferme: settimana e ora le scrive il server (prossimo lunedì ancora aperto alle conferme)');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.conferme_stanza (utente_id) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1')$$),
  'conferme: una sola conferma a settimana');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.conferme_stanza (utente_id) values ('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2')$$),
  'conferme: non si conferma per un altro');
select pg_temp.ok(pg_temp.rifiutato($$update public.conferme_stanza set confermata_il = now()$$), 'conferme: il telefono non le modifica');
select pg_temp.come('c2c2c2c2-c2c2-4c2c-8c2c-c2c2c2c2c2c2');
select pg_temp.ok((select count(*) from public.conferme_stanza) = 0, 'conferme: nessuno vede le conferme degli altri');
delete from public.conferme_stanza;
reset role;
select pg_temp.ok((select count(*) from public.conferme_stanza) = 1, 'conferme: nessuno cancella le conferme degli altri');
select pg_temp.come('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1');
delete from public.conferme_stanza;
select pg_temp.ok((select count(*) from public.conferme_stanza) = 0, 'conferme: prima della scadenza ci si può ripensare');
reset role;
-- Una conferma della settimana in corso (scadenza passata): solo nel test, con il controllo spento per un attimo.
alter table public.conferme_stanza disable trigger conferme_stanza_dal_server;
insert into public.conferme_stanza (utente_id, apre_il) values ('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1', now() - interval '1 hour');
alter table public.conferme_stanza enable trigger conferme_stanza_dal_server;
select pg_temp.come('c1c1c1c1-c1c1-4c1c-8c1c-c1c1c1c1c1c1');
delete from public.conferme_stanza;
select pg_temp.ok((select count(*) from public.conferme_stanza) = 1, 'conferme: dopo domenica 23:59 non si ritira più');
reset role;
select pg_temp.ok(pg_temp.rifiutato($$set local role anon; select * from public.conferme_stanza$$), 'conferme: senza login niente');
set local timezone = 'Europe/Rome';
select pg_temp.ok(public.prossima_apertura(timestamptz '2026-11-08 23:59' + interval '9 hours') = '2026-11-09 09:00'
  and public.prossima_apertura(timestamptz '2026-11-09 00:01' + interval '9 hours') = '2026-11-16 09:00'
  and public.prossima_apertura(timestamptz '2027-03-28 23:59' + interval '9 hours') = '2027-03-29 09:00'
  and public.prossima_apertura(timestamptz '2026-10-25 23:59' + interval '9 hours') = '2026-10-26 09:00',
  'conferme: domenica 23:59 vale per il lunedì dopo, un minuto dopo per quello successivo (anche col cambio d''ora)');
-- Origine «lista»: solo dal server (futura precompilazione), con l'impostazione locale alla transazione.
begin;
insert into auth.users (id, email) values ('efefefef-efef-4efe-8efe-efefefefefef', 'f@example.com');
select set_config('presente.origine', 'lista', true);
insert into public.profili (id, nome, data_nascita, passo, provincia) values ('efefefef-efef-4efe-8efe-efefefefefef', 'Fede', '1990-01-01', 5, 'RM');
select pg_temp.ok((select provincia_origine from public.profili where id = 'efefefef-efef-4efe-8efe-efefefefefef') = 'lista',
  'provincia: la precompilazione dal server scrive «lista»');
rollback;

-- Conferma della provincia della lista (#2 v1.3): solo il server (service_role) scrive «lista», solo la prima volta.
begin;
insert into auth.users (id, email) values ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'g@example.com');
insert into public.profili (id, nome, data_nascita, passo) values ('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'Gaia', '1991-02-02', 5);
select pg_temp.come('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1');
select pg_temp.ok(pg_temp.rifiutato($$select public.conferma_provincia_lista('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'RM')$$),
  'lista: il telefono non può chiamare la conferma dal server');
reset role;
set local role service_role;
select pg_temp.ok(public.conferma_provincia_lista('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'RM'), 'lista: il server conferma la prima provincia');
reset role;
select pg_temp.ok((select provincia_origine from public.profili where id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 'lista'
  and (select regione from public.profili where id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 'Lazio',
  'lista: origine «lista» e regione dalla tabella');
select pg_temp.come('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1');
update public.profili set nome = 'Gaia', provincia = 'RM', mi_presento_come = 'donna', passo = 6;
select pg_temp.ok((select provincia_origine from public.profili) = 'lista', 'lista: il salvataggio del passo 5 dal telefono non la cambia');
reset role;
set local role service_role;
select pg_temp.ok(not public.conferma_provincia_lista('f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1', 'MI'), 'lista: con una provincia già salvata non scrive nulla');
reset role;
select pg_temp.ok((select provincia from public.profili where id = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1') = 'RM', 'lista: la provincia resta Roma');
rollback;

-- Aree vaste (#3 v1.2, D121 A): tabella «aree», «Solo la mia zona» nel database, conteggi solo numeri per la plancia.
begin;
select pg_temp.ok((select count(*) from public.province where sigla <> 'EE') = 107
  and (select count(*) from public.province where sigla <> 'EE' and area is null) = 0
  and (select area from public.province where sigla = 'EE') is null,
  'aree: ognuna delle 107 province ha esattamente un''area, l''estero nessuna');
select pg_temp.ok(public.area_di('MB') = 'milano' and public.area_di('LT') = 'roma' and public.area_di('NO') = 'no'
  and public.area_di('EE') is null and public.area_di(null) is null,
  'aree: Monza con Milano, Latina con Roma, Novara da sola, estero senza area');
select pg_temp.ok((select nome from public.aree where codice = 'no') = 'Novara'
  and (select nome from public.aree where codice = 'milano') = 'Milano e dintorni', 'aree: nomi visibili');
insert into auth.users (id, email) values
  ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 'z1@example.com'), ('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', 'z2@example.com'),
  ('1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', 'z3@example.com'), ('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', 'z4@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come, passo) values
  ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 'Ada', '1993-03-03', 'MI', 'donna', 11),
  ('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', 'Bruno', '1991-01-01', 'MB', 'uomo', 11),
  ('1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', 'Ciro', '1991-01-01', 'NO', 'uomo', 11),
  ('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', 'Duilio', '1991-01-01', 'RM', 'uomo', 5);
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio) values
  ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 'uomini', now(), '1.5', 25, 45, 'citta'),
  ('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', 'donne', now(), '1.5', 25, 45, 'italia'),
  ('1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', 'donne', now(), '1.5', 25, 45, 'italia'),
  ('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', 'donne', now(), '1.5', 25, 45, 'italia');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('44444444-4444-4444-8444-444444444444', 'italia', now() - interval '1 day', now() + interval '5 days');
insert into public.membri_stanza (stanza_id, utente_id) select '44444444-4444-4444-8444-444444444444', id from public.profili
  where id in ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d');
select pg_temp.come('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a');
select pg_temp.ok((select array_agg(nome order by nome) from public.compagni_di_stanza()) = array['Bruno'],
  'zona: con «Solo la mia zona» Ada di Milano vede Bruno di Monza (stessa area), non Ciro di Novara né Duilio di Roma');
select pg_temp.ok((select citta from public.compagni_di_stanza()) = 'Monza e Brianza', 'zona: gli altri vedono la provincia, non l''area');
select pg_temp.ok(pg_temp.rifiutato($$update public.aree set nome = 'X' where codice = 'milano'$$)
  and pg_temp.rifiutato($$select count(*) from public.aree$$), 'aree: il telefono non legge né cambia la mappa');
select pg_temp.ok(pg_temp.rifiutato($$update public.province set area = 'roma' where sigla = 'MB'$$)
  and pg_temp.rifiutato($$select public.area_di('MB')$$), 'aree: il telefono non sposta una provincia e non chiama area_di');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.conteggi_aree()$$), 'conteggi: il telefono non li legge');
reset role;
set local role service_role;
select pg_temp.ok((select totale from public.conteggi_aree() where codice = 'milano') = 2
  and (select donne from public.conteggi_aree() where codice = 'milano') = 1
  and (select totale from public.conteggi_aree() where codice = 'no') = 1
  and not exists (select 1 from public.conteggi_aree() where codice = 'roma' and totale > 0),
  'conteggi: solo profili completi per area (Milano 2 di cui 1 donna, Novara 1, Roma 0: Duilio è al passo 5)');
reset role;
-- (da proprietario: con il ruolo del telefono information_schema non mostra le colonne e il confronto darebbe vuoto)
select pg_temp.ok((select array_agg(column_name::text order by column_name) from information_schema.columns
  where table_schema = 'public' and table_name = 'aree') = array['codice', 'nome'], 'aree: la tabella ha solo codice e nome');
rollback;

-- Lavoro del lunedì (#3): righe_settimana() legge solo chi ha confermato, scrivi_settimana() scrive tutto o niente.
begin;
insert into auth.users (id, email) values
  ('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', 'l1@example.com'), ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', 'l2@example.com'),
  ('2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c', 'l3@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come, passo) values
  ('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', 'Elsa', '1990-02-02', 'MI', 'donna', 11),
  ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', 'Fabio', '1989-02-02', 'RM', 'uomo', 11),
  ('2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c', 'Gino', '1988-02-02', 'TO', 'uomo', 11);
-- Elsa ha un cambio di provincia che vale solo dopo questa apertura: per la stanza vale ancora quella di prima (Roma).
-- (i campi li scrive solo il server: qui si salta il controllo per preparare il caso)
set local session_replication_role = replica;
update public.profili set provincia_precedente = 'RM', provincia_in_vigore_dal = now() + interval '30 days'
  where id = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a';
set local session_replication_role = origin;
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio) values
  ('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', 'uomini', now(), '1.5', 25, 45, 'italia'),
  ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', 'donne', now(), '1.5', 25, 45, 'italia'),
  ('2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c', 'donne', now(), '1.5', 25, 45, 'italia');
insert into public.conferme_stanza (utente_id, apre_il) values
  ('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', now()), ('2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', now());
create temp table lunedi as select public.prossima_apertura(now() + interval '9 hours') as apre;
grant select on lunedi to service_role, authenticated;
select pg_temp.come('2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a');
select pg_temp.ok(pg_temp.rifiutato($$select public.righe_settimana((select apre from lunedi))$$)
  and pg_temp.rifiutato($$select public.scrivi_settimana('{}'::jsonb)$$), 'lunedì: il telefono non legge le righe e non scrive stanze');
reset role;
set local role service_role;
create temp table letto as select public.righe_settimana((select apre from lunedi)) as d;
select pg_temp.ok(jsonb_array_length((select d -> 'righe' from letto)) = 2
  and (select d -> 'iscrizioni' ? '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a' from letto)
  and not (select d -> 'iscrizioni' ? '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c' from letto),
  'lunedì: si leggono solo le persone che hanno confermato (Elsa e Fabio, non Gino)');
select pg_temp.ok((select r -> 'profilo' ->> 'provincia' from letto, jsonb_array_elements(d -> 'righe') r
  where r -> 'profilo' ->> 'id' = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a') = 'RM',
  'lunedì: vale la provincia in vigore all''apertura, non quella cambiata in settimana');
select pg_temp.ok((select d::text not like '%example.com%' and d::text not like '%mi_descrivo"%' from letto),
  'lunedì: nelle righe lette nessuna email');
select pg_temp.ok(pg_temp.rifiutato($$select public.scrivi_settimana(jsonb_build_object('apre_il', (select apre from lunedi) + interval '1 hour',
  'chiude_il', (select apre from lunedi) + interval '6 days 12 hours', 'stanze', '[]'::jsonb))$$),
  'lunedì: rifiuta un''apertura che non è lunedì alle 9 di Roma');
select pg_temp.ok(pg_temp.rifiutato($$select public.scrivi_settimana(jsonb_build_object('apre_il', (select apre from lunedi),
  'chiude_il', (select apre from lunedi) + interval '6 days 12 hours', 'stanze', jsonb_build_array(jsonb_build_object('tipo', 'italia',
  'membri', jsonb_build_array(jsonb_build_object('utente_id', '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', 'gratis', true),
                              jsonb_build_object('utente_id', '2c2c2c2c-2c2c-4c2c-8c2c-2c2c2c2c2c2c', 'gratis', true))))))$$),
  'lunedì: rifiuta chi non ha confermato (Gino)');
reset role;
select pg_temp.ok(not exists (select 1 from public.stanze where apre_il = (select apre from lunedi)),
  'lunedì: dopo un rifiuto non resta nessuna stanza a metà');
set local role service_role;
create temp table scritto as select public.scrivi_settimana(jsonb_build_object('apre_il', (select apre from lunedi),
  'chiude_il', (select apre from lunedi) + interval '6 days 12 hours', 'stanze', jsonb_build_array(jsonb_build_object('tipo', 'italia',
  'membri', jsonb_build_array(jsonb_build_object('utente_id', '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a', 'gratis', true),
                              jsonb_build_object('utente_id', '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b', 'gratis', false)))))) as r;
select pg_temp.ok((select (r ->> 'stanze')::int = 1 and (r ->> 'membri')::int = 2 from scritto), 'lunedì: scrive 1 stanza con 2 persone');
select pg_temp.ok((select (r ->> 'gia_fatta')::boolean from (select public.scrivi_settimana(jsonb_build_object('apre_il', (select apre from lunedi),
  'chiude_il', (select apre from lunedi) + interval '6 days 12 hours', 'stanze', '[]'::jsonb)) as r) x),
  'lunedì: una seconda esecuzione nella stessa settimana non scrive nulla');
reset role;
select pg_temp.ok((select count(*) from public.stanze where apre_il = (select apre from lunedi)) = 1
  and (select gratis from public.membri_stanza where utente_id = '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a')
  and not (select gratis from public.membri_stanza where utente_id = '2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b'),
  'lunedì: nel database 1 stanza, Elsa gratis e Fabio no');
set local role service_role;
select pg_temp.ok((select (d -> 'stanze_precedenti' ->> '2a2a2a2a-2a2a-4a2a-8a2a-2a2a2a2a2a2a')::int = 1
  and jsonb_array_length(d -> 'storico') = 2 from (select public.righe_settimana((select apre from lunedi) + interval '7 days') as d) x),
  'lunedì: la settimana dopo conta la stanza già fatta e la mette nello storico');
reset role;
rollback;

-- ---------------------------------------------------------------------------------------------------------
-- Chiamate (issue #4, passo 2): registro con solo 5 campi, carte v1, carte viste, fascia, permesso e blocchi (D32 A).
begin;
insert into auth.users (id, email) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 'ida@example.com'),
  ('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', 'leo@example.com'),
  ('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', 'mia@example.com');
insert into public.profili (id, nome, data_nascita, citta, mi_presento_come) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 'Ida', '1990-01-01', 'Torino', 'donna'),
  ('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', 'Leo', '1990-01-01', 'Torino', 'uomo'),
  ('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', 'Mia', '1990-01-01', 'Torino', 'donna');

-- Il registro delle chiamate ha SOLO chi, con, inizio, durata, esito (spec v1.1).
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'chiamate') is not distinct from array['chi', 'con', 'durata', 'esito', 'inizio'],
  'chiamate: il registro contiene solo chi, con, inizio, durata, esito');

-- Le 30 carte approvate (D58 A), testo per testo, versione v1 e attive.
select pg_temp.ok((select count(*) from public.carte where versione = 'v1' and attiva) = 30, 'carte: 30 carte v1 attive');
select pg_temp.ok(not exists (
  select 1 from jsonb_array_elements_text(:'carte_v1'::jsonb) with ordinality as e(testo, n)
  left join public.carte c on c.id = e.n and c.testo = e.testo where c.id is null), 'carte: testi identici alla bozza approvata');

-- Una stanza aperta adesso con Ida, Leo e Mia (preparata qui; in produzione la scrive il lavoro del lunedì).
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', 'italia', now() - interval '1 day', now() + interval '2 days');
insert into public.membri_stanza (stanza_id, utente_id) values
  ('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a'),
  ('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b'),
  ('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c');
set local role service_role;
insert into public.chiamate (chi, con, inizio, durata, esito) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', now() - interval '1 hour', 900, 'tempo_scaduto');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.chiamate (chi, con, inizio, durata, esito) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', now(), 901, 'chiusa')$$),
  'chiamate: mai più di 15 minuti nel registro');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.chiamate (chi, con, inizio, durata, esito) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', now(), 60, 'registrata')$$)
  and pg_temp.rifiutato($$insert into public.chiamate (chi, con, inizio) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', now())$$),
  'chiamate: solo i 4 esiti previsti e mai con sé stessi');
insert into public.carte_viste (stanza_id, a, b, carta_id) values
  ('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', 7);
select pg_temp.ok(pg_temp.rifiutato($$insert into public.carte_viste (stanza_id, a, b, carta_id) values
  ('3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', 8)$$),
  'carte viste: la coppia si scrive sempre in un solo ordine (a < b)');
reset role;

-- Il telefono: Ida vede la sua chiamata, Mia no; nessuno scrive il registro o legge carte e carte viste.
select pg_temp.come('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a');
select pg_temp.ok((select count(*) from public.chiamate) = 1, 'chiamate: chi ha chiamato vede la sua riga');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.chiamate (chi, con, inizio, durata, esito) values
  ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c', now(), 60, 'chiusa')$$)
  and pg_temp.rifiutato($$update public.chiamate set durata = 10$$),
  'chiamate: il telefono non scrive il registro (solo il server)');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.carte$$) and pg_temp.rifiutato($$select * from public.carte_viste$$),
  'carte: il telefono non legge il mazzo né le carte viste (le manda il server)');
-- Fascia di disponibilità e «mi chiamano solo persone a cui do il permesso» nel profilo.
update public.profili set fascia_da = '19:00', fascia_a = '23:00', solo_con_permesso = true where id = auth.uid();
select pg_temp.ok((select fascia_da = '19:00' and solo_con_permesso from public.profili), 'profilo: Ida imposta fascia e permesso');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set fascia_da = '25:00' where id = auth.uid()$$)
  and pg_temp.rifiutato($$update public.profili set fascia_da = '19:00', fascia_a = null where id = auth.uid()$$),
  'profilo: fascia con ore valide e sempre con inizio e fine');
insert into public.permessi_chiamata (utente_id, permesso_a) values ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b');
insert into public.blocchi (chi, bloccato) values ('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a', '3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c');
select pg_temp.ok(pg_temp.rifiutato($$delete from public.blocchi$$) or (select count(*) from public.blocchi) = 1,
  'blocchi: il blocco è definitivo (non si toglie)');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.permessi_chiamata (utente_id, permesso_a) values
  ('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a')$$)
  and pg_temp.rifiutato($$insert into public.blocchi (chi, bloccato) values
  ('3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b', '3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a')$$),
  'permessi e blocchi: ognuno li scrive solo per sé');
reset role;

select pg_temp.come('3c3c3c3c-3c3c-4c3c-8c3c-3c3c3c3c3c3c');
select pg_temp.ok((select count(*) from public.chiamate) = 0, 'chiamate: Mia non vede le chiamate degli altri');
select pg_temp.ok((select count(*) from public.blocchi) = 0 and (select count(*) from public.permessi_chiamata) = 0,
  'blocchi e permessi: Mia non sa di essere stata bloccata e non vede i permessi di Ida');
reset role;

-- Chiusura della stanza: le carte viste si cancellano (spec v1.2). Solo il server può farlo.
select pg_temp.come('3a3a3a3a-3a3a-4a3a-8a3a-3a3a3a3a3a3a');
select pg_temp.ok(pg_temp.rifiutato($$select public.pulisci_carte_viste()$$), 'carte viste: il telefono non lancia la pulizia');
reset role;
set local role service_role;
select pg_temp.ok(public.pulisci_carte_viste() = 0, 'carte viste: con la stanza ancora aperta non si cancella nulla');
reset role;
update public.stanze set chiude_il = now() - interval '1 minute' where id = '3d3d3d3d-3d3d-4d3d-8d3d-3d3d3d3d3d3d';
set local role service_role;
select pg_temp.ok(public.pulisci_carte_viste() = 1, 'carte viste: alla chiusura della stanza si cancellano');
reset role;
select pg_temp.ok(not exists (select 1 from public.carte_viste), 'carte viste: dopo la chiusura non resta nessuna riga');
rollback;
