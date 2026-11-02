-- Fase 2 · issue #3 · stanze della settimana (specifica v1 e v1.1 del CPO), secondo passo: le tabelle.
-- Le stanze le crea solo il lavoro del lunedì (ruolo di servizio, mai il telefono). Ogni persona vede solo
-- la propria stanza; dei compagni vede solo nome, età e città, attraverso la funzione compagni_di_stanza().
-- Mai data di nascita, filtri, questionario, affinità o foto degli altri.

create table public.stanze (
  id uuid primary key default gen_random_uuid(),
  -- 'italia' = Stanza Italia; 'citta' = stanza di una città aperta (a 36 profili completi, D19)
  tipo text not null check (tipo in ('italia', 'citta')),
  citta text check (char_length(citta) between 1 and 80),
  nome text check (char_length(nome) between 1 and 60), -- facoltativo (D44 B), es. «La stanza di Silvia · Milano»
  apre_il timestamptz not null,
  chiude_il timestamptz not null,
  creata_il timestamptz not null default now(),
  constraint citta_solo_per_le_citta check ((tipo = 'citta') = (citta is not null)),
  constraint durata_di_una_settimana check (chiude_il > apre_il and chiude_il - apre_il <= interval '7 days')
);

create table public.membri_stanza (
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  utente_id uuid not null references auth.users (id) on delete cascade,
  gratis boolean not null default false, -- prima stanza gratis, poi 9 crediti (D18)
  entrato_il timestamptz not null default now(),
  primary key (stanza_id, utente_id)
);
create index membri_stanza_utente on public.membri_stanza (utente_id);

-- Requisito 2 del CISO: nessuno entra in una stanza senza data di nascita (e quindi maggiorenne, vedi profili).
-- Massimo 12 persone a stanza; una persona sta in una sola stanza per settimana.
create function public.controlla_membro_stanza() returns trigger
  language plpgsql set search_path = '' as $$
declare
  stanza public.stanze%rowtype;
begin
  if not exists (select 1 from public.profili p where p.id = new.utente_id and p.data_nascita is not null) then
    raise exception 'Nessuna stanza senza data di nascita.' using errcode = 'check_violation';
  end if;
  select * into stanza from public.stanze s where s.id = new.stanza_id;
  if (select count(*) from public.membri_stanza m where m.stanza_id = new.stanza_id) >= 12 then
    raise exception 'La stanza è piena (12 persone).' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.membri_stanza m join public.stanze s on s.id = m.stanza_id
             where m.utente_id = new.utente_id and s.apre_il < stanza.chiude_il and s.chiude_il > stanza.apre_il) then
    raise exception 'Una sola stanza alla volta.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger controlla_membro_stanza before insert on public.membri_stanza
  for each row execute function public.controlla_membro_stanza();

-- Regole per riga: il telefono legge soltanto. Scrive solo il ruolo di servizio (lavoro del lunedì).
alter table public.stanze enable row level security;
alter table public.membri_stanza enable row level security;
revoke all on public.stanze, public.membri_stanza from anon, authenticated;
grant select on public.stanze, public.membri_stanza to authenticated;

create policy "membri: ognuno vede solo la propria riga" on public.membri_stanza for select to authenticated
  using (utente_id = auth.uid());
create policy "stanze: solo quelle di cui fai parte" on public.stanze for select to authenticated
  using (exists (select 1 from public.membri_stanza m where m.stanza_id = stanze.id and m.utente_id = auth.uid()));

-- Compagni della stanza aperta adesso: solo nome, età (anni compiuti) e città. Chi chiede deve essere nella stanza.
create function public.compagni_di_stanza()
  returns table (utente_id uuid, nome text, eta integer, citta text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, extract(year from age(current_date, p.data_nascita))::integer, p.citta
  from public.membri_stanza io
  join public.stanze s on s.id = io.stanza_id and now() >= s.apre_il and now() < s.chiude_il
  join public.membri_stanza altri on altri.stanza_id = io.stanza_id and altri.utente_id <> io.utente_id
  join public.profili p on p.id = altri.utente_id
  where io.utente_id = auth.uid()
$$;
revoke all on function public.compagni_di_stanza() from public, anon;
grant execute on function public.compagni_di_stanza() to authenticated;
