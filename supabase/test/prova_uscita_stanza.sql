-- Test dell'uscita dalla stanza per chi chiede contatti prima della porta (issue #7, spec v1.1 definitiva, «Regole» ›
-- «Contatti chiesti prima della porta»: se la revisione conferma → avviso + uscita dalla stanza in corso, nessun
-- rimborso; alla seconda volta in 6 mesi → sospensione di 7 giorni). Linea «sviluppatore-b», passo 14a.
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh. Dati inventati.
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
  select ('e5e5e5e5-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.vede(chi uuid) returns text[] language plpgsql as $$
declare r text[];
begin
  perform pg_temp.come(chi);
  select coalesce(array_agg(nome order by nome), '{}') into r from public.compagni_di_stanza();
  reset role;
  return r;
end $$;

begin;
-- Ugo (3) cerca donne; Ada (1) e Bea (2) cercano uomini. Stessa stanza aperta. 9 = chi decide.
insert into auth.users (id, email) select pg_temp.p(n), 'usc' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  (pg_temp.p(1), 'Ada', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(2), 'Bea', '1990-01-01', 'MI', 'donna'),
  (pg_temp.p(3), 'Ugo', '1990-01-01', 'MI', 'uomo');
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select id, case when nome = 'Ugo' then '{donne}' else '{uomini}' end::text[], now(), '1.5', 25, 50, 'italia' from public.profili
  where id in (pg_temp.p(1), pg_temp.p(2), pg_temp.p(3));
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('e5e5e5e5-5555-4000-8000-000000000001', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'e5e5e5e5-5555-4000-8000-000000000001', id from public.profili where id in (pg_temp.p(1), pg_temp.p(2), pg_temp.p(3));
insert into public.chiamate (chi, con, inizio, durata, esito)
  select pg_temp.p(3), id, now() - interval '1 day' - (ascii(nome) * interval '1 hour') / 100, 300, 'chiusa'
  from public.profili where id in (pg_temp.p(1), pg_temp.p(2));

select pg_temp.ok(pg_temp.vede(pg_temp.p(1)) = array['Ugo'], 'uscita: (prima) Ada vede Ugo nella stanza');

-- Il telefono non legge le uscite.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.uscite_stanza$$), 'uscita: il telefono non legge le uscite (solo il server)');
reset role;

set local role service_role;
-- Bea e Ugo si sono dati la chiave.
select pg_temp.ok(public.dai_chiave(pg_temp.p(2), pg_temp.p(3), null) = 'ok', 'uscita: (prima) Bea dà la chiave a Ugo');

-- 1. Un avviso per altro motivo non fa uscire dalla stanza.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'insulti', 'scheda', null, false) as s0 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s0', 'avviso', 'rispetto', 'tono sgarbato');
select pg_temp.ok(not exists (select 1 from public.uscite_stanza where persona = pg_temp.p(3)) and not public.sospeso(pg_temp.p(3)),
  'uscita: un avviso per insulti non fa uscire dalla stanza');

-- 2. Contatti chiesti prima della porta, confermati con un avviso: Ugo esce dalla stanza in corso.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'contatti_prima_porta', 'scheda', null, false) as s1 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'avviso', 'contatti', 'ha chiesto il numero') as z1 \gset
reset role;
select pg_temp.ok((select count(*) from public.uscite_stanza where persona = pg_temp.p(3)
  and stanza_id = 'e5e5e5e5-5555-4000-8000-000000000001' and sanzione_id = :'z1' and segnalazione_id = :'s1'
  and fino_il = (select chiude_il from public.stanze where id = 'e5e5e5e5-5555-4000-8000-000000000001')) = 1,
  'uscita: contatti confermati → uscita dalla stanza in corso, fino alla sua chiusura');
set local role service_role;
select pg_temp.ok(public.sospeso(pg_temp.p(3)), 'uscita: finché la stanza è aperta Ugo conta come fuori (chiamate e chiavi impossibili)');
reset role;
select pg_temp.ok(pg_temp.vede(pg_temp.p(1)) = '{}'::text[], 'uscita: Ada non vede più Ugo nella stanza');
set local role service_role;
select pg_temp.ok(not exists (select 1 from public.chiavi where da = pg_temp.p(3) or a = pg_temp.p(3)),
  'uscita: le chiavi date e ricevute da Ugo si annullano');
select pg_temp.ok(public.dai_chiave(pg_temp.p(1), pg_temp.p(3), null) = 'non_nella_stanza', 'uscita: nessuna chiave nuova verso chi è uscito');
reset role;
select pg_temp.ok((select count(*) from public.membri_stanza where utente_id = pg_temp.p(3)) = 1,
  'uscita: la riga della stanza resta (nessun rimborso, lo storico delle stanze non cambia)');

-- 3. Chiusa la stanza, l'uscita non conta più: la settimana dopo Ugo può entrare in una stanza nuova.
update public.uscite_stanza set fino_il = now() - interval '1 minute' where persona = pg_temp.p(3);
set local role service_role;
select pg_temp.ok(not public.sospeso(pg_temp.p(3)), 'uscita: finita la stanza, l''uscita non lo tiene più fuori');

-- 4. Seconda volta in 6 mesi: l'avviso non basta, serve la sospensione di 7 giorni.
reset role;
update public.uscite_stanza set fino_il = (select chiude_il from public.stanze where id = 'e5e5e5e5-5555-4000-8000-000000000001')
  where persona = pg_temp.p(3);
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(2), pg_temp.p(3), 'contatti_prima_porta', 'scheda', null, false) as s2 \gset
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'avviso', 'contatti', 'ancora il numero')$$,
  pg_temp.p(9), :'s2')), 'uscita: alla seconda volta in 6 mesi l''avviso viene rifiutato');
select public.decidi_segnalazione(pg_temp.p(9), :'s2', 'sospensione_7', 'contatti', 'ancora il numero') as z2 \gset
select pg_temp.ok((select livello = 'sospensione_7' from public.sanzioni where id = :'z2') and public.sospeso(pg_temp.p(3)),
  'uscita: alla seconda volta in 6 mesi sospensione di 7 giorni');
select pg_temp.ok((select count(*) from public.uscite_stanza where persona = pg_temp.p(3)) = 1,
  'uscita: una sola uscita per la stessa stanza');

-- 5. Una prima volta di più di 6 mesi fa non conta come recidiva.
reset role;
update public.sanzioni set decisa_il = now() - interval '7 months' where persona = pg_temp.p(3);
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'contatti_prima_porta', 'scheda', null, false) as s3 \gset
select pg_temp.ok(not pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'avviso', 'contatti', 'dopo 7 mesi')$$,
  pg_temp.p(9), :'s3')), 'uscita: dopo più di 6 mesi basta di nuovo l''avviso');

-- 6. Ricorso accolto: la sanzione si annulla e l'uscita non tiene più fuori.
reset role;
update public.sanzioni set fine_il = now() - interval '1 minute' where livello = 'sospensione_7' and persona = pg_temp.p(3);
update public.sanzioni set annullata_il = now() where id = :'z1';
set local role service_role;
select pg_temp.ok(not public.sospeso(pg_temp.p(3)), 'uscita: con il ricorso accolto l''uscita non conta più');

-- 7. Chi non è in nessuna stanza aperta: l'avviso passa, nessuna uscita.
select public.nuova_segnalazione(pg_temp.p(3), pg_temp.p(2), 'contatti_prima_porta', 'scheda', null, false) as s4 \gset
reset role;
delete from public.membri_stanza where utente_id = pg_temp.p(2);
set local role service_role;
select public.decidi_segnalazione(pg_temp.p(9), :'s4', 'avviso', 'contatti', 'senza stanza');
select pg_temp.ok(not exists (select 1 from public.uscite_stanza where persona = pg_temp.p(2)),
  'uscita: senza una stanza aperta resta solo l''avviso');
rollback;
