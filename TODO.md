# Project TODOs

## Current Session Progress
- [x] Research Zoho Mail API capabilities for email management
- [ ] Set up Discord bot with slash commands
- [ ] Implement Zoho API authentication
- [ ] Add mark as read functionality
- [ ] Add reply to email functionality
- [ ] Add email management buttons to Discord messages
- [ ] Store message mapping between Discord and Zoho
- [ ] Test full bidirectional integration

## Next Session Priority Tasks

### High Priority
1. **Discord Bot Setup**
   - Create Discord application at https://discord.com/developers/applications
   - Generate bot token and add to server
   - Install discord.js dependency
   - Create basic bot structure with slash commands

2. **Zoho OAuth Setup**
   - Register app at https://api-console.zoho.com/
   - Get client ID and secret
   - Implement OAuth flow for access tokens
   - Get account ID for API calls

3. **Message Mapping Database**
   - Set up SQLite database
   - Create table for Discord ↔ Zoho message relationships
   - Implement CRUD operations

### Medium Priority
4. **Mark as Read Feature**
   - Add "Mark as Read" button to Discord messages
   - Implement API call to Zoho
   - Update message appearance when marked as read

5. **Reply Feature**
   - Add "Reply" button to Discord messages
   - Create Discord modal for reply composition
   - Implement API call to send reply via Zoho

### Low Priority
6. **Enhanced Features**
   - Forward emails
   - Compose new emails via slash command
   - Email threading and conversation tracking
   - Advanced formatting and attachments

## API Endpoints Researched
- **Mark as Read**: `PUT https://mail.zoho.com/api/accounts/{accountId}/updatemessage`
- **Reply**: `POST https://mail.zoho.com/api/accounts/{accountId}/messages/{messageId}`
- **Send Email**: `POST https://mail.zoho.com/api/accounts/{accountId}/messages`

## Required OAuth Scopes
- `ZohoMail.messages.ALL` - Full email management
- `ZohoMail.messages.CREATE` - Send/reply emails
- `ZohoMail.messages.UPDATE` - Mark read/unread

## Architecture Notes
- Keep existing webhook functionality
- Add Discord bot as separate component
- Use SQLite for message mapping
- Implement proper error handling and logging