-- Test dei locali consigliati nel test interno (issue #6, spec v1.1 punto 1; decisione D143 B di Giuseppe del 20/11).
-- Linea «sviluppatore-b», passo 2t. I 30 locali di Milano del tab «Locali pilota» sono nel database «da visitare»;
-- si mostrano solo a chi è in provincia di Milano, con «da verificare»; fuori Milano solo i locali «visitato» della
-- propria provincia (al massimo 3), di solito nessuno: resta il luogo scritto. La proposta accetta solo un locale che
-- chi propone può vedere. Dati inventati, Postgres di prova.
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
select pg_temp.ok((select count(*) from public.locali where provincia = 'MI' and stato = 'da_visitare') = 30,
  'locali Milano: i 30 del tab «Locali pilota», tutti «da visitare»');
select pg_temp.ok((select count(*) from public.locali where provincia <> 'MI') = 0, 'locali Milano: nessun altro locale');
select pg_temp.ok((select count(distinct (nome, indirizzo)) from public.locali) = 30, 'locali Milano: nessun doppione');

insert into auth.users (id, email) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'mi1@example.com'), ('7b7b7b7b-0000-4000-8000-00000000007b', 'mi2@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'rm1@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'Ada', '1990-01-01', 'MI', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000007b', 'Bruno', '1988-06-01', 'MI', 'uomo'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'Carlo', '1985-01-01', 'RM', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour');
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('7d7d7d7d-0000-4000-8000-0000000000ab', '7f7f7f7f-0000-4000-8000-000000000001',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7b7b7b7b-0000-4000-8000-00000000007b', now() - interval '1 hour'),
  ('7d7d7d7d-0000-4000-8000-0000000000ac', '7f7f7f7f-0000-4000-8000-000000000001',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7c7c7c7c-0000-4000-8000-00000000007c', now() - interval '1 hour');

-- Il telefono non chiama la funzione: passa solo dal Worker.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a')$$),
  'locali_per_persona: il telefono non la chiama');
reset role;

set local role service_role;
select pg_temp.ok(jsonb_array_length(public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a')) = 30,
  'chi è a Milano vede i 30 locali');
select pg_temp.ok((select bool_and((x->>'da_verificare')::boolean) from jsonb_array_elements(
  public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a')) x), 'a Milano tutti con «da verificare»');
select pg_temp.ok((select bool_and(x ?& array['id', 'nome', 'indirizzo', 'tipo', 'fascia', 'da_verificare']
  and not x ? 'stato' and not x ? 'provincia') from jsonb_array_elements(
  public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a')) x), 'a Milano solo i campi per la schermata');
select pg_temp.ok(public.locali_per_persona('7c7c7c7c-0000-4000-8000-00000000007c') = '[]'::jsonb,
  'fuori Milano nessun locale (resta il luogo scritto)');
select pg_temp.ok(public.locali_per_persona('7e7e7e7e-0000-4000-8000-00000000007e') = '[]'::jsonb,
  'persona sconosciuta: nessun locale');

-- Un locale «visitato» viene prima e senza «da verificare»; uno «escluso» sparisce.
update public.locali set stato = 'visitato' where nome = 'Vino';
update public.locali set stato = 'escluso' where nome = 'KOI';
select pg_temp.ok((public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a') -> 0 ->> 'nome') = 'Vino'
  and (public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a') -> 0 ->> 'da_verificare')::boolean = false,
  'a Milano il locale visitato è il primo, senza «da verificare»');
select pg_temp.ok(jsonb_array_length(public.locali_per_persona('7a7a7a7a-0000-4000-8000-00000000007a')) = 29,
  'a Milano il locale escluso non si vede');

-- Fuori Milano: solo i «visitato» della propria provincia, al massimo 3.
insert into public.locali (nome, indirizzo, provincia, tipo, stato) values
  ('Caffè Uno', 'Via Prova 1', 'RM', 'caffè', 'visitato'), ('Caffè Due', 'Via Prova 2', 'RM', 'caffè', 'visitato'),
  ('Caffè Tre', 'Via Prova 3', 'RM', 'caffè', 'visitato'), ('Caffè Quattro', 'Via Prova 4', 'RM', 'caffè', 'visitato'),
  ('Caffè Cinque', 'Via Prova 5', 'RM', 'caffè', 'da_visitare');
select pg_temp.ok(jsonb_array_length(public.locali_per_persona('7c7c7c7c-0000-4000-8000-00000000007c')) = 3,
  'fuori Milano al massimo 3 locali visitati');
select pg_temp.ok((select bool_and(not (x->>'da_verificare')::boolean and x->>'nome' <> 'Caffè Cinque') from jsonb_array_elements(
  public.locali_per_persona('7c7c7c7c-0000-4000-8000-00000000007c')) x), 'fuori Milano mai locali da verificare');

-- La proposta accetta solo un locale che chi propone può vedere.
select public.assegna_crediti_beta(x, 30) from unnest(array['7a7a7a7a-0000-4000-8000-00000000007a',
  '7b7b7b7b-0000-4000-8000-00000000007b', '7c7c7c7c-0000-4000-8000-00000000007c']::uuid[]) x;
select public.blocca_caparra('7d7d7d7d-0000-4000-8000-0000000000ab', '7a7a7a7a-0000-4000-8000-00000000007a');
select public.blocca_caparra('7d7d7d7d-0000-4000-8000-0000000000ab', '7b7b7b7b-0000-4000-8000-00000000007b');
select public.blocca_caparra('7d7d7d7d-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a');
select public.blocca_caparra('7d7d7d7d-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c');
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id in ('7d7d7d7d-0000-4000-8000-0000000000ab', '7d7d7d7d-0000-4000-8000-0000000000ac');
select pg_temp.ok(public.proponi_incontro('7d7d7d7d-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c',
  pg_temp.roma(2, 19), (select id::text from public.locali where nome = 'Cru Isola'), null) = 'luogo_non_valido',
  'proposta: chi è fuori Milano non propone un locale di Milano');
select pg_temp.ok(public.proponi_incontro('7d7d7d7d-0000-4000-8000-0000000000ab', '7a7a7a7a-0000-4000-8000-00000000007a',
  pg_temp.roma(2, 19), 'bar-1', null) = 'luogo_non_valido', 'proposta: un locale che non esiste è rifiutato');
select pg_temp.ok(public.proponi_incontro('7d7d7d7d-0000-4000-8000-0000000000ab', '7a7a7a7a-0000-4000-8000-00000000007a',
  pg_temp.roma(2, 19), (select id::text from public.locali where nome = 'KOI'), null) = 'luogo_non_valido',
  'proposta: un locale escluso è rifiutato');
select pg_temp.ok(public.proponi_incontro('7d7d7d7d-0000-4000-8000-0000000000ab', '7a7a7a7a-0000-4000-8000-00000000007a',
  pg_temp.roma(2, 19), (select id::text from public.locali where nome = 'Cru Isola'), null) = 'proposto',
  'proposta: chi è a Milano propone un locale di Milano da verificare');
select pg_temp.ok((select locale from public.incontri where porta_id = '7d7d7d7d-0000-4000-8000-0000000000ab')
  = (select id::text from public.locali where nome = 'Cru Isola'), 'proposta: salvato l''id del locale');

-- Passo 2u: locali_incontro(porta, persona) per il Worker: i locali di chi legge e il locale scelto.
select pg_temp.ok(jsonb_array_length(public.locali_incontro('7d7d7d7d-0000-4000-8000-0000000000ab',
  '7a7a7a7a-0000-4000-8000-00000000007a') -> 'locali') = 29, 'locali_incontro: i locali di chi legge');
select pg_temp.ok(public.locali_incontro('7d7d7d7d-0000-4000-8000-0000000000ab', '7b7b7b7b-0000-4000-8000-00000000007b')
  -> 'scelto' = '{"nome": "Cru Isola", "indirizzo": "Via Ugo Bassi 24", "da_verificare": true}'::jsonb,
  'locali_incontro: il locale scelto con nome, indirizzo e «da verificare», anche per l''altra persona');
select pg_temp.ok(public.locali_incontro('7d7d7d7d-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c')
  -> 'scelto' = 'null'::jsonb, 'locali_incontro: senza un locale proposto, scelto è null');
select pg_temp.ok(public.locali_incontro('7d7d7d7d-0000-4000-8000-0000000000ab', '7c7c7c7c-0000-4000-8000-00000000007c')
  is null, 'locali_incontro: chi non è nella porta non legge nulla');
reset role;
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.locali_incontro('7d7d7d7d-0000-4000-8000-0000000000ab',
  '7a7a7a7a-0000-4000-8000-00000000007a')$$), 'locali_incontro: il telefono non la chiama');
reset role;
rollback;
