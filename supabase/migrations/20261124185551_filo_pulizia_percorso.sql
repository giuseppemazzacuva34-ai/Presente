-- Fase 2 · issue #360 «Il Filo della stanza» · correzione della pulizia dei vocali (passo 11a, linea «sviluppatore-c»).
-- Difetto: salva_vocale_filo salva in vocali_filo.file il percorso intero nel contenitore («<stanza>/<nome>»), ma
-- vocali_filo_scaduti e togli_vocali_filo ci mettevano davanti di nuovo la stanza («<stanza>/<stanza>/<nome>»). Il
-- Worker rifiutava quei percorsi e i vocali delle stanze chiuse non si cancellavano mai dopo 7 giorni.
-- Correzione: il percorso è vocali_filo.file così com'è. Stesse firme, stesse regole di prima (solo sostituzioni di
-- funzioni, nessun dato toccato); le cancellazioni hanno sempre il filtro dei 7 giorni.

create or replace function public.vocali_filo_scaduti(p_ora timestamptz)
  returns table (percorso text)
  language sql stable security definer set search_path = '' as $$
  select v.file
  from public.vocali_filo v
    join public.stanze s on s.id = v.stanza_id
  where p_ora is not null and s.chiude_il + interval '7 days' <= p_ora
  order by s.chiude_il, v.stanza_id, v.tipo
  limit 100
$$;
revoke all on function public.vocali_filo_scaduti(timestamptz) from public, anon, authenticated;
grant execute on function public.vocali_filo_scaduti(timestamptz) to service_role;

create or replace function public.togli_vocali_filo(p_percorsi text[], p_ora timestamptz) returns integer
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
      and v.file = any (p_percorsi);
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
