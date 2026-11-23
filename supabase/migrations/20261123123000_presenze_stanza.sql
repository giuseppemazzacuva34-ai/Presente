-- Fase 2 · issue #380 «Stanza viva e Fissa una chiamata», spec v1 del CPO (23/11, design v4 D149, schermata 19) ·
-- passo 2 della linea CTO: lo stato attuale delle persone nella stanza (online / in chiamata / non in linea).
--   · presenze_stanza: UNA riga per persona e stanza aperta, aggiornata a ogni segnale (ogni 30 s con l'app visibile).
--     Niente storico degli accessi: si tiene solo l'ultimo segnale e, se c'è, con chi si è in chiamata ora.
--     La riga sparisce quando la persona esce dalla stanza (cascata da membri_stanza) e alla chiusura della stanza
--     (pulisci_presenze, chiamata a ogni segnale e dal lavoro del lunedì).
--   · segnala_presenza: il segnale, solo per chi è in una stanza aperta e non è sospeso.
--   · segna_in_chiamata: la mette e la toglie il server (Centralino) quando una chiamata della stanza inizia e finisce.
--     Un «in chiamata» rimasto appeso oltre 16 minuti non vale più (una chiamata dura al massimo 15).
--   · stati_stanza: per chi guarda, le persone della sua stanza aperta, compatibili, senza blocchi, non sospese, con
--     l'ultimo segnale (il Worker lo trasforma in «online» o «non in linea · da …», mai l'ora esatta al telefono) e
--     «in chiamata con» solo se anche l'altra persona è nella stanza di chi guarda e non c'è un blocco con lei.
--     La pausa («Oggi non ricevo chiamate») non si legge qui: non si scopre dallo stato.
-- Tutto SOLO per il server (Worker con la chiave del server): il telefono non legge la tabella e non chiama le
-- funzioni. Nessun nome nei log. Solo aggiunte: una tabella e quattro funzioni.

create table public.presenze_stanza (
  stanza_id uuid not null,
  utente_id uuid not null,
  ultimo_segnale timestamptz,
  in_chiamata_con uuid,
  in_chiamata_dal timestamptz,
  primary key (stanza_id, utente_id),
  foreign key (stanza_id, utente_id) references public.membri_stanza (stanza_id, utente_id) on delete cascade,
  constraint mai_con_se_stessi check (in_chiamata_con is null or in_chiamata_con <> utente_id),
  constraint chiamata_con_ora check ((in_chiamata_con is null) = (in_chiamata_dal is null))
);

alter table public.presenze_stanza enable row level security;
revoke all on public.presenze_stanza from public, anon, authenticated, service_role;
-- Nessuna regola e nessun permesso: si passa solo dalle funzioni qui sotto.

-- Pulizia: cancella tutto ciò che riguarda stanze già chiuse. Restituisce quante righe ha tolto.
create function public.pulisci_presenze() returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  tolte integer;
begin
  delete from public.presenze_stanza p using public.stanze s where s.id = p.stanza_id and now() >= s.chiude_il;
  get diagnostics tolte = row_count;
  return tolte;
end $$;
revoke all on function public.pulisci_presenze() from public, anon, authenticated;
grant execute on function public.pulisci_presenze() to service_role;

-- Il segnale dell'app aperta e visibile. Falso se la persona non è in una stanza aperta o è sospesa.
create function public.segnala_presenza(p_persona uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
begin
  perform public.pulisci_presenze();
  if p_persona is null or public.sospeso(p_persona) then return false; end if;
  s := public.stanza_aperta_di(p_persona);
  if s.id is null then return false; end if;
  insert into public.presenze_stanza (stanza_id, utente_id, ultimo_segnale) values (s.id, p_persona, now())
    on conflict (stanza_id, utente_id) do update set ultimo_segnale = excluded.ultimo_segnale;
  return true;
end $$;
revoke all on function public.segnala_presenza(uuid) from public, anon, authenticated;
grant execute on function public.segnala_presenza(uuid) to service_role;

-- Inizio (p_inizio vero) o fine di una chiamata tra due persone della stessa stanza aperta.
create function public.segna_in_chiamata(p_chi uuid, p_con uuid, p_inizio boolean) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
begin
  if p_chi is null or p_con is null or p_chi = p_con or p_inizio is null then return false; end if;
  s := public.stanza_aperta_di(p_chi);
  if s.id is null or not exists (select 1 from public.membri_stanza m where m.stanza_id = s.id and m.utente_id = p_con)
  then return false; end if;
  if p_inizio then
    insert into public.presenze_stanza (stanza_id, utente_id, ultimo_segnale, in_chiamata_con, in_chiamata_dal)
      values (s.id, p_chi, now(), p_con, now()), (s.id, p_con, now(), p_chi, now())
      on conflict (stanza_id, utente_id) do update
        set ultimo_segnale = excluded.ultimo_segnale, in_chiamata_con = excluded.in_chiamata_con,
            in_chiamata_dal = excluded.in_chiamata_dal;
  else
    update public.presenze_stanza p set in_chiamata_con = null, in_chiamata_dal = null
      where p.stanza_id = s.id and ((p.utente_id = p_chi and p.in_chiamata_con = p_con)
                                 or (p.utente_id = p_con and p.in_chiamata_con = p_chi));
  end if;
  return true;
end $$;
revoke all on function public.segna_in_chiamata(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.segna_in_chiamata(uuid, uuid, boolean) to service_role;

-- Lo stato delle persone della stanza aperta di p_persona, come le vede lei.
create function public.stati_stanza(p_persona uuid)
  returns table (utente_id uuid, ultimo_segnale timestamptz, in_chiamata boolean, in_chiamata_con uuid)
  language sql stable security definer set search_path = '' as $$
  with s as (select * from public.stanza_aperta_di(p_persona)),
  visibili as (
    select m.utente_id from s join public.membri_stanza m on m.stanza_id = s.id
    where m.utente_id <> p_persona and public.compatibili_tra(p_persona, m.utente_id)
      and not public.bloccati_tra(p_persona, m.utente_id) and not public.sospeso(m.utente_id)
  )
  select v.utente_id, p.ultimo_segnale,
         coalesce(p.in_chiamata_con is not null and p.in_chiamata_dal > now() - interval '16 minutes', false),
         case when p.in_chiamata_dal > now() - interval '16 minutes'
                   and exists (select 1 from visibili w where w.utente_id = p.in_chiamata_con)
              then p.in_chiamata_con end
  from visibili v
  left join s on true
  left join public.presenze_stanza p on p.stanza_id = s.id and p.utente_id = v.utente_id
$$;
revoke all on function public.stati_stanza(uuid) from public, anon, authenticated;
grant execute on function public.stati_stanza(uuid) to service_role;
