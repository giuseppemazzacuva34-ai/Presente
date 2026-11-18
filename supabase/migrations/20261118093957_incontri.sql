-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D12 A, D17 A, D18 A, D20 A, D32 A) · passo 2a della linea «sviluppatore-b».
-- L'incontro dopo il doppio sì, nel database. Una riga per porta (un solo incontro per porta, spec «Regole»):
-- scadenza, stato, proposta in corso (giorno e ora, locale o luogo scritto), controproposte, ritardo, check-in, segnale,
-- esito. Le regole (orari ammessi, disdetta, finestra del check-in, esito) restano in api/incontro.js: qui lo schema,
-- i vincoli che valgono anche scrivendo direttamente nel database, e apri_incontro (la scadenza la calcola il server).
-- Nessuna posizione GPS (spec, «Cosa NON fa»). Lo legge e lo scrive SOLO il server (ruolo di servizio), mai il telefono.
-- Crediti della buca (D12 A): i 10 di chi manca sono già bloccati come caparra; a chi ha aspettato tornano i suoi 10
-- (caparra_restituita) più 7 (buca_ricevuta, nuovo tipo del registro); i 3 di Presente non sono di una persona e stanno
-- nell'incontro (crediti_presente). 10 + 7 + 3 = le due caparre: nessun credito si crea o si perde.
-- Valori uguali a api/incontro.js: test/incontri_database.test.mjs li confronta.

create table public.incontri (
  porta_id uuid primary key references public.porte (id) on delete cascade,
  creato_il timestamptz not null default now(),
  scadenza timestamptz not null, -- doppio sì + 10 giorni (stessa area) o + 30 (aree diverse), in ora di Roma
  stato text not null default 'da_fissare' check (stato in ('da_fissare', 'proposto', 'confermato', 'concluso')),
  -- Proposta in corso o confermata: giorno e ora, e un locale consigliato oppure un altro luogo pubblico scritto.
  orario timestamptz,
  locale text check (char_length(locale) between 1 and 80), -- id del locale consigliato (lista dei locali pilota)
  luogo_libero text check (char_length(luogo_libero) between 1 and 80), -- «Un altro luogo pubblico»: nome e indirizzo
  proposto_da uuid references auth.users (id) on delete set null,
  proposto_il timestamptz,
  controproposte smallint not null default 0 check (controproposte between 0 and 3),
  confermato_il timestamptz,
  -- «Arrivo in ritardo»: 0, 15 o 30 minuti, una volta sola.
  ritardo_minuti smallint not null default 0 check (ritardo_minuti in (0, 15, 30)),
  ritardo_di uuid references auth.users (id) on delete set null,
  -- «Sono qui»: solo l'orario, mai la posizione.
  checkin_a_il timestamptz,
  checkin_b_il timestamptz,
  segnale text check (char_length(segnale) between 1 and 40), -- la parola uguale sui due telefoni
  esito text check (esito in ('avvenuto', 'buca_a', 'buca_b', 'disdetto', 'scaduto', 'nessun_checkin',
                              'contestato', 'in_revisione', 'annullato')),
  esito_il timestamptz,
  crediti_presente smallint not null default 0, -- i 3 crediti di Presente, solo con una buca
  constraint un_solo_luogo check (locale is null or luogo_libero is null),
  constraint proposta_completa check (stato = 'da_fissare' or (orario is not null and (locale is not null or luogo_libero is not null))),
  constraint esito_con_orario check ((esito is null) = (esito_il is null)),
  -- Il segnale compare solo dopo il check-in di entrambi (criterio di accettazione).
  constraint segnale_dopo_due_checkin check (segnale is null or (checkin_a_il is not null and checkin_b_il is not null)),
  -- Buca: sempre 3 crediti a Presente; in tutti gli altri casi nessuno.
  constraint buca_a_presente check (
    (esito in ('buca_a', 'buca_b') and crediti_presente = 3) or (esito is distinct from 'buca_a' and esito is distinct from 'buca_b' and crediti_presente = 0))
);
create index incontri_da_chiudere on public.incontri (scadenza) where esito is null;

alter table public.incontri enable row level security;
revoke all on public.incontri from public, anon, authenticated;
grant select, insert, update, delete on public.incontri to service_role;
-- Nessuna regola per authenticated: il telefono riceve l'incontro solo dal Worker.

-- Registro dei crediti (#65, linea «sviluppatore»): si aggiunge solo il tipo «buca_ricevuta» (+7, legato alla porta,
-- una volta per porta). I tipi di prima restano identici.
alter table public.crediti_movimenti drop constraint crediti_movimenti_tipo_check;
alter table public.crediti_movimenti add constraint crediti_movimenti_tipo_check
  check (tipo in ('assegnati_beta', 'caparra_bloccata', 'caparra_restituita', 'stanza', 'buca_ricevuta'));
alter table public.crediti_movimenti drop constraint importi_previsti;
alter table public.crediti_movimenti add constraint importi_previsti check (
  (tipo = 'assegnati_beta' and crediti between 1 and 500 and porta_id is null)
  or (tipo = 'caparra_bloccata' and crediti = -10 and porta_id is not null)
  or (tipo = 'caparra_restituita' and crediti = 10 and porta_id is not null)
  or (tipo = 'stanza' and crediti = -9 and porta_id is null)
  or (tipo = 'buca_ricevuta' and crediti = 7 and porta_id is not null));
create unique index crediti_una_buca on public.crediti_movimenti (porta_id) where tipo = 'buca_ricevuta';

-- Dopo il doppio sì: crea l'incontro della porta (se non c'è) e ne restituisce la scadenza; null senza doppio sì.
-- Stessa area = le due province hanno la stessa area (D121 A); l'estero non ha area, quindi vale come area diversa.
-- La scadenza è alla stessa ora di Roma del doppio sì, anche a cavallo del cambio d'ora.
create function public.apri_incontro(p_porta uuid) returns timestamptz
  language plpgsql security definer set search_path = '' as $$
declare
  v_doppio_si timestamptz;
  v_stessa_area boolean;
  v_scadenza timestamptz;
begin
  select s.esito_il into v_doppio_si from public.svelamenti s where s.porta_id = p_porta and s.esito = 'doppio_si';
  if v_doppio_si is null then
    return null;
  end if;
  select coalesce(public.area_di(pa.provincia) = public.area_di(pb.provincia), false) into v_stessa_area
    from public.porte p
    left join public.profili pa on pa.id = p.a
    left join public.profili pb on pb.id = p.b
    where p.id = p_porta;
  v_scadenza := ((v_doppio_si at time zone 'Europe/Rome')
    + case when v_stessa_area then interval '10 days' else interval '30 days' end) at time zone 'Europe/Rome';
  insert into public.incontri (porta_id, scadenza) values (p_porta, v_scadenza) on conflict (porta_id) do nothing;
  return (select i.scadenza from public.incontri i where i.porta_id = p_porta);
end $$;

revoke all on function public.apri_incontro(uuid) from public, anon, authenticated;
grant execute on function public.apri_incontro(uuid) to service_role;
