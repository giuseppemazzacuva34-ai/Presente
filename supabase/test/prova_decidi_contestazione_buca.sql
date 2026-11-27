-- Test della decisione su «Ero lì» / «Non riesco» (issue #6 spec v1.4, CPO 27/11; D51 A: decide una persona).
-- Caso 1 («Non riesco» nella finestra, esito «contestato»): accolta → 100 a entrambi, nessun 70/30; respinta → buca
-- normale (70 a chi ha aspettato, 30 a Presente). Caso 2 (buca già pagata): respinta → nulla si muove; accolta → in
-- attesa di D156 (nulla si muove, la contestazione resta da decidere). Una decisione sola; mai sulla propria porta.
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
  ('d3a1a1a1-0000-4000-8000-0000000000d3', 'da@example.com'), ('d3b1b1b1-0000-4000-8000-0000000000d3', 'db@example.com'),
  ('d3c1c1c1-0000-4000-8000-0000000000d3', 'dc@example.com'), ('d3d1d1d1-0000-4000-8000-0000000000d3', 'dd@example.com'),
  ('d3e3e3e3-0000-4000-8000-0000000000d3', 'de@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('d3a1a1a1-0000-4000-8000-0000000000d3', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('d3b1b1b1-0000-4000-8000-0000000000d3', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('d3c1c1c1-0000-4000-8000-0000000000d3', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('d3d1d1d1-0000-4000-8000-0000000000d3', 'Dino', '1985-01-01', 'TO', 'uomo'),
  ('d3e3e3e3-0000-4000-8000-0000000000d3', 'Eva', '1980-01-01', 'TO', 'donna');
insert into public.moderatori (persona) values ('d3e3e3e3-0000-4000-8000-0000000000d3'), ('d3a1a1a1-0000-4000-8000-0000000000d3');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('d3e1e1e1-0000-4000-8000-0000000000d3', 'italia', now() - interval '9 days', now() - interval '2 days');
-- ac: Ciro «Non riesco» (caso 1, da accogliere). bd: Dino «Non riesco» (caso 1, da respingere).
-- ad: buca di Anna già pagata, «Ero lì» (caso 2, accolta). bc: buca di Ciro già pagata, «Ero lì» (caso 2, respinta).
-- ab: finestra ancora aperta, Bea «Non riesco».
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('d3f1f1f1-0000-4000-8000-0000000000ac', 'd3e1e1e1-0000-4000-8000-0000000000d3',
   'd3a1a1a1-0000-4000-8000-0000000000d3', 'd3c1c1c1-0000-4000-8000-0000000000d3', now() - interval '2 days'),
  ('d3f1f1f1-0000-4000-8000-0000000000bd', 'd3e1e1e1-0000-4000-8000-0000000000d3',
   'd3b1b1b1-0000-4000-8000-0000000000d3', 'd3d1d1d1-0000-4000-8000-0000000000d3', now() - interval '2 days'),
  ('d3f1f1f1-0000-4000-8000-0000000000ad', 'd3e1e1e1-0000-4000-8000-0000000000d3',
   'd3a1a1a1-0000-4000-8000-0000000000d3', 'd3d1d1d1-0000-4000-8000-0000000000d3', now() - interval '2 days'),
  ('d3f1f1f1-0000-4000-8000-0000000000bc', 'd3e1e1e1-0000-4000-8000-0000000000d3',
   'd3b1b1b1-0000-4000-8000-0000000000d3', 'd3c1c1c1-0000-4000-8000-0000000000d3', now() - interval '2 days'),
  ('d3f1f1f1-0000-4000-8000-0000000000ab', 'd3e1e1e1-0000-4000-8000-0000000000d3',
   'd3a1a1a1-0000-4000-8000-0000000000d3', 'd3b1b1b1-0000-4000-8000-0000000000d3', now() - interval '2 days');

set local role service_role;
select public.assegna_crediti_beta(p, 1000) from (values ('d3a1a1a1-0000-4000-8000-0000000000d3'::uuid),
  ('d3b1b1b1-0000-4000-8000-0000000000d3'::uuid), ('d3c1c1c1-0000-4000-8000-0000000000d3'::uuid),
  ('d3d1d1d1-0000-4000-8000-0000000000d3'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from public.porte, lateral (values (id, a), (id, b)) v(porta, persona)
  where stanza_id = 'd3e1e1e1-0000-4000-8000-0000000000d3';
update public.svelamenti set iniziato_il = now() - interval '2 days', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '2 days', esito = 'doppio_si', esito_il = now() - interval '2 days'
  where porta_id in (select id from public.porte where stanza_id = 'd3e1e1e1-0000-4000-8000-0000000000d3');
select public.apri_incontro(id) from public.porte where stanza_id = 'd3e1e1e1-0000-4000-8000-0000000000d3';
-- Tutte: solo «a» ha fatto «Sono qui» (in ad solo Dino, «b»). Ora 40 minuti fa (finestra finita), tranne ab (tra 10 minuti).
update public.incontri set stato = 'confermato', luogo_libero = 'Bar della piazza', proposto_il = now() - interval '2 days',
  confermato_il = now() - interval '2 days', proposto_da = (select a from public.porte p where p.id = porta_id),
  orario = case when porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ab' then now() + interval '10 minutes'
                else now() - interval '40 minutes' end,
  checkin_a_il = case when porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ad' then null else now() - interval '25 minutes' end,
  checkin_b_il = case when porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ad' then now() - interval '25 minutes' end
  where porta_id in (select id from public.porte where stanza_id = 'd3e1e1e1-0000-4000-8000-0000000000d3');
insert into public.contestazioni_buca (porta_id, persona, fase, testo, inviata_il) values
  ('d3f1f1f1-0000-4000-8000-0000000000ac', 'd3c1c1c1-0000-4000-8000-0000000000d3', 'prima_della_buca', 'Non riesco: niente rete.', now() - interval '20 minutes'),
  ('d3f1f1f1-0000-4000-8000-0000000000bd', 'd3d1d1d1-0000-4000-8000-0000000000d3', 'prima_della_buca', 'Non riesco: niente rete.', now() - interval '20 minutes'),
  ('d3f1f1f1-0000-4000-8000-0000000000ab', 'd3b1b1b1-0000-4000-8000-0000000000d3', 'prima_della_buca', 'Non riesco: niente rete.', now() - interval '1 minute');
-- Buche pagate (ad: Anna manca; bc: Ciro manca), poi «Ero lì».
select public.incontro_aggiornato(id) from public.porte where stanza_id = 'd3e1e1e1-0000-4000-8000-0000000000d3';
insert into public.contestazioni_buca (porta_id, persona, fase, testo) values
  ('d3f1f1f1-0000-4000-8000-0000000000ad', 'd3a1a1a1-0000-4000-8000-0000000000d3', 'dopo_buca', 'Ero lì al bancone, nessuno è arrivato.'),
  ('d3f1f1f1-0000-4000-8000-0000000000bc', 'd3c1c1c1-0000-4000-8000-0000000000d3', 'dopo_buca', 'Ero lì al bancone, nessuno è arrivato.');
create temp table saldi_prima as select persona, public.saldo_crediti(persona) saldo from
  (select distinct persona from public.crediti_movimenti) p;
reset role;
grant select on saldi_prima to service_role;
create function pg_temp.id_di(p_porta uuid) returns uuid language sql as $$
  select id from public.contestazioni_buca where porta_id = p_porta $$;
create function pg_temp.saldo(p uuid) returns integer language sql as $$ select public.saldo_crediti(p) $$;
create function pg_temp.prima(p uuid) returns integer language sql as $$ select saldo from saldi_prima where persona = p $$;

-- Il telefono non decide.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.decidi_contestazione_buca(gen_random_uuid(),
  'd3e3e3e3-0000-4000-8000-0000000000d3', true)$$), 'decidi buca: il telefono non la chiama');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.decidi_contestazione_buca(gen_random_uuid(),
  'd3e3e3e3-0000-4000-8000-0000000000d3', true)$$), 'decidi buca: chiave anon rifiutata');
reset role;

set local role service_role;
select pg_temp.ok((select esito = 'contestato' from public.incontri where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ac'),
  'preparazione: caso 1 in esito contestato');
-- Elenco per il pannello: solo moderatori; nome di chi contesta, fase, testo, ora dell'incontro, se si può già decidere,
-- se la porta è «tua». Mai l'altra persona né id della porta.
select pg_temp.ok(pg_temp.rifiutato($q$select * from public.contestazioni_buca_da_decidere('d3c1c1c1-0000-4000-8000-0000000000d3')$q$),
  'elenco: chi non è moderatore non legge');
create temp table e on commit drop as select * from public.contestazioni_buca_da_decidere('d3e3e3e3-0000-4000-8000-0000000000d3');
select pg_temp.ok((select count(*) = 5 from e), 'elenco: cinque contestazioni in attesa');
select pg_temp.ok((select nome = 'Ciro' and fase = 'prima_della_buca' and testo = 'Non riesco: niente rete.' and decidibile
  and orario is not null and inviata_il is not null and not tua from e where id = pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac')),
  'elenco: nome di chi contesta, fase, testo, ora, decidibile');
select pg_temp.ok((select not decidibile from e where id = pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ab')),
  'elenco: finestra ancora aperta → non ancora decidibile');
select pg_temp.ok((select to_jsonb(e)::text not like '%d3f1f1f1%' and to_jsonb(e)::text not like '%Anna%'
  from e where id = pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac')), 'elenco: mai l''altra persona né la porta');
select pg_temp.ok((select tua from public.contestazioni_buca_da_decidere('d3a1a1a1-0000-4000-8000-0000000000d3')
  where id = pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac')), 'elenco: la porta del moderatore è segnata «tua»');

-- Chi non può decidere.
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac'),
  'd3c1c1c1-0000-4000-8000-0000000000d3', true) = 'non_moderatore', 'decidi: chi non è moderatore no');
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac'),
  'd3a1a1a1-0000-4000-8000-0000000000d3', true) = 'propria', 'decidi: un moderatore della stessa porta no');
select pg_temp.ok(public.decidi_contestazione_buca(gen_random_uuid(), 'd3e3e3e3-0000-4000-8000-0000000000d3', true)
  = 'non_trovata', 'decidi: contestazione che non c''è');
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ab'),
  'd3e3e3e3-0000-4000-8000-0000000000d3', true) = 'non_ancora', 'decidi: finestra ancora aperta, non si decide');
select pg_temp.ok((select stato = 'in_attesa' from public.contestazioni_buca where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ab'),
  'decidi: «non ancora» non cambia nulla');

-- Caso 1 accolto: 100 a entrambi, nessun 70/30.
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac'),
  'd3e3e3e3-0000-4000-8000-0000000000d3', true) = 'accolta', 'caso 1 accolto');
select pg_temp.ok(pg_temp.saldo('d3a1a1a1-0000-4000-8000-0000000000d3') = pg_temp.prima('d3a1a1a1-0000-4000-8000-0000000000d3') + 100
  and pg_temp.saldo('d3c1c1c1-0000-4000-8000-0000000000d3') = pg_temp.prima('d3c1c1c1-0000-4000-8000-0000000000d3') + 100,
  'caso 1 accolto: +100 a entrambi');
select pg_temp.ok(not exists (select 1 from public.crediti_movimenti where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ac'
  and tipo = 'buca_ricevuta') and (select crediti_presente = 0 from public.incontri where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ac'),
  'caso 1 accolto: nessun 70, nessun 30');
select pg_temp.ok((select stato = 'accolta' and deciso_da = 'd3e3e3e3-0000-4000-8000-0000000000d3' and deciso_il is not null
  from public.contestazioni_buca where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ac'), 'caso 1 accolto: chi e quando');
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ac'),
  'd3e3e3e3-0000-4000-8000-0000000000d3', false) = 'gia_decisa'
  and (select count(*) = 4 from public.crediti_movimenti where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ac'),
  'caso 1: una seconda decisione è rifiutata e non muove crediti');

-- Caso 1 respinto: buca normale.
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000bd'),
  'd3e3e3e3-0000-4000-8000-0000000000d3', false) = 'respinta', 'caso 1 respinto');
select pg_temp.ok((select esito = 'buca_b' and crediti_presente = 30 from public.incontri where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000bd'),
  'caso 1 respinto: buca di chi mancava, 30 a Presente');
select pg_temp.ok(pg_temp.saldo('d3b1b1b1-0000-4000-8000-0000000000d3') = pg_temp.prima('d3b1b1b1-0000-4000-8000-0000000000d3') + 170
  and pg_temp.saldo('d3d1d1d1-0000-4000-8000-0000000000d3') = pg_temp.prima('d3d1d1d1-0000-4000-8000-0000000000d3'),
  'caso 1 respinto: 100 + 70 a chi ha aspettato, nulla a chi mancava');

-- Caso 2: buca già pagata.
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000bc'),
  'd3e3e3e3-0000-4000-8000-0000000000d3', false) = 'respinta'
  and (select count(*) = 4 from public.crediti_movimenti where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000bc'),
  'caso 2 respinto: nessun movimento');
select pg_temp.ok(public.decidi_contestazione_buca(pg_temp.id_di('d3f1f1f1-0000-4000-8000-0000000000ad'),
  'd3e3e3e3-0000-4000-8000-0000000000d3', true) = 'in_attesa_d156'
  and (select count(*) = 4 from public.crediti_movimenti where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ad')
  and (select stato = 'in_attesa' from public.contestazioni_buca where porta_id = 'd3f1f1f1-0000-4000-8000-0000000000ad'),
  'caso 2 accolto: in attesa di D156, nulla si muove');
select pg_temp.ok((select count(*) = 2 from public.contestazioni_buca_da_decidere('d3e3e3e3-0000-4000-8000-0000000000d3')),
  'elenco: le decise escono, restano «non ancora» e quella in attesa di D156');
reset role;
rollback;
