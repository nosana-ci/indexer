#!/usr/bin/env bash

function print() {
    echo ""
    echo $1
    echo ""
}

print "(Re)starting..."
if docker compose -f docker/docker-compose.yml down && docker compose -f docker/docker-compose.yml up -d db; then
    print "Installing dependencies..."
    docker compose -f docker/docker-compose.yml run --rm blockchain-indexer bun install
    print "Starting all containers..."
    docker compose -f docker/docker-compose.yml up -d
    print "Done!"
    docker compose -f docker/docker-compose.yml logs -f blockchain-indexer
fi
