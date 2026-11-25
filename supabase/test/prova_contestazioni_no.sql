-- Test di «Contesta» accanto a «Una persona ha risposto no a: <domanda>» (issue #6, spec v1.3 del CPO del 22/11, punto 2).
--   - testo 10-500 caratteri; entro 14 giorni da quando il «No» è visibile; una sola volta per ogni «No»;
--   - chi contesta non riceve mai id, nome o data dell'altra persona; il telefono passa solo dal server;
--   - accolta: quel «No» esce dal riepilogo e dai bollini; respinta: il «No» resta, nessun secondo ricorso.
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
  ('1a1a1a1a-0000-4000-8000-00000000001a', 'ca@example.com'), ('2c2c2c2c-0000-4000-8000-00000000002c', 'cc@example.com'),
  ('2d2d2d2d-0000-4000-8000-00000000002d', 'cd@example.com'), ('2e2e2e2e-0000-4000-8000-00000000002e', 'ce@example.com'),
  ('2f2f2f2f-0000-4000-8000-00000000002f', 'cf@example.com');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-000000000007', 'italia', now() - interval '720 hours', now() - interval '552 hours');
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select ('7f7f7f7f-0000-4000-8000-0000000000' || s)::uuid, '7e7e7e7e-0000-4000-8000-000000000007',
         '1a1a1a1a-0000-4000-8000-00000000001a', b, now() - interval '30 days'
  from (values ('2c', '2c2c2c2c-0000-4000-8000-00000000002c'::uuid), ('2d', '2d2d2d2d-0000-4000-8000-00000000002d'),
               ('2e', '2e2e2e2e-0000-4000-8000-00000000002e'), ('2f', '2f2f2f2f-0000-4000-8000-00000000002f')) v(s, b);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, checkin_a_il, checkin_b_il, esito, esito_il)
  select ('7f7f7f7f-0000-4000-8000-0000000000' || s)::uuid, now(), 'concluso', now() - quando, 'Bar della piazza',
         now() - quando, now() - quando, 'avvenuto', now() - quando
  from (values ('2c', interval '3 days'), ('2d', interval '4 days'), ('2e', interval '25 days'), ('2f', interval '5 days')) v(s, quando);
-- Su Anna: Ciro dice «non si è presentata» e «foto non sue»; Dino «foto non sue»; Ezio (25 giorni fa, scoperta dal
-- 18° giorno: oltre 14 giorni) «non come in chiamata»; Fabio tutto sì. Anna ha risposto su Ciro, Dino e Fabio.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('7f7f7f7f-0000-4000-8000-00000000002c', '2c2c2c2c-0000-4000-8000-00000000002c', '1a1a1a1a-0000-4000-8000-00000000001a', 'no', 'no', 'si', true, now() - interval '3 days'),
  ('7f7f7f7f-0000-4000-8000-00000000002c', '1a1a1a1a-0000-4000-8000-00000000001a', '2c2c2c2c-0000-4000-8000-00000000002c', 'si', 'si', 'si', true, now() - interval '2 days'),
  ('7f7f7f7f-0000-4000-8000-00000000002d', '2d2d2d2d-0000-4000-8000-00000000002d', '1a1a1a1a-0000-4000-8000-00000000001a', 'si', 'no', 'si', true, now() - interval '4 days'),
  ('7f7f7f7f-0000-4000-8000-00000000002d', '1a1a1a1a-0000-4000-8000-00000000001a', '2d2d2d2d-0000-4000-8000-00000000002d', 'si', 'si', 'si', true, now() - interval '4 days'),
  ('7f7f7f7f-0000-4000-8000-00000000002e', '2e2e2e2e-0000-4000-8000-00000000002e', '1a1a1a1a-0000-4000-8000-00000000001a', 'si', 'si', 'no', true, now() - interval '25 days'),
  ('7f7f7f7f-0000-4000-8000-00000000002f', '2f2f2f2f-0000-4000-8000-00000000002f', '1a1a1a1a-0000-4000-8000-00000000001a', 'si', 'si', 'si', true, now() - interval '5 days'),
  ('7f7f7f7f-0000-4000-8000-00000000002f', '1a1a1a1a-0000-4000-8000-00000000001a', '2f2f2f2f-0000-4000-8000-00000000002f', 'si', 'si', 'si', true, now() - interval '5 days');

set local role service_role;
create temp table s (chi text, j jsonb) on commit drop;
select pg_temp.ok((public.riepilogo_valutazioni('1a1a1a1a-0000-4000-8000-00000000001a'))->'no_ricevuti'
  = '["come_in_chiamata", "foto_sue", "presentato"]'::jsonb, 'prima: Anna vede tre «No»');
insert into s select 'prima', public.stato_contestazioni_no('1a1a1a1a-0000-4000-8000-00000000001a');
select pg_temp.ok((select j = '{"foto_sue": {"contestabile": true, "stato": null},
  "presentato": {"contestabile": true, "stato": null},
  "come_in_chiamata": {"contestabile": false, "stato": null}}'::jsonb from s where chi = 'prima'),
  'stato: «foto sue» e «presentato» contestabili, «come in chiamata» no (visibile da oltre 14 giorni)');

-- Testo e domanda.
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'foto_sue', '   corto   ') = 'testo_non_valido',
  'testo sotto 10 caratteri (spazi esclusi): rifiutato');
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'foto_sue', repeat('a', 501)) = 'testo_non_valido',
  'testo oltre 500 caratteri: rifiutato');
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'sicuro', 'Non è andata così, davvero.') = 'domanda_non_valida',
  'la domanda privata sulla sicurezza non si contesta');
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'come_in_chiamata', 'Non è andata così, davvero.') = 'nessun_no',
  'oltre 14 giorni da quando il «No» è visibile: rifiutato');
select pg_temp.ok(public.contesta_no('2f2f2f2f-0000-4000-8000-00000000002f', 'foto_sue', 'Non è andata così, davvero.') = 'nessun_no',
  'nessun «No» su quella domanda: niente da contestare');
select pg_temp.ok((select count(*) = 0 from public.contestazioni_no), 'nessuna contestazione scritta finora');

-- Anna contesta «foto non sue» (copre i «No» di Ciro e Dino), poi riprova: una sola volta.
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'foto_sue', repeat('b', 500)) = 'inviata',
  'contestazione di 500 caratteri inviata');
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'foto_sue', 'Ci riprovo, non è vero.') = 'nessun_no',
  'seconda contestazione sullo stesso «No»: rifiutata dal server');
select pg_temp.ok((select count(*) = 2 from public.contestazioni_no_valutazioni), 'la contestazione copre i due «No» visibili');
insert into s select 'inviata', public.stato_contestazioni_no('1a1a1a1a-0000-4000-8000-00000000001a');
select pg_temp.ok((select j->'foto_sue' = '{"contestabile": false, "stato": "in_attesa"}'::jsonb from s where chi = 'inviata'),
  'dopo l''invio: «In revisione», non più contestabile');
select pg_temp.ok((select bool_and(j::text not like '%2c2c2c2c%' and j::text not like '%2d2d2d2d%' and j::text not like '%7f7f7f7f%'
  and j::text !~ '\d{4}-\d{2}-\d{2}') from s), 'lo stato non dice mai chi, quale incontro o quando');

-- Decisione (D51 A: in beta Giuseppe, dal pannello).
reset role;
insert into public.moderatori (persona) values ('2e2e2e2e-0000-4000-8000-00000000002e'); -- decide solo un moderatore
set local role service_role;
create temp table c on commit drop as select id from public.contestazioni_no;
select pg_temp.ok(public.decidi_contestazione_no((select id from c), '2e2e2e2e-0000-4000-8000-00000000002e', true) = 'accolta',
  'contestazione accolta');
select pg_temp.ok(public.decidi_contestazione_no((select id from c), '2e2e2e2e-0000-4000-8000-00000000002e', false) = 'gia_decisa',
  'una decisione sola');
select pg_temp.ok(public.decidi_contestazione_no('00000000-0000-4000-8000-000000000000', '2e2e2e2e-0000-4000-8000-00000000002e', true) = 'non_trovata',
  'contestazione inesistente');
select pg_temp.ok((public.riepilogo_valutazioni('1a1a1a1a-0000-4000-8000-00000000001a'))->'no_ricevuti'
  = '["come_in_chiamata", "presentato"]'::jsonb, 'accolta: quel «No» non conta più nel riepilogo');
insert into s select 'accolta', public.stato_contestazioni_no('1a1a1a1a-0000-4000-8000-00000000001a');
select pg_temp.ok((select j->'foto_sue' = '{"contestabile": false, "stato": "accolta"}'::jsonb from s where chi = 'accolta'),
  'lo stato dice «accolta» anche se il «No» non si vede più');

-- «Non si è presentata» contestato e respinto: resta, nessun secondo ricorso.
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'presentato', 'Ero lì alle otto, ho fatto il check-in.') = 'inviata',
  'contestazione di «presentato» inviata');
select pg_temp.ok(public.decidi_contestazione_no((select id from public.contestazioni_no where domanda = 'presentato'),
  '2e2e2e2e-0000-4000-8000-00000000002e', false) = 'respinta', 'contestazione respinta');
select pg_temp.ok((public.riepilogo_valutazioni('1a1a1a1a-0000-4000-8000-00000000001a'))->'no_ricevuti'
  = '["come_in_chiamata", "presentato"]'::jsonb, 'respinta: il «No» resta');
select pg_temp.ok(public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'presentato', 'Ci riprovo, non è vero.') = 'nessun_no',
  'respinta: nessun secondo ricorso');
reset role;

-- Il telefono non tocca né le tabelle né le funzioni: passa dal Worker.
set local role authenticated;
select set_config('request.jwt.claim.sub', '1a1a1a1a-0000-4000-8000-00000000001a', true);
select pg_temp.ok(pg_temp.rifiutato($q$select * from public.contestazioni_no$q$), 'telefono: tabella delle contestazioni chiusa');
select pg_temp.ok(pg_temp.rifiutato($q$select * from public.contestazioni_no_valutazioni$q$), 'telefono: tabella dei «No» contestati chiusa');
select pg_temp.ok(pg_temp.rifiutato($q$select public.contesta_no('1a1a1a1a-0000-4000-8000-00000000001a', 'foto_sue', 'Testo abbastanza lungo')$q$),
  'telefono: contesta solo dal server');
select pg_temp.ok(pg_temp.rifiutato($q$select public.stato_contestazioni_no('1a1a1a1a-0000-4000-8000-00000000001a')$q$),
  'telefono: stato solo dal server');
select pg_temp.ok(pg_temp.rifiutato($q$select public.decidi_contestazione_no(gen_random_uuid(), gen_random_uuid(), true)$q$),
  'telefono: decisione solo dal server');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($q$select * from public.contestazioni_no$q$), 'anon: tabella chiusa');
reset role;
rollback;
