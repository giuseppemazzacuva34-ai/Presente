-- Fase 2 · issue #3 · conferma d'ingresso alla stanza («Entra nella stanza», spec v1 del CPO).
-- Si entra nella stanza del lunedì solo con la conferma data entro domenica 23:59 (ora di Roma).
-- Settimana e ora della conferma le scrive il server, mai il telefono. Una conferma a settimana.
-- Prima della scadenza ci si può ripensare (cancellando la conferma); dopo no. Nessun credito si scala qui:
-- i crediti (prima stanza gratis, poi 9) li conta il lavoro del lunedì solo se la stanza si forma (D18).

create table public.conferme_stanza (
  utente_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  apre_il timestamptz not null, -- lunedì 9:00 di Roma della stanza a cui si vuole entrare
  confermata_il timestamptz not null default now(),
  primary key (utente_id, apre_il)
);

-- Le conferme chiudono domenica 23:59 di Roma, cioè 9 ore prima dell'apertura (lunedì 9:00; il cambio d'ora cade
-- sempre la domenica notte, prima della mezzanotte successiva, quindi lunedì 0:00 → 9:00 sono sempre 9 ore vere).
-- Dopo la scadenza la conferma vale per il lunedì dopo.
create function public.conferme_stanza_dal_server() returns trigger
  language plpgsql set search_path = '' as $$
begin
  new.apre_il := public.prossima_apertura(now() + interval '9 hours');
  new.confermata_il := now();
  return new;
end $$;
revoke all on function public.conferme_stanza_dal_server() from public, anon, authenticated;
create trigger conferme_stanza_dal_server before insert on public.conferme_stanza
  for each row execute function public.conferme_stanza_dal_server();

alter table public.conferme_stanza enable row level security;
revoke all on public.conferme_stanza from anon, authenticated;
grant select, insert, delete on public.conferme_stanza to authenticated;

create policy "conferme: ognuno vede solo le sue" on public.conferme_stanza for select to authenticated
  using (utente_id = auth.uid());
create policy "conferme: ognuno conferma solo per sé" on public.conferme_stanza for insert to authenticated
  with check (utente_id = auth.uid());
create policy "conferme: ritiro solo prima di domenica 23:59" on public.conferme_stanza for delete to authenticated
  using (utente_id = auth.uid() and apre_il - interval '9 hours' > now());
