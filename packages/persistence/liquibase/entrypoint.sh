#!/usr/bin/env bash
# Translates the app's DATABASE_URL (postgresql://user:pass@host:port/db) into the
# LIQUIBASE_COMMAND_* env vars the CLI expects, then runs liquibase with whatever
# command was passed in (default: "update", see Dockerfile CMD).
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required (postgresql://user:password@host:port/dbname)}"

url_no_scheme="${DATABASE_URL#*://}"
userinfo="${url_no_scheme%%@*}"
hostpart="${url_no_scheme#*@}"

db_username="${userinfo%%:*}"
db_password="${userinfo#*:}"

hostport="${hostpart%%/*}"
db_host="${hostport%%:*}"
db_port="${hostport#*:}"
if [ "$db_port" = "$db_host" ]; then
  db_port=5432
fi

dbname_and_query="${hostpart#*/}"
db_name="${dbname_and_query%%\?*}"

export LIQUIBASE_COMMAND_URL="jdbc:postgresql://${db_host}:${db_port}/${db_name}"
export LIQUIBASE_COMMAND_USERNAME="${db_username}"
export LIQUIBASE_COMMAND_PASSWORD="${db_password}"
export LIQUIBASE_COMMAND_CHANGELOG_FILE="changelog-master.yaml"

exec liquibase "$@"
