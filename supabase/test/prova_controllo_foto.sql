-- Test della soglia «foto non sue» (issue #6, spec v1 del CPO del 3/11, «Casi limite»; D51 A; v1.3: un «No»
-- accolto non conta). Due «No» a «le foto erano sue?» da persone diverse, visibili (regola alla cieca) e non accolti
-- → controllo: la persona non entra in nuove stanze finché un moderatore non segna la foto scattata nell'app come
-- verificata; ha 7 giorni per farla (scadenza mostrata). I «No» prima della verifica non contano più.
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
  ('5a5a5a5a-0000-4000-8000-00000000005a', 'fa@example.com'), ('5b5b5b5b-0000-4000-8000-00000000005b', 'fb@example.com'),
  ('5c5c5c5c-0000-4000-8000-00000000005c', 'fc@example.com'), ('5d5d5d5d-0000-4000-8000-00000000005d', 'fd@example.com'),
  ('5e5e5e5e-0000-4000-8000-00000000005e', 'fe@example.com');
insert into public.moderatori (persona) values ('5e5e5e5e-0000-4000-8000-00000000005e');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('5f5f5f5f-0000-4000-8000-00000000005f', 'italia', now() - interval '720 hours', now() - interval '552 hours');
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select ('5f5f5f5f-1111-4000-8000-0000000000' || s)::uuid, '5f5f5f5f-0000-4000-8000-00000000005f',
         '5a5a5a5a-0000-4000-8000-00000000005a', b, now() - interval '30 days'
  from (values ('5b', '5b5b5b5b-0000-4000-8000-00000000005b'::uuid), ('5c', '5c5c5c5c-0000-4000-8000-00000000005c'),
               ('5d', '5d5d5d5d-0000-4000-8000-00000000005d')) v(s, b);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, checkin_a_il, checkin_b_il, esito, esito_il)
  select ('5f5f5f5f-1111-4000-8000-0000000000' || s)::uuid, now(), 'concluso', now() - quando, 'Bar della piazza',
         now() - quando, now() - quando, 'avvenuto', now() - quando
  from (values ('5b', interval '3 days'), ('5c', interval '2 days'), ('5d', interval '1 day')) v(s, quando);

set local role service_role;
create temp table c (chi text, j jsonb) on commit drop;
select pg_temp.ok(public.controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a') = '{"attivo": false}'::jsonb,
  'nessun «No»: nessun controllo');

-- Bea dice «foto non sue» e Anna ha già risposto su Bea: il «No» è visibile. Uno solo non basta.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('5f5f5f5f-1111-4000-8000-00000000005b', '5b5b5b5b-0000-4000-8000-00000000005b', '5a5a5a5a-0000-4000-8000-00000000005a', 'si', 'no', 'si', true, now() - interval '3 days'),
  ('5f5f5f5f-1111-4000-8000-00000000005b', '5a5a5a5a-0000-4000-8000-00000000005a', '5b5b5b5b-0000-4000-8000-00000000005b', 'si', 'si', 'si', true, now() - interval '3 days');
select pg_temp.ok((public.controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a'))->>'attivo' = 'false', 'un solo «No»: nessun controllo');

-- Carlo dice «foto non sue» ma Anna non ha ancora risposto e non sono passati 7 giorni: il «No» non è visibile.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('5f5f5f5f-1111-4000-8000-00000000005c', '5c5c5c5c-0000-4000-8000-00000000005c', '5a5a5a5a-0000-4000-8000-00000000005a', 'si', 'no', 'si', true, now() - interval '2 days');
select pg_temp.ok((public.controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a'))->>'attivo' = 'false',
  'secondo «No» non ancora visibile (alla cieca): nessun controllo');

-- Anna risponde su Carlo: ora i «No» visibili sono due, da persone diverse.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('5f5f5f5f-1111-4000-8000-00000000005c', '5a5a5a5a-0000-4000-8000-00000000005a', '5c5c5c5c-0000-4000-8000-00000000005c', 'si', 'si', 'si', true, now() - interval '1 hour');
insert into c select 'due', public.controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a');
select pg_temp.ok((select (j->>'attivo')::boolean from c where chi = 'due'), 'due «No» visibili da persone diverse: controllo attivo');
select pg_temp.ok((select (j->>'scade_il')::timestamptz between now() + interval '7 days' - interval '2 hours' and now() + interval '7 days'
  from c where chi = 'due'), 'scadenza: 7 giorni da quando il secondo «No» è visibile');
select pg_temp.ok((select (select array_agg(k order by k) from jsonb_object_keys(j) k) = array['attivo', 'scade_il'] from c where chi = 'due'),
  'il controllo dice solo «attivo» e la scadenza: mai chi, mai quale incontro');
select pg_temp.ok(public.in_controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a'), 'in_controllo_foto: sì');
select pg_temp.ok(not public.in_controllo_foto('5b5b5b5b-0000-4000-8000-00000000005b'), 'chi non ha «No»: no');

-- Non entra in nuove stanze: niente conferma nuova (dal telefono) e fuori dalle righe del lunedì.
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub": "5a5a5a5a-0000-4000-8000-00000000005a", "role": "authenticated"}';
select pg_temp.ok(pg_temp.rifiutato('insert into public.conferme_stanza default values'), 'in controllo: «Ci sarò lunedì» rifiutato');
set local request.jwt.claims to '{"sub": "5b5b5b5b-0000-4000-8000-00000000005b", "role": "authenticated"}';
select pg_temp.ok(not pg_temp.rifiutato('insert into public.conferme_stanza default values'), 'chi non è in controllo conferma come sempre');
select pg_temp.ok(pg_temp.rifiutato('select public.controllo_foto(''5a5a5a5a-0000-4000-8000-00000000005a'')'), 'il telefono non legge il controllo di altri');
select pg_temp.ok(pg_temp.rifiutato('select public.verifica_foto(''5e5e5e5e-0000-4000-8000-00000000005e'', ''5a5a5a5a-0000-4000-8000-00000000005a'')'),
  'il telefono non chiude controlli');
reset role;
-- Una conferma fatta prima del controllo non porta Anna nella stanza: righe_settimana la salta.
alter table public.conferme_stanza disable trigger user;
insert into public.conferme_stanza (utente_id, apre_il) values ('5a5a5a5a-0000-4000-8000-00000000005a', public.prossima_apertura(now() + interval '9 hours'))
  on conflict do nothing;
alter table public.conferme_stanza enable trigger user;
set local role service_role;
insert into c select 'righe', public.righe_settimana(public.prossima_apertura(now() + interval '9 hours'));
select pg_temp.ok((select j->'iscrizioni' ? '5b5b5b5b-0000-4000-8000-00000000005b' from c where chi = 'righe'), 'righe del lunedì: Bea c''è');
select pg_temp.ok((select not (j->'iscrizioni' ? '5a5a5a5a-0000-4000-8000-00000000005a')
  and j->'righe' @? '$[*] ? (@.profilo.id == "5a5a5a5a-0000-4000-8000-00000000005a")' is not true from c where chi = 'righe'),
  'righe del lunedì: Anna in controllo non c''è (né in righe né in iscrizioni)');

-- Verifica: solo un moderatore, mai su sé stesso; dopo, i «No» vecchi non contano più.
select pg_temp.ok(public.verifica_foto('5b5b5b5b-0000-4000-8000-00000000005b', '5a5a5a5a-0000-4000-8000-00000000005a') = 'non_moderatore',
  'verifica: solo un moderatore');
select pg_temp.ok(public.verifica_foto('5e5e5e5e-0000-4000-8000-00000000005e', '5e5e5e5e-0000-4000-8000-00000000005e') = 'nessun_controllo',
  'verifica di chi non è in controllo: niente da fare');
select pg_temp.ok(public.verifica_foto('5e5e5e5e-0000-4000-8000-00000000005e', '5a5a5a5a-0000-4000-8000-00000000005a') = 'verificata',
  'verifica del moderatore: fatta');
select pg_temp.ok(not public.in_controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a'), 'dopo la verifica: non più in controllo');
select pg_temp.ok(public.verifica_foto('5e5e5e5e-0000-4000-8000-00000000005e', '5a5a5a5a-0000-4000-8000-00000000005a') = 'nessun_controllo',
  'seconda verifica: niente da fare');

-- Un «No» nuovo dopo la verifica (Dino, visibile) da solo non basta: si conta da capo.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('5f5f5f5f-1111-4000-8000-00000000005d', '5d5d5d5d-0000-4000-8000-00000000005d', '5a5a5a5a-0000-4000-8000-00000000005a', 'si', 'no', 'si', true, now()),
  ('5f5f5f5f-1111-4000-8000-00000000005d', '5a5a5a5a-0000-4000-8000-00000000005a', '5d5d5d5d-0000-4000-8000-00000000005d', 'si', 'si', 'si', true, now());
select pg_temp.ok(not public.in_controllo_foto('5a5a5a5a-0000-4000-8000-00000000005a'), 'dopo la verifica un «No» nuovo da solo non basta');
rollback;

-- Contestazione accolta (v1.3): quel «No» esce dalla soglia.
begin;
insert into auth.users (id, email) values
  ('6a6a6a6a-0000-4000-8000-00000000006a', 'ga@example.com'), ('6b6b6b6b-0000-4000-8000-00000000006b', 'gb@example.com'),
  ('6c6c6c6c-0000-4000-8000-00000000006c', 'gc@example.com');
insert into public.stanze (id, tipo, apre_il, chiude_il) values
  ('6f6f6f6f-0000-4000-8000-00000000006f', 'italia', now() - interval '720 hours', now() - interval '552 hours');
insert into public.porte (id, stanza_id, a, b, aperta_il)
  select ('6f6f6f6f-1111-4000-8000-0000000000' || s)::uuid, '6f6f6f6f-0000-4000-8000-00000000006f',
         '6a6a6a6a-0000-4000-8000-00000000006a', b, now() - interval '30 days'
  from (values ('6b', '6b6b6b6b-0000-4000-8000-00000000006b'::uuid), ('6c', '6c6c6c6c-0000-4000-8000-00000000006c')) v(s, b);
insert into public.incontri (porta_id, scadenza, stato, orario, luogo_libero, checkin_a_il, checkin_b_il, esito, esito_il)
  select ('6f6f6f6f-1111-4000-8000-0000000000' || s)::uuid, now(), 'concluso', now() - interval '10 days', 'Bar',
         now() - interval '10 days', now() - interval '10 days', 'avvenuto', now() - interval '10 days'
  from (values ('6b'), ('6c')) v(s);
-- Oltre 7 giorni dall'incontro: i «No» sono visibili anche senza la risposta di Gaia.
insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro, creato_il) values
  ('6f6f6f6f-1111-4000-8000-00000000006b', '6b6b6b6b-0000-4000-8000-00000000006b', '6a6a6a6a-0000-4000-8000-00000000006a', 'si', 'no', 'si', true, now() - interval '10 days'),
  ('6f6f6f6f-1111-4000-8000-00000000006c', '6c6c6c6c-0000-4000-8000-00000000006c', '6a6a6a6a-0000-4000-8000-00000000006a', 'si', 'no', 'si', true, now() - interval '10 days');
set local role service_role;
select pg_temp.ok(public.in_controllo_foto('6a6a6a6a-0000-4000-8000-00000000006a'), 'due «No» visibili dopo 7 giorni: in controllo');
select pg_temp.ok(public.contesta_no('6a6a6a6a-0000-4000-8000-00000000006a', 'foto_sue', 'Le foto sono mie, davvero.') = 'inviata', 'Gaia contesta');
select pg_temp.ok(public.in_controllo_foto('6a6a6a6a-0000-4000-8000-00000000006a'), 'contestazione in attesa: il controllo resta');
update public.contestazioni_no set stato = 'accolta', deciso_il = now() where persona = '6a6a6a6a-0000-4000-8000-00000000006a';
select pg_temp.ok(not public.in_controllo_foto('6a6a6a6a-0000-4000-8000-00000000006a'), 'contestazione accolta: quei «No» non contano, niente controllo');
rollback;

-- Tabella solo per il server.
select pg_temp.ok((select relrowsecurity from pg_class where oid = 'public.verifiche_foto'::regclass), 'verifiche_foto: regole per riga attive');
select pg_temp.ok(not has_table_privilege('authenticated', 'public.verifiche_foto', 'select')
  and not has_table_privilege('anon', 'public.verifiche_foto', 'select'), 'verifiche_foto: il telefono non la legge');
