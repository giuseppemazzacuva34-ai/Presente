-- Test dello stato dell'incontro con «Disdici», «Annulla l'incontro» e la disdetta (issue #6, spec v1.1 del CPO del
-- 20/11, punto 2; passo 2p). stato_incontro dice a ciascuno:
--   - «disdici» a incontro confermato, fino all'ora dell'incontro (anche insieme a «sono_qui»);
--   - «annulla_incontro» da «da fissare» e a chi ha fatto una proposta (chi la riceve ha già «annulla»);
--   - «disdetta»: se l'appuntamento è stato disdetto, da chi (mia sì/no, mai l'id), quando e di che giorno era.
-- Linea «sviluppatore-b». Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;

begin;
insert into auth.users (id, email) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'da@example.com'), ('7c7c7c7c-0000-4000-8000-00000000007c', 'dc@example.com'),
  ('7d7d7d7d-0000-4000-8000-00000000007d', 'dd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('7d7d7d7d-0000-4000-8000-00000000007d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-000000000007', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (confermato tra 10 ore), Anna-Dino (confermato tra 10 minuti), Ciro-Dino (da fissare).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('7f7f7f7f-0000-4000-8000-0000000000ac', '7e7e7e7e-0000-4000-8000-000000000007',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7c7c7c7c-0000-4000-8000-00000000007c', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '7e7e7e7e-0000-4000-8000-000000000007',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7d7d7d7d-0000-4000-8000-00000000007d', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-0000000000cd', '7e7e7e7e-0000-4000-8000-000000000007',
   '7c7c7c7c-0000-4000-8000-00000000007c', '7d7d7d7d-0000-4000-8000-00000000007d', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta(p, 400) from (values ('7a7a7a7a-0000-4000-8000-00000000007a'::uuid),
  ('7c7c7c7c-0000-4000-8000-00000000007c'::uuid), ('7d7d7d7d-0000-4000-8000-00000000007d'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from (values
  ('7f7f7f7f-0000-4000-8000-0000000000ac'::uuid, '7a7a7a7a-0000-4000-8000-00000000007a'::uuid),
  ('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '7a7a7a7a-0000-4000-8000-00000000007a'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '7d7d7d7d-0000-4000-8000-00000000007d'),
  ('7f7f7f7f-0000-4000-8000-0000000000cd', '7c7c7c7c-0000-4000-8000-00000000007c'),
  ('7f7f7f7f-0000-4000-8000-0000000000cd', '7d7d7d7d-0000-4000-8000-00000000007d')) v(porta, persona);
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('7f7f7f7f-0000-4000-8000-0000000000ac', '7f7f7f7f-0000-4000-8000-0000000000ad',
                     '7f7f7f7f-0000-4000-8000-0000000000cd');
select public.apri_incontro(p) from (values ('7f7f7f7f-0000-4000-8000-0000000000ac'::uuid),
  ('7f7f7f7f-0000-4000-8000-0000000000ad'::uuid), ('7f7f7f7f-0000-4000-8000-0000000000cd'::uuid)) v(p);
update public.incontri set stato = 'confermato', orario = date_trunc('minute', now()) + interval '10 hours',
  luogo_libero = 'Bar della piazza', proposto_da = '7a7a7a7a-0000-4000-8000-00000000007a',
  proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '10 minutes', luogo_libero = 'Caffè del parco',
  proposto_da = '7a7a7a7a-0000-4000-8000-00000000007a', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ad';

create temp table s (chi text, j jsonb) on commit drop;
-- Confermato, lontano: solo «Disdici»; nessuna disdetta.
insert into s select 'a0', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a');
select pg_temp.ok((select j->'azioni' = '["disdici", "ritardo", "cambia_luogo"]'::jsonb and j->'disdetta' = 'null'::jsonb from s where chi = 'a0'),
  'stato: confermato tra 10 ore, c''è «Disdici»');
-- Confermato nella finestra del check-in: «Sono qui» e «Disdici».
insert into s select 'd0', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ad', '7d7d7d7d-0000-4000-8000-00000000007d');
select pg_temp.ok((select j->'azioni' = '["sono_qui", "disdici", "ritardo"]'::jsonb from s where chi = 'd0'),
  'stato: nella finestra «Sono qui» e «Disdici»');
-- Dopo l'ora dell'incontro niente «Disdici» (decide il check-in).
update public.incontri set orario = now() - interval '5 minutes' where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ad';
insert into s select 'd1', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ad', '7d7d7d7d-0000-4000-8000-00000000007d');
select pg_temp.ok((select j->'azioni' = '["sono_qui", "ritardo"]'::jsonb from s where chi = 'd1'),
  'stato: dopo l''ora dell''incontro niente «Disdici»');
-- Da fissare: «Proponi» e «Annulla l'incontro».
insert into s select 'c0', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000cd', '7c7c7c7c-0000-4000-8000-00000000007c');
select pg_temp.ok((select j->'azioni' = '["proponi", "annulla_incontro"]'::jsonb from s where chi = 'c0'),
  'stato: da fissare, «Proponi» e «Annulla l''incontro»');

-- Anna disdice in tempo: l'incontro torna da fissare, l'orario disdetto resta per il messaggio all'altra persona.
select pg_temp.ok(public.disdici_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a') = 'disdetto',
  'disdici: in tempo');
select pg_temp.ok((select orario_disdetto = date_trunc('minute', now()) + interval '10 hours' and orario is null
  from public.incontri where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac'), 'disdici: l''orario disdetto è salvato');
insert into s select 'a1', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a');
insert into s select 'c1', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c');
select pg_temp.ok((select (j->'disdetta'->>'mia')::boolean and j->>'stato' = 'da_fissare'
  and j->'azioni' = '["proponi", "annulla_incontro"]'::jsonb from s where chi = 'a1'), 'stato: Anna sa di aver disdetto');
select pg_temp.ok((select not (j->'disdetta'->>'mia')::boolean and (j->'disdetta'->>'il')::timestamptz = now()
  and (j->'disdetta'->>'orario')::timestamptz = date_trunc('minute', now()) + interval '10 hours'
  from s where chi = 'c1'), 'stato: Ciro vede che l''altra persona ha disdetto l''appuntamento e di quando era');
select pg_temp.ok((select j::text not like '%7a7a7a7a%' and j::text not like '%7c7c7c7c%' from s where chi = 'c1'),
  'stato: mai l''id delle persone');

-- Anna propone di nuovo: lei può solo annullare l'incontro, Ciro risponde; la disdetta resta indicata.
update public.incontri set stato = 'proposto', orario = date_trunc('day', now()) + interval '2 days 19 hours',
  luogo_libero = 'Bar della piazza', proposto_da = '7a7a7a7a-0000-4000-8000-00000000007a', proposto_il = now()
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac';
insert into s select 'a2', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a');
insert into s select 'c2', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c');
select pg_temp.ok((select j->'azioni' = '["annulla_incontro"]'::jsonb and j->'disdetta' <> 'null'::jsonb from s where chi = 'a2'),
  'stato: chi ha proposto può annullare l''incontro');
select pg_temp.ok((select j->'azioni' = '["accetto", "altra_data", "annulla"]'::jsonb from s where chi = 'c2'),
  'stato: chi riceve la proposta ha le sue tre risposte');
-- Confermato di nuovo: la disdetta vecchia non si mostra più.
update public.incontri set stato = 'confermato', confermato_il = now() where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac';
insert into s select 'c3', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c');
select pg_temp.ok((select j->'disdetta' = 'null'::jsonb and j->'azioni' = '["disdici", "ritardo", "cambia_luogo"]'::jsonb from s where chi = 'c3'),
  'stato: a nuovo appuntamento confermato la disdetta non si mostra più');
-- Annullato: nessuna azione.
select public.annulla_incontro('7f7f7f7f-0000-4000-8000-0000000000cd', '7d7d7d7d-0000-4000-8000-00000000007d');
insert into s select 'c4', public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000cd', '7c7c7c7c-0000-4000-8000-00000000007c');
select pg_temp.ok((select j->'azioni' = '[]'::jsonb and j->>'esito' = 'annullato' from s where chi = 'c4'),
  'stato: incontro annullato, nessuna azione');
reset role;
rollback;
