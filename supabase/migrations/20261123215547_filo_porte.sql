-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 6a della linea
-- «sviluppatore-c»: il numero delle porte aperte, per il Filo e per la schermata 36.
-- Il numero NON si ricalcola: è quello che apri_porte() (#5) salva una volta sola in serate_porte alle 21:00, con la
-- stessa regola della sera delle porte (chiave reciproca, niente blocchi). Rifare apri_porte non lo cambia.
--   · porte_stanza_filo: per il Filo della stanza, solo l'intero; null prima delle 21:00 (o finché il server non ha
--     aperto le porte) e dopo 7 giorni dalla chiusura (quando si cancellano anche i vocali). Errore se non è il suo Filo.
--     Mai chi: la funzione restituisce un intero e nient'altro.
--   · porte_stanza_membro: per chi è nella stanza, la riga della schermata 36 (stanza e numero) dalle 21:00 per un
--     giorno, come il vocale della domenica. Nessuna riga se la stanza non ha un Filo («la schermata 36 non compare»),
--     se il server non ha ancora aperto le porte, o se la persona è sospesa o uscita (sospeso() vero).
-- Tutto SOLO per il server (chiave del server): il telefono non chiama le funzioni. Solo aggiunte: due funzioni.

create function public.porte_stanza_filo(p_filo uuid, p_stanza uuid, p_ora timestamptz) returns integer
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_chiude timestamptz;
  v_porte integer;
begin
  select s.chiude_il into v_chiude
  from public.fili_stanza f join public.stanze s on s.id = f.stanza_id
  where f.filo = p_filo and f.stanza_id = p_stanza;
  if not found then
    raise exception 'non_filo' using errcode = 'insufficient_privilege';
  end if;
  if p_ora < v_chiude or p_ora >= v_chiude + interval '7 days' then
    return null;
  end if;
  select sp.porte_aperte into v_porte from public.serate_porte sp where sp.stanza_id = p_stanza;
  return v_porte;
end $$;
revoke all on function public.porte_stanza_filo(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.porte_stanza_filo(uuid, uuid, timestamptz) to service_role;

create function public.porte_stanza_membro(p_utente uuid, p_ora timestamptz)
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
      and p_ora >= s.chiude_il and p_ora < s.chiude_il + interval '1 day'
    order by s.chiude_il desc
    limit 1;
end $$;
revoke all on function public.porte_stanza_membro(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.porte_stanza_membro(uuid, timestamptz) to service_role;
