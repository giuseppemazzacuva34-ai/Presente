-- Fase 2 · issue #10 parte B v1.1 (CPO, 20/11); D122 B · passo 4 della linea «sviluppatore-c»: casi «Da gestire da Giuseppe».
-- Ricorsi, sanzioni e rimborsi di crediti, richieste sui dati personali (copia, cancellazione, correzione), stampa,
-- avvocati, aziende e proposte commerciali: l'agente può preparare SOLO la bozza «Da gestire da Giuseppe…» con fonte
-- «nessuna». Il controllo lo fa il database prima di ogni bozza, così vale anche se l'agente sbaglia o se il testo
-- del messaggio contiene istruzioni. La vista dell'agente resta con gli stessi 6 campi (spec v1: niente campi in più).
-- Scelta tecnica: le parole si leggono dal testo originale, lato server, mai mandate fuori; meglio un messaggio in
-- più a Giuseppe che una risposta automatica su un ricorso o sui dati. Solo aggiunte e una funzione sostituita con la
-- stessa firma. «Come cancello l'account» resta una FAQ normale (n. 12).

create function public.parole_da_gestire(p_testo text) returns boolean
  language sql immutable set search_path = '' as $$
  select lower(coalesce(p_testo, '')) ~ ('(\mricors|\mcontestar|\mcontestazion|\msanzion|\msospension|\mrimbors|\mridatemi|\mrestituit'
    || '|\mdati personali|\mmiei dati|\mgdpr\M|\mgarante|\moblio\M'
    || '|\mgiornalist|\mredazione|\mintervist|\mavvocat|\mlegale\M|\mazienda|\mcommercial|\mpartnership|\msponsorizz|\mcollaborazione)')
$$;
revoke all on function public.parole_da_gestire(text) from public, anon, authenticated;
grant execute on function public.parole_da_gestire(text) to service_role;

create or replace function public.controlla_bozza_supporto() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  s public.supporto;
begin
  select * into s from public.supporto where id = new.messaggio_id;
  if not found or s.risposta is not null or s.sicurezza or s.minore then
    raise exception 'bozza_non_ammessa' using errcode = 'check_violation';
  end if;
  if public.parole_da_gestire(s.testo)
     and (new.testo !~ '^Da gestire da Giuseppe' or new.fonte <> 'nessuna') then
    raise exception 'solo_da_gestire' using errcode = 'check_violation';
  end if;
  return new;
end $$;
