-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10): alle 21:00, quando si aprono le porte, si cancellano anche le risposte
-- «La richiameresti?» della stanza chiusa (criterio di accettazione: «alle 21:00 [...] le risposte "la richiameresti?"
-- della stanza sono cancellate»). Prima si cancellavano solo lunedì con pulisci_stanze_chiuse(), che resta come
-- seconda pulizia. Stessa funzione apri_porte() di 20261113205404_sera_porte.sql con una riga in più. Linea «sviluppatore-c».
create or replace function public.apri_porte() returns jsonb
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
    delete from public.richiameresti r where r.stanza_id = s.id;
    insert into public.serate_porte (stanza_id, chiavi_date, porte_aperte) values (s.id, chiavi_stanza, porte_stanza);
    n_stanze := n_stanze + 1;
    n_chiavi := n_chiavi + chiavi_stanza;
    n_porte := n_porte + porte_stanza;
  end loop;
  return jsonb_build_object('stanze', n_stanze, 'chiavi_date', n_chiavi, 'porte_aperte', n_porte);
end $$;
revoke all on function public.apri_porte() from public, anon, authenticated;
grant execute on function public.apri_porte() to service_role;
