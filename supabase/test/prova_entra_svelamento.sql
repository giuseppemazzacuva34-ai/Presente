-- Test dell'ingresso nello svelamento (issue #65, passo 6c; spec v1 del CPO, passi 5 e 6 e «Casi limite»):
-- entra_svelamento(porta, persona) fa entrare chi è nella sala d'attesa. Si entra solo nel «momento» (due caparre e
-- tutti e due pronti entro 5 minuti, o dentro la mezz'ora fissata) oppure se l'altra persona è entrata da meno di 10
-- minuti. Quando ci sono tutti e due lo svelamento inizia: iniziato_il, un tentativo in più, tipo (foto se uno ha
-- scelto le foto). Chi aspetta e richiede riceve lo stesso esito (serve a sapere quando l'altra persona è arrivata).
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
create function pg_temp.entra(persona uuid) returns text language sql as $$
  select public.entra_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', persona)
$$;

begin;
insert into auth.users (id, email) values
  ('6a6a6a6a-0000-4000-8000-00000000026a', 'ea@example.com'), ('6b6b6b6b-0000-4000-8000-00000000026b', 'eb@example.com'),
  ('6c6c6c6c-0000-4000-8000-00000000026c', 'ec@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('6a6a6a6a-0000-4000-8000-00000000026a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('6b6b6b6b-0000-4000-8000-00000000026b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('6c6c6c6c-0000-4000-8000-00000000026c', 'Ciro', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('7f7f7f7f-0000-4000-8000-000000000201', 'italia', now() - interval '7 days', now() - interval '1 hour');
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('8e8e8e8e-0000-4000-8000-0000000002ab', '7f7f7f7f-0000-4000-8000-000000000201',
   '6a6a6a6a-0000-4000-8000-00000000026a', '6b6b6b6b-0000-4000-8000-00000000026b', now() - interval '2 hours');

-- Il telefono non chiama la funzione.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select public.entra_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', '6a6a6a6a-0000-4000-8000-00000000026a')$$),
  'entra: il telefono non la chiama');
reset role;
set local role service_role;

-- Chi non è nella porta: come una porta che non esiste.
select pg_temp.ok(pg_temp.entra('6c6c6c6c-0000-4000-8000-00000000026c') = 'non_nella_porta', 'entra: persona fuori dalla porta → non_nella_porta');
-- Senza caparre non si entra (criterio: senza caparra di entrambi lo svelamento non si avvia, anche via API).
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'manca_caparra', 'entra: senza caparre → manca_caparra');

select public.assegna_crediti_beta('6a6a6a6a-0000-4000-8000-00000000026a', 10);
select public.assegna_crediti_beta('6b6b6b6b-0000-4000-8000-00000000026b', 10);
select public.caparra_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', '6a6a6a6a-0000-4000-8000-00000000026a');
select public.caparra_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', '6b6b6b6b-0000-4000-8000-00000000026b');

-- Caparre sì, ma non è il momento (nessuno pronto, nessuna fascia): non si entra.
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'non_ancora', 'entra: fuori dal momento → non_ancora');

-- Tutti e due pronti: Ada entra e aspetta; lo svelamento non è iniziato.
select public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', '6a6a6a6a-0000-4000-8000-00000000026a');
select public.pronto_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', '6b6b6b6b-0000-4000-8000-00000000026b');
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'in_attesa', 'entra: Ada nel momento → in_attesa');
select pg_temp.ok((select iniziato_il is null and tentativi = 0 and entrato_a_il is not null and entrato_b_il is null
  from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab'), 'entra: solo Ada dentro → non iniziato');
-- Ada richiede mentre aspetta: sempre in_attesa e l'orario d'ingresso non si sposta (i 10 minuti non ripartono).
reset role;
update public.svelamenti set entrato_a_il = now() - interval '3 minutes' where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab';
set local role service_role;
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'in_attesa', 'entra: Ada richiede → ancora in_attesa');
select pg_temp.ok((select now() - entrato_a_il >= interval '3 minutes' from public.svelamenti
  where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab'), 'entra: i 10 minuti di attesa non ripartono');

-- Il «pronto» scade (6 minuti) ma Ada è dentro da 3: Bruno entra lo stesso e lo svelamento inizia, con il video.
reset role;
update public.svelamenti set pronto_a_il = now() - interval '6 minutes', pronto_b_il = now() - interval '6 minutes'
  where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab';
set local role service_role;
select pg_temp.ok(pg_temp.entra('6b6b6b6b-0000-4000-8000-00000000026b') = 'iniziato_video', 'entra: Bruno con Ada che aspetta → iniziato_video');
select pg_temp.ok((select iniziato_il is not null and tentativi = 1 and tipo = 'video'
  from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab'), 'entra: iniziato_il, 1 tentativo, tipo video');
-- Ada richiede: sa che è iniziato (stesso esito); nessun tentativo in più.
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'iniziato_video', 'entra: Ada richiede → iniziato_video');
select pg_temp.ok((select tentativi = 1 from public.svelamenti where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab'),
  'entra: richiedere non aggiunge tentativi');
-- Dopo l'inizio la scelta video/foto non cambia più.
select pg_temp.ok(public.scelta_svelamento('8e8e8e8e-0000-4000-8000-0000000002ab', '6b6b6b6b-0000-4000-8000-00000000026b', 'foto') = 'gia_iniziato',
  'entra: dopo l''inizio la scelta non cambia');

-- Ricomincio: Ada aspetta da 11 minuti, Bruno non è arrivato e non è più il momento → non_arrivato; Bruno non entra.
reset role;
update public.svelamenti set iniziato_il = null, tentativi = 0, tipo = null, entrato_a_il = now() - interval '11 minutes',
  entrato_b_il = null where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab';
set local role service_role;
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'non_arrivato', 'entra: dopo 10 minuti senza l''altra persona → non_arrivato');
select pg_temp.ok(pg_temp.entra('6b6b6b6b-0000-4000-8000-00000000026b') = 'non_ancora', 'entra: Bruno dopo i 10 minuti, fuori dal momento → non_ancora');

-- Dentro la mezz'ora fissata, con le foto scelte da Bruno: si entra di nuovo e il tipo è «foto» per entrambi.
reset role;
update public.svelamenti set fascia_fissata = now() - interval '5 minutes', scelta_b = 'foto' where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab';
set local role service_role;
select pg_temp.ok(pg_temp.entra('6b6b6b6b-0000-4000-8000-00000000026b') = 'in_attesa', 'entra: Bruno nella fascia fissata → in_attesa');
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'iniziato_foto', 'entra: Ada arriva → iniziato_foto');

-- Porta scaduta senza svelamento: niente ingresso, crediti restituiti (regola già esistente).
reset role;
update public.svelamenti set iniziato_il = null, tentativi = 0, tipo = null, entrato_a_il = null, entrato_b_il = null,
  fascia_fissata = null where porta_id = '8e8e8e8e-0000-4000-8000-0000000002ab';
update public.porte set aperta_il = now() - interval '49 hours' where id = '8e8e8e8e-0000-4000-8000-0000000002ab';
set local role service_role;
select pg_temp.ok(pg_temp.entra('6a6a6a6a-0000-4000-8000-00000000026a') = 'porta_scaduta', 'entra: dopo 48 ore → porta_scaduta');

reset role;
rollback;
