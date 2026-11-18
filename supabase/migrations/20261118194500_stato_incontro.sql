-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D17 A) · passo 2d della linea «sviluppatore-b».
-- Lo stato dell'incontro per una delle due persone, dal suo punto di vista, per la schermata «Il vostro incontro».
--   stato_incontro(porta, persona) → jsonb
--     { stato, scadenza, orario, locale, luogo, proposta_mia, proposta_scade, controproposte_rimaste, azioni,
--       ritardo_minuti, esito }
--   azioni: «proponi» (da fissare), «accetto» · «altra_data» · «annulla» (proposta ricevuta; senza «altra_data» dopo 3
--   controproposte in tutto), nessuna per chi aspetta la risposta, a incontro confermato o chiuso.
--   Errori: { errore: «non_nella_porta» | «nessun_incontro» }.
-- Mai l'id dell'altra persona, mai una posizione. Alla lettura l'incontro si apre (se c'è il doppio sì) e si aggiorna
-- come nelle altre funzioni (proposta scaduta dopo 48 ore → da fissare; scadenza senza conferma → «scaduto» e crediti
-- restituiti), così la schermata non mostra mai uno stato vecchio. Solo il server la chiama.

create function public.stato_incontro(p_porta uuid, p_persona uuid) returns jsonb
  language plpgsql set search_path = '' as $$
declare
  v_controproposte constant integer := 3;
  v_porta public.porte;
  v_i public.incontri;
  v_rimaste integer;
  v_azioni jsonb := '[]'::jsonb;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return jsonb_build_object('errore', 'non_nella_porta');
  end if;
  if public.apri_incontro(p_porta) is null then
    return jsonb_build_object('errore', 'nessun_incontro');
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  v_rimaste := greatest(v_controproposte - v_i.controproposte, 0);
  if v_i.esito is null then
    if v_i.stato = 'da_fissare' then
      v_azioni := '["proponi"]'::jsonb;
    elsif v_i.stato = 'proposto' and v_i.proposto_da is distinct from p_persona then
      v_azioni := case when v_rimaste > 0 then '["accetto", "altra_data", "annulla"]'::jsonb
                       else '["accetto", "annulla"]'::jsonb end;
    end if;
  end if;
  return jsonb_build_object(
    'stato', v_i.stato,
    'scadenza', v_i.scadenza,
    'orario', v_i.orario,
    'locale', v_i.locale,
    'luogo', v_i.luogo_libero,
    'proposta_mia', v_i.stato = 'proposto' and v_i.proposto_da = p_persona,
    'proposta_scade', case when v_i.stato = 'proposto' then least(v_i.proposto_il + interval '48 hours', v_i.scadenza) end,
    'controproposte_rimaste', v_rimaste,
    'azioni', v_azioni,
    'ritardo_minuti', v_i.ritardo_minuti,
    'esito', v_i.esito);
end $$;

revoke all on function public.stato_incontro(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stato_incontro(uuid, uuid) to service_role;
