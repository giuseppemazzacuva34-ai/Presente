-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 10a della linea
-- «sviluppatore-c»: i dati della voce «Il vocale del Filo» nella stanza.
--   · filo_vocali_ascoltati: chi ha già ascoltato il vocale del lunedì della sua stanza (per spegnere il pallino rosso).
--     Solo la coppia persona-stanza e l'ora del primo ascolto: nessun altro dato, nessuna durata, nessuna analisi.
--     La legge e la scrive solo il server.
--   · vocale_filo_stato: per la persona p_utente all'ora p_ora, la stanza il cui vocale del lunedì può riascoltare
--     (stesse regole di vocale_filo_membro: dalle 9:00 di lunedì alla chiusura, niente a sospesi e a chi ha lasciato
--     la stanza) e «nuovo» = pallino rosso: il vocale non è ancora stato ascoltato e non c'era quando la persona ha
--     visto la schermata 18 (è arrivato dopo, entro le 13:00, oppure la schermata non è ancora stata vista).
--     Nessuna riga: stanza senza Filo, vocale mai caricato, fuori orario.
--   · segna_ascolto_filo: segna il primo ascolto, solo per la propria stanza, con il vocale presente e nell'orario
--     giusto; due richieste insieme fanno una riga sola.
-- Tutto SOLO per il server (chiave del server): il telefono non chiama le funzioni. Solo aggiunte.

create table public.filo_vocali_ascoltati (
  utente_id uuid not null references auth.users (id) on delete cascade,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  ascoltato_il timestamptz not null default now(),
  primary key (utente_id, stanza_id)
);
create index filo_vocali_ascoltati_stanza on public.filo_vocali_ascoltati (stanza_id);
alter table public.filo_vocali_ascoltati enable row level security;
revoke all on public.filo_vocali_ascoltati from public, anon, authenticated, service_role;
grant select, insert on public.filo_vocali_ascoltati to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

create function public.vocale_filo_stato(p_utente uuid, p_ora timestamptz)
  returns table (stanza_id uuid, nuovo boolean)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if p_utente is null or p_ora is null or public.sospeso(p_utente) then
    return;
  end if;
  return query
    select s.id,
      not exists (select 1 from public.filo_vocali_ascoltati a where a.utente_id = p_utente and a.stanza_id = s.id)
      and not exists (select 1 from public.filo_benvenuti_visti b
                      where b.utente_id = p_utente and b.stanza_id = s.id and b.visto_il >= v.caricato_il)
    from public.membri_stanza m
      join public.stanze s on s.id = m.stanza_id
      join public.fili_stanza f on f.stanza_id = s.id
      join public.vocali_filo v on v.stanza_id = s.id and v.tipo = 'lunedi'
    where m.utente_id = p_utente
      and not public.ha_lasciato(p_utente, s.id)
      and p_ora >= s.apre_il and p_ora < s.chiude_il
      and p_ora >= v.caricato_il
    order by s.chiude_il
    limit 1;
end $$;
revoke all on function public.vocale_filo_stato(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.vocale_filo_stato(uuid, timestamptz) to service_role;

create function public.segna_ascolto_filo(p_utente uuid, p_stanza uuid, p_ora timestamptz) returns boolean
  language plpgsql volatile security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.vocale_filo_stato(p_utente, p_ora) v where v.stanza_id = p_stanza) then
    return false;
  end if;
  insert into public.filo_vocali_ascoltati (utente_id, stanza_id) values (p_utente, p_stanza)
    on conflict (utente_id, stanza_id) do nothing;
  return true;
end $$;
revoke all on function public.segna_ascolto_filo(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.segna_ascolto_filo(uuid, uuid, timestamptz) to service_role;
