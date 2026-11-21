-- Test dell'email a chi riceve una sanzione (issue #7, spec v1.1 punto 7; decisione D144 A di Giuseppe del 20/11).
-- Linea «sviluppatore-b», passo 15a. Come «Scrivici» (D140 A): dopo la decisione il pannello mostra a chi ha deciso il
-- testo pronto e l'indirizzo, e l'email la manda lui dalla casella di Presente. Nessun invio automatico.
-- email_sanzione(moderatore, sanzione): solo a un moderatore, solo per una sanzione decisa da lui negli ultimi 7 giorni;
-- solo indirizzo, livello, regola e fine: mai chi ha segnalato, racconto o motivo. Dati inventati.
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
  select ('e5e5e5e5-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'sanz' || n || '@example.com' from generate_series(1, 9) n;
insert into public.moderatori (persona) values (pg_temp.p(9)), (pg_temp.p(8));
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'soldi', 'scheda', 'racconto segreto', false) as s1 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'sospensione_7', 'soldi', 'motivo interno') as z1 \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'profilo_falso', 'scheda', null, false) as s2 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s2', 'avviso', 'identita', 'motivo interno') as z2 \gset

select pg_temp.ok((public.email_sanzione(pg_temp.p(9), :'z1') ->> 'a') = 'sanz2@example.com',
  'email sanzione: l''indirizzo di chi ha ricevuto la sanzione');
select pg_temp.ok((select x ->> 'livello' = 'sospensione_7' and x ->> 'regola' = 'soldi' and (x ->> 'fine_il') is not null
  from public.email_sanzione(pg_temp.p(9), :'z1') x), 'email sanzione: livello, regola e data di fine');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(public.email_sanzione(pg_temp.p(9), :'z1')) k)
  = array['a', 'fine_il', 'livello', 'regola'], 'email sanzione: mai chi ha segnalato, racconto o motivo');
select pg_temp.ok((public.email_sanzione(pg_temp.p(9), :'z2') -> 'fine_il') = 'null'::jsonb,
  'email sanzione: un avviso non ha data di fine');
select pg_temp.ok(public.email_sanzione(pg_temp.p(8), :'z1') is null,
  'email sanzione: un altro moderatore non la legge');
select pg_temp.ok(public.email_sanzione(pg_temp.p(1), :'z1') is null, 'email sanzione: chi non è moderatore non la legge');
select pg_temp.ok(public.email_sanzione(pg_temp.p(9), pg_temp.p(7)) is null, 'email sanzione: sanzione che non esiste');
reset role;
update public.sanzioni set decisa_il = now() - interval '8 days' where id = :'z2';
set local role service_role;
select pg_temp.ok(public.email_sanzione(pg_temp.p(9), :'z2') is null, 'email sanzione: dopo 7 giorni non si legge più');
reset role;
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato(format($$select public.email_sanzione(%L, %L)$$, pg_temp.p(9), :'z1')),
  'email sanzione: il telefono non la chiama');
reset role;
rollback;
