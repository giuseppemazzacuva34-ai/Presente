-- Test del pannello di chi decide (issue #7, spec v1.1 definitiva, «Cosa vede chi decide»; D51 A).
-- Linea «sviluppatore-b», passo 13a. Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh. Dati inventati.
-- Spec: elenco delle segnalazioni aperte per priorità e scadenza; per ognuna chi segnala, chi è segnalato, motivo,
-- testo, quando e i fatti (chiamate tra i due, porta e svelamento, storico di 6 mesi della persona segnalata).
-- Mai diario, questionario, «la richiameresti?», foto. Solo l'amministratore legge; ogni apertura va nel registro.
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
  select ('b13b13b1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'pan' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome) values (pg_temp.p(1), 'Anna'), (pg_temp.p(2), 'Bruno'), (pg_temp.p(3), 'Carla');
-- p(9) è chi decide (in beta Giuseppe): lo aggiunge a mano chi gestisce il database, mai l'app.
insert into public.moderatori (persona) values (pg_temp.p(9));

set local role service_role;
-- Una chiamata tra Anna e Bruno finita con «Chiudi e segnala» (porte e svelamenti: stessa forma, dalla tabella della #5).
insert into public.chiamate (chi, con, inizio, durata, esito) values (pg_temp.p(1), pg_temp.p(2), now() - interval '2 hours', 300, 'chiudi_e_segnala');
-- Segnalazioni: una da 72 ore creata prima, una da 1 ora creata dopo (deve venire prima), una già decisa.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'altro', 'scheda', 'racconto lungo', false) as s72 \gset
update public.segnalazioni set creata_il = now() - interval '70 hours', scade_il = now() + interval '2 hours' where id = :'s72';
select public.nuova_segnalazione(pg_temp.p(3), pg_temp.p(2), 'minacce_pericolo', 'dopo_chiamata', 'mi ha spaventata', false) as s1 \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'soldi', 'scheda', null, false) as sd \gset
select public.decidi_segnalazione(pg_temp.p(9), :'sd', 'archivia', null, 'niente di vero') is null as archiviata \gset

-- 1. Solo chi è nella tabella dei moderatori legge la coda e le schede.
select pg_temp.ok(pg_temp.rifiutato(format($$select * from public.coda_moderazione(%L)$$, pg_temp.p(4))),
  'pannello: chi non è moderatore non legge la coda');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.scheda_segnalazione(%L, %L)$$, pg_temp.p(4), :'s1')),
  'pannello: chi non è moderatore non apre una segnalazione');
select pg_temp.ok(public.e_moderatore(pg_temp.p(9)) and not public.e_moderatore(pg_temp.p(4)) and not public.e_moderatore(null),
  'pannello: e_moderatore dice chi decide');
reset role;
select pg_temp.come(pg_temp.p(9));
select pg_temp.ok(pg_temp.rifiutato(format($$select * from public.coda_moderazione(%L)$$, pg_temp.p(9))),
  'pannello: dal telefono neanche il moderatore legge la coda (passa solo dal server)');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.moderatori$$), 'pannello: il telefono non legge chi è moderatore');
reset role;

-- 2. La coda: solo le aperte, prima la priorità più alta, poi la scadenza; senza il racconto (si legge aprendo).
set local role service_role;
select pg_temp.ok((select count(*) from public.coda_moderazione(pg_temp.p(9))) = 2, 'coda: solo le segnalazioni aperte');
select pg_temp.ok((select array_agg(id order by n) from (select id, row_number() over () n from public.coda_moderazione(pg_temp.p(9))) x)
  = array[:'s1', :'s72']::uuid[], 'coda: prima la priorità da 1 ora, poi quella da 72 ore');
select pg_temp.ok((select ore = 1 and nome_da = 'Carla' and nome_contro = 'Bruno' and sospeso and not aperta
    from public.coda_moderazione(pg_temp.p(9)) where id = :'s1'),
  'coda: ore di priorità, nomi, sospensione cautelare in corso, non ancora aperta');
select pg_temp.ok((select archiviate_di_chi_segnala = 1 from public.coda_moderazione(pg_temp.p(9)) where id = :'s72'),
  'coda: si vede quante segnalazioni di chi segnala sono state archiviate (abuso del pulsante)');
reset role;
select pg_temp.ok((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'coda_moderazione')
  = 'TABLE(id uuid, motivo text, origine text, ore integer, creata_il timestamp with time zone, scade_il timestamp with time zone, aperta boolean, nome_da text, nome_contro text, sospeso boolean, archiviate_di_chi_segnala integer)',
  'coda: solo i campi previsti, nessun racconto nell''elenco');

-- 3. La scheda: segnalazione, fatti e storico; l'apertura resta nel registro.
set local role service_role;
select public.scheda_segnalazione(pg_temp.p(9), :'s72') as scheda \gset
select pg_temp.ok((:'scheda'::jsonb -> 'segnalazione' ->> 'testo') = 'racconto lungo'
    and (:'scheda'::jsonb -> 'segnalazione' ->> 'nome_da') = 'Anna'
    and (:'scheda'::jsonb -> 'segnalazione' ->> 'nome_contro') = 'Bruno',
  'scheda: racconto e nomi di chi segnala e di chi è segnalato');
select pg_temp.ok(jsonb_array_length(:'scheda'::jsonb -> 'chiamate') = 1
    and (:'scheda'::jsonb -> 'chiamate' -> 0 ->> 'esito') = 'chiudi_e_segnala'
    and (:'scheda'::jsonb -> 'chiamate' -> 0 ->> 'durata')::int = 300,
  'scheda: le chiamate tra i due con durata e come è finita');
select pg_temp.ok(jsonb_array_length(:'scheda'::jsonb -> 'storico' -> 'segnalazioni') = 2
    and jsonb_array_length(:'scheda'::jsonb -> 'storico' -> 'sanzioni') = 0,
  'scheda: storico di 6 mesi della persona segnalata');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'scheda'::jsonb) k)
    = array['chiamate', 'porte', 'segnalazione', 'storico'],
  'scheda: solo segnalazione, chiamate, porte e storico (mai diario, questionario, «la richiameresti?», foto)');
select pg_temp.ok((select count(*) from public.registro_moderazione where segnalazione_id = :'s72' and azione = 'apertura' and chi = pg_temp.p(9)) = 1
    and (select aperta_il is not null from public.segnalazioni where id = :'s72'),
  'scheda: l''apertura resta nel registro (chi, quando, cosa)');
select pg_temp.ok((select aperta from public.coda_moderazione(pg_temp.p(9)) where id = :'s72'), 'coda: dopo l''apertura risulta aperta');
reset role;
select pg_temp.ok(not exists (select 1 from regexp_matches(pg_get_functiondef('public.scheda_segnalazione(uuid, uuid)'::regprocedure),
    'diario|questionario|richiameresti|foto', 'g')),
  'scheda: la funzione non legge mai diario, questionario, «la richiameresti?» né foto');

rollback;
