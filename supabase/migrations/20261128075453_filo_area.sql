-- Fase 2 · issue #360 «Il Filo della stanza», spec v1.2 del CPO (25/11) · linea «sviluppatore-c»: il Filo per area.
--   · fili_area: quale Filo segue un'area (una città o la Stanza Italia). Un Filo per area; un Filo può seguirne più d'una.
--   · Alla composizione del lunedì ogni stanza nuova riceve il Filo della sua area (trigger dopo l'inserimento in
--     stanze): due stanze di Milano composte lo stesso lunedì hanno lo stesso Filo. Area senza Filo = stanza senza Filo
--     (la schermata 18 non compare, come oggi).
--   · Il cambio su una sola stanza resta assegna_filo_stanza (vale solo per quella settimana): il lunedì dopo la stanza
--     nuova riprende il Filo dell'area.
--   · Se il Filo dell'area entra come membro in una stanza della sua area, di quella stanza non è il Filo (un membro non
--     può esserlo): la riga automatica si toglie e la composizione non si blocca.
--   · fili_aree_amministratore / assegna_filo_area / togli_filo_area: per il pannello dell'amministratore (moderatori),
--     il Filo indicato con l'email dell'account (l'email non torna indietro né va nei log).
-- Nessuna rotazione tra più Fili; il Filo non vede diari, chiavi né «chi vuoi incontrare» (nessuna lettura nuova).
-- Tutto SOLO per il server (chiave del server). Solo aggiunte: una tabella, due trigger, tre funzioni; ogni delete ha
-- il filtro. scrivi_settimana non cambia.

create table public.fili_area (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('italia', 'citta')),
  citta text check (char_length(citta) between 1 and 80),
  filo uuid not null references auth.users (id) on delete cascade,
  assegnato_da uuid not null,
  assegnato_il timestamptz not null,
  constraint citta_solo_per_le_citta check ((tipo = 'citta') = (citta is not null))
);
create unique index fili_area_una_per_area on public.fili_area (tipo, lower(coalesce(citta, '')));
create index fili_area_filo on public.fili_area (filo);

alter table public.fili_area enable row level security;
revoke all on public.fili_area from public, anon, authenticated, service_role;
grant select on public.fili_area to service_role;
-- Nessuna regola per authenticated: il telefono non sa chi è il Filo di quale area.

-- Stanza nuova → il Filo della sua area, se c'è (una riga già presente per la stanza non si tocca).
create function public.filo_dell_area_stanza() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  insert into public.fili_stanza (stanza_id, filo, assegnato_il)
    select new.id, a.filo, new.creata_il from public.fili_area a
    where a.tipo = new.tipo and lower(coalesce(a.citta, '')) = lower(btrim(coalesce(new.citta, '')))
    on conflict (stanza_id) do nothing;
  return null;
end $$;
revoke all on function public.filo_dell_area_stanza() from public, anon, authenticated;
create trigger filo_dell_area_stanza after insert on public.stanze
  for each row execute function public.filo_dell_area_stanza();

-- Chi entra come membro non è il Filo di quella stanza.
create function public.membro_non_filo() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.fili_stanza f where f.stanza_id = new.stanza_id and f.filo = new.utente_id;
  return null;
end $$;
revoke all on function public.membro_non_filo() from public, anon, authenticated;
create trigger membro_non_filo after insert on public.membri_stanza
  for each row execute function public.membro_non_filo();

-- Le aree con un Filo, con il nome di battesimo del Filo (mai l'email).
create function public.fili_aree_amministratore(p_amministratore uuid)
  returns table (tipo text, citta text, filo_nome text, assegnato_il timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.tipo, a.citta, coalesce((select pr.nome from public.profili pr where pr.id = a.filo), ''), a.assegnato_il
    from public.fili_area a
    order by a.tipo desc, lower(a.citta);
end $$;
revoke all on function public.fili_aree_amministratore(uuid) from public, anon, authenticated;
grant execute on function public.fili_aree_amministratore(uuid) to service_role;

create function public.assegna_filo_area(p_amministratore uuid, p_tipo text, p_citta text, p_email text,
                                         p_ora timestamptz) returns void
  language plpgsql volatile security definer set search_path = '' as $$
declare
  persona uuid;
  nome_citta text := nullif(btrim(coalesce(p_citta, '')), '');
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  if p_ora is null or p_tipo is null or p_tipo not in ('italia', 'citta')
     or (p_tipo = 'citta' and (nome_citta is null or char_length(nome_citta) > 80))
     or (p_tipo = 'italia' and nome_citta is not null) then
    raise exception 'area' using errcode = 'check_violation';
  end if;
  select u.id into persona from auth.users u where lower(u.email) = lower(btrim(coalesce(p_email, ''))) limit 1;
  if persona is null then
    raise exception 'persona' using errcode = 'check_violation';
  end if;
  insert into public.fili_area (tipo, citta, filo, assegnato_da, assegnato_il)
    values (p_tipo, nome_citta, persona, p_amministratore, p_ora)
    on conflict (tipo, lower(coalesce(citta, ''))) do update
      set filo = excluded.filo, assegnato_da = excluded.assegnato_da, assegnato_il = excluded.assegnato_il;
end $$;
revoke all on function public.assegna_filo_area(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.assegna_filo_area(uuid, text, text, text, timestamptz) to service_role;

-- Toglie il Filo dall'area: le stanze già composte lo tengono, le prossime no.
create function public.togli_filo_area(p_amministratore uuid, p_tipo text, p_citta text) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
declare
  tolti integer;
begin
  if not public.e_moderatore(p_amministratore) then
    raise exception 'non_amministratore' using errcode = 'insufficient_privilege';
  end if;
  delete from public.fili_area a
    where a.tipo = p_tipo and lower(coalesce(a.citta, '')) = lower(btrim(coalesce(p_citta, '')));
  get diagnostics tolti = row_count;
  return tolti > 0;
end $$;
revoke all on function public.togli_filo_area(uuid, text, text) from public, anon, authenticated;
grant execute on function public.togli_filo_area(uuid, text, text) to service_role;
