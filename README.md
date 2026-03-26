# CRoC Project Attendance Tracker

Attendance tracker for Curtin Robotics Club project build sessions.

This project has two parts:

- a static frontend in [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html)
- a Google Apps Script backend in [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs)

The frontend is hosted from GitHub Pages. The backend runs as a Google Apps Script web app attached to a Google Sheet.

## What it does

- scans student card barcodes in the browser
- accepts manual entry as a fallback
- supports both student and staff IDs
- writes attendance rows into a Google Sheet
- matches each sign-in to the current configured session
- rejects duplicate sign-ins in the same session
- requires the access password stored in the backend `Config` sheet
- uses the project name from the Google Sheet to label the frontend page

## Supported ID formats

Student IDs:

- `12345678`
- `xxx12345678`

Staff IDs:

- `123456A`
- `xxx123456A`

For scanned barcodes, the first 3 characters are ignored and the remaining student or staff ID is used.

## Repository files

- [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html): frontend UI and browser-side scanner logic
- [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs): Apps Script backend copied into the Google Sheet script editor

## Architecture

1. A user opens the GitHub Pages frontend.
2. The frontend calls the Apps Script web app with JSONP.
3. The Apps Script backend reads the current session from the `Config` sheet.
4. If the current day and time match a configured active session, the sign-in is recorded in the `Attendance` sheet.
5. If the same ID is already present for the same date and session, the backend rejects the duplicate.

## Backend setup

### 1. Create the Google Sheet

Create a new Google Sheet for the project attendance data.

Recommended sheet name:

- `Drone Team Attendance`

This spreadsheet must contain two tabs:

- `Attendance`
- `Config`

You do not need to create them manually if you run `setupSpreadsheet()` in Apps Script. The script will create them for you.

### 2. Create the Apps Script project

1. Open the Google Sheet.
2. Go to `Extensions` -> `Apps Script`.
3. Delete the default sample code.
4. Copy the contents of [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs) into the Apps Script editor.
5. Save the script.

### 3. Run the sheet setup function

In Apps Script:

1. Select the `setupSpreadsheet` function.
2. Click `Run`.
3. Authorize the script if Google prompts you.

This creates the required tabs and header rows if they do not already exist.

## Google Sheet structure

### Attendance tab

The `Attendance` tab must use this exact header row:

```text
Timestamp | Date | Student Number | Method | Session Name | Session Times | Day | Log book hours | Notes
```

What each column means:

- `Timestamp`: full timestamp when the sign-in happened
- `Date`: sign-in date in `yyyy-MM-dd`
- `Student Number`: normalized student or staff ID
- `Method`: `barcode` or `manual`
- `Session Name`: matched session name from `Config`
- `Session Times`: matched start and end times from `Config`
- `Day`: matched weekday from `Config`
- `Log book hours`: credited hours from `Config`
- `Notes`: left blank by the app and available for manual notes later

### Config tab

The `Config` tab must use this exact header row:

```text
Project Name | Password | Session Name | Day | Start Time | End Time | Log book hours | Active
```

Each row describes one recurring session window.

Example:

```text
Drone Team | CR0C | Drone Team Build Session | Tuesday  | 16:30 | 21:00 | 2 | TRUE
Drone Team | CR0C | CRoC Build Night         | Thursday | 17:40 | 21:00 | 2 | TRUE
Drone Team | CR0C | Test                     | Thursday | 00:00 | 23:00 | 5 | TRUE
```

Column details:

- `Project Name`: project label shown in the frontend title, for example `Drone Team`
- `Password`: access password required by the frontend before sign-ins can begin
- `Session Name`: the session label written into attendance rows
- `Day`: full weekday name, for example `Monday`, `Tuesday`, `Thursday`
- `Start Time`: start time in 24 hour format, for example `16:30`
- `End Time`: end time in 24 hour format, for example `21:00`
- `Log book hours`: numeric hours to credit for the session
- `Active`: `TRUE` to enable the row, `FALSE` to disable it

Use the same password value on each active row. The backend uses the first non-empty `Password` value it finds.

## Important time format rules

Use `HH:MM` time values in the `Config` tab.

Examples:

- `00:00`
- `16:30`
- `21:00`

Avoid typing text such as:

- `4:30pm`
- `9 PM`

The backend can also handle Google Sheets time cells, but `HH:MM` is the safest way to enter session times.

## How session matching works

When a sign-in arrives, the backend:

1. reads the current local day and time from the script timezone
2. reads all rows in the `Config` tab
3. finds the first active row where:
   - `Day` matches today
   - current time is within `Start Time <= now < End Time`
4. uses that row to populate:
   - `Session Name`
   - `Session Times`
   - `Day`
   - `Log book hours`

If no active row matches, sign-in fails with:

```text
No active session matches the current day and time.
```

## Duplicate handling

Duplicates are checked by:

- `Date`
- `Student Number`
- `Session Name`

That means the same person can sign in:

- once for a Tuesday build session
- once again on a different date
- once again in a different session

But they cannot sign in twice for the same session on the same day.

The backend rejects duplicate sign-ins and the frontend displays a clear `Already signed in` message.

The backend also includes a maintenance function:

- `cleanupAttendanceDuplicates()`

You can run that manually in Apps Script if older duplicate records already exist in the sheet.

## Deploying the backend web app

After the script is saved:

1. Click `Deploy` -> `New deployment`
2. Choose type `Web app`
3. Set:
   - `Execute as`: `Me`
   - `Who has access`: whichever option matches your use case, typically `Anyone`
4. Click `Deploy`
5. Copy the web app URL

If you later change the backend code:

1. save the code
2. open `Deploy` -> `Manage deployments`
3. edit the existing web app deployment
4. choose `New version`
5. deploy again

The URL normally stays the same, but the deployment must be updated to a new version or the old code will continue running.

## Connecting the frontend to the backend

Open [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html) and update:

```js
const CONFIG = {
  apiUrl: "YOUR_APPS_SCRIPT_WEB_APP_URL",
  duplicateCooldownMs: 3000,
  recentLimit: 12
};
```

Replace `apiUrl` with the deployed Apps Script web app URL.

The frontend does not store the access password. Users enter the password on the page, and the backend verifies it against the `Password` column in the `Config` tab.

After that, commit and push the frontend so GitHub Pages serves the updated backend endpoint.

## Frontend deployment

The frontend is a single static HTML file:

- [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html)

If GitHub Pages is already configured for the repository, pushing updates to the published branch will redeploy the site automatically.

Typical flow:

1. update `index.html`
2. commit the changes
3. push to GitHub
4. wait for GitHub Pages to redeploy

## First-time setup checklist

1. Create the Google Sheet.
2. Open `Extensions` -> `Apps Script`.
3. Paste in [`Code.gs`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/Code.gs).
4. Run `setupSpreadsheet()`.
5. Open the `Config` tab and replace the example rows with your real sessions.
6. Deploy the Apps Script as a web app.
7. Copy the web app URL.
8. Update `apiUrl` in [`index.html`](/Users/ronniefellows-smith/dev/croc/project_attendance_tracker/index.html).
9. Push the frontend to GitHub Pages.
10. Open the site and test a sign-in during an active session.

## Recommended test procedure

Use a wide test session first:

```text
Project Name | Password | Session Name | Day      | Start Time | End Time | Log book hours | Active
Drone Team   | CR0C     | Test         | Thursday | 00:00      | 23:00    | 5              | TRUE
```

Then test:

1. load the frontend
2. confirm the page title becomes `Drone Team Attendance`
3. sign in a student ID
4. sign in the same ID again
5. confirm the second sign-in is rejected as a duplicate

## Troubleshooting

### Error: `Session time must use HH:MM format`

Check the `Config` tab:

- `Start Time` and `End Time` should be valid times
- preferred format is `HH:MM`
- examples: `00:00`, `16:30`, `21:00`

### Sign-ins are being written in the wrong columns

This usually means the old Apps Script backend is still deployed.

Fix:

1. save the new `Code.gs`
2. update the deployment to a `New version`
3. test again

### Frontend shows the wrong project name

Check the `Project Name` column in the `Config` tab.

The frontend uses the first non-empty `Project Name` value it finds.

### Access is denied even though the sheet is configured

Check the `Password` column in the `Config` tab:

- at least one active row must have a password value
- the same password should be used across all active rows
- the password entered on the frontend must match exactly

### Duplicate sign-ins are not being rejected

Check that:

- the backend deployment is the latest version
- the sign-ins are for the same `Date`
- the sign-ins are for the same `Session Name`
- the normalized ID in `Student Number` is identical

You can also run `cleanupAttendanceDuplicates()` to remove historical duplicate rows.

## Operational notes

- Manual entry accepts plain IDs like `12345678` and `123456A`
- Barcode scanning accepts prefixed values like `xxx12345678` and `xxx123456A`
- Notes are never overwritten by the app; they remain available for manual editing in the sheet

## Future improvements

Possible next steps if needed:

- split frontend CSS and JS into separate files
- add an admin page for managing `Config`
- add audio feedback for success and duplicate scans
- add a live attendance table pulled from the sheet
