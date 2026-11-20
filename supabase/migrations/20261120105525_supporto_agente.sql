-- Fase 2 · issue #10 parte B v1 (CPO, 13/11) e v1.1 (20/11); D122 B · passo 2 della linea «sviluppatore-c».
-- Cosa può fare l'agente che prepara le bozze delle risposte a «Scrivici» (crm, dal 1° dicembre, solo con la beta).
-- Ruolo «agente_supporto», senza accesso (nologin): qui ci sono solo i permessi. Come entra (password o chiave) lo
-- decide un passo successivo con Giuseppe; finché nessuno lo collega, nessun agente legge niente.
--   Legge SOLO la vista «supporto_per_agente»: id, categoria, testo con i contatti mascherati, data, stato e bandiera
--   «sicurezza», e solo per i messaggi ancora senza risposta. Mai email, id utente, nome, voce, foto, questionario,
--   diario, chiavi, valutazioni o segnalazioni.
--   Scrive SOLO nuove righe in «supporto_bozze» (una per messaggio): niente modifiche, niente cancellazioni, niente
--   lettura delle bozze già scritte. Un messaggio con bandiera «sicurezza» o già risposto non riceve mai una bozza.
-- La bozza non parte mai da sola: la invia solo Giuseppe dal pannello (passo successivo). Nessun testo nei log.
-- Scelta tecnica: vista con i permessi del proprietario (security_invoker spento), perché l'agente non deve avere
-- alcun permesso sulla tabella «supporto»; la vista è data solo ad agente_supporto e al server.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'agente_supporto') then
    create role agente_supporto nologin noinherit;
  end if;
end $$;
grant usage on schema public to agente_supporto;

create table public.supporto_bozze (
  messaggio_id uuid primary key references public.supporto (id) on delete cascade,
  testo text not null check (btrim(testo) <> '' and char_length(testo) <= 1500
    and coalesce(array_length(regexp_split_to_array(btrim(testo), '\s+'), 1), 0) <= 120),
  fonte text not null check (fonte = 'nessuna' or fonte ~ '^FAQ n\. ([1-9]|1[0-2])$'),
  con_istruzioni boolean not null default false,
  creato_il timestamptz not null default now()
);
alter table public.supporto_bozze enable row level security;
revoke all on public.supporto_bozze from public, anon, authenticated;
grant select, insert, update, delete on public.supporto_bozze to service_role;
grant insert (messaggio_id, testo, fonte, con_istruzioni) on public.supporto_bozze to agente_supporto;
create policy agente_scrive_bozze on public.supporto_bozze for insert to agente_supporto with check (true);

-- Controllo prima di ogni bozza: il messaggio esiste, non ha risposta e non ha la bandiera «sicurezza».
create function public.controlla_bozza_supporto() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.supporto s
                 where s.id = new.messaggio_id and s.risposta is null and not s.sicurezza) then
    raise exception 'bozza_non_ammessa' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke all on function public.controlla_bozza_supporto() from public, anon, authenticated, agente_supporto;
create trigger controlla_bozza before insert on public.supporto_bozze
  for each row execute function public.controlla_bozza_supporto();

create view public.supporto_per_agente with (security_invoker = false) as
  select s.id, s.categoria, public.maschera_contatti(s.testo) as testo, s.creato_il,
    case when b.messaggio_id is null then 'inviato' else 'bozza_pronta' end as stato,
    s.sicurezza
  from public.supporto s
  left join public.supporto_bozze b on b.messaggio_id = s.id
  where s.risposta is null;
revoke all on public.supporto_per_agente from public, anon, authenticated;
-- In Postgres le funzioni dentro una vista si eseguono con i permessi di chi legge: maschera_contatti è pura (non
-- legge tabelle), quindi darla all'agente non apre nulla.
grant execute on function public.maschera_contatti(text) to agente_supporto;
grant select on public.supporto_per_agente to agente_supporto, service_role;
