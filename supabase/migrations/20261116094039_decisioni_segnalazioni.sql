-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D32 A, D51 A) · passo 12a della linea «sviluppatore-b».
-- La decisione di una persona sulle segnalazioni («Cosa vede chi decide»): Archivia · Avviso · Sospensione 7 giorni ·
-- Sospensione 30 giorni · Esclusione definitiva · Togli sospensione cautelare. Motivo obbligatorio (regola + testo).
-- Ogni apertura e ogni azione restano nel registro (chi, quando, cosa): il registro si scrive e si legge, mai si
-- modifica o si cancella. Tutto SOLO per il server: chi è moderatore lo controlla il Worker (pannello, passo dopo).
-- Solo aggiunte: due tabelle, tre funzioni, un trigger; sospeso() ora conta anche le sanzioni in corso
-- (stessa firma e stessi permessi, così stanze, chiamate e chiavi delle altre linee la usano senza cambiare nulla).

create table public.sanzioni (
  id uuid primary key default gen_random_uuid(),
  -- Nessuna chiave verso auth.users: se la persona elimina l'account la sanzione resta nel registro.
  persona uuid not null,
  livello text not null check (livello in ('avviso', 'sospensione_7', 'sospensione_30', 'esclusione')),
  regola text not null check (char_length(regola) between 1 and 100),
  motivo text not null check (char_length(motivo) between 1 and 2000),
  segnalazione_id uuid not null references public.segnalazioni (id),
  decisa_da uuid not null,
  decisa_il timestamptz not null default now(),
  -- Solo le sospensioni hanno una fine; avviso ed esclusione no.
  fine_il timestamptz,
  constraint fine_solo_sospensioni check ((fine_il is not null) = (livello in ('sospensione_7', 'sospensione_30')))
);
create index sanzioni_persona on public.sanzioni (persona, decisa_il);

create table public.registro_moderazione (
  id uuid primary key default gen_random_uuid(),
  chi uuid not null,
  azione text not null check (azione in ('apertura', 'archivia', 'avviso', 'sospensione_7', 'sospensione_30', 'esclusione', 'togli_cautelare')),
  segnalazione_id uuid references public.segnalazioni (id),
  sanzione_id uuid references public.sanzioni (id),
  quando timestamptz not null default now()
);
create index registro_segnalazione on public.registro_moderazione (segnalazione_id, quando);

alter table public.sanzioni enable row level security;
alter table public.registro_moderazione enable row level security;
revoke all on public.sanzioni, public.registro_moderazione from public, anon, authenticated, service_role;
grant select, insert on public.sanzioni, public.registro_moderazione to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui (il messaggio a chi è sanzionato
-- arriva in un passo dopo con una funzione che restituisce solo livello, regola e data di fine).

-- La persona è sospesa adesso? Sospensione cautelare o automatica attiva, oppure sanzione in corso
-- (sospensione non ancora finita o esclusione definitiva).
create or replace function public.sospeso(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sospensioni where persona = p_persona and tolta_il is null)
      or exists (select 1 from public.sanzioni where persona = p_persona
                 and (livello = 'esclusione' or (livello in ('sospensione_7', 'sospensione_30') and fine_il > now())))
$$;

-- Una sanzione che toglie dalle stanze annulla le chiavi come una sospensione (stessa funzione della linea #5/#7).
create trigger annulla_chiavi_per_sanzione after insert on public.sanzioni
  for each row when (new.livello <> 'avviso') execute function public.annulla_chiavi_per_sospensione();

-- Chi decide apre la segnalazione: la prima volta segna l'ora, ogni volta resta nel registro.
create function public.apri_segnalazione(p_moderatore uuid, p_segnalazione uuid)
  returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_moderatore is null then raise exception 'Manca chi decide.' using errcode = 'check_violation'; end if;
  update public.segnalazioni set aperta_il = coalesce(aperta_il, now()) where id = p_segnalazione;
  if not found then raise exception 'Segnalazione inesistente.' using errcode = 'no_data_found'; end if;
  insert into public.registro_moderazione (chi, azione, segnalazione_id) values (p_moderatore, 'apertura', p_segnalazione);
end $$;
revoke all on function public.apri_segnalazione(uuid, uuid) from public, anon, authenticated;
grant execute on function public.apri_segnalazione(uuid, uuid) to service_role;

-- La decisione. Restituisce l'id della sanzione (null per «archivia» e «togli_cautelare»).
create function public.decidi_segnalazione(p_moderatore uuid, p_segnalazione uuid, p_azione text, p_regola text, p_testo text)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.segnalazioni%rowtype;
  testo text := nullif(btrim(coalesce(p_testo, '')), '');
  regola text := nullif(btrim(coalesce(p_regola, '')), '');
  nuova uuid;
begin
  if p_moderatore is null then raise exception 'Manca chi decide.' using errcode = 'check_violation'; end if;
  if p_azione is null or p_azione not in ('archivia', 'avviso', 'sospensione_7', 'sospensione_30', 'esclusione', 'togli_cautelare') then
    raise exception 'Azione non valida.' using errcode = 'check_violation';
  end if;
  if testo is null then raise exception 'Il motivo è obbligatorio.' using errcode = 'check_violation'; end if;
  select * into s from public.segnalazioni where id = p_segnalazione for update;
  if not found then raise exception 'Segnalazione inesistente.' using errcode = 'no_data_found'; end if;
  if s.esito is not null then raise exception 'Segnalazione già decisa.' using errcode = 'check_violation'; end if;
  update public.segnalazioni set aperta_il = coalesce(aperta_il, now()) where id = s.id;

  if p_azione = 'togli_cautelare' then
    -- La segnalazione resta aperta: si deciderà dopo.
    update public.sospensioni set tolta_il = now() where persona = s.contro and tolta_il is null;
  elsif p_azione = 'archivia' then
    update public.segnalazioni set esito = 'archiviata', chiusa_il = now() where id = s.id;
    -- Infondata: la sospensione cautelare o automatica nata da questa segnalazione si toglie.
    update public.sospensioni set tolta_il = now() where segnalazione_id = s.id and tolta_il is null;
  else
    if s.contro is null then raise exception 'Nessuna persona da sanzionare.' using errcode = 'check_violation'; end if;
    if regola is null then raise exception 'Manca la regola violata.' using errcode = 'check_violation'; end if;
    -- La sanzione prende il posto della sospensione cautelare o automatica in attesa.
    update public.sospensioni set tolta_il = now() where persona = s.contro and tolta_il is null;
    insert into public.sanzioni (persona, livello, regola, motivo, segnalazione_id, decisa_da, fine_il)
      values (s.contro, p_azione, regola, testo, s.id, p_moderatore,
              case p_azione when 'sospensione_7' then now() + interval '7 days'
                            when 'sospensione_30' then now() + interval '30 days' end)
      returning id into nuova;
    update public.segnalazioni set esito = 'provvedimenti', chiusa_il = now() where id = s.id;
  end if;
  insert into public.registro_moderazione (chi, azione, segnalazione_id, sanzione_id) values (p_moderatore, p_azione, s.id, nuova);
  return nuova;
end $$;
revoke all on function public.decidi_segnalazione(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.decidi_segnalazione(uuid, uuid, text, text, text) to service_role;
