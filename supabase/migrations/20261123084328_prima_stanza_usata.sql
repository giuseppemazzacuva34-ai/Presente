-- Fase 2 · issue #349 / spec #331 v1.1 (CPO, 23/11), punto 5 · linea «sviluppatore-b».
-- Il foglio «Coin quasi finiti» (schermata 21) non compare a chi non ha ancora usato la prima stanza in regalo.
-- Qui solo una funzione di lettura: vero se la persona è entrata almeno in una stanza. Nessuna tabella nuova,
-- nessun SQL distruttivo. Solo il server (service_role) la chiama; il telefono no. Usa l'indice membri_stanza_utente.

create function public.prima_stanza_usata(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(exists (select 1 from public.membri_stanza m where m.utente_id = p_persona), false)
$$;
revoke all on function public.prima_stanza_usata(uuid) from public, anon, authenticated;
grant execute on function public.prima_stanza_usata(uuid) to service_role;
