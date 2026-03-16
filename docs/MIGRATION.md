# Cost Katana Backend – NestJS Migration Guide

This app is a **separate NestJS application** created to migrate from the Express-based `costkatana-backend` incrementally. The two codebases are isolated; you can run the Nest app alongside the legacy backend during migration.

## Current state

### ✅ Migrated (static foundation)

- **Config**
  - Env validation (required: `MONGODB_URI`, `JWT_SECRET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`)
  - App config: port, CORS, JWT, rate limit, logging, encryption, Redis (mirrors legacy `config/index.ts`)
- **Types**
  - `src/types`: `aiCostTracker.types`, `models`, `failover.types` (copied and adjusted for strict typing)
- **Common**
  - `LoggerService`: Winston-based, OpenTelemetry trace context, file + console transports
  - `EncryptionService`: AES-256-GCM encrypt/decrypt (injectable)
- **Infrastructure**
  - MongoDB via `MongooseModule.forRootAsync` (same connection options as legacy)
  - Health: `GET /health` → `{ status: "Cost Katana Backend API" }`
  - Version: `GET /version` → `{ version: "2.0.0" }`

### 🔲 To migrate (feature-by-feature)

Use the legacy routes list as a checklist. Suggested order:

1. **Auth** – `auth.routes`, `oauth.routes` (JWT, sessions, OAuth)
2. **User** – `user.routes`, `user.controller`, user service + models
3. **Usage** – `usage.routes`, usage service, Usage model
4. **Projects** – `project.routes`, project service + models
5. **Pricing** – `pricing.routes`, pricing utils (openai, anthropic, google, aws-bedrock)
6. **Optimization** – `optimization.routes`, optimization service
7. **Analytics** – `analytics.routes`
8. **Gateway** – `gateway.routes`, gateway middleware/services
9. **Chat** – `chat.routes`, chat service
10. Then: agent, experimentation, telemetry, billing, admin, integrations, etc.

For each feature:

1. **Create a Nest module** (e.g. `UsageModule`).
2. **Copy or adapt**:
   - Models (Mongoose schemas) → `*.schema.ts` in the module or a `schemas/` folder.
   - Services → inject `LoggerService`, `ConfigService`, `EncryptionService`, and other Nest services; use repository pattern if needed.
   - Controllers → map routes to service methods; use DTOs + `class-validator`/pipes where applicable.
3. **Register** the module in `AppModule` and mount routes under the same path as legacy (e.g. `/usage`) so clients can switch by base URL.
4. **Add types** to `src/types` as needed (or shared package later).
5. **Test** the module in isolation and against the same MongoDB/Redis as legacy if needed.

## Project layout

```
costkatana-backend-nest/
├── src/
│   ├── config/           # Env validation, app config, config module
│   ├── common/           # Logger, Encryption (global)
│   ├── types/            # Shared TS types (from legacy)
│   ├── app.module.ts
│   ├── app.controller.ts # Health + version
│   └── main.ts           # Bootstrap, validateEnv(), CORS, port
├── docs/
│   └── MIGRATION.md      # This file
├── .env.example
└── package.json
```

## Running the Nest app

```bash
cp .env.example .env
# Edit .env with real values (same as legacy backend)

npm run start:dev   # Port from config, default 8000
```

Health: `GET http://localhost:8000/health`  
Version: `GET http://localhost:8000/version`

## Design notes

- **Config**: Single source of truth in `config/app.config.ts`; same shape as legacy for easier copy-paste of feature code.
- **Logger**: Injectable `LoggerService` instead of a global logger; same Winston + OTEL behavior.
- **Encryption**: Injectable `EncryptionService` instead of static class; key from config.
- **Types**: Start with a minimal set; add or copy from legacy when migrating a feature. Prefer `Record<string, unknown>` over `any` where possible.

Once a feature is fully migrated and tested in Nest, you can remove it from the legacy backend and point clients to the Nest app (or run both and route by path/domain).
