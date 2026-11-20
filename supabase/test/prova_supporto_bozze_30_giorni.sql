-- Test della cancellazione delle bozze 30 giorni dopo la risposta (issue #10, parte B v1 del CPO, 13/11, «Conservazione»
-- e criterio «Le bozze si cancellano 30 giorni dopo la risposta (test con orologio simulato)»; D122 B).
-- Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
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
  select ('7d7d7d7d-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) values (pg_temp.p(1), 'b30@example.com');
create temp table m (n integer primary key, esito jsonb) on commit drop;
grant insert, select on m to service_role;
grant select on m to agente_supporto;
set local role service_role;
insert into m values
  (1, public.invia_supporto(pg_temp.p(1), 'chiavi_porte', 'Prima domanda')),
  (2, public.invia_supporto(pg_temp.p(1), 'crediti', 'Seconda domanda')),
  (3, public.invia_supporto(pg_temp.p(1), 'altro', 'Terza domanda'));
reset role;
set local role agente_supporto;
insert into public.supporto_bozze (messaggio_id, testo, fonte)
  select (esito ->> 'id')::uuid, 'Ciao! Il team di Presente', 'nessuna' from m;
reset role;
-- 1 e 2 hanno risposta; 3 aspetta ancora. Orologio simulato: date di risposta scritte a mano.
update public.supporto set risposta = 'Risposta', risposto_il = '2026-10-01T10:00:00Z'
  where id = (select (esito ->> 'id')::uuid from m where n = 1);
update public.supporto set risposta = 'Risposta', risposto_il = '2026-10-25T10:00:00Z'
  where id = (select (esito ->> 'id')::uuid from m where n = 2);

select pg_temp.ok(pg_temp.rifiutato($$set local role authenticated; select public.pulisci_bozze_supporto()$$),
  'bozze 30 giorni: il telefono non può chiamare la pulizia');
reset role;
select pg_temp.ok(pg_temp.rifiutato($$set local role agente_supporto; select public.pulisci_bozze_supporto()$$),
  'bozze 30 giorni: l''agente non può chiamare la pulizia');
reset role;

set local role service_role;
select pg_temp.ok(public.pulisci_bozze_supporto('2026-10-31T09:59:00Z') = 0,
  'bozze 30 giorni: a 29 giorni e 23 ore dalla risposta la bozza resta');
select pg_temp.ok(public.pulisci_bozze_supporto('2026-10-31T10:00:00Z') = 1,
  'bozze 30 giorni: a 30 giorni (720 ore, anche col cambio dell''ora legale) la bozza si cancella');
reset role;
select pg_temp.ok(not exists (select 1 from public.supporto_bozze
    where messaggio_id = (select (esito ->> 'id')::uuid from m where n = 1))
  and (select count(*) from public.supporto_bozze
    where messaggio_id in (select (esito ->> 'id')::uuid from m where n in (2, 3))) = 2,
  'bozze 30 giorni: tolta solo quella vecchia; la recente e quella senza risposta restano');
select pg_temp.ok((select risposta from public.supporto
    where id = (select (esito ->> 'id')::uuid from m where n = 1)) = 'Risposta',
  'bozze 30 giorni: il messaggio e la risposta restano (regole della parte A)');
set local role service_role;
select pg_temp.ok(public.pulisci_bozze_supporto('2027-06-01T00:00:00Z') = 1,
  'bozze 30 giorni: dopo mesi si toglie anche la seconda bozza con risposta');
reset role;
select pg_temp.ok((select count(*) from public.supporto_bozze
    where messaggio_id = (select (esito ->> 'id')::uuid from m where n = 3)) = 1,
  'bozze 30 giorni: una bozza senza risposta non si cancella mai da sola');
rollback;
