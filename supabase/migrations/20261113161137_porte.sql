-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D51 A) · primo passo della linea «sviluppatore-c»: le porte aperte.
-- Una porta è una chiave reciproca alla chiusura della stanza (domenica 21:00 di Roma). La apre solo il server, in un
-- unico calcolo per stanza (passo successivo, insieme alle chiavi). Qui: la tabella e due funzioni di sola lettura che
-- usano lo svelamento (#65, linea «sviluppatore») e l'incontro dopo il doppio sì (#6, linea «sviluppatore-b»).
-- Cosa resta di una porta (spec, «Cosa si salva delle chiavi»): stanza, le due persone, ora di apertura, le due frasi.
-- Le legge e le scrive SOLO il server (ruolo di servizio): il telefono le riceve dal Worker, mai dal database.
-- Con un blocco tra i due, da una parte o dall'altra, per il server la porta non c'è più (spec, «Casi limite»).

create table public.porte (
  id uuid primary key default gen_random_uuid(), -- per collegarci svelamento e caparre (#65) e l'incontro (#6)
  stanza_id uuid not null references public.stanze (id),
  a uuid not null references auth.users (id) on delete cascade,
  b uuid not null references auth.users (id) on delete cascade,
  aperta_il timestamptz not null, -- uguale per tutte le porte della stanza: la chiusura delle 21:00
  frase_di_a text check (char_length(frase_di_a) between 1 and 140), -- la frase che a ha lasciato a b, se c'è
  frase_di_b text check (char_length(frase_di_b) between 1 and 140), -- la frase che b ha lasciato ad a, se c'è
  constraint coppia_in_ordine check (a < b),
  constraint una_porta_per_coppia_e_stanza unique (stanza_id, a, b)
);
create index porte_a on public.porte (a, b, aperta_il desc);
create index porte_b on public.porte (b, aperta_il desc);

alter table public.porte enable row level security;
revoke all on public.porte from public, anon, authenticated;
grant select, insert, update, delete on public.porte to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- Vero se tra x e y c'è un blocco, da una parte o dall'altra.
create function public.bloccati_tra(p_x uuid, p_y uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocchi k
                 where (k.chi = p_x and k.bloccato = p_y) or (k.chi = p_y and k.bloccato = p_x))
$$;
revoke all on function public.bloccati_tra(uuid, uuid) from public, anon, authenticated;
grant execute on function public.bloccati_tra(uuid, uuid) to service_role;

-- La porta aperta tra due persone e da quando (la più recente). Nessuna riga = nessuna porta.
-- Stesso risultato in qualunque ordine si passino le due persone.
create function public.porta_aperta(p_x uuid, p_y uuid)
  returns table (id uuid, stanza_id uuid, aperta_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.stanza_id, p.aperta_il from public.porte p
  where p.a = least(p_x, p_y) and p.b = greatest(p_x, p_y) and p_x <> p_y
    and not public.bloccati_tra(p_x, p_y)
  order by p.aperta_il desc
  limit 1
$$;
revoke all on function public.porta_aperta(uuid, uuid) from public, anon, authenticated;
grant execute on function public.porta_aperta(uuid, uuid) to service_role;

-- Le porte di una persona, dalla più recente: con chi, in quale stanza, da quando, e la frase che l'ALTRA persona
-- le ha lasciato (mai la propria: quella la conosce già). Per la schermata della sera e per lo svelamento.
create function public.porte_di(p_utente uuid)
  returns table (id uuid, con uuid, stanza_id uuid, aperta_il timestamptz, frase_per_te text)
  language sql stable security definer set search_path = '' as $$
  select p.id,
         case when p.a = p_utente then p.b else p.a end,
         p.stanza_id,
         p.aperta_il,
         case when p.a = p_utente then p.frase_di_b else p.frase_di_a end
  from public.porte p
  where (p.a = p_utente or p.b = p_utente)
    and not public.bloccati_tra(p.a, p.b)
  order by p.aperta_il desc, p.id
$$;
revoke all on function public.porte_di(uuid) from public, anon, authenticated;
grant execute on function public.porte_di(uuid) to service_role;
