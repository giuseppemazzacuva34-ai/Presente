-- Fase 2 · issue #7 spec v1.1 (CPO, 30/10; D32 A, D51 A) · passo 2 della linea «sviluppatore-b»: le segnalazioni.
-- Una riga per segnalazione: chi segnala, chi è segnalato, motivo, punto di partenza, racconto facoltativo, quando,
-- entro quando una persona deve leggerla, e l'esito. Niente diario, questionario, «la richiameresti?» o registrazioni.
-- La scrive e la legge SOLO il server (ruolo di servizio): il telefono non vede mai chi l'ha segnalato.
-- «da» e «contro» non hanno chiavi verso auth.users: se una delle due persone elimina l'account le segnalazioni
-- aperte restano (spec, «Cosa si salva»); la durata di conservazione la fissa il CFO con il legale.
-- Motivi, punti di partenza e ore di revisione sono uguali a api/segnalazioni.js (test/segnalazioni_database.test.mjs).

create table public.segnalazioni (
  id uuid primary key default gen_random_uuid(),
  da uuid not null,
  contro uuid,
  motivo text not null check (motivo in ('contatti_prima_porta', 'insulti', 'contenuti_sessuali', 'minacce_pericolo', 'sembra_minorenne', 'profilo_falso', 'soldi', 'diffusione_immagini', 'altro', 'sono_in_difficolta', 'non_al_sicuro')),
  origine text not null check (origine in ('chiudi_e_segnala', 'dopo_chiamata', 'scheda', 'valutazione', 'sono_in_difficolta', 'storico_chiamate')),
  testo text check (char_length(testo) <= 1000),
  creata_il timestamptz not null default now(),
  scade_il timestamptz not null,
  aperta_il timestamptz,
  esito text check (esito in ('archiviata', 'provvedimenti')),
  chiusa_il timestamptz,
  constraint mai_contro_se_stessi check (contro is null or contro <> da),
  -- Solo «Sono in difficoltà» può non riguardare una persona di Presente (casi limite della spec).
  constraint persona_collegata check (contro is not null or motivo = 'sono_in_difficolta' or origine = 'sono_in_difficolta'),
  constraint esito_con_data check ((esito is null) = (chiusa_il is null))
);
-- Sospensione automatica (D32): segnalazioni recenti contro una persona. Pannello: le aperte per scadenza.
create index segnalazioni_contro on public.segnalazioni (contro, creata_il);
create index segnalazioni_aperte on public.segnalazioni (scade_il) where esito is null;

alter table public.segnalazioni enable row level security;
revoke all on public.segnalazioni from public, anon, authenticated;
grant select, insert, update on public.segnalazioni to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- Ore entro cui una persona deve leggere la segnalazione (Regole della community).
create function public.ore_revisione(p_motivo text) returns integer
  language sql immutable set search_path = '' as $$
  select case
    when p_motivo = 'contatti_prima_porta' then 72
    when p_motivo = 'insulti' then 24
    when p_motivo = 'contenuti_sessuali' then 24
    when p_motivo = 'minacce_pericolo' then 1
    when p_motivo = 'sembra_minorenne' then 1
    when p_motivo = 'profilo_falso' then 72
    when p_motivo = 'soldi' then 24
    when p_motivo = 'diffusione_immagini' then 24
    when p_motivo = 'altro' then 72
    when p_motivo = 'sono_in_difficolta' then 1
    when p_motivo = 'non_al_sicuro' then 1
  end
$$;
revoke all on function public.ore_revisione(text) from public, anon, authenticated;
grant execute on function public.ore_revisione(text) to service_role;

-- Salva una segnalazione e, se serve, il blocco, in una sola transazione. Restituisce l'id della segnalazione.
-- «Chiudi e segnala» blocca sempre; altrove decide la casella «Blocca anche <nome>» (p_blocca).
-- Il blocco è quello di D32 A (tabella blocchi): immediato, definitivo, l'altra persona non lo sa.
create function public.nuova_segnalazione(p_da uuid, p_contro uuid, p_motivo text, p_origine text, p_testo text, p_blocca boolean)
  returns uuid language plpgsql security definer set search_path = '' as $$
declare
  ore integer := public.ore_revisione(p_motivo);
  racconto text := nullif(btrim(coalesce(p_testo, '')), '');
  nuova uuid;
begin
  if ore is null then raise exception 'Motivo non valido.' using errcode = 'check_violation'; end if;
  insert into public.segnalazioni (da, contro, motivo, origine, testo, scade_il)
    values (p_da, p_contro, p_motivo, p_origine, racconto, now() + make_interval(hours => ore))
    returning id into nuova;
  -- Chi ha già eliminato l'account non si blocca (non c'è più), ma la segnalazione resta.
  if p_contro is not null and (p_origine = 'chiudi_e_segnala' or p_blocca is true)
     and exists (select 1 from auth.users where id = p_contro) then
    insert into public.blocchi (chi, bloccato) values (p_da, p_contro) on conflict do nothing;
  end if;
  return nuova;
end $$;
revoke all on function public.nuova_segnalazione(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.nuova_segnalazione(uuid, uuid, text, text, text, boolean) to service_role;
