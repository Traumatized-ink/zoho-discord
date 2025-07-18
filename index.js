require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.post('/webhook/zoho', async (req, res) => {
  try {
    const emailData = req.body;
    
    console.log('=== ZOHO WEBHOOK DEBUG ===');
    console.log('Field names:', Object.keys(emailData));
    console.log('Full payload:', JSON.stringify(emailData, null, 2));
    console.log('=== END DEBUG ===');
    
    const discordMessage = {
      content: `📧 **New Email Received**\n\n**From:** ${emailData.fromAddress}\n**Subject:** ${emailData.subject}\n**Content:** ${emailData.content || 'No content available'}`
    };

    await axios.post(process.env.DISCORD_WEBHOOK_URL, discordMessage);
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error forwarding email to Discord:', error);
    res.status(500).json({ error: 'Failed to forward email' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.listen(PORT, () => {
  console.log(`Zoho-Discord integration server running on port ${PORT}`);
});