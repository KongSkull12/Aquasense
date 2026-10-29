# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Farm operators** on phones at the tank or pond: check live water readings, see what needs attention, trigger or review feeding.
- **Farm owners / managers** on desktop: review trends, alerts, SMS history, feeding schedules, and farm settings.
- Roles in the system: admin, farmer, guest (read-only).

## Product Purpose

AquaSense is an IoT water-quality monitoring and automated feeding system for freshwater crayfish (Cherax quadricarinatus, redclaw) culture. ESP32 sensors report temperature, pH, ORP, turbidity, and tank level; the backend stores readings, raises alerts, sends SMS, and drives an ESP32 feeder. Success means an operator can tell at a glance whether the tank is safe, which readings can be trusted, and what to do next.

## Positioning

It is honest about its data: every reading carries a sensor-health state (calibrated, calibration required, stale, unavailable), and the system refuses to classify or estimate what it cannot support (e.g. NH3 fraction needs calibrated pH + temperature; TAN needs a measured value; no validated species risk model is commissioned).

## Operating Context

- Live updates via Socket.IO, refreshed about every 5 seconds; "Online" means the browser connection, not the sensors.
- Manual TAN measurements are entered by hand from test kits.
- Aerator and water-change pages send authenticated commands to the device API (`/hardware/commands`). Output state is the device's logical report, not physical feedback, and pump control stays fail-closed until timing and relay settings are commissioned. (The root README still describes these as browser demonstrations; the code is the current truth.)
- Profile settings and some control history are stored in the browser only.

## Capabilities and Constraints

- Public site: Landing, About, Features, How It Works, Contact; login and signup.
- Dashboard: Overview, Parameters, Feeding, Water Change, Aerator, Alerts & Logs, Settings.
- Stack: React 18, TypeScript, Vite, Tailwind CSS 3, Recharts, React Router 7.
- Copy may be reworded for clarity, but every factual state and limitation must keep its meaning.

## Brand Commitments

- Name: AquaSense. Logo/mascot: `Frontend/src/assets/images/AquaSense_Logo.png`.

## Evidence on Hand

- Photos in `Frontend/src/assets/images/` (about, feature, hero, login).
- No validated accuracy figures, customer testimonials, or deployment counts exist; do not fabricate any.

## Product Principles

1. Trust before numbers: show whether a reading can be relied on alongside the reading.
2. Say what is unknown plainly instead of hiding it or guessing.
3. One glance on a phone answers "is the tank OK and what do I do?"
4. Controls that are demonstrations must say so.
