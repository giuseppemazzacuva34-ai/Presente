-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D51 A) · linea «sviluppatore-b»: «Le tue chiamate».
-- Caso limite della spec: «Persona già bloccata: si può ancora segnalare dallo storico delle chiamate per 30 giorni».
-- Le righe di public.chiamate il telefono le legge già (regola per riga «vedi solo quelle in cui ci sei»); qui si
-- aggiunge solo il nome dell'altra persona, che altrimenti si vede solo nella stanza aperta (compagni_di_stanza).
-- Restituisce SOLO id, nome, inizio e durata delle chiamate finite degli ultimi 30 giorni di chi chiede (dal token):
-- mai età, città, foto, esito, questionario o diario. Il blocco non cambia niente: chi blocca può ancora segnalare,
-- chi è bloccato non lo scopre. Solo aggiunte: nessuna tabella o regola esistente cambia.
create function public.mie_chiamate_recenti()
  returns table (con uuid, nome text, inizio timestamptz, durata integer)
  language sql stable security definer set search_path = '' as $$
  select x.altro, p.nome, x.inizio, x.durata
  from (
    select case when k.chi = (select auth.uid()) then k.con else k.chi end as altro, k.inizio, k.durata
    from public.chiamate k
    where (k.chi = (select auth.uid()) or k.con = (select auth.uid()))
      and k.durata is not null
      and k.inizio >= now() - interval '30 days'
  ) x
  left join public.profili p on p.id = x.altro
  order by x.inizio desc
  limit 100
$$;
revoke all on function public.mie_chiamate_recenti() from public, anon;
grant execute on function public.mie_chiamate_recenti() to authenticated;
