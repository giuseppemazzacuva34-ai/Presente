-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D51 A) · linea «sviluppatore-c», passo 5c: il nome nella sera delle porte.
-- Spec, passo 8: «Una porta si è aperta: <nome>.» e «<nome> ti ha scritto:». Alle 21:00 la stanza è chiusa e
-- compagni_di_stanza (solo stanze aperte) non dà più i nomi: sera_di li aggiunge, SOLO per le porte aperte.
-- Solo il nome scelto nel profilo (lo stesso già visto nella stanza): mai foto, cognome, età o città.
-- Stessa funzione della migrazione 20261114105557_chiavi_sera.sql, con in più il campo «nome». Solo ruolo di servizio.

create or replace function public.sera_di(p_utente uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  with s as (
    select st.id from public.stanze st join public.membri_stanza m on m.stanza_id = st.id and m.utente_id = p_utente
    where st.chiude_il <= now() and now() < st.chiude_il + interval '12 hours'
    order by st.chiude_il desc limit 1
  )
  select case
    when not exists (select 1 from s) then jsonb_build_object('stato', 'nessuna')
    when not exists (select 1 from public.serate_porte sp join s on sp.stanza_id = s.id) then jsonb_build_object('stato', 'attesa')
    else jsonb_build_object('stato', 'pronta', 'porte', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'con', p.con, 'nome', pr.nome, 'frase_per_te', p.frase_per_te) order by p.id)
      from public.porte_di(p_utente) p join s on p.stanza_id = s.id
      left join public.profili pr on pr.id = p.con), '[]'::jsonb))
  end
$$;
revoke all on function public.sera_di(uuid) from public, anon, authenticated;
grant execute on function public.sera_di(uuid) to service_role;
