-- Test della decisione sui ricorsi (issue #7, spec v1.1 definitiva, regola «Ricorso»; D51 A: in beta decide Giuseppe).
-- Linea «sviluppatore-b», passo 13d. Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh. Dati inventati.
-- Spec: lo decide una persona diversa da chi ha sanzionato; il ricorso non si chiude senza un'azione umana; durante
-- il ricorso la sanzione resta attiva. Accolto → la sanzione si annulla (la persona torna attiva); respinto → resta.
-- Ogni decisione resta nel registro. Solo i moderatori; solo il server.
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
  select ('d13d13d1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'rd' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome) values (pg_temp.p(2), 'Bruno'), (pg_temp.p(3), 'Dario');
insert into public.moderatori (persona) values (pg_temp.p(8)), (pg_temp.p(9));
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'soldi', 'scheda', null, false) as s1 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'sospensione_30', 'Niente soldi né vendite', 'chiedeva regali') as z1 \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'insulti', 'scheda', null, false) as s2 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s2', 'avviso', 'Rispetto', 'insulti') as z2 \gset
reset role;
select pg_temp.come(pg_temp.p(2));
select public.nuovo_ricorso(:'z1', 'Ho solo chiesto un caffè.');
reset role;
select pg_temp.come(pg_temp.p(3));
select public.nuovo_ricorso(:'z2', 'Non ho insultato nessuno.');
reset role;
select id as r1 from public.ricorsi where sanzione_id = :'z1' \gset
select id as r2 from public.ricorsi where sanzione_id = :'z2' \gset

set local role service_role;
-- 1. Elenco dei ricorsi in attesa: solo moderatori, prima chi deve avere risposta prima, con livello, regola, testo.
select pg_temp.ok(pg_temp.rifiutato(format($$select * from public.ricorsi_da_decidere(%L)$$, pg_temp.p(4))),
  'ricorsi: chi non è moderatore non li legge');
select pg_temp.ok((select count(*) from public.ricorsi_da_decidere(pg_temp.p(8))) = 2, 'ricorsi: in attesa tutti e due');
select pg_temp.ok((select livello = 'sospensione_30' and regola = 'Niente soldi né vendite' and testo = 'Ho solo chiesto un caffè.'
    and nome = 'Bruno' and motivo_sanzione = 'chiedeva regali' and decisa_da_te = false
    from public.ricorsi_da_decidere(pg_temp.p(8)) where id = :'r1'),
  'ricorsi: livello, regola, perché, nome, motivo di chi ha sanzionato');
select pg_temp.ok((select decisa_da_te from public.ricorsi_da_decidere(pg_temp.p(9)) where id = :'r1'),
  'ricorsi: chi ha sanzionato vede che non può decidere quel ricorso');

-- 2. Lo decide una persona diversa da chi ha sanzionato; motivo obbligatorio; esiti validi.
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_ricorso(%L, %L, 'accolto', 'ok')$$, pg_temp.p(9), :'r1')),
  'ricorsi: chi ha sanzionato non decide il ricorso');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_ricorso(%L, %L, 'accolto', 'ok')$$, pg_temp.p(4), :'r1')),
  'ricorsi: chi non è moderatore non decide');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_ricorso(%L, %L, 'accolto', '  ')$$, pg_temp.p(8), :'r1')),
  'ricorsi: serve il motivo');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_ricorso(%L, %L, 'forse', 'ok')$$, pg_temp.p(8), :'r1')),
  'ricorsi: solo accolto o respinto');
select pg_temp.ok(public.sospeso(pg_temp.p(2)), 'ricorsi: finché nessuno decide la sanzione resta attiva');

-- 3. Accolto: la sanzione si annulla e la persona torna attiva; il ricorso è chiuso; resta nel registro.
select public.decidi_ricorso(pg_temp.p(8), :'r1', 'accolto', 'era una richiesta di un caffè');
select pg_temp.ok(not public.sospeso(pg_temp.p(2)), 'accolto: la sospensione finisce subito');
select pg_temp.ok((select stato = 'accolto' and deciso_da = pg_temp.p(8) and deciso_il is not null from public.ricorsi where id = :'r1'),
  'accolto: ricorso chiuso con chi e quando');
select pg_temp.ok((select annullata_il is not null from public.sanzioni where id = :'z1'), 'accolto: la sanzione risulta annullata');
select pg_temp.ok((select count(*) from public.registro_moderazione where sanzione_id = :'z1' and azione = 'ricorso_accolto' and chi = pg_temp.p(8)) = 1,
  'accolto: la decisione resta nel registro');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_ricorso(%L, %L, 'respinto', 'ripensamento')$$, pg_temp.p(8), :'r1')),
  'ricorsi: una decisione sola, non si cambia');

-- 4. Respinto: la sanzione resta.
select public.decidi_ricorso(pg_temp.p(8), :'r2', 'respinto', 'insulti confermati');
select pg_temp.ok((select stato = 'respinto' from public.ricorsi where id = :'r2')
    and (select annullata_il is null from public.sanzioni where id = :'z2'), 'respinto: la sanzione resta');
select pg_temp.ok((select count(*) from public.ricorsi_da_decidere(pg_temp.p(8))) = 0, 'ricorsi: decisi, spariscono dall''elenco');
reset role;

-- 5. Chi ha fatto ricorso vede l'esito nel suo messaggio.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok((select ricorso_stato = 'accolto' from public.mie_sanzioni()), 'accolto: chi ha contestato vede l''esito');
reset role;
rollback;
