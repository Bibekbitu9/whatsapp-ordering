# 🎂 WhatsApp Cake Ordering Bot

A WhatsApp bot for a cake shop that takes orders via natural language (powered by **Gemini AI**) or step-by-step menus. Orders are saved to **Google Sheets** and the shop owner is notified instantly.

## Features

- 🤖 **Gemini AI** — Customers can order naturally: *"I want a 1kg chocolate cake for delivery to MG Road"*
- 📋 **Step-by-step fallback** — Numbered menus if AI can't parse the message
- 📊 **Google Sheets** — Every order is logged automatically
- 📍 **Location validation** — Accepts WhatsApp pins, Google/Apple Maps links, or typed addresses
- 🔔 **Owner notifications** — Get a WhatsApp message for every new order
- 🔁 **Rate limit handling** — Auto-retries on Gemini API limits

## Tech Stack

- [whatsapp-web.js](https://wwebjs.dev/) — WhatsApp client (no external API needed)
- [Google Generative AI](https://ai.google.dev/) — Gemini for natural language parsing
- [Google Sheets API](https://developers.google.com/sheets/api) — Order storage
- Node.js

## Prerequisites

- **Node.js** v18+
- A **WhatsApp account** (for the bot number)
- A **Gemini API key** — free from [Google AI Studio](https://aistudio.google.com/apikey)
- A **Google Service Account** with Sheets API enabled
- A **Google Sheet** shared with the service account email

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/Bibekbitu9/whatsapp-ordering.git
cd whatsapp-ordering
npm install
```

### 2. Configure `.env`

Create a `.env` file (or edit the existing one):

```env
OWNER_NUMBER=91XXXXXXXXXX          # Your WhatsApp number (with country code)
GEMINI_API_KEY=your_gemini_key     # From Google AI Studio
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-sa@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID=your_sheet_id      # From the Google Sheet URL
```

### 3. Share Google Sheet

Open your Google Sheet → **Share** → Add the service account email as **Editor**.

### 4. Start the Bot

```bash
npm start
```

A **QR code** will appear in the terminal. Scan it with WhatsApp (**Settings → Linked Devices → Link a Device**).

Once you see `🤖 Bot is ready and listening for messages!`, you're good to go!

## How It Works

1. Customer sends any message → Gemini AI tries to parse the order
2. If all details are extracted → shows order summary → asks for confirmation
3. If partial → fills what it can, asks only for missing fields via menu
4. If nothing parsed → shows numbered cake menu (Chocolate / Red Velvet / Fruit)
5. After confirmation → saves to Google Sheets + notifies owner
6. Bot goes silent until customer types **"order"** or **"menu"**

## Order Flow

```
Customer: "I want a 1kg chocolate cake for delivery to MG Road"
Bot:      📋 Order Summary
          🎂 Cake: Chocolate
          ⚖️ Weight: 1kg
          🚚 Mode: Delivery
          📍 Address: MG Road
          Reply yes to confirm or no to cancel.
Customer: "yes"
Bot:      🚚✅ Order Confirmed for Delivery!
          Thank you for your order! 🙏
```

## Project Structure

```
├── index.js            # Main bot — WhatsApp client & order flow
├── gemini.js           # Gemini AI order parser
├── state_manager.js    # Per-user session & state tracking
├── utils/
│   └── sheets.js       # Google Sheets integration
├── .env                # API keys & config
└── package.json
```

## License

ISC
