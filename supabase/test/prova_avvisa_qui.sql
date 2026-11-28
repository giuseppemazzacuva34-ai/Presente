-- Test di «Avvisa <nome> che sei qui» (issue #6, spec v1 del CPO del 3/11, punto 6 «Check-in»): chi ha detto «Sono qui»
-- e aspetta, dopo 15 minuti può avvisare l'altra persona, una volta sola. avvisa_sono_qui(porta, persona) la chiama SOLO
-- il server; lo stato dice al telefono se mostrare il pulsante (azione «avvisa_qui»), da quando (avviso_qui_da) e se
-- l'avviso è partito (avvisato_mio) o è arrivato (avvisato_altro), mai id. Linea «sviluppatore-b». Dati inventati.
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
  ('8a8a8a8a-0000-4000-8000-00000000008a', 'ra@example.com'), ('8b8b8b8b-0000-4000-8000-00000000008b', 'rb@example.com'),
  ('8c8c8c8c-0000-4000-8000-00000000008c', 'rc@example.com'), ('8d8d8d8d-0000-4000-8000-00000000008d', 'rd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('8a8a8a8a-0000-4000-8000-00000000008a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('8b8b8b8b-0000-4000-8000-00000000008b', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('8c8c8c8c-0000-4000-8000-00000000008c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('8d8d8d8d-0000-4000-8000-00000000008d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000008', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (incontro tra 2 ore), Bea-Dino (incontro tra 10 minuti), Anna-Dino (da fissare).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8f8f8f8f-0000-4000-8000-0000000000ac', '6e6e6e6e-0000-4000-8000-000000000008',
   '8a8a8a8a-0000-4000-8000-00000000008a', '8c8c8c8c-0000-4000-8000-00000000008c', now() - interval '1 hour'),
  ('8f8f8f8f-0000-4000-8000-0000000000bd', '6e6e6e6e-0000-4000-8000-000000000008',
   '8b8b8b8b-0000-4000-8000-00000000008b', '8d8d8d8d-0000-4000-8000-00000000008d', now() - interval '1 hour'),
  ('8f8f8f8f-0000-4000-8000-0000000000ad', '6e6e6e6e-0000-4000-8000-000000000008',
   '8a8a8a8a-0000-4000-8000-00000000008a', '8d8d8d8d-0000-4000-8000-00000000008d', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta(p, 300) from (values ('8a8a8a8a-0000-4000-8000-00000000008a'::uuid),
  ('8b8b8b8b-0000-4000-8000-00000000008b'::uuid), ('8c8c8c8c-0000-4000-8000-00000000008c'::uuid),
  ('8d8d8d8d-0000-4000-8000-00000000008d'::uuid)) v(p);
select public.blocca_caparra(porta, persona) from (values
  ('8f8f8f8f-0000-4000-8000-0000000000ac'::uuid, '8a8a8a8a-0000-4000-8000-00000000008a'::uuid),
  ('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c'),
  ('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b'),
  ('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d'),
  ('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a'),
  ('8f8f8f8f-0000-4000-8000-0000000000ad', '8d8d8d8d-0000-4000-8000-00000000008d')) v(porta, persona);
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('8f8f8f8f-0000-4000-8000-0000000000ac', '8f8f8f8f-0000-4000-8000-0000000000bd',
                     '8f8f8f8f-0000-4000-8000-0000000000ad');
select public.apri_incontro(p) from (values ('8f8f8f8f-0000-4000-8000-0000000000ac'::uuid),
  ('8f8f8f8f-0000-4000-8000-0000000000bd'::uuid), ('8f8f8f8f-0000-4000-8000-0000000000ad'::uuid)) v(p);
update public.incontri set stato = 'confermato', orario = now() + interval '2 hours', luogo_libero = 'Bar della piazza',
  proposto_da = '8a8a8a8a-0000-4000-8000-00000000008a', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '10 minutes', luogo_libero = 'Caffè del parco',
  proposto_da = '8b8b8b8b-0000-4000-8000-00000000008b', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd';
reset role;

-- Il telefono non chiama la funzione: passa dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd',
  '8b8b8b8b-0000-4000-8000-00000000008b')$$), 'avvisa: il telefono non lo chiama, passa dal Worker');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd',
  '8b8b8b8b-0000-4000-8000-00000000008b')$$), 'avvisa: chiave anon rifiutata');
reset role;

set local role service_role;
-- Errori: chi non è nella porta, senza appuntamento confermato, senza il proprio «Sono qui».
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8a8a8a8a-0000-4000-8000-00000000008a')
  = 'non_nella_porta', 'avvisa: chi non è nella porta no');
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a')
  = 'non_confermato', 'avvisa: senza appuntamento confermato no');
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'non_ancora_qui', 'avvisa: senza il proprio «Sono qui» no');

-- Bea dice «Sono qui» 10 minuti prima dell'ora: non può ancora avvisare (15 minuti dopo l'ora).
select pg_temp.ok(public.checkin_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'sono_qui', 'check-in: Bea «Sono qui»');
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'troppo_presto', 'avvisa: prima dei 15 minuti no');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  -> 'azioni') ? 'avvisa_qui' is false, 'stato: prima dei 15 minuti nessun «Avvisa»');
select pg_temp.ok((select (s ->> 'avviso_qui_da')::timestamptz = i.orario + interval '15 minutes'
  from public.incontri i, public.stato_incontro(i.porta_id, '8b8b8b8b-0000-4000-8000-00000000008b') s
  where i.porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd'), 'stato: «Avvisa» da 15 minuti dopo l''ora');
select pg_temp.ok(public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d')
  -> 'avviso_qui_da' = 'null'::jsonb, 'stato: chi non è ancora lì non ha «avviso_qui_da»');

-- Bea è lì da 16 minuti, l'ora è passata da 14: si aspetta il quindicesimo minuto dopo l'ora.
update public.incontri set orario = now() - interval '14 minutes', checkin_a_il = now() - interval '16 minutes'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd';
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'troppo_presto', 'avvisa: 14 minuti dopo l''ora ancora no');
-- Arrivata tardi (5 minuti fa, 20 minuti dopo l'ora): i 15 minuti si contano dal suo «Sono qui».
update public.incontri set orario = now() - interval '25 minutes', checkin_a_il = now() - interval '5 minutes'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd';
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'troppo_presto', 'avvisa: arrivata da 5 minuti ancora no');
-- Se Dino ha detto «Arrivo in ritardo» (+30), i 15 minuti partono dall'ora spostata.
update public.incontri set orario = now() - interval '20 minutes', checkin_a_il = now() - interval '30 minutes',
  ritardo_minuti = 30, ritardo_di = '8d8d8d8d-0000-4000-8000-00000000008d'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd';
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'troppo_presto', 'avvisa: con il ritardo dell''altro si conta dall''ora spostata');
-- Ora: l'ora è passata da 20 minuti, Bea è lì da 30, nessun ritardo → può avvisare.
update public.incontri set ritardo_minuti = 0, ritardo_di = null where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd';
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  -> 'azioni') ? 'avvisa_qui', 'stato: Bea vede «Avvisa Dino che sei qui»');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d')
  -> 'azioni') ? 'avvisa_qui' is false, 'stato: Dino, non ancora lì, non vede «Avvisa»');
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d')
  = 'non_ancora_qui', 'avvisa: Dino non ancora lì no');
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'avvisato', 'avvisa: Bea avvisa Dino');
select pg_temp.ok((select avviso_qui_a_il is not null and avviso_qui_b_il is null from public.incontri
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd'), 'avvisa: salvato per Bea, non per Dino');
-- Una volta sola.
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'gia_avvisato', 'avvisa: una volta sola');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  -> 'azioni') ? 'avvisa_qui' is false, 'stato: dopo l''avviso il pulsante sparisce');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  ->> 'avvisato_mio')::boolean, 'stato: per Bea l''avviso è partito');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d')
  ->> 'avvisato_altro')::boolean, 'stato: Dino sa che Bea l''ha avvisato');
select pg_temp.ok(not (public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d')
  ->> 'avvisato_mio')::boolean, 'stato: Dino non ha avvisato nessuno');
select pg_temp.ok(public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d')::text
  !~ '8b8b8b8b-0000-4000-8000-00000000008b', 'stato: mai l''id di chi ha avvisato');

-- Se l'altra persona è già arrivata non serve avvisarla.
update public.incontri set orario = now() - interval '20 minutes', checkin_a_il = now() - interval '25 minutes'
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac';
select pg_temp.ok(public.checkin_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c')
  = 'avvenuto', 'check-in: Ciro «Sono qui», ora ci sono tutti e due');
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a')
  in ('gia_arrivato', 'incontro_chiuso'), 'avvisa: l''altra persona è già arrivata (incontro avvenuto), no');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a')
  -> 'azioni') ? 'avvisa_qui' is false, 'stato: con tutti e due lì nessun «Avvisa»');

-- A finestra chiusa (30 minuti dopo l'ora) non si avvisa più.
update public.incontri set orario = now() - interval '30 minutes', checkin_b_il = null, checkin_a_il = now() - interval '40 minutes',
  segnale = null, avviso_qui_a_il = null where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd';
select pg_temp.ok(public.avvisa_sono_qui('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  in ('troppo_tardi', 'incontro_chiuso'), 'avvisa: a finestra chiusa no');
select pg_temp.ok((select avviso_qui_a_il is null from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000bd'),
  'avvisa: a finestra chiusa non si salva nulla');
reset role;
rollback;
