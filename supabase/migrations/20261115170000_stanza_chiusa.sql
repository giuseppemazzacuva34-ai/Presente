-- Stanza chiusa in sola lettura (issue #5 spec v1.1 passo 9): dopo la chiusura della domenica alle 21:00 la stanza
-- diventa «Chiusa» e le schede restano visibili fino a lunedì alle 9:00 di Roma, senza Chiama né Chiave.
-- compagni_di_stanza() resta com'è (solo la stanza aperta); questa funzione dà gli stessi quattro campi della stanza
-- appena chiusa, con gli stessi filtri: compatibili, nessun blocco, nessuna persona sospesa.

-- Lunedì alle 9:00 di Roma dopo la chiusura (domenica 21:00). Calcolata sul calendario di Roma: vale anche la
-- domenica del cambio d'ora.
create function public.fine_sola_lettura(chiusura timestamptz) returns timestamptz
  language sql immutable set search_path = '' as $$
  select (((chiusura at time zone 'Europe/Rome')::date + 1) + time '09:00') at time zone 'Europe/Rome'
$$;

create function public.compagni_stanza_chiusa()
  returns table (utente_id uuid, nome text, eta integer, citta text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, extract(year from age(current_date, p.data_nascita))::integer,
         case when p.provincia = 'EE' then 'Dall''estero' else coalesce(pr.nome, p.citta) end
  from public.membri_stanza io
  join public.stanze s on s.id = io.stanza_id
    and now() >= s.chiude_il and now() < public.fine_sola_lettura(s.chiude_il)
  join public.membri_stanza altri on altri.stanza_id = io.stanza_id and altri.utente_id <> io.utente_id
  join public.profili p on p.id = altri.utente_id
  left join public.province pr on pr.sigla = p.provincia
  where io.utente_id = auth.uid() and public.compatibili_tra(io.utente_id, altri.utente_id)
    and not public.bloccati_tra(io.utente_id, altri.utente_id) and not public.sospeso(altri.utente_id)
$$;
revoke all on function public.compagni_stanza_chiusa() from public, anon;
grant execute on function public.compagni_stanza_chiusa() to authenticated;
