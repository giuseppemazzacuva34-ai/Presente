-- Fase 2 · issue #7 spec v1.1 definitiva · passo 14c della linea «sviluppatore-b».
-- «Sospensione: chiamate impossibili». Le chiamate (#4, api/dati_chiamata.js) oggi leggono solo la tabella
-- sospensioni, quindi non vedono le sanzioni decise da una persona (7/30 giorni, esclusione) né l'uscita dalla
-- stanza (passo 14a). sospesi_tra() dice in una sola lettura quali persone di un elenco sono fuori adesso, con la
-- stessa regola di sospeso(). Restituisce solo gli id: mai motivo, livello o segnalazione. Solo per il server.
-- Solo aggiunte: una funzione nuova; nessun file della linea #4 toccato (il passaggio lo fa il CTO).
create function public.sospesi_tra(p_persone uuid[])
  returns table (persona uuid) language sql stable security definer set search_path = '' as $$
  select distinct x from unnest(coalesce(p_persone, '{}'::uuid[])) as x where public.sospeso(x)
$$;
revoke all on function public.sospesi_tra(uuid[]) from public, anon, authenticated;
grant execute on function public.sospesi_tra(uuid[]) to service_role;
