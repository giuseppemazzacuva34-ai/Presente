-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 1 della linea
-- «sviluppatore-c»: il ruolo «filo» nel database.
--   · fili_stanza: quale Filo segue quale stanza (al massimo uno per stanza; un Filo può seguirne più d'una).
--     La riga la aggiunge l'amministratore a mano dal pannello di Supabase (nessun dato reale nel repository).
--     Il Filo NON è un membro: non chiama, non ha chiavi, non paga, non compare nel cerchio.
--   · stanze_del_filo / nomi_stanza_filo: il Filo legge SOLO, per le sue stanze, il nome di battesimo dei membri,
--     già dalla composizione (lunedì 00:30, D151 A) e fino alla chiusura. Mai email, telefono, provincia, età, foto,
--     voce, questionario, diario, chiavi, segnalazioni, Coin. Chi è sospeso o uscito dalla stanza (sospeso() vero)
--     sparisce dai nomi.
-- Tutto SOLO per il server (Worker con la chiave del server): il telefono non legge l'elenco e non chiama le funzioni.
-- Solo aggiunte: una tabella, un trigger, due funzioni. Nessun nome nei log.

create table public.fili_stanza (
  stanza_id uuid primary key references public.stanze (id) on delete cascade,
  filo uuid not null references auth.users (id) on delete cascade,
  assegnato_il timestamptz not null default now()
);
create index fili_stanza_filo on public.fili_stanza (filo);

alter table public.fili_stanza enable row level security;
revoke all on public.fili_stanza from public, anon, authenticated, service_role;
grant select on public.fili_stanza to service_role;
-- Nessuna regola per authenticated: il telefono non sa chi è il Filo di quale stanza.

-- Un membro della stanza non può esserne il Filo.
create function public.controlla_filo_stanza() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.membri_stanza m where m.stanza_id = new.stanza_id and m.utente_id = new.filo) then
    raise exception 'filo_membro' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.controlla_filo_stanza() from public, anon, authenticated;
create trigger controlla_filo_stanza before insert or update on public.fili_stanza
  for each row execute function public.controlla_filo_stanza();

-- Le stanze che il Filo segue, composte e non ancora chiuse all'ora p_ora (anche prima dell'apertura delle 9:00).
create function public.stanze_del_filo(p_filo uuid, p_ora timestamptz)
  returns table (id uuid, nome text, apre_il timestamptz, chiude_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select s.id, s.nome, s.apre_il, s.chiude_il
  from public.fili_stanza f join public.stanze s on s.id = f.stanza_id
  where f.filo = p_filo and p_ora < s.chiude_il
  order by s.apre_il, s.id
$$;
revoke all on function public.stanze_del_filo(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.stanze_del_filo(uuid, timestamptz) to service_role;

-- I nomi di battesimo dei membri di una stanza del Filo (in ordine alfabetico). Errore se non è il suo Filo o se la
-- stanza è chiusa all'ora p_ora.
create function public.nomi_stanza_filo(p_filo uuid, p_stanza uuid, p_ora timestamptz)
  returns table (nome text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.stanze_del_filo(p_filo, p_ora) s where s.id = p_stanza) then
    raise exception 'non_filo' using errcode = 'insufficient_privilege';
  end if;
  return query
    select pr.nome from public.membri_stanza m join public.profili pr on pr.id = m.utente_id
    where m.stanza_id = p_stanza and pr.nome is not null and not public.sospeso(m.utente_id)
    order by pr.nome;
end $$;
revoke all on function public.nomi_stanza_filo(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.nomi_stanza_filo(uuid, uuid, timestamptz) to service_role;
