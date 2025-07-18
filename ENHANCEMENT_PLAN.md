# Zoho-Discord Enhancement Plan

## Current Status
✅ **COMPLETED**: Basic integration working
- Zoho emails appear in Discord channel
- Email content properly parsed and displayed
- Webhook payload structure documented

## Next Phase: Full Email Management from Discord

### Goal
Turn Discord channel into a complete email client with bidirectional functionality.

### Key Features to Implement

#### 1. Discord Bot Setup
- **Create Discord Application** with bot permissions
- **Add bot to server** with necessary permissions
- **Implement slash commands** for email actions
- **Add interactive buttons** to email notifications

#### 2. Zoho API Integration
- **OAuth 2.0 Authentication** setup
- **Account ID retrieval** for API calls
- **API endpoints integration**:
  - Mark as read: `PUT /accounts/{accountId}/updatemessage`
  - Reply to email: `POST /accounts/{accountId}/messages/{messageId}`
  - Send new email: `POST /accounts/{accountId}/messages`

#### 3. Message Mapping System
- **Store Discord message ID ↔ Zoho message ID** relationships
- **Track email threads** and conversation context
- **Maintain email metadata** (sender, subject, timestamps)

#### 4. Interactive Discord Features
- **Action buttons** on each email notification:
  - 🔴 Mark as Read
  - 💬 Reply
  - 📧 Forward
- **Slash commands**:
  - `/send-email` - Compose new email
  - `/mark-read` - Mark specific email as read
  - `/reply` - Reply to specific email

### Technical Architecture

```
Zoho Mail ←→ Express Server ←→ Discord Bot
    ↓              ↓              ↓
Webhook       API Calls      Interactions
Incoming      Outgoing       User Actions
```

### Required Dependencies
- `discord.js` - Discord bot framework
- `sqlite3` - Local database for message mapping
- `axios` - HTTP requests to Zoho API
- `dotenv` - Environment variable management

### Environment Variables Needed
```
DISCORD_WEBHOOK_URL=existing
DISCORD_BOT_TOKEN=new
ZOHO_CLIENT_ID=new
ZOHO_CLIENT_SECRET=new
ZOHO_REFRESH_TOKEN=new
ZOHO_ACCOUNT_ID=new
```

### API Scopes Required
- `ZohoMail.messages.ALL` - Full email management
- `ZohoMail.messages.CREATE` - Send/reply to emails
- `ZohoMail.messages.UPDATE` - Mark as read/unread

### Implementation Priority
1. **High**: Discord bot setup + OAuth flow
2. **High**: Mark as read functionality
3. **Medium**: Reply functionality
4. **Medium**: Interactive buttons
5. **Low**: Advanced features (forward, compose)

### Testing Plan
1. **Unit tests** for API integrations
2. **Integration tests** for Discord ↔ Zoho flow
3. **End-to-end tests** for complete user workflows
4. **Error handling** for API failures and Discord issues

### Security Considerations
- **OAuth token refresh** handling
- **Rate limiting** for API calls
- **Input validation** for user commands
- **Error logging** without exposing sensitive data

---

## Files Modified This Session
- `index.js` - Added debugging and proper field parsing
- `ZOHO_PAYLOAD_REFERENCE.md` - Documented webhook structure
- `ENHANCEMENT_PLAN.md` - This planning document