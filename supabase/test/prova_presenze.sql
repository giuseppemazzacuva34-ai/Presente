-- Test della «stanza viva» nel database (issue #380, spec v1 del CPO del 23/11, punto 1), passo 2 della linea CTO.
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: online / in chiamata / non in linea; lo leggono solo le persone della stessa stanza aperta, compatibili,
-- senza blocchi e non sospese; «in chiamata con <nome>» solo se tutte e due sono nella stanza di chi guarda e chi
-- guarda non ne ha bloccata una; la pausa non si scopre; solo lo stato attuale (niente storico), tutto cancellato
-- alla chiusura della stanza. Il telefono non legge nulla da solo: passa dal Worker.
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
  select ('5e5e5e5e-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- Lo stato di p(altro) visto da p(chi): 'assente' se chi guarda non lo vede.
create function pg_temp.stato(chi integer, altro integer) returns text language sql as $$
  select coalesce((select case when s.in_chiamata then 'in_chiamata'
                               when s.ultimo_segnale is null then 'mai'
                               else 'segnale' end
                   from public.stati_stanza(pg_temp.p(chi)) s where s.utente_id = pg_temp.p(altro)), 'assente')
$$;

begin;
-- Stanza A (aperta): p1..p6. p7 nella stanza B (aperta). p8 è il Filo della stanza A. p9 nella stanza C (chiusa).
-- p6 non ha filtri: non è compatibile con nessuno.
insert into auth.users (id, email) select pg_temp.p(n), 'presenza' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'MI', 'donna' from generate_series(1, 9) n;
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select pg_temp.p(n), '{donne,uomini,non_binari}', now(), '1.5', 18, 99, 'italia' from generate_series(1, 9) n where n <> 6;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5e5e5e5e-0000-4000-8000-00000000000a', 'italia', now() - interval '2 days', now() + interval '3 days'),
  ('5e5e5e5e-0000-4000-8000-00000000000b', 'italia', now() - interval '2 days', now() + interval '3 days'),
  ('5e5e5e5e-0000-4000-8000-00000000000c', 'italia', now() - interval '8 days', now() - interval '1 day');
insert into public.membri_stanza (stanza_id, utente_id)
  select '5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(n) from generate_series(1, 6) n;
insert into public.membri_stanza (stanza_id, utente_id) values
  ('5e5e5e5e-0000-4000-8000-00000000000b', pg_temp.p(7)), ('5e5e5e5e-0000-4000-8000-00000000000c', pg_temp.p(9));
insert into public.fili_stanza (stanza_id, filo) values ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(8));

-- Il telefono (e la chiave anon) non legge e non scrive nulla da solo.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.presenze_stanza$$)
  and pg_temp.rifiutato($$insert into public.presenze_stanza (stanza_id, utente_id, ultimo_segnale)
    values ('5e5e5e5e-0000-4000-8000-00000000000a', auth.uid(), now())$$)
  and pg_temp.rifiutato($$select public.segnala_presenza(auth.uid())$$)
  and pg_temp.rifiutato($$select * from public.stati_stanza(auth.uid())$$)
  and pg_temp.rifiutato($$select public.segna_in_chiamata(auth.uid(), '5e5e5e5e-0000-4000-8000-000000000002', true)$$)
  and pg_temp.rifiutato($$select public.pulisci_presenze()$$),
  'presenze: il telefono non legge, non scrive e non lancia le funzioni (solo il server)');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.presenze_stanza$$)
  and pg_temp.rifiutato($$select * from public.stati_stanza('5e5e5e5e-0000-4000-8000-000000000001')$$),
  'presenze: la chiave anon riceve un rifiuto');
reset role;

set local role service_role;
-- Il segnale ogni 30 s: una sola riga per persona e stanza, aggiornata (niente storico degli accessi).
select pg_temp.ok(public.segnala_presenza(pg_temp.p(1)) and public.segnala_presenza(pg_temp.p(1))
  and public.segnala_presenza(pg_temp.p(1)) and public.segnala_presenza(pg_temp.p(2)),
  'presenze: chi è in una stanza aperta manda il segnale');
reset role;
select pg_temp.ok((select count(*) from public.presenze_stanza where utente_id = pg_temp.p(1)) = 1,
  'presenze: tre segnali = una sola riga (solo lo stato attuale)');
set local role service_role;
select pg_temp.ok(not public.segnala_presenza(pg_temp.p(8)) and not public.segnala_presenza(pg_temp.p(9)),
  'presenze: il Filo e chi non è in una stanza aperta non lasciano segnali');

-- Chi vede chi.
select pg_temp.ok(pg_temp.stato(2, 1) = 'segnale' and pg_temp.stato(1, 2) = 'segnale' and pg_temp.stato(3, 1) = 'segnale',
  'presenze: le persone della stessa stanza aperta vedono il segnale');
select pg_temp.ok(pg_temp.stato(3, 4) = 'mai', 'presenze: chi non ha mai mandato il segnale compare senza ora');
select pg_temp.ok(pg_temp.stato(7, 1) = 'assente' and pg_temp.stato(8, 1) = 'assente' and pg_temp.stato(9, 1) = 'assente',
  'presenze: chi è fuori stanza, il Filo e chi è in una stanza chiusa non vedono lo stato');
select pg_temp.ok(pg_temp.stato(1, 6) = 'assente' and pg_temp.stato(6, 1) = 'assente',
  'presenze: chi non è compatibile non vede e non è visto');
select pg_temp.ok(pg_temp.stato(1, 1) = 'assente', 'presenze: chi guarda non è nell''elenco degli altri');

-- In chiamata: p1 con p2.
select pg_temp.ok(public.segna_in_chiamata(pg_temp.p(1), pg_temp.p(2), true), 'presenze: inizio chiamata segnato');
select pg_temp.ok(not public.segna_in_chiamata(pg_temp.p(1), pg_temp.p(7), true),
  'presenze: niente «in chiamata» con chi è in un''altra stanza');
select pg_temp.ok(pg_temp.stato(3, 1) = 'in_chiamata' and pg_temp.stato(3, 2) = 'in_chiamata',
  'presenze: gli altri della stanza vedono «in chiamata» per tutti e due');
select pg_temp.ok((select in_chiamata_con from public.stati_stanza(pg_temp.p(3)) where utente_id = pg_temp.p(1)) = pg_temp.p(2),
  'presenze: «in chiamata con» quando tutte e due sono nella stanza di chi guarda');
reset role;
insert into public.blocchi (chi, bloccato) values (pg_temp.p(4), pg_temp.p(2));
set local role service_role;
select pg_temp.ok((select in_chiamata and in_chiamata_con is null from public.stati_stanza(pg_temp.p(4))
  where utente_id = pg_temp.p(1)), 'presenze: chi ha bloccato una delle due vede solo «in chiamata»');
select pg_temp.ok(pg_temp.stato(4, 2) = 'assente' and pg_temp.stato(2, 4) = 'assente',
  'presenze: con un blocco le due persone non si vedono');
select pg_temp.ok(public.segna_in_chiamata(pg_temp.p(2), pg_temp.p(1), false)
  and pg_temp.stato(3, 1) = 'segnale' and pg_temp.stato(3, 2) = 'segnale', 'presenze: fine chiamata, torna lo stato normale');
reset role;
-- Una chiamata segnata da più di 16 minuti (il Worker non ha chiuso) non vale più.
update public.presenze_stanza set in_chiamata_con = pg_temp.p(3), in_chiamata_dal = now() - interval '17 minutes'
  where utente_id = pg_temp.p(5);
set local role service_role;
select pg_temp.ok(pg_temp.stato(1, 5) <> 'in_chiamata', 'presenze: «in chiamata» rimasto appeso scade dopo 16 minuti');
reset role;

-- La pausa non si scopre: chi è in pausa appare come gli altri.
update public.profili set pausa_il = (now() at time zone 'Europe/Rome')::date where id = pg_temp.p(1);
set local role service_role;
select pg_temp.ok(pg_temp.stato(3, 1) = 'segnale', 'presenze: chi è in pausa appare online o non in linea come gli altri');
reset role;

-- Sospensione: sparisce dallo stato degli altri.
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('5e5e5e5e-0000-4000-8000-000000000901', pg_temp.p(3), pg_temp.p(2), 'insulti', 'scheda', now(), now() + interval '1 day');
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(2), 'cautelare', '5e5e5e5e-0000-4000-8000-000000000901', now() + interval '1 day');
set local role service_role;
select pg_temp.ok(pg_temp.stato(1, 2) = 'assente' and not public.segnala_presenza(pg_temp.p(2)),
  'presenze: chi è sospeso sparisce e non manda segnali');
reset role;

-- Uscita dalla stanza: la riga sparisce con il membro.
delete from public.membri_stanza where utente_id = pg_temp.p(1);
select pg_temp.ok(not exists (select 1 from public.presenze_stanza where utente_id = pg_temp.p(1)),
  'presenze: chi esce dalla stanza perde la riga');

-- Chiusura della stanza: tutto si cancella.
insert into public.presenze_stanza (stanza_id, utente_id, ultimo_segnale)
  values ('5e5e5e5e-0000-4000-8000-00000000000c', pg_temp.p(9), now() - interval '1 day');
set local role service_role;
select pg_temp.ok(public.pulisci_presenze() >= 1, 'presenze: la pulizia cancella le stanze chiuse');
reset role;
select pg_temp.ok(not exists (select 1 from public.presenze_stanza p join public.stanze s on s.id = p.stanza_id
  where now() >= s.chiude_il), 'presenze: alla chiusura della stanza non resta nulla');
select pg_temp.ok(exists (select 1 from public.presenze_stanza where stanza_id = '5e5e5e5e-0000-4000-8000-00000000000a'),
  'presenze: le stanze aperte restano');
rollback;
