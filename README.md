# You-nique by Lis — website & booking system

Website for **You-nique by Lis**, nail salon in Lelydorp, Suriname — *"You break it? We fake it 🥰"*.

- Burgundy & gold design based on the salon's logo, with hand-drawn SVG artwork (a live hand in the hero cycling through looks and skin tones, polish bottle, "kintsugi" nail repair, 8 illustrated nail styles)
- **Nail Studio**: visitors design their set on an illustrated hand — shape, length, colour, finish (glossy, matte, chrome, glitter, cat eye), nail art, gold accent nail and skin tone — see a price/time estimate, save it as a branded image to share, and **book that exact design** (Lis sees it with the booking)
- English / Dutch language switch (remembers the visitor's choice)
- Services & prices, "Style Menu" gallery, About Lis, opening hours, location, booking policies
- **Online booking**: choose services → pick a day and time (live availability) → enter details → booking reference, WhatsApp message to Lis, and "add to calendar" file
- **Salon dashboard** at `/admin`: a week calendar, "tomorrow's reminders" with one-tap WhatsApp messages, confirm/move/cancel appointments, see each client's Nail Studio design, add phone/walk-in bookings, block time off — and it installs on Lis's phone like an app
- **Manage my booking** at `/manage`: clients look up their appointment with their reference + phone number, add it to their calendar, reschedule via WhatsApp or cancel (up to 24 h before)
- Share-ready: Open Graph image for WhatsApp/Facebook link previews, structured data for Google
- No double bookings: the server checks every slot again right before saving
- Works on phones, tablets and desktops
- No dependencies — just Node.js

## ✅ Before going live — fill in the real details

The Facebook page needs a login to show contact details, so these are **placeholders**. Edit
[`public/config.json`](public/config.json):

| Setting | What to put |
| --- | --- |
| `contact.whatsapp` | Lis's WhatsApp number, digits only with country code, e.g. `5978123456` |
| `contact.phoneDisplay` | How the number should look, e.g. `+597 812-3456` |
| `contact.address` / `contact.mapsQuery` | Salon address (and what to search for in Google Maps) |
| `hours` | Opening hours per day (`null` = closed) |
| `services` | Names, descriptions, duration (`minutes`) and `price` (SRD) of each service |
| `booking` | Slot size, minimum notice, how far ahead people can book, buffer between clients, and `autoConfirm` (if `false`, Lis confirms each booking) |

Also worth a look:

- **Photos** — `public/images/lis.jpg` is the profile picture from Facebook. Swap in a higher-resolution photo if you have one.
- **Text** — all wording (both languages), including the "About Lis" story and the "Good to know" policies, lives in [`public/js/i18n.js`](public/js/i18n.js).
- The **Style Menu** pictures are illustrations, not photos of Lis's work. The "See Lis's latest sets on Facebook" button links to her real work.

## Run it locally

Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
ADMIN_PASSWORD=choose-a-password npm start
```

Open http://localhost:3000 for the website and http://localhost:3000/admin for the dashboard.

Run the tests with `npm test`.

## Settings (environment variables)

| Variable | Purpose |
| --- | --- |
| `ADMIN_PASSWORD` | Password for `/admin`. **Set this.** Locally, a temporary password is printed at startup if it's missing; on Vercel the dashboard stays off until it's set. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Upstash Redis storage (added automatically when you connect Upstash in Vercel). `UPSTASH_REDIS_REST_URL` / `_TOKEN` also work. |
| `SESSION_SECRET` | Optional extra secret for dashboard logins. Changing it (or the password) logs everyone out. |
| `PORT` | Port to listen on (default `3000`). |
| `DATA_DIR` | Folder where appointments are saved as `db.json` (default `./data`). Use a persistent disk in production. |
| `NOTIFY_WEBHOOK_URL` | Optional. Get a ping for each new booking — works with a Discord or Slack webhook, [ntfy.sh](https://ntfy.sh), Zapier, Make, etc. |

## Putting it online

### Vercel (recommended)

Everything is pre-configured in `vercel.json`: the site is served from `public/`, and the booking API runs as one serverless function (`api/index.js`).

1. **Deploy** — in this folder run `npx vercel --prod`. Log in when the browser opens, answer the questions with the defaults (new project, current directory). You get a live URL straight away.
2. **Set the dashboard password** — `npx vercel env add ADMIN_PASSWORD production` (or Vercel dashboard → Project → Settings → Environment Variables).
3. **Add storage for bookings** — Vercel dashboard → Project → **Storage** → *Create Database* → **Upstash for Redis** (free plan) → connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
4. **Redeploy** — `npx vercel --prod` again.

Until steps 2–4 are done the site is fully live (Nail Studio included) and the booking form sends requests to Lis on WhatsApp instead. After step 4, live availability, the dashboard and "Manage my booking" switch on automatically.

Afterwards: add the salon's domain under Project → Settings → Domains, and change `og:image` in `public/index.html` to the full `https://…/images/og.jpg` URL so Facebook shows the preview image.

### Any Node.js host

Deploy as a Node.js web service (Render, Railway, Fly.io, a VPS…):

- Start command: `npm start`
- Set `ADMIN_PASSWORD`
- Attach a **persistent disk** and point `DATA_DIR` to it, otherwise appointments are lost whenever the host restarts or redeploys. (Free plans without disks are fine for trying it out, not for real bookings.)
- Point the salon's domain at it and turn on HTTPS (most hosts do this automatically).

**Free alternative — static site only.** The `public/` folder also works on its own (GitHub Pages, Netlify, …). Without the server there is no live availability or dashboard. The booking form then sends the request to Lis as a pre-filled WhatsApp message, and she confirms the time herself.

## Nail Studio

- Every option button shows a live mini-nail in the client's current colour.
- **Book this design** picks the matching services (extensions for long/coffin/stiletto, plus the nail art add-on when needed), pre-fills the notes, shows the design in the booking summary, stores it with the booking, and adds a link to it in the WhatsApp message.
- **Save image** creates a 1080×1350 branded picture (on phones it opens the share sheet — perfect for WhatsApp/Instagram stories).
- Links like `https://your-site/#design=almond.l.741634.gloss.french.d6aa4f.0.2` open a design straight in the studio. The Style Menu's **Try it on** buttons use the same codes (see `code:` in `public/js/art.js`).
- Colours, nail-art colours and skin tones live at the top of `public/js/studio.js` and `public/js/designer-art.js`.

## How a booking flows

1. The client picks services, a free time and enters their name and WhatsApp number.
2. The booking is saved as **"to confirm"** and the time is immediately blocked for others. The client gets a reference like `YL-7K3DQ` and a button to message Lis on WhatsApp.
3. In `/admin`, Lis taps **Confirm**, then **WhatsApp** to send the client a ready-made confirmation in their own language.
4. Afterwards she can mark it **Done**, **Move** it, or **Cancel** it, which frees the time again.

## Project layout

```
server.js            Web server + booking API (no dependencies)
api/index.js         Vercel serverless entry (reuses server.js)
lib/store.js         Storage: JSON file locally, Upstash Redis on Vercel
vercel.json          Vercel settings
public/
  index.html         The website
  admin.html         Salon dashboard (+ admin.webmanifest, sw.js: installable app)
  manage.html        "Manage my booking" page for clients
  config.json        Salon details, hours, services & prices  ← edit me
  css/               Styles
  js/app.js          Page rendering, language switch, menus
  js/booking.js      Booking widget
  js/slots.js        Availability rules (shared by browser and server)
  js/art.js          Generated nail-style illustrations (Style Menu)
  js/studio.js       Nail Studio controls, estimate, image export
  js/designer-art.js Illustrated hand + nail renderer (shared with server/admin)
  js/i18n.js         English & Dutch text                       ← edit me
  js/admin.js        Dashboard logic
test/                Automated tests (npm test)
```
