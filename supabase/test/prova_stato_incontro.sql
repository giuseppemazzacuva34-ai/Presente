-- Test dello stato dell'incontro letto dal telefono tramite il server (issue #6 passo 2d; spec v1 del CPO del 3/11,
-- punti 2 e 3). stato_incontro(porta, persona) dice a una delle due persone, dal suo punto di vista: stato, scadenza,
-- proposta in corso (giorno e ora, locale o luogo), se la proposta è sua, fino a quando vale, quante controproposte
-- restano e quali pulsanti ha. Mai l'id dell'altra persona, mai una posizione. Linea «sviluppatore-b».
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
create function pg_temp.roma(giorni integer, ora integer, minuti integer default 0) returns timestamptz language sql as $$
  select (date_trunc('day', now() at time zone 'Europe/Rome') + make_interval(days => giorni, hours => ora, mins => minuti))
    at time zone 'Europe/Rome'
$$;

begin;
-- Passo 2t (D143 B): la proposta accetta solo un locale che chi propone vede; due locali «visitato» a Torino.
insert into public.locali (id, nome, indirizzo, provincia, tipo, stato) values
  ('b1b1b1b1-0000-4000-8000-000000000001', 'Bar Uno', 'Via Prova 1', 'TO', 'bar', 'visitato'),
  ('b1b1b1b1-0000-4000-8000-000000000002', 'Bar Due', 'Via Prova 2', 'TO', 'bar', 'visitato');
insert into auth.users (id, email) values
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'sa@example.com'), ('9b9b9b9b-0000-4000-8000-00000000009b', 'sb@example.com'),
  ('9c9c9c9c-0000-4000-8000-00000000009c', 'sc@example.com'), ('9e9e9e9e-0000-4000-8000-00000000009e', 'se@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('9a9a9a9a-0000-4000-8000-00000000009a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('9b9b9b9b-0000-4000-8000-00000000009b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('9c9c9c9c-0000-4000-8000-00000000009c', 'Carlo', '1985-01-01', 'PA', 'uomo'),
  ('9e9e9e9e-0000-4000-8000-00000000009e', 'Elio', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6f6f6f6f-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Ada-Bruno (doppio sì da poco), Ada-Carlo (doppio sì di marzo: incontro scaduto), Ada-Elio (nessun doppio sì).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9f9f9f9f-0000-4000-8000-0000000000ab', '6f6f6f6f-0000-4000-8000-000000000001',
   '9a9a9a9a-0000-4000-8000-00000000009a', '9b9b9b9b-0000-4000-8000-00000000009b', now() - interval '1 hour'),
  ('9f9f9f9f-0000-4000-8000-0000000000ac', '6f6f6f6f-0000-4000-8000-000000000001',
   '9a9a9a9a-0000-4000-8000-00000000009a', '9c9c9c9c-0000-4000-8000-00000000009c', now() - interval '1 hour'),
  ('9f9f9f9f-0000-4000-8000-0000000000ae', '6f6f6f6f-0000-4000-8000-000000000001',
   '9a9a9a9a-0000-4000-8000-00000000009a', '9e9e9e9e-0000-4000-8000-00000000009e', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta('9a9a9a9a-0000-4000-8000-00000000009a', 200);
select public.assegna_crediti_beta('9b9b9b9b-0000-4000-8000-00000000009b', 100);
select public.assegna_crediti_beta('9c9c9c9c-0000-4000-8000-00000000009c', 100);
select public.blocca_caparra('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a');
select public.blocca_caparra('9f9f9f9f-0000-4000-8000-0000000000ab', '9b9b9b9b-0000-4000-8000-00000000009b');
select public.blocca_caparra('9f9f9f9f-0000-4000-8000-0000000000ac', '9a9a9a9a-0000-4000-8000-00000000009a');
select public.blocca_caparra('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c');
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ab';
update public.svelamenti set iniziato_il = '2026-03-09 18:30:00+00', tentativi = 1, tipo = 'foto', durata_secondi = 10,
  finito_il = '2026-03-09 18:40:00+00', esito = 'doppio_si', esito_il = '2026-03-09 19:00:00+00'
  where porta_id = '9f9f9f9f-0000-4000-8000-0000000000ac';
reset role;

-- Il telefono non la chiama: passa solo dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab',
  '9a9a9a9a-0000-4000-8000-00000000009a')$$), 'stato: il telefono non la chiama');
reset role;

set local role service_role;
create temp table s (chi text, j jsonb) on commit drop;
-- Chi non è nella porta e porta senza doppio sì.
select pg_temp.ok(public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9e9e9e9e-0000-4000-8000-00000000009e')
  = '{"errore": "non_nella_porta"}'::jsonb, 'stato: chi non è nella porta non vede nulla');
select pg_temp.ok(public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ae', '9a9a9a9a-0000-4000-8000-00000000009a')
  = '{"errore": "nessun_incontro"}'::jsonb, 'stato: senza doppio sì nessun incontro');

-- Da fissare: l'incontro si apre alla prima lettura, con la scadenza; si può solo proporre.
insert into s select 'a0', public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a');
select pg_temp.ok((select j->>'stato' = 'da_fissare' and (j->>'scadenza')::timestamptz > now() + interval '9 days'
  and j->'orario' = 'null'::jsonb and j->'azioni' = '["proponi", "annulla_incontro"]'::jsonb and (j->>'controproposte_rimaste')::int = 3
  from s where chi = 'a0'), 'stato: da fissare, con scadenza, solo «Proponi»');

-- Ada propone: per lei «aspetta», per Bruno i tre pulsanti.
select public.proponi_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a',
  pg_temp.roma(2, 19), 'b1b1b1b1-0000-4000-8000-000000000001', null);
insert into s select 'a1', public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a');
insert into s select 'b1', public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9b9b9b9b-0000-4000-8000-00000000009b');
select pg_temp.ok((select j->>'stato' = 'proposto' and (j->>'proposta_mia')::boolean and j->'azioni' = '["annulla_incontro"]'::jsonb
  and (j->>'orario')::timestamptz = pg_temp.roma(2, 19) and j->>'locale' = 'b1b1b1b1-0000-4000-8000-000000000001' and j->'luogo' = 'null'::jsonb
  from s where chi = 'a1'), 'stato: chi ha proposto aspetta la risposta');
select pg_temp.ok((select not (j->>'proposta_mia')::boolean and j->'azioni' = '["accetto", "altra_data", "annulla"]'::jsonb
  and (j->>'proposta_scade')::timestamptz <= now() + interval '48 hours'
  and (j->>'proposta_scade')::timestamptz > now() + interval '47 hours'
  from s where chi = 'b1'), 'stato: chi riceve la proposta ha i tre pulsanti e sa fino a quando vale');
select pg_temp.ok((select not (j ? 'a') and not (j ? 'b') and not (j ? 'proposto_da') and j::text not like '%9a9a9a9a%'
  and j::text not like '%9b9b9b9b%' from s where chi in ('a1', 'b1') limit 1), 'stato: mai l''id delle persone');

-- Tre controproposte: poi restano solo «Accetto» e «Annulla».
select public.proponi_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9b9b9b9b-0000-4000-8000-00000000009b',
  pg_temp.roma(3, 19), null, 'Caffè in piazza');
select public.proponi_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a',
  pg_temp.roma(4, 19), 'b1b1b1b1-0000-4000-8000-000000000001', null);
select public.proponi_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9b9b9b9b-0000-4000-8000-00000000009b',
  pg_temp.roma(5, 19), null, 'Caffè in piazza');
insert into s select 'a2', public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a');
select pg_temp.ok((select (j->>'controproposte_rimaste')::int = 0 and j->'azioni' = '["accetto", "annulla"]'::jsonb
  and j->>'luogo' = 'Caffè in piazza' and j->'locale' = 'null'::jsonb from s where chi = 'a2'),
  'stato: finite le controproposte, solo «Accetto» e «Annulla»');

-- Confermato: niente pulsanti di proposta per nessuno dei due, solo «Disdici» (passo 2p).
select public.rispondi_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9a9a9a9a-0000-4000-8000-00000000009a', 'accetto');
insert into s select 'b3', public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ab', '9b9b9b9b-0000-4000-8000-00000000009b');
select pg_temp.ok((select j->>'stato' = 'confermato' and j->'azioni' = '["disdici"]'::jsonb and j->'esito' = 'null'::jsonb
  and (j->>'orario')::timestamptz = pg_temp.roma(5, 19) from s where chi = 'b3'), 'stato: confermato, con giorno e ora');

-- Incontro scaduto senza conferma: la lettura lo chiude e restituisce i crediti.
insert into s select 'c', public.stato_incontro('9f9f9f9f-0000-4000-8000-0000000000ac', '9c9c9c9c-0000-4000-8000-00000000009c');
select pg_temp.ok((select j->>'esito' = 'scaduto' and j->'azioni' = '[]'::jsonb from s where chi = 'c'),
  'stato: incontro scaduto, nessun pulsante');
select pg_temp.ok(public.saldo_crediti('9c9c9c9c-0000-4000-8000-00000000009c') = 100, 'stato: alla scadenza i crediti tornano');
reset role;

rollback;
