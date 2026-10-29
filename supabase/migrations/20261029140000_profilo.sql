-- Fase 2 · issue #2 · profilo, filtri, questionario privato, voce e foto (specifica v1 e v1.1 del CPO).
-- D23 A: tutto in Supabase UE (Francoforte), con regole per riga (RLS) attive su ogni tabella e file privati.
-- In questa migrazione ogni persona legge e modifica SOLO i propri dati. Cosa vedono gli altri della stessa
-- stanza (nome, età, città, voce) arriva con la #3, attraverso funzioni del server, mai leggendo queste tabelle.

-- ---------------------------------------------------------------------------------------------------------
-- Profilo: passi 3 e 5 (data di nascita, nome, città, mi presento come) + punto in cui riprendere.
create table public.profili (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text check (nome ~ '^[[:alpha:]][[:alpha:]'' -]{1,19}$'),
  data_nascita date,
  citta text check (char_length(citta) between 1 and 80),
  paese text not null default 'IT' check (paese ~ '^[A-Z]{2}$'),
  mi_presento_come text check (mi_presento_come in ('donna', 'uomo', 'non_binario', 'mi_descrivo')),
  mi_descrivo text check (char_length(mi_descrivo) <= 40),
  regole_accettate_il timestamptz,
  passo smallint not null default 1 check (passo between 1 and 11),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

-- Solo maggiorenni, e la data di nascita una volta scritta non si cambia (specifica v1).
create function public.controlla_profilo() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and old.data_nascita is not null and new.data_nascita is distinct from old.data_nascita then
    raise exception 'La data di nascita non si può modificare.' using errcode = 'check_violation';
  end if;
  if new.data_nascita is not null and new.data_nascita > (current_date - interval '18 years')::date then
    raise exception 'Presente è solo per maggiorenni.' using errcode = 'check_violation';
  end if;
  if new.data_nascita is not null and new.data_nascita < date '1920-01-01' then
    raise exception 'Data di nascita non valida.' using errcode = 'check_violation';
  end if;
  new.aggiornato_il := now();
  return new;
end $$;
create trigger controlla_profilo before insert or update on public.profili
  for each row execute function public.controlla_profilo();

-- ---------------------------------------------------------------------------------------------------------
-- Filtri: passo 6. «cerco» può rivelare l'orientamento: si salva solo con il consenso separato,
-- registrato con data e versione dell'informativa (criterio di accettazione della #2).
create table public.filtri (
  utente_id uuid primary key references auth.users (id) on delete cascade,
  cerco text check (cerco in ('donne', 'uomini', 'tutti')),
  consenso_cerco_il timestamptz,
  consenso_versione_informativa text check (char_length(consenso_versione_informativa) between 1 and 10),
  eta_min smallint check (eta_min between 18 and 99),
  eta_max smallint check (eta_max between 18 and 99),
  raggio text check (raggio in ('citta', 'italia', 'estero')),
  cosa_cerco text check (cosa_cerco in ('storia_seria', 'senza_fretta')),
  figli text check (figli in ('ne_voglio', 'forse', 'no', 'ne_ho')),
  fumo text check (fumo in ('si', 'no', 'indifferente')),
  aggiornato_il timestamptz not null default now(),
  constraint eta_in_ordine check (eta_min is null or eta_max is null or eta_min <= eta_max),
  constraint cerco_con_consenso check (cerco is null or (consenso_cerco_il is not null and consenso_versione_informativa is not null))
);

-- ---------------------------------------------------------------------------------------------------------
-- Questionario privato: passo 9 (D35 A, 15 domande v1; domande e calcolo in api/questionario.js, solo server).
-- Una riga per «versione in vigore»: la modifica fatta in settimana vale dalla stanza del lunedì successivo
-- (alle 9:00 di Roma), quindi non cambia mai la stanza in corso. Le righe già in vigore non si toccano più:
-- così si modifica al massimo una volta a settimana (tutte le modifiche della settimana finiscono nella stessa riga).
-- L'affinità NON si salva qui: si calcola sul server e nessun utente la può leggere.
create table public.questionario (
  utente_id uuid not null references auth.users (id) on delete cascade,
  in_vigore_dal timestamptz not null,
  versione text not null default 'v1' check (versione = 'v1'),
  risposte jsonb not null default '{}'::jsonb check (jsonb_typeof(risposte) = 'object'),
  importanza jsonb not null default '{}'::jsonb check (jsonb_typeof(importanza) = 'object'),
  aggiornato_il timestamptz not null default now(),
  primary key (utente_id, in_vigore_dal)
);

-- Prossima apertura delle stanze: lunedì alle 9:00 ora di Roma, strettamente dopo «adesso».
create function public.prossima_apertura(adesso timestamptz default now()) returns timestamptz
language sql stable as $$
  -- Il calcolo si fa sull'ora locale di Roma (senza fuso) e solo alla fine si converte: così con il cambio d'ora
  -- l'apertura resta alle 9:00 di Roma (8:00 UTC d'inverno, 7:00 UTC d'estate).
  select case when (lun at time zone 'Europe/Rome') > adesso then lun at time zone 'Europe/Rome'
              else (lun + interval '7 days') at time zone 'Europe/Rome' end
  from (select date_trunc('week', adesso at time zone 'Europe/Rome') + interval '9 hours' as lun) x
$$;

create function public.controlla_questionario() returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.in_vigore_dal := public.prossima_apertura();
  elsif new.in_vigore_dal is distinct from old.in_vigore_dal or new.utente_id is distinct from old.utente_id then
    raise exception 'Non si cambia la settimana di una risposta.' using errcode = 'check_violation';
  end if;
  new.aggiornato_il := now();
  return new;
end $$;
create trigger controlla_questionario before insert or update on public.questionario
  for each row execute function public.controlla_questionario();

-- ---------------------------------------------------------------------------------------------------------
-- Regole per riga: ognuno vede e modifica solo le proprie righe. Nessun accesso senza login (anon).
alter table public.profili enable row level security;
alter table public.filtri enable row level security;
alter table public.questionario enable row level security;

revoke all on public.profili, public.filtri, public.questionario from anon, authenticated;
grant select, insert, update on public.profili, public.filtri to authenticated;
grant select, insert, update on public.questionario to authenticated;

create policy "profilo: solo il proprietario legge" on public.profili for select to authenticated
  using (id = auth.uid());
create policy "profilo: solo il proprietario crea" on public.profili for insert to authenticated
  with check (id = auth.uid());
create policy "profilo: solo il proprietario modifica" on public.profili for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "filtri: solo il proprietario legge" on public.filtri for select to authenticated
  using (utente_id = auth.uid());
create policy "filtri: solo il proprietario crea" on public.filtri for insert to authenticated
  with check (utente_id = auth.uid());
create policy "filtri: solo il proprietario modifica" on public.filtri for update to authenticated
  using (utente_id = auth.uid()) with check (utente_id = auth.uid());

create policy "questionario: solo il proprietario legge" on public.questionario for select to authenticated
  using (utente_id = auth.uid());
create policy "questionario: solo il proprietario crea" on public.questionario for insert to authenticated
  with check (utente_id = auth.uid());
-- Si modifica solo la versione non ancora in vigore (quella del prossimo lunedì).
create policy "questionario: si modifica solo la prossima settimana" on public.questionario for update to authenticated
  using (utente_id = auth.uid() and in_vigore_dal > now()) with check (utente_id = auth.uid());

-- La cancellazione dell'account (auth.users) cancella a cascata profilo, filtri e questionario.
-- I file di voce e foto li cancella il server con la chiave service_role (Supabase non permette di cancellarli in SQL).

-- ---------------------------------------------------------------------------------------------------------
-- File privati (Storage): passi 7, 8 (voce) e 10 (foto). Nessun indirizzo pubblico.
-- Ogni file sta nella cartella della persona: voci/<id utente>/..., foto/<id utente>/...
-- Le foto arrivano già ridimensionate e senza EXIF (le ricodifica il telefono prima di caricarle).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('voci', 'voci', false, 2097152, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac']),
  ('foto', 'foto', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "voci e foto: solo il proprietario legge" on storage.objects for select to authenticated
  using (bucket_id in ('voci', 'foto') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voci e foto: solo il proprietario carica" on storage.objects for insert to authenticated
  with check (bucket_id in ('voci', 'foto') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voci e foto: solo il proprietario sostituisce" on storage.objects for update to authenticated
  using (bucket_id in ('voci', 'foto') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('voci', 'foto') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "voci e foto: solo il proprietario cancella" on storage.objects for delete to authenticated
  using (bucket_id in ('voci', 'foto') and (storage.foldername(name))[1] = auth.uid()::text);
