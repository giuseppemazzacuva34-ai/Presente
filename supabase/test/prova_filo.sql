-- Test del ruolo «filo» (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 1 della linea «sviluppatore-c».
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: il Filo non è un membro; legge SOLO, per le sue stanze, il nome di battesimo dei membri, già dalle 00:30
-- di lunedì (stanza composta, non ancora aperta) e fino alla chiusura; mai le stanze di altri; il telefono non legge
-- nulla di tutto questo (passa dal Worker). Chi è uscito o sospeso sparisce dai nomi.
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
  select ('f1f1f1f1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
-- p(1) è il Filo, p(2..5) membri della stanza A, p(6) membro della stanza B (di un altro Filo, p(7)).
insert into auth.users (id, email) select pg_temp.p(n), 'filo' || n || '@example.com' from generate_series(1, 7) n;
insert into public.profili (id, nome, data_nascita, citta) values
  (pg_temp.p(2), 'Anna', '1990-01-01', 'Milano'), (pg_temp.p(3), 'Bruno', '1990-01-01', 'Milano'),
  (pg_temp.p(4), 'Carla', '1990-01-01', 'Milano'), (pg_temp.p(5), 'Dario', '1990-01-01', 'Milano'),
  (pg_temp.p(6), 'Elena', '1990-01-01', 'Roma');
-- Stanza A: composta (lunedì 00:30), apre tra 8 ore. Stanza B: aperta. Stanza C: chiusa ieri (seguita da p(1)).
insert into public.stanze (id, tipo, citta, apre_il, chiude_il) values
  ('f1f1f1f1-0000-4000-8000-00000000000a', 'citta', 'Milano', now() + interval '8 hours', now() + interval '7 days'),
  ('f1f1f1f1-0000-4000-8000-00000000000b', 'citta', 'Roma', now() - interval '1 day', now() + interval '6 days'),
  ('f1f1f1f1-0000-4000-8000-00000000000c', 'citta', 'Milano', now() - interval '8 days', now() - interval '1 day');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'f1f1f1f1-0000-4000-8000-00000000000a', pg_temp.p(n) from generate_series(2, 5) n;
insert into public.membri_stanza (stanza_id, utente_id) values ('f1f1f1f1-0000-4000-8000-00000000000b', pg_temp.p(6));
insert into public.fili_stanza (stanza_id, filo) values
  ('f1f1f1f1-0000-4000-8000-00000000000a', pg_temp.p(1)),
  ('f1f1f1f1-0000-4000-8000-00000000000b', pg_temp.p(7)),
  ('f1f1f1f1-0000-4000-8000-00000000000c', pg_temp.p(1));

select pg_temp.ok(pg_temp.rifiutato($$insert into public.fili_stanza (stanza_id, filo)
  values ('f1f1f1f1-0000-4000-8000-00000000000a', 'f1f1f1f1-0000-4000-8000-000000000007')$$),
  'filo: al massimo un Filo per stanza');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.fili_stanza (stanza_id, filo)
  values ('f1f1f1f1-0000-4000-8000-00000000000b', 'f1f1f1f1-0000-4000-8000-000000000006')
  on conflict (stanza_id) do update set filo = excluded.filo$$),
  'filo: un membro della stanza non può esserne il Filo');

-- Il telefono (anche del Filo) non legge l'elenco e non chiama le funzioni.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.fili_stanza$$)
  and pg_temp.rifiutato($$select * from public.stanze_del_filo(auth.uid(), now())$$)
  and pg_temp.rifiutato($$select * from public.nomi_stanza_filo(auth.uid(), 'f1f1f1f1-0000-4000-8000-00000000000a', now())$$),
  'filo: il telefono non legge l''elenco e non chiama le funzioni (solo il server)');
reset role;

set local role service_role;
select pg_temp.ok((select array_agg(id order by apre_il) from public.stanze_del_filo(pg_temp.p(1), now()))
  = array['f1f1f1f1-0000-4000-8000-00000000000a'::uuid],
  'filo: vede le sue stanze composte e non chiuse, anche prima dell''apertura delle 9:00');
select pg_temp.ok(not exists (select 1 from public.stanze_del_filo(pg_temp.p(2), now())),
  'filo: chi non è Filo non ha stanze');
select pg_temp.ok((select array_agg(nome order by nome) from public.nomi_stanza_filo(pg_temp.p(1),
  'f1f1f1f1-0000-4000-8000-00000000000a', now())) = array['Anna', 'Bruno', 'Carla', 'Dario'],
  'filo: legge i nomi di battesimo dei membri della sua stanza');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.nomi_stanza_filo('f1f1f1f1-0000-4000-8000-000000000001',
  'f1f1f1f1-0000-4000-8000-00000000000b', now())$$), 'filo: mai i nomi della stanza di un altro Filo');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.nomi_stanza_filo('f1f1f1f1-0000-4000-8000-000000000001',
  'f1f1f1f1-0000-4000-8000-00000000000c', now())$$), 'filo: dopo la chiusura i nomi non si leggono più');
reset role;

-- Chi è sospeso (o uscito dalla stanza, che per il server è sospeso fino alla chiusura) sparisce dai nomi.
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('f1f1f1f1-0000-4000-8000-000000000901', pg_temp.p(2), pg_temp.p(3), 'insulti', 'scheda', now(), now() + interval '1 day');
insert into public.sospensioni (persona, tipo, segnalazione_id, rivedere_entro)
  values (pg_temp.p(3), 'cautelare', 'f1f1f1f1-0000-4000-8000-000000000901', now() + interval '1 day');
set local role service_role;
select pg_temp.ok((select array_agg(nome order by nome) from public.nomi_stanza_filo(pg_temp.p(1),
  'f1f1f1f1-0000-4000-8000-00000000000a', now())) = array['Anna', 'Carla', 'Dario'],
  'filo: chi è sospeso o uscito non compare tra i nomi');
reset role;
rollback;
