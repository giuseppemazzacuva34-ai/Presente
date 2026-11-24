-- Design v4 · «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, «Dati»). Linea «sviluppatore-b», passo 6a.
-- I motivi delle uscite li legge solo chi decide, nel pannello, per migliorare l'app; il codice del motivo resta,
-- senza nome, nel conteggio per il riepilogo del test interno (#8).
--   · motivi_uscite(moderatore) → righe (settimana, motivo, quante, testi): settimana = giorno di apertura della
--     stanza (ora di Roma), solo le ultime 8 settimane. «testi» = i testi liberi ancora presenti (la pulizia dei 30
--     giorni li toglie), in ordine alfabetico, mai legati a chi li ha scritti. Nessuna colonna con persona o stanza.
--   · Solo chi è nella tabella «moderatori» (come coda_moderazione), solo con la chiave del server.
-- Solo aggiunte; niente SQL distruttivo.

create function public.motivi_uscite(p_moderatore uuid)
  returns table (settimana date, motivo text, quante integer, testi text[])
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  return query
  select (s.apre_il at time zone 'Europe/Rome')::date, l.motivo, count(*)::integer,
         coalesce(array_agg(l.testo order by l.testo) filter (where l.testo is not null), '{}'::text[])
  from public.lasciate_stanza l
  join public.stanze s on s.id = l.stanza_id
  where s.apre_il >= now() - interval '8 weeks'
  group by 1, 2
  order by 1 desc, 2;
end $$;
revoke all on function public.motivi_uscite(uuid) from public, anon, authenticated;
grant execute on function public.motivi_uscite(uuid) to service_role;
