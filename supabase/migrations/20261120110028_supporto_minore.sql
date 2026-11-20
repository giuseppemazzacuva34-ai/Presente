-- Fase 2 · issue #10 parte B v1.1 (CPO, 20/11); D122 B · passo 3 della linea «sviluppatore-c»: «possibile minore».
-- Un messaggio «Scrivici» con parole di minore età («ho 16 anni», «minorenne», «sono al liceo»…) prende il segno
-- «minore»: l'agente non può scrivere la bozza e il messaggio va in cima alla coda di chi risponde, come la bandiera
-- «sicurezza». All'utente non cambia nulla: invia_supporto restituisce sempre la sola bandiera di pericolo (riga del
-- 112). L'avviso da 1 ora per email è un passo successivo, concordato con la linea «sviluppatore-b» (#7).
-- Scelta tecnica: meglio un messaggio in più a Giuseppe che una bozza automatica a un possibile minore.
-- Solo aggiunte: una colonna con valore predefinito e funzioni/vista sostituite con la stessa firma.

alter table public.supporto add column minore boolean not null default false;

create function public.parole_minore(p_testo text) returns boolean
  language sql immutable set search_path = '' as $$
  select lower(coalesce(p_testo, '')) ~ '(minorenn|\mho (1[0-7]|tredici|quattordici|quindici|sedici|diciassette) anni|\mfaccio (la|il) (prima|seconda|terza|quarta|quinta)? ?(media|liceo|superiore)|\mvado (al liceo|alle medie|alle superiori)|\msono (al liceo|alle medie|alle superiori))'
$$;
revoke all on function public.parole_minore(text) from public, anon, authenticated;
grant execute on function public.parole_minore(text) to service_role;

create or replace function public.invia_supporto(p_utente uuid, p_categoria text, p_testo text) returns jsonb
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
  insert into public.supporto (utente_id, categoria, testo, sicurezza, minore)
    values (p_utente, p_categoria, p_testo, public.parole_pericolo(p_testo), public.parole_minore(p_testo))
    returning * into nuovo;
  return jsonb_build_object('esito', 'inviato', 'id', nuovo.id, 'sicurezza', nuovo.sicurezza);
end $$;

-- Coda per chi risponde: «possibile minore» in cima come la bandiera «sicurezza» (stesse colonne di prima).
create or replace function public.coda_supporto()
  returns table (id uuid, email text, categoria text, testo text, creato_il timestamptz, stato text, sicurezza boolean)
  language sql stable security definer set search_path = '' as $$
  select s.id, u.email::text, s.categoria, s.testo, s.creato_il,
    case when s.risposta is null then 'inviato' else 'risposto' end, (s.sicurezza or s.minore)
  from public.supporto s join auth.users u on u.id = s.utente_id
  order by (s.risposta is not null), (s.sicurezza or s.minore) desc, s.creato_il
$$;

create or replace function public.controlla_bozza_supporto() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.supporto s
                 where s.id = new.messaggio_id and s.risposta is null and not s.sicurezza and not s.minore) then
    raise exception 'bozza_non_ammessa' using errcode = 'check_violation';
  end if;
  return new;
end $$;

-- Per l'agente un possibile minore è «da non toccare»: stessa bandiera della sicurezza, nessun campo in più.
create or replace view public.supporto_per_agente with (security_invoker = false) as
  select s.id, s.categoria, public.maschera_contatti(s.testo) as testo, s.creato_il,
    case when b.messaggio_id is null then 'inviato' else 'bozza_pronta' end as stato,
    (s.sicurezza or s.minore) as sicurezza
  from public.supporto s
  left join public.supporto_bozze b on b.messaggio_id = s.id
  where s.risposta is null;
