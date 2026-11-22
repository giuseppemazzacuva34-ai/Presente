-- Test di miei_incontri (issue #6, spec v1 del CPO del 3/11, punto 1 «Vi incontrate»; passo 3k della linea
-- «sviluppatore-b»): l'elenco degli incontri di una persona, per raggiungere la schermata «Il vostro incontro» dalla
-- home. Solo gli incontri delle sue porte: aperti (senza esito) o chiusi da meno di 7 giorni (valutazione ed esito);
-- per ognuno porta, nome dell'altra persona, stato, scadenza e orario. Mai cognomi, email, foto o crediti.
-- Solo il server. Dati inventati, Postgres di prova.
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

begin;
insert into auth.users (id, email) values
  ('3a3a3a3a-0000-4000-8000-00000000003a', 'ma@example.com'), ('3b3b3b3b-0000-4000-8000-00000000003b', 'mb@example.com'),
  ('3c3c3c3c-0000-4000-8000-00000000003c', 'mc@example.com'), ('3d3d3d3d-0000-4000-8000-00000000003d', 'md@example.com'),
  ('3e3e3e3e-0000-4000-8000-00000000003e', 'me@example.com');
insert into public.profili (id, nome, data_nascita) values
  ('3a3a3a3a-0000-4000-8000-00000000003a', 'Marta', '1990-01-01'), ('3b3b3b3b-0000-4000-8000-00000000003b', 'Bruno', '1988-01-01'),
  ('3c3c3c3c-0000-4000-8000-00000000003c', 'Carlo', '1987-01-01'), ('3d3d3d3d-0000-4000-8000-00000000003d', 'Dario', '1986-01-01'),
  ('3e3e3e3e-0000-4000-8000-00000000003e', 'Elena', '1991-01-01');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7e7e7e7e-0000-4000-8000-000000000003', 'italia', now() - interval '720 hours', now() - interval '552 hours');
-- Marta ha 3 porte: con Bruno (incontro da fissare), con Carlo (avvenuto 2 giorni fa), con Dario (scaduto 9 giorni fa).
-- Elena ed Bruno hanno una porta che non è di Marta.
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8a8a8a8a-0000-4000-8000-00000000003b', '7e7e7e7e-0000-4000-8000-000000000003', '3a3a3a3a-0000-4000-8000-00000000003a', '3b3b3b3b-0000-4000-8000-00000000003b', now() - interval '3 days'),
  ('8a8a8a8a-0000-4000-8000-00000000003c', '7e7e7e7e-0000-4000-8000-000000000003', '3a3a3a3a-0000-4000-8000-00000000003a', '3c3c3c3c-0000-4000-8000-00000000003c', now() - interval '9 days'),
  ('8a8a8a8a-0000-4000-8000-00000000003d', '7e7e7e7e-0000-4000-8000-000000000003', '3a3a3a3a-0000-4000-8000-00000000003a', '3d3d3d3d-0000-4000-8000-00000000003d', now() - interval '25 days'),
  ('8a8a8a8a-0000-4000-8000-00000000003e', '7e7e7e7e-0000-4000-8000-000000000003', '3b3b3b3b-0000-4000-8000-00000000003b', '3e3e3e3e-0000-4000-8000-00000000003e', now() - interval '3 days');
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, checkin_a_il, checkin_b_il, esito, esito_il) values
  ('8a8a8a8a-0000-4000-8000-00000000003b', now() + interval '7 days', 'da_fissare', null, null, null, null, null, null),
  ('8a8a8a8a-0000-4000-8000-00000000003c', now() + interval '1 day', 'concluso', now() - interval '2 days', 'Bar della piazza',
   now() - interval '2 days', now() - interval '2 days', 'avvenuto', now() - interval '2 days'),
  ('8a8a8a8a-0000-4000-8000-00000000003d', now() - interval '9 days', 'da_fissare', null, null, null, null, 'scaduto', now() - interval '9 days'),
  ('8a8a8a8a-0000-4000-8000-00000000003e', now() + interval '7 days', 'da_fissare', null, null, null, null, null, null);

select pg_temp.ok(pg_temp.rifiutato($$set local role authenticated; select public.miei_incontri('3a3a3a3a-0000-4000-8000-00000000003a')$$),
  'il telefono non può chiamarla: solo il server');
select pg_temp.ok(pg_temp.rifiutato($$set local role anon; select public.miei_incontri('3a3a3a3a-0000-4000-8000-00000000003a')$$),
  'nemmeno con la chiave anon');

set local role service_role;
create temp table r (chi text, j jsonb) on commit drop;
insert into r select 'marta', public.miei_incontri('3a3a3a3a-0000-4000-8000-00000000003a');
insert into r select 'bruno', public.miei_incontri('3b3b3b3b-0000-4000-8000-00000000003b');
insert into r select 'nessuno', public.miei_incontri('3f3f3f3f-0000-4000-8000-00000000003f');
select pg_temp.ok((select jsonb_array_length(j) = 2 from r where chi = 'marta'),
  'Marta: l''incontro da fissare e quello avvenuto da meno di 7 giorni; non quello scaduto da 9 giorni né le porte di altri');
select pg_temp.ok((select j->0->>'porta' = '8a8a8a8a-0000-4000-8000-00000000003b' and j->0->>'nome' = 'Bruno'
  and j->0->>'stato' = 'da_fissare' and j->0->>'esito' is null and (j->0->>'scadenza')::timestamptz > now() from r where chi = 'marta'),
  'prima gli incontri aperti: porta, nome dell''altra persona, stato e scadenza');
select pg_temp.ok((select j->1->>'nome' = 'Carlo' and j->1->>'esito' = 'avvenuto' and j->1->>'orario' is not null from r where chi = 'marta'),
  'poi quelli chiusi da poco, con l''esito');
select pg_temp.ok((select (select array_agg(k order by k) from jsonb_object_keys(j->0) k)
  = array['esito', 'nome', 'orario', 'porta', 'scadenza', 'stato'] from r where chi = 'marta'),
  'solo questi sei campi: mai email, data di nascita, foto, segnale, check-in o crediti');
select pg_temp.ok((select j::text not like '%example.com%' and j::text not like '%3b3b3b3b%' from r where chi = 'marta'),
  'mai email né l''id dell''altra persona');
select pg_temp.ok((select jsonb_array_length(j) = 2 and j::text like '%Marta%' and j::text like '%Elena%' from r where chi = 'bruno'),
  'Bruno (la «a» con Elena, la «b» con Marta): vede il nome dell''altra persona in entrambe');
select pg_temp.ok((select j = '[]'::jsonb from r where chi = 'nessuno'), 'chi non ha incontri riceve un elenco vuoto');
rollback;
