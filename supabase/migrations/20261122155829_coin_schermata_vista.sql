-- Fase 2 · issue #331 spec v1 (CPO, 21/11), parte B.5 · linea «sviluppatore-c» (passo 6b).
-- La schermata «I tuoi Coin» si mostra da sola solo al primo ingresso: qui il server ricorda chi l'ha già vista.
-- Solo una data per persona, nessun altro dato. Nessun algoritmo la legge. Solo il server (service_role) legge e
-- scrive; il telefono non vede né la tabella né le funzioni. Nessun SQL distruttivo: una tabella nuova, vuota.

create table public.coin_schermate_viste (
  persona uuid primary key references auth.users (id) on delete cascade,
  vista_il timestamptz not null default now()
);
alter table public.coin_schermate_viste enable row level security;
revoke all on table public.coin_schermate_viste from public, anon, authenticated;
grant select, insert on table public.coin_schermate_viste to service_role;

create function public.coin_schermata_vista(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(exists (select 1 from public.coin_schermate_viste v where v.persona = p_persona), false)
$$;
revoke all on function public.coin_schermata_vista(uuid) from public, anon, authenticated;
grant execute on function public.coin_schermata_vista(uuid) to service_role;

create function public.segna_coin_schermata_vista(p_persona uuid) returns void
  language sql security definer set search_path = '' as $$
  insert into public.coin_schermate_viste (persona) values (p_persona) on conflict (persona) do nothing
$$;
revoke all on function public.segna_coin_schermata_vista(uuid) from public, anon, authenticated;
grant execute on function public.segna_coin_schermata_vista(uuid) to service_role;
