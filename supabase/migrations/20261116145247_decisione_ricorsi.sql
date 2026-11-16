-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D51 A) · passo 13d della linea «sviluppatore-b».
-- La decisione sui ricorsi (regola «Ricorso»): la prende una persona diversa da chi ha sanzionato (in beta Giuseppe),
-- non si chiude mai da sola, e finché nessuno decide la sanzione resta attiva.
--   · accolto  → la sanzione si annulla subito (annullata_il) e smette di contare per sospeso();
--   · respinto → la sanzione resta com'è.
-- Ogni decisione resta nel registro (ricorso_accolto / ricorso_respinto). Tutto SOLO per il server.
-- Solo aggiunte: due colonne facoltative, il controllo delle azioni del registro allargato (nessun valore tolto),
-- sospeso() con stessa firma e permessi (ora ignora le sanzioni annullate), due funzioni nuove.
-- Il riassunto dei fatti dell'agent di supporto (#10) si aggiunge quando la linea #10 lo produce.

alter table public.sanzioni add column annullata_il timestamptz;
alter table public.ricorsi add column motivo_decisione text check (char_length(motivo_decisione) between 1 and 2000);

alter table public.registro_moderazione drop constraint registro_moderazione_azione_check;
alter table public.registro_moderazione add constraint registro_moderazione_azione_check check (azione in (
  'apertura', 'archivia', 'avviso', 'sospensione_7', 'sospensione_30', 'esclusione', 'togli_cautelare',
  'ricorso_accolto', 'ricorso_respinto'));

-- Come nel passo 12a, ma una sanzione annullata da un ricorso accolto non conta più.
create or replace function public.sospeso(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sospensioni where persona = p_persona and tolta_il is null)
      or exists (select 1 from public.sanzioni where persona = p_persona and annullata_il is null
                 and (livello = 'esclusione' or (livello in ('sospensione_7', 'sospensione_30') and fine_il > now())))
$$;

-- Ricorsi in attesa, prima quelli con la risposta più vicina. «decisa_da_te»: chi chiede ha dato la sanzione e quindi
-- non può decidere il ricorso (il pannello lo mostra, il database lo rifiuta comunque).
create function public.ricorsi_da_decidere(p_moderatore uuid)
  returns table (id uuid, sanzione_id uuid, livello text, regola text, motivo_sanzione text, decisa_il timestamptz,
                 fine_il timestamptz, nome text, testo text, inviato_il timestamptz, risposta_entro timestamptz, decisa_da_te boolean)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  return query
  select r.id, z.id, z.livello, z.regola, z.motivo, z.decisa_il, z.fine_il,
         (select pr.nome from public.profili pr where pr.id = r.persona), r.testo, r.inviato_il, r.risposta_entro,
         z.decisa_da = p_moderatore
  from public.ricorsi r join public.sanzioni z on z.id = r.sanzione_id
  where r.stato = 'in_attesa'
  order by r.risposta_entro
  limit 200;
end $$;
revoke all on function public.ricorsi_da_decidere(uuid) from public, anon, authenticated;
grant execute on function public.ricorsi_da_decidere(uuid) to service_role;

create function public.decidi_ricorso(p_moderatore uuid, p_ricorso uuid, p_esito text, p_testo text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  r public.ricorsi%rowtype;
  z public.sanzioni%rowtype;
  motivo text := nullif(btrim(coalesce(p_testo, '')), '');
begin
  if not public.e_moderatore(p_moderatore) then
    raise exception 'non_moderatore' using errcode = 'insufficient_privilege';
  end if;
  if p_esito is null or p_esito not in ('accolto', 'respinto') then
    raise exception 'Esito non valido.' using errcode = 'check_violation';
  end if;
  if motivo is null or char_length(motivo) > 2000 then raise exception 'Il motivo è obbligatorio.' using errcode = 'check_violation'; end if;
  select * into r from public.ricorsi where id = p_ricorso for update;
  if not found then raise exception 'Ricorso inesistente.' using errcode = 'no_data_found'; end if;
  if r.stato <> 'in_attesa' then raise exception 'Ricorso già deciso.' using errcode = 'check_violation'; end if;
  select * into z from public.sanzioni where id = r.sanzione_id for update;
  if z.decisa_da = p_moderatore then
    raise exception 'Il ricorso lo decide una persona diversa da chi ha sanzionato.' using errcode = 'check_violation';
  end if;
  update public.ricorsi set stato = p_esito, deciso_da = p_moderatore, deciso_il = now(), motivo_decisione = motivo where id = r.id;
  if p_esito = 'accolto' then
    update public.sanzioni set annullata_il = now() where id = z.id;
  end if;
  insert into public.registro_moderazione (chi, azione, segnalazione_id, sanzione_id)
    values (p_moderatore, 'ricorso_' || p_esito, z.segnalazione_id, z.id);
end $$;
revoke all on function public.decidi_ricorso(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decidi_ricorso(uuid, uuid, text, text) to service_role;
