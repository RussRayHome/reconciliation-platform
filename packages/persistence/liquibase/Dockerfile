ARG LIQUIBASE_IMAGE=liquibase/liquibase:4.33.0

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
