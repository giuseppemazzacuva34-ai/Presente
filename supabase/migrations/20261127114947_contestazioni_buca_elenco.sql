-- Fase 2 · issue #6 spec v1.4 (CPO, 27/11; D51 A) · linea «sviluppatore-b»: elenco di «Ero lì» / «Non riesco» per il
-- pannello. Solo moderatori. Per ogni contestazione in attesa: nome di chi contesta, fase, testo, data d'invio, ora
-- dell'incontro, se si può già decidere (finestra del check-in finita) e se la porta è del moderatore («tua»).
-- Mai l'altra persona né l'id della porta. Solo aggiunte, solo dal server (service_role).
create function public.contestazioni_buca_da_decidere(p_moderatore uuid)
  returns table (id uuid, nome text, fase text, testo text, inviata_il timestamptz, orario timestamptz, decidibile boolean,
                 tua boolean)
  language plpgsql stable security definer set search_path = '' as $$ -- come contestazioni_no_da_decidere
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  return query
  select c.id, (select pr.nome from public.profili pr where pr.id = c.persona), c.fase, c.testo, c.inviata_il, i.orario,
         c.fase = 'dopo_buca' or i.esito is not null
           or (i.orario is not null and now() >= i.orario + make_interval(mins => 30 + i.ritardo_minuti)),
         p_moderatore in (p.a, p.b)
  from public.contestazioni_buca c
  join public.porte p on p.id = c.porta_id
  join public.incontri i on i.porta_id = c.porta_id
  where c.stato = 'in_attesa'
  order by c.inviata_il
  limit 200;
end $$;
revoke all on function public.contestazioni_buca_da_decidere(uuid) from public, anon, authenticated;
grant execute on function public.contestazioni_buca_da_decidere(uuid) to service_role;
