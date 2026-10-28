# Tutor Agency — first release

A responsive tutoring marketplace with student/tutor registration, password authentication, searchable tutor profiles, hourly rates, availability, and lesson booking/cancellation.

## Run

Requires Node.js 24 or newer. No third-party packages or external credentials are required.

```sh
cd /workspace/tutor-agency
npm start
```

Open port 3000 in a normal local development environment. `PORT` overrides the port; `DB_PATH` overrides the SQLite file location (default `data/tutors.sqlite`). `npm run dev` enables server reload. Run `npm test` for the end-to-end account and booking workflow against an isolated temporary database.

## First use

Create a tutor account, open My lessons, update your subject, biography, and USD hourly rate, and add a future one-hour availability slot. Sign out and create a student account. Find the tutor, view availability, and book the slot. Both accounts can see and cancel the lesson in My lessons. Times are stored in UTC and displayed in the viewer's time zone. The database starts empty; there are no preset passwords or fake profiles.

## Data and security

SQLite enforces unique emails and single bookings per slot. Passwords use salted scrypt hashes; opaque, expiring session tokens live in HttpOnly SameSite cookies. Profile and availability changes require a tutor account; bookings require a student account. Queries use bound parameters; browser output escapes user content. Authentication attempts are limited in memory per connecting IP. Back up the database with SQLite's backup API or while the server is stopped; account for WAL files when making live backups.

## Scope and production work

This is a local first-release foundation, not a production Preply replacement. It does not yet implement email verification, password reset, Google sign-in, administration/tutor approval, payments, messaging, video, calendar sync, recurring availability, or notifications. Booking does not charge money. Rate displays reflect the tutor's current profile rather than an immutable price quote. User names render as initials; photo uploads are not implemented.

Before public deployment, configure HTTPS and secure cookies (`NODE_ENV=production`), a trusted reverse proxy with explicit origin handling, persistent storage and backups, durable abuse prevention, email verification/recovery, and monitoring. The current origin check assumes the server's direct scheme and Host; configure this explicitly when deploying behind TLS termination. Use a single application process for this SQLite release; migrate to PostgreSQL and transactional scheduling before scaling across workers. Database users can inspect their own bookings, and only the student or assigned tutor can cancel. Tutor slots cannot yet be removed through the UI.

## Project layout

- `server.js`: HTTP application, database schema, authentication, authorization, booking API.
- `public/`: responsive web interface with no build step.
- `test/workflow.test.js`: real HTTP and database integration test.

This task already has an isolated checkout. Use it directly; do not create a Git worktree unless explicitly requested.
