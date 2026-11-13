-- Fase 2 · issue #5 spec v1.1 (CPO, 30/10; D14 A, D51 A) · linea «sviluppatore-c», passo 2: le chiavi nel database.
-- Regole uguali a api/chiavi.js e api/regole.js (i test lo controllano): 2 chiavi per stanza, una sola per persona,
-- solo a chi hai chiamato in questa stanza per almeno 60 secondi, frase facoltativa di 140 caratteri senza contatti,
-- tutto chiuso dalle 20:59:00 (un minuto prima della chiusura della stanza), ora del server.
-- In segreto: le legge e le scrive SOLO il server (ruolo di servizio). Nessuna funzione dice a qualcuno quante chiavi
-- ha ricevuto o da chi: le_mie_chiavi restituisce solo quelle che hai dato tu. Una chiave ripresa si cancella.
-- Blocco da una parte o dall'altra, o uscita dalla stanza: le chiavi tra i due spariscono in silenzio.
-- L'apertura delle porte delle 21:00 e la pulizia delle chiavi non ricambiate sono il passo successivo.

create table public.chiavi (
  stanza_id uuid not null,
  da uuid not null,
  a uuid not null,
  frase text check (char_length(frase) between 1 and 140), -- letta solo se la porta si apre
  data_il timestamptz not null default now(),
  primary key (stanza_id, da, a),
  constraint mai_a_se_stessi check (da <> a),
  -- Chi lascia la stanza (account eliminato, tolto dalla stanza): le chiavi date e ricevute spariscono.
  foreign key (stanza_id, da) references public.membri_stanza (stanza_id, utente_id) on delete cascade,
  foreign key (stanza_id, a) references public.membri_stanza (stanza_id, utente_id) on delete cascade
);
create index chiavi_a on public.chiavi (stanza_id, a);

alter table public.chiavi enable row level security;
revoke all on public.chiavi from public, anon, authenticated;
grant select, insert, update, delete on public.chiavi to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- Frase pulita (spazi doppi e ai lati tolti; vuota = nessuna frase) oppure il motivo del rifiuto.
-- Contatti come in api/chiavi.js: 6 o più cifre di fila, «@», link, www, domini e nomi di social comuni.
create function public.frase_chiave(p_frase text, out frase text, out motivo text)
  language plpgsql immutable set search_path = '' as $$
begin
  frase := nullif(btrim(regexp_replace(coalesce(p_frase, ''), '\s+', ' ', 'g')), '');
  motivo := null;
  if frase is null then return; end if;
  if char_length(frase) > 140 then motivo := 'troppo_lunga';
  elsif frase ~ '(\d[\s./-]*){6,}' or frase ~ '@' or frase ~* 'https?:' or frase ~* '\mwww\M'
     or frase ~* '\.(com|it|net|org|eu|me|ly|link)\M'
     or frase ~* '\m(instagram|insta|ig|facebook|fb|tiktok|telegram|whatsapp|wa|snapchat|snap|twitter|threads|onlyfans|signal|linkedin)\M'
  then motivo := 'contatti';
  end if;
  if motivo is not null then frase := null; end if;
end $$;
revoke all on function public.frase_chiave(text) from public, anon, authenticated;
grant execute on function public.frase_chiave(text) to service_role;

-- La stanza aperta adesso di una persona (al massimo una per settimana, vedi controlla_membro_stanza).
create function public.stanza_aperta_di(p_utente uuid) returns public.stanze
  language sql stable security definer set search_path = '' as $$
  select s.* from public.stanze s join public.membri_stanza m on m.stanza_id = s.id and m.utente_id = p_utente
  where now() >= s.apre_il and now() < s.chiude_il
  order by s.chiude_il limit 1
$$;
revoke all on function public.stanza_aperta_di(uuid) from public, anon, authenticated;
grant execute on function public.stanza_aperta_di(uuid) to service_role;

-- Dare una chiave. 'ok' oppure il motivo (gli stessi codici di api/chiavi.js).
-- Con un blocco la risposta è la stessa di «non è più nella stanza»: non si dice perché.
create function public.dai_chiave(p_da uuid, p_a uuid, p_frase text) returns text
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

-- Riprendere la propria chiave: si cancella con la frase, l'altra persona non lo saprà.
create function public.riprendi_chiave(p_da uuid, p_a uuid) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
begin
  s := public.stanza_aperta_di(p_da);
  if s.id is not null and now() >= s.chiude_il - interval '1 minute' then return 'chiuse'; end if;
  delete from public.chiavi c where c.stanza_id = s.id and c.da = p_da and c.a = p_a;
  if not found then return 'non_data'; end if;
  return 'ok';
end $$;
revoke all on function public.riprendi_chiave(uuid, uuid) from public, anon, authenticated;
grant execute on function public.riprendi_chiave(uuid, uuid) to service_role;

-- Cambiare (o togliere, con testo vuoto) la frase della propria chiave.
create function public.cambia_frase(p_da uuid, p_a uuid, p_frase text) returns text
  language plpgsql security definer set search_path = '' as $$
declare
  s public.stanze;
  f record;
begin
  s := public.stanza_aperta_di(p_da);
  if s.id is not null and now() >= s.chiude_il - interval '1 minute' then return 'chiuse'; end if;
  if not exists (select 1 from public.chiavi c where c.stanza_id = s.id and c.da = p_da and c.a = p_a) then return 'non_data'; end if;
  f := public.frase_chiave(p_frase);
  if f.motivo is not null then return f.motivo; end if;
  update public.chiavi c set frase = f.frase where c.stanza_id = s.id and c.da = p_da and c.a = p_a;
  return 'ok';
end $$;
revoke all on function public.cambia_frase(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.cambia_frase(uuid, uuid, text) to service_role;

-- Le chiavi che HAI DATO nella stanza aperta (per «Le tue chiavi: N» e «Hai dato una chiave»). Mai quelle ricevute.
create function public.le_mie_chiavi(p_utente uuid) returns table (a uuid, frase text, data_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select c.a, c.frase, c.data_il from public.chiavi c
  where c.da = p_utente and c.stanza_id = (public.stanza_aperta_di(p_utente)).id
  order by c.data_il
$$;
revoke all on function public.le_mie_chiavi(uuid) from public, anon, authenticated;
grant execute on function public.le_mie_chiavi(uuid) to service_role;

-- Un blocco, da una parte o dall'altra, annulla in silenzio le chiavi tra i due (spec, casi limite).
create function public.annulla_chiavi_per_blocco() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  delete from public.chiavi c where (c.da = new.chi and c.a = new.bloccato) or (c.da = new.bloccato and c.a = new.chi);
  return null;
end $$;
revoke all on function public.annulla_chiavi_per_blocco() from public, anon, authenticated;
create trigger annulla_chiavi_per_blocco after insert on public.blocchi
  for each row execute function public.annulla_chiavi_per_blocco();
