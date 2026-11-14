-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D51 A) · linea «sviluppatore-c», passo 7b: chiavi e persone sospese.
-- Spec #5 «Casi limite»: chiave a chi lascia la stanza (anche per sospensione, #7) → «Non è più nella stanza».
-- Finora dai_chiave verso o da un sospeso finiva in un errore (la regola chiavi_mai_con_sospesi della linea B, che
-- resta come rete di sicurezza): adesso risponde pulito 'non_nella_stanza', come per un blocco, senza dire perché.
-- Stessa funzione di 20261113161516_chiavi.sql, con in più il controllo sulla sospensione. Nessuna riga cambiata.
create or replace function public.dai_chiave(p_da uuid, p_a uuid, p_frase text) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
  f record;
begin
  if p_da is null or p_a is null or p_da = p_a then return 'non_valida'; end if;
  s := public.stanza_aperta_di(p_da);
  if s.id is null then return 'non_nella_stanza'; end if;
  if now() >= s.chiude_il - interval '1 minute' then return 'chiuse'; end if;
  if not exists (select 1 from public.membri_stanza m where m.stanza_id = s.id and m.utente_id = p_a)
     or exists (select 1 from public.blocchi k where (k.chi = p_da and k.bloccato = p_a) or (k.chi = p_a and k.bloccato = p_da))
     or public.sospeso(p_da) or public.sospeso(p_a)
  then return 'non_nella_stanza'; end if;
  -- Due richieste insieme della stessa persona non devono superare le 2 chiavi: si mettono in fila.
  perform 1 from public.membri_stanza m where m.stanza_id = s.id and m.utente_id = p_da for update;
  if exists (select 1 from public.chiavi c where c.stanza_id = s.id and c.da = p_da and c.a = p_a) then return 'gia_data'; end if;
  if (select count(*) from public.chiavi c where c.stanza_id = s.id and c.da = p_da) >= 2 then return 'finite'; end if;
  if not exists (select 1 from public.chiamate k
                 where ((k.chi = p_da and k.con = p_a) or (k.chi = p_a and k.con = p_da))
                   and k.inizio >= s.apre_il and k.inizio < s.chiude_il and k.durata >= 60)
  then return 'non_chiamato'; end if;
  f := public.frase_chiave(p_frase);
  if f.motivo is not null then return f.motivo; end if;
  insert into public.chiavi (stanza_id, da, a, frase) values (s.id, p_da, p_a, f.frase);
  return 'ok';
end $$;
revoke all on function public.dai_chiave(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.dai_chiave(uuid, uuid, text) to service_role;
