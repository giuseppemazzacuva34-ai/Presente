-- Test dei regali nel database (issue #331 spec v1 del CPO, parte C; D145 A). Linea «sviluppatore-c».
-- Il server ricontrolla TUTTE le regole: nessun regalo parte con una chiamata diretta che le aggira.
-- Rosa 5, spumante 10, fiori 20 Coin a chi manda; 0 Coin a chi riceve. Dati inventati, Postgres di prova.
-- Persone: p1 manda. Nella stanza aperta con p1: p2, p13, p14, p15, p16 (compatibili), p3 (non compatibile),
-- p5 (ha bloccato p1), p6 (ha segnalato p1), p11 (segnalata da p1), p7 (sospesa). p4 fuori dalla stanza.
-- p9 e p10 in una stanza chiusa un minuto fa.
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
  select ('c0150000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.k(n integer) returns uuid language sql immutable as $$
  select ('c015c015-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.saldo(n integer) returns integer language sql as $$ select public.saldo_crediti(pg_temp.p(n)) $$;
create function pg_temp.manda(da integer, a integer, regalo text, chiave integer) returns text language sql as $$
  select public.manda_regalo(pg_temp.p(da), pg_temp.p(a), regalo, pg_temp.k(chiave))
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'regalo' || n || '@example.com' from generate_series(1, 16) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'MI', 'donna' from generate_series(1, 16) n;
-- Tutti cercano «tutti» in Italia, tranne p3 che non ha filtri (quindi non è compatibile con nessuno).
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select pg_temp.p(n), 'tutti', now(), '1.5', 18, 99, 'italia' from generate_series(1, 16) n where n <> 3;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('c0155555-0000-4000-8000-000000000001', 'italia', now() - interval '3 days', now() + interval '2 days'),
  ('c0155555-0000-4000-8000-000000000002', 'italia', now() - interval '7 days', now() - interval '1 minute');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'c0155555-0000-4000-8000-000000000001', pg_temp.p(n) from unnest(array[1, 2, 3, 5, 6, 7, 11, 13, 14, 15, 16]) n;
insert into public.membri_stanza (stanza_id, utente_id)
  select 'c0155555-0000-4000-8000-000000000002', pg_temp.p(n) from unnest(array[9, 10]) n;
insert into public.blocchi (chi, bloccato) values (pg_temp.p(5), pg_temp.p(1));
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il, esito, chiusa_il) values
  (pg_temp.k(901), pg_temp.p(6), pg_temp.p(1), 'insulti', 'scheda', now() - interval '2 days', now() - interval '1 day', 'archiviata', now() - interval '1 day'),
  (pg_temp.k(902), pg_temp.p(1), pg_temp.p(11), 'altro', 'scheda', now() - interval '1 hour', now() + interval '1 day', null, null),
  (pg_temp.k(903), pg_temp.p(4), pg_temp.p(7), 'insulti', 'scheda', now() - interval '1 hour', now() + interval '1 day', null, null);
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(7), 'cautelare', pg_temp.k(903), now() + interval '1 day');
select public.assegna_crediti_beta(pg_temp.p(n), 200) from generate_series(1, 16) n where n <> 16;
select public.assegna_crediti_beta(pg_temp.p(16), 12);

select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.regali'::regclass), 'regali: regole per riga attive');
-- Il telefono non legge e non scrive i regali e non lancia la funzione del server.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.regali$$)
  and pg_temp.rifiutato($$insert into public.regali (chiave, da, a, stanza_id, regalo, coin)
    values (gen_random_uuid(), auth.uid(), pg_temp.p(2), 'c0155555-0000-4000-8000-000000000001', 'rosa', 5)$$)
  and pg_temp.rifiutato($$select public.manda_regalo(auth.uid(), pg_temp.p(2), 'rosa', gen_random_uuid())$$),
  'regali: il telefono non legge, non scrive e non manda regali da solo (solo il server)');
reset role;

set local role service_role;
select pg_temp.ok(public.coin_regalo('rosa') = 5 and public.coin_regalo('spumante') = 10 and public.coin_regalo('fiori') = 20
  and public.coin_regalo('diamante') is null, 'coin: rosa 5, spumante 10, fiori 20 (uguali a api/coin.js)');

-- Un regalo: −5 a chi manda, 0 a chi riceve.
select pg_temp.ok(pg_temp.manda(1, 2, 'rosa', 1) = 'ok', 'regalo: p1 manda una rosa a p2');
select pg_temp.ok(pg_temp.saldo(1) = 195 and pg_temp.saldo(2) = 200, 'regalo: −5 Coin a chi manda, 0 Coin a chi riceve');
select pg_temp.ok((select count(*) from public.crediti_movimenti where persona = pg_temp.p(1) and tipo = 'regalo' and crediti = -5) = 1
  and not exists (select 1 from public.crediti_movimenti where persona = pg_temp.p(2) and tipo = 'regalo'),
  'regalo: un movimento «regalo» nel registro, solo di chi manda');
-- Due tocchi rapidi (stessa chiave): parte un solo regalo.
select pg_temp.ok(pg_temp.manda(1, 2, 'rosa', 1) = 'ok', 'regalo: la stessa richiesta ripetuta risponde ok');
select pg_temp.ok(pg_temp.saldo(1) = 195 and (select count(*) from public.regali where da = pg_temp.p(1)) = 1,
  'regalo: con la stessa chiave parte un solo regalo e i Coin si scalano una volta');
select pg_temp.ok(pg_temp.manda(1, 2, 'spumante', 2) = 'ok' and pg_temp.manda(1, 13, 'fiori', 3) = 'ok', 'regalo: spumante e fiori');
select pg_temp.ok(pg_temp.saldo(1) = 165, 'regalo: −10 e −20 Coin');

-- Dati non validi.
select pg_temp.ok(pg_temp.manda(1, 2, 'diamante', 4) = 'regalo_sconosciuto', 'regalo: un regalo che non esiste è rifiutato');
select pg_temp.ok(public.manda_regalo(pg_temp.p(1), pg_temp.p(2), 'rosa', null) = 'dati_mancanti'
  and public.manda_regalo(pg_temp.p(1), pg_temp.p(1), 'rosa', pg_temp.k(5)) = 'dati_mancanti',
  'regalo: senza chiave o a se stessi è rifiutato');

-- Le regole della spec, ricontrollate dal server.
select pg_temp.ok(pg_temp.manda(1, 4, 'rosa', 10) = 'non_nella_stanza', 'regalo: rifiutato a chi non è nella tua stanza');
select pg_temp.ok(pg_temp.manda(1, 3, 'rosa', 11) = 'non_compatibile', 'regalo: rifiutato a chi non è compatibile');
select pg_temp.ok(pg_temp.manda(1, 5, 'rosa', 12) = 'blocco', 'regalo: rifiutato se l''altra persona ti ha bloccato');
select pg_temp.ok(pg_temp.manda(5, 1, 'rosa', 13) = 'blocco', 'regalo: rifiutato se hai bloccato l''altra persona');
select pg_temp.ok(pg_temp.manda(1, 6, 'rosa', 14) = 'segnalazione', 'regalo: rifiutato se l''altra persona ti ha segnalato (anche archiviata)');
select pg_temp.ok(pg_temp.manda(1, 11, 'rosa', 15) = 'segnalazione', 'regalo: rifiutato se hai segnalato l''altra persona');
select pg_temp.ok(pg_temp.manda(1, 7, 'rosa', 16) = 'sospensione' and pg_temp.manda(7, 1, 'rosa', 17) = 'sospensione',
  'regalo: rifiutato se uno dei due è sospeso');
select pg_temp.ok(pg_temp.manda(9, 10, 'rosa', 18) = 'stanza_chiusa', 'regalo: rifiutato a stanza chiusa');
select pg_temp.ok(pg_temp.saldo(1) = 165 and pg_temp.saldo(5) = 200 and pg_temp.saldo(7) = 200 and pg_temp.saldo(9) = 200,
  'regalo: nessun Coin scalato con un rifiuto');

-- Saldo: il regalo non parte se non basta.
select pg_temp.ok(pg_temp.manda(16, 2, 'fiori', 20) = 'saldo', 'regalo: fiori rifiutati con 12 Coin');
select pg_temp.ok(pg_temp.manda(16, 2, 'spumante', 21) = 'ok', 'regalo: spumante con 12 Coin');
select pg_temp.ok(pg_temp.manda(16, 2, 'rosa', 22) = 'saldo' and pg_temp.saldo(16) = 2, 'regalo: rosa rifiutata con 2 Coin, saldo 2');

-- Limiti: 3 al giorno alla stessa persona, 10 al giorno in tutto (giorno di Roma).
select pg_temp.ok(pg_temp.manda(1, 2, 'rosa', 30) = 'ok', 'limite: terzo regalo di oggi a p2');
select pg_temp.ok(pg_temp.manda(1, 2, 'rosa', 31) = 'limite_persona', 'limite: il quarto regalo di oggi alla stessa persona è rifiutato');
select pg_temp.ok(pg_temp.manda(1, 13, 'rosa', 32) = 'ok' and pg_temp.manda(1, 13, 'rosa', 33) = 'ok'
  and pg_temp.manda(1, 14, 'rosa', 34) = 'ok' and pg_temp.manda(1, 14, 'rosa', 35) = 'ok' and pg_temp.manda(1, 14, 'rosa', 36) = 'ok',
  'limite: altri regali fino a 9');
select pg_temp.ok(pg_temp.manda(1, 15, 'rosa', 37) = 'ok', 'limite: decimo regalo di oggi');
select pg_temp.ok(pg_temp.manda(1, 15, 'rosa', 38) = 'limite_giorno', 'limite: l''undicesimo regalo di oggi è rifiutato');
select pg_temp.ok((select count(*) from public.regali where da = pg_temp.p(1)) = 10, 'limite: 10 regali di p1 nel database');
reset role;
-- I regali di ieri non contano per i limiti di oggi.
insert into public.crediti_movimenti (persona, tipo, crediti) values (pg_temp.p(13), 'regalo', -5), (pg_temp.p(13), 'regalo', -5),
  (pg_temp.p(13), 'regalo', -5);
insert into public.regali (chiave, da, a, stanza_id, regalo, coin, mandato_il, movimento_id)
  select gen_random_uuid(), pg_temp.p(13), pg_temp.p(2), 'c0155555-0000-4000-8000-000000000001', 'rosa', 5,
    date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome' - interval '1 minute', m.id
  from public.crediti_movimenti m where m.persona = pg_temp.p(13) and m.tipo = 'regalo';
set local role service_role;
select pg_temp.ok(pg_temp.manda(13, 2, 'rosa', 40) = 'ok', 'limite: 3 regali di ieri alla stessa persona non bloccano quelli di oggi');

-- Il registro accetta per i regali solo −5, −10, −20.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti) values (pg_temp.p(2), 'regalo', -7)$$)
  and pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti) values (pg_temp.p(2), 'regalo', 5)$$),
  'registro: un regalo costa solo 5, 10 o 20 Coin');
-- Chi riceve elimina l'account: il regalo sparisce, i Coin di chi l'ha mandato restano scalati (registro intatto).
reset role;
delete from auth.users where id = pg_temp.p(15);
select pg_temp.ok(not exists (select 1 from public.regali where a = pg_temp.p(15)) and pg_temp.saldo(1) = 130,
  'oblio: eliminando chi riceve, il regalo sparisce e il saldo di chi l''ha mandato non cambia');
rollback;
