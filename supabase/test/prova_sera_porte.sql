-- Test della sera delle porte nel database (issue #5, spec v1.1 del CPO, D14 A, D51 A). Linea «sviluppatore-c».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: con 12 profili e chiavi incrociate note, alla chiusura si aprono esattamente le porte reciproche, tutte nello
-- stesso istante (anche con il cambio d'ora); non restano chiavi non ricambiate né frasi; solo conteggi per i report.
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
-- Persona n (1..14) della prova.
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('c0c0c0c0-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'sp' || n || '@example.com' from generate_series(1, 14) n;
insert into public.profili (id, nome, data_nascita, citta)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'Milano' from generate_series(1, 14) n;
-- Stanza A: chiusa un minuto fa (12 persone). Stanza B: chiusa domenica 29/3 alle 21 di Roma, la sera del cambio d'ora
-- (19:00 UTC). Stanza C: ancora aperta (persone 13 e 14), non si tocca.
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-00000000000a', 'italia', now() - interval '7 days', now() - interval '1 minute'),
  ('7e7e7e7e-0000-4000-8000-00000000000b', 'italia', '2026-03-23 08:00+00', '2026-03-29 19:00+00'),
  ('7e7e7e7e-0000-4000-8000-00000000000c', 'italia', now() - interval '1 day', now() + interval '6 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select '7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(n) from generate_series(1, 12) n;
insert into public.membri_stanza (stanza_id, utente_id) values
  ('7e7e7e7e-0000-4000-8000-00000000000b', pg_temp.p(1)), ('7e7e7e7e-0000-4000-8000-00000000000b', pg_temp.p(2)),
  ('7e7e7e7e-0000-4000-8000-00000000000c', pg_temp.p(13)), ('7e7e7e7e-0000-4000-8000-00000000000c', pg_temp.p(14));
-- Chiavi della stanza A (12 in tutto). Reciproche: 1↔2 (con le due frasi), 3↔4 (frase solo di 4), 10↔11.
-- Non ricambiate: 5→6, 6→7, 12→1, 12→3, 8→9, 9→10. 7 non ne ha date.
insert into public.chiavi (stanza_id, da, a, frase) values
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(1), pg_temp.p(2), 'Ridiamo ancora del treno?'),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(2), pg_temp.p(1), 'La tua risata!'),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(3), pg_temp.p(4), null),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(4), pg_temp.p(3), 'Il libro, poi.'),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(10), pg_temp.p(11), null),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(11), pg_temp.p(10), null),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(5), pg_temp.p(6), 'Frase segreta 5'),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(6), pg_temp.p(7), null),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(12), pg_temp.p(1), 'Frase segreta 12'),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(12), pg_temp.p(3), null),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(8), pg_temp.p(9), null),
  ('7e7e7e7e-0000-4000-8000-00000000000a', pg_temp.p(9), pg_temp.p(10), null),
  ('7e7e7e7e-0000-4000-8000-00000000000b', pg_temp.p(1), pg_temp.p(2), null),
  ('7e7e7e7e-0000-4000-8000-00000000000b', pg_temp.p(2), pg_temp.p(1), null),
  ('7e7e7e7e-0000-4000-8000-00000000000c', pg_temp.p(13), pg_temp.p(14), null),
  ('7e7e7e7e-0000-4000-8000-00000000000c', pg_temp.p(14), pg_temp.p(13), null);

-- Il telefono non apre le porte e non legge i conteggi.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select public.apri_porte()$$)
  and pg_temp.rifiutato($$select * from public.serate_porte$$),
  'sera: il telefono non apre le porte e non legge i conteggi (solo il server)');
reset role;

set local role service_role;
create temp table esito_sera on commit drop as select public.apri_porte() as esito;
reset role;
select pg_temp.ok((select esito from esito_sera) = '{"stanze": 2, "chiavi_date": 14, "porte_aperte": 4}'::jsonb,
  'sera: in uscita solo numeri (2 stanze chiuse, 14 chiavi date, 4 porte)');
select pg_temp.ok((select array_agg(least(a, b)::text || '-' || greatest(a, b)::text order by a, b) from public.porte
  where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000a')
  = array[pg_temp.p(1) || '-' || pg_temp.p(2), pg_temp.p(3) || '-' || pg_temp.p(4), pg_temp.p(10) || '-' || pg_temp.p(11)],
  'sera: nella stanza A si aprono esattamente le porte reciproche 1-2, 3-4, 10-11');
select pg_temp.ok((select count(distinct aperta_il) from public.porte where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000a') = 1
  and (select min(aperta_il) from public.porte where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000a')
    = (select chiude_il from public.stanze where id = '7e7e7e7e-0000-4000-8000-00000000000a'),
  'sera: tutte le porte della stanza si aprono nello stesso istante, quello della chiusura');
select pg_temp.ok((select frase_di_a from public.porte where a = pg_temp.p(1) and b = pg_temp.p(2)
    and stanza_id = '7e7e7e7e-0000-4000-8000-00000000000a') = 'Ridiamo ancora del treno?'
  and (select frase_di_b from public.porte where a = pg_temp.p(1) and b = pg_temp.p(2)
    and stanza_id = '7e7e7e7e-0000-4000-8000-00000000000a') = 'La tua risata!'
  and (select frase_di_a is null and frase_di_b = 'Il libro, poi.' from public.porte where a = pg_temp.p(3) and b = pg_temp.p(4)),
  'sera: ogni frase passa nella porta dalla parte di chi l''ha scritta');
select pg_temp.ok((select aperta_il from public.porte where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000b') = '2026-03-29 19:00+00'
  and (select to_char(aperta_il at time zone 'Europe/Rome', 'HH24:MI') from public.porte
       where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000b') = '21:00',
  'sera: la sera del cambio d''ora la porta si apre alle 21:00 di Roma');
select pg_temp.ok(not exists (select 1 from public.chiavi where stanza_id in
    ('7e7e7e7e-0000-4000-8000-00000000000a', '7e7e7e7e-0000-4000-8000-00000000000b')),
  'sera: delle stanze chiuse non restano chiavi né frasi non ricambiate');
select pg_temp.ok((select count(*) from public.chiavi where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000c') = 2
  and not exists (select 1 from public.porte where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000c'),
  'sera: la stanza ancora aperta non si tocca');
select pg_temp.ok((select (chiavi_date, porte_aperte)::text from public.serate_porte
  where stanza_id = '7e7e7e7e-0000-4000-8000-00000000000a') = '(12,3)',
  'sera: per i report restano solo i conteggi della stanza (12 chiavi date, 3 porte)');
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'serate_porte') is not distinct from
  array['chiavi_date', 'fatta_il', 'porte_aperte', 'stanza_id'],
  'sera: nei conteggi nessuna persona, solo numeri per stanza');

-- Una seconda chiamata (o il lavoro che riparte) non apre di nuovo nulla.
set local role service_role;
create temp table seconda_sera on commit drop as select public.apri_porte() as esito;
reset role;
select pg_temp.ok((select esito from seconda_sera) = '{"stanze": 0, "chiavi_date": 0, "porte_aperte": 0}'::jsonb
  and (select count(*) from public.porte where stanza_id in
    ('7e7e7e7e-0000-4000-8000-00000000000a', '7e7e7e7e-0000-4000-8000-00000000000b')) = 4,
  'sera: rifatta, non apre porte doppie');
-- Le porte si leggono con le funzioni già usate da svelamento (#65) e incontro (#6).
set local role service_role;
select pg_temp.ok((select frase_per_te from public.porte_di(pg_temp.p(4))) is null
  and (select frase_per_te from public.porte_di(pg_temp.p(3))) = 'Il libro, poi.'
  and exists (select 1 from public.porta_aperta(pg_temp.p(11), pg_temp.p(10)))
  and not exists (select 1 from public.porta_aperta(pg_temp.p(12), pg_temp.p(1))),
  'sera: le porte nuove si leggono con porte_di e porta_aperta; nessuno scopre un no');
reset role;
rollback;
