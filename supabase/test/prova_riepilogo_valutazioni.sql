-- Test del riepilogo delle valutazioni (issue #6, spec v1 del CPO del 3/11, «Valutazione (D20)»; passo 3b).
-- riepilogo_valutazioni dice a una persona solo ciò che le altre hanno risposto su di lei, e solo:
--   - alla cieca: una valutazione si scopre quando anche lei ha risposto su quell'incontro o dopo 7 giorni;
--   - a riepilogo: quanti incontri valutati, i bollini (solo da 3 incontri valutati) e le domande con un «No»,
--     senza nome, data, ordine né id; la domanda privata sulla sicurezza non c'è mai.
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
  ('1a1a1a1a-0000-4000-8000-00000000001a', 'ra@example.com'), ('2c2c2c2c-0000-4000-8000-00000000002c', 'rc@example.com'),
  ('2d2d2d2d-0000-4000-8000-00000000002d', 'rd@example.com'), ('2e2e2e2e-0000-4000-8000-00000000002e', 're@example.com'),
  ('2f2f2f2f-0000-4000-8000-00000000002f', 'rf@example.com');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-000000000007', 'italia', now() - interval '720 hours', now() - interval '552 hours');
-- Anna ha incontrato Ciro, Dino, Ezio e Fabio (porte e incontri scritti direttamente: qui conta solo l'esito).
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select ('7f7f7f7f-0000-4000-8000-0000000000' || s)::uuid, '7e7e7e7e-0000-4000-8000-000000000007',
         '1a1a1a1a-0000-4000-8000-00000000001a', b, now() - interval '23 days'
  from (values ('2c', '2c2c2c2c-0000-4000-8000-00000000002c'::uuid), ('2d', '2d2d2d2d-0000-4000-8000-00000000002d'),
               ('2e', '2e2e2e2e-0000-4000-8000-00000000002e'), ('2f', '2f2f2f2f-0000-4000-8000-00000000002f')) v(s, b);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, checkin_a_il, checkin_b_il, esito, esito_il)
  select ('7f7f7f7f-0000-4000-8000-0000000000' || s)::uuid, now(), 'concluso', now() - quando, 'Bar della piazza',
         now() - quando, now() - quando, 'avvenuto', now() - quando
  from (values ('2c', interval '3 days'), ('2d', interval '2 days'), ('2e', interval '8 days'), ('2f', interval '5 days')) v(s, quando);
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro) values
  -- Ciro e Anna hanno risposto tutti e due: si scopre.
  ('7f7f7f7f-0000-4000-8000-00000000002c', '2c2c2c2c-0000-4000-8000-00000000002c', '1a1a1a1a-0000-4000-8000-00000000001a', 'si', 'si', 'si', false),
  ('7f7f7f7f-0000-4000-8000-00000000002c', '1a1a1a1a-0000-4000-8000-00000000001a', '2c2c2c2c-0000-4000-8000-00000000002c', 'no', 'si', 'si', true),
  -- Dino ha risposto 2 giorni fa, Anna non ancora: resta coperta.
  ('7f7f7f7f-0000-4000-8000-00000000002d', '2d2d2d2d-0000-4000-8000-00000000002d', '1a1a1a1a-0000-4000-8000-00000000001a', 'no', 'no', 'no', false),
  -- Ezio ha risposto, Anna no, ma sono passati 8 giorni: si scopre.
  ('7f7f7f7f-0000-4000-8000-00000000002e', '2e2e2e2e-0000-4000-8000-00000000002e', '1a1a1a1a-0000-4000-8000-00000000001a', 'in_ritardo', 'no', 'piu_o_meno', true),
  -- Fabio e Anna tutti e due.
  ('7f7f7f7f-0000-4000-8000-00000000002f', '2f2f2f2f-0000-4000-8000-00000000002f', '1a1a1a1a-0000-4000-8000-00000000001a', 'si', 'si', 'no', true),
  ('7f7f7f7f-0000-4000-8000-00000000002f', '1a1a1a1a-0000-4000-8000-00000000001a', '2f2f2f2f-0000-4000-8000-00000000002f', 'si', 'si', 'si', true);

set local role service_role;
create temp table r (chi text, j jsonb) on commit drop;
insert into r select 'anna', public.riepilogo_valutazioni('1a1a1a1a-0000-4000-8000-00000000001a');
select pg_temp.ok((select (j->>'valutati')::int = 3 from r where chi = 'anna'),
  'alla cieca: 3 valutazioni scoperte (Ciro e Fabio con le due risposte, Ezio dopo 7 giorni), Dino ancora coperta');
select pg_temp.ok((select j->'bollini' = '{"presentato": 3, "foto_sue": 2, "come_in_chiamata": 1}'::jsonb from r where chi = 'anna'),
  'bollini dal terzo incontro: si è presentata (anche in ritardo) 3, foto sue 2, come in chiamata 1');
select pg_temp.ok((select j->'no_ricevuti' = '["come_in_chiamata", "foto_sue"]'::jsonb from r where chi = 'anna'),
  'le domande con un «No», in ordine fisso, senza quelle di Dino ancora coperte');
select pg_temp.ok((select j::text not like '%sicur%' and j::text not like '%2c2c2c2c%' and j::text not like '%7f7f7f7f%'
  and j::text !~ '\d{4}-\d{2}-\d{2}' from r where chi = 'anna'), 'mai la sicurezza, nomi, id o date');

-- Anna risponde su Dino: la sua valutazione si scopre subito.
select pg_temp.ok(public.valuta_incontro('7f7f7f7f-0000-4000-8000-00000000002d', '1a1a1a1a-0000-4000-8000-00000000001a',
  'si', 'si', 'si', true) = 'grazie', 'Anna valuta Dino');
insert into r select 'anna2', public.riepilogo_valutazioni('1a1a1a1a-0000-4000-8000-00000000001a');
select pg_temp.ok((select (j->>'valutati')::int = 4 and j->'no_ricevuti' = '["come_in_chiamata", "foto_sue", "presentato"]'::jsonb
  and j->'bollini' = '{"presentato": 3, "foto_sue": 2, "come_in_chiamata": 1}'::jsonb from r where chi = 'anna2'),
  'dopo la risposta di Anna anche quella di Dino si scopre; un «No» ripetuto conta una volta');

-- Ciro: una sola valutazione su di lui → niente bollini, ma vede il «No».
insert into r select 'ciro', public.riepilogo_valutazioni('2c2c2c2c-0000-4000-8000-00000000002c');
select pg_temp.ok((select (j->>'valutati')::int = 1 and j->'bollini' = 'null'::jsonb and j->'no_ricevuti' = '["presentato"]'::jsonb
  from r where chi = 'ciro'), 'meno di 3 incontri valutati: niente bollini');
-- Ezio: nessuna valutazione scoperta su di lui (Anna non ha risposto, ma il riepilogo non dice altro).
insert into r select 'ezio', public.riepilogo_valutazioni('2e2e2e2e-0000-4000-8000-00000000002e');
select pg_temp.ok((select j = '{"valutati": 0, "bollini": null, "no_ricevuti": []}'::jsonb from r where chi = 'ezio'),
  'nessuna valutazione: riepilogo vuoto');
reset role;

-- Il telefono non chiama il riepilogo direttamente: passa dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($q$select public.riepilogo_valutazioni('1a1a1a1a-0000-4000-8000-00000000001a')$q$),
  'telefono: riepilogo solo dal server');
reset role;
rollback;
