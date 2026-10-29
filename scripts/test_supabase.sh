#!/usr/bin/env bash
# Prova le migrazioni di supabase/migrations e le regole per riga su un Postgres temporaneo (nessun dato reale,
# nessun collegamento al progetto vero). Uso: bash scripts/test_supabase.sh
set -euo pipefail
# Postgres non parte come root: in quel caso lo script si rilancia come utente «postgres».
if [ "$(id -u)" = "0" ]; then exec runuser -u postgres -- bash "$(readlink -f "$0")" "$@"; fi
radice="$(cd "$(dirname "$0")/.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
if [ -z "$bin" ]; then echo "Postgres non trovato"; exit 1; fi
cartella="$(mktemp -d)"
trap '"$bin/pg_ctl" -D "$cartella/dati" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$cartella"' EXIT
"$bin/initdb" -D "$cartella/dati" -U postgres -A trust --locale=C.UTF-8 -E UTF8 >/dev/null
"$bin/pg_ctl" -D "$cartella/dati" -o "-k $cartella -c listen_addresses=''" -l "$cartella/log" -w start >/dev/null
psql=("$bin/psql" -h "$cartella" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${psql[@]}" -f "$radice/supabase/test/supabase_finto.sql"
for migrazione in "$radice"/supabase/migrations/*.sql; do
  echo "Migrazione: $(basename "$migrazione")"
  "${psql[@]}" -1 -f "$migrazione"
done
"${psql[@]}" -f "$radice/supabase/test/regole_per_riga.sql" 2>&1 >/dev/null | sed 's/^psql:[^ ]* NOTICE:  //'
echo "Regole per riga: tutti i controlli superati."
