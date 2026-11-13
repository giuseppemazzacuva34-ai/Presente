-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D14 A, D16 B, D51 A) · linea «sviluppatore-c», passo 3: la sera delle porte.
-- Alla chiusura della stanza (domenica 21:00 di Roma) un solo calcolo per stanza, sul server: porta = chiave reciproca.
-- Tutte le porte della stanza si aprono nello stesso istante, quello della chiusura (aperta_il = chiude_il), così
-- anche se il lavoro parte qualche secondo dopo, o la sera del cambio d'ora, l'ora è sempre le 21:00 di Roma.
-- Poi le chiavi della stanza si cancellano tutte: quelle reciproche sono già nella porta (con le frasi), quelle non
-- ricambiate spariscono con le loro frasi (spec, «Cosa si salva delle chiavi»). Per i report restano solo due numeri
-- per stanza. Nessuno scopre un no: in uscita solo totali, mai persone.
-- Chi lancia apri_porte (lavoro della domenica, o il Worker prima di mostrare la sera) è il passo successivo.
-- Rifarlo non apre porte doppie: una stanza già fatta ha la sua riga in serate_porte.

create table public.serate_porte (
  stanza_id uuid primary key references public.stanze (id) on delete cascade,
  chiavi_date integer not null check (chiavi_date >= 0),
  porte_aperte integer not null check (porte_aperte >= 0),
  fatta_il timestamptz not null default now()
);

alter table public.serate_porte enable row level security;
revoke all on public.serate_porte from public, anon, authenticated;
grant select, insert, update, delete on public.serate_porte to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- Apre le porte di tutte le stanze già chiuse e non ancora fatte. Restituisce solo numeri:
-- {"stanze": quante stanze, "chiavi_date": quante chiavi c'erano, "porte_aperte": quante porte}.
create function public.apri_porte() returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  s record;
  n_stanze integer := 0;
  n_chiavi integer := 0;
  n_porte integer := 0;
  chiavi_stanza integer;
  porte_stanza integer;
begin
  -- Due lavori insieme non fanno la stessa stanza: chi arriva secondo la salta.
  for s in
    select st.id, st.chiude_il from public.stanze st
    where st.chiude_il <= now()
      and not exists (select 1 from public.serate_porte sp where sp.stanza_id = st.id)
    order by st.chiude_il, st.id
    for update of st skip locked
  loop
    select count(*) into chiavi_stanza from public.chiavi c where c.stanza_id = s.id;
    -- Porta = chiave reciproca; con un blocco tra i due niente porta (il blocco annulla già le chiavi: doppia guardia).
    insert into public.porte (stanza_id, a, b, aperta_il, frase_di_a, frase_di_b)
    select s.id, x.da, x.a, s.chiude_il, x.frase, y.frase
    from public.chiavi x
    join public.chiavi y on y.stanza_id = x.stanza_id and y.da = x.a and y.a = x.da
    where x.stanza_id = s.id and x.da < x.a and not public.bloccati_tra(x.da, x.a)
    on conflict (stanza_id, a, b) do nothing;
    get diagnostics porte_stanza = row_count;
    delete from public.chiavi c where c.stanza_id = s.id;
    insert into public.serate_porte (stanza_id, chiavi_date, porte_aperte) values (s.id, chiavi_stanza, porte_stanza);
    n_stanze := n_stanze + 1;
    n_chiavi := n_chiavi + chiavi_stanza;
    n_porte := n_porte + porte_stanza;
  end loop;
  return jsonb_build_object('stanze', n_stanze, 'chiavi_date', n_chiavi, 'porte_aperte', n_porte);
end $$;
revoke all on function public.apri_porte() from public, anon, authenticated;
grant execute on function public.apri_porte() to service_role;
