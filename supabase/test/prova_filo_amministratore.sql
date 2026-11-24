-- Test del pannello dell'amministratore per il Filo (issue #360, spec v1 + v1.1 del CPO, D151 A): assegnare il Filo a
-- una stanza, avviso se alle 8:45 di lunedì manca il vocale, ascoltare e togliere un vocale inadatto. Passo 12a della
-- linea «sviluppatore-c». Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati, orologio
-- finto. Stanza 1: compone lunedì 30/3/2026 alle 00:30 di Roma (22:30 UTC del 29), apre alle 9:00 (7:00 UTC), chiude
-- domenica 5/4 alle 21:00 (19:00 UTC). Persona 9 = amministratore (tabella moderatori), 1 = Filo, 2-3 = membri.
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
create function pg_temp.errore(comando text) returns text language plpgsql as $$
begin
  execute comando;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('f7f7f7f7-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f7f7f7f7-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
create function pg_temp.avviso(ora text) returns text language sql as $$
  select coalesce(a.avviso, '-') from public.stanze_filo_amministratore(pg_temp.p(9), ora::timestamptz) a
  where a.stanza = pg_temp.s(1)
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'fa' || n || '@example.com' from generate_series(1, 9) n;
insert into public.profili (id, nome, data_nascita, citta) values
  (pg_temp.p(1), 'Silvia', '1980-01-01', 'Milano'), (pg_temp.p(2), 'Anna', '1990-01-01', 'Milano'),
  (pg_temp.p(3), 'Bruno', '1990-01-01', 'Milano'), (pg_temp.p(4), 'Carlo', '1985-01-01', 'Milano');
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il) values
  (pg_temp.s(1), 'citta', 'Milano', '2026-03-30 07:00+00', '2026-04-05 19:00+00', '2026-03-29 22:30+00'),
  (pg_temp.s(2), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00');
insert into public.membri_stanza (stanza_id, utente_id) values (pg_temp.s(1), pg_temp.p(2)), (pg_temp.s(1), pg_temp.p(3));
insert into public.moderatori (persona) values (pg_temp.p(9));

-- Il telefono non chiama nessuna funzione e non legge il registro.
select pg_temp.come(pg_temp.p(9));
select pg_temp.ok(pg_temp.errore('select * from public.stanze_filo_amministratore(auth.uid(), now())') is not null
  and pg_temp.errore(format('select public.assegna_filo_stanza(auth.uid(), %L, %L, now())', pg_temp.s(1), 'fa1@example.com')) is not null
  and pg_temp.errore(format('select public.togli_filo_stanza(auth.uid(), %L)', pg_temp.s(1))) is not null
  and pg_temp.errore(format('select * from public.vocale_filo_amministratore(auth.uid(), %L, %L)', pg_temp.s(1), 'lunedi')) is not null
  and pg_temp.errore(format('select public.togli_vocale_filo_amministratore(auth.uid(), %L, %L, %L, now())', pg_temp.s(1), 'lunedi', 'x')) is not null
  and pg_temp.errore('select * from public.vocali_filo_tolti') is not null,
  'amministratore filo: il telefono non chiama le funzioni né legge il registro');
reset role;

set local role service_role;
-- Solo l'amministratore.
select pg_temp.ok(pg_temp.errore('select * from public.stanze_filo_amministratore(' || quote_literal(pg_temp.p(4)) || ', now())') = 'non_amministratore'
  and pg_temp.errore(format('select public.assegna_filo_stanza(%L, %L, %L, %L)', pg_temp.p(4), pg_temp.s(1), 'fa1@example.com', '2026-03-30 00:00+00')) = 'non_amministratore'
  and pg_temp.errore(format('select public.togli_filo_stanza(%L, %L)', pg_temp.p(4), pg_temp.s(1))) = 'non_amministratore'
  and pg_temp.errore(format('select * from public.vocale_filo_amministratore(%L, %L, %L)', pg_temp.p(4), pg_temp.s(1), 'lunedi')) = 'non_amministratore'
  and pg_temp.errore(format('select public.togli_vocale_filo_amministratore(%L, %L, %L, %L, now())', pg_temp.p(4), pg_temp.s(1), 'lunedi', 'x')) = 'non_amministratore'
  and pg_temp.errore(format('select * from public.stanze_filo_amministratore(null, now())')) = 'non_amministratore',
  'amministratore filo: chi non è amministratore è rifiutato');

-- Elenco: solo le stanze composte e non chiuse; senza Filo nessun avviso.
select pg_temp.ok((select count(*) from public.stanze_filo_amministratore(pg_temp.p(9), '2026-03-29 22:29+00')) = 0
  and (select count(*) from public.stanze_filo_amministratore(pg_temp.p(9), '2026-03-30 00:00+00')) = 1
  and pg_temp.avviso('2026-03-30 07:00+00') = '-'
  and (select a.filo_nome is null and a.membri = 2 from public.stanze_filo_amministratore(pg_temp.p(9), '2026-03-30 00:00+00') a),
  'amministratore filo: elenco delle stanze composte e aperte, senza Filo nessun avviso');

-- Assegnare: per email (maiuscole e spazi non contano), un membro no, persona o stanza inesistente o chiusa no.
select pg_temp.ok(pg_temp.errore(format('select public.assegna_filo_stanza(%L, %L, %L, %L)', pg_temp.p(9), pg_temp.s(1), 'nessuno@example.com', '2026-03-30 00:00+00')) = 'persona'
  and pg_temp.errore(format('select public.assegna_filo_stanza(%L, %L, %L, %L)', pg_temp.p(9), pg_temp.s(1), 'fa2@example.com', '2026-03-30 00:00+00')) = 'filo_membro'
  and pg_temp.errore(format('select public.assegna_filo_stanza(%L, %L, %L, %L)', pg_temp.p(9), pg_temp.s(2), 'fa1@example.com', '2026-03-30 00:00+00')) = 'stanza'
  and pg_temp.errore(format('select public.assegna_filo_stanza(%L, %L, %L, %L)', pg_temp.p(9), gen_random_uuid(), 'fa1@example.com', '2026-03-30 00:00+00')) = 'stanza'
  and (select count(*) from public.fili_stanza) = 0,
  'amministratore filo: assegnazione rifiutata per persona sconosciuta, membro, stanza chiusa o inesistente');
select public.assegna_filo_stanza(pg_temp.p(9), pg_temp.s(1), '  FA4@Example.com ', '2026-03-30 00:00+00');
select public.assegna_filo_stanza(pg_temp.p(9), pg_temp.s(1), 'fa1@example.com', '2026-03-30 00:05+00');
select pg_temp.ok((select filo from public.fili_stanza where stanza_id = pg_temp.s(1)) = pg_temp.p(1)
  and (select count(*) from public.fili_stanza) = 1
  and (select a.filo_nome = 'Silvia' from public.stanze_filo_amministratore(pg_temp.p(9), '2026-03-30 00:10+00') a),
  'amministratore filo: assegnato per email; riassegnare cambia il Filo (uno per stanza), il pannello ne mostra il nome');

-- Avviso: prima delle 8:45 nessuno; dalle 8:45 alle 13:00 «manca_lunedi»; dopo «senza_lunedi»; col vocale nessuno.
select pg_temp.ok(pg_temp.avviso('2026-03-30 06:44+00') = '-'
  and pg_temp.avviso('2026-03-30 06:45+00') = 'manca_lunedi'
  and pg_temp.avviso('2026-03-30 10:59+00') = 'manca_lunedi'
  and pg_temp.avviso('2026-03-30 11:00+00') = 'senza_lunedi',
  'amministratore filo: avviso se alle 8:45 manca il vocale del lunedì, poi «senza vocale» dalle 13:00');
reset role;
insert into public.vocali_filo (stanza_id, tipo, file, durata, testo, caricato_il) values
  (pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/l1.webm', 70, 'Benvenuti', '2026-03-30 06:50+00');
set local role service_role;
select pg_temp.ok(pg_temp.avviso('2026-03-30 07:00+00') = '-'
  and (select a.vocale_lunedi and not a.vocale_domenica from public.stanze_filo_amministratore(pg_temp.p(9), '2026-03-30 07:00+00') a),
  'amministratore filo: col vocale caricato nessun avviso');

-- Ascoltare: percorso, durata e testo del vocale; niente se manca o il tipo è sbagliato.
select pg_temp.ok((select v.file = pg_temp.s(1) || '/l1.webm' and v.durata = 70 and v.testo = 'Benvenuti'
    from public.vocale_filo_amministratore(pg_temp.p(9), pg_temp.s(1), 'lunedi') v)
  and (select count(*) from public.vocale_filo_amministratore(pg_temp.p(9), pg_temp.s(1), 'domenica')) = 0
  and (select count(*) from public.vocale_filo_amministratore(pg_temp.p(9), pg_temp.s(1), 'x')) = 0,
  'amministratore filo: legge percorso, durata e testo del vocale per ascoltarlo');

-- Togliere: solo se il file è ancora quello ascoltato; resta nel registro; poi il Filo può ricaricarlo fino alle 13.
select pg_temp.ok(public.togli_vocale_filo_amministratore(pg_temp.p(9), pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/altro.webm', '2026-03-30 07:30+00') = false
  and (select count(*) from public.vocali_filo) = 1,
  'amministratore filo: se nel frattempo il vocale è cambiato non si toglie');
-- (Ogni chiamata in un comando a sé: un comando non vede le modifiche fatte da una funzione al suo interno.)
select pg_temp.ok(public.togli_vocale_filo_amministratore(pg_temp.p(9), pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/l1.webm', '2026-03-30 07:30+00') = true,
  'amministratore filo: vocale tolto');
select pg_temp.ok((select count(*) from public.vocali_filo) = 0
  and (select count(*) from public.vocali_filo_tolti t where t.stanza_id = pg_temp.s(1) and t.tipo = 'lunedi'
       and t.tolto_da = pg_temp.p(9) and t.tolto_il = '2026-03-30 07:30+00') = 1,
  'amministratore filo: il vocale non c''è più e la rimozione è nel registro');
select pg_temp.ok(public.togli_vocale_filo_amministratore(pg_temp.p(9), pg_temp.s(1), 'lunedi', pg_temp.s(1) || '/l1.webm', '2026-03-30 07:31+00') = false,
  'amministratore filo: la seconda volta non toglie nulla');
select pg_temp.ok(public.salva_vocale_filo(pg_temp.p(1), pg_temp.s(1), 'lunedi', 'l2.webm', 60, 'Benvenuti di nuovo', '2026-03-30 08:00+00') is null,
  'amministratore filo: dopo la rimozione il Filo ricarica il vocale');
select pg_temp.ok(pg_temp.avviso('2026-03-30 08:00+00') = '-',
  'amministratore filo: dopo la rimozione il Filo può ricaricare il vocale entro le 13:00');

-- Togliere il Filo dalla stanza.
select pg_temp.ok(public.togli_filo_stanza(pg_temp.p(9), pg_temp.s(1)) = true, 'amministratore filo: Filo tolto');
select pg_temp.ok(public.togli_filo_stanza(pg_temp.p(9), pg_temp.s(1)) = false
  and (select count(*) from public.fili_stanza) = 0,
  'amministratore filo: togliere il Filo dalla stanza');
reset role;
rollback;
