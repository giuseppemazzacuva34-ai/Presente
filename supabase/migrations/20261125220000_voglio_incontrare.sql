-- Fase 2 · issue #471 spec v1 del CPO (25/11, richiesta di Giuseppe), parte B · linea «sviluppatore» (CTO).
-- «Cerco» diventa «Voglio incontrare» a più scelte: filtri.cerco passa da testo singolo a elenco di valori tra
-- donne, uomini, non_binari (almeno uno). Migrazione NON distruttiva: nessuna riga tolta, nessun dato nuovo;
-- 'tutti' → tutte e tre, 'donne' → {donne}, 'uomini' → {uomini}. Consenso separato invariato (vincolo
-- cerco_con_consenso e trigger consenso_cerco_dal_server valgono anche per l'elenco).
-- Compatibilità: chi si presenta «non binario» o «mi descrivo» rientra in chi vuole incontrare non_binari
-- (prima solo in «tutti», che ora le contiene). L'etichetta di orientamento NON si salva (D155 aperta).

-- Conversione dal testo di prima (usata qui sotto e provata in supabase/test/prova_voglio_incontrare.sql).
create function public.cerco_da_testo(testo text)
  returns text[]
  language sql immutable set search_path = '' as $$
  select case testo
    when 'tutti' then array['donne', 'uomini', 'non_binari']
    when 'donne' then array['donne']
    when 'uomini' then array['uomini']
  end
$$;
revoke all on function public.cerco_da_testo(text) from public, anon, authenticated;

alter table public.filtri drop constraint filtri_cerco_check;
alter table public.filtri alter column cerco type text[] using public.cerco_da_testo(cerco);
alter table public.filtri add constraint filtri_cerco_check
  check (cerco is null or (cardinality(cerco) between 1 and 3 and cerco <@ array['donne', 'uomini', 'non_binari']));

comment on column public.filtri.cerco is
  '«Voglio incontrare» (#471): elenco tra donne, uomini, non_binari. Può rivelare l''orientamento: solo con consenso separato, mai visibile ad altri.';

-- Come 20261107220000_aree.sql, cambia solo il confronto del genere: l'elenco contiene il genere dell'altra persona.
create or replace function public.rientra_nei_filtri(chi uuid, altro uuid)
  returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((
    select
      (case pa.mi_presento_come when 'donna' then 'donne' when 'uomo' then 'uomini' else 'non_binari' end) = any (f.cerco)
      and extract(year from age(current_date, pa.data_nascita)) between coalesce(f.eta_min, 18) and coalesce(f.eta_max, 99)
      and case f.raggio
        when 'citta' then pa.paese = pc.paese
          and coalesce(public.area_di(case when pa.provincia_in_vigore_dal > now() then pa.provincia_precedente else pa.provincia end),
                       case when pa.provincia is null then lower(pa.citta) end)
            = coalesce(public.area_di(case when pc.provincia_in_vigore_dal > now() then pc.provincia_precedente else pc.provincia end),
                       case when pc.provincia is null then lower(pc.citta) end)
        when 'italia' then pa.paese = 'IT'
        when 'estero' then true
        else false
      end
    from public.filtri f
    join public.profili pc on pc.id = f.utente_id
    join public.profili pa on pa.id = altro
    where f.utente_id = chi and f.cerco is not null and pa.data_nascita is not null and pa.mi_presento_come is not null
  ), false)
$$;
revoke all on function public.rientra_nei_filtri(uuid, uuid) from public, anon, authenticated;
