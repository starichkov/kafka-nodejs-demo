# Contributor and Agent Checks

This repository is a small Kafka producer/consumer demo. Changes are not complete until the application tests pass and the complete Docker Compose flow has been smoke-tested.

## Mandatory checks for functionality changes

Run these checks locally before considering a change complete:

```bash
npm test
npm run test:coverage
npm run test:docker
git diff --check
```

The Docker check builds both application images and exercises the complete Compose setup: Kafka readiness, topic creation, producer delivery, and consumer receipt. A passing unit suite alone does not catch image, networking, startup-order, or broker compatibility problems.

## Test expectations

- Add or update unit tests for changed producer, consumer, utility, and logger behavior.
- Add or update integration tests when Kafka connectivity, topic handling, message delivery, or shutdown behavior changes.
- Keep tests deterministic and cover validation and error paths for new behavior.
- Run the full suite after focused tests. Do not hide failures with skipped tests, weakened assertions, or test-pattern exclusions.

## Docker and configuration rules

- Keep the producer, consumer, Compose services, topic name, and environment defaults synchronized.
- Run `npm run test:docker` after changes affecting source files, Dockerfiles, or `docker-compose.yml`.
- The Docker smoke test requires Docker and Docker Compose and cleans up its project and volumes automatically.
- Preserve compatibility with Node.js 22, 24, and 26 and Kafka 3.9.2 and 4.3.2 as documented in `README.md` and `.github/workflows/node.js.yml`.

## CI failure prevention

Before pushing, confirm that local checks match `.github/workflows/node.js.yml`: dependencies must install with `npm ci`, the project must pass Jest tests across the supported Node versions, and coverage must pass on Node 26. If a CI failure reveals a reusable requirement, update this file and the relevant project documentation.