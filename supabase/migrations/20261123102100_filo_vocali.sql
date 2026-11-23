-- Fase 2 · issue #360 «Il Filo della stanza», spec v1 + v1.1 del CPO (22-23/11, D151 A) · passo 2 della linea
-- «sviluppatore-c»: i due vocali del Filo (lunedì e domenica).
--   · contenitore privato «vocali_filo»: file in <stanza_id>/<nome>. Nessuna regola per il telefono: carica e legge
--     solo il Worker (chiave del server), i membri ascoltano con link firmati a scadenza breve (passo successivo).
--     Niente voci generate: il Filo registra con la sua voce (spec, «Dati»).
--   · vocali_filo: un vocale per stanza e tipo, con durata e «Testo del vocale» obbligatorio (max 900 caratteri).
--   · salva_vocale_filo: solo il Filo della stanza, solo negli orari della spec, calcolati in ora di Roma (giusti
--     anche la settimana del cambio d'ora):
--       lunedì   10-90 s, dalla composizione (00:30) fino alle 8:45 si rifà; dalle 8:45 alle 13:00 si carica solo
--                se manca; dopo le 13:00 per quella settimana non c'è;
--       domenica 10-60 s, da sabato 9:00 a domenica 20:00, rifacibile; senza il numero delle porte.
--     Restituisce il file sostituito (da cancellare dal contenitore) o null.
-- La cancellazione 7 giorni dopo la chiusura arriva con il lavoro di pulizia (passo successivo). Solo aggiunte.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('vocali_filo', 'vocali_filo', false, 2097152, array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create table public.vocali_filo (
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  tipo text not null check (tipo in ('lunedi', 'domenica')),
  file text not null unique check (char_length(file) between 1 and 200),
  durata smallint not null check (durata between 10 and 90),
  testo text not null check (char_length(btrim(testo)) between 1 and 900),
  caricato_il timestamptz not null,
  primary key (stanza_id, tipo)
);

alter table public.vocali_filo enable row level security;
revoke all on public.vocali_filo from public, anon, authenticated, service_role;
grant select on public.vocali_filo to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.

create function public.salva_vocale_filo(p_filo uuid, p_stanza uuid, p_tipo text, p_file text, p_durata integer,
                                         p_testo text, p_ora timestamptz)
  returns text
  language plpgsql security definer set search_path = '' as $$
declare
  s record;
  apre date;
  chiude date;
  vecchio text;
begin
  select st.apre_il, st.chiude_il into s from public.stanze_del_filo(p_filo, p_ora) st where st.id = p_stanza;
  if not found then
    raise exception 'non_filo' using errcode = 'insufficient_privilege';
  end if;
  if p_tipo is null or p_tipo not in ('lunedi', 'domenica') then
    raise exception 'tipo' using errcode = 'check_violation';
  end if;
  if p_durata is null or p_durata < 10 or p_durata > (case p_tipo when 'lunedi' then 90 else 60 end) then
    raise exception 'durata' using errcode = 'check_violation';
  end if;
  if p_testo is null or char_length(btrim(p_testo)) not between 1 and 900 then
    raise exception 'testo' using errcode = 'check_violation';
  end if;
  if p_file is null or p_file !~ '^[A-Za-z0-9_-]{1,80}\.(webm|ogg|m4a|mp4|mp3|aac)$' then
    raise exception 'file' using errcode = 'check_violation';
  end if;

  select v.file into vecchio from public.vocali_filo v where v.stanza_id = p_stanza and v.tipo = p_tipo;
  apre := (s.apre_il at time zone 'Europe/Rome')::date;
  chiude := (s.chiude_il at time zone 'Europe/Rome')::date;
  if p_tipo = 'lunedi' then
    if not (p_ora < ((apre + time '08:45') at time zone 'Europe/Rome')
            or (vecchio is null and p_ora < ((apre + time '13:00') at time zone 'Europe/Rome'))) then
      raise exception 'fuori_orario' using errcode = 'check_violation';
    end if;
  elsif not (p_ora >= (((chiude - 1) + time '09:00') at time zone 'Europe/Rome')
             and p_ora < ((chiude + time '20:00') at time zone 'Europe/Rome')) then
    raise exception 'fuori_orario' using errcode = 'check_violation';
  end if;

  insert into public.vocali_filo as v (stanza_id, tipo, file, durata, testo, caricato_il)
    values (p_stanza, p_tipo, p_stanza::text || '/' || p_file, p_durata, btrim(p_testo), p_ora)
    on conflict (stanza_id, tipo) do update
      set file = excluded.file, durata = excluded.durata, testo = excluded.testo, caricato_il = excluded.caricato_il;
  return vecchio;
end $$;
revoke all on function public.salva_vocale_filo(uuid, uuid, text, text, integer, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.salva_vocale_filo(uuid, uuid, text, text, integer, text, timestamptz) to service_role;
