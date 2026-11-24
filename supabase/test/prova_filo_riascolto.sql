-- Test di «Il vocale del Filo» nella stanza lato database (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 10a
-- della linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati,
-- orologio finto. Spec: dalla stanza, tutta la settimana, voce «Il vocale del Filo» per riascoltarlo; se il vocale
-- arriva dopo la schermata 18 (entro le 13:00) compare con un pallino rosso fino al primo ascolto.
-- Stanza: apre lunedì 23/3/2026 9:00 CET = 08:00 UTC, chiude domenica 29/3 21:00 CEST = 19:00 UTC.
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
create function pg_temp.errore(comando text) returns text language plpgsql as $$
begin
  execute comando;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('f5f5f5f5-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f5f5f5f5-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
-- Riga della voce «Il vocale del Filo» per la persona n all'ora data, come testo (null = nessuna voce).
create function pg_temp.voce(n integer, ora text) returns text language sql as $$
  select row(v.stanza_id, v.nuovo)::text from public.vocale_filo_stato(pg_temp.p(n), ora::timestamptz) v
$$;

begin;
-- p(1) Filo delle stanze 1 e 2; p(2), p(3), p(4), p(6) membri della stanza 1; p(5) membro della stanza 2 (vocale
-- mai caricato); p(7) membro della stanza 3 (senza Filo).
insert into auth.users (id, email) select pg_temp.p(n), 'fr' || n || '@example.com' from generate_series(1, 7) n;
insert into public.profili (id, nome, data_nascita, citta)
  select pg_temp.p(n), (array['Silvia', 'Anna', 'Bruno', 'Carla', 'Dario', 'Elena', 'Franco'])[n], '1990-01-01', 'Milano'
  from generate_series(1, 7) n;
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il)
  select pg_temp.s(n), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00'
  from generate_series(1, 3) n;
insert into public.membri_stanza (stanza_id, utente_id) values
  (pg_temp.s(1), pg_temp.p(2)), (pg_temp.s(1), pg_temp.p(3)), (pg_temp.s(1), pg_temp.p(4)), (pg_temp.s(1), pg_temp.p(6)),
  (pg_temp.s(2), pg_temp.p(5)), (pg_temp.s(3), pg_temp.p(7));
insert into public.fili_stanza (stanza_id, filo) values (pg_temp.s(1), pg_temp.p(1)), (pg_temp.s(2), pg_temp.p(1));
-- Il vocale del lunedì della stanza 1 arriva in ritardo: alle 11:00 CET (10:00 UTC).
insert into public.vocali_filo (stanza_id, tipo, file, durata, testo, caricato_il) values
  (pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/lun.webm', 70, 'Benvenuti', '2026-03-23 10:00+00');
-- p(2) ha visto la schermata 18 alle 9:30 CET, senza vocale; p(3) l'ha vista alle 11:30 CET, con il vocale.
insert into public.filo_benvenuti_visti (utente_id, stanza_id, visto_il) values
  (pg_temp.p(2), pg_temp.s(1), '2026-03-23 08:30+00'), (pg_temp.p(3), pg_temp.s(1), '2026-03-23 10:30+00');

-- Il telefono non legge e non scrive niente di tutto questo.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.errore(format('select * from public.vocale_filo_stato(%L, now())', pg_temp.p(2))) is not null
  and pg_temp.errore(format('select public.segna_ascolto_filo(%L, %L, now())', pg_temp.p(2), pg_temp.s(1))) is not null
  and pg_temp.errore('select * from public.filo_vocali_ascoltati') is not null,
  'riascolto filo: il telefono non chiama le funzioni e non legge la tabella');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.filo_vocali_ascoltati'::regclass),
  'riascolto filo: regole per riga attive sulla tabella');

set local role service_role;
select pg_temp.ok(pg_temp.voce(2, '2026-03-23 09:59+00') is null,
  'riascolto filo: prima che il vocale arrivi la voce non c''è');
select pg_temp.ok(pg_temp.voce(2, '2026-03-23 10:00+00') = row(pg_temp.s(1), true)::text,
  'riascolto filo: vocale arrivato dopo la schermata 18 → voce con pallino');
select pg_temp.ok(pg_temp.voce(3, '2026-03-23 11:00+00') = row(pg_temp.s(1), false)::text,
  'riascolto filo: schermata 18 vista con il vocale → voce senza pallino');
select pg_temp.ok(pg_temp.voce(4, '2026-03-23 11:00+00') = row(pg_temp.s(1), true)::text,
  'riascolto filo: schermata 18 non ancora vista e vocale mai ascoltato → pallino');
select pg_temp.ok(pg_temp.voce(2, '2026-03-29 18:59+00') is not null and pg_temp.voce(2, '2026-03-29 19:00+00') is null,
  'riascolto filo: la voce resta fino alla chiusura della domenica, poi sparisce');
select pg_temp.ok(pg_temp.voce(5, '2026-03-24 10:00+00') is null and pg_temp.voce(7, '2026-03-24 10:00+00') is null
  and pg_temp.voce(1, '2026-03-24 10:00+00') is null,
  'riascolto filo: vocale mai caricato, stanza senza Filo o il Filo stesso: nessuna voce');

-- Il primo ascolto spegne il pallino, solo per chi ha ascoltato.
-- (Le scritture vanno in istruzioni separate dai conteggi: Postgres può calcolare il conteggio prima.)
select pg_temp.ok(public.segna_ascolto_filo(pg_temp.p(2), pg_temp.s(1), '2026-03-23 12:00+00') = true
  and public.segna_ascolto_filo(pg_temp.p(2), pg_temp.s(1), '2026-03-24 12:00+00') = true,
  'riascolto filo: l''ascolto si segna');
select pg_temp.ok((select count(*) from public.filo_vocali_ascoltati where utente_id = pg_temp.p(2)) = 1,
  'riascolto filo: segnarlo due volte non crea due righe');
select pg_temp.ok(pg_temp.voce(2, '2026-03-24 10:00+00') = row(pg_temp.s(1), false)::text
  and pg_temp.voce(4, '2026-03-24 10:00+00') = row(pg_temp.s(1), true)::text,
  'riascolto filo: dopo l''ascolto niente pallino; gli altri lo hanno ancora');
select pg_temp.ok(public.segna_ascolto_filo(pg_temp.p(5), pg_temp.s(1), '2026-03-24 10:00+00') = false
  and public.segna_ascolto_filo(pg_temp.p(5), pg_temp.s(2), '2026-03-24 10:00+00') = false
  and public.segna_ascolto_filo(pg_temp.p(4), pg_temp.s(1), '2026-03-23 09:00+00') = false
  and public.segna_ascolto_filo(pg_temp.p(4), pg_temp.s(1), '2026-03-29 19:00+00') = false,
  'riascolto filo: non si segna per una stanza non propria, senza vocale o fuori orario');
select pg_temp.ok((select count(*) from public.filo_vocali_ascoltati) = 1,
  'riascolto filo: i rifiuti non scrivono righe');
reset role;

-- Chi ha lasciato la stanza (#381) o è sospeso non ha la voce e non segna ascolti.
insert into public.lasciate_stanza (persona, stanza_id, motivo) values (pg_temp.p(6), pg_temp.s(1), 'tempo');
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('f5f5f5f5-0000-4000-8000-000000000901', pg_temp.p(2), pg_temp.p(4), 'insulti', 'scheda', now(), now() + interval '1 day');
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(4), 'cautelare', 'f5f5f5f5-0000-4000-8000-000000000901', now() + interval '1 day');
set local role service_role;
select pg_temp.ok(pg_temp.voce(6, '2026-03-24 10:00+00') is null and pg_temp.voce(4, '2026-03-24 10:00+00') is null
  and public.segna_ascolto_filo(pg_temp.p(6), pg_temp.s(1), '2026-03-24 10:00+00') = false
  and public.segna_ascolto_filo(pg_temp.p(4), pg_temp.s(1), '2026-03-24 10:00+00') = false,
  'riascolto filo: chi ha lasciato la stanza o è sospeso non ha la voce e non segna ascolti');
reset role;
rollback;
