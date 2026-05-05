# Source: https://bun.com/docs/guides/ecosystem/docker
# use the official Bun image
# see all versions at https://hub.docker.com/r/oven/bun/tags
FROM oven/bun:1.3.8-alpine AS base
WORKDIR /usr/src/app

## install dependencies into temp directory
## this will cache them and speed up future builds
FROM base AS install

# Download RDS CA cert
RUN wget -O ./global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    && mkdir -p /etc/ssl/certs/ \
    && mv ./global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

# install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json bun.lock /temp/prod/
RUN cd /temp/prod && bun install --frozen-lockfile --production --ignore-scripts

# copy production dependencies and source code into final image
FROM base AS release
COPY --from=install /etc/ssl/certs/rds-global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem
COPY --from=install /temp/prod/node_modules node_modules
COPY src ./src
COPY drizzle ./drizzle

ENV SOLANA_NETWORK=mainnet

# run the app
USER bun
EXPOSE 3000/tcp
ENTRYPOINT [ "bun", "run", "src/index.ts" ]
