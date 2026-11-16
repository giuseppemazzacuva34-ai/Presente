-- Fase 2 · issue #65 spec v1 (CPO; D48 A, D12 A, D18 A) · passo 4a della linea «sviluppatore»: la caparra dal server.
-- Due funzioni che userà il Worker (/app/api/svelamento, passo 4b):
--   · caparra_svelamento(porta, persona): prima di bloccare i 10 crediti chiude la porta se nel frattempo c'è un blocco
--     tra i due, una persona sospesa o sono passate le 48 ore senza svelamento; in quei casi restituisce le caparre a
--     ENTRAMBI (risposta CPO 13/11: la sospensione è una sanzione sull'account, non sui crediti), mai una penale.
--   · svelamento_di(persona): saldo e porte in attesa di svelamento di chi chiede, con nome ed età dell'altra persona e
--     chi ha già bloccato. Prima di leggere sistema allo stesso modo le porte di chi chiede (così i crediti tornano anche
--     se nessuno tocca più nulla). Mai email, data di nascita, frasi o risposte sì/no.
-- Le chiamano SOLO il server (ruolo di servizio), mai il telefono. Nessun dato personale nei messaggi d'errore.

-- Chiude una porta prima dell'esito e restituisce le caparre. Idempotente: se l'esito c'è già non cambia nulla.
create function public.chiudi_porta_svelamento(p_porta uuid, p_esito text) returns void
  language plpgsql set search_path = '' as $$
begin
  if p_esito not in ('scaduta', 'blocco', 'sospensione') then
    raise exception 'esito di chiusura non previsto';
  end if;
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  update public.svelamenti set esito = p_esito, esito_il = now(), risposta_a = null, risposta_b = null
    where porta_id = p_porta and esito is null;
  perform public.restituisci_caparre(p_porta);
end $$;

-- Perché una porta ancora senza esito va chiusa adesso (null = resta aperta). Uno svelamento già iniziato prima della
-- scadenza si completa (spec, «Casi limite»): la scadenza delle 48 ore vale solo se non è mai iniziato.
create function public.porta_da_chiudere(p_porta uuid) returns text
  language sql stable security definer set search_path = '' as $$
  select case
    when public.bloccati_tra(p.a, p.b) then 'blocco'
    when public.sospeso(p.a) or public.sospeso(p.b) then 'sospensione'
    when now() >= p.aperta_il + interval '48 hours' and s.iniziato_il is null then 'scaduta'
  end
  from public.porte p left join public.svelamenti s on s.porta_id = p.id
  where p.id = p_porta and s.esito is null
$$;

-- «Blocca 10 crediti». Risposte: bloccata, gia_bloccata, crediti_insufficienti, non_nella_porta, porta_chiusa,
-- porta_scaduta. Blocco e sospensione danno «porta_chiusa» (non si dice mai il motivo all'altra persona).
create function public.caparra_svelamento(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_chiudi text;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  -- Già chiusa (anche da svelamento_di): per la scadenza il testo giusto è «porta_scaduta».
  select esito into v_chiudi from public.svelamenti where porta_id = p_porta;
  if v_chiudi is not null then
    return case when v_chiudi = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  v_chiudi := public.porta_da_chiudere(p_porta);
  if v_chiudi is not null then
    perform public.chiudi_porta_svelamento(p_porta, v_chiudi);
    return case when v_chiudi = 'scaduta' then 'porta_scaduta' else 'porta_chiusa' end;
  end if;
  return public.blocca_caparra(p_porta, p_persona);
end $$;

-- { saldo, porte: [{ porta, con, nome, eta, aperta_il, scade_il, mia_caparra, sua_caparra }] } dalla più recente.
-- security definer come porte_di: il ruolo di servizio non legge profili direttamente; qui escono solo nome ed età.
create function public.svelamento_di(p_utente uuid) returns jsonb
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
          'sua_caparra', (case when p.a = p_utente then s.caparra_b_il else s.caparra_a_il end) is not null)
        order by p.aperta_il desc, p.id)
      from public.porte p
      left join public.svelamenti s on s.porta_id = p.id
      left join public.profili pr on pr.id = case when p.a = p_utente then p.b else p.a end
      where (p.a = p_utente or p.b = p_utente)
        and s.esito is null
        and s.iniziato_il is null -- quando lo svelamento è iniziato la porta passa alle schermate successive (4c)
    ), '[]'::jsonb));
end $$;

revoke all on function public.chiudi_porta_svelamento(uuid, text) from public, anon, authenticated;
revoke all on function public.porta_da_chiudere(uuid) from public, anon, authenticated;
revoke all on function public.caparra_svelamento(uuid, uuid) from public, anon, authenticated;
revoke all on function public.svelamento_di(uuid) from public, anon, authenticated;
grant execute on function public.chiudi_porta_svelamento(uuid, text) to service_role;
grant execute on function public.porta_da_chiudere(uuid) to service_role;
grant execute on function public.caparra_svelamento(uuid, uuid) to service_role;
grant execute on function public.svelamento_di(uuid) to service_role;
