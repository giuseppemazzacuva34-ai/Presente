-- Storico dei regali ricevuti, schermata 28 «I tuoi regali» (issue #349 design v4, regole #331). Linea «sviluppatore-b».
-- Totale per tipo; nella stanza aperta l'elenco per persona (nome, età, quanti per tipo, ultimo); delle stanze
-- passate solo numeri, mai nomi. Dopo un blocco o una segnalazione i regali di quella persona spariscono.
-- Solo il server legge la funzione. Dati inventati, Postgres di prova.
-- Stanza passata S1: p1 riceve da p2 (rosa) e p3 (rosa, spumante). Stanza aperta S2: p1 riceve da p4 (2 rose, fiori),
-- p5 (spumante), p6 (rosa, poi p1 blocca p6), p7 (rosa, poi p1 segnala p7). p4 riceve da p1 (rosa): non conta per p1.
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
create function pg_temp.come(utente uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', utente, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('c0280000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.manda(da integer, a integer, regalo text) returns text language sql as $$
  select public.manda_regalo(pg_temp.p(da), pg_temp.p(a), regalo, gen_random_uuid())
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'storico' || n || '@example.com' from generate_series(1, 7) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come)
  select pg_temp.p(n), (array['Ada', 'Bruno', 'Carlo', 'Dario', 'Elio', 'Fabio', 'Gino'])[n],
         (current_date - make_interval(years => 30 + n))::date, 'MI', case when n = 1 then 'donna' else 'uomo' end
  from generate_series(1, 7) n;
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select pg_temp.p(n), 'tutti', now(), '1.5', 18, 99, 'italia' from generate_series(1, 7) n;
select public.assegna_crediti_beta(pg_temp.p(n), 200) from generate_series(1, 7) n;

-- S1 è aperta mentre si mandano i regali, poi si chiude (la si sposta nel passato).
insert into public.stanze (id, tipo, citta, apre_il, chiude_il) values
  ('c0285555-0000-4000-8000-000000000001', 'citta', 'Torino', now() - interval '1 day', now() + interval '1 day');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'c0285555-0000-4000-8000-000000000001', pg_temp.p(n) from generate_series(1, 3) n;
set local role service_role;
select pg_temp.ok(pg_temp.manda(2, 1, 'rosa') = 'ok' and pg_temp.manda(3, 1, 'rosa') = 'ok' and pg_temp.manda(3, 1, 'spumante') = 'ok',
  'preparazione: tre regali a p1 nella stanza di Torino');
reset role;
update public.stanze set apre_il = now() - interval '9 days', chiude_il = now() - interval '2 days'
  where id = 'c0285555-0000-4000-8000-000000000001';
update public.regali set mandato_il = now() - interval '5 days' where stanza_id = 'c0285555-0000-4000-8000-000000000001';

-- S2, aperta adesso, a Milano.
insert into public.stanze (id, tipo, citta, apre_il, chiude_il) values
  ('c0285555-0000-4000-8000-000000000002', 'citta', 'Milano', now() - interval '2 days', now() + interval '5 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'c0285555-0000-4000-8000-000000000002', pg_temp.p(n) from generate_series(1, 7) n where n = 1 or n >= 4;
set local role service_role;
select pg_temp.ok(pg_temp.manda(4, 1, 'rosa') = 'ok' and pg_temp.manda(4, 1, 'rosa') = 'ok' and pg_temp.manda(4, 1, 'fiori') = 'ok'
  and pg_temp.manda(5, 1, 'spumante') = 'ok' and pg_temp.manda(6, 1, 'rosa') = 'ok' and pg_temp.manda(7, 1, 'rosa') = 'ok'
  and pg_temp.manda(1, 4, 'rosa') = 'ok', 'preparazione: sei regali a p1 e uno da p1 nella stanza di Milano');
reset role;
update public.regali set mandato_il = now() - interval '1 day' where da = pg_temp.p(5);
insert into public.blocchi (chi, bloccato) values (pg_temp.p(1), pg_temp.p(6));
insert into public.segnalazioni (da, contro, motivo, origine, scade_il) values (pg_temp.p(1), pg_temp.p(7), 'altro', 'scheda', now() + interval '1 day');

-- Il telefono non lancia la funzione del server.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select public.storico_regali(auth.uid())$$), 'storico: il telefono non lancia la funzione');
reset role;
select pg_temp.ok(not has_function_privilege('anon', 'public.storico_regali(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'public.storico_regali(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.storico_regali(uuid)', 'execute'), 'storico: solo il server la esegue');

set local role service_role;
create temporary table st as select public.storico_regali(pg_temp.p(1)) as j;
reset role;

-- Totale per tipo, solo regali visibili: rose 2 (Torino) + 2 (Dario) = 4, spumante 1 + 1 = 2, fiori 1.
select pg_temp.ok((select j -> 'totale' from st) = '{"rosa": 4, "spumante": 2, "fiori": 1}'::jsonb, 'storico: totale per tipo senza bloccati e segnalati');
-- Stanza aperta: città e persone con nome ed età, la più recente prima.
select pg_temp.ok((select j #>> '{attuale,citta}' from st) = 'Milano', 'storico: città della stanza aperta');
select pg_temp.ok((select jsonb_array_length(j #> '{attuale,persone}') from st) = 2, 'storico: nella stanza aperta due persone (bloccato e segnalato esclusi)');
select pg_temp.ok((select (j #> '{attuale,persone,0}') - 'ultimo'::text from st)
  = jsonb_build_object('da', pg_temp.p(4), 'nome', 'Dario', 'eta', 34, 'rosa', 2, 'spumante', 0, 'fiori', 1),
  'storico: Dario 34, 2 rose e 1 fiori, per primo (il più recente)');
select pg_temp.ok((select (j #> '{attuale,persone,1}') - 'ultimo'::text from st)
  = jsonb_build_object('da', pg_temp.p(5), 'nome', 'Elio', 'eta', 35, 'rosa', 0, 'spumante', 1, 'fiori', 0),
  'storico: Elio 35, 1 spumante');
select pg_temp.ok((select (j #>> '{attuale,persone,1,ultimo}')::timestamptz from st) < now() - interval '23 hours', 'storico: ultimo regalo con la sua data');
-- Stanze passate: solo numeri, nessun nome né id.
select pg_temp.ok((select j -> 'passate' from st) = '{"stanze": 1, "persone": 2, "rosa": 2, "spumante": 1, "fiori": 0}'::jsonb,
  'storico: stanze passate solo con i numeri');
select pg_temp.ok((select position('Bruno' in j::text) = 0 and position('Carlo' in j::text) = 0
  and position(pg_temp.p(2)::text in j::text) = 0 and position(pg_temp.p(3)::text in j::text) = 0 from st),
  'storico: nessun nome o id delle stanze passate');
select pg_temp.ok((select position('Fabio' in j::text) = 0 and position('Gino' in j::text) = 0 from st), 'storico: nessun nome di bloccati o segnalati');

-- Chi non ha ricevuto niente e non è in una stanza aperta.
set local role service_role;
select pg_temp.ok(public.storico_regali(pg_temp.p(2))
  = '{"totale": {"rosa": 0, "spumante": 0, "fiori": 0}, "attuale": null, "passate": {"stanze": 0, "persone": 0, "rosa": 0, "spumante": 0, "fiori": 0}}'::jsonb,
  'storico: vuoto per chi non ha ricevuto regali');
-- Una stanza Italia ha come città «Italia».
reset role;
update public.stanze set tipo = 'italia', citta = null where id = 'c0285555-0000-4000-8000-000000000002';
set local role service_role;
select pg_temp.ok(public.storico_regali(pg_temp.p(1)) #>> '{attuale,citta}' = 'Italia', 'storico: stanza Italia');
reset role;
rollback;
