# You-nique by Lis — website & booking system

Website for **You-nique by Lis**, nail salon in Lelydorp, Suriname — *"You break it? We fake it 🥰"*.

- Burgundy & gold design based on the salon's logo, with hand-drawn SVG artwork (nail swatch fan, polish bottle, "kintsugi" nail repair, 8 illustrated nail styles)
- English / Dutch language switch (remembers the visitor's choice)
- Services & prices, "Style Menu" gallery, About Lis, opening hours, location, booking policies
- **Online booking**: choose services → pick a day and time (live availability) → enter details → booking reference, WhatsApp message to Lis, and "add to calendar" file
- **Salon dashboard** at `/admin`: see, confirm, move or cancel appointments, message clients on WhatsApp with a pre-written text, add phone/walk-in bookings, and block time off
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
| `ADMIN_PASSWORD` | Password for `/admin`. **Set this.** Without it, a temporary password is printed in the server log at startup. |
| `PORT` | Port to listen on (default `3000`). |
| `DATA_DIR` | Folder where appointments are saved as `db.json` (default `./data`). Use a persistent disk in production. |
| `NOTIFY_WEBHOOK_URL` | Optional. Get a ping for each new booking — works with a Discord or Slack webhook, [ntfy.sh](https://ntfy.sh), Zapier, Make, etc. |

## Putting it online

**Recommended — full booking system.** Deploy as a Node.js web service on any host (Render, Railway, Fly.io, a VPS…):

- Start command: `npm start`
- Set `ADMIN_PASSWORD`
- Attach a **persistent disk** and point `DATA_DIR` to it, otherwise appointments are lost whenever the host restarts or redeploys. (Free plans without disks are fine for trying it out, not for real bookings.)
- Point the salon's domain at it and turn on HTTPS (most hosts do this automatically).

**Free alternative — static site only.** The `public/` folder also works on its own (GitHub Pages, Netlify, …). Without the server there is no live availability or dashboard. The booking form then sends the request to Lis as a pre-filled WhatsApp message, and she confirms the time herself.

## How a booking flows

1. The client picks services, a free time and enters their name and WhatsApp number.
2. The booking is saved as **"to confirm"** and the time is immediately blocked for others. The client gets a reference like `YL-7K3DQ` and a button to message Lis on WhatsApp.
3. In `/admin`, Lis taps **Confirm**, then **WhatsApp** to send the client a ready-made confirmation in their own language.
4. Afterwards she can mark it **Done**, **Move** it, or **Cancel** it, which frees the time again.

## Project layout

```
server.js            Web server + booking API (no dependencies)
public/
  index.html         The website
  admin.html         Salon dashboard
  config.json        Salon details, hours, services & prices  ← edit me
  css/               Styles
  js/app.js          Page rendering, language switch, menus
  js/booking.js      Booking widget
  js/slots.js        Availability rules (shared by browser and server)
  js/art.js          Generated nail-style illustrations
  js/i18n.js         English & Dutch text                       ← edit me
  js/admin.js        Dashboard logic
test/                Automated tests (npm test)
```
