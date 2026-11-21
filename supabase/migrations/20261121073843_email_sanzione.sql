-- Fase 2 · issue #7 spec v1.1 punto 7 («Messaggio in app ed email») · decisione D144 A di Giuseppe (20/11).
-- Linea «sviluppatore-b», passo 15a. Come «Scrivici» (D140 A): dopo la decisione il pannello mostra a chi ha deciso il
-- testo pronto e l'indirizzo; l'email la manda lui dalla casella di Presente. Nessun invio automatico, nessun servizio
-- esterno. email_sanzione(moderatore, sanzione) → { a, livello, regola, fine_il } solo a un moderatore, solo per una
-- sanzione decisa da lui negli ultimi 7 giorni; mai chi ha segnalato, racconto o motivo interno. Solo server.
-- Solo aggiunte.
create function public.email_sanzione(p_moderatore uuid, p_sanzione uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('a', u.email, 'livello', z.livello, 'regola', z.regola, 'fine_il', z.fine_il)
  from public.sanzioni z
  join auth.users u on u.id = z.persona
  where z.id = p_sanzione and z.decisa_da = p_moderatore and public.e_moderatore(p_moderatore)
    and z.decisa_il > now() - interval '7 days' and u.email is not null
$$;
revoke all on function public.email_sanzione(uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_sanzione(uuid, uuid) to service_role;
