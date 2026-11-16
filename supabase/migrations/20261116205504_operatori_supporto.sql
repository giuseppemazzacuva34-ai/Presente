-- Fase 2 · issue #10 spec v1 (CPO, 6/11) · parte A, passo 4a della linea «sviluppatore-c»: chi risponde a «Scrivici».
-- Il ruolo «supporto» (in beta solo Giuseppe) è l'elenco «operatori_supporto». La riga la aggiunge Giuseppe a mano
-- dal pannello di Supabase (nessun dato reale nel repository). Solo chi è nell'elenco legge la coda dei messaggi e
-- salva una risposta; la coda resta quella di coda_supporto(): solo id, email, categoria, testo, data, stato e
-- bandiera «sicurezza», mai voce, foto, questionario, diario, chiavi o valutazioni. Tutto passa dal Worker (chiave
-- del server): il telefono non legge l'elenco e non chiama queste funzioni. Nessun testo nei log.

create table public.operatori_supporto (
  persona uuid primary key references auth.users (id) on delete cascade,
  aggiunto_il timestamptz not null default now()
);
alter table public.operatori_supporto enable row level security;
revoke all on public.operatori_supporto from public, anon, authenticated, service_role;
grant select on public.operatori_supporto to service_role;
-- Nessuna regola per authenticated: il telefono non sa chi risponde al supporto.

create function public.e_operatore_supporto(p_persona uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select p_persona is not null and exists (select 1 from public.operatori_supporto where persona = p_persona)
$$;
revoke all on function public.e_operatore_supporto(uuid) from public, anon, authenticated;
grant execute on function public.e_operatore_supporto(uuid) to service_role;

-- Coda per chi risponde (al massimo 200 righe: prima i messaggi senza risposta, bandiera «sicurezza» in cima).
create function public.coda_supporto_operatore(p_operatore uuid)
  returns table (id uuid, email text, categoria text, testo text, creato_il timestamptz, stato text, sicurezza boolean)
  language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.e_operatore_supporto(p_operatore) then
    raise exception 'non_operatore' using errcode = 'insufficient_privilege';
  end if;
  return query select c.id, c.email, c.categoria, c.testo, c.creato_il, c.stato, c.sicurezza
    from public.coda_supporto() c limit 200;
end $$;
revoke all on function public.coda_supporto_operatore(uuid) from public, anon, authenticated;
grant execute on function public.coda_supporto_operatore(uuid) to service_role;

-- Salva la risposta di chi risponde. true = salvata; false = messaggio inesistente o già con risposta.
create function public.rispondi_supporto_operatore(p_operatore uuid, p_id uuid, p_risposta text) returns boolean
  language plpgsql security definer set search_path = '' as $$
begin
  if not public.e_operatore_supporto(p_operatore) then
    raise exception 'non_operatore' using errcode = 'insufficient_privilege';
  end if;
  return public.rispondi_supporto(p_id, p_risposta);
end $$;
revoke all on function public.rispondi_supporto_operatore(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.rispondi_supporto_operatore(uuid, uuid, text) to service_role;
