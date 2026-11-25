-- Test di lasciate_recenti() (issue #381, spec v1 del CPO del 23/11, «Cosa vedono gli altri»): al posto di chi ha
-- lasciato la stanza, per 24 ore, un posto vuoto con «Ha lasciato la stanza». Richiesta del CTO (plancia 24/11) per
-- agganciarla a stati_stanza (#380). Linea «sviluppatore-b», passo 3. Dati inventati.
-- Regole: solo i posti lasciati nelle ultime 24 ore; per ogni posto solo il numero (1, 2, … in ordine di uscita) e la
-- metà del cerchio (uomini / donne / altre), mai chi, mai il motivo, mai l'ora; la legge chi è nella stanza (e non
-- l'ha lasciata) oppure il server; per chi guarda, solo i posti delle persone che vedeva (compatibili, senza blocchi).
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
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('1a5c2b5c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- Il server: chiave service_role, nel token nessun «sub».
create function pg_temp.server() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  execute 'set local role service_role';
end $$;
-- I posti vuoti come testo «numero:posto», in ordine.
create function pg_temp.posti(chi uuid, stanza uuid) returns text language plpgsql as $$
declare r text;
begin
  if chi is not null then perform pg_temp.come(chi); else perform pg_temp.server(); end if;
  select coalesce(string_agg(numero || ':' || posto, ',' order by numero), '') into r from public.lasciate_recenti(stanza);
  reset role;
  return r;
end $$;

begin;
-- Stanza A aperta: Ada (1), Bea (2), Cia (3) donne; Ugo (4), Leo (5), Max (6) uomini; Nic (7) non binario (cerca tutti).
-- Tutte le donne e gli uomini cercano il sesso opposto; Nic è compatibile solo con chi cerca «tutti»: nessuno qui.
-- Zoe (8) è in un'altra stanza aperta B.
insert into auth.users (id, email) select pg_temp.p(n), 'recenti' || n || '@example.com' from generate_series(1, 8) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Ada', '1990-01-01', 'MI', 'donna'), (pg_temp.p(2), 'Bea', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(3), 'Cia', '1990-01-01', 'MI', 'donna'), (pg_temp.p(4), 'Ugo', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(5), 'Leo', '1990-01-01', 'MI', 'uomo'), (pg_temp.p(6), 'Max', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(7), 'Nic', '1990-01-01', 'MI', 'non_binario'), (pg_temp.p(8), 'Zoe', '1990-01-01', 'MI', 'donna');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select id, case mi_presento_come when 'uomo' then '{donne}' when 'donna' then '{uomini}' else '{donne,uomini,non_binari}' end::text[], now(), '1.5', 25, 50, 'italia'
  from public.profili where id in (select pg_temp.p(n) from generate_series(1, 8) n);
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('1a5c2b5c-5555-4000-8000-00000000000a', 'italia', now() - interval '3 days', now() + interval '3 days'),
  ('1a5c2b5c-5555-4000-8000-00000000000b', 'italia', now() - interval '3 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select '1a5c2b5c-5555-4000-8000-00000000000a', pg_temp.p(n) from generate_series(1, 7) n;
insert into public.membri_stanza (stanza_id, utente_id) values ('1a5c2b5c-5555-4000-8000-00000000000b', pg_temp.p(8));

\set A '\'1a5c2b5c-5555-4000-8000-00000000000a\''
-- 0. Prima che qualcuno esca: nessun posto vuoto.
select pg_temp.ok(pg_temp.posti(pg_temp.p(1), :A) = '' and pg_temp.posti(null, :A) = '', 'recenti: nessuno è uscito → nessun posto vuoto');

-- Escono: Leo (uomo) 30 ore fa, Bea (donna) 5 ore fa, Max (uomo) 1 ora fa, Nic (non binario) 10 minuti fa.
-- Le righe si scrivono a mano con l'ora del passato (la funzione lascia_stanza è provata in prova_lascia_stanza.sql).
insert into public.lasciate_stanza (persona, stanza_id, motivo, testo, quando) values
  (pg_temp.p(5), :A, 'tempo', null, now() - interval '30 hours'),
  (pg_temp.p(2), :A, 'altro', 'Testo che nessuno deve vedere', now() - interval '5 hours'),
  (pg_temp.p(6), :A, 'persone', null, now() - interval '1 hour'),
  (pg_temp.p(7), :A, 'app', null, now() - interval '10 minutes');

-- 1. Il server: tutti i posti lasciati nelle ultime 24 ore, in ordine di uscita, con la metà del cerchio.
select pg_temp.ok(pg_temp.posti(null, :A) = '1:donne,2:uomini,3:altre',
  'recenti: il server vede i posti lasciati nelle ultime 24 ore (non quello di 30 ore fa), in ordine, con la metà del cerchio');

-- 2. Chi guarda vede solo i posti delle persone che vedeva: Ada (donna, cerca uomini) vede solo Max; Ugo (uomo,
--    cerca donne) solo Bea. Il posto di Nic non lo vede nessuno dei due (non compatibili).
select pg_temp.ok(pg_temp.posti(pg_temp.p(1), :A) = '1:uomini', 'recenti: Ada vede solo il posto lasciato da un uomo che vedeva');
select pg_temp.ok(pg_temp.posti(pg_temp.p(4), :A) = '1:donne', 'recenti: Ugo vede solo il posto lasciato da una donna che vedeva');

-- 3. Mai chi, mai il motivo, mai l'ora: il risultato ha solo le colonne numero e posto.
select pg_temp.ok((select array_agg(a.attname::text order by a.attnum) from pg_proc f
                   join pg_type t on t.oid = f.prorettype join pg_attribute a on a.attrelid = t.typrelid
                   where f.proname = 'lasciate_recenti' and a.attnum > 0) is null
  and (select array_agg(n order by o) from pg_proc f, unnest(f.proargnames, f.proargmodes) with ordinality as x(n, m, o)
       where f.proname = 'lasciate_recenti' and m = 't') = array['numero', 'posto'],
  'recenti: il risultato ha solo numero e posto (niente persona, motivo, testo o ora)');

-- 4. Chi non è nella stanza (Zoe), chi l'ha lasciata (Bea) e la chiave anon non leggono niente.
select pg_temp.ok(pg_temp.posti(pg_temp.p(8), :A) = '', 'recenti: chi è in un''altra stanza non vede niente');
select pg_temp.ok(pg_temp.posti(pg_temp.p(2), :A) = '', 'recenti: chi ha lasciato la stanza non vede più niente');
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.lasciate_recenti('1a5c2b5c-5555-4000-8000-00000000000a')$$),
  'recenti: la chiave anon non può chiamare la funzione');
reset role;

-- 5. Un blocco nasconde anche il posto vuoto: Ada blocca Max → Ada non vede più il suo posto.
insert into public.blocchi (chi, bloccato) values (pg_temp.p(1), pg_temp.p(6));
select pg_temp.ok(pg_temp.posti(pg_temp.p(1), :A) = '', 'recenti: con un blocco il posto vuoto non si vede');

-- 6. Il telefono non può chiedere per conto di un altro: il secondo parametro vale solo per il server.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok((select count(*) from public.lasciate_recenti(:A, pg_temp.p(4))) = 0,
  'recenti: dal telefono il parametro «per» non conta (vale chi ha il token)');
reset role;
select pg_temp.server();
select pg_temp.ok((select string_agg(numero || ':' || posto, ',' order by numero) from public.lasciate_recenti(:A, pg_temp.p(4))) = '1:donne',
  'recenti: il server può chiedere i posti come li vede una persona');
reset role;
rollback;
