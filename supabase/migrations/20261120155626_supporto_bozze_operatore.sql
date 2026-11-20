-- Fase 2 · issue #10 parte B v1 (CPO, 13/11); D122 B · passo 5 della linea «sviluppatore-c»: bozze nel pannello.
-- Chi risponde (operatori_supporto, in beta solo Giuseppe) vede la bozza dell'agente accanto al messaggio e sceglie
-- «Invia così · Modifica e invia · Scarta e scrivo io». Inviare usa rispondi_supporto_operatore (già esistente: la
-- risposta parte solo dal tocco di chi risponde); qui solo leggere e scartare le bozze. Solo dal Worker (chiave del
-- server), mai dal telefono. Solo aggiunte: nessuna funzione esistente cambia firma. Nessun testo nei log.

create function public.bozze_supporto_operatore(p_operatore uuid)
  returns table (messaggio_id uuid, testo text, fonte text, con_istruzioni boolean, creato_il timestamptz)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_operatore_supporto(p_operatore) then
    raise exception 'non_operatore' using errcode = 'insufficient_privilege';
  end if;
  return query select b.messaggio_id, b.testo, b.fonte, b.con_istruzioni, b.creato_il
    from public.supporto_bozze b join public.supporto s on s.id = b.messaggio_id
    where s.risposta is null
    order by b.creato_il limit 200;
end $$;
revoke all on function public.bozze_supporto_operatore(uuid) from public, anon, authenticated;
grant execute on function public.bozze_supporto_operatore(uuid) to service_role;

-- «Scarta e scrivo io»: true = bozza tolta; false = non c'era (o il messaggio ha già una risposta).
create function public.scarta_bozza_operatore(p_operatore uuid, p_id uuid) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  if not public.e_operatore_supporto(p_operatore) then
    raise exception 'non_operatore' using errcode = 'insufficient_privilege';
  end if;
  delete from public.supporto_bozze b using public.supporto s
    where b.messaggio_id = p_id and s.id = b.messaggio_id and s.risposta is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.scarta_bozza_operatore(uuid, uuid) from public, anon, authenticated;
grant execute on function public.scarta_bozza_operatore(uuid, uuid) to service_role;
