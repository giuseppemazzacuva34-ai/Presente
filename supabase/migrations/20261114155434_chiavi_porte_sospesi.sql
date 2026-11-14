-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D51 A) · linea «sviluppatore-c», passo 7a: porte e persone sospese.
-- Spec #7 «Sospensione» (richiesta di «sviluppatore-b» in plancia, 14/11): le porte con una persona sospesa non si
-- vedono più, come con un blocco; se la sospensione viene tolta tornano. Nessuna riga cancellata.
-- La risposta pulita di dai_chiave con un sospeso viene in un passo dopo (il test della linea B va adattato prima).
-- porta_aperta e porte_di (quindi anche sera_di, svelamento #65 e incontro #6) nascondono le porte con un sospeso.
-- Stesse funzioni della migrazione 20261113161137_porte.sql, con in più il controllo.

create or replace function public.porta_aperta(p_x uuid, p_y uuid)
  returns table (id uuid, stanza_id uuid, aperta_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.stanza_id, p.aperta_il from public.porte p
  where p.a = least(p_x, p_y) and p.b = greatest(p_x, p_y) and p_x <> p_y
    and not public.bloccati_tra(p_x, p_y) and not public.sospeso(p_x) and not public.sospeso(p_y)
  order by p.aperta_il desc
  limit 1
$$;
revoke all on function public.porta_aperta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.porta_aperta(uuid, uuid) to service_role;

-- Le porte di una persona, dalla più recente: con chi, in quale stanza, da quando, e la frase che l'ALTRA persona
-- le ha lasciato (mai la propria: quella la conosce già). Per la schermata della sera e per lo svelamento.
create or replace function public.porte_di(p_utente uuid)
  returns table (id uuid, con uuid, stanza_id uuid, aperta_il timestamptz, frase_per_te text)
  language sql stable security definer set search_path = '' as $$
  select p.id,
         case when p.a = p_utente then p.b else p.a end,
         p.stanza_id,
         p.aperta_il,
         case when p.a = p_utente then p.frase_di_b else p.frase_di_a end
  from public.porte p
  where (p.a = p_utente or p.b = p_utente)
    and not public.bloccati_tra(p.a, p.b) and not public.sospeso(p.a) and not public.sospeso(p.b)
  order by p.aperta_il desc, p.id
$$;
revoke all on function public.porte_di(uuid) from public, anon, authenticated;
grant execute on function public.porte_di(uuid) to service_role;
