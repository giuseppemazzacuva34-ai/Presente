-- Svelamento, passo 6a (issue #65, spec v1 del CPO, passi 4, 5 e 7; linea «sviluppatore»).
--   · momento_svelamento(riga): true se lo svelamento si può fare adesso: caparra di tutti e due e
--     tutti e due «pronti» negli ultimi 5 minuti, oppure dentro la mezz'ora fissata.
--   · svelamento_di(persona): come prima più «momento» e, solo nel momento, «tipo» (video o foto).
--     «Preferisco le foto» di uno vale per entrambi: così la sala d'attesa non accende la fotocamera.
--     Prima del momento il tipo non esce, quindi la scelta dell'altra persona resta segreta.
-- Nessun dato nuovo salvato, nessuna tabella nuova.

create function public.momento_svelamento(s public.svelamenti) returns boolean
  language sql stable security definer set search_path = '' as $$
  select coalesce(
    s.caparra_a_il is not null and s.caparra_b_il is not null and s.iniziato_il is null and s.esito is null
    and (
      (now() - s.pronto_a_il < interval '5 minutes' and now() - s.pronto_b_il < interval '5 minutes')
      or (s.fascia_fissata <= now() and now() < s.fascia_fissata + interval '30 minutes')
    ), false)
$$;

-- { saldo, porte: [{ porta, con, nome, eta, aperta_il, scade_il, mia_caparra, sua_caparra, mia_scelta,
--                    mie_fasce, fascia_fissata, mio_pronto, suo_pronto, pronto_scade_il,
--                    momento, tipo }] }.
create or replace function public.svelamento_di(p_utente uuid) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_porta uuid;
  v_chiudi text;
begin
  -- Prima si sistemano le porte di chi chiede: scadute, con un blocco o con una persona sospesa.
  for v_porta in
    select p.id from public.porte p left join public.svelamenti s on s.porta_id = p.id
    where (p.a = p_utente or p.b = p_utente) and s.esito is null
    order by p.id
  loop
    v_chiudi := public.porta_da_chiudere(v_porta);
    if v_chiudi is not null then
      perform public.chiudi_porta_svelamento(v_porta, v_chiudi);
    end if;
  end loop;

  return jsonb_build_object(
    'saldo', public.saldo_crediti(p_utente),
    'porte', coalesce((
      select jsonb_agg(jsonb_build_object(
          'porta', p.id,
          'con', case when p.a = p_utente then p.b else p.a end,
          'nome', pr.nome,
          'eta', extract(year from age(pr.data_nascita))::int,
          'aperta_il', p.aperta_il,
          'scade_il', p.aperta_il + interval '48 hours',
          'mia_caparra', (case when p.a = p_utente then s.caparra_a_il else s.caparra_b_il end) is not null,
          'sua_caparra', (case when p.a = p_utente then s.caparra_b_il else s.caparra_a_il end) is not null,
          -- Passo 3a: solo la propria scelta (predefinita «video» anche senza riga); mai quella dell'altra persona.
          'mia_scelta', coalesce(case when p.a = p_utente then s.scelta_a else s.scelta_b end, 'video'),
          -- Passo 5a: le proprie fasce e quella fissata; mai le fasce dell'altra persona.
          'mie_fasce', to_jsonb(coalesce(case when p.a = p_utente then s.fasce_a else s.fasce_b end, '{}'::timestamptz[])),
          'fascia_fissata', case when s.fascia_fissata + interval '30 minutes' > now() then s.fascia_fissata end,
          'mio_pronto', coalesce(now() - (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) < interval '5 minutes', false),
          'suo_pronto', coalesce(now() - (case when p.a = p_utente then s.pronto_b_il else s.pronto_a_il end) < interval '5 minutes', false),
          'pronto_scade_il', case when now() - (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) < interval '5 minutes'
            then (case when p.a = p_utente then s.pronto_a_il else s.pronto_b_il end) + interval '5 minutes' end,
          -- Passo 6a: «momento» = lo svelamento si può fare adesso (due caparre e tutti e due pronti entro 5 minuti,
          -- oppure dentro la mezz'ora fissata). Solo allora esce il «tipo»: foto se almeno uno ha scelto le foto.
          'momento', public.momento_svelamento(s),
          'tipo', case when public.momento_svelamento(s)
            then case when 'foto' in (coalesce(s.scelta_a, 'video'), coalesce(s.scelta_b, 'video')) then 'foto' else 'video' end end)
        order by p.aperta_il desc, p.id)
      from public.porte p
      left join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.esito is null
        and s.iniziato_il is null -- quando lo svelamento è iniziato la porta passa alle schermate successive (4c)
    ), '[]'::jsonb));
end $$;

revoke all on function public.momento_svelamento(public.svelamenti) from public, anon, authenticated;
revoke all on function public.svelamento_di(uuid) from public, anon, authenticated;
grant execute on function public.momento_svelamento(public.svelamenti) to service_role;
grant execute on function public.svelamento_di(uuid) to service_role;
