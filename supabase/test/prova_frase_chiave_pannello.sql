-- Test della frase della chiave nel pannello di chi decide (issue #7, spec v1.2 del CPO del 20/11, punto 2).
-- Linea «sviluppatore-b», passo 15b. Si esegue con scripts/test_supabase.sh. Dati inventati.
-- La frase si mostra solo se la segnalazione è collegata a una porta tra i due (stessa coppia, fatta dopo
-- l'apertura della porta) e il motivo è uno di: contatti prima della porta, insulti, contenuti sessuali,
-- minacce/pericolo, soldi o vendite. La frase mostrata è quella che la persona segnalata ha lasciato a chi segnala.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('f15b15b1-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.frase(seg uuid) returns text language sql as $$
  select public.scheda_segnalazione(pg_temp.p(9), seg) -> 'segnalazione' ->> 'frase_chiave'
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'fc' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome) values (pg_temp.p(1), 'Anna'), (pg_temp.p(2), 'Bruno'), (pg_temp.p(3), 'Carla');
insert into public.moderatori (persona) values (pg_temp.p(9));
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('f15b0000-0000-4000-8000-000000000001', 'italia', now() - interval '8 days', now() - interval '1 day');
-- Porta Anna (a) – Bruno (b) aperta ieri alle 21: Anna ha lasciato «Ciao!», Bruno «Scrivimi su insta: brunetto».
insert into public.porte (stanza_id, a, b, aperta_il, frase_di_a, frase_di_b) values
  ('f15b0000-0000-4000-8000-000000000001', pg_temp.p(1), pg_temp.p(2), now() - interval '1 day', 'Ciao!', 'Scrivimi qui: brunetto');

set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'contatti_prima_porta', 'scheda', null, false) as s_contatti \gset
select public.nuova_segnalazione(pg_temp.p(2), pg_temp.p(1), 'insulti', 'scheda', null, false) as s_inversa \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'altro', 'scheda', null, false) as s_altro \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'profilo_falso', 'scheda', null, false) as s_falso \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'soldi', 'scheda', null, false) as s_prima \gset
update public.segnalazioni set creata_il = now() - interval '2 days' where id = :'s_prima';
select public.nuova_segnalazione(pg_temp.p(3), pg_temp.p(2), 'insulti', 'scheda', null, false) as s_altra_coppia \gset

select pg_temp.ok(pg_temp.frase(:'s_contatti') = 'Scrivimi qui: brunetto',
  'frase: con la porta tra i due e motivo «contatti», si vede la frase che la persona segnalata ha lasciato');
select pg_temp.ok(pg_temp.frase(:'s_inversa') = 'Ciao!',
  'frase: se segnala l''altra persona della porta, si vede la frase dell''altra parte');
select pg_temp.ok(pg_temp.frase(:'s_altro') is null, 'frase: con «Altro» non si mostra');
select pg_temp.ok(pg_temp.frase(:'s_falso') is null, 'frase: con «Profilo falso» non si mostra');
select pg_temp.ok(pg_temp.frase(:'s_prima') is null, 'frase: una segnalazione fatta prima dell''apertura della porta non la mostra');
select pg_temp.ok(pg_temp.frase(:'s_altra_coppia') is null, 'frase: senza porta tra i due non si mostra');
select pg_temp.ok((select bool_and(public.scheda_segnalazione(pg_temp.p(9), x) -> 'segnalazione' ? 'frase_chiave')
    from unnest(array[:'s_altro', :'s_contatti']::uuid[]) x),
  'frase: il campo c''è sempre (vuoto quando non si può mostrare)');
reset role;

rollback;
