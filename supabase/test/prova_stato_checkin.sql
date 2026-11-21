-- Test dello stato dell'incontro con il check-in «Sono qui» e il segnale (issue #6, spec v1 del CPO del 3/11, punto 6;
-- passo 2h). stato_incontro dice a ciascuno: se ha fatto il check-in lui e l'altra persona, la finestra del check-in
-- (da 30 minuti prima a 30 minuti dopo l'ora, più il ritardo), il pulsante «sono_qui» solo dentro la finestra e il
-- segnale solo dopo il check-in di entrambi, uguale per tutti e due. Mai l'id dell'altro, mai una posizione.
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
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'qa@example.com'), ('5b5b5b5b-0000-4000-8000-00000000005b', 'qb@example.com'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'qc@example.com'), ('5d5d5d5d-0000-4000-8000-00000000005d', 'qd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('5b5b5b5b-0000-4000-8000-00000000005b', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('5d5d5d5d-0000-4000-8000-00000000005d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000005', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (incontro tra 10 minuti), Bea-Dino (incontro tra 2 ore, poi con ritardo), Anna-Dino (da fissare).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('5f5f5f5f-0000-4000-8000-0000000000ac', '6e6e6e6e-0000-4000-8000-000000000005',
   '5a5a5a5a-0000-4000-8000-00000000005a', '5c5c5c5c-0000-4000-8000-00000000005c', now() - interval '1 hour'),
  ('5f5f5f5f-0000-4000-8000-0000000000bd', '6e6e6e6e-0000-4000-8000-000000000005',
   '5b5b5b5b-0000-4000-8000-00000000005b', '5d5d5d5d-0000-4000-8000-00000000005d', now() - interval '1 hour'),
  ('5f5f5f5f-0000-4000-8000-0000000000ad', '6e6e6e6e-0000-4000-8000-000000000005',
   '5a5a5a5a-0000-4000-8000-00000000005a', '5d5d5d5d-0000-4000-8000-00000000005d', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta(p, 300) from (values ('5a5a5a5a-0000-4000-8000-00000000005a'::uuid),
  ('5b5b5b5b-0000-4000-8000-00000000005b'::uuid), ('5c5c5c5c-0000-4000-8000-00000000005c'::uuid),
  ('5d5d5d5d-0000-4000-8000-00000000005d'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from (values
  ('5f5f5f5f-0000-4000-8000-0000000000ac'::uuid, '5a5a5a5a-0000-4000-8000-00000000005a'::uuid),
  ('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c'),
  ('5f5f5f5f-0000-4000-8000-0000000000bd', '5b5b5b5b-0000-4000-8000-00000000005b'),
  ('5f5f5f5f-0000-4000-8000-0000000000bd', '5d5d5d5d-0000-4000-8000-00000000005d'),
  ('5f5f5f5f-0000-4000-8000-0000000000ad', '5a5a5a5a-0000-4000-8000-00000000005a'),
  ('5f5f5f5f-0000-4000-8000-0000000000ad', '5d5d5d5d-0000-4000-8000-00000000005d')) v(porta, persona);
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('5f5f5f5f-0000-4000-8000-0000000000ac', '5f5f5f5f-0000-4000-8000-0000000000bd',
                     '5f5f5f5f-0000-4000-8000-0000000000ad');
select public.apri_incontro(p) from (values ('5f5f5f5f-0000-4000-8000-0000000000ac'::uuid),
  ('5f5f5f5f-0000-4000-8000-0000000000bd'::uuid), ('5f5f5f5f-0000-4000-8000-0000000000ad'::uuid)) v(p);
-- Incontri già confermati (gli orari vicini a «adesso» non si possono proporre: si scrivono direttamente).
update public.incontri set stato = 'confermato', orario = now() + interval '10 minutes', luogo_libero = 'Bar della piazza',
  proposto_da = '5a5a5a5a-0000-4000-8000-00000000005a', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '5f5f5f5f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '2 hours', luogo_libero = 'Caffè del parco',
  proposto_da = '5b5b5b5b-0000-4000-8000-00000000005b', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '5f5f5f5f-0000-4000-8000-0000000000bd';
reset role;

set local role service_role;
create temp table s (chi text, j jsonb) on commit drop;
-- Confermato ma fuori finestra (tra 2 ore): finestra indicata, nessun pulsante.
insert into s select 'b0', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000bd', '5b5b5b5b-0000-4000-8000-00000000005b');
select pg_temp.ok((select j->'azioni' = '["disdici"]'::jsonb and not (j->>'checkin_mio')::boolean and not (j->>'checkin_altro')::boolean
  and (j->>'checkin_da')::timestamptz = now() + interval '90 minutes'
  and (j->>'checkin_fino')::timestamptz = now() + interval '150 minutes' and j->'segnale' = 'null'::jsonb
  from s where chi = 'b0'), 'stato: finestra del check-in indicata, «Sono qui» non ancora');
-- Con il ritardo di 30 minuti la finestra si allunga.
update public.incontri set ritardo_minuti = 30, ritardo_di = '5d5d5d5d-0000-4000-8000-00000000005d'
  where porta_id = '5f5f5f5f-0000-4000-8000-0000000000bd';
insert into s select 'b1', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000bd', '5b5b5b5b-0000-4000-8000-00000000005b');
select pg_temp.ok((select (j->>'checkin_fino')::timestamptz = now() + interval '180 minutes' from s where chi = 'b1'),
  'stato: con «Arrivo in ritardo» la fine della finestra si sposta');
-- Da fissare: nessuna finestra.
insert into s select 'ad', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000ad', '5a5a5a5a-0000-4000-8000-00000000005a');
select pg_temp.ok((select j->'checkin_da' = 'null'::jsonb and j->'checkin_fino' = 'null'::jsonb and j->'azioni' = '["proponi", "annulla_incontro"]'::jsonb
  from s where chi = 'ad'), 'stato: da fissare, nessuna finestra del check-in');

-- Dentro la finestra (tra 10 minuti): «Sono qui» per tutti e due.
insert into s select 'a0', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a');
select pg_temp.ok((select j->'azioni' = '["sono_qui", "disdici"]'::jsonb from s where chi = 'a0'), 'stato: nella finestra c''è «Sono qui»');
-- Anna fa il check-in: per lei niente pulsante e «aspetti l'altro»; per Ciro «Sono qui» e «l'altra persona è qui».
select public.checkin_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a');
insert into s select 'a1', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a');
insert into s select 'c1', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c');
select pg_temp.ok((select (j->>'checkin_mio')::boolean and not (j->>'checkin_altro')::boolean and j->'azioni' = '["disdici"]'::jsonb
  and j->'segnale' = 'null'::jsonb from s where chi = 'a1'), 'stato: Anna ha fatto il check-in, aspetta Ciro, nessun segnale');
select pg_temp.ok((select not (j->>'checkin_mio')::boolean and (j->>'checkin_altro')::boolean and j->'azioni' = '["sono_qui", "disdici"]'::jsonb
  and j->'segnale' = 'null'::jsonb from s where chi = 'c1'), 'stato: Ciro vede che Anna è arrivata e ha «Sono qui»');
-- Ciro fa il check-in: stessa parola per tutti e due, incontro avvenuto.
select public.checkin_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c');
insert into s select 'a2', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5a5a5a5a-0000-4000-8000-00000000005a');
insert into s select 'c2', public.stato_incontro('5f5f5f5f-0000-4000-8000-0000000000ac', '5c5c5c5c-0000-4000-8000-00000000005c');
select pg_temp.ok((select a.j->>'segnale' = c.j->>'segnale' and a.j->>'segnale' is not null and a.j->>'esito' = 'avvenuto'
  and a.j->>'stato' = 'concluso' and a.j->'azioni' = '[]'::jsonb and (c.j->>'checkin_mio')::boolean and (c.j->>'checkin_altro')::boolean
  from s a, s c where a.chi = 'a2' and c.chi = 'c2'), 'stato: dopo i due check-in lo stesso segnale per tutti e due');
select pg_temp.ok((select j::text not like '%5a5a5a5a%' and j::text not like '%5c5c5c5c%' from s where chi = 'c2'),
  'stato: mai l''id delle persone');
reset role;
rollback;
