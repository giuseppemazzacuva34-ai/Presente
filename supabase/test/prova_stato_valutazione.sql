-- Test dell'azione «valuta» nello stato dell'incontro (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; passo 3e).
-- Dopo l'incontro avvenuto lo stato mette «valuta» tra le azioni finché la persona non ha risposto ed entro 7 giorni
-- («Non ora» non chiude nulla: la domanda resta). Mai le risposte dell'altra persona. Linea «sviluppatore-b».
-- Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;

begin;
insert into auth.users (id, email) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'va@example.com'), ('7b7b7b7b-0000-4000-8000-00000000007b', 'vb@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'vc@example.com'), ('7d7d7d7d-0000-4000-8000-00000000007d', 'vd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000007b', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('7d7d7d7d-0000-4000-8000-00000000007d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-000000000007', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (avvenuto un'ora fa), Bea-Dino (confermato tra 2 giorni), Anna-Dino (avvenuto 8 giorni fa).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('7f7f7f7f-0000-4000-8000-0000000000ac', '7e7e7e7e-0000-4000-8000-000000000007',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7c7c7c7c-0000-4000-8000-00000000007c', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-0000000000bd', '7e7e7e7e-0000-4000-8000-000000000007',
   '7b7b7b7b-0000-4000-8000-00000000007b', '7d7d7d7d-0000-4000-8000-00000000007d', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '7e7e7e7e-0000-4000-8000-000000000007',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7d7d7d7d-0000-4000-8000-00000000007d', now() - interval '1 hour');
set local role service_role;
select public.assegna_crediti_beta(p, 300) from (values ('7a7a7a7a-0000-4000-8000-00000000007a'::uuid),
  ('7b7b7b7b-0000-4000-8000-00000000007b'::uuid), ('7c7c7c7c-0000-4000-8000-00000000007c'::uuid),
  ('7d7d7d7d-0000-4000-8000-00000000007d'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from (values
  ('7f7f7f7f-0000-4000-8000-0000000000ac'::uuid, '7a7a7a7a-0000-4000-8000-00000000007a'::uuid),
  ('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c'),
  ('7f7f7f7f-0000-4000-8000-0000000000bd', '7b7b7b7b-0000-4000-8000-00000000007b'),
  ('7f7f7f7f-0000-4000-8000-0000000000bd', '7d7d7d7d-0000-4000-8000-00000000007d'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '7a7a7a7a-0000-4000-8000-00000000007a'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '7d7d7d7d-0000-4000-8000-00000000007d')) v(porta, persona);
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('7f7f7f7f-0000-4000-8000-0000000000ac', '7f7f7f7f-0000-4000-8000-0000000000bd',
                     '7f7f7f7f-0000-4000-8000-0000000000ad');
select public.apri_incontro(p) from (values ('7f7f7f7f-0000-4000-8000-0000000000ac'::uuid),
  ('7f7f7f7f-0000-4000-8000-0000000000bd'::uuid), ('7f7f7f7f-0000-4000-8000-0000000000ad'::uuid)) v(p);
reset role;
update public.incontri set stato = 'concluso', orario = now() - interval '1 hour', luogo_libero = 'Bar della piazza',
  proposto_da = '7a7a7a7a-0000-4000-8000-00000000007a', proposto_il = now() - interval '2 days',
  confermato_il = now() - interval '2 days', checkin_a_il = now() - interval '70 minutes', checkin_b_il = now() - interval '65 minutes',
  esito = 'avvenuto', esito_il = now() - interval '65 minutes'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '2 days', luogo_libero = 'Caffè del parco',
  proposto_da = '7b7b7b7b-0000-4000-8000-00000000007b', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000bd';
update public.incontri set stato = 'concluso', orario = now() - interval '8 days', luogo_libero = 'Bar vecchio',
  proposto_da = '7a7a7a7a-0000-4000-8000-00000000007a', proposto_il = now() - interval '9 days',
  confermato_il = now() - interval '9 days', checkin_a_il = now() - interval '8 days', checkin_b_il = now() - interval '8 days',
  esito = 'avvenuto', esito_il = now() - interval '8 days'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ad';

set local role service_role;
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a')
  -> 'azioni' = '["valuta"]'::jsonb, 'incontro avvenuto: Anna vede «valuta»');
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c')
  -> 'azioni' = '["valuta"]'::jsonb, 'incontro avvenuto: anche Ciro vede «valuta»');
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000bd', '7b7b7b7b-0000-4000-8000-00000000007b')
  -> 'azioni' = '["disdici"]'::jsonb, 'incontro solo confermato: niente «valuta», restano le azioni di prima');
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ad', '7a7a7a7a-0000-4000-8000-00000000007a')
  -> 'azioni' = '[]'::jsonb, 'dopo 7 giorni la valutazione è chiusa: niente «valuta»');
select pg_temp.ok(public.valuta_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a',
  'si', 'si', 'si', true) = 'grazie', 'Anna risponde');
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a')
  -> 'azioni' = '[]'::jsonb, 'dopo la risposta Anna non vede più «valuta»');
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c')
  -> 'azioni' = '["valuta"]'::jsonb, 'Ciro non ha ancora risposto: vede ancora «valuta»');
select pg_temp.ok(not (public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c')
  ?| array['presentato', 'foto_sue', 'come_in_chiamata', 'sicuro', 'valutazione']), 'mai le risposte nello stato');
select pg_temp.ok(public.stato_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c')
  ->> 'esito' = 'avvenuto', 'il resto dello stato resta uguale');
reset role;
rollback;
