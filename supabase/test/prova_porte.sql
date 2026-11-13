-- Test delle porte aperte nel database (issue #5, spec v1.1 del CPO, D51 A). Linea «sviluppatore-c».
-- Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
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

begin;
-- Ada (1a), Bea (1b), Cia (1c), Dea (1d). Due stanze: quella della settimana scorsa e quella di questa settimana.
insert into auth.users (id, email) values
  ('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', 'pa@example.com'),
  ('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', 'pb@example.com'),
  ('1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', 'pc@example.com'),
  ('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', 'pd@example.com');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5e5e5e5e-0000-4000-8000-000000000001', 'italia', '2026-11-02 08:00+00', '2026-11-08 20:00+00'),
  ('5e5e5e5e-0000-4000-8000-000000000002', 'italia', '2026-11-09 08:00+00', '2026-11-15 20:00+00');

-- Porte: Ada e Bea si sono aperte la porta domenica 8/11 alle 21 di Roma (Bea ha lasciato una frase ad Ada);
-- Cia e Dea il 15/11. La coppia si scrive sempre con a < b.
insert into public.porte (stanza_id, a, b, aperta_il, frase_di_a, frase_di_b) values
  ('5e5e5e5e-0000-4000-8000-000000000001', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b',
   '2026-11-08 20:00+00', null, 'Mi hai fatto ridere con la storia del gatto.'),
  ('5e5e5e5e-0000-4000-8000-000000000002', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d',
   '2026-11-15 20:00+00', 'Ciao Dea', 'Ciao Cia');

-- Il telefono non legge e non scrive le porte e non lancia le funzioni del server.
select pg_temp.come('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.porte$$)
  and pg_temp.rifiutato($$insert into public.porte (stanza_id, a, b, aperta_il)
    values ('5e5e5e5e-0000-4000-8000-000000000002', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', now())$$),
  'porte: il telefono non legge e non scrive le porte (solo il server)');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.porta_aperta(auth.uid(), '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b')$$)
  and pg_temp.rifiutato($$select * from public.porte_di(auth.uid())$$),
  'porte: il telefono non lancia le funzioni del server');
reset role;
select pg_temp.come('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a');
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.porte$$)
  and pg_temp.rifiutato($$select * from public.porte_di('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a')$$),
  'porte: niente porte senza accesso');
reset role;

set local role service_role;
-- porta_aperta: la porta tra due persone e da quando, nello stesso modo in qualunque ordine si chiedano.
select pg_temp.ok((select aperta_il from public.porta_aperta('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b'))
  = '2026-11-08 20:00+00', 'porte: Ada e Bea hanno la porta aperta dalle 21 di domenica 8/11');
select pg_temp.ok((select (id, stanza_id, aperta_il)::text from public.porta_aperta('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a'))
  = (select (id, stanza_id, aperta_il)::text from public.porta_aperta('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b')),
  'porte: la risposta non dipende dall''ordine delle due persone');
select pg_temp.ok(not exists (select 1 from public.porta_aperta('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c'))
  and not exists (select 1 from public.porta_aperta('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a')),
  'porte: nessuna porta tra chi non si è dato la chiave a vicenda, né con se stessi');
-- porte_di: le porte di una persona, con la frase che l'altra ha lasciato a lei (non la propria).
select pg_temp.ok((select count(*) from public.porte_di('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a')) = 1
  and (select con from public.porte_di('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a')) = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b'
  and (select frase_per_te from public.porte_di('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a')) = 'Mi hai fatto ridere con la storia del gatto.',
  'porte: Ada vede la sua porta con Bea e la frase di Bea');
select pg_temp.ok((select frase_per_te from public.porte_di('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b')) is null
  and (select con from public.porte_di('1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b')) = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a',
  'porte: Bea vede la porta con Ada; Ada non le ha lasciato frasi');
select pg_temp.ok((select frase_per_te from public.porte_di('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d')) = 'Ciao Dea',
  'porte: Dea legge la frase di Cia (la coppia è in ordine, la frase giusta va alla persona giusta)');
-- Due porte tra le stesse persone in settimane diverse: porta_aperta dà la più recente.
insert into public.porte (stanza_id, a, b, aperta_il) values
  ('5e5e5e5e-0000-4000-8000-000000000002', '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b', '2026-11-15 20:00+00');
select pg_temp.ok((select aperta_il from public.porta_aperta('1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a', '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b'))
  = '2026-11-15 20:00+00', 'porte: con due porte tra le stesse persone vale la più recente');
-- Regole sui dati.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.porte (stanza_id, a, b, aperta_il) values
  ('5e5e5e5e-0000-4000-8000-000000000002', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', now())$$),
  'porte: la coppia si scrive sempre in ordine (a < b), quindi mai due volte né con se stessi');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.porte (stanza_id, a, b, aperta_il) values
  ('5e5e5e5e-0000-4000-8000-000000000002', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', now())$$),
  'porte: una sola porta per coppia e per stanza');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.porte (stanza_id, a, b, aperta_il, frase_di_a) values
  ('5e5e5e5e-0000-4000-8000-000000000001', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', now(), repeat('x', 141))$$),
  'porte: frase al massimo di 140 caratteri');
select pg_temp.ok((select array_agg(column_name::text order by column_name::text) from information_schema.columns
  where table_schema = 'public' and table_name = 'porte') is not distinct from
  array['a', 'aperta_il', 'b', 'frase_di_a', 'frase_di_b', 'id', 'stanza_id'],
  'porte: solo i campi della spec (stanza, le due persone, ora di apertura, le due frasi; niente diario)');
reset role;

-- Blocco dopo la porta (da una parte o dall'altra): per il server la porta non c'è più.
insert into public.blocchi (chi, bloccato) values ('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d', '1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c');
set local role service_role;
select pg_temp.ok(not exists (select 1 from public.porta_aperta('1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c', '1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d'))
  and not exists (select 1 from public.porte_di('1c1c1c1c-1c1c-4c1c-8c1c-1c1c1c1c1c1c'))
  and not exists (select 1 from public.porte_di('1d1d1d1d-1d1d-4d1d-8d1d-1d1d1d1d1d1d')),
  'porte: dopo un blocco nessuna porta tra i due');
reset role;

-- «Elimina il mio account»: le porte di chi se ne va spariscono.
delete from auth.users where id = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';
select pg_temp.ok(not exists (select 1 from public.porte where '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b' in (a, b)),
  'porte: con l''account eliminato le sue porte non esistono più');
rollback;
