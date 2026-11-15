-- Test dell'esito per chi segnala nel database (issue #7, spec v1.1 definitiva, passo 4 «Esito per chi segnala»).
-- Linea «sviluppatore-b». Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova.
-- Dati inventati. Spec: alla chiusura chi ha segnalato riceve in app solo «provvedimenti» o «nessuna violazione»;
-- mai il dettaglio della sanzione, mai chi è segnalato, motivo o racconto. Ognuno vede solo le sue segnalazioni chiuse
-- e non ancora lette; segnata come letta non torna più. Chi è segnalato non vede niente.
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
  select ('e5e5e5e5-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'es' || n || '@example.com' from generate_series(1, 3) n;
-- 1 segnala 2 tre volte: una archiviata, una con provvedimenti, una ancora aperta. 3 segnala 2: chiusa.
insert into public.segnalazioni (id, da, contro, motivo, origine, testo, creata_il, scade_il, esito, chiusa_il) values
  (pg_temp.p(101), pg_temp.p(1), pg_temp.p(2), 'insulti', 'scheda', 'racconto', now() - interval '3 days', now() - interval '2 days', 'archiviata', now() - interval '2 days'),
  (pg_temp.p(102), pg_temp.p(1), pg_temp.p(2), 'soldi', 'scheda', null, now() - interval '2 days', now() - interval '1 day', 'provvedimenti', now() - interval '1 day'),
  (pg_temp.p(103), pg_temp.p(1), pg_temp.p(2), 'altro', 'scheda', null, now() - interval '1 hour', now() + interval '71 hours', null, null),
  (pg_temp.p(104), pg_temp.p(3), pg_temp.p(2), 'insulti', 'scheda', null, now() - interval '1 day', now(), 'provvedimenti', now() - interval '1 hour');

select pg_temp.come(pg_temp.p(1));
select pg_temp.ok((select array_agg(esito order by chiusa_il) from public.miei_esiti_segnalazioni()) = array['archiviata', 'provvedimenti'],
  'esiti: solo le mie segnalazioni chiuse, dalla più vecchia (niente quella aperta né quelle degli altri)');
reset role;
select pg_temp.ok((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'miei_esiti_segnalazioni') = 'TABLE(id uuid, esito text, chiusa_il timestamp with time zone)',
  'esiti: solo id, esito e data (mai chi è segnalato, motivo, racconto o sanzione)');

-- Segnata come letta, non torna più; le altre restano.
select pg_temp.come(pg_temp.p(1));
select public.esito_segnalazione_letto(pg_temp.p(101));
select pg_temp.ok((select array_agg(esito) from public.miei_esiti_segnalazioni()) = array['provvedimenti'],
  'esiti: quella letta non torna più');
-- Non si può segnare come letta una segnalazione di un altro, né una ancora aperta.
select public.esito_segnalazione_letto(pg_temp.p(104));
select public.esito_segnalazione_letto(pg_temp.p(103));
reset role;
select pg_temp.ok((select esito_letto_il from public.segnalazioni where id = pg_temp.p(104)) is null,
  'esiti: non si segna come letta la segnalazione di un altro');
select pg_temp.ok((select esito_letto_il from public.segnalazioni where id = pg_temp.p(103)) is null,
  'esiti: non si segna come letta una segnalazione ancora aperta');

-- Chi è segnalato non vede niente.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok((select count(*) from public.miei_esiti_segnalazioni()) = 0, 'esiti: chi è segnalato non vede niente');
reset role;
-- Il telefono continua a non leggere la tabella.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.segnalazioni$$), 'esiti: la tabella resta chiusa al telefono');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.miei_esiti_segnalazioni()$$), 'esiti: senza accesso nessuna lettura');
select pg_temp.ok(pg_temp.rifiutato($$select public.esito_segnalazione_letto('e5e5e5e5-0000-4000-8000-000000000102')$$),
  'esiti: senza accesso non si segna niente');
reset role;
rollback;
