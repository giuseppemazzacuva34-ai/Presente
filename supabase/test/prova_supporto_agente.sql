-- Test della vista per l'agente e delle bozze di risposta (issue #10, parte B v1 del CPO del 13/11 e v1.1 del 20/11;
-- D122 B). Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: la chiave dell'agente legge solo «supporto_per_agente» (id, categoria, testo con contatti mascherati, data,
-- stato, bandiera «sicurezza») e scrive solo «supporto_bozze» (bozza max 120 parole, fonte «FAQ n. X» o «nessuna»);
-- ogni altra tabella e funzione risponde «non autorizzato». Un messaggio con bandiera «sicurezza» non riceve mai bozza.
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
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('5a5a5a5a-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'ag' || n || '@example.com' from generate_series(1, 2) n;
create temp table m (n integer primary key, id uuid) on commit drop;
grant select on m to agente_supporto;
grant insert, select on m to service_role;
set local role service_role;
insert into m values
  (1, (public.invia_supporto(pg_temp.p(1), 'crediti', 'Non vedo i crediti, scrivetemi a mario@example.com o al 333 1234567') ->> 'id')::uuid),
  (2, (public.invia_supporto(pg_temp.p(1), 'incontro', 'Ho paura, mi segue dopo la chiamata') ->> 'id')::uuid),
  (3, (public.invia_supporto(pg_temp.p(2), 'altro', 'Domanda già risposta') ->> 'id')::uuid),
  (4, (public.invia_supporto(pg_temp.p(2), 'account', 'Come cambio provincia?') ->> 'id')::uuid);
select public.rispondi_supporto((select id from m where n = 3), 'Risposta di prova');
reset role;

-- La vista: esattamente i 6 campi della spec, solo i messaggi ancora senza risposta, contatti mascherati.
select pg_temp.ok((select array_agg(column_name::text order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'supporto_per_agente')
  = array['id', 'categoria', 'testo', 'creato_il', 'stato', 'sicurezza'],
  'agente: la vista ha solo id, categoria, testo, data, stato e bandiera «sicurezza»');

set local role agente_supporto;
select pg_temp.ok((select count(*) from public.supporto_per_agente) = 3
  and not exists (select 1 from public.supporto_per_agente v join m on m.id = v.id where m.n = 3),
  'agente: vede solo i messaggi senza risposta');
select pg_temp.ok((select v.testo from public.supporto_per_agente v join m on m.id = v.id where m.n = 1)
  = 'Non vedo i crediti, scrivetemi a [contatto nascosto] o al [contatto nascosto]',
  'agente: email e telefono nel testo arrivano come «[contatto nascosto]»');
select pg_temp.ok((select v.sicurezza from public.supporto_per_agente v join m on m.id = v.id where m.n = 2)
  and (select v.stato from public.supporto_per_agente v join m on m.id = v.id where m.n = 4) = 'inviato',
  'agente: bandiera «sicurezza» e stato «inviato» visibili');

-- Non legge né scrive altro.
select pg_temp.ok(pg_temp.rifiutato($$select * from public.supporto$$)
  and pg_temp.rifiutato($$select * from auth.users$$)
  and pg_temp.rifiutato($$select * from public.operatori_supporto$$)
  and pg_temp.rifiutato($$select * from public.coda_supporto()$$)
  and pg_temp.rifiutato($$select public.rispondi_supporto(gen_random_uuid(), 'x')$$)
  and pg_temp.rifiutato($$select * from public.supporto_bozze$$),
  'agente: supporto, utenti, operatori, coda e bozze già scritte rispondono «non autorizzato»');
reset role;
select pg_temp.ok(not exists (
    select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname in ('public', 'auth', 'storage') and c.relkind in ('r', 'v', 'm', 'p', 'f')
      and c.relname not in ('supporto_per_agente', 'supporto_bozze')
      and has_table_privilege('agente_supporto', c.oid, 'select, insert, update, delete')),
  'agente: nessun permesso su tutte le altre tabelle e viste');
select pg_temp.ok(not exists (
    select 1 from pg_proc f join pg_namespace s on s.oid = f.pronamespace
    where s.nspname in ('public', 'auth', 'storage') and f.prosecdef
      and has_function_privilege('agente_supporto', f.oid, 'execute')),
  'agente: nessuna funzione del server (security definer) eseguibile');

-- Scrive solo bozze valide.
set local role agente_supporto;
insert into public.supporto_bozze (messaggio_id, testo, fonte)
  select id, 'Ciao! I crediti compaiono in alto nella home. Il team di Presente', 'FAQ n. 9' from m where n = 1;
select pg_temp.ok((select v.stato from public.supporto_per_agente v join m on m.id = v.id where m.n = 1) = 'bozza_pronta',
  'agente: dopo la bozza il messaggio è «bozza_pronta»');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, 'Altra bozza', 'nessuna' from m where n = 1$$),
  'agente: una sola bozza per messaggio');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, 'Stai tranquilla', 'nessuna' from m where n = 2$$),
  'agente: un messaggio con bandiera «sicurezza» non riceve mai una bozza');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, 'Bozza', 'nessuna' from m where n = 3$$),
  'agente: nessuna bozza per un messaggio già risposto');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    values (gen_random_uuid(), 'Bozza', 'nessuna')$$),
  'agente: nessuna bozza per un messaggio che non esiste');
select pg_temp.ok(pg_temp.rifiutato(format($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, %L, 'nessuna' from m where n = 4$$, repeat('parola ', 121)))
  and pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, '   ', 'nessuna' from m where n = 4$$),
  'agente: bozza oltre 120 parole o vuota rifiutata');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, 'Bozza', 'internet' from m where n = 4$$)
  and pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select id, 'Bozza', 'FAQ n. 13' from m where n = 4$$),
  'agente: fonte solo «FAQ n. 1-12» o «nessuna»');
insert into public.supporto_bozze (messaggio_id, testo, fonte, con_istruzioni)
  select id, 'Da gestire da Giuseppe: cambio provincia.', 'nessuna', true from m where n = 4;
select pg_temp.ok(pg_temp.rifiutato($$update public.supporto_bozze set testo = 'cambiata'$$)
  and pg_temp.rifiutato($$delete from public.supporto_bozze$$)
  and pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte, creato_il)
    select id, 'Bozza', 'nessuna', now() - interval '3 days' from m where n = 3$$),
  'agente: non cambia, non cancella e non sceglie la data delle bozze');
reset role;

-- Telefono e visitatori non vedono né vista né bozze.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.supporto_per_agente$$)
  and pg_temp.rifiutato($$select * from public.supporto_bozze$$), 'agente: il telefono non vede vista e bozze');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.supporto_per_agente$$)
  and pg_temp.rifiutato($$select * from public.supporto_bozze$$), 'agente: chi non ha fatto l''accesso non vede nulla');
reset role;

-- Il server legge le bozze; la bozza si cancella con il messaggio (account cancellato).
set local role service_role;
select pg_temp.ok((select count(*) from public.supporto_bozze) = 2
  and (select con_istruzioni from public.supporto_bozze b join m on m.id = b.messaggio_id where m.n = 4),
  'agente: il server legge le 2 bozze e la nota «testo con istruzioni»');
reset role;
delete from auth.users where id = pg_temp.p(1);
select pg_temp.ok((select count(*) from public.supporto_bozze) = 1, 'agente: la bozza sparisce con l''account');
rollback;
