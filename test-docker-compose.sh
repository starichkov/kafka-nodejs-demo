#!/usr/bin/env bash

# Build and smoke-test the complete Docker Compose demo.
# This validates Kafka readiness, topic creation, producer delivery, and consumer output.

set -Eeuo pipefail

readonly COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-kafka-nodejs-demo-test}"
readonly MESSAGE="docker-compose smoke test"
readonly MAX_ATTEMPTS=60
export MESSAGE

info() {
    printf '\033[0;34m[INFO]\033[0m %s\n' "$1"
}

success() {
    printf '\033[0;32m[SUCCESS]\033[0m %s\n' "$1"
}

error() {
    printf '\033[0;31m[ERROR]\033[0m %s\n' "$1" >&2
}

compose() {
    docker compose -p "$COMPOSE_PROJECT_NAME" "$@"
}

cleanup() {
    compose down -v --remove-orphans >/dev/null 2>&1 || true
}

on_error() {
    error "Docker Compose smoke test failed. Container logs:"
    compose logs --no-color || true
}

trap on_error ERR
trap cleanup EXIT

wait_for_kafka() {
    info "Waiting for Kafka to accept requests..."
    for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
        if compose exec -T kafka /opt/kafka/bin/kafka-topics.sh \
            --bootstrap-server localhost:9092 --list >/dev/null 2>&1; then
            success "Kafka is ready"
            return 0
        fi
        sleep 2
    done

    error "Kafka did not become ready within $((MAX_ATTEMPTS * 2)) seconds"
    return 1
}

wait_for_message() {
    info "Waiting for the consumer to receive the smoke-test message..."
    for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
        if consumer_logs=$(compose logs --no-color consumer 2>/dev/null) && \
            [[ "$consumer_logs" == *"value=$MESSAGE"* ]]; then
            success "Producer-to-consumer message flow passed"
            return 0
        fi
        sleep 2
    done

    error "Consumer did not receive the expected message within $((MAX_ATTEMPTS * 2)) seconds"
    return 1
}

info "Building and starting the Docker Compose stack..."
compose up --build -d
wait_for_kafka
wait_for_message
compose ps
success "Docker Compose smoke test completed successfully"