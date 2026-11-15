-- Test di «Le tue chiamate» nel database (issue #7, spec v1.1 definitiva, caso limite «Persona già bloccata»: si può
-- ancora segnalare dallo storico delle chiamate per 30 giorni). Linea «sviluppatore-b».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: ognuno vede solo le sue chiamate finite degli ultimi 30 giorni, con il nome dell'altra persona (anche se l'ha
-- bloccata o se l'altra persona ha bloccato lui); niente età, città, foto, esito, diario; chi non ha accesso niente.
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
  select ('5c5c5c5c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'sc' || n || '@example.com' from generate_series(1, 4) n;
insert into public.profili (id, nome) values (pg_temp.p(1), 'Anna'), (pg_temp.p(2), 'Bruno'), (pg_temp.p(3), 'Carla'), (pg_temp.p(4), 'Dario');
-- 1 ha chiamato 2 due giorni fa; 3 ha chiamato 1 ieri (chiamata ricevuta); 1 ha chiamato 4 quaranta giorni fa;
-- 1 sta chiamando 2 adesso (in corso: niente durata); 3 ha chiamato 4 (1 non c'entra).
insert into public.chiamate (chi, con, inizio, durata, esito) values
  (pg_temp.p(1), pg_temp.p(2), now() - interval '2 days', 300, 'tempo_scaduto'),
  (pg_temp.p(3), pg_temp.p(1), now() - interval '1 day', 61, 'chiudi_e_segnala'),
  (pg_temp.p(1), pg_temp.p(4), now() - interval '40 days', 900, 'tempo_scaduto'),
  (pg_temp.p(1), pg_temp.p(2), now() - interval '1 minute', null, null),
  (pg_temp.p(3), pg_temp.p(4), now() - interval '3 days', 200, 'chiusa');
-- 1 ha bloccato 3 dopo la chiamata.
insert into public.blocchi (chi, bloccato) values (pg_temp.p(1), pg_temp.p(3));

select pg_temp.come(pg_temp.p(1));
select pg_temp.ok((select count(*) from public.mie_chiamate_recenti()) = 2,
  'storico: solo le chiamate finite degli ultimi 30 giorni (niente quella in corso né quella di 40 giorni fa)');
select pg_temp.ok((select array_agg(nome order by inizio desc) from public.mie_chiamate_recenti()) = array['Carla', 'Bruno'],
  'storico: dalla più recente, con il nome dell''altra persona (anche per una chiamata ricevuta)');
select pg_temp.ok((select con from public.mie_chiamate_recenti() where nome = 'Carla') = pg_temp.p(3)
  and (select durata from public.mie_chiamate_recenti() where nome = 'Carla') = 61,
  'storico: la persona bloccata resta nello storico, con id e durata per la segnalazione');
reset role;
select pg_temp.ok((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mie_chiamate_recenti') = 'TABLE(con uuid, nome text, inizio timestamp with time zone, durata integer)',
  'storico: solo id, nome, inizio e durata (mai età, città, foto, esito o diario)');

-- 3 (bloccato da 1) vede comunque la sua chiamata con Anna: il blocco non si scopre dallo storico.
select pg_temp.come(pg_temp.p(3));
select pg_temp.ok((select array_agg(nome order by inizio desc) from public.mie_chiamate_recenti()) = array['Anna', 'Dario'],
  'storico: chi è stato bloccato non lo scopre (vede le sue chiamate come prima)');
reset role;
-- 2 non vede le chiamate degli altri.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok((select array_agg(nome) from public.mie_chiamate_recenti()) = array['Anna'],
  'storico: ognuno vede solo le sue chiamate');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.mie_chiamate_recenti()$$), 'storico: senza accesso nessuna lettura');
reset role;
rollback;
