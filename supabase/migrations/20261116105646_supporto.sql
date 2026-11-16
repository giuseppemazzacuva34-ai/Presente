-- Fase 2 · issue #10 spec v1 (CPO, 6/11) · parte A, passo 1 della linea «sviluppatore-c»: i messaggi «Scrivici».
-- Una riga per messaggio: chi scrive, categoria, testo (max 1.000), bandiera «sicurezza», quando, risposta.
-- La scrive e la legge SOLO il server (ruolo di servizio): il telefono passa dal Worker, che manda sempre l'utente
-- del token, quindi nessuno vede i messaggi di un altro. Chi risponde (Giuseppe) vede solo email, categoria, testo,
-- data, stato e bandiera: mai voce, foto, questionario, diario, chiavi o valutazioni.
-- Parte B (agente che prepara le risposte, D122) non è qui: nessuna IA legge questa tabella.
-- I messaggi si cancellano con l'account (spec, casi limite). Nessun testo nei log.

create table public.supporto (
  id uuid primary key default gen_random_uuid(),
  utente_id uuid not null references auth.users (id) on delete cascade,
  categoria text not null check (categoria in ('account', 'stanza_chiamate', 'chiavi_porte', 'crediti', 'incontro', 'test', 'altro')),
  testo text not null check (char_length(testo) between 1 and 1000 and btrim(testo) <> ''),
  sicurezza boolean not null default false,
  creato_il timestamptz not null default now(),
  risposta text check (char_length(risposta) between 1 and 4000),
  risposto_il timestamptz,
  constraint risposta_con_data check ((risposta is null) = (risposto_il is null))
);
create index supporto_utente on public.supporto (utente_id, creato_il);
create index supporto_coda on public.supporto (sicurezza desc, creato_il) where risposta is null;

alter table public.supporto enable row level security;
revoke all on public.supporto from public, anon, authenticated;
grant select, insert, update, delete on public.supporto to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

-- Parole di pericolo (spec: «paura», «minacc», «aggred», «mi segue», «ricatt» e simili): il messaggio prende la
-- bandiera «sicurezza», va in cima alla coda e l'app mostra subito «Sono in difficoltà».
create function public.parole_pericolo(p_testo text) returns boolean
  language sql immutable set search_path = '' as $$
  select lower(coalesce(p_testo, '')) ~ '(paura|minacc|aggred|mi segue|mi seguiva|ricatt|perseguit|stalk|picchi|violen|pericolo|mi fa male|mi ha fatto male|non sono al sicuro)'
$$;
revoke all on function public.parole_pericolo(text) from public, anon, authenticated;
grant execute on function public.parole_pericolo(text) to service_role;

-- Salva un messaggio. Esiti: 'inviato' (con id e bandiera), 'vuoto' (testo vuoto o solo spazi), 'troppi' (già 5
-- messaggi oggi, ora di Roma). Categoria fuori elenco o testo oltre 1.000 caratteri: errore (il Worker li ferma prima).
create function public.invia_supporto(p_utente uuid, p_categoria text, p_testo text) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  oggi timestamptz := date_trunc('day', now() at time zone 'Europe/Rome') at time zone 'Europe/Rome';
  n integer;
  nuovo public.supporto;
begin
  if p_testo is null or btrim(p_testo) = '' then return jsonb_build_object('esito', 'vuoto'); end if;
  -- Due invii insieme dello stesso utente non superano il limite.
  perform pg_advisory_xact_lock(hashtextextended('supporto:' || p_utente::text, 0));
  select count(*) into n from public.supporto where utente_id = p_utente and creato_il >= oggi;
  if n >= 5 then return jsonb_build_object('esito', 'troppi'); end if;
  insert into public.supporto (utente_id, categoria, testo, sicurezza)
    values (p_utente, p_categoria, p_testo, public.parole_pericolo(p_testo))
    returning * into nuovo;
  return jsonb_build_object('esito', 'inviato', 'id', nuovo.id, 'sicurezza', nuovo.sicurezza);
end $$;
revoke all on function public.invia_supporto(uuid, text, text) from public, anon, authenticated;
grant execute on function public.invia_supporto(uuid, text, text) to service_role;

-- «I miei messaggi»: solo quelli di p_utente (il Worker passa sempre l'utente del token), i più recenti prima.
create function public.miei_messaggi_supporto(p_utente uuid)
  returns table (id uuid, categoria text, testo text, creato_il timestamptz, stato text, risposta text, risposto_il timestamptz)
  language sql stable security definer set search_path = '' as $$
  select s.id, s.categoria, s.testo, s.creato_il,
    case when s.risposta is null then 'inviato' else 'risposto' end, s.risposta, s.risposto_il
  from public.supporto s where s.utente_id = p_utente
  order by s.creato_il desc
$$;
revoke all on function public.miei_messaggi_supporto(uuid) from public, anon, authenticated;
grant execute on function public.miei_messaggi_supporto(uuid) to service_role;

-- Coda per chi risponde: prima i messaggi senza risposta, con bandiera «sicurezza» in cima, poi i più vecchi.
-- Solo email dell'account, categoria, testo, data, stato e bandiera.
create function public.coda_supporto()
  returns table (id uuid, email text, categoria text, testo text, creato_il timestamptz, stato text, sicurezza boolean)
  language sql stable security definer set search_path = '' as $$
  select s.id, u.email::text, s.categoria, s.testo, s.creato_il,
    case when s.risposta is null then 'inviato' else 'risposto' end, s.sicurezza
  from public.supporto s join auth.users u on u.id = s.utente_id
  order by (s.risposta is not null), s.sicurezza desc, s.creato_il
$$;
revoke all on function public.coda_supporto() from public, anon, authenticated;
grant execute on function public.coda_supporto() to service_role;

-- Salva la risposta (l'email la manda chi risponde dall'indirizzo di Presente). true = salvata; false = messaggio
-- inesistente o già con risposta (una risposta data non si sovrascrive).
create function public.rispondi_supporto(p_id uuid, p_risposta text) returns boolean
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.supporto set risposta = p_risposta, risposto_il = now()
    where id = p_id and risposta is null;
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke all on function public.rispondi_supporto(uuid, text) from public, anon, authenticated;
grant execute on function public.rispondi_supporto(uuid, text) to service_role;
