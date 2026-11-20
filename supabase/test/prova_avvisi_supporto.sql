-- Test: i messaggi «Scrivici» con bandiera «sicurezza» o «possibile minore» avvisano il responsabile entro 1 ora,
-- come le segnalazioni con priorità 1 ora della #7 (spec #10 parte B v1.1 del CPO, 20/11; D139 A).
-- Linea «sviluppatore-b». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('5b5b5b5b-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
begin;
insert into auth.users (id, email) select pg_temp.p(n), 'avvisi' || n || '@example.org' from generate_series(1, 3) n;

-- 1. Messaggio normale: nessun avviso.
select public.invia_supporto(pg_temp.p(1), 'crediti', 'Non vedo i crediti dopo la ricarica');
select pg_temp.ok((select count(*) from public.avvisi_sicurezza a join public.supporto s on s.id = a.supporto_id
  where s.utente_id = pg_temp.p(1)) = 0, 'avvisi supporto: un messaggio normale non avvisa nessuno');

-- 2. Parole di pericolo: un avviso «supporto» da spedire.
select public.invia_supporto(pg_temp.p(2), 'incontro', 'Ho paura, mi segue dopo l''incontro');
select pg_temp.ok((select count(*) from public.avvisi_sicurezza a join public.supporto s on s.id = a.supporto_id
  where s.utente_id = pg_temp.p(2) and a.perche = 'supporto' and a.inviato_il is null) = 1,
  'avvisi supporto: bandiera «sicurezza» → un avviso al responsabile');

-- 3. Possibile minore: un avviso «supporto».
select public.invia_supporto(pg_temp.p(3), 'account', 'Ciao, ho 16 anni, posso iscrivermi?');
select pg_temp.ok((select count(*) from public.avvisi_sicurezza a join public.supporto s on s.id = a.supporto_id
  where s.utente_id = pg_temp.p(3) and a.perche = 'supporto') = 1,
  'avvisi supporto: «possibile minore» → un avviso al responsabile');

-- 4. Un avviso ha sempre uno e un solo riferimento.
select pg_temp.ok((select count(*) from public.avvisi_sicurezza
  where num_nonnulls(segnalazione_id, sospensione_id, supporto_id) <> 1) = 0,
  'avvisi supporto: ogni avviso punta a una sola cosa');

-- 5. Account cancellato: il messaggio sparisce e il suo avviso con lui.
delete from auth.users where id = pg_temp.p(3);
select pg_temp.ok((select count(*) from public.avvisi_sicurezza where perche = 'supporto') = 1,
  'avvisi supporto: con l''account si cancella anche l''avviso del suo messaggio');
rollback;
