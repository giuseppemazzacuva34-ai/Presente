-- Test della buca e della fine della finestra del check-in (issue #6, spec v1 del CPO del 3/11, «Regole»; D12 A).
-- Linea «sviluppatore-b», passo 2j. Alla fine della finestra (orario + 30 minuti + ritardo dichiarato):
--   uno solo ha fatto «Sono qui» → buca dell'altro: chi ha aspettato riprende i suoi 10 più 7, Presente 3, chi manca
--   perde i suoi 10 (criterio: «B −10, A +7, Presente +3; la somma dei crediti torna»);
--   nessuno dei due → crediti restituiti a entrambi, nessuna penale.
-- Si chiude da sola alla prima lettura (incontro_aggiornato) o con chiudi_incontri_finiti() (lavoro periodico).
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
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('b0ca0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.porta(n integer) returns uuid language sql immutable as $$
  select ('b0cab0ca-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.saldo(n integer) returns integer language sql as $$ select public.saldo_crediti(pg_temp.p(n)) $$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'buca' || n || '@example.com' from generate_series(1, 8) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('b0ca5555-0000-4000-8000-000000000001', 'italia', now() - interval '9 days', now() - interval '2 days');
-- Porte 1: p1–p2 (buca di p2), 2: p3–p4 (nessun check-in), 3: p5–p6 (ritardo, poi buca di p5), 4: p7–p8 (lavoro periodico).
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select pg_temp.porta(n), 'b0ca5555-0000-4000-8000-000000000001', pg_temp.p(2 * n - 1), pg_temp.p(2 * n), now() - interval '2 days'
  from generate_series(1, 4) n;

set local role service_role;
select public.assegna_crediti_beta(pg_temp.p(n), 30) from generate_series(1, 8) n;
select public.blocca_caparra(pg_temp.porta((n + 1) / 2), pg_temp.p(n)) from generate_series(1, 8) n;
update public.svelamenti set iniziato_il = now() - interval '1 day 20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '1 day 19 minutes', esito = 'doppio_si', esito_il = now() - interval '1 day'
  where porta_id in (select pg_temp.porta(n) from generate_series(1, 4) n);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, proposto_da, proposto_il, confermato_il)
  select pg_temp.porta(n), now() + interval '5 days', 'confermato', now() - interval '31 minutes', 'Bar della piazza',
         pg_temp.p(2 * n - 1), now() - interval '2 days', now() - interval '1 day'
  from generate_series(1, 4) n;
-- Porta 1: solo p1 ha fatto «Sono qui». Porta 3: solo p6, con «Arrivo in ritardo» +15 (finestra fino a +45).
update public.incontri set checkin_a_il = now() - interval '40 minutes' where porta_id = pg_temp.porta(1);
update public.incontri set checkin_b_il = now() - interval '10 minutes', ritardo_minuti = 15, ritardo_di = pg_temp.p(5)
  where porta_id = pg_temp.porta(3);
update public.incontri set orario = now() - interval '2 hours' where porta_id = pg_temp.porta(4);
select pg_temp.ok(pg_temp.saldo(1) = 20 and pg_temp.saldo(2) = 20, 'prima: le due caparre sono bloccate');

-- 1. Buca di p2: alla prima lettura dopo la finestra.
select pg_temp.ok((public.incontro_aggiornato(pg_temp.porta(1))).esito = 'buca_b', 'buca: solo p1 ha fatto il check-in → buca di p2');
select pg_temp.ok((select stato = 'concluso' and crediti_presente = 3 and esito_il is not null and segnale is null
  from public.incontri where porta_id = pg_temp.porta(1)), 'buca: incontro concluso, 3 crediti a Presente, nessun segnale');
select pg_temp.ok(pg_temp.saldo(1) = 37 and pg_temp.saldo(2) = 20, 'buca: chi ha aspettato riprende i suoi 10 più 7; chi manca perde 10');
select pg_temp.ok(pg_temp.saldo(1) + pg_temp.saldo(2)
    + (select crediti_presente from public.incontri where porta_id = pg_temp.porta(1)) = 60,
  'buca: la somma dei crediti torna (37 + 20 + 3 = 60)');
select (public.incontro_aggiornato(pg_temp.porta(1))).esito;
select pg_temp.ok(pg_temp.saldo(1) = 37 and pg_temp.saldo(2) = 20, 'buca: rileggere non sposta altri crediti');
select pg_temp.ok(public.checkin_incontro(pg_temp.porta(1), pg_temp.p(2)) = 'troppo_tardi',
  'buca: dopo la finestra «Sono qui» risponde «troppo tardi»');

-- 2. Nessuno dei due: crediti a entrambi, nessuna penale.
select pg_temp.ok((public.incontro_aggiornato(pg_temp.porta(2))).esito = 'nessun_checkin', 'nessun check-in: esito «nessun_checkin»');
select pg_temp.ok(pg_temp.saldo(3) = 30 and pg_temp.saldo(4) = 30
    and (select crediti_presente = 0 and stato = 'concluso' from public.incontri where porta_id = pg_temp.porta(2)),
  'nessun check-in: crediti restituiti a entrambi, niente a Presente');

-- 3. Con il ritardo la finestra si allunga: a +31 minuti ancora aperta; a +46 buca di p5.
select pg_temp.ok((public.incontro_aggiornato(pg_temp.porta(3))).esito is null, 'ritardo +15: a 31 minuti dall''ora ancora aperto');
select pg_temp.ok(pg_temp.saldo(5) = 20 and pg_temp.saldo(6) = 20, 'ritardo +15: caparre ancora bloccate');
update public.incontri set orario = now() - interval '46 minutes' where porta_id = pg_temp.porta(3);
select pg_temp.ok((public.incontro_aggiornato(pg_temp.porta(3))).esito = 'buca_a', 'ritardo +15: a 46 minuti buca di p5');
select pg_temp.ok(pg_temp.saldo(5) = 20 and pg_temp.saldo(6) = 37, 'ritardo +15: p6 riprende 10 più 7');

-- 4. Lavoro periodico: chiude gli incontri finiti anche senza che nessuno li apra.
select pg_temp.ok(public.chiudi_incontri_finiti() = 1, 'lavoro periodico: chiude l''unico incontro rimasto finito');
select pg_temp.ok((select esito = 'nessun_checkin' from public.incontri where porta_id = pg_temp.porta(4))
    and pg_temp.saldo(7) = 30 and pg_temp.saldo(8) = 30, 'lavoro periodico: porta 4 chiusa, crediti a entrambi');
select pg_temp.ok(public.chiudi_incontri_finiti() = 0, 'lavoro periodico: rifarlo non cambia nulla');
reset role;

-- 5. Solo il server.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.chiudi_incontri_finiti()$$), 'lavoro periodico: il telefono non lo chiama');
reset role;
select pg_temp.ok(not exists (select 1 from public.crediti_movimenti where porta_id in
    (select pg_temp.porta(n) from generate_series(1, 4) n) and tipo = 'buca_ricevuta' and persona not in (pg_temp.p(1), pg_temp.p(6))),
  'buca: i 7 crediti solo a chi ha aspettato');

rollback;
