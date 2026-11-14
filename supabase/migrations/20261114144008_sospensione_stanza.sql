-- Fase 2 · issue #7 spec v1.1 (CPO, 30/10; D32 A, D51 A) · linea «sviluppatore-b», passo 6a: blocco e sospensione
-- nella stanza. Spec, «Regole»: con un blocco i due non si vedono più in stanza; chi è sospeso sparisce dalle stanze
-- («Non è più nella stanza») e le sue chiavi si annullano. Niente righe cancellate dalla stanza: se una persona toglie
-- la sospensione, chi era sospeso torna visibile (le chiavi annullate non tornano). Chiamate, porte e svelamento
-- usano già blocchi e sospeso(): i controlli lì restano alle linee che li hanno scritti (#4, #5, #65).

-- Compagni di stanza: come in 20261103220000_solo_compatibili.sql, in più senza blocchi tra i due (in un verso
-- o nell'altro) e senza chi è sospeso adesso.
create or replace function public.compagni_di_stanza()
  returns table (utente_id uuid, nome text, eta integer, citta text)
  language sql stable security definer set search_path = '' as $$
  select p.id, p.nome, extract(year from age(current_date, p.data_nascita))::integer,
         case when p.provincia = 'EE' then 'Dall''estero' else coalesce(pr.nome, p.citta) end
  from public.membri_stanza io
  join public.stanze s on s.id = io.stanza_id and now() >= s.apre_il and now() < s.chiude_il
  join public.membri_stanza altri on altri.stanza_id = io.stanza_id and altri.utente_id <> io.utente_id
  join public.profili p on p.id = altri.utente_id
  left join public.province pr on pr.sigla = p.provincia
  where io.utente_id = auth.uid() and public.compatibili_tra(io.utente_id, altri.utente_id)
    and not public.bloccati_tra(io.utente_id, altri.utente_id) and not public.sospeso(altri.utente_id)
$$;
revoke all on function public.compagni_di_stanza() from public, anon;
grant execute on function public.compagni_di_stanza() to authenticated;

-- Una sospensione nuova annulla in silenzio le chiavi date e ricevute da quella persona.
create function public.annulla_chiavi_per_sospensione() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chiavi c where c.da = new.persona or c.a = new.persona;
  return null;
end $$;
revoke all on function public.annulla_chiavi_per_sospensione() from public, anon, authenticated;
create trigger annulla_chiavi_per_sospensione after insert on public.sospensioni
  for each row execute function public.annulla_chiavi_per_sospensione();

-- Nessuna chiave nuova da o verso chi è sospeso, qualunque strada si usi (anche dal server).
create function public.chiavi_mai_con_sospesi() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if public.sospeso(new.da) or public.sospeso(new.a) then
    raise exception 'non_nella_stanza' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.chiavi_mai_con_sospesi() from public, anon, authenticated;
create trigger chiavi_mai_con_sospesi before insert or update on public.chiavi
  for each row execute function public.chiavi_mai_con_sospesi();
