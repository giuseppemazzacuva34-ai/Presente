-- Fase 2 · issue #7 (D139 A) + #10 parte B v1.1 (CPO, 20/11) · linea «sviluppatore-b», su richiesta di «sviluppatore-c».
-- Un messaggio «Scrivici» con bandiera «sicurezza» (parole di pericolo) o «possibile minore» avvisa il responsabile
-- della sicurezza come le segnalazioni con priorità 1 ora: una riga in avvisi_sicurezza, che il Worker spedisce
-- entro un minuto per email (worker/avvisi_sicurezza.js). L'avviso porta solo il riferimento al messaggio e il tipo
-- «supporto»: nell'email solo quanti sono, mai il testo, l'email o il nome di chi scrive.
-- Scelta tecnica: un solo avviso per messaggio (niente ripetizioni ogni 30 minuti come per le segnalazioni, perché il
-- messaggio non ha un «aperto il»; è già in cima alla coda di chi risponde). Con l'account si cancella anche l'avviso.
-- Solo aggiunte: una colonna vuota, i due controlli allargati (nessuna riga esistente cambia), un trigger nuovo.

alter table public.avvisi_sicurezza
  add column supporto_id uuid references public.supporto (id) on delete cascade;
create index avvisi_supporto on public.avvisi_sicurezza (supporto_id) where supporto_id is not null;

alter table public.avvisi_sicurezza drop constraint riferimento;
alter table public.avvisi_sicurezza add constraint riferimento
  check (num_nonnulls(segnalazione_id, sospensione_id, supporto_id) = 1);

alter table public.avvisi_sicurezza drop constraint avvisi_sicurezza_perche_check;
alter table public.avvisi_sicurezza add constraint avvisi_sicurezza_perche_check
  check (perche in ('nuova', 'non_aperta', 'revisione_scaduta', 'supporto'));

create function public.dopo_supporto() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  if new.sicurezza or new.minore then
    insert into public.avvisi_sicurezza (supporto_id, perche) values (new.id, 'supporto');
  end if;
  return null;
end $$;
revoke all on function public.dopo_supporto() from public, anon, authenticated;
create trigger dopo_supporto after insert on public.supporto
  for each row execute function public.dopo_supporto();
