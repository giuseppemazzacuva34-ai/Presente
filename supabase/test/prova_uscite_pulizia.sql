-- Test della pulizia dei testi di «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, «Dati»: il testo libero si
-- cancella 30 giorni dopo la chiusura della stanza; il codice del motivo resta, senza nome, per il riepilogo #8).
-- Linea «sviluppatore-b», passo 5. Si esegue con scripts/test_supabase.sh. Dati inventati.
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
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('1a5c3c5c-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
-- Stanza V chiusa 31 giorni fa, stanza W chiusa 29 giorni fa, stanza X aperta. In ognuna un'uscita con «altro» e una
-- con «tempo».
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('1a5c3c5c-5555-4000-8000-00000000000a', 'italia', now() - interval '31 days' - interval '6 days', now() - interval '31 days'),
  ('1a5c3c5c-5555-4000-8000-00000000000b', 'italia', now() - interval '29 days' - interval '6 days', now() - interval '29 days'),
  ('1a5c3c5c-5555-4000-8000-00000000000c', 'italia', now() - interval '2 days', now() + interval '3 days');
insert into public.lasciate_stanza (persona, stanza_id, motivo, testo, quando) values
  (pg_temp.p(1), '1a5c3c5c-5555-4000-8000-00000000000a', 'altro', 'Testo vecchio', now() - interval '35 days'),
  (pg_temp.p(2), '1a5c3c5c-5555-4000-8000-00000000000a', 'tempo', null, now() - interval '35 days'),
  (pg_temp.p(3), '1a5c3c5c-5555-4000-8000-00000000000b', 'altro', 'Testo di 29 giorni', now() - interval '33 days'),
  (pg_temp.p(4), '1a5c3c5c-5555-4000-8000-00000000000c', 'altro', 'Testo di oggi', now() - interval '1 day');

-- 0. Solo il server: il telefono e la chiave anon non lanciano la pulizia.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.pulisci_testi_uscita()$$), 'pulizia uscite: il telefono non la lancia');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select public.pulisci_testi_uscita()$$), 'pulizia uscite: la chiave anon non la lancia');
reset role;

-- 1. Il server la lancia: toglie solo il testo delle stanze chiuse da almeno 30 giorni e dice quanti.
set local role service_role;
select pg_temp.ok(public.pulisci_testi_uscita() = 1, 'pulizia uscite: tolto 1 testo (stanza chiusa da 31 giorni)');
reset role;
select pg_temp.ok((select testo is null and motivo = 'altro' from public.lasciate_stanza where persona = pg_temp.p(1)),
  'pulizia uscite: il testo sparisce, il codice del motivo resta');
select pg_temp.ok((select testo from public.lasciate_stanza where persona = pg_temp.p(3)) = 'Testo di 29 giorni'
  and (select testo from public.lasciate_stanza where persona = pg_temp.p(4)) = 'Testo di oggi',
  'pulizia uscite: i testi delle stanze chiuse da meno di 30 giorni e di quelle aperte restano');
select pg_temp.ok((select count(*) from public.lasciate_stanza) = 4, 'pulizia uscite: nessuna riga cancellata (conteggio per il riepilogo)');

-- 2. Un secondo giro non trova niente.
set local role service_role;
select pg_temp.ok(public.pulisci_testi_uscita() = 0, 'pulizia uscite: al giro dopo niente da togliere');
reset role;

-- 3. Il testo resta obbligatorio per «altro» quando si esce: lascia_stanza lo controlla ancora (prova_lascia_stanza.sql),
--    e la tabella non accetta un testo per gli altri motivi.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.lasciate_stanza (persona, stanza_id, motivo, testo)
  values ('1a5c3c5c-0000-4000-8000-000000000009', '1a5c3c5c-5555-4000-8000-00000000000c', 'tempo', 'non si salva')$$),
  'pulizia uscite: un testo con un motivo diverso da «altro» è ancora rifiutato');
rollback;
