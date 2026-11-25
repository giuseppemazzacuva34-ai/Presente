-- Fase 2 · issue #6 spec v1.3 punto 2 (CPO, 22/11; D51 A) · linea «sviluppatore-b»: le contestazioni dei «No» nel
-- pannello di chi decide, come i ricorsi delle sanzioni.
--   - contestazioni_no_da_decidere: solo moderatori; nome di chi contesta, domanda, testo, quanti «No» copre, data
--     d'invio, «tua» se è la propria. Mai chi ha risposto «No» né quale incontro.
--   - decidi_contestazione_no (stessa firma e stesse risposte di 20261125150000, più due): decide solo un moderatore
--     («non_moderatore») e mai sulla propria contestazione («propria»).
-- Solo aggiunte e una funzione sostituita con la stessa firma. Tutto solo dal server (service_role).

create function public.contestazioni_no_da_decidere(p_moderatore uuid)
  returns table (id uuid, nome text, domanda text, testo text, quanti_no integer, inviata_il timestamptz, tua boolean)
  language plpgsql stable security definer set search_path = '' as $$ -- come ricorsi_da_decidere: legge il nome dai profili
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, (select pr.nome from public.profili pr where pr.id = c.persona), c.domanda, c.testo,
         (select count(*)::integer from public.contestazioni_no_valutazioni a where a.contestazione_id = c.id),
         c.inviata_il, c.persona = p_moderatore
  from public.contestazioni_no c
  where c.stato = 'in_attesa'
  order by c.inviata_il
  limit 200;
end $$;
revoke all on function public.contestazioni_no_da_decidere(uuid) from public, anon, authenticated;
grant execute on function public.contestazioni_no_da_decidere(uuid) to service_role;

-- Risposte: accolta, respinta, gia_decisa, non_trovata, non_moderatore, propria.
create or replace function public.decidi_contestazione_no(p_id uuid, p_decisore uuid, p_accolta boolean) returns text
  language plpgsql set search_path = '' as $$
begin
  if not public.e_moderatore(p_decisore) then
    return 'non_moderatore';
  end if;
  if p_accolta is null then
    return 'non_trovata';
  end if;
  if exists (select 1 from public.contestazioni_no where id = p_id and persona = p_decisore) then
    return 'propria';
  end if;
  update public.contestazioni_no
    set stato = case when p_accolta then 'accolta' else 'respinta' end, deciso_da = p_decisore, deciso_il = now()
    where id = p_id and stato = 'in_attesa';
  if found then
    return case when p_accolta then 'accolta' else 'respinta' end;
  end if;
  return case when exists (select 1 from public.contestazioni_no where id = p_id) then 'gia_decisa' else 'non_trovata' end;
end $$;
revoke all on function public.decidi_contestazione_no(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.decidi_contestazione_no(uuid, uuid, boolean) to service_role;
