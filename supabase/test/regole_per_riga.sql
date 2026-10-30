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
update public.profili set citta = 'Roma', passo = 7;
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
