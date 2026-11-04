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
  if not condizione then raise exception 'ERRORE %', descrizione; end if;
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
