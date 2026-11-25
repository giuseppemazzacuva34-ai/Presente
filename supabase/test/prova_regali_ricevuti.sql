-- Test dei regali ricevuti (issue #331 spec v1 del CPO, parte C «Cosa vede chi riceve» e «Regole»). Linea «sviluppatore-c».
-- Avviso «<nome> ti ha mandato una rosa.» finché non è visto; nella scheda «Ti ha mandato: …» solo per chi riceve;
-- dopo un blocco o una segnalazione i regali spariscono dalla vista; i regali non cambiano i compagni di stanza.
-- Dati inventati, Postgres di prova.
-- p2 riceve da p1 (rosa e spumante), p3 (rosa), p4 (fiori, poi p2 blocca p4), p5 (rosa, poi p2 segnala p5).
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
  select ('c0160000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.manda(da integer, a integer, regalo text) returns text language sql as $$
  select public.manda_regalo(pg_temp.p(da), pg_temp.p(a), regalo, gen_random_uuid())
$$;
create temporary table compagni_prima (chi uuid, utente_id uuid);
grant all on compagni_prima to authenticated;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'ricevuto' || n || '@example.com' from generate_series(1, 5) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come)
  select pg_temp.p(n), (array['Ada', 'Bea', 'Cia', 'Dea', 'Eva'])[n], '1990-01-01', 'MI', 'donna' from generate_series(1, 5) n;
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select pg_temp.p(n), '{donne,uomini,non_binari}', now(), '1.5', 18, 99, 'italia' from generate_series(1, 5) n;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('c0165555-0000-4000-8000-000000000001', 'italia', now() - interval '3 days', now() + interval '2 days');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'c0165555-0000-4000-8000-000000000001', pg_temp.p(n) from generate_series(1, 5) n;
select public.assegna_crediti_beta(pg_temp.p(n), 200) from generate_series(1, 5) n;

-- I compagni di stanza prima di qualunque regalo.
select pg_temp.come(pg_temp.p(1));
insert into compagni_prima select pg_temp.p(1), utente_id from public.compagni_di_stanza();
reset role;
select pg_temp.come(pg_temp.p(2));
insert into compagni_prima select pg_temp.p(2), utente_id from public.compagni_di_stanza();
reset role;

set local role service_role;
select pg_temp.ok(pg_temp.manda(1, 2, 'rosa') = 'ok' and pg_temp.manda(1, 2, 'spumante') = 'ok' and pg_temp.manda(3, 2, 'rosa') = 'ok'
  and pg_temp.manda(4, 2, 'fiori') = 'ok' and pg_temp.manda(5, 2, 'rosa') = 'ok', 'preparazione: cinque regali a p2');
reset role;
insert into public.blocchi (chi, bloccato) values (pg_temp.p(2), pg_temp.p(4));
insert into public.segnalazioni (da, contro, motivo, origine, scade_il) values (pg_temp.p(2), pg_temp.p(5), 'altro', 'scheda', now() + interval '1 day');

-- Il telefono non lancia le funzioni del server.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.regali_da_vedere(auth.uid())$$)
  and pg_temp.rifiutato($$select * from public.regali_ricevuti_da(auth.uid(), pg_temp.p(1))$$)
  and pg_temp.rifiutato($$select public.segna_regali_visti(auth.uid(), array[]::uuid[])$$),
  'ricevuti: il telefono non lancia le funzioni del server');
-- I regali non cambiano i compagni di stanza (nessun algoritmo li legge).
select pg_temp.ok((select array_agg(utente_id order by utente_id) from public.compagni_di_stanza() where utente_id not in (pg_temp.p(4), pg_temp.p(5)))
  = (select array_agg(utente_id order by utente_id) from compagni_prima where chi = pg_temp.p(2) and utente_id not in (pg_temp.p(4), pg_temp.p(5))),
  'algoritmi: i compagni di stanza di chi riceve non cambiano con i regali');
reset role;
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok((select array_agg(utente_id order by utente_id) from public.compagni_di_stanza())
  = (select array_agg(utente_id order by utente_id) from compagni_prima where chi = pg_temp.p(1)),
  'algoritmi: i compagni di stanza di chi manda non cambiano con i regali');
reset role;

set local role service_role;
-- Avvisi: solo quelli ancora da vedere, con il nome di chi manda; niente da chi è stato bloccato o segnalato.
select pg_temp.ok((select count(*) from public.regali_da_vedere(pg_temp.p(2))) = 3, 'avvisi: p2 ha 3 regali da vedere');
select pg_temp.ok((select array_agg(nome || ':' || regalo order by nome, regalo) from public.regali_da_vedere(pg_temp.p(2)))
  = array['Ada:rosa', 'Ada:spumante', 'Cia:rosa'], 'avvisi: nome di chi manda e regalo');
select pg_temp.ok(not exists (select 1 from public.regali_da_vedere(pg_temp.p(2)) where da in (pg_temp.p(4), pg_temp.p(5))),
  'avvisi: i regali di chi p2 ha bloccato o segnalato spariscono');
select pg_temp.ok(not exists (select 1 from public.regali_da_vedere(pg_temp.p(1))), 'avvisi: chi manda non riceve avvisi');
-- Scheda: «Ti ha mandato: 1 rosa, 1 bicchiere di spumante», solo per chi riceve.
select pg_temp.ok((select array_agg(regalo || '=' || quanti order by regalo) from public.regali_ricevuti_da(pg_temp.p(2), pg_temp.p(1)))
  = array['rosa=1', 'spumante=1'], 'scheda: p2 vede da p1 1 rosa e 1 spumante');
select pg_temp.ok(not exists (select 1 from public.regali_ricevuti_da(pg_temp.p(1), pg_temp.p(2)))
  and not exists (select 1 from public.regali_ricevuti_da(pg_temp.p(3), pg_temp.p(1))),
  'scheda: chi manda e gli altri della stanza non vedono i regali');
select pg_temp.ok(not exists (select 1 from public.regali_ricevuti_da(pg_temp.p(2), pg_temp.p(4)))
  and not exists (select 1 from public.regali_ricevuti_da(pg_temp.p(2), pg_temp.p(5))),
  'scheda: dopo blocco o segnalazione i regali ricevuti spariscono');
-- Visti: si segnano solo i propri.
select pg_temp.ok(public.segna_regali_visti(pg_temp.p(1), array(select id from public.regali where a = pg_temp.p(2))) = 0,
  'visti: nessuno segna come visti i regali di un altro');
select pg_temp.ok(public.segna_regali_visti(pg_temp.p(2), array(select id from public.regali where a = pg_temp.p(2) and da = pg_temp.p(1))) = 2,
  'visti: p2 segna visti i 2 regali di p1');
select pg_temp.ok((select array_agg(nome) from public.regali_da_vedere(pg_temp.p(2))) = array['Cia'],
  'visti: resta da vedere solo il regalo di p3');
select pg_temp.ok((select array_agg(regalo || '=' || quanti order by regalo) from public.regali_ricevuti_da(pg_temp.p(2), pg_temp.p(1)))
  = array['rosa=1', 'spumante=1'], 'visti: la scheda continua a mostrarli');
rollback;
