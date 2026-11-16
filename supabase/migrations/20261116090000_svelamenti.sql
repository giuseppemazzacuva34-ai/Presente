-- Fase 2 · issue #65 spec v1 (CPO; D48 A, D12 A, D18 A, D32 A) · passo 2 della linea «sviluppatore»: lo svelamento
-- nel database, sopra le porte (#5). Una riga per porta: caparre, scelta video/foto, fasce, svelamento, risposte, esito.
-- Le regole (chi può bloccare, quando si avvia, prima fascia comune, esito) restano in api/svelamento.js; qui lo schema
-- garantisce le stesse regole anche a chi scrivesse direttamente nel database.
-- Cosa si salva (spec, «Regole»): porta, orari di caparra/svelamento/risposte, tipo di svelamento, durata, come è
-- finito, esito. Le singole risposte sì/no si cancellano alla chiusura dell'esito: lo impone il vincolo «esito_senza_risposte».
-- Nessuna registrazione di audio o video, nessuna immagine: qui non c'è nessuna colonna per contenerle.
-- La caparra qui è solo l'orario in cui è stata bloccata: il saldo dei crediti (contatore interno in beta, D18 A)
-- arriva in un passo successivo. Le legge e le scrive SOLO il server (ruolo di servizio), mai il telefono.
-- Valori uguali a api/svelamento.js (maxFasce, durata, tentativi): test/svelamenti_database.test.mjs li confronta.

create table public.svelamenti (
  porta_id uuid primary key references public.porte (id) on delete cascade,
  -- Caparre: quando a e quando b hanno bloccato i 10 crediti (null = non ancora).
  caparra_a_il timestamptz,
  caparra_b_il timestamptz,
  -- «Videochiamata di 10 secondi» (predefinita) o «Preferisco le foto»; si cambia solo fino all'inizio.
  scelta_a text not null default 'video' check (scelta_a in ('video', 'foto')),
  scelta_b text not null default 'video' check (scelta_b in ('video', 'foto')),
  -- «Scegli un orario»: inizi di fascia da 30 minuti, fino a 3 a testa; la prima comune è fascia_fissata.
  fasce_a timestamptz[] not null default '{}' check (cardinality(fasce_a) <= 3),
  fasce_b timestamptz[] not null default '{}' check (cardinality(fasce_b) <= 3),
  fascia_fissata timestamptz,
  -- Svelamento: quando è iniziato l'ultimo tentativo, quanti tentativi, con cosa, quanto è durato, quando è finito.
  iniziato_il timestamptz,
  tentativi smallint not null default 0 check (tentativi between 0 and 3),
  tipo text check (tipo in ('video', 'foto')),
  durata_secondi smallint check (durata_secondi between 0 and 10),
  finito_il timestamptz,
  -- Sì/no segreto: le risposte vivono solo finché l'esito non è deciso; gli orari restano.
  risposta_a text check (risposta_a in ('si', 'no')),
  risposta_b text check (risposta_b in ('si', 'no')),
  risposta_a_il timestamptz,
  risposta_b_il timestamptz,
  -- Come è finita la porta. «chiusa» vale sia per un no sia per il silenzio: non si distinguono (spec).
  esito text check (esito in ('doppio_si', 'chiusa', 'scaduta', 'chiudi_e_segnala', 'blocco', 'sospensione')),
  esito_il timestamptz,
  -- Senza caparra di entrambi lo svelamento non si avvia, nemmeno scrivendo nel database (criterio di accettazione).
  constraint avvio_con_due_caparre check (iniziato_il is null
    or (caparra_a_il is not null and caparra_b_il is not null and tipo is not null and tentativi >= 1)),
  constraint risposte_dopo_la_fine check ((risposta_a is null and risposta_b is null) or finito_il is not null),
  constraint doppio_si_dopo_la_fine check (esito is distinct from 'doppio_si' or finito_il is not null),
  constraint esito_con_orario check ((esito is null) = (esito_il is null)),
  -- Dopo l'esito nel database non restano le singole risposte sì/no (criterio di accettazione).
  constraint esito_senza_risposte check (esito is null or (risposta_a is null and risposta_b is null))
);

-- La scelta video/foto non cambia più dopo l'inizio dello svelamento (spec, passo 3).
create function public.svelamenti_scelta_ferma() returns trigger
  language plpgsql set search_path = '' as $$
begin
  if old.iniziato_il is not null and (new.scelta_a <> old.scelta_a or new.scelta_b <> old.scelta_b) then
    raise exception 'scelta video/foto non modificabile dopo l''inizio dello svelamento';
  end if;
  return new;
end $$;
revoke all on function public.svelamenti_scelta_ferma() from public, anon, authenticated;
create trigger svelamenti_scelta_ferma before update on public.svelamenti
  for each row execute function public.svelamenti_scelta_ferma();

alter table public.svelamenti enable row level security;
revoke all on public.svelamenti from public, anon, authenticated;
grant select, insert, update, delete on public.svelamenti to service_role;
-- Nessuna regola per authenticated: il telefono non legge e non scrive nulla qui.
