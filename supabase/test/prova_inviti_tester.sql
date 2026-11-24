-- Test dei codici d'invito del test interno (issue #8, spec v1 del CPO; D154 = B, Giuseppe 24/11). Linea «sviluppatore»
-- (a), passo 1. Si esegue con scripts/test_supabase.sh. Dati inventati: le impronte sono stringhe di prova.
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
create function pg_temp.h(n integer) returns text language sql immutable as $$
  select lpad(to_hex(n), 64, 'a')
$$;

begin;
insert into auth.users (id, email) values
  ('1a5c3c5c-7777-4000-8000-000000000001', 'uno@example.com'),
  ('1a5c3c5c-7777-4000-8000-000000000002', 'due@example.com');

-- Creazione: solo il server, solo impronte esadecimali di 64 caratteri, scadenza fissa del 29/11 23:59 di Roma.
set local role service_role;
select pg_temp.ok(public.crea_inviti_tester(array[pg_temp.h(1), pg_temp.h(2), pg_temp.h(3), pg_temp.h(4)]) = 4,
  'il server crea 4 inviti');
select pg_temp.ok(public.crea_inviti_tester(array[pg_temp.h(1)]) = 0, 'un''impronta già presente non si duplica');
select pg_temp.ok(pg_temp.rifiutato($q$select public.crea_inviti_tester(array['ABCDEFGH23'])$q$),
  'un codice in chiaro (non impronta) è rifiutato');
select pg_temp.ok((select scade from public.inviti_tester where impronta = pg_temp.h(1)) = '2026-11-29 22:59:59.999+00',
  'scadenza 29/11 23:59:59 ora di Roma');
select pg_temp.ok((select count(*) from public.inviti_tester where usato is null and utente is null) = 4,
  'i nuovi inviti non sono usati');

-- Uso: riserva atomica, una sola volta.
select pg_temp.ok(public.riserva_invito_tester(pg_temp.h(1)) is true, 'la prima riserva riesce');
select pg_temp.ok(public.riserva_invito_tester(pg_temp.h(1)) is false, 'la seconda riserva dello stesso codice fallisce');
select pg_temp.ok(public.riserva_invito_tester(pg_temp.h(99)) is false, 'un codice inesistente non si riserva');
select pg_temp.ok(public.conferma_invito_tester(pg_temp.h(1), '1a5c3c5c-7777-4000-8000-000000000001') is true,
  'la conferma lega l''invito all''account');
select pg_temp.ok(public.conferma_invito_tester(pg_temp.h(1), '1a5c3c5c-7777-4000-8000-000000000002') is false,
  'un invito già legato non passa a un altro account');
select pg_temp.ok(public.rilascia_invito_tester(pg_temp.h(1)) is false, 'un invito legato non si rilascia');
select pg_temp.ok(public.conferma_invito_tester(pg_temp.h(2), '1a5c3c5c-7777-4000-8000-000000000002') is false,
  'non si conferma un invito non riservato');

-- Account non creato: la riserva si rilascia e il codice torna usabile.
select pg_temp.ok(public.riserva_invito_tester(pg_temp.h(2)) is true, 'riserva del secondo invito');
select pg_temp.ok(public.rilascia_invito_tester(pg_temp.h(2)) is true, 'riserva rilasciata se l''account non nasce');
select pg_temp.ok(public.riserva_invito_tester(pg_temp.h(2)) is true, 'dopo il rilascio il codice si riserva di nuovo');

-- Scaduto: non si riserva più.
update public.inviti_tester set scade = now() - interval '1 second' where impronta = pg_temp.h(3);
select pg_temp.ok(public.riserva_invito_tester(pg_temp.h(3)) is false, 'un invito scaduto non si riserva');

-- Conteggio: solo numeri.
select pg_temp.ok((select creati from public.conteggio_inviti_tester()) = 4, 'conteggio: 4 creati');
select pg_temp.ok((select usati from public.conteggio_inviti_tester()) = 1, 'conteggio: 1 usato (legato a un account)');
select pg_temp.ok((select scaduti from public.conteggio_inviti_tester()) = 1, 'conteggio: 1 scaduto senza uso');
reset role;

-- Cancellazione dell'account: l'invito resta usato ma senza legame alla persona.
delete from auth.users where id = '1a5c3c5c-7777-4000-8000-000000000001';
select pg_temp.ok((select utente is null and usato is not null from public.inviti_tester where impronta = pg_temp.h(1)),
  'cancellato l''account, l''invito resta usato senza persona');

-- Nessun accesso da browser: né tabella né funzioni.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato('select * from public.inviti_tester'), 'authenticated non legge la tabella');
select pg_temp.ok(pg_temp.rifiutato($q$select public.riserva_invito_tester(lpad('4', 64, 'a'))$q$),
  'authenticated non riserva inviti');
select pg_temp.ok(pg_temp.rifiutato($q$select public.crea_inviti_tester(array[lpad('9', 64, 'a')])$q$),
  'authenticated non crea inviti');
select pg_temp.ok(pg_temp.rifiutato('select * from public.conteggio_inviti_tester()'), 'authenticated non legge i conteggi');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato('select * from public.inviti_tester'), 'anon non legge la tabella');
select pg_temp.ok(pg_temp.rifiutato($q$select public.conferma_invito_tester(lpad('2', 64, 'a'), gen_random_uuid())$q$),
  'anon non conferma inviti');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.inviti_tester'::regclass),
  'regole per riga attive sulla tabella');
rollback;
