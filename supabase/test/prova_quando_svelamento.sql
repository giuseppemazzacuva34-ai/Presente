-- Test di «Quando» (issue #65 passo 5a; spec v1 del CPO, passo 4 e «Casi limite»): «Sono pronto ora» vale 5 minuti e
-- serve la caparra di entrambi; «Scegli un orario» salva fino a 3 fasce da 30 minuti dentro le 48 ore e fissa la prima
-- comune. svelamento_di dice le proprie fasce, la fascia fissata e se l'altra persona è pronta, mai le sue fasce.
-- Linea «sviluppatore». Dati inventati, Postgres di prova.
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
-- Inizio di fascia allineato a :00/:30, «n» mezz'ore dopo adesso.
create function pg_temp.fascia(n int) returns timestamptz language sql as $$
  select to_timestamp((floor(extract(epoch from now()) / 1800) + n) * 1800)
$$;
create function pg_temp.porta_di(persona uuid) returns jsonb language sql as $$
  select p from jsonb_array_elements(public.svelamento_di(persona) -> 'porte') p where p ->> 'porta' = '8e8e8e8e-0000-4000-8000-0000000000ab'
$$;

begin;
insert into auth.users (id, email) values
  ('6a6a6a6a-0000-4000-8000-00000000006a', 'qa@example.com'), ('6b6b6b6b-0000-4000-8000-00000000006b', 'qb@example.com'),
  ('6c6c6c6c-0000-4000-8000-00000000006c', 'qc@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('6a6a6a6a-0000-4000-8000-00000000006a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('6b6b6b6b-0000-4000-8000-00000000006b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('6c6c6c6c-0000-4000-8000-00000000006c', 'Ciro', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour'),
  ('7f7f7f7f-0000-4000-8000-000000000002', 'italia', now() - interval '10 days', now() - interval '3 days');
-- Porte: Ada-Bruno (aperta da 1 ora), Ada-Ciro (aperta da 3 giorni: 48 ore passate).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8e8e8e8e-0000-4000-8000-0000000000ab', '7f7f7f7f-0000-4000-8000-000000000001',
   '6a6a6a6a-0000-4000-8000-00000000006a', '6b6b6b6b-0000-4000-8000-00000000006b', now() - interval '1 hour'),
  ('8e8e8e8e-0000-4000-8000-0000000000ac', '7f7f7f7f-0000-4000-8000-000000000002',
   '6a6a6a6a-0000-4000-8000-00000000006a', '6c6c6c6c-0000-4000-8000-00000000006c', now() - interval '3 days');

-- Il telefono non chiama le funzioni.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a')$$)
  and pg_temp.rifiutato($$select public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a', array[now()])$$),
  'pronto/fasce: il telefono non le chiama');
reset role;
set local role service_role;

-- Senza caparre: «Sono pronto ora» e le fasce non si salvano.
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'manca_caparra',
  'pronto: senza caparre → manca_caparra');
select pg_temp.ok(public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a', array[pg_temp.fascia(4)]) = 'manca_caparra',
  'fasce: senza la propria caparra → manca_caparra');

select public.assegna_crediti_beta('6a6a6a6a-0000-4000-8000-00000000006a', 100);
select public.assegna_crediti_beta('6b6b6b6b-0000-4000-8000-00000000006b', 100);
select public.caparra_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a');

-- Solo Ada ha la caparra: le fasce sì, «pronto» no (lo svelamento non si avvia senza due caparre).
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'manca_caparra',
  'pronto: con una sola caparra → manca_caparra');
select pg_temp.ok(public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a',
  array[pg_temp.fascia(10), pg_temp.fascia(4), pg_temp.fascia(4)]) = 'salvate',
  'fasce: Ada segna due fasce (doppione tolto) → salvate');
select pg_temp.ok((select fasce_a = array[pg_temp.fascia(4), pg_temp.fascia(10)] and fasce_b = '{}' and fascia_fissata is null
  from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab'),
  'fasce: salvate in ordine solo per Ada, nessuna fascia fissata');

-- Fasce non valide: nessuna, più di 3, non allineata, già iniziata, oltre la scadenza.
select pg_temp.ok(public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a', '{}') = 'fasce_non_valide'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a', null) = 'fasce_non_valide'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a',
    array[pg_temp.fascia(2), pg_temp.fascia(3), pg_temp.fascia(4), pg_temp.fascia(5)]) = 'fasce_non_valide'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a',
    array[pg_temp.fascia(4) + interval '15 minutes']) = 'fasce_non_valide'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a',
    array[pg_temp.fascia(0)]) = 'fasce_non_valide'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a',
    array[pg_temp.fascia(200)]) = 'fasce_non_valide'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a',
    array[null::timestamptz]) = 'fasce_non_valide',
  'fasce: vuote, più di 3, non allineate, già iniziate, oltre le 48 ore o nulle → fasce_non_valide');
select pg_temp.ok((select fasce_a = array[pg_temp.fascia(4), pg_temp.fascia(10)] from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab'),
  'fasce: dopo un rifiuto restano quelle di prima');

-- Bruno blocca e segna una fascia in comune: l'app fissa la prima comune.
select public.caparra_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b');
select pg_temp.ok(public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b',
  array[pg_temp.fascia(10), pg_temp.fascia(6), pg_temp.fascia(4)]) = 'fissata',
  'fasce: Bruno ha due fasce in comune con Ada → fissata');
select pg_temp.ok((select fascia_fissata = pg_temp.fascia(4) from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab'),
  'fasce: fissata la prima fascia comune');
select pg_temp.ok((select p -> 'mie_fasce' = to_jsonb(array[pg_temp.fascia(4), pg_temp.fascia(10)])
    and (p ->> 'fascia_fissata')::timestamptz = pg_temp.fascia(4) and not p ? 'sue_fasce' and not p ? 'fasce_b'
  from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000006a') p),
  'svelamento_di: Ada vede le sue fasce e la fascia fissata, mai quelle di Bruno');
-- Ada cambia le sue fasce: nessuna più in comune → la fascia fissata sparisce.
select pg_temp.ok(public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a', array[pg_temp.fascia(8)]) = 'salvate',
  'fasce: Ada cambia le sue fasce → salvate');
select pg_temp.ok((select fascia_fissata is null from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab'),
  'fasce: cambiate senza fasce comuni → nessuna fascia fissata');

-- «Sono pronto ora»: Ada pronta, Bruno no; poi Bruno entro 5 minuti → entrambi pronti.
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'pronto',
  'pronto: Ada è pronta, Bruno non ancora');
select pg_temp.ok((select (p ->> 'mio_pronto')::boolean and not (p ->> 'suo_pronto')::boolean and p ->> 'pronto_scade_il' is not null
  from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000006a') p)
  and (select not (p ->> 'mio_pronto')::boolean and (p ->> 'suo_pronto')::boolean from pg_temp.porta_di('6b6b6b6b-0000-4000-8000-00000000006b') p),
  'svelamento_di: Ada vede «pronta», Bruno vede che Ada è pronta');
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b') = 'entrambi_pronti',
  'pronto: Bruno entro 5 minuti → entrambi_pronti');
-- Dopo 5 minuti «pronto» non vale più.
reset role;
update public.svelamenti set pronto_a_il = now() - interval '6 minutes', pronto_b_il = null where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab';
set local role service_role;
select pg_temp.ok((select not (p ->> 'suo_pronto')::boolean from pg_temp.porta_di('6b6b6b6b-0000-4000-8000-00000000006b') p)
  and public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b') = 'pronto',
  'pronto: dopo 5 minuti Ada non è più pronta e Bruno aspetta di nuovo');

-- Persone fuori dalla porta, porta scaduta, svelamento già iniziato.
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6c6c6c6c-0000-4000-8000-00000000006c') = 'non_nella_porta'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ff', '6a6a6a6a-0000-4000-8000-00000000006a', array[pg_temp.fascia(4)]) = 'non_nella_porta',
  'pronto/fasce: porta di altri o inesistente → non_nella_porta');
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ac', '6a6a6a6a-0000-4000-8000-00000000006a') = 'porta_scaduta'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ac', '6a6a6a6a-0000-4000-8000-00000000006a', array[pg_temp.fascia(4)]) = 'porta_scaduta',
  'pronto/fasce: porta scaduta');
reset role;
update public.svelamenti set iniziato_il = now(), tipo = 'video', tentativi = 1 where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab';
set local role service_role;
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'gia_iniziato'
  and public.fasce_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a', array[pg_temp.fascia(4)]) = 'gia_iniziato',
  'pronto/fasce: dopo l''inizio dello svelamento → gia_iniziato');

-- Porta chiusa da un blocco: «porta_chiusa», crediti restituiti a entrambi.
reset role;
update public.svelamenti set iniziato_il = null, tipo = null, tentativi = 0 where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab';
insert into public.blocchi (chi, bloccato) values ('6b6b6b6b-0000-4000-8000-00000000006b', '6a6a6a6a-0000-4000-8000-00000000006a');
set local role service_role;
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'porta_chiusa',
  'pronto: porta con un blocco → porta_chiusa');
select pg_temp.ok((select esito = 'blocco' from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000000ab')
  and public.saldo_crediti('6a6a6a6a-0000-4000-8000-00000000006a') = 100 and public.saldo_crediti('6b6b6b6b-0000-4000-8000-00000000006b') = 100,
  'pronto: porta chiusa e crediti restituiti a entrambi');

reset role;
rollback;
