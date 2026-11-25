-- Test di «Arrivo in ritardo» (issue #6, spec v1 del CPO del 3/11, «Casi limite»): +15 o +30 minuti, una volta sola per
-- incontro, sposta la finestra del check-in. ritardo_incontro(porta, persona, minuti) la chiama SOLO il server; lo stato
-- dice al telefono se mostrare «Arrivo in ritardo» (azione «ritardo») e se il ritardo è suo (mai l'id dell'altra
-- persona). Linea «sviluppatore-b». Dati inventati, Postgres di prova.
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
select pg_temp.ok(pg_temp.rifiutato($$select public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac',
  '8a8a8a8a-0000-4000-8000-00000000008a', 15)$$), 'ritardo: il telefono non lo chiama, passa dal Worker');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac',
  '8a8a8a8a-0000-4000-8000-00000000008a', 15)$$), 'ritardo: chiave anon rifiutata');
reset role;

set local role service_role;
-- Errori: chi non è nella porta, senza appuntamento confermato, minuti non previsti.
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8b8b8b8b-0000-4000-8000-00000000008b', 15)
  = 'non_nella_porta', 'ritardo: chi non è nella porta no');
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a', 15)
  = 'non_confermato', 'ritardo: senza appuntamento confermato no');
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a', 20)
  = 'ritardo_non_valido', 'ritardo: solo 15 o 30 minuti');
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a', null)
  = 'ritardo_non_valido', 'ritardo: minuti mancanti no');

-- Lo stato prima: «ritardo» tra le azioni di tutti e due, nessun ritardo dichiarato.
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a')
  -> 'azioni') ? 'ritardo', 'stato: Anna vede «Arrivo in ritardo»');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c')
  -> 'azioni') ? 'ritardo', 'stato: anche Ciro vede «Arrivo in ritardo»');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ad', '8a8a8a8a-0000-4000-8000-00000000008a')
  -> 'azioni') ? 'ritardo' is false, 'stato: senza appuntamento confermato nessun «Arrivo in ritardo»');

-- Anna arriva in ritardo di 30 minuti: la finestra del check-in si allunga di 30 minuti.
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a', 30)
  = 'ritardo', 'ritardo: Anna +30 minuti');
select pg_temp.ok((select ritardo_minuti = 30 and ritardo_di = '8a8a8a8a-0000-4000-8000-00000000008a' and stato = 'confermato'
  and esito is null from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac'), 'ritardo: salvato 30 minuti, di Anna');
select pg_temp.ok((select (s ->> 'checkin_fino')::timestamptz = i.orario + interval '60 minutes'
  from public.incontri i, public.stato_incontro(i.porta_id, '8c8c8c8c-0000-4000-8000-00000000008c') s
  where i.porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac'), 'stato: la finestra ora finisce 60 minuti dopo l''ora');
-- Una volta sola per incontro, per chiunque dei due.
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a', 15)
  = 'ritardo_gia_usato', 'ritardo: Anna non può dichiararlo due volte');
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c', 15)
  = 'ritardo_gia_usato', 'ritardo: una volta sola per incontro, anche per Ciro');
select pg_temp.ok((select ritardo_minuti = 30 from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac'),
  'ritardo: resta 30 minuti');
-- Lo stato dopo: nessuno vede più «Arrivo in ritardo»; Anna sa che è suo, Ciro no; mai l'id di chi l'ha dichiarato.
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a')
  -> 'azioni') ? 'ritardo' is false, 'stato: dopo il ritardo Anna non lo vede più');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c')
  -> 'azioni') ? 'ritardo' is false, 'stato: dopo il ritardo neanche Ciro');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8a8a8a8a-0000-4000-8000-00000000008a')
  ->> 'ritardo_mio')::boolean, 'stato: per Anna il ritardo è suo');
select pg_temp.ok(not (public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c')
  ->> 'ritardo_mio')::boolean, 'stato: per Ciro il ritardo è dell''altra persona');
select pg_temp.ok(public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c')::text
  !~ '8a8a8a8a-0000-4000-8000-00000000008a', 'stato: mai l''id di chi ha dichiarato il ritardo');

-- Chi ha già fatto il check-in non dichiara un ritardo: è già lì.
select pg_temp.ok(public.checkin_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  = 'sono_qui', 'check-in: Bea «Sono qui»');
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b', 15)
  = 'gia_fatto', 'ritardo: chi è già lì no');
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8b8b8b8b-0000-4000-8000-00000000008b')
  -> 'azioni') ? 'ritardo' is false, 'stato: chi è già lì non vede «Arrivo in ritardo»');
-- Dino, non ancora arrivato, può: la finestra si allunga di 15 minuti.
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000bd', '8d8d8d8d-0000-4000-8000-00000000008d', 15)
  = 'ritardo', 'ritardo: Dino +15 minuti');

-- Dopo la fine della finestra senza ritardo non si può più (troppo tardi): finestra 30 minuti dopo l'ora, fine esclusa.
update public.incontri set orario = now() - interval '29 minutes', ritardo_minuti = 0, ritardo_di = null
  where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac';
select pg_temp.ok((public.stato_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c')
  -> 'azioni') ? 'ritardo', 'stato: 29 minuti dopo l''ora si può ancora dire «Arrivo in ritardo»');
update public.incontri set orario = now() - interval '30 minutes' where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac';
select pg_temp.ok(public.ritardo_incontro('8f8f8f8f-0000-4000-8000-0000000000ac', '8c8c8c8c-0000-4000-8000-00000000008c', 15)
  in ('troppo_tardi', 'incontro_chiuso'), 'ritardo: a finestra chiusa no');
select pg_temp.ok((select ritardo_minuti = 0 from public.incontri where porta_id = '8f8f8f8f-0000-4000-8000-0000000000ac'),
  'ritardo: a finestra chiusa non si salva nulla');
reset role;
rollback;
