#!/usr/bin/env bash
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 <<'SQL'
\getenv app_password DB_PASSWORD
CREATE ROLE catalogo LOGIN PASSWORD :'app_password';
ALTER DATABASE catalogo OWNER TO catalogo;
SQL
