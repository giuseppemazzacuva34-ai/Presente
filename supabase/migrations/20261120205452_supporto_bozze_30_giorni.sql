-- Fase 2 · issue #10 parte B v1 (CPO, 13/11), «Conservazione»: la bozza si cancella 30 giorni dopo la risposta; il
-- messaggio segue le regole della parte A (resta, si cancella con l'account). D122 B. Linea «sviluppatore-c».
-- Ogni ora il Worker (cron «23 * * * *» già esistente, gratuito) chiama questa funzione col ruolo di servizio.
-- Scelta tecnica: 720 ore esatte (30 × 24), così il cambio dell'ora legale e il fuso della sessione non spostano il
-- momento. Le bozze dei messaggi senza risposta non si toccano. p_ora serve ai test (orologio simulato). Solo aggiunte.
create function public.pulisci_bozze_supporto(p_ora timestamptz default now()) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  delete from public.supporto_bozze b using public.supporto s
    where s.id = b.messaggio_id and s.risposto_il is not null
      and s.risposto_il <= coalesce(p_ora, now()) - interval '720 hours';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.pulisci_bozze_supporto(timestamptz) from public, anon, authenticated;
grant execute on function public.pulisci_bozze_supporto(timestamptz) to service_role;
