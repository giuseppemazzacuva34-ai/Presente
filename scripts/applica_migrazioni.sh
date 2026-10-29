#!/usr/bin/env bash
# Applica al progetto Supabase vero le migrazioni di supabase/migrations non ancora applicate.
# Gira solo nel workflow «Database» (mai nelle pull request). Ogni migrazione va in una transazione insieme alla
# riga che la registra: o entra tutta o non entra niente. Non stampa mai segreti.
# Uso: bash scripts/applica_migrazioni.sh prova|applica
set -euo pipefail
set +x
modo="${1:-prova}"
radice="$(cd "$(dirname "$0")/.." && pwd)"
[ "$modo" = prova ] || [ "$modo" = applica ] || { echo "::error::Modo sconosciuto: usa prova o applica."; exit 1; }
connessione="${CONNESSIONE_PROVA:-}"   # solo per provare lo script su un Postgres locale
if [ -z "$connessione" ]; then
: "${SUPABASE_PROJECT_REF:?manca SUPABASE_PROJECT_REF}" "${SUPABASE_DB_PASSWORD:?manca SUPABASE_DB_PASSWORD}"
export PGPASSWORD="$SUPABASE_DB_PASSWORD" PGCONNECT_TIMEOUT=15
REF="${SUPABASE_PROJECT_REF// /}"
for host in aws-0-eu-central-1.pooler.supabase.com aws-1-eu-central-1.pooler.supabase.com; do
  c="host=$host port=5432 dbname=postgres user=postgres.$REF sslmode=require"
  if psql "$c" -tAc 'select 1' >/dev/null 2>&1; then connessione="$c"; break; fi
done
fi
[ -n "$connessione" ] || { echo "::error::Database non raggiungibile (password o progetto)."; exit 1; }
psql_db=(psql "$connessione" -v ON_ERROR_STOP=1 -X -q)

# Stesso registro usato dalla CLI di Supabase, così in futuro si può passare alla CLI senza riapplicare nulla.
"${psql_db[@]}" -c "create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);"

applicate="$("${psql_db[@]}" -tAc 'select version from supabase_migrations.schema_migrations')"
da_fare=0
echo "| Migrazione | Esito |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
echo "|---|---|" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
for file in "$radice"/supabase/migrations/*.sql; do
  base="$(basename "$file" .sql)"
  versione="${base%%_*}"
  nome="${base#*_}"
  [[ "$versione" =~ ^[0-9]{14}$ ]] || { echo "::error::Nome non valido: $base"; exit 1; }
  if grep -qx "$versione" <<<"$applicate"; then
    echo "già applicata: $base"; echo "| \`$base\` | già applicata |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; continue
  fi
  da_fare=$((da_fare + 1))
  if [ "$modo" != "applica" ]; then
    echo "DA APPLICARE: $base"; echo "| \`$base\` | da applicare (prova: non toccata) |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; continue
  fi
  { cat "$file"; printf '\ninsert into supabase_migrations.schema_migrations (version, name) values (%s, %s);\n' "'$versione'" "'$nome'"; } \
    | "${psql_db[@]}" -1 -f -
  echo "applicata: $base"; echo "| \`$base\` | ✅ applicata |" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
done
echo "Migrazioni nuove: $da_fare (modo: $modo)."
