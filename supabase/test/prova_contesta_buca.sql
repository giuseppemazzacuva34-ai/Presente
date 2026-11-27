-- Test di «Ero lì» e «Non riesco a fare il check-in» (issue #6, spec v1 del CPO del 3/11, «Regole» e «Casi limite»),
-- passo 1: solo database. Chi risulta buca contesta entro 24 ore con un testo (10-500 caratteri); chi non riesce a fare
-- il check-in può contestare già durante la finestra (da 30 minuti prima dell'ora) se non ha fatto «Sono qui».
-- Una contestazione per persona e incontro. Lo stato dice al telefono solo { contestabile, stato }: mai id, nomi o date.
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
  ('e1a1a1a1-0000-4000-8000-0000000000e1', 'ea@example.com'), ('e1b1b1b1-0000-4000-8000-0000000000e1', 'eb@example.com'),
  ('e1c1c1c1-0000-4000-8000-0000000000e1', 'ec@example.com'), ('e1d1d1d1-0000-4000-8000-0000000000e1', 'ed@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('e1a1a1a1-0000-4000-8000-0000000000e1', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('e1b1b1b1-0000-4000-8000-0000000000e1', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('e1c1c1c1-0000-4000-8000-0000000000e1', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('e1d1d1d1-0000-4000-8000-0000000000e1', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('e1e1e1e1-0000-4000-8000-0000000000e1', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porte: Anna-Ciro (buca di Ciro un'ora fa), Bea-Dino (buca di Bea 25 ore fa), Anna-Dino (tra 10 minuti, Anna è già
-- qui), Bea-Ciro (tra 3 ore).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1e1e1e1-0000-4000-8000-0000000000e1',
   'e1a1a1a1-0000-4000-8000-0000000000e1', 'e1c1c1c1-0000-4000-8000-0000000000e1', now() - interval '2 days'),
  ('e1f1f1f1-0000-4000-8000-0000000000bd', 'e1e1e1e1-0000-4000-8000-0000000000e1',
   'e1b1b1b1-0000-4000-8000-0000000000e1', 'e1d1d1d1-0000-4000-8000-0000000000e1', now() - interval '2 days'),
  ('e1f1f1f1-0000-4000-8000-0000000000ad', 'e1e1e1e1-0000-4000-8000-0000000000e1',
   'e1a1a1a1-0000-4000-8000-0000000000e1', 'e1d1d1d1-0000-4000-8000-0000000000e1', now() - interval '2 days'),
  ('e1f1f1f1-0000-4000-8000-0000000000bc', 'e1e1e1e1-0000-4000-8000-0000000000e1',
   'e1b1b1b1-0000-4000-8000-0000000000e1', 'e1c1c1c1-0000-4000-8000-0000000000e1', now() - interval '2 days');

set local role service_role;
select public.assegna_crediti_beta(p, 500) from (values ('e1a1a1a1-0000-4000-8000-0000000000e1'::uuid),
  ('e1b1b1b1-0000-4000-8000-0000000000e1'::uuid), ('e1c1c1c1-0000-4000-8000-0000000000e1'::uuid),
  ('e1d1d1d1-0000-4000-8000-0000000000e1'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from public.porte, lateral (values (id, a), (id, b)) v(porta, persona)
  where stanza_id = 'e1e1e1e1-0000-4000-8000-0000000000e1';
update public.svelamenti set iniziato_il = now() - interval '2 days', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '2 days', esito = 'doppio_si', esito_il = now() - interval '2 days'
  where porta_id in (select id from public.porte where stanza_id = 'e1e1e1e1-0000-4000-8000-0000000000e1');
select public.apri_incontro(id) from public.porte where stanza_id = 'e1e1e1e1-0000-4000-8000-0000000000e1';
update public.incontri set stato = 'confermato', luogo_libero = 'Bar della piazza', proposto_il = now() - interval '2 days',
  confermato_il = now() - interval '2 days',
  proposto_da = (select a from public.porte p where p.id = porta_id),
  orario = case porta_id when 'e1f1f1f1-0000-4000-8000-0000000000ac' then now() - interval '90 minutes'
                         when 'e1f1f1f1-0000-4000-8000-0000000000bd' then now() - interval '26 hours'
                         when 'e1f1f1f1-0000-4000-8000-0000000000ad' then now() + interval '10 minutes'
                         else now() + interval '3 hours' end
  where porta_id in (select id from public.porte where stanza_id = 'e1e1e1e1-0000-4000-8000-0000000000e1');
update public.incontri set checkin_a_il = now() - interval '100 minutes', stato = 'concluso', esito = 'buca_b',
  esito_il = now() - interval '1 hour', crediti_presente = 30 where porta_id = 'e1f1f1f1-0000-4000-8000-0000000000ac';
update public.incontri set checkin_b_il = now() - interval '26 hours', stato = 'concluso', esito = 'buca_a',
  esito_il = now() - interval '25 hours', crediti_presente = 30 where porta_id = 'e1f1f1f1-0000-4000-8000-0000000000bd';
update public.incontri set checkin_a_il = now() - interval '5 minutes' where porta_id = 'e1f1f1f1-0000-4000-8000-0000000000ad';
reset role;

-- Il telefono non chiama le funzioni e non legge la tabella: passa dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac',
  'e1c1c1c1-0000-4000-8000-0000000000e1', 'Ero lì al bancone, nessuno è arrivato.')$$), 'contesta buca: il telefono non la chiama');
select pg_temp.ok(pg_temp.rifiutato($$select public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ac',
  'e1c1c1c1-0000-4000-8000-0000000000e1')$$), 'stato contestazione buca: il telefono non lo chiama');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.contestazioni_buca$$), 'contestazioni buca: tabella chiusa al telefono');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac',
  'e1c1c1c1-0000-4000-8000-0000000000e1', 'Ero lì al bancone, nessuno è arrivato.')$$), 'contesta buca: chiave anon rifiutata');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.contestazioni_buca$$), 'contestazioni buca: tabella chiusa ad anon');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.contestazioni_buca'::regclass),
  'contestazioni buca: regole per riga attive');

set local role service_role;
-- Chi può contestare: Ciro (buca da un'ora) e Dino (finestra aperta, non ha fatto «Sono qui»).
select pg_temp.ok(public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1c1c1c1-0000-4000-8000-0000000000e1')
  = '{"contestabile": true, "stato": null}'::jsonb, 'stato: chi è buca da un''ora può contestare');
select pg_temp.ok(public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ad', 'e1d1d1d1-0000-4000-8000-0000000000e1')
  = '{"contestabile": true, "stato": null}'::jsonb, 'stato: a finestra aperta senza «Sono qui» si può contestare (Non riesco)');
-- Chi no: chi ha aspettato, chi è buca da più di 24 ore, chi ha già fatto «Sono qui», prima della finestra, chi non è nella porta.
select pg_temp.ok((public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1a1a1a1-0000-4000-8000-0000000000e1')
  ->> 'contestabile')::boolean = false, 'stato: chi ha aspettato non contesta');
select pg_temp.ok((public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000bd', 'e1b1b1b1-0000-4000-8000-0000000000e1')
  ->> 'contestabile')::boolean = false, 'stato: dopo 24 ore il pulsante non c''è più');
select pg_temp.ok((public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ad', 'e1a1a1a1-0000-4000-8000-0000000000e1')
  ->> 'contestabile')::boolean = false, 'stato: chi ha già fatto «Sono qui» non contesta');
select pg_temp.ok((public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000bc', 'e1c1c1c1-0000-4000-8000-0000000000e1')
  ->> 'contestabile')::boolean = false, 'stato: prima della finestra del check-in no');
select pg_temp.ok(public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1b1b1b1-0000-4000-8000-0000000000e1')
  is null, 'stato: chi non è nella porta non riceve nulla');

-- Errori dell'invio.
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1c1c1c1-0000-4000-8000-0000000000e1', '  corto  ')
  = 'testo_non_valido', 'contesta: testo sotto i 10 caratteri no');
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1c1c1c1-0000-4000-8000-0000000000e1', repeat('x', 501))
  = 'testo_non_valido', 'contesta: testo oltre i 500 caratteri no');
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1b1b1b1-0000-4000-8000-0000000000e1', 'Ero lì al bancone.')
  = 'non_nella_porta', 'contesta: chi non è nella porta no');
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1a1a1a1-0000-4000-8000-0000000000e1', 'Ero lì al bancone.')
  = 'non_contestabile', 'contesta: chi ha aspettato no');
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000bd', 'e1b1b1b1-0000-4000-8000-0000000000e1', 'Ero lì al bancone.')
  = 'non_contestabile', 'contesta: oltre 24 ore no');
select pg_temp.ok(not exists (select 1 from public.contestazioni_buca), 'contesta: gli errori non salvano nulla');

-- Invio: testo pulito ai lati, una volta sola, stato in attesa; mai id o date nello stato.
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1c1c1c1-0000-4000-8000-0000000000e1',
  '  Ero lì al bancone dalle 20, nessuno è arrivato.  ') = 'inviata', 'contesta: chi è buca la manda');
select pg_temp.ok((select testo = 'Ero lì al bancone dalle 20, nessuno è arrivato.' and stato = 'in_attesa' and fase = 'dopo_buca'
  from public.contestazioni_buca where porta_id = 'e1f1f1f1-0000-4000-8000-0000000000ac'), 'contesta: salvata in attesa, testo pulito');
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1c1c1c1-0000-4000-8000-0000000000e1',
  'Ci riprovo: ero proprio lì.') = 'gia_inviata', 'contesta: una sola volta per incontro');
select pg_temp.ok(public.stato_contestazione_buca('e1f1f1f1-0000-4000-8000-0000000000ac', 'e1c1c1c1-0000-4000-8000-0000000000e1')
  = '{"contestabile": false, "stato": "in_attesa"}'::jsonb, 'stato: dopo l''invio solo «in attesa», niente id o date');
select pg_temp.ok(public.contesta_buca('e1f1f1f1-0000-4000-8000-0000000000ad', 'e1d1d1d1-0000-4000-8000-0000000000e1',
  'Non riesco a fare il check-in: niente rete nel locale.') = 'inviata', 'contesta: «Non riesco a fare il check-in» a finestra aperta');
select pg_temp.ok((select fase = 'prima_della_buca' from public.contestazioni_buca where porta_id = 'e1f1f1f1-0000-4000-8000-0000000000ad'),
  'contesta: segnata come inviata prima della buca');
-- I crediti non si muovono con l'invio: decide una persona (D51 A).
select pg_temp.ok((select count(*) = 0 from public.crediti_movimenti m where m.porta_id = 'e1f1f1f1-0000-4000-8000-0000000000ac'
  and m.tipo not in ('caparra_bloccata')), 'contesta: nessun movimento di crediti all''invio');
reset role;
rollback;
