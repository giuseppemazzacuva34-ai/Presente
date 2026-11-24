-- Test di «Fissa una chiamata» nel database (issue #380, spec v1 del CPO del 23/11, punti 4-7), passo 2b della linea CTO.
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: proposta, conferma, «un altro orario» (2 in tutto), «no, grazie», scadenza all'ora proposta, annullamento;
-- massimo 3 appuntamenti aperti per persona e 1 con la stessa persona; orari a passi di 30 minuti, ≥ 30 minuti da
-- adesso, dentro la settimana, al massimo 30 minuti prima della chiusura; messaggio ≤ 120 caratteri; blocco,
-- segnalazione, sospensione o uscita = «annullato» senza motivo; 3ª chiamata = «tre chiamate»; gli altri della stanza
-- non vedono nulla; tutto si cancella alla chiusura della stanza. Il telefono non legge nulla da solo.
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
  select ('a9a9a9a9-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
-- Un orario valido: ore piene, almeno un'ora da adesso.
create function pg_temp.ora(n integer) returns timestamptz language sql stable as $$
  select date_trunc('hour', now()) + make_interval(hours => 2 + n)
$$;
-- Lo stato dell'appuntamento tra p(io) e p(lei) come lo vede p(io); 'niente' se non lo vede.
create function pg_temp.vede(io integer, lei integer) returns text language sql as $$
  select coalesce((select a.stato from public.appuntamenti_di(pg_temp.p(io)) a where a.altra = pg_temp.p(lei)
                   order by a.quando desc limit 1), 'niente')
$$;
-- L'appuntamento più recente tra p(x) e p(y), cercato tra quelli che p(x) vede.
create function pg_temp.id_tra(x integer, y integer) returns uuid language sql as $$
  select a.id from public.appuntamenti_di(pg_temp.p(x)) a where a.altra = pg_temp.p(y) order by a.quando desc limit 1
$$;

begin;
-- Stanza A (aperta): p1..p8. p9 nella stanza B (aperta). p10 nella stanza C (chiusa). p8 non ha filtri: non è
-- compatibile con nessuno.
insert into auth.users (id, email) select pg_temp.p(n), 'appuntamento' || n || '@example.com' from generate_series(1, 10) n;
insert into public.profili (id, nome, data_nascita, provincia, mi_presento_come)
  select pg_temp.p(n), 'Prova', '1990-01-01', 'MI', 'donna' from generate_series(1, 10) n;
insert into public.filtri (utente_id, cerco, consenso_cerco_il, consenso_versione_informativa, eta_min, eta_max, raggio)
  select pg_temp.p(n), 'tutti', now(), '1.5', 18, 99, 'italia' from generate_series(1, 10) n where n <> 8;
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('a9a9a9a9-0000-4000-8000-00000000000a', 'italia', now() - interval '2 days', now() + interval '3 days'),
  ('a9a9a9a9-0000-4000-8000-00000000000b', 'italia', now() - interval '2 days', now() + interval '3 days'),
  ('a9a9a9a9-0000-4000-8000-00000000000c', 'italia', now() - interval '8 days', now() - interval '1 day');
insert into public.membri_stanza (stanza_id, utente_id)
  select 'a9a9a9a9-0000-4000-8000-00000000000a', pg_temp.p(n) from generate_series(1, 8) n;
insert into public.membri_stanza (stanza_id, utente_id) values
  ('a9a9a9a9-0000-4000-8000-00000000000b', pg_temp.p(9)), ('a9a9a9a9-0000-4000-8000-00000000000c', pg_temp.p(10));

-- Il telefono (e la chiave anon) non legge e non scrive nulla da solo.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.appuntamenti$$)
  and pg_temp.rifiutato($$select public.proponi_appuntamento(auth.uid(), 'a9a9a9a9-0000-4000-8000-000000000002', now() + interval '2 hours', null)$$)
  and pg_temp.rifiutato($$select * from public.appuntamenti_di(auth.uid())$$)
  and pg_temp.rifiutato($$select public.rispondi_appuntamento(auth.uid(), gen_random_uuid(), 'conferma', null, null)$$)
  and pg_temp.rifiutato($$select public.annulla_appuntamento(auth.uid(), gen_random_uuid())$$)
  and pg_temp.rifiutato($$select public.pulisci_appuntamenti()$$),
  'appuntamenti: il telefono non legge, non scrive e non lancia le funzioni (solo il server)');
reset role;
set local role anon;
select pg_temp.ok(pg_temp.rifiutato($$select * from public.appuntamenti$$)
  and pg_temp.rifiutato($$select * from public.appuntamenti_di('a9a9a9a9-0000-4000-8000-000000000001')$$),
  'appuntamenti: la chiave anon riceve un rifiuto');
reset role;

set local role service_role;
-- Orari: passi di 30 minuti, ≥ 30 minuti da adesso, dentro la settimana, al massimo 30 minuti prima della chiusura.
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), pg_temp.ora(0) + interval '10 minutes', null) = 'orario'
  and public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), date_trunc('hour', now()) - interval '1 hour', null) = 'orario'
  and public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), now() + interval '10 minutes', null) = 'orario'
  and public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), date_trunc('hour', now()) + interval '4 days', null) = 'orario',
  'appuntamenti: orari fuori dai passi di 30 minuti, passati, troppo vicini o dopo la chiusura rifiutati');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), pg_temp.ora(0), repeat('a', 121)) = 'troppo_lungo',
  'appuntamenti: messaggio oltre 120 caratteri rifiutato');
-- Chi non si può: se stessi, fuori stanza, stanza chiusa, non compatibili.
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(1), pg_temp.ora(0), null) = 'non_valida'
  and public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(9), pg_temp.ora(0), null) = 'non_disponibile'
  and public.proponi_appuntamento(pg_temp.p(10), pg_temp.p(1), pg_temp.ora(0), null) = 'non_disponibile'
  and public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(8), pg_temp.ora(0), null) = 'non_disponibile',
  'appuntamenti: niente proposte a se stessi, fuori stanza, in stanze chiuse o tra non compatibili');

-- Proposta p1 → p2 con messaggio.
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), pg_temp.ora(0), '  Ti va di sentirci stasera?  ') = 'ok',
  'appuntamenti: proposta mandata');
select pg_temp.ok(pg_temp.vede(1, 2) = 'proposto' and pg_temp.vede(2, 1) = 'proposto',
  'appuntamenti: chi propone e chi riceve vedono la proposta');
select pg_temp.ok((select a.messaggio = 'Ti va di sentirci stasera?' and not a.proposto_da_me
  from public.appuntamenti_di(pg_temp.p(2)) a where a.altra = pg_temp.p(1)),
  'appuntamenti: chi riceve vede il messaggio (spazi tolti) e sa che non l''ha proposto lui');
select pg_temp.ok(pg_temp.vede(3, 1) = 'niente' and pg_temp.vede(3, 2) = 'niente' and pg_temp.vede(9, 1) = 'niente',
  'appuntamenti: gli altri della stanza e chi è fuori non vedono appuntamenti né messaggi');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(2), pg_temp.p(1), pg_temp.ora(1), null) = 'gia_con_lei',
  'appuntamenti: uno solo aperto con la stessa persona');

-- Chi propone non può rispondere alla propria proposta; chi riceve sì.
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(1), pg_temp.id_tra(1, 2), 'conferma', null, null) = 'non_trovato'
  and public.rispondi_appuntamento(pg_temp.p(3), pg_temp.id_tra(1, 2), 'conferma', null, null) = 'non_trovato',
  'appuntamenti: solo chi riceve la proposta risponde');
-- Due controproposte in tutto, poi solo «conferma» o «no, grazie».
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(2), pg_temp.id_tra(1, 2), 'altro', pg_temp.ora(0) + interval '10 minutes', null) = 'orario',
  'appuntamenti: la controproposta passa gli stessi controlli dell''orario');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(2), pg_temp.id_tra(1, 2), 'altro', pg_temp.ora(1), 'Meglio dopo') = 'ok',
  'appuntamenti: prima controproposta');
select pg_temp.ok((select a.proposto_da_me and a.quando = pg_temp.ora(1) and a.messaggio = 'Meglio dopo' and a.controproposte = 1
  from public.appuntamenti_di(pg_temp.p(2)) a where a.altra = pg_temp.p(1)),
  'appuntamenti: dopo la controproposta tocca all''altra persona rispondere');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(1), pg_temp.id_tra(1, 2), 'altro', pg_temp.ora(2), null) = 'ok',
  'appuntamenti: seconda controproposta');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(2), pg_temp.id_tra(1, 2), 'altro', pg_temp.ora(3), null) = 'controproposte_finite',
  'appuntamenti: dopo 2 controproposte non se ne fanno altre');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(2), pg_temp.id_tra(1, 2), 'conferma', null, null) = 'ok',
  'appuntamenti: conferma');
select pg_temp.ok(pg_temp.vede(1, 2) = 'confermato' and pg_temp.vede(2, 1) = 'confermato',
  'appuntamenti: confermato, lo vedono tutti e due');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(2), pg_temp.id_tra(1, 2), 'no', null, null) = 'non_trovato',
  'appuntamenti: a un appuntamento confermato non si risponde di nuovo');

-- «No, grazie»: chi ha proposto lo vede, chi ha rifiutato no.
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(3), pg_temp.p(4), pg_temp.ora(0), null) = 'ok',
  'appuntamenti: proposta da rifiutare');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(4), pg_temp.id_tra(3, 4), 'no', null, null) = 'ok',
  'appuntamenti: «no, grazie»');
select pg_temp.ok(pg_temp.vede(3, 4) = 'rifiutato' and pg_temp.vede(4, 3) = 'niente',
  'appuntamenti: il rifiuto lo vede solo chi ha proposto');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(3), pg_temp.p(4), pg_temp.ora(1), null) = 'ok',
  'appuntamenti: dopo un rifiuto si può proporre di nuovo');

-- Annullamento: l'altra persona vede «annullato» da lei; chi annulla non vede più nulla.
select pg_temp.ok(public.annulla_appuntamento(pg_temp.p(5), pg_temp.id_tra(3, 4)) = 'non_trovato',
  'appuntamenti: solo i due possono annullare');
select pg_temp.ok(public.annulla_appuntamento(pg_temp.p(4), pg_temp.id_tra(3, 4)) = 'ok', 'appuntamenti: annullato da chi l''aveva ricevuto');
select pg_temp.ok(pg_temp.vede(3, 4) = 'annullato' and pg_temp.vede(4, 3) = 'niente'
  and (select a.annullato_dall_altra from public.appuntamenti_di(pg_temp.p(3)) a where a.altra = pg_temp.p(4) and a.stato = 'annullato'),
  'appuntamenti: «<Nome> ha annullato l''appuntamento» solo per l''altra persona');

-- Scadenza all'ora proposta e fine 15 minuti dopo l'ora fissata.
reset role;
insert into public.appuntamenti (stanza_id, chi, con, stato, quando, creato_il) values
  ('a9a9a9a9-0000-4000-8000-00000000000a', pg_temp.p(5), pg_temp.p(6), 'proposto', date_trunc('hour', now()) - interval '1 hour', now() - interval '2 hours'),
  ('a9a9a9a9-0000-4000-8000-00000000000a', pg_temp.p(5), pg_temp.p(7), 'confermato', now() - interval '20 minutes', now() - interval '2 hours'),
  ('a9a9a9a9-0000-4000-8000-00000000000a', pg_temp.p(6), pg_temp.p(7), 'confermato', now() - interval '10 minutes', now() - interval '2 hours');
set local role service_role;
select pg_temp.ok(pg_temp.vede(5, 6) = 'scaduto' and pg_temp.vede(6, 5) = 'niente',
  'appuntamenti: proposta senza risposta scade all''ora proposta, lo vede chi l''ha fatta');
select pg_temp.ok(pg_temp.vede(5, 7) = 'niente' and pg_temp.vede(7, 5) = 'niente',
  'appuntamenti: 15 minuti dopo l''ora fissata senza chiamata l''appuntamento sparisce');
select pg_temp.ok(pg_temp.vede(6, 7) = 'confermato' and pg_temp.vede(7, 6) = 'confermato',
  'appuntamenti: nei 15 minuti dopo l''ora fissata resta (si può chiamare)');
select pg_temp.ok(public.annulla_appuntamento(pg_temp.p(6), pg_temp.id_tra(6, 7)) = 'non_trovato',
  'appuntamenti: si annulla solo fino all''ora fissata');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(6), pg_temp.id_tra(5, 6), 'conferma', null, null) = 'non_trovato',
  'appuntamenti: una proposta scaduta non si conferma');

-- Limiti: 3 aperti per persona (scaduti, finiti, rifiutati e annullati non contano).
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(5), pg_temp.p(1), pg_temp.ora(0), null) = 'ok'
  and public.proponi_appuntamento(pg_temp.p(5), pg_temp.p(2), pg_temp.ora(0), null) = 'ok'
  and public.proponi_appuntamento(pg_temp.p(5), pg_temp.p(3), pg_temp.ora(0), null) = 'ok',
  'appuntamenti: fino a 3 aperti per persona');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(5), pg_temp.p(4), pg_temp.ora(0), null) = 'tre_aperti',
  'appuntamenti: il quarto rifiutato con «Hai già 3 appuntamenti aperti.»');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(4), pg_temp.p(5), pg_temp.ora(0), null) = 'non_disponibile',
  'appuntamenti: verso chi ne ha già 3 aperti «non disponibile», senza dire perché');
-- p1 ha: confermato con p2 + proposta da p5 = 2; p2: con p1 + da p5 = 2. Una terza a p1 da p6 passa, una quarta no.
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(6), pg_temp.p(1), pg_temp.ora(0), null) = 'ok',
  'appuntamenti: terza per p1');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(7), pg_temp.p(1), pg_temp.ora(0), null) = 'non_disponibile',
  'appuntamenti: contano anche le proposte ricevute');

-- 3ª chiamata tra i due prima dell'appuntamento: «Avete già parlato 3 volte».
reset role;
insert into public.chiamate (chi, con, inizio, durata, esito) values
  (pg_temp.p(1), pg_temp.p(2), now() - interval '3 hours', 900, 'tempo_scaduto'),
  (pg_temp.p(2), pg_temp.p(1), now() - interval '2 hours', 900, 'tempo_scaduto'),
  (pg_temp.p(1), pg_temp.p(2), now() - interval '1 hour', 900, 'tempo_scaduto');
set local role service_role;
select pg_temp.ok(pg_temp.vede(1, 2) = 'tre_chiamate' and pg_temp.vede(2, 1) = 'tre_chiamate',
  'appuntamenti: dopo la 3ª chiamata l''appuntamento si annulla con «tre chiamate»');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(1), pg_temp.p(2), pg_temp.ora(4), null) = 'non_disponibile',
  'appuntamenti: dopo 3 chiamate non si fissa più');

-- Blocco: sparisce come «annullato», senza motivo, per tutti e due.
reset role;
insert into public.blocchi (chi, bloccato) values (pg_temp.p(3), pg_temp.p(5));
set local role service_role;
select pg_temp.ok(pg_temp.vede(5, 3) = 'annullato' and pg_temp.vede(3, 5) = 'annullato'
  and (select a.messaggio is null and not a.annullato_dall_altra from public.appuntamenti_di(pg_temp.p(5)) a where a.altra = pg_temp.p(3)),
  'appuntamenti: con un blocco resta solo «L''appuntamento è annullato.», senza motivo né messaggio');
select pg_temp.ok(public.rispondi_appuntamento(pg_temp.p(3), pg_temp.id_tra(3, 5), 'conferma', null, null) = 'non_trovato',
  'appuntamenti: un appuntamento annullato da un blocco non si conferma');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(5), pg_temp.p(4), pg_temp.ora(0), null) = 'ok',
  'appuntamenti: l''appuntamento annullato non conta più nei 3 aperti');

-- Segnalazione e sospensione: «annullato» anche qui.
reset role;
insert into public.segnalazioni (id, da, contro, motivo, origine, creata_il, scade_il) values
  ('a9a9a9a9-0000-4000-8000-000000000901', pg_temp.p(6), pg_temp.p(1), 'altro', 'scheda', now(), now() + interval '1 day');
set local role service_role;
select pg_temp.ok(pg_temp.vede(1, 6) = 'annullato' and pg_temp.vede(6, 1) = 'annullato',
  'appuntamenti: con una segnalazione tra i due resta solo «annullato»');
select pg_temp.ok(public.proponi_appuntamento(pg_temp.p(6), pg_temp.p(1), pg_temp.ora(3), null) = 'non_disponibile',
  'appuntamenti: dopo una segnalazione tra i due non si fissa');

-- Uscita dalla stanza di uno dei due: «annullato» per l'altra persona.
reset role;
delete from public.membri_stanza where utente_id = pg_temp.p(4);
set local role service_role;
select pg_temp.ok(pg_temp.vede(5, 4) = 'annullato', 'appuntamenti: chi resta vede «annullato» se l''altra esce dalla stanza');

-- Chiusura della stanza: tutto si cancella.
reset role;
insert into public.appuntamenti (stanza_id, chi, con, stato, quando, creato_il) values
  ('a9a9a9a9-0000-4000-8000-00000000000c', pg_temp.p(10), pg_temp.p(1), 'proposto', now() - interval '2 days', now() - interval '3 days');
set local role service_role;
select pg_temp.ok(public.pulisci_appuntamenti() >= 1, 'appuntamenti: la pulizia cancella le stanze chiuse');
reset role;
select pg_temp.ok(not exists (select 1 from public.appuntamenti a join public.stanze s on s.id = a.stanza_id
  where now() >= s.chiude_il), 'appuntamenti: alla chiusura della stanza non resta nulla');
select pg_temp.ok(exists (select 1 from public.appuntamenti where stanza_id = 'a9a9a9a9-0000-4000-8000-00000000000a'),
  'appuntamenti: le stanze aperte restano');
-- Dati: il messaggio non supera mai 120 caratteri nemmeno scrivendo a mano.
select pg_temp.ok(pg_temp.rifiutato($$insert into public.appuntamenti (stanza_id, chi, con, stato, quando, messaggio)
  values ('a9a9a9a9-0000-4000-8000-00000000000a', 'a9a9a9a9-0000-4000-8000-000000000001',
  'a9a9a9a9-0000-4000-8000-000000000002', 'proposto', now(), repeat('x', 121))$$),
  'appuntamenti: la tabella rifiuta messaggi oltre 120 caratteri');
rollback;
