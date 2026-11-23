-- Test dei vocali del Filo (issue #360, spec v1 + v1.1 del CPO, D151 A), passo 2 della linea «sviluppatore-c».
-- Si esegue con scripts/test_supabase.sh, su un Postgres di prova. Dati inventati, orologio finto (p_ora).
-- Spec: lunedì 10-90 s, si rifà fino alle 8:45, un vocale in ritardo si accetta fino alle 13:00, dopo no;
-- domenica 10-60 s, da sabato 9:00 a domenica 20:00 (anche la notte del cambio d'ora); «Testo del vocale»
-- obbligatorio (max 900); solo il Filo della stanza; il telefono non legge e non carica nulla.
-- Stanze della settimana del cambio d'ora (domenica 29/3/2026): apertura lunedì 23/3 9:00 CET = 08:00 UTC,
-- chiusura domenica 29/3 21:00 CEST = 19:00 UTC. Lunedì 8:45 = 07:45 UTC, 13:00 = 12:00 UTC; sabato 9:00 CET =
-- 08:00 UTC; domenica 20:00 CEST = 18:00 UTC.
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
-- Il codice dell'errore (null = nessun errore).
create function pg_temp.errore(comando text) returns text language plpgsql as $$
begin
  execute comando;
  return null;
exception when others then
  return sqlerrm;
end $$;
create function pg_temp.p(n integer) returns uuid language sql immutable as $$
  select ('f2f2f2f2-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;
create function pg_temp.s(n integer) returns uuid language sql immutable as $$
  select ('f2f2f2f2-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;
-- Carica come server: true se accettato.
create function pg_temp.carica(filo integer, stanza integer, tipo text, durata integer, testo text, ora text)
  returns text language plpgsql as $$
begin
  return pg_temp.errore(format('select public.salva_vocale_filo(%L, %L, %L, %L, %s, %L, %L)', pg_temp.p(filo),
    pg_temp.s(stanza), tipo, gen_random_uuid()::text || '.webm', durata, testo, ora::timestamptz));
end $$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'fv' || n || '@example.com' from generate_series(1, 2) n;
insert into public.stanze (id, tipo, citta, apre_il, chiude_il, creata_il)
  select pg_temp.s(n), 'citta', 'Milano', '2026-03-23 08:00+00', '2026-03-29 19:00+00', '2026-03-22 23:30+00'
  from generate_series(1, 3) n;
insert into public.fili_stanza (stanza_id, filo) select pg_temp.s(n), pg_temp.p(1) from generate_series(1, 3) n;

-- Il telefono non legge la tabella, non chiama la funzione e non carica file nel contenitore dei vocali.
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok(pg_temp.errore($$select * from public.vocali_filo$$) is not null
  and pg_temp.errore(format('select public.salva_vocale_filo(%L, %L, %L, %L, 30, %L, now())', pg_temp.p(1), pg_temp.s(1),
      'lunedi', 'x.webm', 'Ciao')) is not null
  and pg_temp.errore(format($q$insert into storage.objects (bucket_id, name, owner) values ('vocali_filo', %L, %L)$q$,
      pg_temp.s(1) || '/x.webm', pg_temp.p(1))) is not null,
  'vocali filo: il telefono non legge, non chiama la funzione e non carica file');
reset role;
select pg_temp.ok((select not public from storage.buckets where id = 'vocali_filo'), 'vocali filo: contenitore privato');

set local role service_role;
select pg_temp.ok(pg_temp.carica(2, 1, 'lunedi', 30, 'Ciao', '2026-03-23 07:00+00') like '%non_filo%',
  'vocali filo: solo il Filo della stanza carica');
select pg_temp.ok(pg_temp.carica(1, 1, 'lunedi', 9, 'Ciao', '2026-03-23 07:00+00') like '%durata%'
  and pg_temp.carica(1, 1, 'lunedi', 91, 'Ciao', '2026-03-23 07:00+00') like '%durata%',
  'vocali filo: lunedì sotto i 10 o sopra i 90 secondi rifiutato');
select pg_temp.ok(pg_temp.carica(1, 1, 'lunedi', 30, '  ', '2026-03-23 07:00+00') like '%testo%'
  and pg_temp.carica(1, 1, 'lunedi', 30, repeat('a', 901), '2026-03-23 07:00+00') like '%testo%',
  'vocali filo: senza «Testo del vocale» (o oltre 900 caratteri) rifiutato');
select pg_temp.ok(pg_temp.carica(1, 1, 'lunedi', 90, 'Ciao a tutti', '2026-03-22 23:45+00') is null
  and pg_temp.carica(1, 1, 'lunedi', 10, 'Ciao di nuovo', '2026-03-23 07:44+00') is null,
  'vocali filo: lunedì si carica dopo la composizione e si rifà fino alle 8:45');
-- In un comando a parte: la sottoquery verrebbe letta prima dei caricamenti.
select pg_temp.ok((select durata from public.vocali_filo where stanza_id = pg_temp.s(1) and tipo = 'lunedi') = 10,
  'vocali filo: resta l''ultimo vocale rifatto');
select pg_temp.ok(pg_temp.carica(1, 1, 'lunedi', 30, 'Troppo tardi', '2026-03-23 07:46+00') like '%fuori_orario%',
  'vocali filo: dopo le 8:45 il vocale del lunedì non si cambia');
select pg_temp.ok(pg_temp.carica(1, 2, 'lunedi', 30, 'In ritardo', '2026-03-23 11:59+00') is null,
  'vocali filo: un vocale mancante si carica in ritardo fino alle 13:00');
select pg_temp.ok(pg_temp.carica(1, 2, 'lunedi', 30, 'Rifatto', '2026-03-23 12:00+00') like '%fuori_orario%'
  and pg_temp.carica(1, 3, 'lunedi', 30, 'Dopo le 13', '2026-03-23 12:01+00') like '%fuori_orario%',
  'vocali filo: dopo le 13:00 il vocale del lunedì non si carica');
select pg_temp.ok(pg_temp.carica(1, 1, 'domenica', 30, 'A stasera', '2026-03-28 07:59+00') like '%fuori_orario%',
  'vocali filo: la domenica non si carica prima di sabato alle 9:00');
select pg_temp.ok(pg_temp.carica(1, 1, 'domenica', 61, 'A stasera', '2026-03-28 08:00+00') like '%durata%',
  'vocali filo: domenica sopra i 60 secondi rifiutato');
select pg_temp.ok(pg_temp.carica(1, 1, 'domenica', 60, 'A stasera', '2026-03-28 08:00+00') is null
  and pg_temp.carica(1, 1, 'domenica', 20, 'A tra poco', '2026-03-29 17:59+00') is null,
  'vocali filo: domenica da sabato 9:00 a domenica 20:00, rifacibile (notte del cambio d''ora)');
select pg_temp.ok(pg_temp.carica(1, 1, 'domenica', 20, 'Tardi', '2026-03-29 18:00+00') like '%fuori_orario%',
  'vocali filo: dopo le 20:00 di domenica il vocale non si carica');
-- Rifare restituisce il file vecchio, da cancellare dal contenitore.
select pg_temp.ok(public.salva_vocale_filo(pg_temp.p(1), pg_temp.s(1), 'domenica', 'nuovo.webm', 20, 'Ultimo',
  '2026-03-29 17:00+00') is not null
  and public.salva_vocale_filo(pg_temp.p(1), pg_temp.s(1), 'domenica', 'nuovissimo.webm', 20, 'Ultimo',
  '2026-03-29 17:01+00') = pg_temp.s(1) || '/nuovo.webm',
  'vocali filo: rifare restituisce il file da cancellare');
reset role;
rollback;
