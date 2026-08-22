# AGENTS

## Purpose
This repository is a small fullstack project with:
- `nexshop-backend/`: Express backend using Supabase and JWT auth.
- `nexshop-frontend/`: static HTML/JS frontend demo for the store and admin pages.
- `nginx-nexshop.conf`: reverse-proxy config that the backend expects when deployed.

## How to run
- Change to `nexshop-backend/`.
- Install dependencies with `npm install`.
- Start the backend with `npm start`.
- There are no automated tests in this repo, but `regtest/` at the project
  root has standalone logic-verification scripts (`node regtest/simN_*.js`)
  covering payment-popup polling, rating eligibility badges, SSR/sitemap
  fixes, etc. Most need no dependencies or DB access. The exception is
  `regtest/test_ssr.js`, which is a real integration test that connects to
  the live Supabase DB and inserts/deletes a throwaway article row — only
  run it against a non-production database.

## Database migrations
- `nexshop-backend/migrations/*.sql` are NOT run automatically — there is no
  migration runner in this project. Apply each file manually in the
  Supabase SQL Editor before the feature that depends on it will work.
- `002_create_topup_ratings.sql` must be run before the topup-rating
  endpoints (`/api/ratings/topup/*`) will work; until then they fail with a
  friendly "belum di-setup" message rather than a raw 500, but they don't
  work.
- `008_create_reseller.sql` must be run before the reseller program
  (`/api/reseller/*`, the `/reseller` page, and the Reseller panel in the
  admin dashboard) will work. Same pattern as the ratings migration: until
  it is applied, those endpoints answer 503 with
  `code: "RESELLER_NOT_SETUP"` and the UI shows a setup notice instead of
  crashing. Reseller pricing is derived at request time from
  `reseller_tiers.discount_percent` (see `utils/resellerPricing.js`); it is
  never stored per product, and it is floored so a reseller price can never
  drop below cost + 1% margin.


## Important conventions
- Backend uses CommonJS modules and `type: commonjs` in `nexshop-backend/package.json`.
- Routes are organized under `nexshop-backend/routes/` and controllers under `nexshop-backend/controllers/`.
- `nexshop-backend/server.js` sets `app.set("trust proxy", 1)` because the app is designed to run behind Nginx.
- Missing or unparsed request bodies are normalized in `server.js` with `req.body = {}` so controllers can safely destructure.
- Protected endpoints use `nexshop-backend/middleware/authMiddleware.js` and require `Authorization: Bearer <token>`.
- The backend relies on environment variables, especially `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `JWT_SECRET` in production.

## Bug-audit focus areas
- `nexshop-backend/server.js`: request parsing, proxy/trust proxy behavior, rate limiter skip logic, error handler consistency.
- `nexshop-backend/controllers/`: validation of body fields, Supabase query error handling, and authentication flow.
- `nexshop-backend/config/db.js`: Supabase client setup on missing environment variables.
- `nexshop-backend/middleware/authMiddleware.js`: JWT verification and bearer token parsing.
- `nexshop-backend/middleware/rateLimiter.js`: rate-limit enforcement around auth and webhook endpoints.
- `nexshop-frontend/script.js`: demo-only frontend state management using `localStorage`, `API_BASE`, and current offline login/checkout assumptions.

## Notes for agents
- Preserve Indonesian comments and user-facing messages where possible.
- Do not assume the frontend is a full production integration; it contains simulated login and checkout behavior.
- If fixing bugs, confirm the backend routes and frontend API base remain consistent with the existing route paths.
- Prefer small, targeted changes when resolving issues, because there is no test suite.

## Useful files
- `nexshop-backend/server.js`
- `nexshop-backend/routes/authRoutes.js`
- `nexshop-backend/controllers/authController.js`
- `nexshop-backend/middleware/authMiddleware.js`
- `nexshop-backend/config/db.js`
- `nexshop-backend/middleware/rateLimiter.js`
- `nexshop-frontend/script.js`
- `nginx-nexshop.conf`
