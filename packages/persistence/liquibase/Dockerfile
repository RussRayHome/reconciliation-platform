# See compose.yaml's LIQUIBASE_IMAGE comment: 4.33.0+ rejects includeAll-loaded formatted-SQL
# changesets without a Pro license key. 4.31 runs this changelog fully OSS and matches
# packages/persistence/tests/testHelpers/liquibase.ts's own pin.
ARG LIQUIBASE_IMAGE=liquibase/liquibase:4.31

FROM ${LIQUIBASE_IMAGE}

WORKDIR /liquibase/changelog

COPY changelog-master.yaml ./changelog-master.yaml
COPY changesets ./changesets
COPY entrypoint.sh /liquibase/entrypoint.sh

USER root
RUN chmod +x /liquibase/entrypoint.sh
# Drop the SQL Server JDBC driver Liquibase bundles. This project only ever runs migrations against
# Postgres -- README and docs/architecture.md both state PostgreSQL-only with no MSSQL scaffold -- so
# the driver is dead weight that only contributes CVEs. Removing it eliminates CVE-2025-59250 at the
# source instead of suppressing it in .trivyignore, which is what that entry's own comment said the
# real fix was. postgresql.jar, the driver actually used, is untouched.
RUN rm -f /liquibase/internal/lib/mssql-jdbc.jar
USER liquibase

ENTRYPOINT ["/liquibase/entrypoint.sh"]
CMD ["update"]
