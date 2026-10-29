-- Revisione di sicurezza del CISO (T15, 29/10) sulla migrazione del profilo. Nessun cambiamento visibile all'utente.
-- 1. Questionario: le risposte e i «quanto conta» hanno un tetto di grandezza. 15 domande occupano poche centinaia
--    di byte; senza tetto un account potrebbe salvare JSON enormi e riempire il database.
-- 2. Funzioni con search_path fisso (vuoto): non si possono ingannare con tabelle o funzioni omonime create altrove
--    (avviso «function_search_path_mutable» del controllo di sicurezza di Supabase). Tutti i nomi sono già completi.
alter table public.questionario
  add constraint questionario_risposte_piccole check (pg_column_size(risposte) <= 8192),
  add constraint questionario_importanza_piccola check (pg_column_size(importanza) <= 2048);

alter function public.controlla_profilo() set search_path = '';
alter function public.controlla_questionario() set search_path = '';
alter function public.prossima_apertura(timestamptz) set search_path = '';
