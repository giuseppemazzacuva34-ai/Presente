-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D51 A) · linea «sviluppatore-b»: esito per chi segnala.
-- Spec, passo 4: alla chiusura chi ha segnalato riceve in app «Abbiamo esaminato la tua segnalazione e preso i
-- provvedimenti necessari.» oppure «…: non abbiamo trovato violazioni delle regole.» Mai il dettaglio della sanzione.
-- La tabella resta chiusa al telefono: qui due funzioni che lavorano solo sulle segnalazioni di chi chiede (dal token)
-- e restituiscono solo id, esito e data di chiusura (mai chi è segnalato, motivo, racconto o sanzione).
-- Solo aggiunte: una colonna vuota e due funzioni; nessuna regola esistente cambia.
alter table public.segnalazioni add column esito_letto_il timestamptz;

-- Le segnalazioni chiuse e non ancora lette di chi chiede, dalla più vecchia.
create function public.miei_esiti_segnalazioni()
  returns table (id uuid, esito text, chiusa_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select s.id, s.esito, s.chiusa_il
  from public.segnalazioni s
  where s.da = (select auth.uid()) and s.esito is not null and s.esito_letto_il is null
  order by s.chiusa_il
  limit 20
$$;
revoke all on function public.miei_esiti_segnalazioni() from public, anon;
grant execute on function public.miei_esiti_segnalazioni() to authenticated;

-- «Ho letto»: l'esito non torna più. Vale solo per le proprie segnalazioni già chiuse; altrimenti non fa niente.
create function public.esito_segnalazione_letto(p_id uuid)
  returns void language sql security definer set search_path = '' as $$
  update public.segnalazioni set esito_letto_il = now()
  where id = p_id and da = (select auth.uid()) and esito is not null and esito_letto_il is null
$$;
revoke all on function public.esito_segnalazione_letto(uuid) from public, anon;
grant execute on function public.esito_segnalazione_letto(uuid) to authenticated;
