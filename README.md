# Zoho-Discord Integration

A bidirectional email management system that allows you to:
- **Receive Zoho emails in Discord** with rich formatting and interactive buttons
- **Mark emails as read** directly from Discord
- **Reply to emails** through Discord modals
- **Full email management** without leaving Discord

![Email in Discord](https://via.placeholder.com/600x300/0099ff/ffffff?text=Email+Preview+in+Discord)

## Features

- ✅ **Email Notifications**: Rich Discord embeds for incoming emails
- ✅ **Mark as Read**: One-click button to mark emails as read in Zoho
- ✅ **Reply Functionality**: Modal popup to reply to emails from Discord with proper threading
- ✅ **Smart Address Selection**: Automatically chooses best "from" address based on domain matching
- ✅ **Interactive Buttons**: Discord UI components for email actions
- ✅ **Auto Mark-as-Read**: Emails are automatically marked as read when you reply
- ✅ **HTML Content Cleaning**: Removes CSS and displays clean email content
- ✅ **Token Caching**: Prevents rate limiting with intelligent token management
- ✅ **Outgoing Email Filter**: Only shows incoming emails, not your own sent emails

## Prerequisites

- **Node.js 18+**
- **Discord Server** with admin permissions
- **Zoho Mail account**
- **Deployment platform** (Coolify, Heroku, Railway, etc.)

## Installation & Setup

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/zoho-discord.git
cd zoho-discord
npm install
```

### 2. Create Discord Bot

#### 2.1 Create Discord Application
1. Go to https://discord.com/developers/applications
2. Click **"New Application"**
3. Name it **"Zoho Email Bot"**
4. Copy the **Application ID** (save for later)

#### 2.2 Create Bot User
1. In your application, go to **"Bot"** section
2. Click **"Add Bot"**
3. Copy the **Bot Token** (save for later)
4. Enable these permissions:
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Manage Messages (required to add buttons to webhook messages)
   - ✅ Use External Emojis (for button emojis)
   - ✅ Use Slash Commands

#### 2.3 Invite Bot to Server
1. Go to **"OAuth2"** → **"URL Generator"**
2. Select scopes: **"bot"**
3. Select permissions: 
   - **Send Messages**
   - **Read Message History** 
   - **Manage Messages**
   - **Use External Emojis**
   - **Use Slash Commands**
4. Copy the generated URL and open it in browser
5. Select your Discord server and authorize

### 3. Create Discord Webhook & Get Channel ID

1. Go to your Discord server
2. Right-click the channel where you want emails
3. Select **"Edit Channel"** → **"Integrations"** → **"Webhooks"**
4. Click **"New Webhook"**
5. Copy the webhook URL (save for later)
6. **Enable Developer Mode** in Discord: User Settings → Advanced → Developer Mode
7. **Right-click the same channel** → **"Copy Channel ID"** (save for later)

### 4. Setup Zoho API Application

#### 4.1 Create Zoho API Client
1. Go to https://api-console.zoho.com/
2. Click **"Add Client"**
3. Choose **"Server-based Applications"**
4. Fill out the form:
   - **Client Name**: `Zoho Discord Integration`
   - **Homepage URL**: `https://your-domain.com` (your deployment URL)
   - **Authorized Redirect URIs**: `https://your-domain.com/oauth/callback`
5. Click **"Create"**
6. Copy **Client ID** and **Client Secret** (save for later)

#### 4.2 Find Your Zoho Account ID
After OAuth setup, you'll use a helper script to get this automatically.

### 5. Deploy the Application

#### 5.1 Environment Variables
Set these environment variables in your deployment platform:

```env
# Discord Configuration (Required)
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_CHANNEL_ID=your_discord_channel_id

# Zoho Configuration (Required)
ZOHO_CLIENT_ID=your_zoho_client_id
ZOHO_CLIENT_SECRET=your_zoho_client_secret
ZOHO_REFRESH_TOKEN=will_be_generated_during_oauth
ZOHO_ACCOUNT_ID=will_be_generated_during_oauth

# Application Configuration (Optional)
BASE_URL=https://your-deployed-domain.com
PORT=3000
DATABASE_PATH=./data/email_mapping.db

# Fallback Configuration (Optional)
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/YOUR_WEBHOOK_URL
DISCORD_CLIENT_ID=your_discord_application_id
```

#### 5.2 Deployment Options

**Option A: Coolify (Recommended)**
1. Connect your Git repository
2. Set Builder Pack to **"Dockerfile"**
3. Add environment variables
4. Deploy

**Option B: Heroku**
```bash
heroku create your-app-name
heroku config:set DISCORD_WEBHOOK_URL=your_webhook_url
# ... set other env vars
git push heroku main
```

**Option C: Railway**
1. Connect GitHub repository
2. Add environment variables in dashboard
3. Deploy automatically

### 6. Complete OAuth Setup

#### 6.1 Get Zoho Refresh Token
1. **Visit**: `https://your-domain.com/oauth/start`
2. **Click the authorization link**
3. **Authorize your Zoho account**
4. **Copy the refresh token** from the success page
5. **Add `ZOHO_REFRESH_TOKEN`** to your environment variables
6. **Redeploy** the application

#### 6.2 Get Zoho Account ID
1. **Clone the repository locally**
2. **Create `.env` file** with your credentials
3. **Run**: `node get-account-id.js`
4. **Copy the Account ID** from the output
5. **Add `ZOHO_ACCOUNT_ID`** to your environment variables
6. **Redeploy** the application

### 7. Configure Zoho Mail Webhooks

#### 7.1 Setup Email Forwarding
1. **Go to Zoho Mail** → **Settings** → **Integrations** → **Developer Space**
2. **Select "Outgoing Webhooks"**
3. **Click "Add new configuration"**
4. **Configure:**
   - **Custom Username**: `discord-integration`
   - **Webhook URL**: `https://your-domain.com/webhook/zoho`
   - **Entity**: Select **"Mail"**
   - **Conditions**: Set as needed (or leave empty for all emails)
5. **Save configuration**

#### 7.2 Alternative: Email Filters
If webhooks aren't available:
1. **Go to Settings** → **Filters and Blocking** → **Filters**
2. **Create new filter**
3. **Set action** to forward to your webhook URL

## Usage

### Receiving Emails
When an email arrives in Zoho:
1. **Discord notification** appears with email details
2. **Interactive buttons** show: "Mark as Read" and "Reply"
3. **Rich formatting** displays sender, subject, and content

### Mark as Read
1. **Click "✅ Mark as Read"** button in Discord
2. **Email is marked as read** in Zoho Mail
3. **Discord message updates** to show completion

### Reply to Emails
1. **Click "💬 Reply"** button in Discord
2. **Modal popup** appears for composing reply
3. **Type your response** and submit
4. **Reply is sent** via Zoho Mail API

## API Endpoints

- `POST /webhook/zoho` - Receives email webhooks from Zoho
- `GET /health` - Health check endpoint
- `GET /oauth/start` - Begin Zoho OAuth authorization
- `GET /oauth/callback` - Handle OAuth callback
- `GET /get-account-id` - Retrieve Zoho Account ID

## File Structure

```
zoho-discord/
├── index.js                 # Main application server
├── package.json            # Dependencies and scripts
├── Dockerfile              # Container configuration
├── .env.example            # Environment variables template
├── get-account-id.js       # Helper script for Account ID
├── ZOHO_PAYLOAD_REFERENCE.md # Webhook payload documentation
├── ENHANCEMENT_PLAN.md     # Development roadmap
└── README.md              # This file
```

## Troubleshooting

### Common Issues

**1. "Missing dependencies" error during deployment**
- Ensure `package-lock.json` is committed to repository
- Try deleting `node_modules` and running `npm install`

**2. "Invalid OAuth scope" error**
- Re-run OAuth flow with broader scopes
- Check that Zoho API application has correct redirect URI

**3. Discord bot not responding or buttons not appearing**
- Verify bot token is correct
- Ensure bot has **Manage Messages** permission (required for interactive buttons)
- Ensure bot has **Use External Emojis** permission  
- Check bot is invited to correct server
- Look for "✅ Added interactive buttons to Discord message" in logs

**4. Emails not appearing in Discord**
- Verify Zoho webhook URL is correct
- Check webhook configuration in Zoho Mail
- Test webhook endpoint with `/health` check

**5. "Account ID not found" error**
- Run `node get-account-id.js` to get correct Account ID
- Ensure OAuth has `ZohoMail.accounts.READ` scope

### Debug Endpoints

**Check application status:**
```bash
curl https://your-domain.com/health
```

**Test OAuth configuration:**
```bash
curl https://your-domain.com/oauth/start
```

**Get Account ID:**
```bash
curl https://your-domain.com/get-account-id
```

### Environment Variables Reference

| Variable | Required | Description | Example |
|----------|----------|-------------|---------|
| `DISCORD_BOT_TOKEN` | ✅ | Discord bot authentication token | `MTk4N...` |
| `DISCORD_CHANNEL_ID` | ✅ | Discord channel ID for bot messages | `1234567890123456789` |
| `ZOHO_CLIENT_ID` | ✅ | Zoho API client identifier | `1000.ABC123` |
| `ZOHO_CLIENT_SECRET` | ✅ | Zoho API client secret | `def456ghi789` |
| `ZOHO_REFRESH_TOKEN` | ✅ | OAuth refresh token from authorization | `1000.jkl012...` |
| `ZOHO_ACCOUNT_ID` | ✅ | Your Zoho Mail account identifier | `987654321` |
| `BASE_URL` | ⚠️ | Your deployment URL (for OAuth) | `https://yourdomain.com` |
| `PORT` | ❌ | Server port (default: 3000) | `3000` |
| `DATABASE_PATH` | ❌ | SQLite database location | `./data/email_mapping.db` |
| `DISCORD_WEBHOOK_URL` | ❌ | Fallback webhook for posting messages | `https://discord.com/api/webhooks/...` |
| `DISCORD_CLIENT_ID` | ❌ | Discord application ID (fallback only) | `123456789` |

✅ Required | ⚠️ Required for OAuth | ❌ Optional

## Security Considerations

- **Never commit `.env` files** to version control
- **Use HTTPS** for production deployments
- **Regularly rotate** OAuth tokens
- **Monitor** application logs for suspicious activity
- **Validate** all incoming webhook data

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Support

- **Issues**: Report bugs and request features via [GitHub Issues](https://github.com/yourusername/zoho-discord/issues)
- **Documentation**: Additional docs in `/docs` folder
- **Examples**: Sample configurations in `/examples` folder

---

**Made with ❤️ for seamless email management in Discord**