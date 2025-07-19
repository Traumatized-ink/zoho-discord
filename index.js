require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Discord bot
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Initialize SQLite database
const db = new sqlite3.Database(path.join(__dirname, 'email_mapping.db'));

// Create table for email mappings
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS email_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_message_id TEXT UNIQUE,
    zoho_message_id TEXT,
    zoho_account_id TEXT,
    sender_email TEXT,
    subject TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.use(express.json());

// Zoho API helper functions
async function getZohoAccessToken() {
  try {
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    return response.data.access_token;
  } catch (error) {
    console.error('Error getting Zoho access token:', error);
    throw error;
  }
}

async function markEmailAsRead(messageId) {
  try {
    const accessToken = await getZohoAccessToken();
    const response = await axios.put(
      `https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/updatemessage`,
      {
        mode: 'markAsRead',
        messageId: [parseInt(messageId)]
      },
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error marking email as read:', error);
    throw error;
  }
}

async function replyToEmail(messageId, fromAddress, toAddress, subject, content) {
  try {
    const accessToken = await getZohoAccessToken();
    const response = await axios.post(
      `https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/messages/${messageId}`,
      {
        fromAddress,
        toAddress,
        action: 'Reply',
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        content
      },
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error replying to email:', error);
    throw error;
  }
}

// Discord bot event handlers
client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user.tag}!`);
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isButton()) return;

  const [action, zohoMessageId] = interaction.customId.split('_');

  try {
    if (action === 'markread') {
      await markEmailAsRead(zohoMessageId);
      
      // Update the Discord message to show it's been marked as read
      const embed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x00ff00)
        .setFooter({ text: '✅ Marked as read' });
      
      await interaction.update({
        embeds: [embed],
        components: [] // Remove buttons
      });

    } else if (action === 'reply') {
      // Show modal for reply
      const modal = {
        title: 'Reply to Email',
        custom_id: `reply_modal_${zohoMessageId}`,
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                custom_id: 'reply_content',
                label: 'Your Reply',
                style: 2,
                placeholder: 'Type your reply here...',
                required: true,
                max_length: 2000
              }
            ]
          }
        ]
      };
      
      await interaction.showModal(modal);
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    await interaction.reply({
      content: 'An error occurred while processing your request.',
      ephemeral: true
    });
  }
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;

  const [, , zohoMessageId] = interaction.customId.split('_');
  const replyContent = interaction.fields.getTextInputValue('reply_content');

  try {
    // Get email details from database
    const emailData = await new Promise((resolve, reject) => {
      db.get(
        'SELECT * FROM email_mappings WHERE zoho_message_id = ?',
        [zohoMessageId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    if (emailData) {
      await replyToEmail(
        zohoMessageId,
        process.env.ZOHO_FROM_ADDRESS || emailData.toAddress, // You'll need to set this
        emailData.sender_email,
        emailData.subject,
        replyContent
      );

      await interaction.reply({
        content: '✅ Reply sent successfully!',
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ Could not find email data to reply to.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error sending reply:', error);
    await interaction.reply({
      content: '❌ Error sending reply.',
      ephemeral: true
    });
  }
});

// Enhanced webhook endpoint
app.post('/webhook/zoho', async (req, res) => {
  try {
    const emailData = req.body;
    
    console.log('=== ZOHO WEBHOOK DEBUG ===');
    console.log('Field names:', Object.keys(emailData));
    console.log('Full payload:', JSON.stringify(emailData, null, 2));
    console.log('=== END DEBUG ===');
    
    const emailContent = emailData.html || emailData.summary || 'No content available';
    const cleanContent = emailContent.replace(/<[^>]*>/g, '').trim();
    
    // Create embed with email details
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('📧 New Email Received')
      .addFields(
        { name: 'From', value: `${emailData.sender} (${emailData.fromAddress})`, inline: false },
        { name: 'Subject', value: emailData.subject, inline: false },
        { name: 'Content', value: cleanContent.length > 1000 ? cleanContent.substring(0, 1000) + '...' : cleanContent, inline: false }
      )
      .setTimestamp();

    // Create action buttons
    const row = new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(`markread_${emailData.messageId}`)
          .setLabel('Mark as Read')
          .setStyle(ButtonStyle.Success)
          .setEmoji('✅'),
        new ButtonBuilder()
          .setCustomId(`reply_${emailData.messageId}`)
          .setLabel('Reply')
          .setStyle(ButtonStyle.Primary)
          .setEmoji('💬')
      );

    // Send to Discord using webhook (with embeds and components)
    const webhookResponse = await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [embed.toJSON()],
      components: [row.toJSON()]
    });

    // Store mapping in database
    const discordMessageId = webhookResponse.data?.id;
    if (discordMessageId) {
      db.run(
        'INSERT INTO email_mappings (discord_message_id, zoho_message_id, zoho_account_id, sender_email, subject) VALUES (?, ?, ?, ?, ?)',
        [discordMessageId, emailData.messageId.toString(), process.env.ZOHO_ACCOUNT_ID, emailData.fromAddress, emailData.subject]
      );
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error forwarding email to Discord:', error);
    res.status(500).json({ error: 'Failed to forward email' });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Helper function to get base URL
function getBaseUrl(req) {
  // Try env variable first, then detect from request
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }
  
  // Auto-detect from request headers
  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${protocol}://${host}`;
}

// OAuth setup routes
app.get('/oauth/start', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const redirectUri = `${baseUrl}/oauth/callback`;
  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=ZohoMail.messages.ALL&client_id=${process.env.ZOHO_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&access_type=offline`;
  
  console.log('OAuth Start - Base URL:', baseUrl);
  console.log('OAuth Start - Redirect URI:', redirectUri);
  
  res.send(`
    <h1>Zoho OAuth Setup</h1>
    <p><strong>Redirect URI:</strong> ${redirectUri}</p>
    <p><em>Make sure this matches your Zoho API console settings!</em></p>
    <p><a href="${authUrl}" target="_blank">Click here to authorize your Zoho account</a></p>
    <p>After authorization, you'll be redirected back here automatically.</p>
  `);
});

app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.send('<h1>Error: No authorization code received</h1>');
  }
  
  try {
    const baseUrl = getBaseUrl(req);
    const redirectUri = `${baseUrl}/oauth/callback`;
    
    console.log('OAuth Callback - Base URL:', baseUrl);
    console.log('OAuth Callback - Redirect URI:', redirectUri);
    
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code: code
      }
    });
    
    const { refresh_token } = response.data;
    
    console.log('✅ OAuth Success! Refresh token generated');
    
    res.send(`
      <h1>✅ OAuth Setup Complete!</h1>
      <h2>Add this to your .env file in Coolify:</h2>
      <pre>ZOHO_REFRESH_TOKEN=${refresh_token}</pre>
      <p><strong>Base URL detected:</strong> ${baseUrl}</p>
    `);
    
  } catch (error) {
    console.error('Error getting tokens:', error.response?.data || error.message);
    res.send(`<h1>❌ Error getting tokens</h1><pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>`);
  }
});

// Start the bot and server
if (process.env.DISCORD_BOT_TOKEN) {
  client.login(process.env.DISCORD_BOT_TOKEN);
} else {
  console.log('Discord bot token not provided, running webhook-only mode');
}

app.listen(PORT, () => {
  console.log(`Zoho-Discord integration server running on port ${PORT}`);
});