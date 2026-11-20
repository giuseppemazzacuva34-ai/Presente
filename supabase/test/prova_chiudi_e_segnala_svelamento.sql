-- Test di «Chiudi e segnala» durante il video dello svelamento (issue #65 passo 7d-3a; spec v1 del CPO, «Casi limite»:
-- chiude, blocca i due per sempre, caparre restituite a entrambi; la segnalazione la apre poi il modulo della #7).
-- chiudi_e_segnala_svelamento(porta, persona): solo chi è nella porta, solo a video iniziato e non ancora finito.
-- Linea «sviluppatore». Dati inventati, Postgres di prova.
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

begin;
insert into auth.users (id, email) values
  ('6a6a6a6a-0000-4000-8000-00000000006a', 'csa@example.com'), ('6b6b6b6b-0000-4000-8000-00000000006b', 'csb@example.com'),
  ('6c6c6c6c-0000-4000-8000-00000000006c', 'csc@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('6a6a6a6a-0000-4000-8000-00000000006a', 'Alma', '1990-01-01', 'MI', 'donna'),
  ('6b6b6b6b-0000-4000-8000-00000000006b', 'Bruno', '1988-06-01', 'MI', 'uomo'),
  ('6c6c6c6c-0000-4000-8000-00000000006c', 'Carlo', '1985-01-01', 'MI', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Alma-Bruno (video in corso), Alma-Carlo (svelamento con le foto).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9a9a9a9a-0000-4000-8000-0000000000ab', '7f7f7f7f-0000-4000-8000-000000000001',
   '6a6a6a6a-0000-4000-8000-00000000006a', '6b6b6b6b-0000-4000-8000-00000000006b', now() - interval '1 hour'),
  ('9a9a9a9a-0000-4000-8000-0000000000ac', '7f7f7f7f-0000-4000-8000-000000000001',
   '6a6a6a6a-0000-4000-8000-00000000006a', '6c6c6c6c-0000-4000-8000-00000000006c', now() - interval '1 hour');

-- Il telefono non chiama la funzione.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a')$$),
  'chiudi_e_segnala_svelamento: il telefono non la chiama');
reset role;
set local role service_role;

select public.assegna_crediti_beta('6a6a6a6a-0000-4000-8000-00000000006a', 20);
select public.assegna_crediti_beta('6b6b6b6b-0000-4000-8000-00000000006b', 10);
select public.assegna_crediti_beta('6c6c6c6c-0000-4000-8000-00000000006c', 10);
select public.caparra_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a');
select public.caparra_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b');
select public.caparra_svelamento('9a9a9a9a-0000-4000-8000-0000000000ac', '6a6a6a6a-0000-4000-8000-00000000006a');
select public.caparra_svelamento('9a9a9a9a-0000-4000-8000-0000000000ac', '6c6c6c6c-0000-4000-8000-00000000006c');
select pg_temp.ok(public.saldo_crediti('6a6a6a6a-0000-4000-8000-00000000006a') = 0
  and public.saldo_crediti('6b6b6b6b-0000-4000-8000-00000000006b') = 0, 'preparazione: caparre bloccate');

-- Prima dell'inizio non si chiude nulla.
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'non_iniziato',
  'chiudi_e_segnala_svelamento: prima dell''inizio → non_iniziato');
select pg_temp.ok((select esito is null from public.svelamenti where porta_id = '9a9a9a9a-0000-4000-8000-0000000000ab'),
  'chiudi_e_segnala_svelamento: prima dell''inizio la porta resta aperta');

reset role;
update public.svelamenti set iniziato_il = now(), tipo = 'video', tentativi = 1 where porta_id = '9a9a9a9a-0000-4000-8000-0000000000ab';
update public.svelamenti set iniziato_il = now(), tipo = 'foto', tentativi = 1 where porta_id = '9a9a9a9a-0000-4000-8000-0000000000ac';
set local role service_role;

-- Persone fuori dalla porta e porte inesistenti: niente.
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6c6c6c6c-0000-4000-8000-00000000006c') = 'non_nella_porta'
  and public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ff', '6a6a6a6a-0000-4000-8000-00000000006a') = 'non_nella_porta'
  and public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', null) = 'non_nella_porta',
  'chiudi_e_segnala_svelamento: porta di altri o inesistente → non_nella_porta');

-- Svelamento con le foto: niente video, niente «Chiudi e segnala» qui (si segnala dalla scheda).
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ac', '6a6a6a6a-0000-4000-8000-00000000006a') = 'non_iniziato'
  and (select esito is null from public.svelamenti where porta_id = '9a9a9a9a-0000-4000-8000-0000000000ac'),
  'chiudi_e_segnala_svelamento: con le foto → non_iniziato');

-- Bruno chiude e segnala durante il video.
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b') = 'chiusa',
  'chiudi_e_segnala_svelamento: Bruno chiude durante il video');
select pg_temp.ok((select esito = 'chiudi_e_segnala' and esito_il is not null and finito_il is not null
    and risposta_a is null and risposta_b is null
  from public.svelamenti where porta_id = '9a9a9a9a-0000-4000-8000-0000000000ab'),
  'chiudi_e_segnala_svelamento: porta chiusa con esito «chiudi_e_segnala»');
select pg_temp.ok(public.bloccati_tra('6a6a6a6a-0000-4000-8000-00000000006a', '6b6b6b6b-0000-4000-8000-00000000006b')
  and exists (select 1 from public.blocchi where chi = '6b6b6b6b-0000-4000-8000-00000000006b' and bloccato = '6a6a6a6a-0000-4000-8000-00000000006a'),
  'chiudi_e_segnala_svelamento: blocco immediato di chi segnala verso l''altra persona');
select pg_temp.ok(public.saldo_crediti('6a6a6a6a-0000-4000-8000-00000000006a') = 10
  and public.saldo_crediti('6b6b6b6b-0000-4000-8000-00000000006b') = 10,
  'chiudi_e_segnala_svelamento: caparre restituite a entrambi, nessuna penale');
select pg_temp.ok(not exists (select 1 from public.segnalazioni where da = '6b6b6b6b-0000-4000-8000-00000000006b'),
  'chiudi_e_segnala_svelamento: la segnalazione la scrive il modulo della #7, non questa funzione');

-- Ripetere non cambia nulla (doppio tocco, rete lenta): stesso esito, nessun credito in più.
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6b6b6b6b-0000-4000-8000-00000000006b') = 'chiusa'
  and public.saldo_crediti('6b6b6b6b-0000-4000-8000-00000000006b') = 10,
  'chiudi_e_segnala_svelamento: idempotente per chi ha chiuso');
-- L'altra persona non sa perché: per lei la porta è solo chiusa.
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'porta_chiusa'
  and public.saldo_crediti('6a6a6a6a-0000-4000-8000-00000000006a') = 10
  and public.entra_svelamento('9a9a9a9a-0000-4000-8000-0000000000ab', '6a6a6a6a-0000-4000-8000-00000000006a') = 'porta_chiusa',
  'chiudi_e_segnala_svelamento: per l''altra persona solo «porta_chiusa»');

-- Video iniziato da troppo tempo (oltre i 15 minuti del Durable Object): finito, non si chiude più così.
reset role;
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9a9a9a9a-0000-4000-8000-0000000000bc', '7f7f7f7f-0000-4000-8000-000000000001',
   '6b6b6b6b-0000-4000-8000-00000000006b', '6c6c6c6c-0000-4000-8000-00000000006c', now() - interval '2 hours');
insert into public.svelamenti (porta_id, caparra_a_il, caparra_b_il, iniziato_il, tipo, tentativi)
  values ('9a9a9a9a-0000-4000-8000-0000000000bc', now() - interval '1 hour', now() - interval '1 hour', now() - interval '20 minutes', 'video', 1);
set local role service_role;
select pg_temp.ok(public.chiudi_e_segnala_svelamento('9a9a9a9a-0000-4000-8000-0000000000bc', '6c6c6c6c-0000-4000-8000-00000000006c') = 'finito'
  and (select esito is null from public.svelamenti where porta_id = '9a9a9a9a-0000-4000-8000-0000000000bc'),
  'chiudi_e_segnala_svelamento: video ormai finito → finito, porta invariata');

rollback;
