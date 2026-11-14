-- Test di stato_chiavi e sera_di nel database (issue #5, spec v1.1 del CPO, D14 A, D51 A). Linea «sviluppatore-c».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- stato_chiavi: «Le tue chiavi: N», quelle che HAI DATO tu e se sono già chiuse (mai quelle ricevute).
-- sera_di: la schermata delle 21:00, fino a lunedì 9:00: in attesa del calcolo, oppure le porte con la frase dell'altra
-- persona. Chi non ha porte riceve esattamente la stessa risposta sia se ha dato chiavi sia se non le ha date.
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
  select ('c5c5c5c5-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'cs' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome, data_nascita, citta)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'Milano' from generate_series(1, 9) n;
update public.profili set nome = 'Giulia' where id = pg_temp.p(2);
-- A: chiusa un minuto fa (1, 2, 3, 4). E: chiusa 13 ore fa (5): la sera è finita (lunedì 9:00 passato).
-- C: aperta (6, 7). D: chiude tra 30 secondi (8, 9): chiavi già chiuse.
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5e5e5e5e-0000-4000-8000-00000000000a', 'italia', now() - interval '7 days', now() - interval '1 minute'),
  ('5e5e5e5e-0000-4000-8000-00000000000e', 'italia', now() - interval '7 days', now() - interval '13 hours'),
  ('5e5e5e5e-0000-4000-8000-00000000000c', 'italia', now() - interval '1 day', now() + interval '6 days'),
  ('5e5e5e5e-0000-4000-8000-00000000000d', 'italia', now() - interval '6 days', now() + interval '30 seconds');
insert into public.membri_stanza (stanza_id, utente_id) values
  ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(1)), ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(2)),
  ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(3)), ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(4)),
  ('5e5e5e5e-0000-4000-8000-00000000000e', pg_temp.p(5)),
  ('5e5e5e5e-0000-4000-8000-00000000000c', pg_temp.p(6)), ('5e5e5e5e-0000-4000-8000-00000000000c', pg_temp.p(7)),
  ('5e5e5e5e-0000-4000-8000-00000000000d', pg_temp.p(8)), ('5e5e5e5e-0000-4000-8000-00000000000d', pg_temp.p(9));
-- A: 1↔2 reciproca (frase solo di 2), 3→1 non ricambiata. 4 non ne ha date. C: 6→7 con frase, 7→6 senza.
insert into public.chiavi (stanza_id, da, a, frase) values
  ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(1), pg_temp.p(2), null),
  ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(2), pg_temp.p(1), 'Il treno, ancora.'),
  ('5e5e5e5e-0000-4000-8000-00000000000a', pg_temp.p(3), pg_temp.p(1), 'Frase mai letta'),
  ('5e5e5e5e-0000-4000-8000-00000000000c', pg_temp.p(6), pg_temp.p(7), 'Ciao!'),
  ('5e5e5e5e-0000-4000-8000-00000000000c', pg_temp.p(7), pg_temp.p(6), null),
  ('5e5e5e5e-0000-4000-8000-00000000000d', pg_temp.p(8), pg_temp.p(9), null);

-- Il telefono non chiama nessuna delle due: passa dal Worker.
select pg_temp.come(pg_temp.p(6));
select pg_temp.ok(pg_temp.rifiutato($$select public.stato_chiavi('c5c5c5c5-0000-4000-8000-000000000006')$$)
  and pg_temp.rifiutato($$select public.sera_di('c5c5c5c5-0000-4000-8000-000000000006')$$),
  'chiavi e sera: il telefono non chiama stato_chiavi né sera_di (solo il server)');
reset role;

set local role service_role;
create temp table st on commit drop as select n, public.stato_chiavi(pg_temp.p(n)) as s from generate_series(1, 9) n;
reset role;
select pg_temp.ok((select s from st where n = 6) = jsonb_build_object('stanza', true,
    'chiude_il', (select chiude_il from public.stanze where id = '5e5e5e5e-0000-4000-8000-00000000000c'),
    'chiuse', false, 'restanti', 1, 'date', jsonb_build_array(jsonb_build_object('a', pg_temp.p(7), 'frase', 'Ciao!'))),
  'chiavi: nella stanza aperta «Le tue chiavi: 1» e solo la chiave data, con la sua frase');
select pg_temp.ok((select s->'date' from st where n = 7) = jsonb_build_array(jsonb_build_object('a', pg_temp.p(6), 'frase', null))
  and (select s::text from st where n = 7) !~ 'Ciao',
  'chiavi: chi ha ricevuto una chiave non la vede, né la sua frase (nessuno scopre un sì prima delle 21)');
select pg_temp.ok((select (s->>'chiuse')::boolean and (s->>'restanti')::int = 1 from st where n = 8)
  and (select (s->>'chiuse')::boolean from st where n = 9),
  'chiavi: dalle 20:59:00 la stanza dice «chiuse»');
select pg_temp.ok((select s from st where n = 1) = '{"stanza": false}'::jsonb
  and (select s from st where n = 5) = '{"stanza": false}'::jsonb,
  'chiavi: senza stanza aperta solo {"stanza": false}');

-- Prima del calcolo delle 21:00 la sera è «in attesa», per tutti allo stesso modo.
set local role service_role;
create temp table prima on commit drop as select n, public.sera_di(pg_temp.p(n)) as s from generate_series(1, 9) n;
reset role;
select pg_temp.ok((select bool_and(s = '{"stato": "attesa"}'::jsonb) from prima where n between 1 and 4),
  'sera: chiusa la stanza ma porte non ancora calcolate → «attesa», uguale per tutti');
select pg_temp.ok((select bool_and(s = '{"stato": "nessuna"}'::jsonb) from prima where n in (6, 7, 8, 9)),
  'sera: con la stanza ancora aperta nessuna sera da mostrare');

set local role service_role;
select public.apri_porte();
create temp table dopo on commit drop as select n, public.sera_di(pg_temp.p(n)) as s from generate_series(1, 9) n;
reset role;
select pg_temp.ok((select s from dopo where n = 1) = jsonb_build_object('stato', 'pronta', 'porte', jsonb_build_array(
    jsonb_build_object('id', (select id from public.porte where a = least(pg_temp.p(1), pg_temp.p(2)) and b = greatest(pg_temp.p(1), pg_temp.p(2))),
      'con', pg_temp.p(2), 'nome', 'Giulia', 'frase_per_te', 'Il treno, ancora.'))),
  'sera: 1 vede la porta con 2, il suo nome e la frase che 2 gli ha lasciato');
select pg_temp.ok((select s->'porte'->0->'frase_per_te' from dopo where n = 2) = 'null'::jsonb
  and (select s->'porte'->0->>'con' from dopo where n = 2) = pg_temp.p(1)::text,
  'sera: 2 vede la porta con 1, senza frase (1 non l''ha scritta), mai la propria');
select pg_temp.ok((select s from dopo where n = 3) = (select s from dopo where n = 4)
  and (select s from dopo where n = 3) = '{"stato": "pronta", "porte": []}'::jsonb
  and (select string_agg(s::text, ' ') from dopo) !~ 'Frase mai letta',
  'sera: chi ha dato una chiave non ricambiata vede esattamente come chi non ne ha date; la frase non c''è più');
select pg_temp.ok((select s from dopo where n = 5) = '{"stato": "nessuna"}'::jsonb,
  'sera: dopo lunedì 9:00 (12 ore dalla chiusura) la sera non si mostra più');

-- Un blocco dopo la sera: per il server la porta non c'è più.
insert into public.blocchi (chi, bloccato) values (pg_temp.p(2), pg_temp.p(1));
set local role service_role;
select pg_temp.ok(public.sera_di(pg_temp.p(1)) = '{"stato": "pronta", "porte": []}'::jsonb
  and public.sera_di(pg_temp.p(2)) = '{"stato": "pronta", "porte": []}'::jsonb,
  'sera: con un blocco tra i due la porta sparisce, come se non ci fosse mai stata');
reset role;
rollback;
