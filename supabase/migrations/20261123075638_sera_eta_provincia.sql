-- Design v4 (#349, D149 «Nome, età · provincia», risposta del CPO del 23/11), schermate 37-38 «La porta».
-- Linea «sviluppatore-c». sera_di aggiunge per ogni porta aperta «eta» e «provincia»: gli stessi dati già visibili
-- nella stanza (come compagni_di_stanza: nome della provincia, «Dall'estero», o la città se manca la provincia).
-- Mai data di nascita, sigla, foto, voce o altro. Stessa funzione di 20261122195850_sera_sagoma.sql con i due campi
-- in più. Solo ruolo di servizio.

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
      select jsonb_agg(jsonb_build_object('id', p.id, 'con', p.con, 'nome', pr.nome, 'frase_per_te', p.frase_per_te,
        'sagoma', case pr.mi_presento_come when 'uomo' then 'uomo' when 'donna' then 'donna' else 'neutra' end,
        'eta', extract(year from age(current_date, pr.data_nascita))::integer,
        'provincia', case when pr.provincia = 'EE' then 'Dall''estero' else coalesce(pv.nome, pr.citta) end) order by p.id)
      from public.porte_di(p_utente) p join s on p.stanza_id = s.id
      left join public.profili pr on pr.id = p.con
      left join public.province pv on pv.sigla = pr.provincia), '[]'::jsonb))
  end
$$;
revoke all on function public.sera_di(uuid) from public, anon, authenticated;
grant execute on function public.sera_di(uuid) to service_role;
