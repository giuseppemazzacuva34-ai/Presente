-- Fase 2 · issue #4 spec v1.3 § 3 (CPO, 13/11) · passo 3c-4a: «La richiameresti?» dopo la chiamata.
-- Una risposta per persona e per chiamata: sì, no o salta. Nessun testo libero, nessun nome.
-- La scrive e la legge SOLO il server (ruolo di servizio): serve ai suggerimenti di chi chiamare (#3) e non la vedono mai
-- l'altra persona, il telefono o il pannello delle segnalazioni (#7). Si cancella alla chiusura della stanza.
-- Regola uguale a api/dopo_chiamata.js: la domanda c'è solo dopo una chiamata ≥ 60 s chiusa per tempo o con «Chiudi».

create table public.richiameresti (
  utente_id uuid not null references auth.users (id) on delete cascade,
  chiamata_chi uuid not null,
  chiamata_inizio timestamptz not null,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  risposta text check (risposta in ('si', 'no', 'salta')), -- vuota = domanda riproposta al rientro, ancora senza risposta
  riproposta boolean not null default false,
  aggiornata_il timestamptz not null default now(),
  primary key (utente_id, chiamata_chi, chiamata_inizio),
  foreign key (chiamata_chi, chiamata_inizio) references public.chiamate (chi, inizio) on delete cascade
);
create index richiameresti_stanza on public.richiameresti (stanza_id);

alter table public.richiameresti enable row level security;
revoke all on public.richiameresti from public, anon, authenticated;
grant select, insert, update, delete on public.richiameresti to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- La stanza aperta adesso in cui p_utente e l'altra persona erano insieme quando è iniziata la chiamata.
create function public.stanza_della_chiamata(p_utente uuid, p_altra uuid, p_inizio timestamptz) returns uuid
  language sql stable security definer set search_path = '' as $$
  select s.id from public.stanze s
  join public.membri_stanza io on io.stanza_id = s.id and io.utente_id = p_utente
  join public.membri_stanza lei on lei.stanza_id = s.id and lei.utente_id = p_altra
  where p_inizio >= s.apre_il and p_inizio < s.chiude_il and now() < s.chiude_il
  limit 1
$$;
revoke all on function public.stanza_della_chiamata(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.stanza_della_chiamata(uuid, uuid, timestamptz) to service_role;

-- Salva la risposta. true = salvata; false = niente da salvare (non c'era, chiamata breve o caduta, stanza chiusa,
-- risposta già data). Una risposta già data non si cambia.
create function public.salva_richiameresti(p_utente uuid, p_chi uuid, p_inizio timestamptz, p_risposta text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  c public.chiamate;
  altra uuid;
  stanza uuid;
  n integer;
begin
  if p_risposta is null or p_risposta not in ('si', 'no', 'salta') then
    raise exception 'Risposta non valida.' using errcode = 'check_violation';
  end if;
  select * into c from public.chiamate where chi = p_chi and inizio = p_inizio;
  if not found or p_utente not in (c.chi, c.con) then return false; end if;
  if c.durata is null or c.durata < 60 or c.esito not in ('tempo_scaduto', 'chiusa') then return false; end if;
  altra := case when p_utente = c.chi then c.con else c.chi end;
  stanza := public.stanza_della_chiamata(p_utente, altra, c.inizio);
  if stanza is null then return false; end if;
  insert into public.richiameresti (utente_id, chiamata_chi, chiamata_inizio, stanza_id, risposta)
    values (p_utente, c.chi, c.inizio, stanza, p_risposta)
    on conflict (utente_id, chiamata_chi, chiamata_inizio) do update
      set risposta = excluded.risposta, aggiornata_il = now()
      where public.richiameresti.risposta is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.salva_richiameresti(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.salva_richiameresti(uuid, uuid, timestamptz, text) to service_role;

-- App chiusa durante la schermata: al rientro, nella settimana della stanza, la domanda torna UNA volta sola.
-- Restituisce l'ultima chiamata che conta senza risposta (al massimo una) e la segna come riproposta.
create function public.richiameresti_da_riproporre(p_utente uuid)
  returns table (chi uuid, con uuid, inizio timestamptz)
  language plpgsql security definer set search_path = '' as $$
declare
  c public.chiamate;
  stanza uuid;
begin
  for c in
    select k.* from public.chiamate k
    where (k.chi = p_utente or k.con = p_utente) and k.durata >= 60 and k.esito in ('tempo_scaduto', 'chiusa')
      and not exists (select 1 from public.richiameresti r
                      where r.utente_id = p_utente and r.chiamata_chi = k.chi and r.chiamata_inizio = k.inizio)
    order by k.inizio desc
  loop
    stanza := public.stanza_della_chiamata(p_utente, case when p_utente = c.chi then c.con else c.chi end, c.inizio);
    if stanza is not null then
      insert into public.richiameresti (utente_id, chiamata_chi, chiamata_inizio, stanza_id, risposta, riproposta)
        values (p_utente, c.chi, c.inizio, stanza, null, true);
      chi := c.chi; con := c.con; inizio := c.inizio;
      return next;
      return;
    end if;
  end loop;
end $$;
revoke all on function public.richiameresti_da_riproporre(uuid) from public, anon, authenticated;
grant execute on function public.richiameresti_da_riproporre(uuid) to service_role;

-- Pulizia delle stanze chiuse: carte viste (spec v1.2) e risposte «La richiameresti?» (spec v1.3).
-- La chiama il lavoro del lunedì (scripts/lavoro_lunedi.mjs) prima di formare le stanze nuove. Solo numeri in uscita.
create function public.pulisci_stanze_chiuse() returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  carte integer;
  risposte integer;
begin
  carte := public.pulisci_carte_viste();
  delete from public.richiameresti r using public.stanze s where s.id = r.stanza_id and s.chiude_il <= now();
  get diagnostics risposte = row_count;
  return jsonb_build_object('carte_viste', carte, 'richiameresti', risposte);
end $$;
revoke all on function public.pulisci_stanze_chiuse() from public, anon, authenticated;
grant execute on function public.pulisci_stanze_chiuse() to service_role;
