-- Test dei casi «Da gestire da Giuseppe» nei messaggi «Scrivici» (issue #10, parte B v1.1 del CPO, 20/11; D122 B).
-- Linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati.
-- Spec: ricorsi, sanzioni, rimborsi di crediti, richieste sui dati personali, stampa, avvocati e proposte commerciali
-- ricevono SOLO una bozza «Da gestire da Giuseppe» (fonte «nessuna»): il database rifiuta ogni altra bozza.
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
  select ('6b6b6b6b-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

-- Le parole: ricorsi/sanzioni/rimborsi, dati personali, stampa/avvocati/aziende. Domande normali no.
select pg_temp.ok(public.parole_da_gestire('Vorrei fare ricorso contro la sospensione')
  and public.parole_da_gestire('Voglio contestare la sanzione')
  and public.parole_da_gestire('Mi rimborsate i crediti della stanza?')
  and public.parole_da_gestire('Ridatemi i crediti, la stanza era vuota'),
  'da gestire: ricorsi, sanzioni e rimborsi riconosciuti');
select pg_temp.ok(public.parole_da_gestire('Vorrei una copia dei miei dati personali')
  and public.parole_da_gestire('Chiedo la cancellazione dei miei dati (GDPR)')
  and public.parole_da_gestire('Devo correggere i miei dati'),
  'da gestire: richieste sui dati personali (copia, cancellazione, correzione) riconosciute');
select pg_temp.ok(public.parole_da_gestire('Sono una giornalista, posso intervistarvi?')
  and public.parole_da_gestire('Scrivo per conto del mio avvocato')
  and public.parole_da_gestire('Siamo un''azienda e vorremmo una collaborazione commerciale'),
  'da gestire: stampa, avvocati e proposte commerciali riconosciuti');
select pg_temp.ok(not public.parole_da_gestire('Come funzionano le chiavi?')
  and not public.parole_da_gestire('Come cancello l''account?')
  and not public.parole_da_gestire('Dove vedo i crediti?')
  and not public.parole_da_gestire('Nel contesto della stanza non sento bene'),
  'da gestire: domande delle FAQ (anche «cancello l''account») restano normali');

begin;
insert into auth.users (id, email) values (pg_temp.p(1), 'dg1@example.com');
create temp table m (n integer primary key, esito jsonb) on commit drop;
grant insert, select on m to service_role;
grant select on m to agente_supporto;
set local role service_role;
insert into m values
  (1, public.invia_supporto(pg_temp.p(1), 'account', 'Vorrei fare ricorso contro la sospensione')),
  (2, public.invia_supporto(pg_temp.p(1), 'account', 'Vorrei una copia dei miei dati personali')),
  (3, public.invia_supporto(pg_temp.p(1), 'chiavi_porte', 'Come funzionano le chiavi?'));
reset role;

set local role agente_supporto;
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select (esito ->> 'id')::uuid, 'Ciao! Ecco come fare ricorso.', 'FAQ n. 11' from m where n = 1$$),
  'da gestire: su un ricorso l''agente non può scrivere una bozza normale');
select pg_temp.ok(pg_temp.rifiutato($$insert into public.supporto_bozze (messaggio_id, testo, fonte)
    select (esito ->> 'id')::uuid, 'Da gestire da Giuseppe: copia dei dati.', 'FAQ n. 12' from m where n = 2$$),
  'da gestire: con una fonte FAQ la bozza è rifiutata (fonte solo «nessuna»)');
insert into public.supporto_bozze (messaggio_id, testo, fonte)
  select (esito ->> 'id')::uuid, 'Da gestire da Giuseppe: ricorso contro una sospensione.', 'nessuna' from m where n = 1;
insert into public.supporto_bozze (messaggio_id, testo, fonte)
  select (esito ->> 'id')::uuid, 'Da gestire da Giuseppe: richiesta di copia dei dati.', 'nessuna' from m where n = 2;
insert into public.supporto_bozze (messaggio_id, testo, fonte)
  select (esito ->> 'id')::uuid, 'Ciao! Hai 2 chiavi a settimana. Il team di Presente', 'FAQ n. 5' from m where n = 3;
reset role;

select pg_temp.ok((select count(*) from public.supporto_bozze b join m on b.messaggio_id = (m.esito ->> 'id')::uuid) = 3,
  'da gestire: «Da gestire da Giuseppe» accettata sui casi speciali, bozza normale sulle altre domande');
rollback;
