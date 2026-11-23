-- Fase 2 · issue #349 design v4, schermata 28 «I tuoi regali» (regole dei regali: #331). Linea «sviluppatore-b».
-- Una sola lettura del server per chi riceve: il telefono non legge la tabella «regali».
--   storico_regali(persona) → { totale: {rosa, spumante, fiori},
--                               attuale: { citta, persone: [{da, nome, eta, rosa, spumante, fiori, ultimo}] } | null,
--                               passate: { stanze, persone, rosa, spumante, fiori } }
-- Nella stanza aperta si vedono nome di battesimo ed età di chi ha mandato (gli stessi dati di compagni_di_stanza);
-- delle stanze passate solo numeri, mai nomi o id. Regali di persone bloccate o segnalate (in entrambe le direzioni)
-- non si vedono e non si contano (regalo_visibile, come per gli avvisi). Nessun algoritmo legge questa funzione.
-- Nessun SQL distruttivo: solo una funzione nuova.

create function public.storico_regali(p_persona uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with visibili as (
    select r.da, r.regalo, r.stanza_id, r.mandato_il
    from public.regali r
    where r.a = p_persona and public.regalo_visibile(r.a, r.da)
  ),
  aperta as (select s.id, s.tipo, s.citta from public.stanza_aperta_di(p_persona) s where s.id is not null),
  per_persona as (
    select v.da, p.nome, extract(year from age(current_date, p.data_nascita))::integer as eta,
           count(*) filter (where v.regalo = 'rosa')::integer as rosa,
           count(*) filter (where v.regalo = 'spumante')::integer as spumante,
           count(*) filter (where v.regalo = 'fiori')::integer as fiori,
           max(v.mandato_il) as ultimo
    from visibili v join aperta a on a.id = v.stanza_id join public.profili p on p.id = v.da
    group by v.da, p.nome, p.data_nascita
  ),
  passate as (select v.* from visibili v where v.stanza_id not in (select id from aperta))
  select jsonb_build_object(
    'totale', jsonb_build_object(
      'rosa', (select count(*) from visibili where regalo = 'rosa'),
      'spumante', (select count(*) from visibili where regalo = 'spumante'),
      'fiori', (select count(*) from visibili where regalo = 'fiori')),
    'attuale', (select jsonb_build_object(
        'citta', case when a.tipo = 'italia' then 'Italia' else a.citta end,
        'persone', coalesce((select jsonb_agg(jsonb_build_object('da', q.da, 'nome', q.nome, 'eta', q.eta, 'rosa', q.rosa,
                                                                 'spumante', q.spumante, 'fiori', q.fiori, 'ultimo', q.ultimo)
                                              order by q.ultimo desc)
                             from per_persona q), '[]'::jsonb))
      from aperta a),
    'passate', jsonb_build_object(
      'stanze', (select count(distinct stanza_id) from passate),
      'persone', (select count(distinct da) from passate),
      'rosa', (select count(*) from passate where regalo = 'rosa'),
      'spumante', (select count(*) from passate where regalo = 'spumante'),
      'fiori', (select count(*) from passate where regalo = 'fiori')))
$$;
revoke all on function public.storico_regali(uuid) from public, anon, authenticated;
grant execute on function public.storico_regali(uuid) to service_role;
