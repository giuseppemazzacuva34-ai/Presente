-- Test del messaggio a chi riceve una sanzione e del ricorso (issue #7, spec v1.1 definitiva, punti 7 e 8; D51 A).
-- Linea «sviluppatore-b», passo 12b. Si esegue dopo regole_per_riga.sql con scripts/test_supabase.sh. Dati inventati.
-- Spec: messaggio in app con livello, regola violata, data di fine e «Contesta»; mai il nome di chi ha segnalato.
-- Ricorso: «Perché pensi che sia sbagliata?» (max 2000 caratteri), una sola volta, entro 14 giorni; risposta entro
-- 7 giorni (14 per l'esclusione). Durante il ricorso la sanzione resta attiva. Lo decide una persona (in beta Giuseppe).
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
  select ('a7a7a7a7-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid
$$;

begin;
insert into auth.users (id, email) select pg_temp.p(n), 'ric' || n || '@example.com' from generate_series(1, 9) n;
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(2), 'soldi', 'scheda', 'racconto segreto', false) as s1 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s1', 'sospensione_7', 'soldi', 'chiedeva regali') as z1 \gset
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(3), 'profilo_falso', 'scheda', null, false) as s2 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s2', 'esclusione', 'identita', 'foto non sue') as z2 \gset
reset role;

-- 1. Il messaggio: solo le proprie sanzioni, con livello, regola, fine, «Contesta» fino a quando; mai chi ha segnalato.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok((select count(*) from public.mie_sanzioni()) = 1
  and (select livello = 'sospensione_7' and regola = 'soldi' and fine_il is not null
       and ricorso_entro - decisa_il = interval '14 days' and contestabile and ricorso_stato is null
       from public.mie_sanzioni()), 'sanzione: messaggio con livello, regola, fine e «Contesta» entro 14 giorni');
reset role;
select pg_temp.ok((select pg_get_function_result(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'mie_sanzioni')
  = 'TABLE(id uuid, livello text, regola text, decisa_il timestamp with time zone, fine_il timestamp with time zone, ricorso_entro timestamp with time zone, contestabile boolean, ricorso_stato text, risposta_entro timestamp with time zone)',
  'sanzione: il messaggio non contiene mai chi ha segnalato, il racconto o il motivo interno');
select pg_temp.come(pg_temp.p(1));
select pg_temp.ok((select count(*) from public.mie_sanzioni()) = 0, 'sanzione: chi ha segnalato non vede la sanzione dell''altro');
select pg_temp.ok(pg_temp.rifiutato($$select * from public.ricorsi$$), 'ricorso: il telefono non legge la tabella dei ricorsi');
-- Non si contesta la sanzione di un altro.
select pg_temp.ok(pg_temp.rifiutato(format($$select public.nuovo_ricorso(%L, 'non è giusto')$$, :'z1')),
  'ricorso: non si contesta la sanzione di un altro');
reset role;

-- 2. Il ricorso: testo obbligatorio, max 2000 caratteri, una sola volta.
select pg_temp.come(pg_temp.p(2));
select pg_temp.ok(pg_temp.rifiutato(format($$select public.nuovo_ricorso(%L, '   ')$$, :'z1')), 'ricorso: serve il perché');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.nuovo_ricorso(%L, %L)$$, :'z1', repeat('a', 2001))), 'ricorso: massimo 2000 caratteri');
select public.nuovo_ricorso(:'z1', 'Ho solo chiesto un caffè.');
select pg_temp.ok((select ricorso_stato = 'in_attesa' and not contestabile and risposta_entro is not null from public.mie_sanzioni()),
  'ricorso: inviato, in attesa, «Contesta» sparisce');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.nuovo_ricorso(%L, 'di nuovo')$$, :'z1')), 'ricorso: una sola volta');
reset role;
select pg_temp.ok((select risposta_entro - inviato_il = interval '7 days' from public.ricorsi where sanzione_id = :'z1'),
  'ricorso: risposta entro 7 giorni');
select pg_temp.ok(public.sospeso(pg_temp.p(2)), 'ricorso: durante il ricorso la sanzione resta attiva');

-- 3. Esclusione: risposta entro 14 giorni; la persona esclusa può ancora contestare.
select pg_temp.come(pg_temp.p(3));
select public.nuovo_ricorso(:'z2', 'Le foto sono mie.');
reset role;
select pg_temp.ok((select risposta_entro - inviato_il = interval '14 days' from public.ricorsi where sanzione_id = :'z2'),
  'ricorso: per l''esclusione risposta entro 14 giorni');

-- 4. Oltre i 14 giorni non si contesta più.
set local role service_role;
select public.nuova_segnalazione(pg_temp.p(1), pg_temp.p(4), 'insulti', 'scheda', null, false) as s3 \gset
select public.decidi_segnalazione(pg_temp.p(9), :'s3', 'avviso', 'rispetto', 'insulti') as z3 \gset
reset role;
update public.sanzioni set decisa_il = now() - interval '15 days' where id = :'z3';
select pg_temp.come(pg_temp.p(4));
select pg_temp.ok((select not contestabile from public.mie_sanzioni()), 'ricorso: dopo 14 giorni «Contesta» non c''è più');
select pg_temp.ok(pg_temp.rifiutato(format($$select public.nuovo_ricorso(%L, 'tardi')$$, :'z3')), 'ricorso: dopo 14 giorni rifiutato');
reset role;
rollback;
