-- Test del passo 8b-1 (issue #65, regola dell'esito del CPO del 21/11; linea «sviluppatore»):
--   · rispondi_svelamento(porta, persona, 'si'|'no'): sì/no segreto dopo lo svelamento, una sola volta.
--   · doppio sì → esito subito per entrambi (caparre ancora bloccate, si passa alla #6).
--   · ogni altro caso (sì + no, no + no, sì + silenzio) → nessun esito prima delle 48 ore dalla fine dello svelamento,
--     poi «chiusa» per entrambi e caparre restituite a entrambi nello stesso momento.
--   · svelamento_di() non dice mai cosa ha risposto l'altra persona né se ha risposto; «esiti» uguale per entrambi.
--   · una risposta data non si cambia, nemmeno scrivendo nel database.
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
create function pg_temp.rispondi(porta uuid, persona uuid, risposta text) returns text language sql as $$
  select public.rispondi_svelamento(porta, persona, risposta)
$$;
create function pg_temp.riga(porta uuid) returns public.svelamenti language sql as $$
  select * from public.svelamenti where porta_id = porta
$$;
create function pg_temp.saldo(persona uuid) returns integer language sql as $$
  select public.saldo_crediti(persona)
$$;
create function pg_temp.vista(persona uuid) returns jsonb language sql as $$
  select public.svelamento_di(persona)
$$;
-- Porta svelata adesso (video di 10 s finito `fine_fa` fa) tra a e b, con le caparre di entrambi.
create function pg_temp.porta_svelata(porta uuid, a uuid, b uuid, fine_fa interval) returns void language plpgsql as $$
begin
  insert into public.porte (id, stanza_id, a, b, aperta_il)
    values (porta, '7f7f7f7f-0000-4000-8000-000000000801', a, b, now() - fine_fa - interval '3 hours');
  perform public.assegna_crediti_beta(a, 100);
  perform public.assegna_crediti_beta(b, 100);
  perform public.caparra_svelamento(porta, a);
  perform public.caparra_svelamento(porta, b);
  update public.svelamenti set iniziato_il = now() - fine_fa - interval '10 seconds', tipo = 'video', tentativi = 1,
    finito_il = now() - fine_fa, durata_secondi = 10 where porta_id = porta;
end $$;

begin;
insert into auth.users (id, email) values
  ('7a7a7a7a-0000-4000-8000-00000000087a', 'ra@example.com'), ('7b7b7b7b-0000-4000-8000-00000000087b', 'rb@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000087c', 'rc@example.com'), ('7d7d7d7d-0000-4000-8000-00000000087d', 'rd@example.com'),
  ('7e7e7e7e-0000-4000-8000-00000000087e', 're@example.com'), ('7f7f7f7f-0000-4000-8000-00000000088f', 'rf@example.com'),
  ('7b7b7b7b-0000-4000-8000-00000000088b', 'rg@example.com'), ('7c7c7c7c-0000-4000-8000-00000000088c', 'rh@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000087a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000087b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('7c7c7c7c-0000-4000-8000-00000000087c', 'Carla', '1991-01-01', 'TO', 'donna'),
  ('7d7d7d7d-0000-4000-8000-00000000087d', 'Dario', '1987-01-01', 'TO', 'uomo'),
  ('7e7e7e7e-0000-4000-8000-00000000087e', 'Elsa', '1992-01-01', 'TO', 'donna'),
  ('7f7f7f7f-0000-4000-8000-00000000088f', 'Fabio', '1986-01-01', 'TO', 'uomo'),
  ('7b7b7b7b-0000-4000-8000-00000000088b', 'Gaia', '1993-01-01', 'TO', 'donna'),
  ('7c7c7c7c-0000-4000-8000-00000000088c', 'Ivo', '1989-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000801', 'italia', now() - interval '7 days', now() - interval '1 hour');

set local role service_role;
-- Porta 1 (Ada-Bruno): doppio sì. Porta 2 (Carla-Dario): sì + no. Porta 3 (Elsa-Fabio): sì + silenzio.
-- Porta 4 (Gaia-Ivo): ancora da svelare.
select pg_temp.porta_svelata('8f8f8f8f-0000-4000-8000-000000000801', '7a7a7a7a-0000-4000-8000-00000000087a', '7b7b7b7b-0000-4000-8000-00000000087b', interval '1 hour');
select pg_temp.porta_svelata('8f8f8f8f-0000-4000-8000-000000000802', '7c7c7c7c-0000-4000-8000-00000000087c', '7d7d7d7d-0000-4000-8000-00000000087d', interval '1 hour');
select pg_temp.porta_svelata('8f8f8f8f-0000-4000-8000-000000000803', '7e7e7e7e-0000-4000-8000-00000000087e', '7f7f7f7f-0000-4000-8000-00000000088f', interval '1 hour');
insert into public.porte (id, stanza_id, a, b, aperta_il) values ('8f8f8f8f-0000-4000-8000-000000000804',
  '7f7f7f7f-0000-4000-8000-000000000801', '7b7b7b7b-0000-4000-8000-00000000088b', '7c7c7c7c-0000-4000-8000-00000000088c', now() - interval '2 hours');
reset role;

-- Il telefono non chiama la funzione nuova.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7a7a7a7a-0000-4000-8000-00000000087a', 'si')$$),
  'rispondi: il telefono non la chiama');
reset role;
set local role service_role;

-- Controlli d'ingresso.
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7a7a7a7a-0000-4000-8000-00000000087a', 'forse') = 'risposta_non_valida',
  'rispondi: solo «si» o «no»');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7c7c7c7c-0000-4000-8000-00000000087c', 'si') = 'non_nella_porta',
  'rispondi: persona fuori dalla porta → non_nella_porta');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000804', '7b7b7b7b-0000-4000-8000-00000000088b', 'si') = 'non_svelata',
  'rispondi: prima della fine dello svelamento → non_svelata');

-- Porta 1: doppio sì → esito subito per entrambi.
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7a7a7a7a-0000-4000-8000-00000000087a', 'si') = 'risposto',
  'doppio sì: il primo sì → risposto');
select pg_temp.ok((pg_temp.vista('7a7a7a7a-0000-4000-8000-00000000087a')->'svelate'->0->>'ho_risposto')::boolean,
  'doppio sì: chi ha risposto vede «hai risposto»');
select pg_temp.ok(not (pg_temp.vista('7b7b7b7b-0000-4000-8000-00000000087b')->'svelate'->0->>'ho_risposto')::boolean,
  'doppio sì: chi non ha risposto non sa che l''altra persona ha risposto');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7a7a7a7a-0000-4000-8000-00000000087a', 'no') = 'gia_risposto',
  'una risposta data non si cambia → gia_risposto');
select pg_temp.ok((pg_temp.riga('8f8f8f8f-0000-4000-8000-000000000801')).risposta_a = 'si', 'la prima risposta resta');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7b7b7b7b-0000-4000-8000-00000000087b', 'si') = 'doppio_si',
  'doppio sì: il secondo sì → doppio_si subito');
select pg_temp.ok((select esito = 'doppio_si' and esito_il is not null and risposta_a is null and risposta_b is null
    and risposta_a_il is not null and risposta_b_il is not null from pg_temp.riga('8f8f8f8f-0000-4000-8000-000000000801')),
  'doppio sì: esito salvato, le singole risposte cancellate, restano gli orari');
select pg_temp.ok(pg_temp.saldo('7a7a7a7a-0000-4000-8000-00000000087a') = 0 and pg_temp.saldo('7b7b7b7b-0000-4000-8000-00000000087b') = 0,
  'doppio sì: le caparre restano bloccate (si passa all''incontro)');
select pg_temp.ok((select bool_and(v->'esiti'->0->>'esito' = 'doppio_si') and bool_and(jsonb_array_length(v->'svelate') = 0)
    from (select pg_temp.vista('7a7a7a7a-0000-4000-8000-00000000087a') v
          union all select pg_temp.vista('7b7b7b7b-0000-4000-8000-00000000087b')) x),
  'doppio sì: entrambi vedono l''esito, la porta non è più tra le svelate');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000801', '7b7b7b7b-0000-4000-8000-00000000087b', 'no') = 'gia_risposto',
  'doppio sì: dopo l''esito nessuna nuova risposta');

-- Porta 2: sì + no → nessun esito prima delle 48 ore, nessun indizio.
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000802', '7c7c7c7c-0000-4000-8000-00000000087c', 'si') = 'risposto', 'sì + no: sì → risposto');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000802', '7d7d7d7d-0000-4000-8000-00000000087d', 'no') = 'risposto',
  'sì + no: no → risposto (stessa risposta del sì)');
select pg_temp.ok((pg_temp.riga('8f8f8f8f-0000-4000-8000-000000000802')).esito is null, 'sì + no: nessun esito prima delle 48 ore');
select pg_temp.ok(pg_temp.saldo('7c7c7c7c-0000-4000-8000-00000000087c') = 0 and pg_temp.saldo('7d7d7d7d-0000-4000-8000-00000000087d') = 0,
  'sì + no: caparre ancora bloccate prima delle 48 ore');
select pg_temp.ok((select jsonb_array_length(v->'esiti') = 0 and v->'svelate'->0->>'ho_risposto' = 'true'
      and v->'svelate'->0 ? 'risposta_scade_il' and not (v::text ~ '"(si|no)"')
    from pg_temp.vista('7c7c7c7c-0000-4000-8000-00000000087c') v),
  'sì + no: chi ha detto sì vede solo «hai risposto» e la scadenza, mai il no');

-- Porta 3: sì + silenzio, stessa vista della porta 2 per chi ha detto sì.
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000803', '7e7e7e7e-0000-4000-8000-00000000087e', 'si') = 'risposto', 'sì + silenzio: sì → risposto');
select pg_temp.ok((select (v2->'svelate'->0) - 'porta' - 'con' - 'nome' - 'eta' - 'finito_il' - 'risposta_scade_il'
      = (v3->'svelate'->0) - 'porta' - 'con' - 'nome' - 'eta' - 'finito_il' - 'risposta_scade_il'
    from pg_temp.vista('7c7c7c7c-0000-4000-8000-00000000087c') v2, pg_temp.vista('7e7e7e7e-0000-4000-8000-00000000087e') v3),
  'un no e il silenzio danno a chi ha detto sì la stessa vista');

-- Scrivere direttamente nel database non cambia una risposta data.
reset role;
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set risposta_a = 'no' where porta_id = '8f8f8f8f-0000-4000-8000-000000000802'$$),
  'database: una risposta data non si cambia');
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set risposta_a_il = now() + interval '1 minute' where porta_id = '8f8f8f8f-0000-4000-8000-000000000802'$$),
  'database: l''orario di una risposta data non si cambia');
select pg_temp.ok(pg_temp.rifiutato($$update public.svelamenti set risposta_b = 'si' where porta_id = '8f8f8f8f-0000-4000-8000-000000000803'$$),
  'database: nessuna risposta senza il suo orario');

-- 48 ore dopo la fine: porte 2 e 3 chiuse insieme, caparre a entrambi, stesso esito per tutti.
update public.svelamenti set finito_il = finito_il - interval '48 hours', iniziato_il = iniziato_il - interval '48 hours'
  where porta_id in ('8f8f8f8f-0000-4000-8000-000000000802', '8f8f8f8f-0000-4000-8000-000000000803');
set local role service_role;
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000803', '7f7f7f7f-0000-4000-8000-00000000088f', 'si') = 'tempo_scaduto',
  'dopo le 48 ore una risposta non vale più → tempo_scaduto');
select pg_temp.ok((select bool_and(v->'esiti'->0->>'esito' = 'chiusa') and bool_and(jsonb_array_length(v->'svelate') = 0)
    from (select pg_temp.vista('7c7c7c7c-0000-4000-8000-00000000087c') v union all select pg_temp.vista('7d7d7d7d-0000-4000-8000-00000000087d')
          union all select pg_temp.vista('7e7e7e7e-0000-4000-8000-00000000087e') union all select pg_temp.vista('7f7f7f7f-0000-4000-8000-00000000088f')) x),
  'dopo 48 ore: sì + no e sì + silenzio danno «chiusa» a tutti e quattro');
select pg_temp.ok((select bool_and(esito = 'chiusa' and risposta_a is null and risposta_b is null) from public.svelamenti
    where porta_id in ('8f8f8f8f-0000-4000-8000-000000000802', '8f8f8f8f-0000-4000-8000-000000000803')),
  'dopo 48 ore: esito «chiusa», le singole risposte cancellate');
select pg_temp.ok(pg_temp.saldo('7c7c7c7c-0000-4000-8000-00000000087c') = 100 and pg_temp.saldo('7d7d7d7d-0000-4000-8000-00000000087d') = 100
    and pg_temp.saldo('7e7e7e7e-0000-4000-8000-00000000087e') = 100 and pg_temp.saldo('7f7f7f7f-0000-4000-8000-00000000088f') = 100,
  'dopo 48 ore: caparre restituite a entrambi, senza penale');
select pg_temp.ok((select (v->'esiti'->0) - 'porta' - 'con' - 'nome' - 'eta' = (w->'esiti'->0) - 'porta' - 'con' - 'nome' - 'eta'
    from pg_temp.vista('7c7c7c7c-0000-4000-8000-00000000087c') v, pg_temp.vista('7d7d7d7d-0000-4000-8000-00000000087d') w),
  'dopo 48 ore: lo stesso esito a entrambi, nello stesso momento');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000803', '7f7f7f7f-0000-4000-8000-00000000088f', 'si') = 'porta_chiusa',
  'porta chiusa: non si riapre');

-- Sospensione durante le 48 ore: caparre subito a entrambi, l'esito «chiusa» per l'altra persona solo a fine 48 ore.
reset role;
update public.svelamenti set esito = null, esito_il = null, finito_il = now() - interval '1 hour', iniziato_il = now() - interval '1 hour 10 seconds'
  where porta_id = '8f8f8f8f-0000-4000-8000-000000000802';
delete from public.crediti_movimenti where porta_id = '8f8f8f8f-0000-4000-8000-000000000802' and tipo = 'caparra_restituita';
-- Solo in questa prova (la transazione si annulla alla fine): Dario risulta sospeso.
create or replace function public.sospeso(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$ select p_persona = '7d7d7d7d-0000-4000-8000-00000000087d'::uuid $$;
set local role service_role;
select pg_temp.ok((select jsonb_array_length(v->'esiti') = 0 and jsonb_array_length(v->'svelate') = 1
    from pg_temp.vista('7c7c7c7c-0000-4000-8000-00000000087c') v),
  'sospensione: prima delle 48 ore per l''altra persona nessun esito, la porta resta tra le svelate');
select pg_temp.ok((pg_temp.riga('8f8f8f8f-0000-4000-8000-000000000802')).esito = 'sospensione', 'sospensione: porta chiusa');
select pg_temp.ok(pg_temp.saldo('7c7c7c7c-0000-4000-8000-00000000087c') = 100 and pg_temp.saldo('7d7d7d7d-0000-4000-8000-00000000087d') = 100,
  'sospensione: caparre restituite a entrambi');
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000802', '7c7c7c7c-0000-4000-8000-00000000087c', 'si') = 'gia_risposto',
  'sospensione: la risposta data resta, nessun''altra');
reset role;
alter table public.svelamenti disable trigger svelamenti_risposta_ferma;
update public.svelamenti set risposta_b_il = null where porta_id = '8f8f8f8f-0000-4000-8000-000000000802';
alter table public.svelamenti enable trigger svelamenti_risposta_ferma;
set local role service_role;
select pg_temp.ok(pg_temp.rispondi('8f8f8f8f-0000-4000-8000-000000000802', '7d7d7d7d-0000-4000-8000-00000000087d', 'si') = 'risposto'
    and (pg_temp.riga('8f8f8f8f-0000-4000-8000-000000000802')).risposta_b is null,
  'sospensione: chi non ha ancora risposto riceve «risposto» (nessun indizio), ma la risposta non si salva');
reset role;
update public.svelamenti set finito_il = finito_il - interval '48 hours', iniziato_il = iniziato_il - interval '48 hours'
  where porta_id = '8f8f8f8f-0000-4000-8000-000000000802';
set local role service_role;
select pg_temp.ok((select v->'esiti'->0->>'esito' = 'chiusa' and jsonb_array_length(v->'svelate') = 0 and not (v::text ~ 'sospension')
    from pg_temp.vista('7c7c7c7c-0000-4000-8000-00000000087c') v),
  'sospensione: a fine 48 ore «chiusa», senza dire il motivo');

rollback;
