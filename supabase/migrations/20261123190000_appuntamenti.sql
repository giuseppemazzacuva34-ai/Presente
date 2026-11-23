-- Fase 2 · issue #380 «Stanza viva e Fissa una chiamata», spec v1 del CPO (23/11, design v4 D149, schermata 20) ·
-- passo 2b della linea CTO: gli appuntamenti per una chiamata («FISSA»).
--   · appuntamenti: una riga per proposta tra due persone della stessa stanza. chi = chi ha fatto l'ultima proposta,
--     con = chi deve rispondere (la controproposta li scambia). Massimo 2 controproposte, messaggio ≤ 120 caratteri
--     (il controllo di numeri, link e social lo fa il Worker con controllaMessaggio() di api/appuntamenti.js, lo stesso
--     della frase della chiave; anche le fasce di disponibilità le controlla il Worker con oreProponibili()).
--   · Lo stato che si vede si calcola a ogni lettura (vista_appuntamento): scaduto all'ora proposta, finito 15 minuti
--     dopo l'ora fissata, «annullato» senza motivo se tra i due c'è un blocco o una segnalazione, se uno è sospeso o
--     non è più nella stanza, «tre_chiamate» dopo la 3ª chiamata tra i due nella settimana della stanza.
--   · Limiti: 3 appuntamenti aperti per persona (proposti o confermati, anche ricevuti), 1 con la stessa persona.
--   · Gli altri della stanza non vedono nulla. Appuntamenti e messaggi non entrano negli algoritmi: nessuna funzione di
--     stanze, suggerimenti o chiavi legge questa tabella.
--   · Alla chiusura della stanza si cancella tutto (pulisci_appuntamenti, chiamata a ogni funzione qui sotto).
-- Tutto SOLO per il server (Worker con la chiave del server). Nessun nome nei log. Solo aggiunte.

create table public.appuntamenti (
  id uuid primary key default gen_random_uuid(),
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  chi uuid not null references auth.users (id) on delete cascade,
  con uuid not null references auth.users (id) on delete cascade,
  stato text not null check (stato in ('proposto', 'confermato', 'rifiutato', 'annullato')),
  quando timestamptz not null,
  messaggio text check (char_length(messaggio) <= 120),
  controproposte smallint not null default 0 check (controproposte between 0 and 2),
  annullato_da uuid,
  creato_il timestamptz not null default now(),
  constraint mai_con_se_stessi check (chi <> con),
  constraint annullato_da_uno_dei_due check (annullato_da is null or (stato = 'annullato' and annullato_da in (chi, con)))
);
create index appuntamenti_chi on public.appuntamenti (stanza_id, chi);
create index appuntamenti_con on public.appuntamenti (stanza_id, con);

alter table public.appuntamenti enable row level security;
revoke all on public.appuntamenti from public, anon, authenticated, service_role;
-- Nessuna regola e nessun permesso: si passa solo dalle funzioni qui sotto.

-- Pulizia: cancella gli appuntamenti delle stanze già chiuse. Restituisce quante righe ha tolto.
create function public.pulisci_appuntamenti() returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  tolte integer;
begin
  delete from public.appuntamenti a using public.stanze s where s.id = a.stanza_id and now() >= s.chiude_il;
  get diagnostics tolte = row_count;
  return tolte;
end $$;
revoke all on function public.pulisci_appuntamenti() from public, anon, authenticated;
grant execute on function public.pulisci_appuntamenti() to service_role;

-- Tra le due persone c'è una segnalazione, in un verso o nell'altro?
create function public.segnalati_tra(p_x uuid, p_y uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.segnalazioni g
                 where (g.da = p_x and g.contro = p_y) or (g.da = p_y and g.contro = p_x))
$$;
revoke all on function public.segnalati_tra(uuid, uuid) from public, anon, authenticated;
grant execute on function public.segnalati_tra(uuid, uuid) to service_role;

-- Quante chiamate tra i due nella settimana della stanza.
create function public.chiamate_tra_in_stanza(p_x uuid, p_y uuid, p_stanza uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.chiamate c join public.stanze s on s.id = p_stanza
  where ((c.chi = p_x and c.con = p_y) or (c.chi = p_y and c.con = p_x))
    and c.inizio >= s.apre_il and c.inizio < s.chiude_il
$$;
revoke all on function public.chiamate_tra_in_stanza(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.chiamate_tra_in_stanza(uuid, uuid, uuid) to service_role;

-- Lo stato dell'appuntamento adesso: proposto, confermato (fino a 15 minuti dopo l'ora fissata), scaduto, finito,
-- rifiutato, annullato (da uno dei due), annullato_sistema (blocco, segnalazione, sospensione, uscita), tre_chiamate.
create function public.vista_appuntamento(a public.appuntamenti) returns text
  language sql stable security definer set search_path = '' as $$
  select case
    when a.stato = 'rifiutato' then 'rifiutato'
    when a.stato = 'annullato' then 'annullato'
    when not exists (select 1 from public.membri_stanza m where m.stanza_id = a.stanza_id and m.utente_id = a.chi)
      or not exists (select 1 from public.membri_stanza m where m.stanza_id = a.stanza_id and m.utente_id = a.con)
      or public.bloccati_tra(a.chi, a.con) or public.segnalati_tra(a.chi, a.con)
      or public.sospeso(a.chi) or public.sospeso(a.con) then 'annullato_sistema'
    when public.chiamate_tra_in_stanza(a.chi, a.con, a.stanza_id) >= 3 then 'tre_chiamate'
    when a.stato = 'proposto' then case when now() < a.quando then 'proposto' else 'scaduto' end
    when now() < a.quando + interval '15 minutes' then 'confermato'
    else 'finito'
  end
$$;
revoke all on function public.vista_appuntamento(public.appuntamenti) from public, anon, authenticated;
grant execute on function public.vista_appuntamento(public.appuntamenti) to service_role;

-- Appuntamenti aperti (proposti o confermati) in cui compare la persona, nella stanza indicata.
create function public.appuntamenti_aperti(p_persona uuid, p_stanza uuid) returns integer
  language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.appuntamenti a
  where a.stanza_id = p_stanza and p_persona in (a.chi, a.con)
    and public.vista_appuntamento(a) in ('proposto', 'confermato')
$$;
revoke all on function public.appuntamenti_aperti(uuid, uuid) from public, anon, authenticated;
grant execute on function public.appuntamenti_aperti(uuid, uuid) to service_role;

-- Orario valido nel database: passi di 30 minuti, ≥ 30 minuti da adesso, dentro la settimana della stanza,
-- al massimo 30 minuti prima della chiusura (domenica 20:30). I fusi italiani sono a ore intere: i passi di 30 minuti
-- in UTC coincidono con quelli di Roma.
create function public.orario_appuntamento_valido(p_quando timestamptz, s public.stanze) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_quando is not null
    and extract(epoch from p_quando)::bigint % 1800 = 0
    and p_quando >= now() + interval '30 minutes'
    and p_quando >= s.apre_il
    and p_quando <= s.chiude_il - interval '30 minutes'
$$;
revoke all on function public.orario_appuntamento_valido(timestamptz, public.stanze) from public, anon, authenticated;
grant execute on function public.orario_appuntamento_valido(timestamptz, public.stanze) to service_role;

-- Nuova proposta. 'ok' oppure il motivo (gli stessi codici di controllaProposta() in api/appuntamenti.js):
-- non_valida, non_disponibile, gia_con_lei, tre_aperti, orario, troppo_lungo.
-- I limiti dell'altra persona, i blocchi e le segnalazioni rispondono tutti «non_disponibile»: non si dice perché.
create function public.proponi_appuntamento(p_chi uuid, p_con uuid, p_quando timestamptz, p_messaggio text)
  returns text language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
  msg text := nullif(btrim(regexp_replace(coalesce(p_messaggio, ''), '\s+', ' ', 'g')), '');
begin
  perform public.pulisci_appuntamenti();
  if p_chi is null or p_con is null or p_chi = p_con then return 'non_valida'; end if;
  s := public.stanza_aperta_di(p_chi);
  if s.id is null or public.sospeso(p_chi) then return 'non_disponibile'; end if;
  -- Una proposta alla volta per stanza: i limiti si contano senza gare tra due richieste insieme.
  perform pg_advisory_xact_lock(hashtextextended('appuntamenti:' || s.id::text, 0));
  if not exists (select 1 from public.membri_stanza m where m.stanza_id = s.id and m.utente_id = p_con)
    or not public.compatibili_tra(p_chi, p_con) or public.sospeso(p_con)
    or public.bloccati_tra(p_chi, p_con) or public.segnalati_tra(p_chi, p_con)
    or public.chiamate_tra_in_stanza(p_chi, p_con, s.id) >= 3
  then return 'non_disponibile'; end if;
  if exists (select 1 from public.appuntamenti a where a.stanza_id = s.id
             and ((a.chi = p_chi and a.con = p_con) or (a.chi = p_con and a.con = p_chi))
             and public.vista_appuntamento(a) in ('proposto', 'confermato'))
  then return 'gia_con_lei'; end if;
  if public.appuntamenti_aperti(p_chi, s.id) >= 3 then return 'tre_aperti'; end if;
  if public.appuntamenti_aperti(p_con, s.id) >= 3 then return 'non_disponibile'; end if;
  if not public.orario_appuntamento_valido(p_quando, s) then return 'orario'; end if;
  if char_length(msg) > 120 then return 'troppo_lungo'; end if;
  insert into public.appuntamenti (stanza_id, chi, con, stato, quando, messaggio)
    values (s.id, p_chi, p_con, 'proposto', p_quando, msg);
  return 'ok';
end $$;
revoke all on function public.proponi_appuntamento(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.proponi_appuntamento(uuid, uuid, timestamptz, text) to service_role;

-- Risposta di chi riceve la proposta: 'conferma', 'no' («No, grazie») o 'altro' («Un altro orario», con p_quando e
-- p_messaggio). 'ok' oppure: non_trovato, controproposte_finite, orario, troppo_lungo, non_valida.
create function public.rispondi_appuntamento(p_persona uuid, p_id uuid, p_azione text, p_quando timestamptz, p_messaggio text)
  returns text language plpgsql security definer set search_path = '' as $$
declare
  a public.appuntamenti;
  s public.stanze;
  msg text := nullif(btrim(regexp_replace(coalesce(p_messaggio, ''), '\s+', ' ', 'g')), '');
begin
  perform public.pulisci_appuntamenti();
  if p_azione is null or p_azione not in ('conferma', 'no', 'altro') then return 'non_valida'; end if;
  select * into a from public.appuntamenti where id = p_id and con = p_persona for update;
  if a.id is null or public.vista_appuntamento(a) <> 'proposto' then return 'non_trovato'; end if;
  if p_azione = 'conferma' then
    update public.appuntamenti set stato = 'confermato' where id = a.id;
  elsif p_azione = 'no' then
    update public.appuntamenti set stato = 'rifiutato' where id = a.id;
  else
    if a.controproposte >= 2 then return 'controproposte_finite'; end if;
    select * into s from public.stanze where id = a.stanza_id;
    if not public.orario_appuntamento_valido(p_quando, s) then return 'orario'; end if;
    if char_length(msg) > 120 then return 'troppo_lungo'; end if;
    update public.appuntamenti
      set chi = a.con, con = a.chi, quando = p_quando, messaggio = msg, controproposte = a.controproposte + 1
      where id = a.id;
  end if;
  return 'ok';
end $$;
revoke all on function public.rispondi_appuntamento(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.rispondi_appuntamento(uuid, uuid, text, timestamptz, text) to service_role;

-- «Annulla l'appuntamento»: uno dei due, fino all'ora fissata. 'ok' oppure 'non_trovato'.
create function public.annulla_appuntamento(p_persona uuid, p_id uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  a public.appuntamenti;
begin
  perform public.pulisci_appuntamenti();
  select * into a from public.appuntamenti where id = p_id and p_persona in (chi, con) for update;
  if a.id is null or public.vista_appuntamento(a) not in ('proposto', 'confermato') or now() >= a.quando
  then return 'non_trovato'; end if;
  update public.appuntamenti set stato = 'annullato', annullato_da = p_persona where id = a.id;
  return 'ok';
end $$;
revoke all on function public.annulla_appuntamento(uuid, uuid) from public, anon, authenticated;
grant execute on function public.annulla_appuntamento(uuid, uuid) to service_role;

-- Gli appuntamenti della persona nella sua stanza aperta, come li vede lei.
--   · stato: proposto, confermato, scaduto (solo a chi ha proposto), rifiutato (solo a chi ha proposto),
--     annullato (all'altra persona se l'ha annullato uno dei due; a tutti e due se blocco, segnalazione, sospensione
--     o uscita — senza motivo e senza messaggio), tre_chiamate. Finiti e ciò che si è annullato da sé non compaiono.
--   · proposto_da_me: vero se l'ultima proposta l'ha fatta lei (tocca all'altra rispondere).
create function public.appuntamenti_di(p_persona uuid)
  returns table (id uuid, altra uuid, proposto_da_me boolean, stato text, quando timestamptz, messaggio text,
                 controproposte smallint, annullato_dall_altra boolean)
  language sql stable security definer set search_path = '' as $$
  with s as (select * from public.stanza_aperta_di(p_persona)),
  mie as (
    select a.*, public.vista_appuntamento(a) as vista from public.appuntamenti a join s on a.stanza_id = s.id
    where p_persona in (a.chi, a.con)
  )
  select m.id, case when m.chi = p_persona then m.con else m.chi end, m.chi = p_persona,
         case when m.vista = 'annullato_sistema' then 'annullato' else m.vista end,
         m.quando,
         case when m.vista in ('proposto', 'confermato') then m.messaggio end,
         m.controproposte,
         m.vista = 'annullato'
  from mie m
  where m.vista in ('proposto', 'confermato', 'annullato_sistema', 'tre_chiamate')
     or (m.vista in ('scaduto', 'rifiutato') and m.chi = p_persona)
     or (m.vista = 'annullato' and m.annullato_da <> p_persona)
$$;
revoke all on function public.appuntamenti_di(uuid) from public, anon, authenticated;
grant execute on function public.appuntamenti_di(uuid) to service_role;
