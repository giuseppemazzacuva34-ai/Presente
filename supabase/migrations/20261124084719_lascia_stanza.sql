-- Design v4 · «Lascia la stanza» con motivo (issue #381, spec v1 del CPO del 23/11, schermata 22). Linea
-- «sviluppatore-b», passo 1: il database.
--   · lasciate_stanza: stanza, persona, codice del motivo e testo libero (solo per «altro»). La legge solo il server
--     (pannello dell'amministratore, riepilogo #8): nessuna regola per il telefono, né per il Filo.
--   · lascia_stanza(persona, motivo, testo) → 'ok' | 'non_valida' | 'non_nella_stanza' | 'in_chiamata'. Solo con la
--     stanza aperta (lunedì 9:00 → domenica 21:00, che è la chiusura della stanza) e mai durante una chiamata in corso.
--   · Si esce subito e per sempre: stanza_aperta_di() non dà più quella stanza (stessa firma e permessi), così chiavi,
--     regali, presenze e appuntamenti, che la usano, la trattano come «non nella stanza». compagni_di_stanza() non la
--     mostra più agli altri e a lei non mostra più nessuno. La riga di membri_stanza resta (storico e prima stanza).
--   · Chiavi date e ricevute in quella stanza: si annullano; nessuna chiave né regalo nuovo da o verso di lei
--     (anche scrivendo nelle tabelle), come per chi è sospeso.
--   · Coin: D153 non ancora decisa → si sviluppa A (nessun rimborso): qui nessun movimento.
-- Il testo libero si cancella 30 giorni dopo la chiusura della stanza: lavoro di pulizia in un passo successivo.
-- Solo aggiunte e «create or replace» con la stessa firma; niente SQL distruttivo.

create table public.lasciate_stanza (
  -- Nessuna chiave verso auth.users: se la persona elimina l'account il codice del motivo resta per il riepilogo.
  persona uuid not null,
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  motivo text not null check (motivo in ('tempo', 'persone', 'conosciuto', 'app', 'altro')),
  testo text check (char_length(testo) between 3 and 300),
  quando timestamptz not null default now(),
  primary key (persona, stanza_id),
  constraint testo_solo_per_altro check ((motivo = 'altro') = (testo is not null))
);
create index lasciate_stanza_stanza on public.lasciate_stanza (stanza_id);

alter table public.lasciate_stanza enable row level security;
revoke all on public.lasciate_stanza from public, anon, authenticated, service_role;
grant select on public.lasciate_stanza to service_role;
-- Nessuna regola per authenticated: il telefono (e il Filo) non leggono niente qui.

create function public.ha_lasciato(p_persona uuid, p_stanza uuid) returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lasciate_stanza l where l.persona = p_persona and l.stanza_id = p_stanza)
$$;
revoke all on function public.ha_lasciato(uuid, uuid) from public, anon, authenticated;
grant execute on function public.ha_lasciato(uuid, uuid) to service_role;

-- Come in 20261113161516_chiavi.sql, in più: non la stanza che la persona ha lasciato.
create or replace function public.stanza_aperta_di(p_utente uuid) returns public.stanze
  language sql stable security definer set search_path = '' as $$
  select s.* from public.stanze s join public.membri_stanza m on m.stanza_id = s.id and m.utente_id = p_utente
  where now() >= s.apre_il and now() < s.chiude_il
    and not exists (select 1 from public.lasciate_stanza l where l.persona = p_utente and l.stanza_id = s.id)
  order by s.chiude_il limit 1
$$;

-- Come in 20261114144008_sospensione_stanza.sql, in più: nessuno vede chi ha lasciato la stanza, e chi l'ha lasciata
-- non vede più nessuno.
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
    and not exists (select 1 from public.lasciate_stanza l
                    where l.stanza_id = io.stanza_id and l.persona in (io.utente_id, altri.utente_id))
$$;

create function public.lascia_stanza(p_persona uuid, p_motivo text, p_testo text) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
  t text := nullif(btrim(coalesce(p_testo, '')), '');
begin
  if p_persona is null or p_motivo is null or p_motivo not in ('tempo', 'persone', 'conosciuto', 'app', 'altro') then
    return 'non_valida';
  end if;
  if p_motivo <> 'altro' then t := null;
  elsif t is null or char_length(t) < 3 or char_length(t) > 300 then return 'non_valida';
  end if;
  -- Una richiesta alla volta per persona (due tocchi insieme non fanno due uscite).
  perform pg_advisory_xact_lock(hashtextextended('lascia:' || p_persona::text, 0));
  s := public.stanza_aperta_di(p_persona);
  if s.id is null then return 'non_nella_stanza'; end if;
  -- Chiamata in corso: iniziata e non ancora finita (una chiamata dura al massimo 15 minuti; margine per le cadute).
  if exists (select 1 from public.chiamate c where (c.chi = p_persona or c.con = p_persona)
             and c.durata is null and c.inizio > now() - interval '20 minutes') then
    return 'in_chiamata';
  end if;
  insert into public.lasciate_stanza (persona, stanza_id, motivo, testo) values (p_persona, s.id, p_motivo, t);
  return 'ok';
end $$;
revoke all on function public.lascia_stanza(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lascia_stanza(uuid, text, text) to service_role;

-- Chi lascia la stanza perde le chiavi date e ricevute in quella stanza (solo quella).
create function public.annulla_chiavi_per_lasciata() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chiavi c where c.stanza_id = new.stanza_id and (c.da = new.persona or c.a = new.persona);
  return null;
end $$;
revoke all on function public.annulla_chiavi_per_lasciata() from public, anon, authenticated;
create trigger annulla_chiavi_per_lasciata after insert on public.lasciate_stanza
  for each row execute function public.annulla_chiavi_per_lasciata();

-- Nessuna chiave e nessun regalo nuovi da o verso chi ha lasciato quella stanza, qualunque strada si usi.
create function public.mai_con_chi_ha_lasciato() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.lasciate_stanza l where l.stanza_id = new.stanza_id and l.persona in (new.da, new.a)) then
    raise exception 'non_nella_stanza' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.mai_con_chi_ha_lasciato() from public, anon, authenticated;
create trigger chiavi_mai_con_chi_ha_lasciato before insert or update on public.chiavi
  for each row execute function public.mai_con_chi_ha_lasciato();
create trigger regali_mai_con_chi_ha_lasciato before insert on public.regali
  for each row execute function public.mai_con_chi_ha_lasciato();

-- Chiamate (#4): api/dati_chiamata.js chiede sospesi_tra() chi è fuori adesso. Come in 20261117094536_sospesi_tra.sql,
-- in più: chi ha lasciato una stanza ancora aperta, fino alla sua chiusura (non chiama e non riceve chiamate).
create or replace function public.sospesi_tra(p_persone uuid[])
  returns table (persona uuid) language sql stable security definer set search_path = '' as $$
  select distinct x from unnest(coalesce(p_persone, '{}'::uuid[])) as x
  where public.sospeso(x)
     or exists (select 1 from public.lasciate_stanza l join public.stanze s on s.id = l.stanza_id
                where l.persona = x and now() < s.chiude_il)
$$;
