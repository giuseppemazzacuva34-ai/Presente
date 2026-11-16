-- Test della decisione di una persona sulle segnalazioni (issue #7, spec v1.1 definitiva, «Cosa vede chi decide»;
-- D51 A). Linea «sviluppatore-b», passo 12a. Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh.
-- Dati inventati. Spec: azioni Archivia · Avviso · Sospensione 7 giorni · 30 giorni · Esclusione definitiva · Togli
-- sospensione cautelare; motivo obbligatorio (regola + testo); ogni apertura e ogni azione nel registro (chi, quando,
-- cosa); solo il server (il telefono non vede niente); se infondata la cautelare si toglie.
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
  select ('d0d0d0d0-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
-- 1-6 persone; 9 chi decide (il moderatore: lo controlla il Worker, qui è solo un id).
insert into auth.users (id, email) select pg_temp.p(n), 'dec' || n || '@example.com' from generate_series(1, 9) n;

-- Il telefono non vede sanzioni e registro e non lancia le funzioni di chi decide.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.rifiutato($$select * from public.sanzioni$$)
  and pg_temp.rifiutato($$select * from public.registro_moderazione$$)
  and pg_temp.rifiutato(format($$select public.apri_segnalazione(%L, %L)$$, pg_temp.p(1), pg_temp.p(1)))
  and pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'archivia', null, 'x')$$, pg_temp.p(1), pg_temp.p(1))),
  'decisioni: il telefono non vede sanzioni e registro e non decide (solo il server)');
reset role;

set local role service_role;
-- 1. Apertura: segna l'ora la prima volta e resta nel registro ogni volta.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'insulti', 'scheda', null, false) as s1 \gset
select public.apri_segnalazione(pg_temp.p(9), :'s1');
select pg_temp.ok((select aperta_il is not null from public.segnalazioni where id = :'s1'), 'decisioni: aprire segna l''ora di apertura');
select public.apri_segnalazione(pg_temp.p(9), :'s1');
select pg_temp.ok((select count(*) from public.registro_moderazione where segnalazione_id = :'s1' and azione = 'apertura'
  and chi = pg_temp.p(9)) = 2, 'decisioni: ogni apertura resta nel registro (chi, quando, cosa)');

-- 2. Motivo obbligatorio: senza testo, o una sanzione senza regola, non passa.
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'avviso', 'rispetto', '  ')$$, pg_temp.p(9), :'s1')),
  'decisioni: senza testo del motivo non si decide');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'avviso', null, 'ha insultato')$$, pg_temp.p(9), :'s1')),
  'decisioni: una sanzione senza la regola violata non passa');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'radiazione', 'rispetto', 'x')$$, pg_temp.p(9), :'s1')),
  'decisioni: azione sconosciuta rifiutata');

-- 3. Avviso: sanzione senza data di fine, segnalazione chiusa con «provvedimenti», non sospende.
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'avviso', 'rispetto', 'ha insultato') as z1 \gset
select pg_temp.ok((select livello = 'avviso' and fine_il is null and persona = pg_temp.p(2) and decisa_da = pg_temp.p(9)
  and segnalazione_id = :'s1' from public.sanzioni where id = :'z1'), 'decisioni: avviso salvato, senza data di fine');
select pg_temp.ok((select esito = 'provvedimenti' and chiusa_il is not null from public.segnalazioni where id = :'s1'),
  'decisioni: con una sanzione la segnalazione si chiude con «provvedimenti»');
select pg_temp.ok(not public.sospeso(pg_temp.p(2)), 'decisioni: l''avviso non sospende');
select pg_temp.ok((select count(*) from public.registro_moderazione where segnalazione_id = :'s1' and azione = 'avviso'
  and sanzione_id = :'z1') = 1, 'decisioni: l''azione resta nel registro con la sanzione');
-- Una segnalazione già chiusa non si decide due volte.
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'archivia', null, 'ripensamento')$$, pg_temp.p(9), :'s1')),
  'decisioni: una segnalazione già chiusa non si decide di nuovo');

-- 4. Sospensione 7 giorni: sospende fino alla fine, poi non più.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'soldi', 'scheda', null, false) as s2 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s2', 'sospensione_7', 'soldi', 'chiedeva regali') as z2 \gset
select pg_temp.ok((select livello = 'sospensione_7' and fine_il - decisa_il = interval '7 days' from public.sanzioni where id = :'z2'),
  'decisioni: sospensione di 7 giorni con la data di fine');
select pg_temp.ok(public.sospeso(pg_temp.p(3)), 'decisioni: durante la sospensione di 7 giorni la persona è sospesa');
reset role;
update public.sanzioni set decisa_il = now() - interval '8 days', fine_il = now() - interval '1 day' where id = :'z2';
set local role service_role;
select pg_temp.ok(not public.sospeso(pg_temp.p(3)), 'decisioni: finita la sospensione la persona non è più sospesa');

-- 5. Sospensione 30 giorni ed esclusione definitiva.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(4), 'contenuti_sessuali', 'scheda', null, false) as s3 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s3', 'sospensione_30', 'contenuti', 'foto non richieste') as z3 \gset
select pg_temp.ok((select fine_il - decisa_il = interval '30 days' from public.sanzioni where id = :'z3'),
  'decisioni: sospensione di 30 giorni con la data di fine');
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(5), 'profilo_falso', 'scheda', null, false) as s4 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s4', 'esclusione', 'identita', 'profilo falso') as z4 \gset
select pg_temp.ok((select livello = 'esclusione' and fine_il is null from public.sanzioni where id = :'z4')
  and public.sospeso(pg_temp.p(5)), 'decisioni: esclusione definitiva, senza fine, e la persona resta fuori');

-- 6. Cautelare infondata: «Archivia» chiude con «archiviata» e toglie la sospensione cautelare.
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(6), 'minacce_pericolo', 'scheda', null, false) as s5 \gset
select pg_temp.ok(public.sospeso(pg_temp.p(6)), 'decisioni: (prima) «Minacce» sospende in via cautelare');
select pg_temp.ok(public.decidi_segnalazione(pg_temp.p(9), :'s5', 'archivia', null, 'nessuna minaccia nei fatti') is null
  and not exists (select 1 from public.sanzioni where segnalazione_id = :'s5'), 'decisioni: archiviare non crea sanzioni');
select pg_temp.ok((select esito = 'archiviata' from public.segnalazioni where id = :'s5') and not public.sospeso(pg_temp.p(6)),
  'decisioni: archiviata, la sospensione cautelare si toglie');

-- 7. «Togli sospensione cautelare»: la segnalazione resta aperta per decidere dopo.
select public.nuova_segnalazione(pg_temp.p(2), pg_temp.p(6), 'sembra_minorenne', 'scheda', null, false) as s6 \gset
select pg_temp.ok(public.sospeso(pg_temp.p(6)), 'decisioni: (prima) «Sembra minorenne» sospende in via cautelare');
select public.decidi_segnalazione(pg_temp.p(9), :'s6', 'togli_cautelare', null, 'documento verificato');
select pg_temp.ok(not public.sospeso(pg_temp.p(6)) and (select esito is null from public.segnalazioni where id = :'s6'),
  'decisioni: «Togli sospensione cautelare» la toglie e lascia aperta la segnalazione');
select pg_temp.ok((select count(*) from public.registro_moderazione where segnalazione_id = :'s6' and azione = 'togli_cautelare') = 1,
  'decisioni: anche «Togli sospensione cautelare» resta nel registro');

-- 8. Una sanzione che sostituisce la cautelare: la cautelare si chiude, resta sospesa per la sanzione.
select public.nuova_segnalazione(pg_temp.p(3), pg_temp.p(4), 'diffusione_immagini', 'scheda', null, false) as s7 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s7', 'sospensione_30', 'immagini', 'ha diffuso le foto');
select pg_temp.ok((select count(*) from public.sospensioni where persona = pg_temp.p(4) and tolta_il is null) = 0
  and public.sospeso(pg_temp.p(4)), 'decisioni: la sanzione prende il posto della cautelare (sospesa per la sanzione)');

-- 9. «Sono in difficoltà» senza persona: si chiude, ma nessuna sanzione possibile.
select public.nuova_segnalazione(pg_temp.p(1), null, 'sono_in_difficolta', 'sono_in_difficolta', null, false) as s8 \gset
select pg_temp.ok(pg_temp.rifiutato(format($$select public.decidi_segnalazione(%L, %L, 'avviso', 'rispetto', 'x')$$, pg_temp.p(9), :'s8')),
  'decisioni: senza persona segnalata non c''è sanzione');
select public.decidi_segnalazione(pg_temp.p(9), :'s8', 'archivia', null, 'richiamata, tutto bene');
select pg_temp.ok((select esito = 'archiviata' from public.segnalazioni where id = :'s8'), 'decisioni: «Sono in difficoltà» senza persona si archivia');

-- 10. Il registro non si modifica né si cancella.
select pg_temp.ok(pg_temp.rifiutato($$update public.registro_moderazione set azione = 'apertura'$$)
  and pg_temp.rifiutato($$delete from public.registro_moderazione$$), 'decisioni: il registro non si modifica né si cancella');
reset role;
-- 11. Una sanzione che toglie dalle stanze annulla le chiavi (stessa funzione della sospensione); l'avviso no.
select pg_temp.ok((select pg_get_triggerdef(t.oid) like '%AFTER INSERT ON public.sanzioni%WHEN ((new.livello <> ''avviso''::text))%annulla_chiavi_per_sospensione()%'
  from pg_trigger t where t.tgname = 'annulla_chiavi_per_sanzione'), 'decisioni: sospensione o esclusione annullano le chiavi');
rollback;
