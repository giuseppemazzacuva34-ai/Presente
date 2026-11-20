-- Issue #4, spec v1.4 del CPO (20/11): una chiamata caduta senza rientro dopo almeno 60 secondi conta nei limiti
-- (già così: i limiti guardano solo la durata) e ha lo stesso finale di una chiamata normale: «La richiameresti?»
-- e diario. Qui cambia solo l'esito accettato da salva_richiameresti() e richiameresti_da_riproporre():
-- si aggiunge 'caduta'. «Chiudi e segnala» resta fuori. Stesse firme, stessi permessi (solo server).

create or replace function public.salva_richiameresti(p_utente uuid, p_chi uuid, p_inizio timestamptz, p_risposta text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  c public.chiamate;
  altra uuid;
  stanza uuid;
  n integer;
begin
  if p_risposta is null or p_risposta not in ('si', 'no', 'salta') then
    raise exception 'Risposta non valida.' using errcode = 'check_violation';
  end if;
  select * into c from public.chiamate where chi = p_chi and inizio = p_inizio;
  if not found or p_utente not in (c.chi, c.con) then return false; end if;
  if c.durata is null or c.durata < 60 or c.esito not in ('tempo_scaduto', 'chiusa', 'caduta') then return false; end if;
  altra := case when p_utente = c.chi then c.con else c.chi end;
  stanza := public.stanza_della_chiamata(p_utente, altra, c.inizio);
  if stanza is null then return false; end if;
  insert into public.richiameresti (utente_id, chiamata_chi, chiamata_inizio, stanza_id, risposta)
    values (p_utente, c.chi, c.inizio, stanza, p_risposta)
    on conflict (utente_id, chiamata_chi, chiamata_inizio) do update
      set risposta = excluded.risposta, aggiornata_il = now()
      where public.richiameresti.risposta is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.salva_richiameresti(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.salva_richiameresti(uuid, uuid, timestamptz, text) to service_role;

create or replace function public.richiameresti_da_riproporre(p_utente uuid)
  returns table (chi uuid, con uuid, inizio timestamptz)
  language plpgsql security definer set search_path = '' as $$
declare
  c public.chiamate;
  stanza uuid;
begin
  for c in
    select k.* from public.chiamate k
    where (k.chi = p_utente or k.con = p_utente) and k.durata >= 60 and k.esito in ('tempo_scaduto', 'chiusa', 'caduta')
      and not exists (select 1 from public.richiameresti r
                      where r.utente_id = p_utente and r.chiamata_chi = k.chi and r.chiamata_inizio = k.inizio)
    order by k.inizio desc
  loop
    stanza := public.stanza_della_chiamata(p_utente, case when p_utente = c.chi then c.con else c.chi end, c.inizio);
    if stanza is not null then
      insert into public.richiameresti (utente_id, chiamata_chi, chiamata_inizio, stanza_id, risposta, riproposta)
        values (p_utente, c.chi, c.inizio, stanza, null, true);
      chi := c.chi; con := c.con; inizio := c.inizio;
      return next;
      return;
    end if;
  end loop;
end $$;
revoke all on function public.richiameresti_da_riproporre(uuid) from public, anon, authenticated;
grant execute on function public.richiameresti_da_riproporre(uuid) to service_role;
