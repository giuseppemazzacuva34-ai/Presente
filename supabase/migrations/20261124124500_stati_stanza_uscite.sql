-- Stanza viva (#380) e «Lascia la stanza» (#381): stati_stanza non mostra più chi ha lasciato la stanza. Segnalato da
-- «sviluppatore-b» il 24/11. Linea «sviluppatore» (a). Uguale a 20261123123000_presenze_stanza.sql, in più
-- «not public.ha_lasciato(...)» tra le persone visibili. Chi ha lasciato non vede già nessuno (stanza_aperta_di).
create or replace function public.stati_stanza(p_persona uuid)
  returns table (utente_id uuid, ultimo_segnale timestamptz, in_chiamata boolean, in_chiamata_con uuid)
  language sql stable security definer set search_path = '' as $$
  with s as (select * from public.stanza_aperta_di(p_persona)),
  visibili as (
    select m.utente_id from s join public.membri_stanza m on m.stanza_id = s.id
    where m.utente_id <> p_persona and public.compatibili_tra(p_persona, m.utente_id)
      and not public.bloccati_tra(p_persona, m.utente_id) and not public.sospeso(m.utente_id)
      and not public.ha_lasciato(m.utente_id, s.id)
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
