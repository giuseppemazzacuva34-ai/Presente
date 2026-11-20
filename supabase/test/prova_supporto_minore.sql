-- Test del caso «possibile minore» nei messaggi «Scrivici» (issue #10, parte B v1.1 del CPO, 20/11; D122 B).
-- Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: un messaggio con parole di minore età non riceve bozza dall'agente e va in cima alla coda di chi risponde,
-- come la bandiera «sicurezza». All'utente non cambia nulla (la riga del 112 resta solo per le parole di pericolo).
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

-- Le parole: 3 casi di minore età riconosciuti, frasi normali no.
select pg_temp.ok(public.parole_minore('Ciao, ho 16 anni, posso iscrivermi?')
  and public.parole_minore('sono MINORENNE ma mi piace l''app')
  and public.parole_minore('Ho diciassette anni e la stanza non si apre'),
  'minore: «ho 16 anni», «minorenne», «diciassette anni» riconosciuti');
select pg_temp.ok(not public.parole_minore('Ho 34 anni e non vedo i crediti')
  and not public.parole_minore('ho 2 chiavi e 16 crediti')
  and not public.parole_minore('Mia figlia ha 18 anni'),
  'minore: età adulte e numeri di crediti non fanno scattare il caso');

begin;
insert into auth.users (id, email) values (pg_temp.p(1), 'mi1@example.com');
create temp table m (n integer primary key, esito jsonb) on commit drop;
grant insert, select on m to service_role;
grant select on m to agente_supporto;
set local role service_role;
insert into m values
  (1, public.invia_supporto(pg_temp.p(1), 'account', 'Ho 15 anni, come cancello l''account?')),
  (2, public.invia_supporto(pg_temp.p(1), 'crediti', 'Dove vedo i crediti?'));
reset role;

select pg_temp.ok((select (esito ->> 'sicurezza')::boolean from m where n = 1) = false,
  'minore: all''utente non compare la riga del 112 (bandiera di pericolo spenta)');
select pg_temp.ok((select minore from public.supporto where id = (select (esito ->> 'id')::uuid from m where n = 1))
  and not (select minore from public.supporto where id = (select (esito ->> 'id')::uuid from m where n = 2)),
  'minore: il messaggio è segnato «possibile minore» nel database');

set local role agente_supporto;
select pg_temp.ok((select v.sicurezza from public.supporto_per_agente v where v.id = (select (esito ->> 'id')::uuid from m where n = 1)),
  'minore: per l''agente il messaggio è da non toccare (bandiera accesa)');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select (esito ->> 'id')::uuid, 'Bozza', 'nessuna' from m where n = 1$$),
  'minore: l''agente non può scrivere la bozza');
reset role;

set local role service_role;
select pg_temp.ok((select c.id from public.coda_supporto() c limit 1) = (select (esito ->> 'id')::uuid from m where n = 1)
  and (select c.sicurezza from public.coda_supporto() c limit 1),
  'minore: in cima alla coda di chi risponde, come priorità');
reset role;
rollback;
