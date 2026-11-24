-- Design v4 · «Lascia la stanza» (issue #381, spec v1 del CPO del 23/11, «Cosa vedono gli altri»). Linea
-- «sviluppatore-b», passo 3, su richiesta del CTO (plancia 24/11) per agganciarla a stati_stanza (#380).
--   · lasciate_recenti(stanza, per) → i posti vuoti «Ha lasciato la stanza»: solo quelli lasciati nelle ultime 24 ore.
--     Per ogni posto: numero (1, 2, … in ordine di uscita) e posto, cioè la metà del cerchio ('uomini' | 'donne' |
--     'altre', come in landing/app/moduli/stanza_viva.js). Mai chi, mai il motivo, mai il testo, mai l'ora.
--   · Dal telefono (authenticated) vale sempre chi ha il token: deve essere nella stanza e non averla lasciata, e vede
--     solo i posti delle persone che vedeva (compatibili, senza blocchi), come compagni_di_stanza.
--   · Il server (service_role) può chiedere tutti i posti (per = null) o come li vede una persona (per = id).
-- Solo aggiunte: una funzione.

create function public.lasciate_recenti(p_stanza uuid, p_per uuid default null)
  returns table (numero integer, posto text)
  language plpgsql stable security definer set search_path = '' as $$
declare
  chi uuid := auth.uid();
begin
  -- Dal telefono il parametro «per» non conta: vale il token.
  if chi is not null then p_per := chi; end if;
  if p_stanza is null then return; end if;
  if p_per is not null and (
       not exists (select 1 from public.membri_stanza m where m.stanza_id = p_stanza and m.utente_id = p_per)
       or exists (select 1 from public.lasciate_stanza l where l.stanza_id = p_stanza and l.persona = p_per)) then
    return;
  end if;
  return query
    select (row_number() over (order by l.quando, l.persona))::integer,
           case p.mi_presento_come when 'uomo' then 'uomini' when 'donna' then 'donne' else 'altre' end
    from public.lasciate_stanza l
    left join public.profili p on p.id = l.persona
    where l.stanza_id = p_stanza and l.quando > now() - interval '24 hours'
      and (p_per is null or (public.compatibili_tra(p_per, l.persona) and not public.bloccati_tra(p_per, l.persona)))
    order by l.quando, l.persona;
end $$;
revoke all on function public.lasciate_recenti(uuid, uuid) from public, anon, authenticated;
grant execute on function public.lasciate_recenti(uuid, uuid) to authenticated, service_role;
