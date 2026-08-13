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
USER liquibase

ENTRYPOINT ["/liquibase/entrypoint.sh"]
CMD ["update"]
