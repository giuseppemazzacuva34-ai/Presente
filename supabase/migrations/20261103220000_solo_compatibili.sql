-- Fase 2 · issue #3 · risposta del CPO del 3/11: nella stanza ognuno vede SOLO le persone reciprocamente compatibili.
-- Le altre persone della stanza (es. due donne che cercano uomini) non compaiono, né nell'app né chiamando l'API.
-- Stessa regola di api/stanze.js (compatibili): A vede B solo se B rientra nei filtri di A E A in quelli di B
-- (genere cercato, età, raggio). «Non binario» e «mi descrivo» rientrano solo in chi cerca «tutti» (CPO 3/11).
-- «Città» si legge come provincia (D84 A); durante la stanza in corso vale la provincia precedente a un cambio.
-- Scelta tecnica: il controllo usa i filtri di adesso. Chi cambia i filtri a metà settimana può solo vedere meno
-- persone o le stesse: per vedere qualcuno serve sempre anche il sì dei filtri dell'altro.

-- Interna: non si chiama dal telefono (nessun permesso a anon/authenticated). Restituisce false se manca un dato.
create function public.rientra_nei_filtri(chi uuid, altro uuid)
  returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((
    select
      (f.cerco = 'tutti' or (f.cerco = 'donne' and pa.mi_presento_come = 'donna') or (f.cerco = 'uomini' and pa.mi_presento_come = 'uomo'))
      and extract(year from age(current_date, pa.data_nascita)) between coalesce(f.eta_min, 18) and coalesce(f.eta_max, 99)
      and case f.raggio
        when 'citta' then pa.paese = pc.paese
          and coalesce(case when pa.provincia_in_vigore_dal > now() then pa.provincia_precedente else pa.provincia end, lower(pa.citta))
            = coalesce(case when pc.provincia_in_vigore_dal > now() then pc.provincia_precedente else pc.provincia end, lower(pc.citta))
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

create function public.compatibili_tra(a uuid, b uuid)
  returns boolean
  language sql stable security definer set search_path = '' as $$
  select a <> b and public.rientra_nei_filtri(a, b) and public.rientra_nei_filtri(b, a)
$$;
revoke all on function public.compatibili_tra(uuid, uuid) from public, anon, authenticated;

-- Compagni di stanza: come prima (nome, età, provincia o «Dall'estero»), ma solo chi è per te.
-- Il contatore «Nella tua stanza: N persone per te» è il numero di righe di questa funzione.
create or replace function public.compagni_di_stanza()
  returns table (utente_id uuid, nome text, eta integer, citta text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, extract(year from age(current_date, p.data_nascita))::integer,
         case when p.provincia = 'EE' then 'Dall''estero' else coalesce(pr.nome, p.citta) end
  from public.membri_stanza io
  join public.stanze s on s.id = io.stanza_id and now() >= s.apre_il and now() < s.chiude_il
  join public.membri_stanza altri on altri.stanza_id = io.stanza_id and altri.utente_id <> io.utente_id
  join public.profili p on p.id = altri.utente_id
  left join public.province pr on pr.sigla = p.provincia
  where io.utente_id = auth.uid() and public.compatibili_tra(io.utente_id, altri.utente_id)
$$;
revoke all on function public.compagni_di_stanza() from public, anon;
grant execute on function public.compagni_di_stanza() to authenticated;
