-- Fase 2 · issue #10 parte B v1 (CPO, 13/11; D122 B) · passo 1 della linea «sviluppatore-c»: mascheramento dei contatti.
-- Prima che l'agente legga un messaggio «Scrivici», il server sostituisce con «[contatto nascosto]»: email, link
-- (con o senza http/www), nomi di social con @ e numeri di 6 o più cifre (anche con spazi o trattini, es. telefoni).
-- Numeri fino a 5 cifre restano (crediti, chiavi, orari). Scelta tecnica: una data scritta con punti o trattini
-- (18-11-2026) può essere nascosta anche lei; meglio nascondere un dato in più che lasciare passare un telefono.
-- Funzione pura (nessuna tabella letta), solo per il server. Qui nessun agente legge ancora nulla.

create function public.maschera_contatti(p_testo text) returns text
  language sql immutable set search_path = '' as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(p_testo,
    -- 1. email
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[contatto nascosto]', 'g'),
    -- 2. link: http(s)://…, www.…, o dominio con estensione comune (esempio.it, t.me/nome)
    '(https?://[^[:space:]]+|www\.[^[:space:]]+|\m[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.(it|com|net|org|eu|me|ly|io|app|info|biz|co|tv|gg|link)\M(/[^[:space:]]*)?)',
    '[contatto nascosto]', 'gi'),
    -- 3. nomi di social con @ (2+ caratteri, senza punto finale)
    '@[A-Za-z0-9_]([A-Za-z0-9_.]*[A-Za-z0-9_])?', '[contatto nascosto]', 'g'),
    -- 4. numeri di 6+ cifre, anche con prefisso + e separati da spazi o trattini
    '\+?[0-9]([ -]?[0-9]){5,}', '[contatto nascosto]', 'g')
$$;
revoke all on function public.maschera_contatti(text) from public, anon, authenticated;
grant execute on function public.maschera_contatti(text) to service_role;
