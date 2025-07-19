require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Discord bot
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

// Initialize SQLite database
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'data', 'email_mapping.db');
const db = new sqlite3.Database(dbPath);

// Create tables
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
  
  db.run(`CREATE TABLE IF NOT EXISTS from_addresses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email_address TEXT UNIQUE,
    display_name TEXT,
    is_primary BOOLEAN DEFAULT 0,
    is_alias BOOLEAN DEFAULT 0,
    send_mail_id TEXT,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

app.use(express.json());

// From address management functions
async function updateFromAddresses() {
  try {
    const accessToken = await getZohoAccessToken();
    const response = await axios.get('https://mail.zoho.com/api/accounts', {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    const accountData = response.data.data[0];
    if (!accountData) return;

    console.log(`Found ${accountData.emailAddress.length} email addresses`);
    console.log(`Found ${accountData.sendMailDetails.length} send mail details`);

    // Clear existing addresses
    await new Promise((resolve, reject) => {
      db.run('DELETE FROM from_addresses', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    // Insert email addresses with proper async handling
    for (const email of accountData.emailAddress) {
      await new Promise((resolve, reject) => {
        db.run(
          'INSERT INTO from_addresses (email_address, display_name, is_primary, is_alias) VALUES (?, ?, ?, ?)',
          [email.mailId, accountData.displayName, email.isPrimary, email.isAlias],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    // Update with send mail details
    for (const sendMail of accountData.sendMailDetails) {
      await new Promise((resolve, reject) => {
        db.run(
          'UPDATE from_addresses SET display_name = ?, send_mail_id = ? WHERE email_address = ?',
          [sendMail.displayName, sendMail.sendMailId, sendMail.fromAddress],
          (err) => {
            if (err) reject(err);
            else resolve();
          }
        );
      });
    }

    console.log('✅ Updated from addresses in database');
  } catch (error) {
    console.error('Error updating from addresses:', error);
  }
}

async function getFromAddresses() {
  return new Promise((resolve, reject) => {
    db.all('SELECT * FROM from_addresses ORDER BY is_primary DESC, email_address ASC', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function smartSelectFromAddress(toAddress) {
  const addresses = await getFromAddresses();
  
  // Try to match domain
  if (toAddress) {
    const toDomain = toAddress.split('@')[1];
    const domainMatch = addresses.find(addr => addr.email_address.includes(toDomain));
    if (domainMatch) return domainMatch.email_address;
  }
  
  // Fallback to primary address
  const primary = addresses.find(addr => addr.is_primary);
  return primary ? primary.email_address : addresses[0]?.email_address;
}

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
client.once('ready', async () => {
  console.log(`Discord bot logged in as ${client.user.tag}!`);
  
  // Update from addresses on startup
  if (process.env.ZOHO_REFRESH_TOKEN) {
    await updateFromAddresses();
    
    // Set up daily refresh (every 24 hours)
    setInterval(async () => {
      console.log('🔄 Daily refresh: Updating from addresses...');
      try {
        await updateFromAddresses();
        console.log('✅ Daily refresh completed');
      } catch (error) {
        console.error('❌ Daily refresh failed:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours in milliseconds
    
    console.log('📅 Daily refresh scheduled (every 24 hours)');
  }
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
      // Get available from addresses
      const fromAddresses = await getFromAddresses();
      
      // Get email details to suggest smart default
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

      const smartDefault = await smartSelectFromAddress(emailData?.sender_email);
      const defaultAddress = fromAddresses.find(addr => addr.email_address === smartDefault);

      // Create dropdown for selecting from address (as a message response)
      const fromOptions = fromAddresses.slice(0, 25).map(addr => ({
        label: `${addr.display_name} <${addr.email_address}>`,
        value: addr.email_address,
        default: addr.email_address === smartDefault
      }));

      const selectRow = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(`replyquick_${zohoMessageId}`)
            .setLabel(`Quick Reply (${defaultAddress?.display_name})`)
            .setStyle(ButtonStyle.Primary)
            .setEmoji('⚡'),
          new ButtonBuilder()
            .setCustomId(`replychoose_${zohoMessageId}`)
            .setLabel('Choose From Address')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('📧')
        );

      await interaction.reply({
        content: `**Reply Options:**\n📧 **Quick Reply** will use: **${defaultAddress?.display_name}** <${smartDefault}>\n📧 **Choose From Address** to select a different email address`,
        components: [selectRow],
        ephemeral: true
      });
    } else if (action === 'replyquick') {
      // Quick reply with smart default
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

      const smartDefault = await smartSelectFromAddress(emailData?.sender_email);

      const modal = {
        title: 'Quick Reply',
        custom_id: `quickreply_modal_${zohoMessageId}_${smartDefault}`,
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
    } else if (action === 'replychoose') {
      // Show address selection dropdown
      const fromAddresses = await getFromAddresses();
      
      const fromOptions = fromAddresses.slice(0, 25).map(addr => ({
        label: `${addr.display_name} <${addr.email_address}>`,
        value: addr.email_address
      }));

      const selectMenu = new ActionRowBuilder()
        .addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`selectfrom_${zohoMessageId}`)
            .setPlaceholder('Choose email address to reply from')
            .addOptions(fromOptions)
        );

      await interaction.update({
        content: '📧 **Choose which email address to reply from:**',
        components: [selectMenu]
      });
    }
  } catch (error) {
    console.error('Error handling interaction:', error);
    await interaction.reply({
      content: 'An error occurred while processing your request.',
      ephemeral: true
    });
  }
});

// Handle select menu interactions
client.on('interactionCreate', async interaction => {
  if (!interaction.isStringSelectMenu()) return;

  const [action, zohoMessageId] = interaction.customId.split('_');

  if (action === 'selectfrom') {
    const selectedFromAddress = interaction.values[0];
    
    const modal = {
      title: 'Reply to Email',
      custom_id: `customreply_modal_${zohoMessageId}_${selectedFromAddress}`,
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
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isModalSubmit()) return;

  const modalParts = interaction.customId.split('_');
  const modalType = modalParts[0]; // 'quickreply' or 'customreply'
  const zohoMessageId = modalParts[2];
  const fromAddress = modalParts[3];
  
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
        fromAddress, // Use selected from address
        emailData.sender_email,
        emailData.subject,
        replyContent
      );

      // Get display name for the selected from address
      const fromAddressData = await new Promise((resolve, reject) => {
        db.get(
          'SELECT display_name FROM from_addresses WHERE email_address = ?',
          [fromAddress],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });

      const displayName = fromAddressData?.display_name || 'Unknown';

      await interaction.reply({
        content: `✅ Reply sent successfully from **${displayName}** <${fromAddress}>!`,
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

    // Send initial message via webhook (embeds only, no buttons yet)
    console.log('📤 Sending message to Discord webhook...');
    await axios.post(process.env.DISCORD_WEBHOOK_URL, {
      embeds: [embed.toJSON()]
    });

    console.log('✅ Message sent to Discord via webhook');

    // Store mapping and add buttons using Discord bot
    // We'll find the message by looking for recent messages
    if (client.user) {
      console.log('🔧 Bot will add buttons to the latest message...');
      
      // Give Discord a moment to process the webhook
      setTimeout(async () => {
        try {
          const webhookUrl = new URL(process.env.DISCORD_WEBHOOK_URL);
          // Discord webhook URL format: https://discord.com/api/webhooks/WEBHOOK_ID/WEBHOOK_TOKEN
          // We need to extract channel ID differently - let's get it from the webhook info
          const webhookPathParts = webhookUrl.pathname.split('/');
          const webhookId = webhookPathParts[3]; // webhooks/WEBHOOK_ID/token
          
          console.log('🔗 Webhook ID:', webhookId);
          
          // Get webhook info to find the channel ID
          const webhookInfo = await axios.get(`https://discord.com/api/webhooks/${webhookId}`, {
            headers: {
              'Authorization': `Bot ${process.env.DISCORD_BOT_TOKEN}`
            }
          });
          
          const channelId = webhookInfo.data.channel_id;
          console.log('📍 Extracted channel ID:', channelId);
          
          const channel = await client.channels.fetch(channelId);
          console.log('📢 Fetched channel:', channel.name);
          
          // Get recent messages and find the one that matches our email
          const messages = await channel.messages.fetch({ limit: 5 });
          const recentMessage = messages.find(msg => 
            msg.embeds.length > 0 && 
            msg.embeds[0].title === '📧 New Email Received' &&
            msg.embeds[0].fields.find(field => field.name === 'Subject' && field.value === emailData.subject)
          );
          
          if (recentMessage) {
            console.log('💬 Found matching message:', recentMessage.id);
            
            // Store mapping in database
            db.run(
              'INSERT INTO email_mappings (discord_message_id, zoho_message_id, zoho_account_id, sender_email, subject) VALUES (?, ?, ?, ?, ?)',
              [recentMessage.id, emailData.messageId.toString(), process.env.ZOHO_ACCOUNT_ID, emailData.fromAddress, emailData.subject]
            );
            
            // Add buttons to the message
            await recentMessage.edit({
              embeds: recentMessage.embeds,
              components: [row.toJSON()]
            });
            
            console.log('✅ Added interactive buttons to Discord message');
          } else {
            console.log('❌ Could not find matching Discord message');
          }
        } catch (error) {
          console.error('❌ Error adding buttons to message:', error.message);
        }
      }, 1000); // Wait 1 second for Discord to process the webhook
    } else {
      console.log('❌ Discord bot not ready - buttons cannot be added');
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

// Route to refresh and view from addresses
app.get('/from-addresses', async (req, res) => {
  try {
    await updateFromAddresses();
    const addresses = await getFromAddresses();
    
    res.json({
      message: 'From addresses updated successfully',
      count: addresses.length,
      addresses: addresses.map(addr => ({
        email: addr.email_address,
        displayName: addr.display_name,
        isPrimary: !!addr.is_primary,
        isAlias: !!addr.is_alias
      }))
    });
  } catch (error) {
    console.error('Error managing from addresses:', error);
    res.json({ error: error.message });
  }
});

// Helper route to get Zoho Account ID
app.get('/get-account-id', async (req, res) => {
  try {
    if (!process.env.ZOHO_REFRESH_TOKEN) {
      return res.json({ error: 'ZOHO_REFRESH_TOKEN not set' });
    }

    const accessToken = await getZohoAccessToken();
    const response = await axios.get('https://mail.zoho.com/api/accounts', {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    const accounts = response.data.data || [];
    
    res.json({
      accounts: accounts,
      accountId: accounts[0]?.accountId,
      message: accounts[0] ? `Add this to Coolify: ZOHO_ACCOUNT_ID=${accounts[0].accountId}` : 'No accounts found'
    });

  } catch (error) {
    console.error('Error getting account ID:', error.response?.data || error.message);
    res.json({ error: error.response?.data || error.message });
  }
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
  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=ZohoMail.messages.ALL,ZohoMail.accounts.READ&client_id=${process.env.ZOHO_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&access_type=offline`;
  
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