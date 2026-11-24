-- Test dei motivi di «Lascia la stanza» per il pannello di chi decide (issue #381, spec v1 del CPO del 23/11, «Dati»:
-- «Li legge solo l'amministratore nel pannello, per migliorare l'app»; «il codice del motivo resta, senza nome, nel
-- conteggio per il riepilogo #8»). Linea «sviluppatore-b», passo 6a. Si esegue con scripts/test_supabase.sh. Dati inventati.
-- motivi_uscite(moderatore) → righe (settimana, motivo, quante, testi): solo conteggi per settimana della stanza e
-- motivo, più i testi liberi ancora presenti, MAI persona, nome o stanza. Solo chi è nella tabella «moderatori».
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
  select ('1a5c4d5c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) values (pg_temp.p(9), 'moderatore-motivi@example.com');
insert into public.moderatori (persona) values (pg_temp.p(9));
-- Stanza A: aperta 3 settimane fa. Stanze B e C: aperte insieme 2 settimane fa. Stanza D: 12 settimane fa (fuori dalle
-- ultime 8 settimane). La settimana è il giorno di apertura della stanza, ora di Roma.
create temp table sett on commit drop as select (now() - interval '3 weeks') as a, (now() - interval '2 weeks') as b;
create function pg_temp.giorno(t timestamptz) returns date language sql stable as $$ select (t at time zone 'Europe/Rome')::date $$;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('1a5c4d5c-5555-4000-8000-00000000000a', 'italia', (select a from sett), (select a from sett) + interval '6 days 12 hours'),
  ('1a5c4d5c-5555-4000-8000-00000000000b', 'italia', (select b from sett), (select b from sett) + interval '6 days 12 hours'),
  ('1a5c4d5c-5555-4000-8000-00000000000c', 'italia', (select b from sett), (select b from sett) + interval '6 days 12 hours'),
  ('1a5c4d5c-5555-4000-8000-00000000000d', 'italia', now() - interval '12 weeks', now() - interval '12 weeks' + interval '6 days 12 hours');
insert into public.lasciate_stanza (persona, stanza_id, motivo, testo) values
  (pg_temp.p(1), '1a5c4d5c-5555-4000-8000-00000000000a', 'tempo', null),
  (pg_temp.p(2), '1a5c4d5c-5555-4000-8000-00000000000a', 'tempo', null),
  (pg_temp.p(3), '1a5c4d5c-5555-4000-8000-00000000000a', 'altro', 'Troppe notifiche'),
  (pg_temp.p(4), '1a5c4d5c-5555-4000-8000-00000000000b', 'altro', null),  -- testo già tolto dalla pulizia dei 30 giorni
  (pg_temp.p(5), '1a5c4d5c-5555-4000-8000-00000000000c', 'altro', 'Orari scomodi'),
  (pg_temp.p(6), '1a5c4d5c-5555-4000-8000-00000000000c', 'app', null),
  (pg_temp.p(7), '1a5c4d5c-5555-4000-8000-00000000000d', 'persone', null);

-- 0. Il telefono e la chiave anon non la lanciano; chi non è moderatore è rifiutato anche dal server.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.motivi_uscite('1a5c4d5c-0000-4000-8000-000000000009')$$),
  'motivi uscite: il telefono non legge i motivi');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.motivi_uscite('1a5c4d5c-0000-4000-8000-000000000009')$$),
  'motivi uscite: la chiave anon non legge i motivi');
reset role;
set local role service_role;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.motivi_uscite('1a5c4d5c-0000-4000-8000-000000000001')$$),
  'motivi uscite: chi non è moderatore è rifiutato');

-- 1. Conteggi per settimana della stanza e motivo.
create temp table r on commit drop as select * from public.motivi_uscite(pg_temp.p(9));
reset role;
select pg_temp.ok((select quante from r where settimana = pg_temp.giorno((select a from sett)) and motivo = 'tempo') = 2,
  'motivi uscite: 2 «tempo» nella settimana di A');
select pg_temp.ok((select quante from r where settimana = pg_temp.giorno((select b from sett)) and motivo = 'altro') = 2,
  'motivi uscite: 2 «altro» nella settimana di B e C (due stanze diverse insieme, anche senza testo)');
select pg_temp.ok((select quante from r where settimana = pg_temp.giorno((select b from sett)) and motivo = 'app') = 1,
  'motivi uscite: 1 «app» nella settimana di B e C');
select pg_temp.ok((select count(*) from r) = 4, 'motivi uscite: 4 righe (solo le combinazioni che ci sono)');

-- 2. Solo le ultime 8 settimane.
select pg_temp.ok(not exists (select 1 from r where motivo = 'persone'), 'motivi uscite: niente oltre 8 settimane fa');

-- 3. I testi liberi ancora presenti, senza chi li ha scritti; quelli già tolti non compaiono.
select pg_temp.ok((select testi from r where settimana = pg_temp.giorno((select b from sett)) and motivo = 'altro') = array['Orari scomodi'],
  'motivi uscite: solo il testo rimasto, quello cancellato dopo 30 giorni no');
select pg_temp.ok((select testi from r where settimana = pg_temp.giorno((select a from sett)) and motivo = 'tempo') = '{}'::text[],
  'motivi uscite: nessun testo per i motivi diversi da «altro»');

-- 4. Nessuna colonna con persona, nome o stanza.
select pg_temp.ok((select array_agg(attname::text order by attnum) from pg_attribute
                   where attrelid = 'r'::regclass and attnum > 0 and not attisdropped)
                  = array['settimana', 'motivo', 'quante', 'testi'],
  'motivi uscite: solo settimana, motivo, quante e testi (mai persona o stanza)');
rollback;
