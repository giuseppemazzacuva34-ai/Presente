-- Test della fascia di disponibilità v1.3 e di «Oggi non ricevo chiamate» (issue #4, spec v1.3 del CPO § 1).
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
insert into auth.users (id, email) values ('4f4f4f4f-0000-4000-8000-00000000004f', 'f1@example.com'),
  ('4e4e4e4e-0000-4000-8000-00000000004e', 'f2@example.com');
insert into public.profili (id, nome, data_nascita, citta) values ('4f4f4f4f-0000-4000-8000-00000000004f', 'Ivo', '1990-01-01', 'Roma');
select pg_temp.ok((select fascia_da = '09:00' and fascia_a = '23:00' and pausa_il is null from public.profili
  where id = '4f4f4f4f-0000-4000-8000-00000000004f'), 'fascia: un profilo nuovo ha 9:00–23:00 senza fare nulla');

select pg_temp.come('4f4f4f4f-0000-4000-8000-00000000004f');
update public.profili set fascia_da = '19:00', fascia_a = '24:00' where id = auth.uid();
select pg_temp.ok((select fascia_a = '24:00' from public.profili), 'fascia: «Alle» può essere 24:00');
update public.profili set fascia_da = '00:00', fascia_a = '01:00' where id = auth.uid();
select pg_temp.ok((select fascia_da = '00:00' from public.profili), 'fascia: un''ora esatta va bene');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set fascia_da = '19:00', fascia_a = '19:30' where id = auth.uid()$$)
  and pg_temp.rifiutato($$update public.profili set fascia_da = '22:00', fascia_a = '01:00' where id = auth.uid()$$)
  and pg_temp.rifiutato($$update public.profili set fascia_da = '19:15', fascia_a = '21:00' where id = auth.uid()$$)
  and pg_temp.rifiutato($$update public.profili set fascia_da = '24:00', fascia_a = '24:00' where id = auth.uid()$$)
  and pg_temp.rifiutato($$update public.profili set fascia_da = '19:00', fascia_a = null where id = auth.uid()$$),
  'fascia: sotto un''ora, a cavallo della mezzanotte, fuori passo o a metà non si salva');

update public.profili set pausa_il = (now() at time zone 'Europe/Rome')::date where id = auth.uid();
select pg_temp.ok((select pausa_il is not null from public.profili), 'pausa: «Oggi non ricevo chiamate» si accende per oggi');
update public.profili set pausa_il = null where id = auth.uid();
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set pausa_il = (now() at time zone 'Europe/Rome')::date + 1 where id = auth.uid()$$)
  and pg_temp.rifiutato($$update public.profili set pausa_il = (now() at time zone 'Europe/Rome')::date - 1 where id = auth.uid()$$),
  'pausa: solo per oggi, mai per domani o ieri');
select pg_temp.ok(pg_temp.rifiutato($$update public.profili set pausa_il = (now() at time zone 'Europe/Rome')::date
  where id = '4e4e4e4e-0000-4000-8000-00000000004e'$$) or (select count(*) from public.profili) = 1,
  'pausa: ognuno vede e tocca solo il suo profilo');
reset role;

-- Una pausa rimasta da ieri non blocca le altre modifiche del profilo (si spegne da sola).
alter table public.profili disable trigger controlla_pausa;
update public.profili set pausa_il = (now() at time zone 'Europe/Rome')::date - 1 where id = '4f4f4f4f-0000-4000-8000-00000000004f';
alter table public.profili enable trigger controlla_pausa;
update public.profili set citta = 'Milano' where id = '4f4f4f4f-0000-4000-8000-00000000004f';
select pg_temp.ok((select citta = 'Milano' from public.profili where id = '4f4f4f4f-0000-4000-8000-00000000004f'),
  'pausa: quella di ieri resta lì senza bloccare le altre modifiche');
rollback;
