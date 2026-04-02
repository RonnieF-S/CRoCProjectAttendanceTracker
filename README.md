# CRoC Project Attendance Tracker

This attendance tracker is designed for one Curtin Robotics Club project at a time.

Each project gets:

- one Google Sheet
- one Google Apps Script web app bound to that sheet
- one deployed frontend page using [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html)

The system uses a sign-in / sign-out event model:

- the frontend records scans locally first
- the frontend keeps the current roster in browser storage so refreshes do not lose state
- the frontend syncs events to Google Sheets in the background
- the backend stores raw events in `Events`
- the backend rebuilds a derived `Attendance` sheet from those events

## Files To Edit

- [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs)
  - paste this into Apps Script
  - optionally edit backend `SETTINGS`
- [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html)
  - set the Apps Script `apiUrl`
  - deploy this through GitHub Pages

## Supported IDs

Manual entry accepts:

- `12345678`
- `123456A`

Barcode scans also accept a 3-character prefix:

- `xxx12345678`
- `xxx123456A`

The first 3 characters are ignored when present.

## Setup Overview

To set up a new project:

1. Create a new Google Sheet for that project.
2. Add the backend code in Apps Script.
3. Run `setupSpreadsheet()`.
4. Fill in the `Config` tab.
5. Deploy the Apps Script as a web app.
6. Put that web app URL into [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html).
7. Push the frontend to GitHub Pages.

## 1. Create The Google Sheet

Create one Google Sheet per project.

Example:

- `Drone Team Attendance`

## 2. Add The Backend

1. Open the Google Sheet.
2. Go to `Extensions` -> `Apps Script`.
3. Delete the sample code.
4. Paste in the contents of [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs).
5. Save the script.

## 3. Run Initial Setup

In Apps Script:

1. Select `setupSpreadsheet`
2. Click `Run`
3. Approve the script if prompted

This creates the required tabs:

- `Config`
- `Events`
- `Attendance`

## 4. Fill In The Config Tab

The `Config` tab must use this exact header row:

```text
Project Name | Password | Session Name | Day | Start Time | End Time | Active
```

Example:

```text
Drone Team | CR0C | Drone Team Build Session | Tuesday  | 16:30 | 21:00 | TRUE
Drone Team | CR0C | CRoC Build Night         | Thursday | 17:40 | 21:00 | TRUE
```

Column meanings:

- `Project Name`: shown in the page title and heading
- `Password`: required to unlock the frontend
- `Session Name`: label for that session
- `Day`: full weekday name such as `Tuesday`
- `Start Time`: `HH:MM`
- `End Time`: `HH:MM`
- `Active`: `TRUE` to enable the session row

Use the same `Project Name` and `Password` on each active row for that project sheet.

## 5. Review Backend Settings

The backend operational settings are near the top of [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs):

```javascript
var SETTINGS = {
  duplicateCooldownSeconds: 10,
  recentLimit: 12,
  syncBatchSize: 10,
};
```

What they control:

- `duplicateCooldownSeconds`: short cooldown that prevents an immediate second scan from accidentally signing someone out
- `recentLimit`: how many recent events the frontend shows
- `syncBatchSize`: how many queued events are sent to the backend at once

The default values are sufficient for normal use. You usually do not need to change them.

If you do want to adjust them:

1. Edit the `SETTINGS` object in [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs)
2. Save the Apps Script project
3. Redeploy the web app as a new version

## 6. Deploy The Backend

After saving the script:

1. Click `Deploy` -> `New deployment`
2. Choose `Web app`
3. Set:
   - `Execute as`: `Me`
   - `Who has access`: the option that matches how you want to run the tracker
4. Click `Deploy`
5. Copy the web app URL

If you change the backend later:

1. Save the Apps Script code
2. Open `Deploy` -> `Manage deployments`
3. Edit the web app deployment
4. Select `New version`
5. Deploy again

The URL usually stays the same, but the deployment version must be updated.

## 7. Connect The Frontend

Open [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html) and set the backend URL in the `CONFIG` constant:

```javascript
const CONFIG = {
  apiUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",
  storagePrefix: "croc-attendance-v3",
  syncRetryMs: 4000,
  pollIntervalMs: 15000
};
```

Replace `apiUrl` with your deployed Apps Script web app URL.

The frontend does not store the password. Users enter it on the page, and the backend verifies it against the `Config` tab.

## 8. Deploy The Frontend

The frontend is a single file:

- [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html)

If GitHub Pages is already configured:

1. Update `index.html`
2. Commit the change
3. Push to GitHub
4. Wait for GitHub Pages to redeploy

## Sheet Structure

### Config

Used for project name, password, and session schedule.

### Events

The `Events` tab is append-only.

Header:

```text
Timestamp | Date | Member ID | Event Type | Method | Project Name | Session Name | Session Times | Day | Event ID | Device ID
```

You should not normally edit this tab manually.

### Attendance

The `Attendance` tab is derived from `Events`.

Header:

```text
Date | Member ID | Project Name | Session Name | Session Times | Day | Sign In | Sign Out | Attendance Hours | Notes
```

Notes:

- `Attendance Hours` is calculated as a decimal rounded to 2 decimal places
- multiple sign-in / sign-out pairs in one session are summed
- if someone signs in and never signs out, and the session has ended, attendance defaults to `1.00` hour
- if the operator uses `End Session (Sign Out All)`, every remaining signed-in member is signed out with the same `1.00` hour fallback
- `Notes` is available for manual comments

Do not type attendance rows manually. The backend rebuilds this tab.

## How Session Matching Works

A session is open when:

- `Day` matches today
- current time is within `Start Time <= now < End Time`

If no session is open:

- the page shows that no session is open
- the next configured session is shown when available
- sign-ins are blocked

## Frontend Behavior

The frontend:

- keeps local session state in `localStorage`
- restores that state after refresh
- polls the backend periodically so multiple open pages stay reasonably in sync
- shows the current session
- shows a live `Currently Signed In` roster
- shows recent sign-in / sign-out activity
- includes an `End Session (Sign Out All)` button under `Recent Activity`

## Scan Behavior

Normal scan flow:

- first scan for a member signs them in
- a quick repeat scan during the cooldown window does not sign them out
- a later scan after the cooldown window signs them out
- members can sign in and out multiple times in the same session, and attendance is summed

End-of-session flow:

- if members are still signed in, use `End Session (Sign Out All)`
- this creates forced sign-out events for everyone still on the roster
- those forced sign-outs use the same `1.00` hour fallback as members who never signed out before session end

## First-Time Test

Use a wide test session first:

```text
Project Name | Password | Session Name | Day | Start Time | End Time | Active
Drone Team   | CR0C     | Test         | Friday | 01:00 | 20:00 | TRUE
```

Then test:

1. Open the frontend page.
2. Enter the password.
3. Confirm the title becomes `Drone Team Attendance`.
4. Scan or enter one member ID.
5. Confirm they appear in `Currently Signed In`.
6. Scan the same member again immediately and confirm they stay signed in.
7. Scan the same member again after the duplicate cooldown window and confirm they sign out.
8. Sign in one member and use `End Session (Sign Out All)`.
9. Confirm they are removed from `Currently Signed In`.
10. Refresh the page and confirm the roster restores correctly.
11. Confirm the events appear in `Events`.
12. Confirm the attendance summary appears in `Attendance`.

## Troubleshooting

### Access denied / invalid action

Usually one of these:

- the frontend `apiUrl` points to the wrong Apps Script deployment
- the Apps Script code was saved but not redeployed as a new version
- the page password does not match the `Password` column in `Config`

### Session time must use HH:MM format

Use `HH:MM` values in `Config`, for example:

- `01:00`
- `16:30`
- `20:00`

### The page shows the wrong project name

Check the first non-empty `Project Name` value in the `Config` tab.

### Events are not appearing

Check:

- the Apps Script deployment is current
- the frontend is using the correct `apiUrl`
- the session is currently open

### Attendance is lower than expected for someone who forgot to sign out

That is expected if they were left signed in until session end or signed out via `End Session (Sign Out All)`. In those cases the backend applies the `1.00` hour fallback.

### The roster looks stale

The page restores local state immediately, then syncs and polls the backend. If another device just scanned, wait for the next poll or refresh the page.
