# zoho-discord

A simple integration that forwards emails from Zoho Mail to Discord channels via webhooks.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and add your Discord webhook URL.

3. **Get Discord Webhook URL:**
   - Go to your Discord server settings
   - Navigate to Integrations → Webhooks
   - Create a new webhook and copy the URL

4. **Configure Zoho Mail:**
   - In Zoho Mail, go to Settings → Mail Accounts → Filters
   - Create a new filter/rule
   - Set action to "Forward to URL" and use: `http://your-server:3000/webhook/zoho`

5. **Run the server:**
   ```bash
   npm start
   ```

## API Endpoints

- `POST /webhook/zoho` - Receives email data from Zoho
- `GET /health` - Health check endpoint
