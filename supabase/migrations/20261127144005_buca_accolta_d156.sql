-- Fase 2 · issue #6 spec v1.4, ramo «Ero lì» accolto DOPO che la buca è stata pagata · linea «sviluppatore-b».
-- DECISO D156 = A (Giuseppe, 27/11): chi ha aspettato TIENE i 70 (nessun movimento verso di lui); a chi contesta
-- tornano i suoi 100; Presente rinuncia ai suoi 30 e copre i 70 (in beta crediti di prova, 0 €).
-- Esito dell'incontro «annullato»: nessuno ha dato buca, crediti_presente torna 0 (vincolo buca_a_presente).
-- Si applica solo se la persona è davvero quella segnata con la buca e la sua caparra non è già tornata:
-- chiamata due volte non restituisce due volte. Cambia solo questa funzione (spec v1.4: «una sola funzione»).
-- Solo dal server (service_role), come prima.
create or replace function public.buca_accolta_dopo_pagamento(p_porta uuid, p_persona uuid) returns boolean
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_i public.incontri;
begin
  select * into v_porta from public.porte where id = p_porta;
  if not found or p_persona is null then
    return false;
  end if;
  select * into v_i from public.incontri where porta_id = p_porta for update;
  if not found
     or not ((v_i.esito = 'buca_a' and p_persona = v_porta.a) or (v_i.esito = 'buca_b' and p_persona = v_porta.b)) then
    return false;
  end if;
  if not exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = p_persona and tipo = 'caparra_bloccata')
     or exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = p_persona and tipo = 'caparra_restituita') then
    return false;
  end if;
  insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
    values (p_persona, 'caparra_restituita', public.coin_caparra(), p_porta);
  update public.incontri set esito = 'annullato', esito_il = now(), crediti_presente = 0 where porta_id = p_porta;
  return true;
end $$;
revoke all on function public.buca_accolta_dopo_pagamento(uuid, uuid) from public, anon, authenticated;
grant execute on function public.buca_accolta_dopo_pagamento(uuid, uuid) to service_role;
