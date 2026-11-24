-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 11a della linea
-- «sviluppatore-c»: «I file dei vocali spariscono 7 giorni dopo la chiusura».
--   · vocali_filo_scaduti(p_ora): i percorsi nel contenitore privato «vocali_filo» (<stanza>/<file>) dei vocali delle
--     stanze chiuse da almeno 7 giorni, al massimo 100 per giro.
--   · togli_vocali_filo(p_percorsi, p_ora): toglie le righe di quei vocali, SOLO se sono davvero scaduti (un percorso
--     non scaduto o inventato non toglie nulla), e con loro «già vista» (filo_benvenuti_visti) e «già ascoltato»
--     (filo_vocali_ascoltati) delle stanze chiuse da almeno 7 giorni → quanti vocali ha tolto.
-- Ordine nel Worker (passo 11b, ogni ora col cron già esistente): elenco → cancella i file dal contenitore → togli le
-- righe. Se la cancellazione dei file non riesce, le righe restano e si riprova al giro dopo: nessun file orfano.
-- Tutto SOLO per il server (chiave del server). Solo aggiunte di funzioni; le cancellazioni hanno sempre il filtro.

create function public.vocali_filo_scaduti(p_ora timestamptz)
  returns table (percorso text)
  language sql stable security definer set search_path = '' as $$
  select v.stanza_id::text || '/' || v.file
  from public.vocali_filo v
    join public.stanze s on s.id = v.stanza_id
  where p_ora is not null and s.chiude_il + interval '7 days' <= p_ora
  order by s.chiude_il, v.stanza_id, v.tipo
  limit 100
$$;
revoke all on function public.vocali_filo_scaduti(timestamptz) from public, anon, authenticated;
grant execute on function public.vocali_filo_scaduti(timestamptz) to service_role;

create function public.togli_vocali_filo(p_percorsi text[], p_ora timestamptz) returns integer
  language plpgsql volatile security definer set search_path = '' as $$
declare
  tolti integer := 0;
begin
  if p_ora is null then
    return 0;
  end if;
  if p_percorsi is not null and cardinality(p_percorsi) > 0 then
    delete from public.vocali_filo v
    using public.stanze s
    where s.id = v.stanza_id
      and s.chiude_il + interval '7 days' <= p_ora
      and v.stanza_id::text || '/' || v.file = any (p_percorsi);
    get diagnostics tolti = row_count;
  end if;
  delete from public.filo_benvenuti_visti b
  using public.stanze s
  where s.id = b.stanza_id and s.chiude_il + interval '7 days' <= p_ora;
  delete from public.filo_vocali_ascoltati a
  using public.stanze s
  where s.id = a.stanza_id and s.chiude_il + interval '7 days' <= p_ora;
  return tolti;
end $$;
revoke all on function public.togli_vocali_filo(text[], timestamptz) from public, anon, authenticated;
grant execute on function public.togli_vocali_filo(text[], timestamptz) to service_role;
