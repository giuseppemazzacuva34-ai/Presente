-- Test della spec #6 v1.4 punto 1 (CPO, 27/11; D51 A): «Non riesco a fare il check-in» inviato DENTRO la finestra.
-- A fine finestra la buca non si paga: nessun 70 a chi ha aspettato, nessun 30 a Presente, entrambe le caparre restano
-- bloccate ed esito «contestato» finché non decide una persona dal pannello. Senza contestazione resta la buca normale.
-- Linea «sviluppatore-b». Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;

begin;
insert into auth.users (id, email) values
  ('f2a1a1a1-0000-4000-8000-0000000000f2', 'fa@example.com'), ('f2b1b1b1-0000-4000-8000-0000000000f2', 'fb@example.com'),
  ('f2c1c1c1-0000-4000-8000-0000000000f2', 'fc@example.com'), ('f2d1d1d1-0000-4000-8000-0000000000f2', 'fd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('f2a1a1a1-0000-4000-8000-0000000000f2', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('f2b1b1b1-0000-4000-8000-0000000000f2', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('f2c1c1c1-0000-4000-8000-0000000000f2', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('f2d1d1d1-0000-4000-8000-0000000000f2', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('f2e1e1e1-0000-4000-8000-0000000000f2', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porte: Anna-Ciro (Ciro ha mandato «Non riesco»), Bea-Dino (Dino non ha mandato nulla). Ora 40 minuti fa: la finestra
-- è finita 10 minuti fa; in entrambe solo la donna ha fatto «Sono qui».
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('f2f1f1f1-0000-4000-8000-0000000000ac', 'f2e1e1e1-0000-4000-8000-0000000000f2',
   'f2a1a1a1-0000-4000-8000-0000000000f2', 'f2c1c1c1-0000-4000-8000-0000000000f2', now() - interval '2 days'),
  ('f2f1f1f1-0000-4000-8000-0000000000bd', 'f2e1e1e1-0000-4000-8000-0000000000f2',
   'f2b1b1b1-0000-4000-8000-0000000000f2', 'f2d1d1d1-0000-4000-8000-0000000000f2', now() - interval '2 days');

set local role service_role;
select public.assegna_crediti_beta(p, 500) from (values ('f2a1a1a1-0000-4000-8000-0000000000f2'::uuid),
  ('f2b1b1b1-0000-4000-8000-0000000000f2'::uuid), ('f2c1c1c1-0000-4000-8000-0000000000f2'::uuid),
  ('f2d1d1d1-0000-4000-8000-0000000000f2'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from public.porte, lateral (values (id, a), (id, b)) v(porta, persona)
  where stanza_id = 'f2e1e1e1-0000-4000-8000-0000000000f2';
update public.svelamenti set iniziato_il = now() - interval '2 days', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '2 days', esito = 'doppio_si', esito_il = now() - interval '2 days'
  where porta_id in (select id from public.porte where stanza_id = 'f2e1e1e1-0000-4000-8000-0000000000f2');
select public.apri_incontro(id) from public.porte where stanza_id = 'f2e1e1e1-0000-4000-8000-0000000000f2';
update public.incontri set stato = 'confermato', luogo_libero = 'Bar della piazza', proposto_il = now() - interval '2 days',
  confermato_il = now() - interval '2 days', proposto_da = (select a from public.porte p where p.id = porta_id),
  orario = now() - interval '40 minutes', checkin_a_il = now() - interval '45 minutes'
  where porta_id in (select id from public.porte where stanza_id = 'f2e1e1e1-0000-4000-8000-0000000000f2');
-- «Non riesco» di Ciro inviato 20 minuti fa, quando la finestra era aperta (come lo salva contesta_buca).
insert into public.contestazioni_buca (porta_id, persona, fase, testo, inviata_il) values
  ('f2f1f1f1-0000-4000-8000-0000000000ac', 'f2c1c1c1-0000-4000-8000-0000000000f2', 'prima_della_buca',
   'Non riesco a fare il check-in: niente rete nel locale.', now() - interval '20 minutes');

-- Fine finestra con «Non riesco»: esito «contestato», nessun 70 né 30, caparre ancora bloccate.
select pg_temp.ok((public.incontro_aggiornato('f2f1f1f1-0000-4000-8000-0000000000ac')).esito = 'contestato',
  'fine finestra con «Non riesco»: esito contestato, non buca');
select pg_temp.ok((select crediti_presente = 0 and stato = 'concluso' and esito_il is not null from public.incontri
  where porta_id = 'f2f1f1f1-0000-4000-8000-0000000000ac'), 'fine finestra con «Non riesco»: nessun credito a Presente');
select pg_temp.ok(not exists (select 1 from public.crediti_movimenti where porta_id = 'f2f1f1f1-0000-4000-8000-0000000000ac'
  and tipo <> 'caparra_bloccata'), 'fine finestra con «Non riesco»: nessun 70, caparre restano bloccate');
select pg_temp.ok(public.saldo_crediti('f2a1a1a1-0000-4000-8000-0000000000f2') = 400
  and public.saldo_crediti('f2c1c1c1-0000-4000-8000-0000000000f2') = 400, 'fine finestra con «Non riesco»: saldi fermi');
-- Ripetere non cambia nulla (incontro già chiuso).
select pg_temp.ok((public.incontro_aggiornato('f2f1f1f1-0000-4000-8000-0000000000ac')).esito = 'contestato'
  and (select count(*) = 2 from public.crediti_movimenti where porta_id = 'f2f1f1f1-0000-4000-8000-0000000000ac'),
  'fine finestra con «Non riesco»: richiamare non muove crediti');
select pg_temp.ok(public.stato_contestazione_buca('f2f1f1f1-0000-4000-8000-0000000000ac', 'f2c1c1c1-0000-4000-8000-0000000000f2')
  = '{"contestabile": false, "stato": "in_attesa"}'::jsonb, 'fine finestra con «Non riesco»: la contestazione resta in attesa');

-- Senza contestazione: buca normale come prima (70 a chi ha aspettato, 30 a Presente).
select pg_temp.ok((public.incontro_aggiornato('f2f1f1f1-0000-4000-8000-0000000000bd')).esito = 'buca_b',
  'fine finestra senza contestazione: buca come prima');
select pg_temp.ok((select crediti_presente = 30 from public.incontri where porta_id = 'f2f1f1f1-0000-4000-8000-0000000000bd')
  and public.saldo_crediti('f2b1b1b1-0000-4000-8000-0000000000f2') = 570,
  'fine finestra senza contestazione: 100 + 70 a chi ha aspettato, 30 a Presente');
reset role;
rollback;
