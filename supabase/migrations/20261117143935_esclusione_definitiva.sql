-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D32 A, D51 A) · passo 15a della linea «sviluppatore-b».
-- Esclusione definitiva: «account chiuso; l'email non può iscriversi di nuovo». Casi limite: chi ha eliminato
-- l'account con una segnalazione aperta, se serve un'esclusione, resta nella lista «solo con l'impronta, non l'email
-- in chiaro».
--   · l'esclusione decisa da una persona mette l'impronta (sha256 dell'email in minuscolo, senza spazi) nella lista;
--   · finché l'account esiste la persona resta fuori da tutto (sospeso(), già dal passo 12a) e può ancora entrare per
--     leggere il messaggio, fare ricorso ed eliminare l'account, come dice la spec per le sanzioni;
--   · l'iscrizione con un'email della lista si rifiuta nel database (trigger prima dell'inserimento in auth.users):
--     vale per ogni modo di iscriversi, senza configurazioni in più nel pannello di Supabase;
--   · chi elimina l'account con segnalazioni ancora aperte contro di sé lascia l'impronta «in attesa», che entra nella
--     lista solo se arriva l'esclusione e si cancella appena non ci sono più segnalazioni aperte;
--   · un ricorso accolto sull'esclusione toglie l'impronta dalla lista.
-- Scelta tecnica: impronta sha256 senza segreto (un segreto in più andrebbe creato e custodito da Giuseppe); la
-- tabella non è leggibile dal telefono né dal Worker, solo dalle funzioni del database.
-- Solo aggiunte: due tabelle, una funzione di calcolo, cinque trigger. Nessun dato esistente cambia.

create function public.impronta_email(p_email text) returns text
  language sql immutable set search_path = '' as $$
  select case when nullif(btrim(coalesce(p_email, '')), '') is null then null
              else encode(sha256(convert_to(lower(btrim(p_email)), 'UTF8')), 'hex') end
$$;
revoke all on function public.impronta_email(text) from public, anon, authenticated;
grant execute on function public.impronta_email(text) to service_role;

create table public.esclusioni_email (
  impronta text primary key check (impronta ~ '^[0-9a-f]{64}$'),
  -- Nessuna chiave verso auth.users: l'account può non esistere più.
  persona uuid not null,
  sanzione_id uuid not null references public.sanzioni (id),
  aggiunta_il timestamptz not null default now()
);
create index esclusioni_email_sanzione on public.esclusioni_email (sanzione_id);

create table public.impronte_in_attesa (
  persona uuid primary key,
  impronta text not null check (impronta ~ '^[0-9a-f]{64}$'),
  salvata_il timestamptz not null default now()
);

alter table public.esclusioni_email enable row level security;
alter table public.impronte_in_attesa enable row level security;
revoke all on public.esclusioni_email, public.impronte_in_attesa from public, anon, authenticated, service_role;
-- Nessuna regola e nessun permesso: le leggono e scrivono solo le funzioni qui sotto (security definer).

-- Esclusione decisa → impronta nella lista (dall'account se esiste ancora, altrimenti da quella in attesa).
create function public.esclusione_in_lista() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  imp text := (select public.impronta_email(u.email) from auth.users u where u.id = new.persona);
begin
  if imp is null then
    imp := (select a.impronta from public.impronte_in_attesa a where a.persona = new.persona);
  end if;
  if imp is not null then
    insert into public.esclusioni_email (impronta, persona, sanzione_id) values (imp, new.persona, new.id)
      on conflict (impronta) do nothing;
  end if;
  delete from public.impronte_in_attesa where persona = new.persona;
  return null;
end $$;
create trigger esclusione_in_lista after insert on public.sanzioni
  for each row when (new.livello = 'esclusione') execute function public.esclusione_in_lista();

-- Ricorso accolto su un'esclusione → l'impronta esce dalla lista.
create function public.esclusione_annullata() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.esclusioni_email where sanzione_id = new.id;
  return null;
end $$;
create trigger esclusione_annullata after update of annullata_il on public.sanzioni
  for each row when (new.livello = 'esclusione' and old.annullata_il is null and new.annullata_il is not null)
  execute function public.esclusione_annullata();

-- Iscrizione: un'email della lista non entra.
create function public.iscrizione_esclusa() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.esclusioni_email where impronta = public.impronta_email(new.email)) then
    raise exception 'email_esclusa' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger iscrizione_esclusa before insert on auth.users
  for each row execute function public.iscrizione_esclusa();

-- Eliminazione dell'account con segnalazioni aperte contro di sé → impronta in attesa della decisione.
create function public.impronta_se_segnalato() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  imp text := public.impronta_email(old.email);
begin
  if imp is not null and exists (select 1 from public.segnalazioni where contro = old.id and esito is null) then
    insert into public.impronte_in_attesa (persona, impronta) values (old.id, imp)
      on conflict (persona) do update set impronta = excluded.impronta, salvata_il = now();
  end if;
  return old;
end $$;
create trigger impronta_se_segnalato before delete on auth.users
  for each row execute function public.impronta_se_segnalato();

-- Segnalazione chiusa e nessun'altra aperta contro la persona → l'impronta in attesa si cancella.
create function public.impronta_in_attesa_finita() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.segnalazioni where contro = new.contro and esito is null) then
    delete from public.impronte_in_attesa where persona = new.contro;
  end if;
  return null;
end $$;
create trigger impronta_in_attesa_finita after update of esito on public.segnalazioni
  for each row when (new.contro is not null and old.esito is null and new.esito is not null)
  execute function public.impronta_in_attesa_finita();

revoke all on function public.esclusione_in_lista(), public.esclusione_annullata(), public.iscrizione_esclusa(),
  public.impronta_se_segnalato(), public.impronta_in_attesa_finita() from public, anon, authenticated;
