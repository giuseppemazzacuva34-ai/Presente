-- Fase 2 · issue #7 spec v1.1 definitiva (CPO, 30/10; D51 A) · passo 12b della linea «sviluppatore-b».
-- Punto 7: chi riceve una sanzione vede in app livello, regola violata, data di fine e «Contesta»; mai chi ha
-- segnalato, il racconto o il motivo scritto da chi decide. Punto 8: ricorso «Perché pensi che sia sbagliata?»
-- (max 2000 caratteri), una sola volta, entro 14 giorni; risposta entro 7 giorni (14 per l'esclusione definitiva).
-- Durante il ricorso la sanzione resta attiva. Lo decide una persona diversa da chi ha sanzionato (in beta Giuseppe,
-- D51 A): la decisione arriva con il pannello. Allegati facoltativi (immagini) e email: passi successivi.
-- Solo aggiunte: una tabella chiusa al telefono e due funzioni che lavorano solo sulle sanzioni di chi chiede.

create table public.ricorsi (
  id uuid primary key default gen_random_uuid(),
  sanzione_id uuid not null unique references public.sanzioni (id),
  persona uuid not null,
  testo text not null check (char_length(testo) between 1 and 2000),
  inviato_il timestamptz not null default now(),
  risposta_entro timestamptz not null,
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'accolto', 'respinto')),
  deciso_da uuid,
  deciso_il timestamptz,
  constraint decisione_completa check ((stato = 'in_attesa') = (deciso_il is null))
);
create index ricorsi_in_attesa on public.ricorsi (risposta_entro) where stato = 'in_attesa';

alter table public.ricorsi enable row level security;
revoke all on public.ricorsi from public, anon, authenticated;
grant select, insert, update on public.ricorsi to service_role;
-- Nessuna regola per authenticated: il telefono passa solo dalle due funzioni qui sotto.

-- Le sanzioni di chi chiede (ultimi 6 mesi), dalla più recente. Solo quello che dice la spec al punto 7.
create function public.mie_sanzioni()
  returns table (id uuid, livello text, regola text, decisa_il timestamptz, fine_il timestamptz, ricorso_entro timestamptz,
                 contestabile boolean, ricorso_stato text, risposta_entro timestamptz)
  language sql stable security definer set search_path = '' as $$
  select z.id, z.livello, z.regola, z.decisa_il, z.fine_il, z.decisa_il + interval '14 days',
         r.id is null and now() < z.decisa_il + interval '14 days', r.stato, r.risposta_entro
  from public.sanzioni z
  left join public.ricorsi r on r.sanzione_id = z.id
  where z.persona = (select auth.uid()) and z.decisa_il >= now() - interval '6 months'
  order by z.decisa_il desc
  limit 20
$$;
revoke all on function public.mie_sanzioni() from public, anon;
grant execute on function public.mie_sanzioni() to authenticated;

-- «Contesta»: una sola volta, entro 14 giorni, solo per le proprie sanzioni.
create function public.nuovo_ricorso(p_sanzione uuid, p_testo text)
  returns void language plpgsql security definer set search_path = '' as $$
declare
  io uuid := (select auth.uid());
  z public.sanzioni%rowtype;
  testo text := nullif(btrim(coalesce(p_testo, '')), '');
begin
  if testo is null or char_length(testo) > 2000 then
    raise exception 'testo' using errcode = 'check_violation';
  end if;
  select * into z from public.sanzioni where id = p_sanzione and persona = io;
  if not found then raise exception 'non_trovata' using errcode = 'P0001'; end if;
  if now() >= z.decisa_il + interval '14 days' then raise exception 'scaduto' using errcode = 'P0001'; end if;
  insert into public.ricorsi (sanzione_id, persona, testo, risposta_entro)
    values (z.id, io, testo, now() + case when z.livello = 'esclusione' then interval '14 days' else interval '7 days' end);
exception when unique_violation then
  raise exception 'gia_fatto' using errcode = 'P0001';
end $$;
revoke all on function public.nuovo_ricorso(uuid, text) from public, anon;
grant execute on function public.nuovo_ricorso(uuid, text) to authenticated;
