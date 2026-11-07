-- Fase 2 · issue #3 · specifica v1.2 del CPO (6/11), decisione D121 A di Giuseppe: aree vaste.
-- Una «città» per le stanze è un'AREA = provincia + province vicine della stessa regione entro circa 60 km.
--   · tabella «aree» (codice, nome visibile) e colonna province.area: ogni provincia italiana sta in UNA sola area;
--     una provincia non elencata è un'area da sola (nome = nome della provincia); l'estero («EE») non ha area;
--   · la mappa è la stessa di api/aree.js (test/aree_database.test.mjs lo controlla); la cambia solo una decisione di
--     Giuseppe, con una nuova migrazione valida dal lunedì dopo;
--   · l'area la ricava sempre il server dalla provincia: non c'è nessuna colonna «area» nei profili da scrivere;
--   · «Solo la mia zona» (raggio «citta») ora confronta le aree, non le province;
--   · conteggi_aree(): solo numeri (totale, donne) dei profili completi per area, per i contatori della plancia.
--     Si chiama solo dal server (service_role), mai dal telefono; nessun nome, email o id.
-- Tabelle della mappa: solo server, come «province» (il telefono riceve il testo «La tua zona: …» dall'API).

create table public.aree (
  codice text primary key check (codice ~ '^[a-z]+(-[a-z]+)*$'),
  nome text not null check (length(nome) between 2 and 60)
);
alter table public.aree enable row level security;
revoke all on public.aree from anon, authenticated;

alter table public.province add column area text references public.aree (codice);

create temporary table mappa_aree (codice text, nome text, province text[]) on commit drop;
insert into mappa_aree (codice, nome, province) values
  ('roma', 'Roma e dintorni', array['RM', 'LT']),
  ('milano', 'Milano e dintorni', array['MI', 'MB', 'LO', 'PV', 'CO', 'VA', 'LC']),
  ('brescia-bergamo', 'Brescia e Bergamo', array['BS', 'BG', 'CR']),
  ('torino', 'Torino e dintorni', array['TO', 'AT']),
  ('napoli', 'Napoli e dintorni', array['NA', 'CE', 'SA', 'AV', 'BN']),
  ('firenze', 'Firenze e dintorni', array['FI', 'PO', 'PT', 'SI', 'AR']),
  ('bologna', 'Bologna e dintorni', array['BO', 'MO', 'FE']),
  ('bari', 'Bari e dintorni', array['BA', 'BT']),
  ('venezia-padova', 'Venezia e Padova', array['VE', 'PD', 'TV', 'VI', 'RO']);

insert into public.aree (codice, nome) select codice, nome from mappa_aree;
update public.province p set area = m.codice from mappa_aree m where p.sigla = any (m.province);
-- Province non elencate: un'area da sola, con il nome della provincia.
insert into public.aree (codice, nome) select lower(sigla), nome from public.province where area is null and sigla <> 'EE';
update public.province set area = lower(sigla) where area is null and sigla <> 'EE';
drop table mappa_aree;

-- Ogni provincia italiana ha un'area, l'estero nessuna.
alter table public.province add constraint province_area_obbligatoria check ((sigla = 'EE') = (area is null));

-- Interna: area di una provincia (null per estero, vuoto o sigla sconosciuta).
create function public.area_di(sigla text)
  returns text
  language sql stable security definer set search_path = '' as $$
  select p.area from public.province p where p.sigla = area_di.sigla
$$;
revoke all on function public.area_di(text) from public, anon, authenticated;

-- Come prima (20261103220000_solo_compatibili.sql), ma «Solo la mia zona» confronta le AREE delle province in vigore
-- (durante la stanza in corso vale la provincia precedente a un cambio). Righe vecchie senza provincia: vale la città.
create or replace function public.rientra_nei_filtri(chi uuid, altro uuid)
  returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce((
    select
      (f.cerco = 'tutti' or (f.cerco = 'donne' and pa.mi_presento_come = 'donna') or (f.cerco = 'uomini' and pa.mi_presento_come = 'uomo'))
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

-- Conteggi per area per la plancia e per il lavoro del lunedì: solo numeri, tutte le aree (anche a zero).
-- Profilo completo = ultimo passo dell'iscrizione (11) con data di nascita; vale la provincia in vigore.
create function public.conteggi_aree()
  returns table (codice text, nome text, totale integer, donne integer)
  language sql stable security definer set search_path = '' as $$
  select a.codice, a.nome, count(c.id)::integer, (count(c.id) filter (where c.mi_presento_come = 'donna'))::integer
  from public.aree a
  left join (
    select p.id, p.mi_presento_come,
           case when p.provincia_in_vigore_dal > now() then p.provincia_precedente else p.provincia end as provincia
    from public.profili p
    where p.passo = 11 and p.data_nascita is not null
  ) c on public.area_di(c.provincia) = a.codice
  group by a.codice, a.nome
$$;
revoke all on function public.conteggi_aree() from public, anon, authenticated;
grant execute on function public.conteggi_aree() to service_role;
