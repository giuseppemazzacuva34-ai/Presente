-- Test dei messaggi «Scrivici» della pagina Aiuto nel database (issue #10, spec v1 del CPO del 6/11, parte A).
-- Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: un utente non vede mai i messaggi di un altro (né app né API); chi risponde vede solo email, categoria, testo,
-- data, stato (mai voce, foto, questionario, diario, chiavi, valutazioni); parole di pericolo → bandiera «sicurezza»
-- e in cima alla coda; massimo 5 messaggi al giorno; testo vuoto rifiutato; i messaggi si cancellano con l'account.
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
  select ('5a5a5a5a-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'su' || n || '@example.com' from generate_series(1, 3) n;

-- Il telefono non legge, non scrive e non chiama le funzioni del supporto: passa tutto dal Worker.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.supporto$$)
  and pg_temp.rifiutato($$insert into public.supporto (utente_id, categoria, testo) values (auth.uid(), 'altro', 'ciao')$$)
  and pg_temp.rifiutato($$select public.invia_supporto(auth.uid(), 'altro', 'ciao')$$)
  and pg_temp.rifiutato($$select * from public.miei_messaggi_supporto(auth.uid())$$)
  and pg_temp.rifiutato($$select * from public.coda_supporto()$$)
  and pg_temp.rifiutato($$select public.rispondi_supporto(gen_random_uuid(), 'ok')$$),
  'supporto: il telefono non legge, non scrive e non chiama le funzioni (solo il server)');
reset role;
select pg_temp.come(null);
select pg_temp.ok(pg_temp.rifiutato($$select * from public.supporto$$), 'supporto: chi non ha fatto l''accesso non legge nulla');
reset role;

set local role service_role;
create temp table esiti (n serial, utente uuid, esito jsonb) on commit drop;
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'crediti', 'Non vedo i crediti della stanza.'));
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'incontro', 'Ho paura: dopo la chiamata MI SEGUE sui social.'));
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'altro', '   '));
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'altro', 'Domanda tre'));
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'test', 'Domanda quattro'));
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'account', 'Domanda cinque'));
insert into esiti (utente, esito) values (pg_temp.p(1), public.invia_supporto(pg_temp.p(1), 'altro', 'Domanda sei'));
insert into esiti (utente, esito) values (pg_temp.p(2), public.invia_supporto(pg_temp.p(2), 'stanza_chiamate', 'Mi ricatta, cosa faccio?'));
reset role;

select pg_temp.ok((select esito ->> 'esito' from esiti where n = 1) = 'inviato'
  and (select (esito ->> 'sicurezza')::boolean from esiti where n = 1) = false,
  'supporto: un messaggio normale è inviato senza bandiera');
select pg_temp.ok((select (esito ->> 'sicurezza')::boolean from esiti where n = 2)
  and (select (esito ->> 'sicurezza')::boolean from esiti where n = 8),
  'supporto: «mi segue» e «ricatt» ricevono la bandiera «sicurezza» (anche in maiuscolo)');
select pg_temp.ok((select esito ->> 'esito' from esiti where n = 3) = 'vuoto',
  'supporto: testo vuoto o solo spazi rifiutato');
select pg_temp.ok((select esito ->> 'esito' from esiti where n = 6) = 'inviato'
  and (select esito ->> 'esito' from esiti where n = 7) = 'troppi',
  'supporto: il 6° messaggio nello stesso giorno è rifiutato (il vuoto non conta)');
select pg_temp.ok(pg_temp.rifiutato($$select public.invia_supporto('5a5a5a5a-0000-4000-8000-000000000003', 'regali', 'x')$$)
  and pg_temp.rifiutato($$select public.invia_supporto('5a5a5a5a-0000-4000-8000-000000000003', 'altro', repeat('a', 1001))$$),
  'supporto: categoria fuori elenco o testo oltre 1.000 caratteri rifiutati');

-- Un messaggio di ieri (ora di Roma) non conta nel limite di oggi.
update public.supporto set creato_il = creato_il - interval '1 day' where utente_id = pg_temp.p(1) and testo = 'Domanda tre';
set local role service_role;
select pg_temp.ok(public.invia_supporto(pg_temp.p(1), 'altro', 'Domanda sette') ->> 'esito' = 'inviato',
  'supporto: il limite vale per giorno (ora di Roma)');
reset role;

-- I miei messaggi: solo i propri, con stato Inviato / Risposto.
set local role service_role;
select pg_temp.ok((select count(*) from public.miei_messaggi_supporto(pg_temp.p(2))) = 1
  and (select bool_and(stato = 'inviato') from public.miei_messaggi_supporto(pg_temp.p(1))),
  'supporto: «I miei messaggi» mostra solo i propri, con stato «inviato»');
-- La coda per chi risponde: messaggi con bandiera in cima, solo email, categoria, testo, data, stato, bandiera.
select pg_temp.ok((select array_agg(sicurezza order by ordine) from (select sicurezza, row_number() over () ordine from public.coda_supporto()) c)
  = array[true, true, false, false, false, false, false],
  'supporto: nella coda i messaggi con bandiera «sicurezza» sono in cima');
select pg_temp.ok((select email from public.coda_supporto() limit 1) like 'su%@example.com',
  'supporto: chi risponde vede l''email dell''account per rispondere');
select pg_temp.ok(public.rispondi_supporto((select id from public.supporto where utente_id = pg_temp.p(2)), 'Ti abbiamo scritto per email.'),
  'supporto: la risposta si salva');
select pg_temp.ok((select stato = 'risposto' and risposta = 'Ti abbiamo scritto per email.' from public.miei_messaggi_supporto(pg_temp.p(2))),
  'supporto: dopo la risposta il messaggio è «risposto» e la risposta compare in «I miei messaggi»');
select pg_temp.ok(not public.rispondi_supporto((select id from public.supporto where utente_id = pg_temp.p(2)), 'Seconda'),
  'supporto: una risposta già data non si sovrascrive');
reset role;
select pg_temp.ok((select string_agg(n, ',' order by n) from unnest((select proargnames from pg_proc where proname = 'coda_supporto')) n)
    = 'categoria,creato_il,email,id,sicurezza,stato,testo',
  'supporto: chi risponde vede solo id, email, categoria, testo, data, stato e bandiera');
select pg_temp.ok(pg_get_functiondef('public.coda_supporto()'::regprocedure) !~* '(diario|chiavi|porte|questionario|voce|foto|valutaz|richiameresti)'
  and pg_get_functiondef('public.miei_messaggi_supporto(uuid)'::regprocedure) !~* '(diario|chiavi|porte|questionario|voce|foto|valutaz|richiameresti)',
  'supporto: le funzioni del supporto non toccano voce, foto, questionario, diario, chiavi né valutazioni');

-- Account eliminato: i messaggi si cancellano con l'account.
delete from auth.users where id = pg_temp.p(1);
select pg_temp.ok((select count(*) from public.supporto where utente_id = pg_temp.p(1)) = 0,
  'supporto: con l''account eliminato i suoi messaggi non esistono più');
rollback;
