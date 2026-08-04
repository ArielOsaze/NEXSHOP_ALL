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
- There are no automated tests in this repo.

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
