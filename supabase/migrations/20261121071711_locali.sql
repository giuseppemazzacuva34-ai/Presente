-- Fase 2 · issue #6 · spec v1.1 del CPO (20/11), punto 1. Linea «sviluppatore-b», passo 2s.
-- Tabella dei locali consigliati, VUOTA: nel test interno (30/11–6/12) si propone solo «Un altro luogo pubblico»
-- (D143 chiesta a Giuseppe). Più avanti l'app mostrerà fino a 3 locali con stato «visitato» nella provincia (o nelle
-- due province) dell'incontro. Nessun dato personale. Chi usa l'app legge solo i locali «visitato»; scrive solo il
-- server (service_role), mai il telefono. Solo aggiunte.
create table public.locali (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (char_length(nome) between 2 and 80),
  indirizzo text not null check (char_length(indirizzo) between 4 and 120),
  provincia text not null references public.province (sigla),
  area text not null references public.aree (codice), -- come api/aree.js: deve essere l'area della provincia
  tipo text not null check (tipo in ('bar', 'wine bar', 'caffè', 'bistrot', 'cocktail bar', 'enoteca')),
  fascia text check (char_length(fascia) between 1 and 40), -- testo breve, per esempio «fino a 10 €»
  stato text not null default 'da_visitare' check (stato in ('da_visitare', 'visitato', 'escluso')),
  creato_il timestamptz not null default now()
);
-- Le letture dell'app sono «visitato» in una provincia.
create index locali_provincia_visitati on public.locali (provincia) where stato = 'visitato';

-- L'area è sempre quella della provincia (se manca la mette il database).
create function public.locali_area_della_provincia() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_area text;
begin
  select area into v_area from public.province where sigla = new.provincia;
  if new.area is null then new.area := v_area; end if;
  if v_area is null or new.area is distinct from v_area then
    raise exception 'L''area non è quella della provincia.' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.locali_area_della_provincia() from public, anon, authenticated;
create trigger locali_area before insert or update of provincia, area on public.locali
  for each row execute function public.locali_area_della_provincia();

alter table public.locali enable row level security;
revoke all on public.locali from anon, authenticated;
grant select on public.locali to authenticated;
grant select, insert, update, delete on public.locali to service_role;
create policy locali_visitati on public.locali for select to authenticated using (stato = 'visitato');
