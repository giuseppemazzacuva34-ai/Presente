-- Fase 2 · issue #65 spec v1 (CPO; D18 A, D12 A; risposta CPO 13/11) · passo 3 della linea «sviluppatore».
-- Saldo crediti e caparra dello svelamento. In beta i crediti sono un CONTATORE INTERNO, senza soldi veri
-- (Stripe in Fase 4, solo con decisione di Giuseppe): i crediti di prova si assegnano dal pannello.
-- Il saldo è la somma di un registro in sola aggiunta (crediti_movimenti): nessuna riga si modifica o si cancella,
-- così ogni credito ha una storia. La caparra bloccata è un movimento di -10 legato alla porta; la restituzione +10.
-- Il saldo non va mai sotto zero e ogni persona ha al massimo una caparra (e una restituzione) per porta.
-- Le legge e le scrive SOLO il server (ruolo di servizio), mai il telefono. Nessun dato personale oltre all'id.

create table public.crediti_movimenti (
  id bigint generated always as identity primary key,
  persona uuid not null references auth.users (id) on delete cascade,
  quando timestamptz not null default now(),
  -- assegnati_beta: crediti di prova; caparra_bloccata/caparra_restituita: svelamento (#65); stanza: 9 crediti (D18, lunedì).
  -- Le penali della buca (7 a chi aspetta, 3 a Presente, D12) arrivano con la #6.
  tipo text not null check (tipo in ('assegnati_beta', 'caparra_bloccata', 'caparra_restituita', 'stanza')),
  crediti integer not null,
  porta_id uuid references public.porte (id) on delete cascade,
  constraint importi_previsti check (
    (tipo = 'assegnati_beta' and crediti between 1 and 500 and porta_id is null)
    or (tipo = 'caparra_bloccata' and crediti = -10 and porta_id is not null)
    or (tipo = 'caparra_restituita' and crediti = 10 and porta_id is not null)
    or (tipo = 'stanza' and crediti = -9 and porta_id is null))
);
-- Una sola caparra e una sola restituzione per persona e porta.
create unique index crediti_una_caparra on public.crediti_movimenti (persona, porta_id, tipo)
  where tipo in ('caparra_bloccata', 'caparra_restituita');
create index crediti_per_persona on public.crediti_movimenti (persona);

create function public.saldo_crediti(p_persona uuid) returns integer
  language sql stable set search_path = '' as $$
  select coalesce(sum(crediti), 0)::integer from public.crediti_movimenti where persona = p_persona
$$;

-- Registro in sola aggiunta, saldo mai negativo (controllato sotto un lucchetto per persona, così due richieste
-- insieme non scalano due volte lo stesso credito).
create function public.crediti_controlla() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'il registro dei crediti non si modifica: si aggiungono movimenti';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crediti:' || new.persona::text, 0));
  if public.saldo_crediti(new.persona) + new.crediti < 0 then
    raise exception 'saldo crediti insufficiente';
  end if;
  if new.tipo = 'caparra_restituita' and not exists (select 1 from public.crediti_movimenti
      where persona = new.persona and porta_id = new.porta_id and tipo = 'caparra_bloccata') then
    raise exception 'nessuna caparra da restituire';
  end if;
  return new;
end $$;
create trigger crediti_controlla before insert or update on public.crediti_movimenti
  for each row execute function public.crediti_controlla();
-- La cancellazione resta possibile solo a cascata, quando un account viene eliminato (diritto all'oblio).

-- Crediti di prova della beta, dal pannello di amministrazione.
create function public.assegna_crediti_beta(p_persona uuid, p_crediti integer) returns integer
  language plpgsql set search_path = '' as $$
begin
  insert into public.crediti_movimenti (persona, tipo, crediti) values (p_persona, 'assegnati_beta', p_crediti);
  return public.saldo_crediti(p_persona);
end $$;

-- «Blocca 10 crediti». Risposte: bloccata, gia_bloccata, crediti_insufficienti, non_nella_porta, porta_chiusa.
-- Porta chiusa = esito già deciso o caparre già restituite. Le scadenze (48 ore) le controlla il server prima di chiamarla.
create function public.blocca_caparra(p_porta uuid, p_persona uuid) returns text
  language plpgsql set search_path = '' as $$
declare
  v_porta public.porte;
begin
  select * into v_porta from public.porte where id = p_porta for update;
  if not found or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  if exists (select 1 from public.svelamenti where porta_id = p_porta and esito is not null)
     or exists (select 1 from public.crediti_movimenti where porta_id = p_porta and tipo = 'caparra_restituita') then
    return 'porta_chiusa';
  end if;
  if exists (select 1 from public.crediti_movimenti where porta_id = p_porta and persona = p_persona and tipo = 'caparra_bloccata') then
    return 'gia_bloccata';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crediti:' || p_persona::text, 0));
  if public.saldo_crediti(p_persona) < 10 then
    return 'crediti_insufficienti';
  end if;
  insert into public.crediti_movimenti (persona, tipo, crediti, porta_id) values (p_persona, 'caparra_bloccata', -10, p_porta);
  insert into public.svelamenti (porta_id) values (p_porta) on conflict (porta_id) do nothing;
  if p_persona = v_porta.a then
    update public.svelamenti set caparra_a_il = now() where porta_id = p_porta;
  else
    update public.svelamenti set caparra_b_il = now() where porta_id = p_porta;
  end if;
  return 'bloccata';
end $$;

-- Restituzione a entrambi (un no, il silenzio, porta scaduta, blocco, «Chiudi e segnala», sospensione: risposta CPO 13/11).
-- Mai una penale qui. Idempotente: restituisce solo le caparre non ancora restituite; ritorna quante.
create function public.restituisci_caparre(p_porta uuid) returns integer
  language plpgsql set search_path = '' as $$
declare
  v_quante integer;
begin
  perform 1 from public.porte where id = p_porta for update;
  insert into public.crediti_movimenti (persona, tipo, crediti, porta_id)
    select b.persona, 'caparra_restituita', 10, p_porta from public.crediti_movimenti b
    where b.porta_id = p_porta and b.tipo = 'caparra_bloccata'
      and not exists (select 1 from public.crediti_movimenti r
        where r.porta_id = p_porta and r.persona = b.persona and r.tipo = 'caparra_restituita');
  get diagnostics v_quante = row_count;
  return v_quante;
end $$;

alter table public.crediti_movimenti enable row level security;
revoke all on public.crediti_movimenti from public, anon, authenticated;
grant select, insert, update, delete on public.crediti_movimenti to service_role;
grant usage on sequence public.crediti_movimenti_id_seq to service_role;
-- Nessuna regola per authenticated: il saldo arriva al telefono solo tramite il server.
revoke all on function public.saldo_crediti(uuid) from public, anon, authenticated;
revoke all on function public.crediti_controlla() from public, anon, authenticated;
revoke all on function public.assegna_crediti_beta(uuid, integer) from public, anon, authenticated;
revoke all on function public.blocca_caparra(uuid, uuid) from public, anon, authenticated;
revoke all on function public.restituisci_caparre(uuid) from public, anon, authenticated;
grant execute on function public.saldo_crediti(uuid) to service_role;
grant execute on function public.assegna_crediti_beta(uuid, integer) to service_role;
grant execute on function public.blocca_caparra(uuid, uuid) to service_role;
grant execute on function public.restituisci_caparre(uuid) to service_role;
