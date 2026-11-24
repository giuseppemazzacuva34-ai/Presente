-- Test di «Lascia la stanza» nel database (issue #381, spec v1 del CPO del 23/11; design v4 schermata 22).
-- Linea «sviluppatore-b», passo 1. Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: un motivo tra cinque («altro» con testo da 3 a 300 caratteri); solo con la stanza aperta (lunedì 9:00 →
-- domenica 21:00, che è la chiusura della stanza); mai durante una chiamata in corso; si esce subito e per sempre da
-- quella stanza; gli altri non la vedono più e non possono più darle chiavi né regali; le chiavi date e ricevute in
-- quella stanza si annullano; nessun movimento di Coin (D153 A); il motivo lo legge solo il server.
\set ON_ERROR_STOP on
create function pg_temp.come(utente uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
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
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('1a5c1a5c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- true se il comando (una funzione che risponde con un codice) non dà 'ok': codice diverso o errore.
create function pg_temp.non_ok(comando text) returns boolean language plpgsql as $$
declare r text;
begin
  execute comando into r;
  return r is distinct from 'ok';
exception when others then
  return true;
end $$;
create function pg_temp.vede(chi uuid) returns text[] language plpgsql as $$
declare r text[];
begin
  perform pg_temp.come(chi);
  select coalesce(array_agg(nome order by nome), '{}') into r from public.compagni_di_stanza();
  reset role;
  return r;
end $$;

begin;
-- Stanza A aperta: Ada (1), Bea (2), Ugo (3), Leo (4). Cia (5) nella stanza B, chiusa da un'ora (domenica dopo le 21).
-- Dan (6) nella stanza C aperta, in chiamata adesso con Eva (7).
insert into auth.users (id, email) select pg_temp.p(n), 'lascia' || n || '@example.com' from generate_series(1, 7) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Ada', '1990-01-01', 'MI', 'donna'), (pg_temp.p(2), 'Bea', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(3), 'Ugo', '1990-01-01', 'MI', 'uomo'), (pg_temp.p(4), 'Leo', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(5), 'Cia', '1990-01-01', 'MI', 'donna'), (pg_temp.p(6), 'Dan', '1990-01-01', 'MI', 'uomo'),
  (pg_temp.p(7), 'Eva', '1990-01-01', 'MI', 'donna');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select id, case when mi_presento_come = 'uomo' then 'donne' else 'uomini' end, now(), '1.5', 25, 50, 'italia'
  from public.profili where id in (select pg_temp.p(n) from generate_series(1, 7) n);
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('1a5c1a5c-5555-4000-8000-00000000000a', 'italia', now() - interval '2 days', now() + interval '3 days'),
  ('1a5c1a5c-5555-4000-8000-00000000000b', 'italia', now() - interval '6 days 12 hours', now() - interval '1 hour'),
  ('1a5c1a5c-5555-4000-8000-00000000000c', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id) values
  ('1a5c1a5c-5555-4000-8000-00000000000a', pg_temp.p(1)), ('1a5c1a5c-5555-4000-8000-00000000000a', pg_temp.p(2)),
  ('1a5c1a5c-5555-4000-8000-00000000000a', pg_temp.p(3)), ('1a5c1a5c-5555-4000-8000-00000000000a', pg_temp.p(4)),
  ('1a5c1a5c-5555-4000-8000-00000000000b', pg_temp.p(5)),
  ('1a5c1a5c-5555-4000-8000-00000000000c', pg_temp.p(6)), ('1a5c1a5c-5555-4000-8000-00000000000c', pg_temp.p(7));
insert into public.chiamate (chi, con, inizio) values (pg_temp.p(6), pg_temp.p(7), now() - interval '3 minutes');
-- Chiamate già finite nella stanza A (servono per dare le chiavi).
insert into public.chiamate (chi, con, inizio, durata, esito) values
  (pg_temp.p(3), pg_temp.p(1), now() - interval '1 day', 300, 'chiusa'), (pg_temp.p(4), pg_temp.p(1), now() - interval '1 day 1 hour', 300, 'chiusa'),
  (pg_temp.p(3), pg_temp.p(2), now() - interval '1 day 2 hours', 300, 'chiusa'), (pg_temp.p(4), pg_temp.p(2), now() - interval '1 day 3 hours', 300, 'chiusa');

-- 0. Il telefono non legge i motivi e non lancia la funzione: tutto passa dal server.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.lasciate_stanza$$)
  and pg_temp.rifiutato($$select public.lascia_stanza(auth.uid(), 'tempo', null)$$)
  and pg_temp.rifiutato($$select public.ha_lasciato(auth.uid(), '1a5c1a5c-5555-4000-8000-00000000000a')$$),
  'lascia: il telefono non legge i motivi e non lancia le funzioni (solo il server)');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.lasciate_stanza$$), 'lascia: la chiave anon non legge i motivi');
reset role;

set local role service_role;
-- Prima: chiavi Ada → Ugo e Leo → Ada, Bea → Ugo.
select pg_temp.ok(public.dai_chiave(pg_temp.p(1), pg_temp.p(3), null) = 'ok' and public.dai_chiave(pg_temp.p(4), pg_temp.p(1), null) = 'ok'
  and public.dai_chiave(pg_temp.p(2), pg_temp.p(3), null) = 'ok', 'lascia: (prima) chiavi date nella stanza A');
reset role;
select pg_temp.ok(pg_temp.vede(pg_temp.p(3)) = array['Ada', 'Bea'], 'lascia: (prima) Ugo vede Ada e Bea');
select count(*) as movimenti_prima from public.crediti_movimenti \gset
set local role service_role;

-- 1. Motivo e testo: uno dei cinque; «altro» solo con un testo da 3 a 300 caratteri.
select pg_temp.ok(public.lascia_stanza(pg_temp.p(1), null, null) = 'non_valida'
  and public.lascia_stanza(pg_temp.p(1), 'noia', null) = 'non_valida'
  and public.lascia_stanza(pg_temp.p(1), 'altro', null) = 'non_valida'
  and public.lascia_stanza(pg_temp.p(1), 'altro', '  ab  ') = 'non_valida'
  and public.lascia_stanza(pg_temp.p(1), 'altro', repeat('x', 301)) = 'non_valida'
  and public.lascia_stanza(null, 'tempo', null) = 'non_valida',
  'lascia: senza motivo, con un motivo sconosciuto o con «altro» sotto i 3 o sopra i 300 caratteri → rifiutato');
reset role;
select pg_temp.ok(not exists (select 1 from public.lasciate_stanza), 'lascia: un rifiuto non salva niente');
set local role service_role;

-- 2. Fuori orario e fuori stanza: dopo la chiusura della domenica (21:00) non si esce, chi non è in stanza nemmeno.
select pg_temp.ok(public.lascia_stanza(pg_temp.p(5), 'tempo', null) = 'non_nella_stanza',
  'lascia: dopo la chiusura della stanza (domenica dalle 21:00) → rifiutato');

-- 3. Mai durante una chiamata in corso (chi chiama e chi risponde).
select pg_temp.ok(public.lascia_stanza(pg_temp.p(6), 'tempo', null) = 'in_chiamata'
  and public.lascia_stanza(pg_temp.p(7), 'tempo', null) = 'in_chiamata',
  'lascia: durante una chiamata in corso → «in_chiamata», per tutti e due');

-- 4. Ada esce con «altro»: il testo si salva pulito; Ugo con «tempo»: un testo mandato per errore non si salva.
select pg_temp.ok(public.lascia_stanza(pg_temp.p(1), 'altro', '  Cambio città  ') = 'ok', 'lascia: Ada lascia la stanza');
select pg_temp.ok(public.lascia_stanza(pg_temp.p(3), 'tempo', 'non dovrebbe restare') = 'ok', 'lascia: Ugo lascia la stanza');
reset role;
select pg_temp.ok((select motivo = 'altro' and testo = 'Cambio città' from public.lasciate_stanza where persona = pg_temp.p(1))
  and (select motivo = 'tempo' and testo is null from public.lasciate_stanza where persona = pg_temp.p(3)),
  'lascia: salvati stanza, persona, codice del motivo e testo solo per «altro»');
set local role service_role;

-- 5. Per sempre: non si esce due volte e non si rientra.
select pg_temp.ok(public.lascia_stanza(pg_temp.p(1), 'tempo', null) = 'non_nella_stanza'
  and public.stanza_aperta_di(pg_temp.p(1)) is null
  and public.ha_lasciato(pg_temp.p(1), '1a5c1a5c-5555-4000-8000-00000000000a'),
  'lascia: chi è uscito non è più nella stanza aperta e non può uscire di nuovo');

-- 6. Le chiavi in quella stanza si annullano (date e ricevute); quelle tra gli altri restano. Niente chiavi nuove.
reset role;
select pg_temp.ok(not exists (select 1 from public.chiavi where da in (pg_temp.p(1), pg_temp.p(3)) or a in (pg_temp.p(1), pg_temp.p(3))),
  'lascia: le chiavi date e ricevute da chi esce si annullano');
set local role service_role;
select pg_temp.ok(public.dai_chiave(pg_temp.p(4), pg_temp.p(2), null) = 'ok', 'lascia: tra chi resta le chiavi funzionano');
select pg_temp.ok(pg_temp.non_ok($$select public.dai_chiave('1a5c1a5c-0000-4000-8000-000000000004', '1a5c1a5c-0000-4000-8000-000000000001', null)$$)
  and pg_temp.non_ok($$select public.dai_chiave('1a5c1a5c-0000-4000-8000-000000000001', '1a5c1a5c-0000-4000-8000-000000000004', null)$$),
  'lascia: nessuna chiave nuova da o verso chi è uscito');
reset role;
select pg_temp.ok(pg_temp.rifiutato($$insert into public.chiavi (stanza_id, da, a)
  values ('1a5c1a5c-5555-4000-8000-00000000000a', '1a5c1a5c-0000-4000-8000-000000000004', '1a5c1a5c-0000-4000-8000-000000000001')$$),
  'lascia: neanche scrivendo direttamente nella tabella delle chiavi');

-- 7. Gli altri non la vedono più; chi è uscito non vede più nessuno.
select pg_temp.ok(pg_temp.vede(pg_temp.p(4)) = array['Bea'] and pg_temp.vede(pg_temp.p(1)) = '{}'::text[]
  and pg_temp.vede(pg_temp.p(3)) = '{}'::text[], 'lascia: chi resta non vede più chi è uscito; chi è uscito non vede nessuno');

-- 8. Niente regali da o verso chi è uscito.
set local role service_role;
select pg_temp.ok(pg_temp.non_ok($$select public.manda_regalo('1a5c1a5c-0000-4000-8000-000000000004', '1a5c1a5c-0000-4000-8000-000000000001', 'rosa', gen_random_uuid())$$),
  'lascia: nessun regalo a chi è uscito');
reset role;

-- 9. Coin (D153 A): nessun movimento.
select pg_temp.ok((select count(*) from public.crediti_movimenti) = :movimenti_prima, 'lascia: nessun movimento di Coin');

-- 10. Le altre stanze non cambiano.
select pg_temp.ok(pg_temp.vede(pg_temp.p(6)) = array['Eva'], 'lascia: nelle altre stanze non cambia niente');
rollback;
