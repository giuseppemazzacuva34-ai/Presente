-- Giorno dei limiti dei regali = giorno di calendario di Roma, da mezzanotte a mezzanotte, anche nelle notti del
-- cambio d'ora (issue #331, risposta del CPO del 22/11, criterio «orologio finto»). Linea «sviluppatore-c», passo 8d.
-- L'orologio finto è l'argomento di inizio_giorno_roma(); manda_regalo la usa con now(). Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;

-- Fine dell'ora legale: domenica 25/10/2026, alle 03:00 CEST si torna alle 02:00 CET (giorno di 25 ore).
select pg_temp.ok(public.inizio_giorno_roma('2026-10-25 01:30+00') = '2026-10-24 22:00+00', 'giorno: notte del ritorno all''ora solare, il giorno inizia alla mezzanotte legale');
select pg_temp.ok(public.inizio_giorno_roma('2026-10-25 22:59+00') = '2026-10-24 22:00+00', 'giorno: 23:59 del 25/10 è ancora lo stesso giorno (25 ore)');
select pg_temp.ok(public.inizio_giorno_roma('2026-10-25 23:00+00') = '2026-10-25 23:00+00', 'giorno: alle 00:00 di Roma del 26/10 i contatori ripartono');
-- Inizio dell'ora legale: domenica 28/03/2027, alle 02:00 CET si passa alle 03:00 CEST (giorno di 23 ore).
select pg_temp.ok(public.inizio_giorno_roma('2027-03-28 01:30+00') = '2027-03-27 23:00+00', 'giorno: notte del passaggio all''ora legale, il giorno inizia alla mezzanotte solare');
select pg_temp.ok(public.inizio_giorno_roma('2027-03-28 21:59+00') = '2027-03-27 23:00+00', 'giorno: 23:59 del 28/03 è ancora lo stesso giorno (23 ore)');
select pg_temp.ok(public.inizio_giorno_roma('2027-03-28 22:00+00') = '2027-03-28 22:00+00', 'giorno: alle 00:00 di Roma del 29/03 i contatori ripartono');
-- Un giorno qualunque d'inverno.
select pg_temp.ok(public.inizio_giorno_roma('2026-11-22 22:59+00') = '2026-11-21 23:00+00', 'giorno: 23:59 di Roma è ancora oggi');
select pg_temp.ok(public.inizio_giorno_roma('2026-11-22 23:00+00') = '2026-11-22 23:00+00', 'giorno: mezzanotte di Roma è domani');

-- manda_regalo conta i regali da questo inizio del giorno (stessa regola, un solo posto).
select pg_temp.ok(position('public.inizio_giorno_roma(now())' in pg_get_functiondef('public.manda_regalo(uuid, uuid, text, uuid)'::regprocedure)) > 0,
  'giorno: manda_regalo usa inizio_giorno_roma(now())');
-- Il telefono non chiama la funzione: solo il server.
select pg_temp.ok(not has_function_privilege('anon', 'public.inizio_giorno_roma(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.inizio_giorno_roma(timestamptz)', 'execute'),
  'giorno: anon e authenticated non la eseguono');
