-- Requisito 4 del CISO (T15, 29/10) prima di ACCESSO_APP=si: un tetto al numero di file per persona.
-- Ogni persona può avere al massimo 4 voci (presentazione + 3 risposte) e 3 foto, perché nelle sue cartelle
-- si possono scrivere SOLO questi nomi fissi (senza estensione: il tipo del file lo dice il content-type):
--   voci/<id>/presentazione, voci/<id>/risposta-1, voci/<id>/risposta-2, voci/<id>/risposta-3
--   foto/<id>/foto-1, foto/<id>/foto-2, foto/<id>/foto-3
-- Supabase non ammette due file con lo stesso nome nella stessa cartella: rifare una registrazione o cambiare una foto
-- SOSTITUISCE il file (upsert), non ne aggiunge un altro. Così nessuno può riempire lo Storage caricando file a ripetizione.
-- Lettura e cancellazione restano come prima (solo il proprietario, nella sua cartella).
-- Scelta tecnica: elenco di nomi ammessi nelle regole per riga invece di un contatore con trigger, perché le tabelle
-- di storage appartengono a Supabase (niente trigger nostri lì) e un nome fisso non si può aggirare.
create function public.nome_file_ammesso(cartella text, nome text) returns boolean
  language sql stable set search_path = '' as $$
  select case cartella
    when 'voci' then nome ~ ('^' || auth.uid()::text || '/(presentazione|risposta-[1-3])$')
    when 'foto' then nome ~ ('^' || auth.uid()::text || '/foto-[1-3]$')
    else false end
$$;
revoke all on function public.nome_file_ammesso(text, text) from public, anon;
grant execute on function public.nome_file_ammesso(text, text) to authenticated;

drop policy "voci e foto: solo il proprietario carica" on storage.objects;
drop policy "voci e foto: solo il proprietario sostituisce" on storage.objects;

create policy "voci e foto: solo il proprietario carica, con i nomi fissi" on storage.objects for insert to authenticated
  with check (bucket_id in ('voci', 'foto') and auth.uid() is not null and public.nome_file_ammesso(bucket_id, name));
create policy "voci e foto: solo il proprietario sostituisce, con i nomi fissi" on storage.objects for update to authenticated
  using (bucket_id in ('voci', 'foto') and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id in ('voci', 'foto') and auth.uid() is not null and public.nome_file_ammesso(bucket_id, name));
