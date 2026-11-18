-- Test del «momento» dello svelamento (issue #65, passo 6a; spec v1 del CPO, passi 4, 5 e 7): svelamento_di dice
-- «momento» = true solo quando lo svelamento si può fare adesso (tutti e due «pronti» entro 5 minuti, oppure dentro la
-- mezz'ora fissata) e solo allora il «tipo» (video o foto): «Preferisco le foto» di uno vale per entrambi, così la
-- sala d'attesa non accende la fotocamera se lo svelamento sarà con le foto. Prima del momento il tipo non esce mai
-- (la scelta dell'altra persona resta segreta). Linea «sviluppatore». Dati inventati, Postgres di prova.
\set ON_ERROR_STOP on
create function pg_temp.ok(condizione boolean, descrizione text) returns void language plpgsql as $$
begin
  if condizione is not true then raise exception 'ERRORE %', descrizione; end if;
  raise notice 'OK   %', descrizione;
end $$;
create function pg_temp.porta_di(persona uuid) returns jsonb language sql as $$
  select p from jsonb_array_elements(public.svelamento_di(persona) -> 'porte') p where p ->> 'porta' = '8e8e8e8e-0000-4000-8000-0000000001ab'
$$;

begin;
insert into auth.users (id, email) values
  ('6a6a6a6a-0000-4000-8000-00000000016a', 'ma@example.com'), ('6b6b6b6b-0000-4000-8000-00000000016b', 'mb@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('6a6a6a6a-0000-4000-8000-00000000016a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('6b6b6b6b-0000-4000-8000-00000000016b', 'Bruno', '1988-06-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000101', 'italia', now() - interval '7 days', now() - interval '1 hour');
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8e8e8e8e-0000-4000-8000-0000000001ab', '7f7f7f7f-0000-4000-8000-000000000101',
   '6a6a6a6a-0000-4000-8000-00000000016a', '6b6b6b6b-0000-4000-8000-00000000016b', now() - interval '2 hours');
set local role service_role;

-- Senza caparre: nessun momento, nessun tipo.
select pg_temp.ok((select p ? 'momento' and not (p ->> 'momento')::boolean and p -> 'tipo' = 'null'::jsonb
  from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000016a') p),
  'momento: senza caparre → false, tipo null');

select public.assegna_crediti_beta('6a6a6a6a-0000-4000-8000-00000000016a', 10);
select public.assegna_crediti_beta('6b6b6b6b-0000-4000-8000-00000000016b', 10);
select public.caparra_svelamento('8e8e8e8e-0000-4000-8000-0000000001ab', '6a6a6a6a-0000-4000-8000-00000000016a');
select public.caparra_svelamento('8e8e8e8e-0000-4000-8000-0000000001ab', '6b6b6b6b-0000-4000-8000-00000000016b');

-- Bruno preferisce le foto; Ada è pronta da sola: non è ancora il momento e la scelta di Bruno non esce.
select public.scelta_svelamento('8e8e8e8e-0000-4000-8000-0000000001ab', '6b6b6b6b-0000-4000-8000-00000000016b', 'foto');
select public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000001ab', '6a6a6a6a-0000-4000-8000-00000000016a');
select pg_temp.ok((select not (p ->> 'momento')::boolean and p -> 'tipo' = 'null'::jsonb and p ->> 'mia_scelta' = 'video'
  from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000016a') p),
  'momento: solo Ada pronta → false; Ada non sa che Bruno ha scelto le foto');

-- Bruno è pronto entro 5 minuti: è il momento per tutti e due, e il tipo è «foto» per entrambi.
select pg_temp.ok(public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000001ab', '6b6b6b6b-0000-4000-8000-00000000016b') = 'entrambi_pronti',
  'pronto: Bruno → entrambi_pronti');
select pg_temp.ok((select (p ->> 'momento')::boolean and p ->> 'tipo' = 'foto' from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000016a') p)
  and (select (p ->> 'momento')::boolean and p ->> 'tipo' = 'foto' from pg_temp.porta_di('6b6b6b6b-0000-4000-8000-00000000016b') p),
  'momento: entrambi pronti → true per tutti e due, tipo foto (una scelta foto vale per entrambi)');

-- Bruno torna al video: tutti e due video → tipo video.
select public.scelta_svelamento('8e8e8e8e-0000-4000-8000-0000000001ab', '6b6b6b6b-0000-4000-8000-00000000016b', 'video');
select pg_temp.ok((select (p ->> 'momento')::boolean and p ->> 'tipo' = 'video' from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000016a') p),
  'momento: tutti e due video → tipo video');

-- Dopo 5 minuti i «pronto» non valgono più: niente momento.
reset role;
update public.svelamenti set pronto_a_il = now() - interval '6 minutes', pronto_b_il = now() - interval '6 minutes'
  where porta_id = '8e8e8e8e-0000-4000-8000-0000000001ab';
set local role service_role;
select pg_temp.ok((select not (p ->> 'momento')::boolean and p -> 'tipo' = 'null'::jsonb from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000016a') p),
  'momento: «pronto» scaduti → false');

-- Fascia fissata iniziata da 10 minuti: è il momento. Fascia futura: no. Fascia finita: no.
reset role;
update public.svelamenti set pronto_a_il = null, pronto_b_il = null, fascia_fissata = now() - interval '10 minutes'
  where porta_id = '8e8e8e8e-0000-4000-8000-0000000001ab';
set local role service_role;
select pg_temp.ok((select (p ->> 'momento')::boolean and p ->> 'tipo' = 'video' from pg_temp.porta_di('6b6b6b6b-0000-4000-8000-00000000016b') p),
  'momento: dentro la mezz''ora fissata → true');
reset role;
update public.svelamenti set fascia_fissata = now() + interval '20 minutes' where porta_id = '8e8e8e8e-0000-4000-8000-0000000001ab';
set local role service_role;
select pg_temp.ok((select not (p ->> 'momento')::boolean from pg_temp.porta_di('6b6b6b6b-0000-4000-8000-00000000016b') p),
  'momento: fascia fissata non ancora iniziata → false');
reset role;
update public.svelamenti set fascia_fissata = now() - interval '31 minutes' where porta_id = '8e8e8e8e-0000-4000-8000-0000000001ab';
set local role service_role;
select pg_temp.ok((select not (p ->> 'momento')::boolean from pg_temp.porta_di('6b6b6b6b-0000-4000-8000-00000000016b') p),
  'momento: mezz''ora fissata finita → false');

-- La scelta dell'altra persona non esce mai come campo a sé.
select pg_temp.ok((select not p ? 'sua_scelta' and not p ? 'scelta_a' and not p ? 'scelta_b' from pg_temp.porta_di('6a6a6a6a-0000-4000-8000-00000000016a') p),
  'momento: nessun campo con la scelta dell''altra persona');

reset role;
rollback;
