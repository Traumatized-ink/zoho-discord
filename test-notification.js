// Sends a fake Zoho webhook payload to the bot so you can check the Discord notification.
// Usage: node test-notification.js [baseUrl]   (falls back to BASE_URL, then localhost)
// Note: the Mark as Read / Reply buttons won't work on the test message (fake messageId).
try { require('dotenv').config(); } catch (_) {}

const baseUrl = (process.argv[2] || process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const url = `${baseUrl}/webhook/zoho`;

const payload = {
  messageId: `test-${Date.now()}`,
  sender: 'Test Sender',
  fromAddress: 'test@example.com',
  toAddress: 'test-recipient@example.com',
  subject: `Push preview test (${new Date().toLocaleTimeString()}) - please ignore`,
  summary: 'This is a fake email sent by test-notification.js to check the Discord notification.',
  Mode: 0
};

(async () => {
  console.log(`📧 Sending test email to ${url}`);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.text();
    if (!res.ok) {
      console.error(`❌ ${res.status} ${res.statusText}: ${body}`);
      process.exit(1);
    }
    // Proxies/DNS filters can answer 200 with an HTML page, so require the bot's JSON reply
    let json;
    try { json = JSON.parse(body); } catch (_) {}
    if (!json?.success) {
      console.error(`❌ Unexpected response (request may not have reached the bot): ${body.substring(0, 200)}`);
      process.exit(1);
    }
    console.log(`✅ ${res.status}: ${body} - check Discord`);
  } catch (error) {
    console.error('❌ Request failed:', error.message);
    process.exit(1);
  }
})();
