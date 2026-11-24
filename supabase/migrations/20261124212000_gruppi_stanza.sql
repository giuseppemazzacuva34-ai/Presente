-- Stanza viva (issue #380, spec v1 del CPO del 23/11, punto 2), passo 5a della linea CTO (sviluppatore, linea a).
-- Il cerchio della schermata 19 mette gli uomini a sinistra, le donne a destra e le altre persone in basso: il telefono
-- deve sapere in quale metà sta ognuno. gruppi_stanza() lo dice SOLO per le persone che chi guarda già vede in
-- stati_stanza() (stessa stanza aperta, compatibili, senza blocchi, non sospese, non uscite), con tre valori soli:
-- «uomini», «donne», «altre» (non binario, «preferisco descrivermi», nessuna risposta). Mai la descrizione scritta a
-- mano. Funzione nuova accanto a stati_stanza (nessuna funzione tolta o cambiata). Solo il server (service_role).
create or replace function public.gruppi_stanza(p_persona uuid)
  returns table (utente_id uuid, gruppo text)
  language sql stable security definer set search_path = '' as $$
  select s.utente_id,
         case pr.mi_presento_come when 'uomo' then 'uomini' when 'donna' then 'donne' else 'altre' end
  from public.stati_stanza(p_persona) s
  left join public.profili pr on pr.id = s.utente_id
$$;
revoke all on function public.gruppi_stanza(uuid) from public, anon, authenticated;
grant execute on function public.gruppi_stanza(uuid) to service_role;
