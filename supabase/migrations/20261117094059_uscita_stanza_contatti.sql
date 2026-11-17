-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D32 A, D51 A) · passo 14a della linea «sviluppatore-b».
-- «Contatti chiesti prima della porta»: se la revisione di una persona conferma → avviso + uscita dalla stanza in
-- corso (nessun rimborso dei 9 crediti); alla seconda volta in 6 mesi → sospensione di 7 giorni.
--   · uscita: una riga in uscite_stanza fino alla chiusura della stanza. La riga di membri_stanza NON si cancella
--     (lo storico delle stanze e la prima stanza gratis restano giusti). Finché la stanza è aperta sospeso() vale
--     true: gli altri non la vedono più, niente chiamate né chiavi (stessi controlli delle altre linee), le sue
--     chiavi si annullano. Un ricorso accolto (annullata_il) la toglie.
--   · seconda volta: il database rifiuta «avviso» e chiede la sospensione di 7 giorni (la decide sempre una persona).
-- Valori uguali a api/segnalazioni.js (LIMITI.recidivaContattiMesi, sanzioneContatti). Tutto SOLO per il server.
-- Solo aggiunte: una tabella, due trigger, sospeso() con stessa firma e permessi.

create table public.uscite_stanza (
  id uuid primary key default gen_random_uuid(),
  -- Nessuna chiave verso auth.users: se la persona elimina l'account l'uscita resta nel registro.
  persona uuid not null,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  segnalazione_id uuid not null references public.segnalazioni (id),
  sanzione_id uuid not null references public.sanzioni (id),
  fino_il timestamptz not null,
  quando timestamptz not null default now(),
  unique (persona, stanza_id)
);
create index uscite_stanza_persona on public.uscite_stanza (persona, fino_il);

alter table public.uscite_stanza enable row level security;
revoke all on public.uscite_stanza from public, anon, authenticated, service_role;
grant select on public.uscite_stanza to service_role;
-- Nessuna regola per authenticated: il telefono non legge nulla qui.

-- Prima di salvare un avviso per contatti chiesti prima della porta: se c'è già un'altra sanzione confermata per
-- lo stesso motivo negli ultimi 6 mesi (non annullata da un ricorso), serve la sospensione di 7 giorni.
create function public.recidiva_contatti() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.livello = 'avviso'
     and exists (select 1 from public.segnalazioni s where s.id = new.segnalazione_id and s.motivo = 'contatti_prima_porta')
     and exists (select 1 from public.sanzioni z join public.segnalazioni s on s.id = z.segnalazione_id
                 where z.persona = new.persona and s.motivo = 'contatti_prima_porta' and z.annullata_il is null
                   and z.decisa_il > now() - interval '6 months') then
    raise exception 'seconda_volta_contatti' using errcode = 'check_violation',
      hint = 'Seconda volta in 6 mesi: serve la sospensione di 7 giorni.';
  end if;
  return new;
end $$;
revoke all on function public.recidiva_contatti() from public, anon, authenticated;
create trigger recidiva_contatti before insert on public.sanzioni
  for each row execute function public.recidiva_contatti();

-- Dopo un avviso o una sospensione per contatti chiesti prima della porta: uscita dalla stanza aperta adesso.
create function public.uscita_per_contatti() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.segnalazioni s where s.id = new.segnalazione_id and s.motivo = 'contatti_prima_porta') then
    insert into public.uscite_stanza (persona, stanza_id, segnalazione_id, sanzione_id, fino_il)
      select new.persona, st.id, new.segnalazione_id, new.id, st.chiude_il
      from public.membri_stanza m join public.stanze st on st.id = m.stanza_id
      where m.utente_id = new.persona and now() >= st.apre_il and now() < st.chiude_il
      on conflict (persona, stanza_id) do nothing;
  end if;
  return null;
end $$;
revoke all on function public.uscita_per_contatti() from public, anon, authenticated;
create trigger uscita_per_contatti after insert on public.sanzioni
  for each row when (new.livello in ('avviso', 'sospensione_7')) execute function public.uscita_per_contatti();

-- Chi esce dalla stanza perde le chiavi date e ricevute (stessa funzione della sospensione).
create trigger annulla_chiavi_per_uscita after insert on public.uscite_stanza
  for each row execute function public.annulla_chiavi_per_sospensione();

-- Come nel passo 13d, in più: uscita dalla stanza ancora aperta e non annullata da un ricorso.
create or replace function public.sospeso(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sospensioni where persona = p_persona and tolta_il is null)
      or exists (select 1 from public.sanzioni where persona = p_persona and annullata_il is null
                 and (livello = 'esclusione' or (livello in ('sospensione_7', 'sospensione_30') and fine_il > now())))
      or exists (select 1 from public.uscite_stanza u join public.sanzioni z on z.id = u.sanzione_id
                 where u.persona = p_persona and u.fino_il > now() and z.annullata_il is null)
$$;
