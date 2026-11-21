-- Test di «Ho mandato l'email» (issue #7 spec v1.3, decisione D144 A di Giuseppe). Linea «sviluppatore-b», passo 15d.
-- segna_email_mandata(moderatore, sanzione): solo chi ha deciso la sanzione, salva data e ora una volta sola
-- (un secondo tocco non la cambia) e la restituisce; email_mandata(moderatore, sanzione) la legge per il pannello.
-- Solo server. Dati inventati.
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
  select ('e6e6e6e6-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'mand' || n || '@example.com' from generate_series(1, 9) n;
insert into public.moderatori (persona) values (pg_temp.p(9)), (pg_temp.p(8));
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'soldi', 'scheda', null, false) as s1 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'avviso', 'affari', 'motivo interno') as z1 \gset

select pg_temp.ok(public.email_mandata(pg_temp.p(9), :'z1') is null, 'email mandata: all''inizio non è segnata');
select public.segna_email_mandata(pg_temp.p(9), :'z1') as quando1 \gset
select pg_temp.ok(:'quando1' <> '' and (:'quando1')::timestamptz <= now(), 'email mandata: «Ho mandato l''email» salva data e ora');
select pg_temp.ok(public.email_mandata(pg_temp.p(9), :'z1') = (:'quando1')::timestamptz, 'email mandata: il pannello la rilegge');
reset role;
update public.sanzioni set email_mandata_il = now() - interval '1 hour' where id = :'z1';
set local role service_role;
select pg_temp.ok(public.segna_email_mandata(pg_temp.p(9), :'z1') < now() - interval '50 minutes',
  'email mandata: un secondo tocco non cambia la prima data');
select pg_temp.ok(public.segna_email_mandata(pg_temp.p(8), :'z1') is null, 'email mandata: un altro moderatore non la segna');
select pg_temp.ok(public.email_mandata(pg_temp.p(8), :'z1') is null, 'email mandata: un altro moderatore non la legge');
select pg_temp.ok(public.segna_email_mandata(pg_temp.p(1), :'z1') is null, 'email mandata: chi non è moderatore non la segna');
select pg_temp.ok(public.segna_email_mandata(pg_temp.p(9), pg_temp.p(7)) is null, 'email mandata: sanzione che non esiste');
reset role;
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato(format($$select public.segna_email_mandata(%L, %L)$$, pg_temp.p(9), :'z1')),
  'email mandata: il telefono non la segna');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.email_mandata(%L, %L)$$, pg_temp.p(9), :'z1')),
  'email mandata: il telefono non la legge');
reset role;
rollback;
