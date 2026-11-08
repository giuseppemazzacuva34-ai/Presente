-- Fase 2 · issue #3 · lavoro del lunedì: una funzione legge, una scrive. Le chiama solo il server (service_role),
-- dalla GitHub Action «Stanze» (scripts/lavoro_lunedi.mjs); il telefono non può chiamarle.
-- righe_settimana(): solo chi ha confermato l'ingresso per quel lunedì, solo i campi che servono ai calcoli
--   (mai email, foto, voce, diario o «mi descrivo»), provincia in vigore all'apertura.
-- scrivi_settimana(): tutte le stanze della settimana in un colpo solo (la funzione è una transazione: o tutto o niente);
--   se le stanze di quel lunedì ci sono già non scrive nulla, così una seconda esecuzione non fa danni.

create function public.righe_settimana(apre timestamptz) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with confermati as (
    select c.utente_id, c.confermata_il from public.conferme_stanza c where c.apre_il = apre
  ),
  passate as (
    select s.id, s.apre_il from public.stanze s where s.apre_il < apre and s.apre_il >= apre - interval '28 days'
  )
  select jsonb_build_object(
    'righe', coalesce((
      select jsonb_agg(jsonb_build_object(
        'profilo', jsonb_build_object('id', p.id, 'nome', p.nome, 'data_nascita', p.data_nascita, 'citta', p.citta,
          'provincia', case when p.provincia_in_vigore_dal > apre then p.provincia_precedente else p.provincia end,
          'paese', p.paese, 'mi_presento_come', p.mi_presento_come, 'passo', p.passo),
        'filtri', case when f.utente_id is null then null else jsonb_build_object('cerco', f.cerco,
          'consenso_cerco_il', f.consenso_cerco_il, 'eta_min', f.eta_min, 'eta_max', f.eta_max, 'raggio', f.raggio) end,
        'questionario', coalesce((select jsonb_agg(jsonb_build_object('versione', q.versione, 'in_vigore_dal', q.in_vigore_dal,
          'risposte', q.risposte, 'importanza', q.importanza)) from public.questionario q where q.utente_id = p.id), '[]'::jsonb)
      ) order by p.id)
      from confermati c join public.profili p on p.id = c.utente_id
      left join public.filtri f on f.utente_id = p.id), '[]'::jsonb),
    'iscrizioni', coalesce((select jsonb_object_agg(c.utente_id, c.confermata_il) from confermati c), '{}'::jsonb),
    'stanze_precedenti', coalesce((select jsonb_object_agg(x.utente_id, x.quante) from (
      select m.utente_id, count(*) as quante from public.membri_stanza m join public.stanze s on s.id = m.stanza_id
      where s.apre_il < apre
      group by m.utente_id) x), '{}'::jsonb),
    'storico', coalesce((select jsonb_agg(jsonb_build_object('stanza_id', m.stanza_id, 'utente_id', m.utente_id, 'apre_il', ps.apre_il))
      from public.membri_stanza m join passate ps on ps.id = m.stanza_id), '[]'::jsonb)
  )
$$;
revoke all on function public.righe_settimana(timestamptz) from public, anon, authenticated;
grant execute on function public.righe_settimana(timestamptz) to service_role;

create function public.scrivi_settimana(dati jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  apre timestamptz := (dati ->> 'apre_il')::timestamptz;
  chiude timestamptz := (dati ->> 'chiude_il')::timestamptz;
  stanza jsonb;
  membro jsonb;
  nuova uuid;
  n_stanze integer := 0;
  n_membri integer := 0;
begin
  if apre is null or chiude is null or apre <> public.prossima_apertura(apre - interval '1 second') then
    raise exception 'L''apertura deve essere un lunedì alle 9:00 di Roma.' using errcode = 'check_violation';
  end if;
  -- Un solo lavoro alla volta per settimana; se le stanze ci sono già, non si scrive nulla.
  perform pg_advisory_xact_lock(hashtextextended('scrivi_settimana', 0));
  if exists (select 1 from public.stanze s where s.apre_il = apre) then
    return jsonb_build_object('gia_fatta', true, 'stanze', 0, 'membri', 0);
  end if;
  for stanza in select * from jsonb_array_elements(coalesce(dati -> 'stanze', '[]'::jsonb)) loop
    insert into public.stanze (tipo, citta, apre_il, chiude_il)
      values (stanza ->> 'tipo', nullif(stanza ->> 'citta', ''), apre, chiude) returning id into nuova;
    n_stanze := n_stanze + 1;
    for membro in select * from jsonb_array_elements(coalesce(stanza -> 'membri', '[]'::jsonb)) loop
      -- Entra solo chi ha confermato per questo lunedì (difesa in più oltre ai calcoli).
      if not exists (select 1 from public.conferme_stanza c
                     where c.utente_id = (membro ->> 'utente_id')::uuid and c.apre_il = apre) then
        raise exception 'Una persona senza conferma per questa settimana.' using errcode = 'check_violation';
      end if;
      insert into public.membri_stanza (stanza_id, utente_id, gratis)
        values (nuova, (membro ->> 'utente_id')::uuid, coalesce((membro ->> 'gratis')::boolean, false));
      n_membri := n_membri + 1;
    end loop;
  end loop;
  return jsonb_build_object('gia_fatta', false, 'stanze', n_stanze, 'membri', n_membri);
end $$;
revoke all on function public.scrivi_settimana(jsonb) from public, anon, authenticated;
grant execute on function public.scrivi_settimana(jsonb) to service_role;
