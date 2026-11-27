-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D12 A, D51 A) · linea «sviluppatore-b», passo 1 di «Ero lì» (solo database).
--   - Regole: chi risulta buca contesta entro 24 ore con «Ero lì» + testo (10-500 caratteri, spazi ai lati esclusi).
--   - Casi limite: «Non riesco a fare il check-in» apre la stessa contestazione già nella finestra del check-in (da
--     30 minuti prima dell'ora a 30 minuti dopo, più l'eventuale ritardo dichiarato) per chi non ha fatto «Sono qui».
--   - Una contestazione per persona e incontro. L'invio non muove crediti: decide una persona (in beta Giuseppe, D51 A)
--     nel passo successivo, insieme all'effetto sui crediti.
--   - Lo stato per il telefono è solo { contestabile, stato }: mai id, nomi o date dell'altra persona.
-- Solo aggiunte: nessuna funzione esistente cambia. Tutto solo dal server (service_role).

create table public.contestazioni_buca (
  id uuid primary key default gen_random_uuid(),
  porta_id uuid not null references public.incontri (porta_id) on delete cascade,
  persona uuid not null references auth.users (id) on delete cascade, -- chi contesta
  fase text not null check (fase in ('prima_della_buca', 'dopo_buca')),
  testo text not null check (char_length(testo) between 10 and 500),
  inviata_il timestamptz not null default now(),
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'accolta', 'respinta')),
  deciso_da uuid,
  deciso_il timestamptz,
  constraint decisione_completa check ((stato = 'in_attesa') = (deciso_il is null)),
  constraint una_per_incontro unique (porta_id, persona)
);
create index contestazioni_buca_persona on public.contestazioni_buca (persona);
create index contestazioni_buca_in_attesa on public.contestazioni_buca (inviata_il) where stato = 'in_attesa';

alter table public.contestazioni_buca enable row level security;
revoke all on public.contestazioni_buca from public, anon, authenticated;
grant select, insert, update, delete on public.contestazioni_buca to service_role;
-- Nessuna regola per authenticated: il telefono passa solo dal Worker.

-- In quale fase la persona può contestare adesso (null = non può). Legge l'incontro già aggiornato.
create function public.fase_contestazione_buca(p_i public.incontri, p_porta public.porte, p_persona uuid) returns text
  language sql stable set search_path = '' as $$
  select case
    when (p_i.esito = 'buca_a' and p_persona = p_porta.a) or (p_i.esito = 'buca_b' and p_persona = p_porta.b) then
      case when now() <= p_i.esito_il + interval '24 hours' then 'dopo_buca' end
    when p_i.esito is null and p_i.stato = 'confermato'
         and now() >= p_i.orario - interval '30 minutes'
         and now() < p_i.orario + make_interval(mins => 30 + p_i.ritardo_minuti)
         and (case when p_persona = p_porta.a then p_i.checkin_a_il else p_i.checkin_b_il end) is null then
      'prima_della_buca'
  end
$$;
revoke all on function public.fase_contestazione_buca(public.incontri, public.porte, uuid) from public, anon, authenticated;
grant execute on function public.fase_contestazione_buca(public.incontri, public.porte, uuid) to service_role;

-- Risposte: inviata, testo_non_valido, non_nella_porta, non_contestabile, gia_inviata.
create function public.contesta_buca(p_porta uuid, p_persona uuid, p_testo text) returns text
  language plpgsql set search_path = '' as $$
declare
  v_testo text := btrim(coalesce(p_testo, ''));
  v_porta public.porte;
  v_i public.incontri;
  v_fase text;
begin
  if char_length(v_testo) < 10 or char_length(v_testo) > 500 then
    return 'testo_non_valido';
  end if;
  select * into v_porta from public.porte where id = p_porta;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  v_i := public.incontro_aggiornato(p_porta); -- chiude per tempo se serve e blocca la riga (doppi tocchi)
  if v_i.porta_id is null then
    return 'non_contestabile';
  end if;
  if exists (select 1 from public.contestazioni_buca where porta_id = p_porta and persona = p_persona) then
    return 'gia_inviata';
  end if;
  v_fase := public.fase_contestazione_buca(v_i, v_porta, p_persona);
  if v_fase is null then
    return 'non_contestabile';
  end if;
  insert into public.contestazioni_buca (porta_id, persona, fase, testo) values (p_porta, p_persona, v_fase, v_testo);
  return 'inviata';
end $$;
revoke all on function public.contesta_buca(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.contesta_buca(uuid, uuid, text) to service_role;

-- Per il telefono: { contestabile, stato } (stato = null, in_attesa, accolta, respinta); null se non è nella porta.
create function public.stato_contestazione_buca(p_porta uuid, p_persona uuid) returns jsonb
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
  v_i public.incontri;
  v_stato text;
begin
  select * into v_porta from public.porte where id = p_porta;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return null;
  end if;
  v_i := public.incontro_aggiornato(p_porta);
  if v_i.porta_id is null then
    return null;
  end if;
  select stato into v_stato from public.contestazioni_buca where porta_id = p_porta and persona = p_persona;
  return jsonb_build_object('contestabile', v_stato is null and public.fase_contestazione_buca(v_i, v_porta, p_persona) is not null,
                            'stato', v_stato);
end $$;
revoke all on function public.stato_contestazione_buca(uuid, uuid) from public, anon, authenticated;
grant execute on function public.stato_contestazione_buca(uuid, uuid) to service_role;
