# Contributing to limitly

Thank you for your interest in contributing to limitly. This guide covers how to set up a local environment, run tests, and submit changes.

## Getting started

### Prerequisites

- Node.js 18 or later
- npm
- Redis 7 (required for the test suite)

### Setup

```bash
git clone https://github.com/adasarpan404/limitly.git
cd limitly
npm ci
```

### Build

```bash
npm run build
```

This compiles TypeScript to `dist/` and copies Lua scripts into `dist/scripts/`.

### Run tests

Start Redis locally, then:

```bash
npm test
```

CI uses `REDIS_HOST=localhost` and `REDIS_PORT=6379`. Set those if your Redis instance is elsewhere.

For watch mode during development:

```bash
npm run test:watch
```

## How to contribute

### Reporting bugs

Open an issue at [github.com/adasarpan404/limitly/issues](https://github.com/adasarpan404/limitly/issues) and include:

- What you expected to happen
- What actually happened
- Steps to reproduce
- Your Node.js version and limitly version
- Relevant framework or store backend (Express, Fastify, Redis, Memcached, etc.)

### Suggesting features

Feature requests are welcome. Open an issue describing the use case and why existing options do not cover it.

### Pull requests

1. Fork the repository and create a branch from `master`.
2. Make your changes.
3. Add or update tests for behavior you change.
4. Run `npm run build` and `npm test` — both must pass.
5. Open a pull request against `master` with a clear description of the change.

Keep pull requests focused. Smaller, well-scoped changes are easier to review and merge.

## Development guidelines

- Match the existing code style: TypeScript, minimal dependencies, and framework-agnostic core logic.
- New algorithms or store backends should include tests under `test/`.
- Middleware changes should cover the frameworks affected (Express, Fastify, Hono, Koa, Bun, NestJS).
- Avoid breaking changes to the public API unless discussed in an issue first.
- Lua scripts live in `src/scripts/` and are copied to `dist/scripts/` during build — update both paths are handled by the build script when you edit scripts in `src/scripts/`.

## Project structure

```
src/
  limiter.ts          # Core limiter factory
  middleware/         # Framework integrations
  observability/      # OpenTelemetry helpers
  scripts/            # Redis Lua scripts
  types/              # Shared TypeScript types
test/                 # Vitest test suite
examples/             # Framework usage examples
```

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).