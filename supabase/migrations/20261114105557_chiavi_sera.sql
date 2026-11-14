-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D14 A, D51 A) · linea «sviluppatore-c», passo 5a: cosa chiede il telefono.
-- Due funzioni di sola lettura, una risposta ciascuna, per la richiesta del Worker /app/api/chiavi (passo 5b):
-- - stato_chiavi: «Le tue chiavi: N», le chiavi che HAI DATO tu con la tua frase, l'ora di chiusura per il conto
--   alla rovescia e se le chiavi sono già chiuse (dalle 20:59:00). Mai le chiavi ricevute.
-- - sera_di: la schermata delle 21:00, visibile fino a lunedì 9:00 (12 ore dopo la chiusura): «attesa» finché il
--   calcolo delle porte non è fatto, poi «pronta» con le porte e la frase lasciata dall'ALTRA persona.
--   Chi non ha porte riceve sempre {"stato":"pronta","porte":[]}: nessuno scopre un no.
-- Solo il server (ruolo di servizio): il telefono le riceve dal Worker, mai dal database.

create function public.stato_chiavi(p_utente uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select case when s.id is null then jsonb_build_object('stanza', false)
  else jsonb_build_object(
    'stanza', true,
    'chiude_il', s.chiude_il,
    'chiuse', now() >= s.chiude_il - interval '1 minute',
    'restanti', greatest(0, 2 - (select count(*) from public.chiavi c where c.stanza_id = s.id and c.da = p_utente))::int,
    'date', coalesce((select jsonb_agg(jsonb_build_object('a', c.a, 'frase', c.frase) order by c.data_il, c.a)
                      from public.chiavi c where c.stanza_id = s.id and c.da = p_utente), '[]'::jsonb))
  end
  from (select (public.stanza_aperta_di(p_utente)).*) s
$$;
revoke all on function public.stato_chiavi(uuid) from public, anon, authenticated;
grant execute on function public.stato_chiavi(uuid) to service_role;

create function public.sera_di(p_utente uuid) returns jsonb
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
      select jsonb_agg(jsonb_build_object('id', p.id, 'con', p.con, 'frase_per_te', p.frase_per_te) order by p.id)
      from public.porte_di(p_utente) p join s on p.stanza_id = s.id), '[]'::jsonb))
  end
$$;
revoke all on function public.sera_di(uuid) from public, anon, authenticated;
grant execute on function public.sera_di(uuid) to service_role;
