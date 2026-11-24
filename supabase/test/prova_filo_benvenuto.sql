-- Test della schermata 18 «Il Filo apre la stanza» lato database (issue #360, spec v1 + v1.1 del CPO, D151 A), passo
-- 8a della linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati,
-- orologio finto. Spec: la schermata 18 compare dalle 9:00 di lunedì solo se la stanza ha un Filo, una sola volta a
-- settimana per persona; stanza senza Filo → niente schermata. Chi è sospeso o ha lasciato la stanza non la vede e
-- non ascolta i vocali del Filo (né legge il numero delle porte).
-- Stanza della settimana del cambio d'ora: apre lunedì 23/3/2026 9:00 CET = 08:00 UTC, chiude domenica 29/3
-- 21:00 CEST = 19:00 UTC.
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
  select ('f4f4f4f4-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f4f4f4f4-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
-- Riga della schermata 18 per la persona n all'ora data, come testo (null = niente schermata).
create function pg_temp.riga(n integer, ora text) returns text language sql as $$
  select row(f.stanza_id, f.filo_nome, f.visto)::text from public.filo_stanza_membro(pg_temp.p(n), ora::timestamptz) f
$$;

begin;
-- p(1) Filo della stanza 1; p(2), p(3), p(6) membri della stanza 1; p(4) membro della stanza 2 (senza Filo);
-- p(5) non è in stanza.
insert into auth.users (id, email) select pg_temp.p(n), 'fb' || n || '@example.com' from generate_series(1, 6) n;
insert into public.profili (id, nome, data_nascita, citta) values
  (pg_temp.p(1), 'Silvia', '1980-01-01', 'Milano'), (pg_temp.p(2), 'Anna', '1990-01-01', 'Milano'),
  (pg_temp.p(3), 'Bruno', '1990-01-01', 'Milano'), (pg_temp.p(4), 'Carla', '1990-01-01', 'Milano'),
  (pg_temp.p(5), 'Dario', '1990-01-01', 'Milano'), (pg_temp.p(6), 'Elena', '1990-01-01', 'Milano');
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il)
  select pg_temp.s(n), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00'
  from generate_series(1, 2) n;
insert into public.membri_stanza (stanza_id, utente_id) values
  (pg_temp.s(1), pg_temp.p(2)), (pg_temp.s(1), pg_temp.p(3)), (pg_temp.s(1), pg_temp.p(6)), (pg_temp.s(2), pg_temp.p(4));
insert into public.fili_stanza (stanza_id, filo) values (pg_temp.s(1), pg_temp.p(1));
insert into public.vocali_filo (stanza_id, tipo, file, durata, testo, caricato_il) values
  (pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/lun.webm', 70, 'Benvenuti', '2026-03-23 07:00+00'),
  (pg_temp.s(1), 'domenica', pg_temp.s(1) || '/dom.webm', 48, 'A tra poco', '2026-03-29 17:00+00');
insert into public.serate_porte (stanza_id, chiavi_date, porte_aperte) values (pg_temp.s(1), 5, 2);

-- Il telefono non legge e non scrive niente di tutto questo.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.errore(format('select * from public.filo_stanza_membro(%L, now())', pg_temp.p(2))) is not null
  and pg_temp.errore(format('select public.segna_benvenuto_filo(%L, %L, now())', pg_temp.p(2), pg_temp.s(1))) is not null
  and pg_temp.errore('select * from public.filo_benvenuti_visti') is not null,
  'benvenuto filo: il telefono non chiama le funzioni e non legge la tabella');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.filo_benvenuti_visti'::regclass),
  'benvenuto filo: regole per riga attive sulla tabella');

set local role service_role;
select pg_temp.ok(pg_temp.riga(2, '2026-03-23 07:59+00') is null,
  'benvenuto filo: prima delle 9:00 di lunedì niente schermata 18');
select pg_temp.ok(pg_temp.riga(2, '2026-03-23 08:00+00') = row(pg_temp.s(1), 'Silvia', false)::text,
  'benvenuto filo: dalle 9:00 stanza, nome del Filo e «non ancora vista»');
select pg_temp.ok(pg_temp.riga(2, '2026-03-29 19:00+00') is null,
  'benvenuto filo: dopo la chiusura niente schermata 18');
select pg_temp.ok(pg_temp.riga(4, '2026-03-24 10:00+00') is null and pg_temp.riga(5, '2026-03-24 10:00+00') is null
  and pg_temp.riga(1, '2026-03-24 10:00+00') is null,
  'benvenuto filo: stanza senza Filo, nessuna stanza o il Filo stesso: niente schermata 18');

-- Una sola volta a settimana per persona.
select pg_temp.ok(public.segna_benvenuto_filo(pg_temp.p(2), pg_temp.s(1), '2026-03-23 09:00+00') = true,
  'benvenuto filo: si segna come vista');
select pg_temp.ok(public.segna_benvenuto_filo(pg_temp.p(2), pg_temp.s(1), '2026-03-23 09:05+00') = true
  and (select count(*) from public.filo_benvenuti_visti where utente_id = pg_temp.p(2)) = 1,
  'benvenuto filo: segnarla due volte non crea due righe');
select pg_temp.ok(pg_temp.riga(2, '2026-03-24 10:00+00') = row(pg_temp.s(1), 'Silvia', true)::text
  and pg_temp.riga(3, '2026-03-24 10:00+00') = row(pg_temp.s(1), 'Silvia', false)::text,
  'benvenuto filo: «vista» vale per chi l''ha vista, non per gli altri');
select pg_temp.ok(public.segna_benvenuto_filo(pg_temp.p(4), pg_temp.s(1), '2026-03-24 10:00+00') = false
  and public.segna_benvenuto_filo(pg_temp.p(2), pg_temp.s(1), '2026-03-23 07:00+00') = false
  and (select count(*) from public.filo_benvenuti_visti) = 1,
  'benvenuto filo: non si segna per una stanza non propria o fuori orario');
reset role;

-- Chi ha lasciato la stanza (#381) non vede la schermata, non ascolta i vocali e non legge il numero delle porte.
insert into public.lasciate_stanza (persona, stanza_id, motivo) values (pg_temp.p(6), pg_temp.s(1), 'tempo');
set local role service_role;
select pg_temp.ok(pg_temp.riga(6, '2026-03-24 10:00+00') is null,
  'benvenuto filo: chi ha lasciato la stanza non vede la schermata 18');
select pg_temp.ok((select count(*) from public.vocale_filo_membro(pg_temp.p(6), 'lunedi', '2026-03-24 10:00+00')) = 0
  and (select count(*) from public.vocale_filo_membro(pg_temp.p(6), 'domenica', '2026-03-29 19:30+00')) = 0
  and (select count(*) from public.vocale_filo_membro(pg_temp.p(3), 'lunedi', '2026-03-24 10:00+00')) = 1,
  'ascolto filo: chi ha lasciato la stanza non ascolta i vocali; gli altri sì');
select pg_temp.ok((select count(*) from public.porte_stanza_membro(pg_temp.p(6), '2026-03-29 19:30+00')) = 0
  and (select p.porte from public.porte_stanza_membro(pg_temp.p(3), '2026-03-29 19:30+00') p) = 2,
  'porte filo: chi ha lasciato la stanza non legge il numero; gli altri sì');
reset role;

-- Chi è sospeso non vede la schermata.
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('f4f4f4f4-0000-4000-8000-000000000901', pg_temp.p(2), pg_temp.p(3), 'insulti', 'scheda', now(), now() + interval '1 day');
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(3), 'cautelare', 'f4f4f4f4-0000-4000-8000-000000000901', now() + interval '1 day');
set local role service_role;
select pg_temp.ok(pg_temp.riga(3, '2026-03-24 10:00+00') is null and pg_temp.riga(2, '2026-03-24 10:00+00') is not null,
  'benvenuto filo: chi è sospeso non vede la schermata 18');
reset role;
rollback;
