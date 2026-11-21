-- Fase 2 · issue #6 spec v1 (CPO, 3/11; D20 A) · passo 3a della linea «sviluppatore-b»: la valutazione nel database.
-- Dopo un incontro avvenuto (check-in di entrambi) ciascuno risponde a 3 domande sui fatti e a 1 privata sulla
-- sicurezza, una volta sola, entro 7 giorni («Non ora» la lascia aperta). Mai voti, stelle o domande sull'aspetto.
-- Le singole valutazioni sono dati personali (D20): solo il server le legge, si cancellano con l'account di chi
-- risponde e di chi è valutato. Lettura alla cieca, riepiloghi, bollini e «foto non sue»: passi successivi.
-- Valori uguali a api/valutazione.js (test/valutazione_database.test.mjs li confronta).

create table public.valutazioni (
  porta_id uuid not null references public.incontri (porta_id) on delete cascade,
  persona uuid not null references auth.users (id) on delete cascade, -- chi risponde
  valutato uuid not null references auth.users (id) on delete cascade, -- l'altra persona dell'incontro
  presentato text not null check (presentato in ('si', 'in_ritardo', 'no')),
  foto_sue text not null check (foto_sue in ('si', 'non_sicuro', 'no')),
  come_in_chiamata text not null check (come_in_chiamata in ('si', 'piu_o_meno', 'no')),
  sicuro boolean not null, -- privata: mai mostrata all'altro, neanche nei riepiloghi
  creato_il timestamptz not null default now(),
  primary key (porta_id, persona),
  constraint non_a_se_stessi check (persona <> valutato)
);
create index valutazioni_valutato on public.valutazioni (valutato);

alter table public.valutazioni enable row level security;
revoke all on public.valutazioni from public, anon, authenticated;
grant select, insert, update, delete on public.valutazioni to service_role;

-- Risposte: grazie, racconta (con «No» alla sicurezza: l'app propone «Vuoi raccontarci cosa è successo?», #7),
-- non_nella_porta, nessun_incontro, non_avvenuto, chiusa (oltre 7 giorni), gia_fatta, risposta_non_valida.
create function public.valuta_incontro(p_porta uuid, p_persona uuid, p_presentato text, p_foto_sue text,
  p_come_in_chiamata text, p_sicuro boolean) returns text
  language plpgsql set search_path = '' as $$
declare
  v_giorni constant integer := 7;
  v_porta public.porte;
  v_i public.incontri;
begin
  select * into v_porta from public.porte where id = p_porta;
  if not found or p_persona is null or p_persona not in (v_porta.a, v_porta.b) then
    return 'non_nella_porta';
  end if;
  select * into v_i from public.incontri where porta_id = p_porta;
  if not found then
    return 'nessun_incontro';
  end if;
  if v_i.esito is distinct from 'avvenuto' then
    return 'non_avvenuto';
  end if;
  if now() > v_i.esito_il + make_interval(days => v_giorni) then
    return 'chiusa';
  end if;
  if p_presentato is null or p_presentato not in ('si', 'in_ritardo', 'no')
     or p_foto_sue is null or p_foto_sue not in ('si', 'non_sicuro', 'no')
     or p_come_in_chiamata is null or p_come_in_chiamata not in ('si', 'piu_o_meno', 'no')
     or p_sicuro is null then
    return 'risposta_non_valida';
  end if;
  insert into public.valutazioni (porta_id, persona, valutato, presentato, foto_sue, come_in_chiamata, sicuro)
    values (p_porta, p_persona, case when p_persona = v_porta.a then v_porta.b else v_porta.a end,
            p_presentato, p_foto_sue, p_come_in_chiamata, p_sicuro)
    on conflict (porta_id, persona) do nothing;
  if not found then
    return 'gia_fatta';
  end if;
  return case when p_sicuro then 'grazie' else 'racconta' end;
end $$;

revoke all on function public.valuta_incontro(uuid, uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.valuta_incontro(uuid, uuid, text, text, text, boolean) to service_role;
