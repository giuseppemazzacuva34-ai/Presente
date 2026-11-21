-- Test dell'incontro nel database (issue #6 passo 2a; spec v1 del CPO del 3/11, «Regole» e «Criteri di accettazione»).
-- apri_incontro: dopo il doppio sì crea l'incontro della porta con la scadenza (10 giorni stessa area, 30 aree diverse,
-- in ora di Roma). Tabella chiusa al telefono, nessuna posizione GPS, buca nel registro dei crediti (7 + 3 = 10).
-- Linea «sviluppatore-b». Dati inventati, Postgres di prova.
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
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'ia@example.com'), ('7b7b7b7b-0000-4000-8000-00000000007b', 'ib@example.com'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'ic@example.com'), ('7d7d7d7d-0000-4000-8000-00000000007d', 'id@example.com');
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come) values
  ('7a7a7a7a-0000-4000-8000-00000000007a', 'Ada', '1990-01-01', 'TO', 'donna'),
  ('7b7b7b7b-0000-4000-8000-00000000007b', 'Bruno', '1988-06-01', 'TO', 'uomo'),
  ('7c7c7c7c-0000-4000-8000-00000000007c', 'Carlo', '1985-01-01', 'PA', 'uomo'),
  ('7d7d7d7d-0000-4000-8000-00000000007d', 'Dario', '1985-01-01', 'TO', 'uomo');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6f6f6f6f-0000-4000-8000-000000000001', 'italia', now() - interval '7 days', now() - interval '1 hour');
-- Porte: Ada-Bruno (stessa area, doppio sì), Ada-Carlo (aree diverse, doppio sì), Ada-Dario (nessun esito).
insert into public.porte (id, stanza_id, a, b, aperta_il) values
  ('9e9e9e9e-0000-4000-8000-0000000000ab', '6f6f6f6f-0000-4000-8000-000000000001',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7b7b7b7b-0000-4000-8000-00000000007b', now() - interval '1 hour'),
  ('9e9e9e9e-0000-4000-8000-0000000000ac', '6f6f6f6f-0000-4000-8000-000000000001',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7c7c7c7c-0000-4000-8000-00000000007c', now() - interval '1 hour'),
  ('9e9e9e9e-0000-4000-8000-0000000000ad', '6f6f6f6f-0000-4000-8000-000000000001',
   '7a7a7a7a-0000-4000-8000-00000000007a', '7d7d7d7d-0000-4000-8000-00000000007d', now() - interval '1 hour');

set local role service_role;
select public.assegna_crediti_beta('7a7a7a7a-0000-4000-8000-00000000007a', 300);
select public.assegna_crediti_beta('7b7b7b7b-0000-4000-8000-00000000007b', 100);
select public.assegna_crediti_beta('7c7c7c7c-0000-4000-8000-00000000007c', 100);
select public.blocca_caparra('9e9e9e9e-0000-4000-8000-0000000000ab', '7a7a7a7a-0000-4000-8000-00000000007a');
select public.blocca_caparra('9e9e9e9e-0000-4000-8000-0000000000ab', '7b7b7b7b-0000-4000-8000-00000000007b');
select public.blocca_caparra('9e9e9e9e-0000-4000-8000-0000000000ac', '7a7a7a7a-0000-4000-8000-00000000007a');
select public.blocca_caparra('9e9e9e9e-0000-4000-8000-0000000000ac', '7c7c7c7c-0000-4000-8000-00000000007c');
-- Doppio sì (in ora di Roma: 9 marzo 2026 alle 20:00 per Ada-Carlo, così la scadenza attraversa il cambio d'ora).
update public.svelamenti set iniziato_il = now() - interval '20 minutes', tentativi = 1, tipo = 'video', durata_secondi = 10,
  finito_il = now() - interval '19 minutes', esito = 'doppio_si', esito_il = now() - interval '10 minutes'
  where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab';
update public.svelamenti set iniziato_il = '2026-03-09 18:30:00+00', tentativi = 1, tipo = 'foto', durata_secondi = 10,
  finito_il = '2026-03-09 18:40:00+00', esito = 'doppio_si', esito_il = '2026-03-09 19:00:00+00'
  where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ac';
reset role;

-- Il telefono non vede né tocca gli incontri.
set local role authenticated;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.incontri$$), 'incontri: il telefono non li legge');
select pg_temp.ok(pg_temp.rifiutato($$select public.apri_incontro('9e9e9e9e-0000-4000-8000-0000000000ab')$$),
  'apri_incontro: il telefono non la chiama');
reset role;
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.incontri'::regclass), 'incontri: regole per riga attive');

set local role service_role;
-- Senza doppio sì l'incontro non nasce.
select pg_temp.ok(public.apri_incontro('9e9e9e9e-0000-4000-8000-0000000000ad') is null, 'apri_incontro: senza doppio sì nessun incontro');
select pg_temp.ok(not exists (select 1 from public.incontri where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ad'),
  'apri_incontro: nessuna riga senza doppio sì');

-- Stessa area: doppio sì + 10 giorni, alla stessa ora di Roma.
select pg_temp.ok(public.apri_incontro('9e9e9e9e-0000-4000-8000-0000000000ab')
    = ((select esito_il from public.svelamenti where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab') + interval '10 days'),
  'apri_incontro: stessa area, scadenza = doppio sì + 10 giorni');
-- Aree diverse: + 30 giorni, attraverso il cambio d'ora (29/3): 9/3 20:00 di Roma → 8/4 20:00 di Roma (18:00 UTC).
select pg_temp.ok(public.apri_incontro('9e9e9e9e-0000-4000-8000-0000000000ac') = '2026-04-08 18:00:00+00',
  'apri_incontro: aree diverse, + 30 giorni alla stessa ora di Roma anche col cambio d''ora');
-- Idempotente: una seconda chiamata non cambia nulla e non crea un secondo incontro.
select pg_temp.ok(public.apri_incontro('9e9e9e9e-0000-4000-8000-0000000000ac') = '2026-04-08 18:00:00+00',
  'apri_incontro: seconda chiamata, stessa scadenza');
select pg_temp.ok((select count(*) from public.incontri) = 2, 'apri_incontro: un solo incontro per porta');
select pg_temp.ok((select stato from public.incontri where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab') = 'da_fissare',
  'apri_incontro: si parte da «da fissare»');

-- Vincoli della tabella (anche scrivendo direttamente nel database).
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set luogo_libero = repeat('x', 81) where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab'$$),
  'incontri: luogo scritto al massimo 80 caratteri');
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set controproposte = 4 where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab'$$),
  'incontri: al massimo 3 controproposte');
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set ritardo_minuti = 20 where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab'$$),
  'incontri: ritardo solo 15 o 30 minuti');
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set segnale = 'Lampone', checkin_a_il = now() where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab'$$),
  'incontri: il segnale c''è solo dopo il check-in di entrambi');
select pg_temp.ok(not pg_temp.rifiutato($$update public.incontri set segnale = 'Lampone', checkin_a_il = now(), checkin_b_il = now() where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ab'$$),
  'incontri: segnale ammesso dopo i due check-in');
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set esito = 'avvenuto' where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ac'$$),
  'incontri: esito sempre con il suo orario');
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set esito = 'buca_a', esito_il = now(), crediti_presente = 0 where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ac'$$),
  'incontri: una buca dà sempre 30 Coin a Presente');
select pg_temp.ok(pg_temp.rifiutato($$update public.incontri set esito = 'avvenuto', esito_il = now(), crediti_presente = 30 where porta_id = '9e9e9e9e-0000-4000-8000-0000000000ac'$$),
  'incontri: senza buca Presente non prende crediti');

-- Nessuna posizione GPS nello schema (criterio di accettazione).
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'incontri'
    and column_name ~* '(lat|lon|lng|gps|posizion|coordinat)'), 'incontri: nessuna colonna di posizione');

-- Buca nel registro dei crediti: +7 a chi ha aspettato, una volta sola per porta, legato alla porta.
insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
  values ('7c7c7c7c-0000-4000-8000-00000000007c', 'buca_ricevuta', 70, '9e9e9e9e-0000-4000-8000-0000000000ac');
select pg_temp.ok(public.saldo_crediti('7c7c7c7c-0000-4000-8000-00000000007c') = 70, 'crediti: +70 Coin della buca registrati');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
  values ('7c7c7c7c-0000-4000-8000-00000000007c', 'buca_ricevuta', 70, '9e9e9e9e-0000-4000-8000-0000000000ac')$$),
  'crediti: la buca si riceve una volta sola per porta');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
  values ('7a7a7a7a-0000-4000-8000-00000000007a', 'buca_ricevuta', 80, '9e9e9e9e-0000-4000-8000-0000000000ab')$$),
  'crediti: la buca vale sempre 70 Coin');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.crediti_movimenti (persona, tipo, crediti)
  values ('7a7a7a7a-0000-4000-8000-00000000007a', 'buca_ricevuta', 70)$$),
  'crediti: la buca è sempre legata a una porta');
-- I tipi di prima funzionano come prima.
select pg_temp.ok(public.assegna_crediti_beta('7d7d7d7d-0000-4000-8000-00000000007d', 90) = 90, 'crediti: assegnati_beta come prima (in Coin)');
reset role;

rollback;
