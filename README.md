# Gather seating planner

A browser-only venue planner with multiple rooms, draggable round and rectangular tables, and capacity-limited guest assignments. No backend, external fonts, runtime dependencies, accounts, or cloud services are required.

## Run locally

The simplest way to run the app is to open `public/index.html` directly in your browser; it uses plain scripts, so no server is needed. Optionally, with Node.js 18 or later, start the included local static server:

```powershell
npm start
```

Then open `http://localhost:8080`. The included server listens only on your own computer and serves only the app's four public files. Set the `PORT` environment variable to change its port. Note that browser storage is separate for `file:` and `http:` addresses, so export and import a plan to move it between them.

## Deploy to static hosting

Upload the contents of the `public/` folder together to your static website:

- `index.html`
- `styles.css`
- `app.js`
- `model.js`

There is no build step. Relative asset paths support hosting in a subdirectory. Azure Static Web Apps, GitHub Pages, and other static hosts can serve the app. For Azure Static Web Apps choose the **Custom** build preset with app location `/public`, and leave the API location and output location empty.

## Use

1. Name your venue and create rooms with width and length in meters.
2. Add round or rectangular tables, their dimensions, and seat capacities.
3. Drag tables within the room. Keyboard users can focus a table and move it with arrow keys (0.1 m), or Shift + arrow keys (0.5 m). Select a table and choose **Edit table** to resize, rotate, or delete it.
4. Add guests individually or paste one name per line. Use the dropdown below each guest to choose a table in any room, or drag a guest onto a table. On touch devices, use the dropdown. Full tables cannot accept more guests. Identical names are allowed for different people. Use **Link with…** under a guest to link people who must sit together: assigning any one of them moves the whole group, and a table without room for everyone is refused. Use **Unlink** to separate someone.
5. Each seated guest's initials appear around their table, running clockwise from the top. Hover, focus or click the initials to see the full name. Drag the initials to another seat around the table to change the order, or onto a different table to move the guest there (full tables are refused) (touch works too; with the keyboard, focus a seat and use the arrow keys). Select a table to also reorder its guests by dragging names or with the arrow buttons.
6. **Print plan** prints all rooms, table guest lists, and unseated guests. The browser print dialog can also save a PDF.

Use the **Seating planner** and **Group planner** tabs to switch workspaces. Seating planning shows the guest list beside the room layout; group planning uses the full workspace width without the room layout or guest sidebar. Switching tabs preserves your plan and search filters. Keyboard users can switch tabs with Left/Right arrow keys or Home/End.

Choose **Group planner** to see group cards across the whole venue. Each card lists its members and their seating locations. Use the pencil on a linked group card to name or rename it; names are saved with the plan and included in JSON exports. Choose a person and click **Add to group** to add them; choosing an already linked person merges their entire group. On an unlinked person's card, choose another person and click **Link** to start a group. Linking uses the card's first person's table if seated, otherwise a seated member's table, and refuses changes if that table cannot fit everyone. **Remove** unlinks a member without deleting the person or changing their seat. Groups with only one remaining member dissolve automatically. Search keeps the entire group visible when any member matches; **Linked groups only** hides unlinked people. Changes save automatically and remain compatible with the guest-list controls and JSON exports.

Drag a person from a card onto another card to move **only that person**, not their whole group. Dropping onto an unlinked person's card creates a group. The moved person takes the destination person's seating location, including becoming unseated when the destination is unseated; everyone else keeps their seat. Full destination tables refuse the move without changing either group. Drop onto the unlink area to remove a person from their group without changing their seat. On touch screens, drag from the **::** handle. Same-group drops and cancelled drags make no changes. For keyboard use, **Remove** the person first, then use the destination card's dropdown to add them; existing dropdown linking still merges entire groups.

Tables stay within room boundaries. Table overlap is intentionally allowed; this is a layout tool, not an accessibility, clearance, or fire-safety validator. Room resizing moves tables inward if necessary and rejects rooms too small for existing tables.

**Full screen** expands the active planning workspace. Both tabs and **Exit full screen** remain available, so you can switch between group and seating planning without leaving full screen.

## Saving and sharing

Changes automatically save to this browser's local storage. Storage is specific to the browser, device, and website origin; it does not sync between people. Private browsing, cleared site data, or browser storage restrictions can remove or prevent saving. Save failures are shown explicitly.

**Export plan** downloads a versioned JSON file, including guest names. Keep regular backups and only share with appropriate recipients. **Import plan** validates an exported file and asks before replacing the current plan. Invalid imports leave the existing plan unchanged. There are limits of 50 rooms, 500 tables, 5,000 guests, 100 seats per table, and 5 MB per imported file.

Changing the hosting domain or local port creates a different browser storage origin. Export before moving the app, then import at the new location. The app makes no network requests after its own files load.

## Translations

All UI text lives in `public/locales/<code>.js` (English, German and Danish are included). The language is picked from the saved choice, then the browser language, and can be changed with the selector in the header.

To add a language, copy `public/locales/en.js` to `<code>.js`, change the `register("<code>", "<Name>", ...)` call, translate the values (keep the keys and `{placeholders}`), and add a `<script>` tag for it in `public/index.html`. Missing keys fall back to English. Plural forms use `key_one` / `key_other` (plus `_few`, `_many`, etc. where the language needs them).

## Validate

With Node.js 18 or later:

```powershell
npm test
npm run check
```

Tests cover assignment capacity, rotated-table bounds, deletion effects, JSON round trips, and invalid imports. Node.js is only needed for development checks, not for hosting.
