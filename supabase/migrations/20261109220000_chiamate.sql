-- Fase 2 · issue #4 · chiamate solo voce, passo 2 di 4: il database (spec v1, v1.1, v1.2 del CPO; D31 B, D32 A, D58 A).
-- Le chiamate non si registrano e non si analizzano: qui non c'è nessun audio. Il registro tiene SOLO chi, con, inizio,
-- durata e come è finita (spec v1.1). Lo scrive solo il server (Worker, ruolo di servizio); il telefono legge le sue righe.
-- Le carte (le 30 approvate con D58 A) e le carte già viste dalla coppia le legge solo il server, che le manda ai due telefoni.
-- Le carte viste si cancellano quando la stanza chiude (pulisci_carte_viste, la chiama il lavoro della domenica).
-- Fascia di disponibilità (D31 B) e «mi chiamano solo persone a cui do il permesso» (D32 A) stanno nel profilo;
-- i blocchi (D32 A) sono immediati e definitivi: non si tolgono e chi è bloccato non lo vede.

-- ---------------------------------------------------------------------------------------------------------
-- Registro delle chiamate. Chiave: chi chiama + istante di inizio (nessuno apre due chiamate nello stesso istante),
-- così non serve un campo in più. durata ed esito restano vuoti finché la chiamata è in corso.
create table public.chiamate (
  chi uuid not null references auth.users (id) on delete cascade,
  con uuid not null references auth.users (id) on delete cascade,
  inizio timestamptz not null,
  durata integer check (durata between 0 and 900), -- secondi, mai oltre 15 minuti
  esito text check (esito in ('tempo_scaduto', 'chiusa', 'chiudi_e_segnala', 'caduta')),
  primary key (chi, inizio),
  constraint mai_con_se_stessi check (chi <> con),
  constraint finita_con_durata_ed_esito check ((durata is null) = (esito is null))
);
create index chiamate_con on public.chiamate (con, inizio);

-- ---------------------------------------------------------------------------------------------------------
-- Carte della conversazione: tabella di configurazione (spec v1.1), testi esattamente come approvati (D58 A).
create table public.carte (
  id smallint primary key check (id > 0),
  versione text not null check (versione ~ '^v[0-9]+$'),
  testo text not null check (char_length(testo) between 1 and 200),
  attiva boolean not null default true
);
insert into public.carte (id, versione, testo, attiva) values
  (1, 'v1', 'Qual è il suono che ti mette di buon umore?', true),
  (2, 'v1', 'La canzone che canti sotto la doccia, senza vergogna?', true),
  (3, 'v1', 'Mare o montagna? E perché proprio così?', true),
  (4, 'v1', 'Il piatto che sapresti cucinare a occhi chiusi?', true),
  (5, 'v1', 'Qual è la cosa più bella che hai sentito oggi?', true),
  (6, 'v1', 'Mattina presto o notte fonda?', true),
  (7, 'v1', 'Un viaggio che rifaresti domani?', true),
  (8, 'v1', 'Il film che riguardi sempre volentieri?', true),
  (9, 'v1', 'Cosa ti fa ridere anche quando non dovresti?', true),
  (10, 'v1', 'Il regalo più bello che hai ricevuto senza che costasse nulla?', true),
  (11, 'v1', 'Una piccola abitudine a cui non rinunci?', true),
  (12, 'v1', 'Se domani avessi un giorno libero, come lo passeresti?', true),
  (13, 'v1', 'Un profumo che ti riporta indietro nel tempo?', true),
  (14, 'v1', 'Gatti, cani o nessuno dei due?', true),
  (15, 'v1', 'L''ultima cosa che hai imparato per pura curiosità?', true),
  (16, 'v1', 'Una frase che ti hanno detto e non hai mai dimenticato?', true),
  (17, 'v1', 'Il posto perfetto per una domenica pigra?', true),
  (18, 'v1', 'Che cosa ordini sempre al bar?', true),
  (19, 'v1', 'Sei più da piano preciso o da «vediamo come va»?', true),
  (20, 'v1', 'Una cosa che sai fare e che pochi immaginano?', true),
  (21, 'v1', 'Il complimento che ti fa più piacere ricevere?', true),
  (22, 'v1', 'Il libro, la serie o il podcast che consiglieresti a tutti?', true),
  (23, 'v1', 'Qual è la tua stagione preferita, e cosa ti piace di lei?', true),
  (24, 'v1', 'Una paura piccola e un po'' buffa?', true),
  (25, 'v1', 'Il primo concerto o spettacolo che ricordi?', true),
  (26, 'v1', 'Colazione dolce o salata?', true),
  (27, 'v1', 'Cosa ti fa sentire a casa?', true),
  (28, 'v1', 'Un sogno nel cassetto che si può dire ad alta voce?', true),
  (29, 'v1', 'Come sarebbe la tua serata ideale con una persona nuova?', true),
  (30, 'v1', 'Se la tua voce fosse un colore, quale sarebbe?', true);

-- Quali carte ha già visto la coppia nella settimana (= nella stanza), per non ripeterle. Coppia sempre con a < b.
create table public.carte_viste (
  stanza_id uuid not null references public.stanze (id) on delete cascade,
  a uuid not null references auth.users (id) on delete cascade,
  b uuid not null references auth.users (id) on delete cascade,
  carta_id smallint not null references public.carte (id),
  primary key (stanza_id, a, b, carta_id),
  constraint coppia_in_ordine check (a < b)
);

-- Pulizia alla chiusura della stanza: restituisce quante righe ha cancellato.
create function public.pulisci_carte_viste() returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  delete from public.carte_viste v using public.stanze s where s.id = v.stanza_id and s.chiude_il <= now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.pulisci_carte_viste() from public, anon, authenticated;
grant execute on function public.pulisci_carte_viste() to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Profilo: fascia di disponibilità (ore di Roma «HH:MM», tutte e due o nessuna; senza fascia = sempre disponibile)
-- e «mi chiamano solo persone a cui do il permesso» (D32 A).
alter table public.profili
  add column fascia_da text check (fascia_da ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column fascia_a text check (fascia_a ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  add column solo_con_permesso boolean not null default false,
  add constraint fascia_completa check ((fascia_da is null) = (fascia_a is null));

-- Persone a cui ho dato il permesso di chiamarmi (D32 A). Le gestisco solo io.
create table public.permessi_chiamata (
  utente_id uuid not null references auth.users (id) on delete cascade,
  permesso_a uuid not null references auth.users (id) on delete cascade,
  dato_il timestamptz not null default now(),
  primary key (utente_id, permesso_a),
  constraint mai_a_se_stessi check (utente_id <> permesso_a)
);

-- Blocchi (D32 A): immediati e definitivi. Chi blocca li vede, chi è bloccato no. Non si tolgono.
create table public.blocchi (
  chi uuid not null references auth.users (id) on delete cascade,
  bloccato uuid not null references auth.users (id) on delete cascade,
  bloccato_il timestamptz not null default now(),
  primary key (chi, bloccato),
  constraint mai_se_stessi check (chi <> bloccato)
);
create index blocchi_bloccato on public.blocchi (bloccato);

-- ---------------------------------------------------------------------------------------------------------
-- Regole per riga.
alter table public.chiamate enable row level security;
alter table public.carte enable row level security;
alter table public.carte_viste enable row level security;
alter table public.permessi_chiamata enable row level security;
alter table public.blocchi enable row level security;
revoke all on public.chiamate, public.carte, public.carte_viste, public.permessi_chiamata, public.blocchi from anon, authenticated;
grant select on public.chiamate to authenticated;
grant select, insert, delete on public.permessi_chiamata to authenticated;
grant select, insert on public.blocchi to authenticated;
grant select, insert, update, delete on public.chiamate, public.carte, public.carte_viste, public.permessi_chiamata, public.blocchi
  to service_role;

create policy "chiamate: vedi solo quelle in cui ci sei" on public.chiamate for select to authenticated
  using (chi = auth.uid() or con = auth.uid());
create policy "permessi: solo i tuoi" on public.permessi_chiamata for select to authenticated using (utente_id = auth.uid());
create policy "permessi: li dai solo tu" on public.permessi_chiamata for insert to authenticated with check (utente_id = auth.uid());
create policy "permessi: li togli solo tu" on public.permessi_chiamata for delete to authenticated using (utente_id = auth.uid());
create policy "blocchi: vedi solo chi hai bloccato" on public.blocchi for select to authenticated using (chi = auth.uid());
create policy "blocchi: blocchi solo per te" on public.blocchi for insert to authenticated with check (chi = auth.uid());
