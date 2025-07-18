# Zoho Mail Webhook Payload Reference

## Field Structure

When Zoho Mail sends a webhook, it includes the following fields:

```javascript
{
  "summary": "Body",                    // Plain text summary of email content
  "sentDateInGMT": 1752897981000,      // Unix timestamp of when email was sent
  "subject": "Subject",                 // Email subject line
  "Mode": 0,                           // Unknown field (possibly email mode/type)
  "messageId": 1752872797290124300,    // Numeric message ID
  "toAddress": "<login@trstudios.ca>", // Recipient email address
  "folderId": 401862000000008000,      // Zoho folder ID where email is stored
  "zuid": 860646111,                   // Zoho user ID
  "size": 14177,                       // Email size in bytes
  "sender": "Chris Parker",            // Sender's display name
  "receivedTime": 1752872797277,       // Unix timestamp of when email was received
  "fromAddress": "christmas1923@gmail.com", // Sender's email address
  "html": "<div><div dir=\"ltr\">Body</div>\r\n</div>", // HTML content of email
  "messageIdString": "1752872797290124400", // String version of message ID
  "IntegIdList": "1752872434238132300," // Integration ID list (comma-separated)
}
```

## Key Fields for Integration

- **`html`** - Email content in HTML format (primary content source)
- **`summary`** - Plain text summary (fallback for content)
- **`subject`** - Email subject line
- **`sender`** - Sender's display name
- **`fromAddress`** - Sender's email address
- **`toAddress`** - Recipient email address
- **`receivedTime`** - When email was received (Unix timestamp)
- **`sentDateInGMT`** - When email was sent (Unix timestamp)

## Usage Notes

1. **Content Priority**: Use `html` first, then `summary` as fallback
2. **HTML Cleaning**: Strip HTML tags from `html` field for Discord display
3. **Timestamps**: Convert Unix timestamps to readable dates if needed
4. **Sender Info**: Combine `sender` name with `fromAddress` for complete sender info

## Example Processing

```javascript
const emailContent = emailData.html || emailData.summary || 'No content available';
const cleanContent = emailContent.replace(/<[^>]*>/g, '').trim();
const senderInfo = `${emailData.sender} (${emailData.fromAddress})`;
```