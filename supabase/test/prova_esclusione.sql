-- Test dell'esclusione definitiva (issue #7, spec v1.1 definitiva, «Regole» › Esclusione definitiva: «account chiuso;
-- l'email non può iscriversi di nuovo»; Casi limite › «Segnalazione di chi ha eliminato l'account: se serve
-- un'esclusione, la sua email resta in una lista di esclusione (solo l'impronta, non l'email in chiaro)»).
-- Linea «sviluppatore-b», passo 15a. Si esegue con scripts/test_supabase.sh. Dati inventati.
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
  select ('e5c1e5c1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'esc' || n || '@example.com' from generate_series(1, 9) n;
insert into public.moderatori (persona) values (pg_temp.p(8)), (pg_temp.p(9));

-- Il telefono non vede la lista di esclusione.
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.p(1), 'role', 'authenticated')::text, true);
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.esclusioni_email$$)
  and pg_temp.rifiutato($$select * from public.impronte_in_attesa$$),
  'esclusione: il telefono non legge la lista né le impronte in attesa');
reset role;

-- 1. Esclusione decisa da una persona → l'impronta dell'email entra nella lista, mai l'email in chiaro.
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'minacce_pericolo', 'scheda', null, false) as s1 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'esclusione', 'Sicurezza', 'minacce ripetute') as z1 \gset
reset role;
select pg_temp.ok((select count(*) from public.esclusioni_email where sanzione_id = :'z1') = 1,
  'esclusione: l''impronta entra nella lista');
select pg_temp.ok(not exists (select 1 from public.esclusioni_email where impronta like '%@%' or impronta ilike '%esc2%'),
  'esclusione: nella lista c''è solo l''impronta, mai l''email in chiaro');
select pg_temp.ok((select impronta from public.esclusioni_email where sanzione_id = :'z1')
  = public.impronta_email('  ESC2@Example.com '), 'esclusione: l''impronta non dipende da maiuscole e spazi');

-- 2. L'account esiste ancora: la persona può entrare (messaggio, ricorso, eliminazione) ma resta fuori da tutto.
select pg_temp.ok(public.sospeso(pg_temp.p(2)), 'esclusione: la persona è fuori da stanze, chiamate e chiavi');

-- 3. Elimina l'account e prova a iscriversi di nuovo con la stessa email (anche scritta diversa): rifiutato.
delete from auth.users where id = pg_temp.p(2);
select pg_temp.ok(pg_temp.rifiutato($$insert into auth.users (id, email) values ('e5c1e5c1-0000-4000-8000-000000000102', 'Esc2@example.com')$$),
  'esclusione: la stessa email non può iscriversi di nuovo');
select pg_temp.ok(not pg_temp.rifiutato($$insert into auth.users (id, email) values ('e5c1e5c1-0000-4000-8000-000000000103', 'nuova3@example.com')$$),
  'esclusione: un''altra email si iscrive normalmente');

-- 4. Chi elimina l'account con una segnalazione ancora aperta: l'impronta resta in attesa; se poi arriva l'esclusione
--    entra nella lista; se la segnalazione si chiude senza esclusione, l'impronta in attesa si cancella.
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'sembra_minorenne', 'scheda', null, false) as s3 \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(4), 'insulti', 'scheda', null, false) as s4 \gset
reset role;
delete from auth.users where id in (pg_temp.p(3), pg_temp.p(4), pg_temp.p(5));
select pg_temp.ok((select count(*) from public.impronte_in_attesa where persona in (pg_temp.p(3), pg_temp.p(4))) = 2,
  'esclusione: chi ha segnalazioni aperte e elimina l''account lascia l''impronta in attesa');
select pg_temp.ok(not exists (select 1 from public.impronte_in_attesa where persona = pg_temp.p(5)),
  'esclusione: chi non ha segnalazioni aperte non lascia nessuna impronta');
set local role service_role;
select public.decidi_segnalazione(pg_temp.p(9), :'s3', 'esclusione', 'Maggiore età', 'sembra minorenne') as z3 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s4', 'archivia', null, 'nessuna violazione');
reset role;
select pg_temp.ok(exists (select 1 from public.esclusioni_email where sanzione_id = :'z3' and impronta = public.impronta_email('esc3@example.com')),
  'esclusione: dopo l''eliminazione l''impronta in attesa entra nella lista');
select pg_temp.ok(not exists (select 1 from public.impronte_in_attesa where persona in (pg_temp.p(3), pg_temp.p(4))),
  'esclusione: nessuna impronta resta in attesa dopo la decisione');
select pg_temp.ok(pg_temp.rifiutato($$insert into auth.users (id, email) values ('e5c1e5c1-0000-4000-8000-000000000104', 'esc3@example.com')$$)
  and not pg_temp.rifiutato($$insert into auth.users (id, email) values ('e5c1e5c1-0000-4000-8000-000000000105', 'esc4@example.com')$$),
  'esclusione: l''esclusa non rientra, l''archiviata sì');

-- 5. Ricorso accolto sull'esclusione → l'impronta esce dalla lista e l'email può iscriversi di nuovo.
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(6), 'diffusione_immagini', 'scheda', null, false) as s6 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s6', 'esclusione', 'Immagini', 'diffuse') as z6 \gset
reset role;
select set_config('request.jwt.claims', json_build_object('sub', pg_temp.p(6), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.nuovo_ricorso(:'z6', 'Non sono stato io.');
reset role;
select id as r6 from public.ricorsi where sanzione_id = :'z6' \gset
set local role service_role;
select public.decidi_ricorso(pg_temp.p(8), :'r6', 'accolto', 'prova non sufficiente');
reset role;
select pg_temp.ok(not exists (select 1 from public.esclusioni_email where sanzione_id = :'z6'),
  'esclusione: con il ricorso accolto l''impronta esce dalla lista');
delete from auth.users where id = pg_temp.p(6);
select pg_temp.ok(not pg_temp.rifiutato($$insert into auth.users (id, email) values ('e5c1e5c1-0000-4000-8000-000000000106', 'esc6@example.com')$$),
  'esclusione: dopo il ricorso accolto la stessa email si iscrive di nuovo');
rollback;
