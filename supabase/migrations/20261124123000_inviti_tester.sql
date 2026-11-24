-- Codici d'invito del test interno (issue #8, spec v1 del CPO del 6/11; D154 = B, deciso da Giuseppe il 24/11).
-- Linea «sviluppatore» (a), passo 1. I 20 tester entrano con un link personale: il codice si usa una sola volta e
-- scade il 29/11 alle 23:59 ora di Roma.
--   · Si salva solo l'impronta SHA-256 del codice (64 caratteri esadecimali), mai il codice.
--   · Tutto solo dal server (service_role): nessuna regola per riga apre la tabella al browser.
--   · Uso in due tempi, così senza codice valido non nasce un account: riserva_invito_tester (atomica, una volta sola)
--     → il Worker crea l'account → conferma_invito_tester lega l'invito all'account. Se l'account non nasce,
--     rilascia_invito_tester rende di nuovo usabile il codice.
--   · Se la persona cancella l'account il legame sparisce (on delete set null); l'invito resta usato.
--   · conteggio_inviti_tester: solo numeri (creati, usati, scaduti) per i report.

create table public.inviti_tester (
  impronta text primary key check (impronta ~ '^[0-9a-f]{64}$'),
  creato timestamptz not null default now(),
  scade timestamptz not null default '2026-11-29 22:59:59.999+00',
  usato timestamptz,
  utente uuid unique references auth.users (id) on delete set null,
  constraint legato_solo_se_usato check (utente is null or usato is not null)
);
alter table public.inviti_tester enable row level security;
revoke all on table public.inviti_tester from public, anon, authenticated;
grant select, update on public.inviti_tester to service_role;

create function public.crea_inviti_tester(p_impronte text[]) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  nuovi integer;
begin
  insert into public.inviti_tester (impronta) select distinct unnest(p_impronte) on conflict (impronta) do nothing;
  get diagnostics nuovi = row_count;
  return nuovi;
end $$;

create function public.riserva_invito_tester(p_impronta text) returns boolean
  language plpgsql security definer set search_path = '' as $$
begin
  update public.inviti_tester set usato = now()
  where impronta = p_impronta and usato is null and scade > now();
  return found;
end $$;

create function public.conferma_invito_tester(p_impronta text, p_utente uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
begin
  update public.inviti_tester set utente = p_utente
  where impronta = p_impronta and usato is not null and utente is null;
  return found;
end $$;

create function public.rilascia_invito_tester(p_impronta text) returns boolean
  language plpgsql security definer set search_path = '' as $$
begin
  update public.inviti_tester set usato = null
  where impronta = p_impronta and usato is not null and utente is null;
  return found;
end $$;

create function public.conteggio_inviti_tester() returns table (creati integer, usati integer, scaduti integer)
  language sql stable security definer set search_path = '' as $$
  select count(*)::integer,
         count(*) filter (where utente is not null or (usato is not null and usato < now() - interval '1 hour'))::integer,
         count(*) filter (where usato is null and scade <= now())::integer
  from public.inviti_tester
$$;

revoke all on function public.crea_inviti_tester(text[]) from public, anon, authenticated;
revoke all on function public.riserva_invito_tester(text) from public, anon, authenticated;
revoke all on function public.conferma_invito_tester(text, uuid) from public, anon, authenticated;
revoke all on function public.rilascia_invito_tester(text) from public, anon, authenticated;
revoke all on function public.conteggio_inviti_tester() from public, anon, authenticated;
grant execute on function public.crea_inviti_tester(text[]) to service_role;
grant execute on function public.riserva_invito_tester(text) to service_role;
grant execute on function public.conferma_invito_tester(text, uuid) to service_role;
grant execute on function public.rilascia_invito_tester(text) to service_role;
grant execute on function public.conteggio_inviti_tester() to service_role;
