-- Test di chi risponde ai messaggi «Scrivici» (issue #10, spec v1 del CPO del 6/11, parte A, «Regole»).
-- Linea «sviluppatore-c», passo 4a. Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: i messaggi li legge solo chi li ha scritti e il ruolo «supporto» (Giuseppe); il ruolo «supporto» vede solo
-- email, categoria, testo, data, stato (e la bandiera «sicurezza»), mai voce, foto, questionario, diario, chiavi,
-- valutazioni. Qui: solo chi è nell'elenco «operatori_supporto» legge la coda e salva una risposta.
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
  select ('0c0c0c0c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'op' || n || '@example.com' from generate_series(1, 3) n;
-- p(1) risponde (ruolo «supporto»), p(2) e p(3) sono utenti normali.
insert into public.operatori_supporto (persona) values (pg_temp.p(1));
set local role service_role;
select public.invia_supporto(pg_temp.p(2), 'crediti', 'Non vedo i crediti.');
select public.invia_supporto(pg_temp.p(3), 'incontro', 'Ho paura, mi segue.');
reset role;

-- Il telefono non legge l'elenco e non chiama le funzioni: passa tutto dal Worker.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.operatori_supporto$$)
  and pg_temp.rifiutato($$select public.e_operatore_supporto(auth.uid())$$)
  and pg_temp.rifiutato($$select * from public.coda_supporto_operatore(auth.uid())$$)
  and pg_temp.rifiutato($$select public.rispondi_supporto_operatore(auth.uid(), gen_random_uuid(), 'ok')$$),
  'operatori supporto: il telefono non legge l''elenco e non chiama le funzioni (solo il server)');
reset role;

set local role service_role;
select pg_temp.ok(public.e_operatore_supporto(pg_temp.p(1)) and not public.e_operatore_supporto(pg_temp.p(2))
  and not public.e_operatore_supporto(null),
  'operatori supporto: solo chi è nell''elenco ha il ruolo «supporto»');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.coda_supporto_operatore('0c0c0c0c-0000-4000-8000-000000000002')$$)
  and pg_temp.rifiutato($$select * from public.coda_supporto_operatore(null)$$),
  'operatori supporto: un utente normale non legge la coda dei messaggi degli altri');
select pg_temp.ok((select count(*) from public.coda_supporto_operatore(pg_temp.p(1))) = 2
  and (select sicurezza from public.coda_supporto_operatore(pg_temp.p(1)) limit 1),
  'operatori supporto: chi risponde legge la coda, con la bandiera «sicurezza» in cima');
select pg_temp.ok(pg_temp.rifiutato(format('select public.rispondi_supporto_operatore(%L, %L, %L)', pg_temp.p(2),
    (select id from public.supporto where utente_id = pg_temp.p(3)), 'Risposta finta')),
  'operatori supporto: un utente normale non salva risposte');
select pg_temp.ok((select risposta is null from public.supporto where utente_id = pg_temp.p(3)),
  'operatori supporto: il tentativo rifiutato non ha cambiato il messaggio');
select pg_temp.ok(public.rispondi_supporto_operatore(pg_temp.p(1), (select id from public.supporto where utente_id = pg_temp.p(3)),
    'Ti abbiamo scritto per email.'),
  'operatori supporto: chi risponde salva la risposta');
select pg_temp.ok((select stato = 'risposto' from public.miei_messaggi_supporto(pg_temp.p(3))),
  'operatori supporto: dopo la risposta l''utente vede «risposto»');
select pg_temp.ok(not public.rispondi_supporto_operatore(pg_temp.p(1), (select id from public.supporto where utente_id = pg_temp.p(3)), 'Bis'),
  'operatori supporto: una risposta già data non si sovrascrive');
select pg_temp.ok(pg_temp.rifiutato(format('select public.rispondi_supporto_operatore(%L, %L, %L)', pg_temp.p(1),
    (select id from public.supporto where utente_id = pg_temp.p(2)), repeat('a', 4001))),
  'operatori supporto: una risposta oltre 4.000 caratteri è rifiutata');
reset role;

select pg_temp.ok((select string_agg(n, ',' order by n) from unnest((select proargnames from pg_proc where proname = 'coda_supporto_operatore')) n)
    = 'categoria,creato_il,email,id,p_operatore,sicurezza,stato,testo',
  'operatori supporto: la coda contiene solo id, email, categoria, testo, data, stato e bandiera');
select pg_temp.ok(pg_get_functiondef('public.coda_supporto_operatore(uuid)'::regprocedure) !~* '(diario|chiavi|porte|questionario|voce|foto|valutaz|richiameresti)',
  'operatori supporto: la coda non tocca voce, foto, questionario, diario, chiavi né valutazioni');

-- Chi elimina l'account esce anche dall'elenco.
delete from auth.users where id = pg_temp.p(1);
select pg_temp.ok((select count(*) from public.operatori_supporto) = 0,
  'operatori supporto: con l''account eliminato esce dall''elenco');
rollback;
