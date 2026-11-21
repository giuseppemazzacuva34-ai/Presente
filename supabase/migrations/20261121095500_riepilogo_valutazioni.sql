-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D20 A) · passo 3b della linea «sviluppatore-b»: il riepilogo alla cieca.
-- riepilogo_valutazioni(persona) dice a una persona solo ciò che le altre hanno risposto su di lei:
--   - alla cieca: una valutazione conta solo quando anche lei ha risposto su quell'incontro o dopo 7 giorni
--     dall'incontro;
--   - a riepilogo: { valutati, bollini, no_ricevuti }. I bollini (quante volte si è presentata/o, anche in ritardo;
--     foto sue; come in chiamata) solo da 3 incontri valutati; no_ricevuti = le domande con almeno un «No», in ordine
--     fisso, senza nome, data né id («Una persona ha risposto no a: <domanda>»). Mai la singola valutazione.
--   - La domanda privata sulla sicurezza non entra mai qui.
-- Valori uguali a api/valutazione.js (test/riepilogo_valutazioni_database.test.mjs li confronta). Solo il server.

create function public.riepilogo_valutazioni(p_persona uuid) returns jsonb
  language plpgsql stable set search_path = '' as $$
declare
  v_giorni constant integer := 7;
  v_bollini_dopo constant integer := 3;
  v_valutati integer;
  v_presentato integer;
  v_foto integer;
  v_chiamata integer;
  v_no jsonb;
begin
  with scoperte as (
    select v.presentato, v.foto_sue, v.come_in_chiamata
    from public.valutazioni v
    join public.incontri i on i.porta_id = v.porta_id
    where v.valutato = p_persona
      and (exists (select 1 from public.valutazioni m where m.porta_id = v.porta_id and m.persona = p_persona)
           or now() > i.esito_il + make_interval(days => v_giorni))
  )
  select count(*), count(*) filter (where presentato <> 'no'), count(*) filter (where foto_sue = 'si'),
         count(*) filter (where come_in_chiamata = 'si'),
         to_jsonb(array_remove(array[
           case when bool_or(come_in_chiamata = 'no') then 'come_in_chiamata' end,
           case when bool_or(foto_sue = 'no') then 'foto_sue' end,
           case when bool_or(presentato = 'no') then 'presentato' end], null))
    into v_valutati, v_presentato, v_foto, v_chiamata, v_no
    from scoperte;
  return jsonb_build_object(
    'valutati', v_valutati,
    'bollini', case when v_valutati >= v_bollini_dopo then
      jsonb_build_object('presentato', v_presentato, 'foto_sue', v_foto, 'come_in_chiamata', v_chiamata) end,
    'no_ricevuti', coalesce(v_no, '[]'::jsonb));
end $$;

revoke all on function public.riepilogo_valutazioni(uuid) from public, anon, authenticated;
grant execute on function public.riepilogo_valutazioni(uuid) to service_role;
