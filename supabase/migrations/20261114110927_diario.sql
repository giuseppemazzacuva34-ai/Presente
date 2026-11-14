-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D51 A) · linea «sviluppatore-c», passo 6: il diario privato.
-- «Lo leggi solo tu. Non lo usiamo per niente.» Tabella separata: la legge e la scrive SOLO chi l'ha scritta, dal
-- proprio telefono, con il proprio token (regole per riga). Nessun permesso al ruolo di servizio: suggerimenti,
-- composizione delle stanze, supporto e pannello di amministrazione non possono leggerla. Nessuna funzione del
-- database la legge (il test lo controlla).
-- Una nota per chiamata e per persona, solo dopo una chiamata che conta (>= 60 s, #4), anche dopo le 21:00.
-- Si conserva finché l'utente non la cancella o elimina l'account (D51 A): nessuna cancellazione automatica.
-- Se l'altra persona elimina l'account, la nota resta a chi l'ha scritta, senza l'id di chi se n'è andato.

-- Durata di una chiamata tra chi chiede (dal token) e un'altra persona, iniziata in quell'istante; null se non c'è.
-- Serve solo al controllo qui sotto: legge le chiamate, mai il diario.
create function public.durata_chiamata_mia(p_con uuid, p_inizio timestamptz) returns integer
  language sql stable security definer set search_path = '' as $$
  select k.durata from public.chiamate k
  where k.inizio = p_inizio
    and ((k.chi = auth.uid() and k.con = p_con) or (k.chi = p_con and k.con = auth.uid()))
  limit 1
$$;
revoke all on function public.durata_chiamata_mia(uuid, timestamptz) from public, anon;
grant execute on function public.durata_chiamata_mia(uuid, timestamptz) to authenticated;

create table public.diario (
  utente_id uuid not null default auth.uid() references auth.users (id) on delete cascade, -- chi scrive
  con uuid references auth.users (id) on delete set null, -- con chi era la chiamata
  chiamata_il timestamptz not null, -- inizio della chiamata (data mostrata negli appunti)
  durata integer not null check (durata between 60 and 900), -- secondi, dalla chiamata vera
  testo text not null check (char_length(testo) between 1 and 1000 and btrim(testo) <> ''),
  scritta_il timestamptz not null default now(),
  primary key (utente_id, chiamata_il)
);

alter table public.diario enable row level security;
revoke all on public.diario from public, anon, authenticated, service_role;
grant select, insert, delete on public.diario to authenticated;
grant update (testo) on public.diario to authenticated;

create policy diario_leggi on public.diario for select to authenticated
  using (utente_id = (select auth.uid()));
create policy diario_scrivi on public.diario for insert to authenticated
  with check (utente_id = (select auth.uid()) and con is not null and durata >= 60
              and durata = public.durata_chiamata_mia(con, chiamata_il));
create policy diario_modifica on public.diario for update to authenticated
  using (utente_id = (select auth.uid())) with check (utente_id = (select auth.uid()));
create policy diario_cancella on public.diario for delete to authenticated
  using (utente_id = (select auth.uid()));
