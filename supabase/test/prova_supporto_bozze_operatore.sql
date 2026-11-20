-- Test delle bozze nel pannello di chi risponde a «Scrivici» (issue #10, parte B v1 del CPO, 13/11; D122 B).
-- Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: Giuseppe vede messaggio + bozza e sceglie «Invia così · Modifica e invia · Scarta e scrivo io».
-- Solo chi è in operatori_supporto legge e scarta le bozze; le bozze dei messaggi già risposti non si vedono più.
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
  select ('7c7c7c7c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) values (pg_temp.p(1), 'bo1@example.com'), (pg_temp.p(9), 'op9@example.com');
insert into public.operatori_supporto (persona) values (pg_temp.p(9));
create temp table m (n integer primary key, esito jsonb) on commit drop;
grant insert, select on m to service_role;
grant select on m to agente_supporto;
set local role service_role;
insert into m values
  (1, public.invia_supporto(pg_temp.p(1), 'chiavi_porte', 'Come funzionano le chiavi?')),
  (2, public.invia_supporto(pg_temp.p(1), 'crediti', 'Dove vedo i crediti?'));
reset role;
set local role agente_supporto;
insert into public.supporto_bozze (messaggio_id, testo, fonte, con_istruzioni)
  select (esito ->> 'id')::uuid, 'Ciao! Hai 2 chiavi a settimana. Il team di Presente', 'FAQ n. 5', true from m where n = 1;
insert into public.supporto_bozze (messaggio_id, testo, fonte)
  select (esito ->> 'id')::uuid, 'Ciao! I crediti sono nel menu. Il team di Presente', 'FAQ n. 9' from m where n = 2;
reset role;

set local role service_role;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.bozze_supporto_operatore('7c7c7c7c-0000-4000-8000-000000000001')$$),
  'bozze: chi non è operatore non le legge');
select pg_temp.ok((select count(*) from public.bozze_supporto_operatore(pg_temp.p(9))) = 2
  and (select b.fonte from public.bozze_supporto_operatore(pg_temp.p(9)) b
       where b.messaggio_id = (select (esito ->> 'id')::uuid from m where n = 1)) = 'FAQ n. 5'
  and (select b.con_istruzioni from public.bozze_supporto_operatore(pg_temp.p(9)) b
       where b.messaggio_id = (select (esito ->> 'id')::uuid from m where n = 1)),
  'bozze: l''operatore vede testo, fonte e nota «testo con istruzioni»');

-- «Scarta e scrivo io»: la bozza sparisce; chi non è operatore non può scartare.
select pg_temp.ok(pg_temp.rifiutato($$select public.scarta_bozza_operatore('7c7c7c7c-0000-4000-8000-000000000001',
    (select (esito ->> 'id')::uuid from m where n = 2))$$),
  'bozze: chi non è operatore non può scartare');
select pg_temp.ok(public.scarta_bozza_operatore(pg_temp.p(9), (select (esito ->> 'id')::uuid from m where n = 2))
  and not public.scarta_bozza_operatore(pg_temp.p(9), (select (esito ->> 'id')::uuid from m where n = 2)),
  'bozze: «Scarta» toglie la bozza (la seconda volta non c''è più niente)');

-- «Invia così»: dopo la risposta la bozza non compare più nel pannello.
select pg_temp.ok(public.rispondi_supporto_operatore(pg_temp.p(9), (select (esito ->> 'id')::uuid from m where n = 1),
    'Ciao! Hai 2 chiavi a settimana. Il team di Presente'), 'bozze: «Invia così» salva la risposta');
-- Istruzione separata: le funzioni «stable» vedono i dati com'erano all'inizio dell'istruzione.
select pg_temp.ok((select count(*) from public.bozze_supporto_operatore(pg_temp.p(9))) = 0,
  'bozze: dopo la risposta la bozza non compare più');
reset role;

select pg_temp.ok(pg_temp.rifiutato($$set local role authenticated; select * from public.bozze_supporto_operatore('7c7c7c7c-0000-4000-8000-000000000009')$$),
  'bozze: il telefono (authenticated) non chiama la funzione');
rollback;
