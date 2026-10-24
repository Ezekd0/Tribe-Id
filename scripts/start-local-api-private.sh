#!/usr/bin/env bash
# Run in your own terminal. Password stays off argv and is never echoed.
set +x
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
trap 'unset TRUEDA_DB_PASSWORD PGPASSWORD DATABASE_URL' EXIT
IFS= read -r -s -p 'Trueda database password: ' TRUEDA_DB_PASSWORD
printf '\n'
export PGPASSWORD="$TRUEDA_DB_PASSWORD"
psql -X -w -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5432 -U trueda_tribe_id_app -d trueda_tribe_id -c 'SELECT current_database(), current_user;'
DATABASE_URL=$(node -e 'const u=new URL("postgresql://trueda_tribe_id_app@127.0.0.1:5432/trueda_tribe_id");u.password=process.env.PGPASSWORD;process.stdout.write(u.href)')
export DATABASE_URL
unset PGPASSWORD TRUEDA_DB_PASSWORD
export NODE_ENV=development HOST=127.0.0.1 ENABLE_MEMBER_PREVIEW=false
node --import tsx scripts/start-local-api-verified.ts
