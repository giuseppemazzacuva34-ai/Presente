-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 8a della linea
-- «sviluppatore-c»: i dati della schermata 18 «Il Filo apre la stanza».
--   · filo_benvenuti_visti: chi ha già visto la schermata 18 di quella stanza (una sola volta a settimana per
--     persona). Solo la coppia persona-stanza e l'ora: nessun altro dato. La legge e la scrive solo il server.
--   · filo_stanza_membro: per la persona p_utente all'ora p_ora, la sua stanza aperta (dalle 9:00 di lunedì alla
--     chiusura) SE ha un Filo, con il nome di battesimo del Filo e se la schermata 18 è già stata vista. Nessuna riga:
--     stanza senza Filo (la schermata non compare), persona sospesa o che ha lasciato la stanza, nessuna stanza.
--   · segna_benvenuto_filo: segna la schermata come vista, solo per la propria stanza e nell'orario giusto; due
--     richieste insieme fanno una riga sola.
--   · vocale_filo_membro e porte_stanza_membro: stessa firma e permessi, in più nessun vocale e nessun numero a chi
--     ha lasciato la stanza (#381, lasciate_stanza).
-- Tutto SOLO per il server (chiave del server): il telefono non chiama le funzioni. Solo aggiunte e sostituzioni di
-- funzioni con la stessa firma: niente di distruttivo.

create table public.filo_benvenuti_visti (
  utente_id uuid not null references auth.users (id) on delete cascade,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  visto_il timestamptz not null default now(),
  primary key (utente_id, stanza_id)
);
create index filo_benvenuti_visti_stanza on public.filo_benvenuti_visti (stanza_id);
alter table public.filo_benvenuti_visti enable row level security;
revoke all on public.filo_benvenuti_visti from public, anon, authenticated, service_role;
grant select, insert on public.filo_benvenuti_visti to service_role;

create function public.filo_stanza_membro(p_utente uuid, p_ora timestamptz)
  returns table (stanza_id uuid, filo_nome text, visto boolean)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_utente is null or p_ora is null or public.sospeso(p_utente) then
    return;
  end if;
  return query
    select s.id, (select pr.nome from public.profili pr where pr.id = f.filo),
      exists (select 1 from public.filo_benvenuti_visti b where b.utente_id = p_utente and b.stanza_id = s.id)
    from public.membri_stanza m
      join public.stanze s on s.id = m.stanza_id
      join public.fili_stanza f on f.stanza_id = s.id
    where m.utente_id = p_utente
      and p_ora >= s.apre_il and p_ora < s.chiude_il
      and not public.ha_lasciato(p_utente, s.id)
    order by s.chiude_il
    limit 1;
end $$;
revoke all on function public.filo_stanza_membro(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.filo_stanza_membro(uuid, timestamptz) to service_role;

create function public.segna_benvenuto_filo(p_utente uuid, p_stanza uuid, p_ora timestamptz) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.filo_stanza_membro(p_utente, p_ora) f where f.stanza_id = p_stanza) then
    return false;
  end if;
  insert into public.filo_benvenuti_visti (utente_id, stanza_id) values (p_utente, p_stanza)
    on conflict (utente_id, stanza_id) do nothing;
  return true;
end $$;
revoke all on function public.segna_benvenuto_filo(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.segna_benvenuto_filo(uuid, uuid, timestamptz) to service_role;

-- Come in 20261123185459_filo_ascolto.sql, in più: niente a chi ha lasciato la stanza.
create or replace function public.vocale_filo_membro(p_utente uuid, p_tipo text, p_ora timestamptz)
  returns table (file text, durata smallint, testo text, filo_nome text)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_tipo is null or p_tipo not in ('lunedi', 'domenica') then
    raise exception 'tipo' using errcode = 'check_violation';
  end if;
  if public.sospeso(p_utente) then
    return;
  end if;
  return query
    select v.file, v.durata, v.testo, (select pr.nome from public.profili pr where pr.id = f.filo)
    from public.membri_stanza m
      join public.stanze s on s.id = m.stanza_id
      join public.vocali_filo v on v.stanza_id = s.id and v.tipo = p_tipo
      join public.fili_stanza f on f.stanza_id = s.id
    where m.utente_id = p_utente
      and not public.ha_lasciato(p_utente, s.id)
      and case p_tipo
            when 'lunedi' then p_ora >= s.apre_il and p_ora < s.chiude_il
            else p_ora >= s.chiude_il and p_ora < s.chiude_il + interval '1 day'
          end
    order by s.apre_il desc
    limit 1;
end $$;
revoke all on function public.vocale_filo_membro(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vocale_filo_membro(uuid, text, timestamptz) to service_role;

-- Come in 20261123215547_filo_porte.sql, in più: niente a chi ha lasciato la stanza.
create or replace function public.porte_stanza_membro(p_utente uuid, p_ora timestamptz)
  returns table (stanza_id uuid, porte integer)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if public.sospeso(p_utente) then
    return;
  end if;
  return query
    select s.id, sp.porte_aperte
    from public.membri_stanza m
      join public.stanze s on s.id = m.stanza_id
      join public.fili_stanza f on f.stanza_id = s.id
      join public.serate_porte sp on sp.stanza_id = s.id
    where m.utente_id = p_utente
      and not public.ha_lasciato(p_utente, s.id)
      and p_ora >= s.chiude_il and p_ora < s.chiude_il + interval '1 day'
    order by s.chiude_il desc
    limit 1;
end $$;
revoke all on function public.porte_stanza_membro(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.porte_stanza_membro(uuid, timestamptz) to service_role;
