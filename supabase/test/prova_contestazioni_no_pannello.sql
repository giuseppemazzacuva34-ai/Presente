-- Test delle contestazioni dei «No» nel pannello di chi decide (issue #6, spec v1.3 del CPO del 22/11, punto 2; D51 A).
--   - le legge e le decide solo un moderatore, mai la persona stessa;
--   - il pannello vede chi contesta (come per i ricorsi), la domanda, il testo, quanti «No» copre;
--     mai chi ha risposto «No» né quale incontro;
--   - una decisione sola; dopo la decisione esce dall'elenco.
-- Linea «sviluppatore-b». Dati inventati, Postgres di prova.
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

begin;
insert into auth.users (id, email) values
  ('3a3a3a3a-0000-4000-8000-00000000003a', 'pa@example.com'), ('3c3c3c3c-0000-4000-8000-00000000003c', 'pc@example.com'),
  ('3d3d3d3d-0000-4000-8000-00000000003d', 'pd@example.com'), ('3e3e3e3e-0000-4000-8000-00000000003e', 'pe@example.com');
insert into public.profili (id, nome) values ('3a3a3a3a-0000-4000-8000-00000000003a', 'Anna'),
  ('3c3c3c3c-0000-4000-8000-00000000003c', 'Ciro'), ('3d3d3d3d-0000-4000-8000-00000000003d', 'Dino');
-- Giuseppe di prova (3e) è moderatore; anche Anna lo è, ma non decide la sua contestazione.
insert into public.moderatori (persona) values ('3e3e3e3e-0000-4000-8000-00000000003e'), ('3a3a3a3a-0000-4000-8000-00000000003a');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('8e8e8e8e-0000-4000-8000-000000000008', 'italia', now() - interval '720 hours', now() - interval '552 hours');
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select ('8f8f8f8f-0000-4000-8000-0000000000' || s)::uuid, '8e8e8e8e-0000-4000-8000-000000000008',
         '3a3a3a3a-0000-4000-8000-00000000003a', b, now() - interval '30 days'
  from (values ('3c', '3c3c3c3c-0000-4000-8000-00000000003c'::uuid), ('3d', '3d3d3d3d-0000-4000-8000-00000000003d')) v(s, b);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, checkin_a_il, checkin_b_il, esito, esito_il)
  select ('8f8f8f8f-0000-4000-8000-0000000000' || s)::uuid, now(), 'concluso', now() - interval '3 days', 'Bar della piazza',
         now() - interval '3 days', now() - interval '3 days', 'avvenuto', now() - interval '3 days'
  from (values ('3c'), ('3d')) v(s);
-- Ciro e Dino dicono «foto non sue» su Anna; Anna ha risposto su entrambi.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('8f8f8f8f-0000-4000-8000-00000000003c', '3c3c3c3c-0000-4000-8000-00000000003c', '3a3a3a3a-0000-4000-8000-00000000003a', 'si', 'no', 'si', true, now() - interval '3 days'),
  ('8f8f8f8f-0000-4000-8000-00000000003c', '3a3a3a3a-0000-4000-8000-00000000003a', '3c3c3c3c-0000-4000-8000-00000000003c', 'si', 'si', 'si', true, now() - interval '2 days'),
  ('8f8f8f8f-0000-4000-8000-00000000003d', '3d3d3d3d-0000-4000-8000-00000000003d', '3a3a3a3a-0000-4000-8000-00000000003a', 'si', 'no', 'si', true, now() - interval '3 days'),
  ('8f8f8f8f-0000-4000-8000-00000000003d', '3a3a3a3a-0000-4000-8000-00000000003a', '3d3d3d3d-0000-4000-8000-00000000003d', 'si', 'si', 'si', true, now() - interval '2 days');

set local role service_role;
select pg_temp.ok(public.contesta_no('3a3a3a3a-0000-4000-8000-00000000003a', 'foto_sue', 'Sono proprio io, foto di quest''anno.') = 'inviata',
  'pannello: contestazione di prova inviata');

-- Elenco: solo moderatori.
select pg_temp.ok(pg_temp.rifiutato($q$select * from public.contestazioni_no_da_decidere('3c3c3c3c-0000-4000-8000-00000000003c')$q$),
  'pannello: chi non è moderatore non legge le contestazioni');
create temp table e on commit drop as
  select * from public.contestazioni_no_da_decidere('3e3e3e3e-0000-4000-8000-00000000003e');
select pg_temp.ok((select count(*) = 1 from e), 'pannello: una contestazione in attesa');
select pg_temp.ok((select nome = 'Anna' and domanda = 'foto_sue' and testo = 'Sono proprio io, foto di quest''anno.'
  and quanti_no = 2 and inviata_il is not null and not tua from e), 'pannello: nome di chi contesta, domanda, testo, quanti «No»');
select pg_temp.ok((select to_jsonb(e)::text not like '%3c3c3c3c%' and to_jsonb(e)::text not like '%3d3d3d3d%'
  and to_jsonb(e)::text not like '%Ciro%' and to_jsonb(e)::text not like '%Dino%' and to_jsonb(e)::text not like '%8f8f8f8f%' from e),
  'pannello: mai chi ha risposto «No» né quale incontro');
select pg_temp.ok((select tua from public.contestazioni_no_da_decidere('3a3a3a3a-0000-4000-8000-00000000003a')),
  'pannello: la propria contestazione è segnata come «tua»');

-- Decisione: solo un moderatore, mai la persona stessa, una volta sola.
select pg_temp.ok(public.decidi_contestazione_no((select id from e), '3c3c3c3c-0000-4000-8000-00000000003c', true) = 'non_moderatore',
  'decisione: chi non è moderatore non decide');
select pg_temp.ok(public.decidi_contestazione_no((select id from e), '3a3a3a3a-0000-4000-8000-00000000003a', true) = 'propria',
  'decisione: nessuno decide la propria contestazione');
select pg_temp.ok((select stato = 'in_attesa' from public.contestazioni_no where id = (select id from e)),
  'decisione: dopo i due rifiuti resta in attesa');
select pg_temp.ok(public.decidi_contestazione_no((select id from e), '3e3e3e3e-0000-4000-8000-00000000003e', false) = 'respinta',
  'decisione: respinta dal moderatore');
select pg_temp.ok((select deciso_da = '3e3e3e3e-0000-4000-8000-00000000003e' from public.contestazioni_no where id = (select id from e)),
  'decisione: resta scritto chi ha deciso');
select pg_temp.ok((select count(*) = 0 from public.contestazioni_no_da_decidere('3e3e3e3e-0000-4000-8000-00000000003e')),
  'pannello: decisa, esce dall''elenco');
reset role;

-- Il telefono non legge l'elenco.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($q$select * from public.contestazioni_no_da_decidere('3e3e3e3e-0000-4000-8000-00000000003e')$q$),
  'telefono: elenco delle contestazioni solo dal server');
reset role;
rollback;
