-- Fase 2 · issue #65 spec v1 (CPO; D48 A) · passo 3a della linea «sviluppatore»: «Come vuoi lo svelamento».
-- Due scelte: «Videochiamata di 10 secondi» (predefinita) o «Preferisco le foto»; si cambia fino all'inizio dello
-- svelamento (il trigger svelamenti_scelta_ferma lo garantisce anche nel database). Chi sceglie le foto non dà motivi.
--   · scelta_svelamento(porta, persona, scelta): salva SOLO la scelta di chi chiede. Prima, come caparra_svelamento,
--     chiude la porta se c'è un blocco, una persona sospesa o sono passate 48 ore (crediti restituiti a entrambi).
--     Risposte: salvata, scelta_non_valida, non_nella_porta, porta_chiusa, porta_scaduta, gia_iniziato.
--   · svelamento_di(persona): come prima più «mia_scelta». La scelta dell'altra persona non esce mai: al momento dello
--     svelamento si dirà solo «Lo svelamento sarà con le foto.», senza motivo (passo 7, linea successiva).
-- Solo il server (ruolo di servizio), mai il telefono. Nessun dato personale nei messaggi d'errore.

create function public.scelta_svelamento(p_porta uuid, p_persona uuid, p_scelta text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_chiudi text;
  v_iniziato timestamptz;
begin
  if p_scelta is null or p_scelta not in ('video', 'foto') then
    return 'scelta_non_valida';
  end if;
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select esito, iniziato_il into v_chiudi, v_iniziato from public.svelamenti where porta_id = p_porta;
  if v_chiudi is not null then
    return case when v_chiudi = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  if v_iniziato is not null then
    return 'gia_iniziato';
  end if;
  v_chiudi := public.porta_da_chiudere(p_porta);
  if v_chiudi is not null then
    perform public.chiudi_porta_svelamento(p_porta, v_chiudi);
    return case when v_chiudi = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  if p_persona = v_porta.a then
    update public.svelamenti set scelta_a = p_scelta where porta_id = p_porta;
  else
    update public.svelamenti set scelta_b = p_scelta where porta_id = p_porta;
  end if;
  return 'salvata';
end $$;

-- { saldo, porte: [{ porta, con, nome, eta, aperta_il, scade_il, mia_caparra, sua_caparra, mia_scelta }] }.
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
          'mia_scelta', coalesce(case when p.a = p_utente then s.scelta_a else s.scelta_b end, 'video'))
        order by p.aperta_il desc, p.id)
      from public.porte p
      left join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.esito is null
        and s.iniziato_il is null -- quando lo svelamento è iniziato la porta passa alle schermate successive (4c)
    ), '[]'::jsonb));
end $$;

revoke all on function public.scelta_svelamento(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.svelamento_di(uuid) from public, anon, authenticated;
grant execute on function public.scelta_svelamento(uuid, uuid, text) to service_role;
grant execute on function public.svelamento_di(uuid) to service_role;
