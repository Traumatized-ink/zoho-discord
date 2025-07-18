# Claude Context for Zoho-Discord Integration

## Project Overview
This is a Zoho Mail to Discord integration that allows email management through Discord channels.

## Current State
- **Basic integration working**: Emails from Zoho appear in Discord channel
- **Webhook structure documented**: Complete payload reference available
- **Server deployed**: Running on Coolify at `http://uko848o4k8ss4o8o8k0gsoss.178.156.163.130.sslip.io`

## Key Files
- `index.js` - Main Express server with webhook endpoint
- `ZOHO_PAYLOAD_REFERENCE.md` - Complete webhook payload structure
- `ENHANCEMENT_PLAN.md` - Detailed plan for bidirectional features
- `TODO.md` - Task tracking for next sessions

## Environment Setup
- **Node.js project** with Express, axios, dotenv
- **Discord webhook** configured and working
- **Zoho webhook** configured and working
- **Deployed on Coolify** with public URL

## Next Development Phase
Planning to add full email management from Discord:
- Discord bot with interactive buttons
- Mark emails as read from Discord
- Reply to emails from Discord
- Full bidirectional email management

## Technical Details
- **Zoho webhook endpoint**: `/webhook/zoho` 
- **Health check endpoint**: `/health`
- **Debug logging**: Added to understand payload structure
- **HTML content parsing**: Strips HTML tags for Discord display

## API Research Completed
- Zoho Mail API capabilities documented
- OAuth 2.0 authentication process understood
- Required scopes and endpoints identified
- Message mapping strategy planned

## Testing
- Email forwarding working correctly
- Content parsing fixed (was showing "No content available")
- Sender information displaying properly
- HTML tags being stripped from email content

This project is ready for the next development phase to add Discord bot functionality and bidirectional email management.