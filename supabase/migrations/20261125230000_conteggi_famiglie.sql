-- Fase 2 · issue #471 spec v1 del CPO (25/11, richiesta di Giuseppe), parte C · linea «sviluppatore» (CTO).
-- Soglia di 36 «per famiglia»: conteggi_famiglie() dà, per ogni area, quanti profili completi ha ogni famiglia
-- (mista, uomini, donne, aperta) e quanti sono «ponte» (più scelte o combinazioni diverse), con le donne.
--   · solo numeri: nessun id, nessun nome; la famiglia di una persona non esce mai dal database e non si salva;
--   · stessa regola di api/stanze.js famigliaPropria() (provata in supabase/test/prova_conteggi_famiglie.sql);
--   · profilo completo e area come conteggi_aree() (passo 11, data di nascita, provincia in vigore);
--   · si chiama solo dal server (service_role) per il lavoro del lunedì; righe solo dove il conto è > 0.

create function public.famiglia_propria(presento text, cerco text[])
  returns text
  language sql immutable set search_path = '' as $$
  select case
    when cerco is null or cardinality(cerco) <> 1 then 'ponte'
    when presento = 'uomo' and cerco[1] = 'uomini' then 'uomini'
    when presento = 'uomo' and cerco[1] = 'donne' then 'mista'
    when presento = 'donna' and cerco[1] = 'donne' then 'donne'
    when presento = 'donna' and cerco[1] = 'uomini' then 'mista'
    when presento in ('non_binario', 'mi_descrivo') and cerco[1] = 'non_binari' then 'aperta'
    else 'ponte'
  end
$$;
revoke all on function public.famiglia_propria(text, text[]) from public, anon, authenticated;

create function public.conteggi_famiglie()
  returns table (codice text, famiglia text, totale integer, donne integer)
  language sql stable security definer set search_path = '' as $$
  select a, f, count(*)::integer, (count(*) filter (where c.mi_presento_come = 'donna'))::integer
  from (
    select public.area_di(case when p.provincia_in_vigore_dal > now() then p.provincia_precedente else p.provincia end) as a,
           public.famiglia_propria(p.mi_presento_come, fl.cerco) as f,
           p.mi_presento_come
    from public.profili p
    join public.filtri fl on fl.utente_id = p.id
    where p.passo = 11 and p.data_nascita is not null and fl.cerco is not null and p.mi_presento_come is not null
  ) c
  where a is not null
  group by a, f
$$;
revoke all on function public.conteggi_famiglie() from public, anon, authenticated;
grant execute on function public.conteggi_famiglie() to service_role;
