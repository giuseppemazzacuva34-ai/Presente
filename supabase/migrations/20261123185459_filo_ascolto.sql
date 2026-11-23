-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 5a della linea
-- «sviluppatore-c»: quale vocale del Filo può ascoltare un membro della stanza.
--   · vocale_filo_membro: per la persona p_utente, all'ora p_ora, il vocale del tipo chiesto della SUA stanza, con
--     durata, «Testo del vocale» e nome di battesimo del Filo (per la scheda delle schermate 18 e 36). Nessuna riga
--     se non può ascoltarlo:
--       lunedì   dall'apertura (9:00) fino alla chiusura (domenica 21:00): «riascoltabile tutta la settimana»;
--       domenica dalla chiusura (21:00, schermata 36) per un giorno, poi più nulla (la pulizia a 7 giorni cancella
--                comunque i file: passo successivo);
--       chi è sospeso o uscito dalla stanza (sospeso() vero) non ascolta.
--     Il file non esce mai dal server: il Worker lo trasforma in un link firmato a scadenza breve (passo 5b).
-- Tutto SOLO per il server (chiave del server): il telefono non chiama la funzione. Solo aggiunte: una funzione.

create function public.vocale_filo_membro(p_utente uuid, p_tipo text, p_ora timestamptz)
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
      and case p_tipo
            when 'lunedi' then p_ora >= s.apre_il and p_ora < s.chiude_il
            else p_ora >= s.chiude_il and p_ora < s.chiude_il + interval '1 day'
          end
    order by s.apre_il desc
    limit 1;
end $$;
revoke all on function public.vocale_filo_membro(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.vocale_filo_membro(uuid, text, timestamptz) to service_role;
