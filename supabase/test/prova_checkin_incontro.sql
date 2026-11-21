-- Test del check-in «Sono qui» e del segnale (issue #6, spec v1 del CPO del 3/11, punto 6 e «Regole»).
-- checkin_incontro(porta, persona): solo a incontro confermato, da 30 minuti prima a 30 minuti dopo l'ora (più il
-- ritardo dichiarato), anche via API. Al secondo check-in: la stessa parola per tutti e due (dalla lista di 200 parole
-- neutre), esito «avvenuto» e caparre sbloccate subito. Solo l'orario, mai una posizione. Linea «sviluppatore-b».
-- Dati inventati, Postgres di prova.
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
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'ka@example.com'), ('7b7b7b7b-0000-4000-8000-00000000007b', 'kb@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'kc@example.com'), ('7d7d7d7d-0000-4000-8000-00000000007d', 'kd@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'Anna', '1990-01-01', 'TO', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000007b', 'Bea', '1988-06-01', 'TO', 'donna'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'Ciro', '1985-01-01', 'TO', 'uomo'),
  ('7d7d7d7d-0000-4000-8000-00000000007d', 'Dino', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6e6e6e6e-0000-4000-8000-000000000007', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Anna-Ciro (incontro tra 10 minuti), Bea-Dino (incontro tra 2 ore, poi con ritardo), Anna-Dino (da fissare).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('7f7f7f7f-0000-4000-8000-0000000000ac', '6e6e6e6e-0000-4000-8000-000000000007',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7c7c7c7c-0000-4000-8000-00000000007c', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-0000000000bd', '6e6e6e6e-0000-4000-8000-000000000007',
   '7b7b7b7b-0000-4000-8000-00000000007b', '7d7d7d7d-0000-4000-8000-00000000007d', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-0000000000ad', '6e6e6e6e-0000-4000-8000-000000000007',
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
-- Incontri già confermati (gli orari vicini a «adesso» non si possono proporre: si scrivono direttamente).
update public.incontri set stato = 'confermato', orario = now() + interval '10 minutes', luogo_libero = 'Bar della piazza',
  proposto_da = '7a7a7a7a-0000-4000-8000-00000000007a', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac';
update public.incontri set stato = 'confermato', orario = now() + interval '2 hours', luogo_libero = 'Caffè del parco',
  proposto_da = '7b7b7b7b-0000-4000-8000-00000000007b', proposto_il = now() - interval '1 day', confermato_il = now() - interval '20 hours'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000bd';
reset role;

-- La lista delle parole: 200, tutte diverse, chiusa al telefono.
select pg_temp.ok((select count(*) = 200 and count(distinct lower(parola)) = 200 from public.parole_segnale),
  'segnale: 200 parole tutte diverse');
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select count(*) from public.parole_segnale$$), 'segnale: il telefono non legge la lista');
select pg_temp.ok(pg_temp.rifiutato($$select public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ac',
  '7a7a7a7a-0000-4000-8000-00000000007a')$$), 'check-in: il telefono non lo chiama, passa dal Worker');
reset role;

set local role service_role;
-- Chi non è nella porta, incontro non confermato, incontro non aperto.
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7b7b7b7b-0000-4000-8000-00000000007b')
  = 'non_nella_porta', 'check-in: chi non è nella porta no');
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ad', '7a7a7a7a-0000-4000-8000-00000000007a')
  = 'non_confermato', 'check-in: senza appuntamento confermato no');

-- Troppo presto: 2 ore prima (la finestra apre 30 minuti prima).
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000bd', '7b7b7b7b-0000-4000-8000-00000000007b')
  = 'troppo_presto', 'check-in: 2 ore prima è troppo presto');
-- 31 minuti prima: ancora presto; 30 minuti prima: si può.
update public.incontri set orario = now() + interval '31 minutes' where porta_id = '7f7f7f7f-0000-4000-8000-0000000000bd';
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000bd', '7b7b7b7b-0000-4000-8000-00000000007b')
  = 'troppo_presto', 'check-in: 31 minuti prima è troppo presto');
-- Con il ritardo di 15 minuti la finestra si allunga: 30 minuti dopo l'ora si può ancora. (Senza ritardo, 30 minuti
-- dopo è troppo tardi e l'incontro si chiude: lo prova prova_buca_incontro.sql, passo 2j.)
update public.incontri set orario = now() - interval '30 minutes', ritardo_minuti = 15, ritardo_di = '7d7d7d7d-0000-4000-8000-00000000007d'
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000bd';
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000bd', '7b7b7b7b-0000-4000-8000-00000000007b')
  = 'sono_qui', 'check-in: con «Arrivo in ritardo» +15 la finestra si allunga');
select pg_temp.ok((select checkin_a_il is not null and checkin_b_il is null and segnale is null and esito is null
  from public.incontri where porta_id = '7f7f7f7f-0000-4000-8000-0000000000bd'), 'check-in: segnato solo per Bea, ancora nessun segnale');

-- Anna arriva per prima (10 minuti prima): nessun segnale, crediti ancora bloccati.
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a')
  = 'sono_qui', 'check-in: Anna «Sono qui»');
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a')
  = 'gia_fatto', 'check-in: il secondo tocco non cambia nulla');
select pg_temp.ok((select segnale is null and esito is null and stato = 'confermato' from public.incontri
  where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac'), 'check-in: con un solo check-in nessun segnale');
select pg_temp.ok(public.saldo_crediti('7a7a7a7a-0000-4000-8000-00000000007a') = 100
  and public.saldo_crediti('7c7c7c7c-0000-4000-8000-00000000007c') = 200, 'check-in: con uno solo le caparre restano bloccate');

-- Ciro arriva: segnale uguale per tutti e due (dalla lista), incontro avvenuto, caparre sbloccate subito.
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c')
  = 'avvenuto', 'check-in: Ciro «Sono qui», incontro avvenuto');
select pg_temp.ok((select i.segnale is not null and i.esito = 'avvenuto' and i.stato = 'concluso' and i.esito_il is not null
  and i.checkin_a_il is not null and i.checkin_b_il is not null and i.crediti_presente = 0
  and exists (select 1 from public.parole_segnale p where p.parola = i.segnale)
  from public.incontri i where i.porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac'), 'segnale: una parola della lista, esito avvenuto');
select pg_temp.ok(public.saldo_crediti('7a7a7a7a-0000-4000-8000-00000000007a') = 200
  and public.saldo_crediti('7c7c7c7c-0000-4000-8000-00000000007c') = 300, 'crediti: caparre sbloccate subito per entrambi');
-- Dopo: il check-in ripetuto non rimette crediti né cambia il segnale.
create temp table prima (segnale text) on commit drop;
insert into prima select segnale from public.incontri where porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac';
select pg_temp.ok(public.checkin_incontro('7f7f7f7f-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a')
  = 'avvenuto', 'check-in: dopo l''incontro risponde sempre «avvenuto»');
select pg_temp.ok((select i.segnale = p.segnale from public.incontri i, prima p
  where i.porta_id = '7f7f7f7f-0000-4000-8000-0000000000ac'), 'segnale: non cambia più');
select pg_temp.ok(public.saldo_crediti('7a7a7a7a-0000-4000-8000-00000000007a') = 200, 'crediti: nessuna restituzione doppia');

-- Nessuna posizione: la tabella degli incontri non ha colonne di luogo GPS.
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name = 'incontri' and column_name ~* '(lat|lon|lng|gps|posizione|coordinate)'), 'check-in: nessuna posizione salvata');
reset role;
rollback;
