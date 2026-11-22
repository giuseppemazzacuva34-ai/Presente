-- Fase 2 · issue #331 spec v1 (CPO, 21/11), parte C «Cosa vede chi riceve» · linea «sviluppatore-c» (passo 4).
-- Solo letture del server per chi riceve; il telefono non legge la tabella «regali».
--   regali_da_vedere(persona): gli avvisi «<nome> ti ha mandato una rosa.» non ancora visti.
--   regali_ricevuti_da(persona, da): «Ti ha mandato: 1 rosa, 1 bicchiere di spumante» nella scheda (solo chi riceve).
--   segna_regali_visti(persona, ids): l'avviso non si ripete; si segnano solo i regali ricevuti da quella persona.
-- Blocco o segnalazione (in entrambe le direzioni, come per mandarli) dopo un regalo: i regali spariscono dalla vista.
-- Nessun algoritmo (suggerimenti, stanze, chiavi) legge queste funzioni o la tabella.
-- Nessun SQL distruttivo: una colonna nuova, vuota.

alter table public.regali add column visto_il timestamptz;

create function public.regalo_visibile(p_a uuid, p_da uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select not public.bloccati_tra(p_a, p_da)
     and not exists (select 1 from public.segnalazioni g
                     where (g.da = p_a and g.contro = p_da) or (g.da = p_da and g.contro = p_a))
$$;
revoke all on function public.regalo_visibile(uuid, uuid) from public, anon, authenticated;
grant execute on function public.regalo_visibile(uuid, uuid) to service_role;

create function public.regali_da_vedere(p_persona uuid)
  returns table (id uuid, da uuid, nome text, regalo text, mandato_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select r.id, r.da, p.nome, r.regalo, r.mandato_il
  from public.regali r join public.profili p on p.id = r.da
  where r.a = p_persona and r.visto_il is null and public.regalo_visibile(r.a, r.da)
  order by r.mandato_il
$$;
revoke all on function public.regali_da_vedere(uuid) from public, anon, authenticated;
grant execute on function public.regali_da_vedere(uuid) to service_role;

create function public.regali_ricevuti_da(p_persona uuid, p_da uuid)
  returns table (regalo text, quanti integer)
  language sql stable security definer set search_path = '' as $$
  select r.regalo, count(*)::integer
  from public.regali r
  where r.a = p_persona and r.da = p_da and public.regalo_visibile(r.a, r.da)
  group by r.regalo
$$;
revoke all on function public.regali_ricevuti_da(uuid, uuid) from public, anon, authenticated;
grant execute on function public.regali_ricevuti_da(uuid, uuid) to service_role;

create function public.segna_regali_visti(p_persona uuid, p_ids uuid[]) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_quanti integer;
begin
  update public.regali set visto_il = now()
    where a = p_persona and id = any (coalesce(p_ids, array[]::uuid[])) and visto_il is null;
  get diagnostics v_quanti = row_count;
  return v_quanti;
end $$;
revoke all on function public.segna_regali_visti(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.segna_regali_visti(uuid, uuid[]) to service_role;
