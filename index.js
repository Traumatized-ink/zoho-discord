require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { Client, GatewayIntentBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Prefix all console output with a timestamp down to the minute (local time)
function logTimestamp() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

['log', 'error', 'warn', 'info'].forEach(method => {
  const original = console[method].bind(console);
  console[method] = (...args) => original(`[${logTimestamp()}]`, ...args);
});

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
    recipient_email TEXT,
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

  db.run(`CREATE TABLE IF NOT EXISTS blocked_senders (
    email_address TEXT PRIMARY KEY,
    blocked_by TEXT,
    blocked_count INTEGER DEFAULT 0,
    last_blocked_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

});

// Promise wrappers for sqlite3's callback API
function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

// Blocked sender management
function normalizeEmail(address) {
  return (address || '').replace(/[<>]/g, '').trim().toLowerCase();
}

async function isSenderBlocked(address) {
  return Boolean(await dbGet('SELECT 1 FROM blocked_senders WHERE email_address = ?', [normalizeEmail(address)]));
}

async function blockSender(address, blockedBy) {
  const result = await dbRun(
    'INSERT OR IGNORE INTO blocked_senders (email_address, blocked_by) VALUES (?, ?)',
    [normalizeEmail(address), blockedBy]
  );
  return result.changes > 0;
}

async function unblockSender(address) {
  const result = await dbRun('DELETE FROM blocked_senders WHERE email_address = ?', [normalizeEmail(address)]);
  return result.changes > 0;
}

async function getBlockedSenders() {
  return dbAll('SELECT * FROM blocked_senders ORDER BY email_address ASC');
}

// Zoho IDs are 19 digits, beyond Number.MAX_SAFE_INTEGER, so keep their exact source text
// (context.source needs Node 21+)
function preserveZohoIds(key, value, context) {
  if (typeof value === 'number' && /(message|folder|thread)Id$/i.test(key) && context?.source) {
    return context.source;
  }
  return value;
}

app.use(express.json({ limit: process.env.WEBHOOK_BODY_LIMIT || '10mb', reviver: preserveZohoIds }));
app.use(express.urlencoded({ extended: true, limit: process.env.WEBHOOK_BODY_LIMIT || '10mb' }));

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

    console.log(`📧 Loaded ${accountData.emailAddress.length} email addresses`);

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

    console.log('✅ Email addresses updated');
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
    if (domainMatch) {
      console.log(`📧 Using domain match: ${domainMatch.email_address}`);
      return domainMatch.email_address;
    }
  }
  
  // Fallback to primary address
  const primary = addresses.find(addr => addr.is_primary);
  const selected = primary ? primary.email_address : addresses[0]?.email_address;
  console.log(`📧 Using primary address: ${selected}`);
  return selected;
}

// Token caching to avoid rate limits
let cachedAccessToken = null;
let tokenExpiresAt = null;

// Zoho API helper functions
async function getZohoAccessToken() {
  try {
    // Check if we have a valid cached token
    if (cachedAccessToken && tokenExpiresAt && Date.now() < tokenExpiresAt) {
      return cachedAccessToken;
    }
    
    console.log('🔑 Refreshing access token...');
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });
    
    // Cache the token (expires in 1 hour, cache for 55 minutes to be safe)
    cachedAccessToken = response.data.access_token;
    tokenExpiresAt = Date.now() + (55 * 60 * 1000); // 55 minutes
    
    console.log('✅ Access token refreshed');
    return cachedAccessToken;
  } catch (error) {
    console.error('Error getting Zoho access token:', error);
    throw error;
  }
}

// updatemessage body with the ID digits written verbatim; parseInt/JSON numbers would round them
function updateMessageBody(mode, messageId) {
  const id = String(messageId);
  if (!/^\d+$/.test(id)) throw new Error(`Invalid Zoho message ID: ${id}`);
  return `{"mode":${JSON.stringify(mode)},"messageId":[${id}]}`;
}

// Zoho can answer HTTP 200 with a failure in the body
function assertZohoSuccess(response) {
  const status = response.data?.status;
  if (status && status.code !== 200) {
    throw new Error(`Zoho ${status.code}: ${status.description || 'unknown error'}`);
  }
}

async function markEmailAsRead(messageId) {
  try {
    console.log(`📖 Marking email ${messageId} as read`);
    const accessToken = await getZohoAccessToken();
    
    const response = await axios.put(
      `https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/updatemessage`,
      updateMessageBody('markAsRead', messageId),
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    assertZohoSuccess(response);

    console.log('✅ Email marked as read');
    
    return response.data;
  } catch (error) {
    console.error('❌ Failed to mark email as read:', error.message);
    throw error;
  }
}

// mode is 'moveToSpam' or 'markNotSpam'. Zoho learns from these per mailbox,
// so future mail from the sender goes to this account's Spam folder.
async function setEmailSpam(messageId, mode) {
  console.log(`🚫 ${mode} for email ${messageId}`);
  const accessToken = await getZohoAccessToken();

  const response = await axios.put(
    `https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/updatemessage`,
    updateMessageBody(mode, messageId),
    {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );
  assertZohoSuccess(response);

  console.log(`✅ ${mode} done`);
  return response.data;
}

// Best effort: mark as read and move to Spam. Returns what succeeded.
async function discardEmail(messageId) {
  const outcome = { read: false, spam: false };
  try {
    await markEmailAsRead(messageId);
    outcome.read = true;
  } catch (error) {
    // markEmailAsRead already logged it
  }
  try {
    await setEmailSpam(messageId, 'moveToSpam');
    outcome.spam = true;
  } catch (error) {
    console.error('❌ Failed to move email to spam:', error.response?.data?.status?.description || error.message);
  }
  return outcome;
}

async function replyToEmail(messageId, fromAddress, toAddress, subject, content) {
  try {
    console.log(`💬 Sending reply from ${fromAddress} to ${toAddress}`);
    const accessToken = await getZohoAccessToken();
    
    const testResponse = await axios.post(
      `https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/messages`,
      {
        fromAddress,
        toAddress,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        content: content
      },
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('✅ Reply sent successfully');
    
    return testResponse.data;
    
    // Commented out Reply API for now to test basic sending
    /*
    const response = await axios.post(
      `https://mail.zoho.com/api/accounts/${process.env.ZOHO_ACCOUNT_ID}/messages/${messageId}`,
      requestData,
      {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`✅ Reply response:`, {
      status: response.status,
      data: response.data
    });
    return response.data;
    */
  } catch (error) {
    console.error('❌ Failed to send reply:', error.message);
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

  await registerSlashCommands();
});

const slashCommands = [
  {
    name: 'blocks',
    description: 'List blocked email senders'
  },
  {
    name: 'block',
    description: 'Block an email sender (their mail is marked read and moved to Spam)',
    options: [{ type: 3, name: 'address', description: 'Email address to block', required: true }]
  },
  {
    name: 'unblock',
    description: 'Unblock an email sender',
    options: [{ type: 3, name: 'address', description: 'Email address to unblock', required: true, autocomplete: true }]
  }
];

// Guild commands show up immediately (global ones can take up to an hour)
async function registerSlashCommands() {
  try {
    const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
    await channel.guild.commands.set(slashCommands);
    console.log(`✅ Registered ${slashCommands.length} slash commands in ${channel.guild.name}`);
  } catch (error) {
    console.error('❌ Failed to register slash commands:', error.message);
  }
}

function formatBlockedList(rows) {
  if (rows.length === 0) return '✅ No blocked senders.';

  const lines = rows.map(row => {
    const since = row.created_at ? `<t:${Math.floor(new Date(row.created_at + 'Z').getTime() / 1000)}:d>` : '?';
    const hits = row.blocked_count ? ` · ${row.blocked_count} blocked` : '';
    return `• \`${row.email_address}\` (since ${since}${hits})`;
  });

  let content = `🚫 **Blocked senders (${rows.length}):**\n`;
  // Discord caps messages at 2000 characters
  for (let i = 0; i < lines.length; i++) {
    if (content.length + lines[i].length + 30 > 2000) {
      content += `…and ${lines.length - i} more`;
      break;
    }
    content += lines[i] + '\n';
  }
  return content;
}

// Slash commands and autocomplete
client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== 'unblock') return;
    try {
      const typed = interaction.options.getFocused().toLowerCase();
      const rows = await getBlockedSenders();
      await interaction.respond(
        rows
          .filter(row => row.email_address.includes(typed))
          .slice(0, 25)
          .map(row => ({ name: row.email_address, value: row.email_address }))
      );
    } catch (error) {
      console.error('Error handling autocomplete:', error.message);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  try {
    if (interaction.commandName === 'blocks') {
      const rows = await getBlockedSenders();
      await interaction.reply({ content: formatBlockedList(rows), ephemeral: true });

    } else if (interaction.commandName === 'block') {
      const address = normalizeEmail(interaction.options.getString('address'));
      if (!address.includes('@')) {
        await interaction.reply({ content: `❌ \`${address}\` doesn't look like an email address.`, ephemeral: true });
        return;
      }
      const added = await blockSender(address, interaction.user.tag);
      console.log(`🚫 ${interaction.user.tag} blocked ${address}`);
      await interaction.reply({
        content: added ? `🚫 Blocked \`${address}\`. Their emails will be marked as read and moved to Spam, with no notification.` : `\`${address}\` is already blocked.`,
        ephemeral: true
      });

    } else if (interaction.commandName === 'unblock') {
      const address = normalizeEmail(interaction.options.getString('address'));
      const removed = await unblockSender(address);
      if (removed) console.log(`✅ ${interaction.user.tag} unblocked ${address}`);
      await interaction.reply({
        content: removed ? `✅ Unblocked \`${address}\`.` : `\`${address}\` wasn't blocked.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error handling slash command:', error);
    await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true }).catch(() => {});
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

    } else if (action === 'block' || action === 'unblock') {
      const sender = await getNotificationSender(zohoMessageId, interaction.message);
      if (!sender) {
        await interaction.reply({ content: '❌ Could not work out the sender for this email.', ephemeral: true });
        return;
      }

      // Zoho calls can be slow; acknowledge within Discord's 3 second window
      await interaction.deferUpdate();
      const embed = EmbedBuilder.from(interaction.message.embeds[0]);

      if (action === 'block') {
        await blockSender(sender, interaction.user.tag);
        console.log(`🚫 ${interaction.user.tag} blocked ${sender}`);
        const outcome = await discardEmail(zohoMessageId);

        embed
          .setColor(0xed4245)
          .setFooter({ text: `🚫 Blocked ${sender}${outcome.spam ? ' · moved to Spam' : ''}` });
        const undoRow = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(`unblock_${zohoMessageId}`)
              .setLabel('Unblock Sender')
              .setStyle(ButtonStyle.Secondary)
              .setEmoji('↩️')
          );
        await interaction.editReply({ embeds: [embed], components: [undoRow] });

      } else {
        await unblockSender(sender);
        console.log(`✅ ${interaction.user.tag} unblocked ${sender}`);
        let notSpam = false;
        try {
          await setEmailSpam(zohoMessageId, 'markNotSpam');
          notSpam = true;
        } catch (error) {
          console.error('❌ Failed to mark email as not spam:', error.response?.data?.status?.description || error.message);
        }

        embed
          .setColor(0x0099ff)
          .setFooter({ text: `↩️ Unblocked ${sender}${notSpam ? ' · marked Not spam' : ''}` });
        await interaction.editReply({ embeds: [embed], components: [buildEmailButtons(zohoMessageId)] });
      }

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

      const smartDefault = await smartSelectFromAddress(emailData?.recipient_email);
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

      const smartDefault = await smartSelectFromAddress(emailData?.recipient_email);

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
    const errorReply = {
      content: 'An error occurred while processing your request.',
      ephemeral: true
    };
    // A deferred or answered interaction can't be replied to again
    if (interaction.deferred || interaction.replied) await interaction.followUp(errorReply).catch(() => {});
    else await interaction.reply(errorReply);
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
      // Send reply
      await replyToEmail(
        zohoMessageId,
        fromAddress,
        emailData.sender_email,
        emailData.subject,
        replyContent
      );

      // Mark email as read (since replying implies reading)
      try {
        await markEmailAsRead(zohoMessageId);
        
        // Update the original Discord message to show it's been read
        const originalMessage = await interaction.client.channels.cache.get(process.env.DISCORD_CHANNEL_ID)?.messages.fetch(emailData.discord_message_id);
        if (originalMessage) {
          const embed = EmbedBuilder.from(originalMessage.embeds[0])
            .setColor(0x00ff00)
            .setFooter({ text: '✅ Replied and marked as read' });
          
          await originalMessage.edit({
            embeds: [embed],
            components: [] // Remove buttons since it's now read
          });
        }
      } catch (markReadError) {
        console.error('⚠️ Failed to auto-mark as read:', markReadError.message);
      }

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
        content: `✅ Reply sent successfully from **${displayName}** <${fromAddress}>!\n📖 Email automatically marked as read.`,
        ephemeral: true
      });
    } else {
      await interaction.reply({
        content: '❌ Could not find email data to reply to.',
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Error sending reply:', error.message);
    await interaction.reply({
      content: `❌ Error sending reply: ${error.message}`,
      ephemeral: true
    });
  }
});

// Action buttons on an email notification
function buildEmailButtons(zohoMessageId) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(`markread_${zohoMessageId}`)
        .setLabel('Mark as Read')
        .setStyle(ButtonStyle.Success)
        .setEmoji('✅'),
      new ButtonBuilder()
        .setCustomId(`reply_${zohoMessageId}`)
        .setLabel('Reply')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('💬'),
      new ButtonBuilder()
        .setCustomId(`block_${zohoMessageId}`)
        .setLabel('Block Sender')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('✋')
    );
}

// Sender address for a notification: from the DB mapping, else parsed from the embed's From field
async function getNotificationSender(zohoMessageId, message) {
  const mapping = await dbGet('SELECT sender_email FROM email_mappings WHERE zoho_message_id = ?', [zohoMessageId]);
  if (mapping?.sender_email) return normalizeEmail(mapping.sender_email);

  const fromField = message.embeds[0]?.fields?.find(field => field.name === 'From')?.value || '';
  const match = fromField.match(/\(([^()\s]+@[^()\s]+)\)\s*$/);
  return match ? normalizeEmail(match[1]) : null;
}

// HTML cleaning function
function cleanHtmlContent(html, summary) {
  if (!html) return summary || 'No content available';
  
  let cleaned = html
    // Remove style blocks
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Remove script blocks  
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Decode HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    // Clean up whitespace
    .replace(/\s+/g, ' ')
    .trim();
  
  // Fallback to summary if result looks like CSS
  if (cleaned.includes('box-sizing') || 
      cleaned.includes('margin:') || 
      cleaned.includes('padding:') ||
      cleaned.length < 10) {
    return summary || 'HTML email - content preview not available';
  }
  
  return cleaned.substring(0, 1000);
}

// Best-effort error notification to Discord (tries bot first, then webhook fallback)
async function sendErrorToDiscord(text) {
  try {
    if (client.user && process.env.DISCORD_CHANNEL_ID) {
      const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
      await channel.send({ content: text });
      return;
    }
  } catch (err) {
    console.error('❌ Failed to send error notice via bot:', err.message);
  }

  try {
    if (process.env.DISCORD_WEBHOOK_URL) {
      await axios.post(process.env.DISCORD_WEBHOOK_URL, { content: text });
    }
  } catch (err) {
    console.error('❌ Failed to send error notice via webhook:', err.message);
  }
}

function hasUsableEmailPayload(emailData) {
  return Boolean(emailData?.messageId && emailData?.fromAddress && emailData?.subject);
}

// Enhanced webhook endpoint
app.post('/webhook/zoho', async (req, res) => {
  try {
    const emailData = req.body;
    
    console.log(`📧 New email: "${emailData.subject}" from ${emailData.fromAddress}`);
    
    if (!hasUsableEmailPayload(emailData)) {
      console.log('Zoho webhook verification received');
      return res.status(200).json({
        success: true,
        message: 'Webhook verification acknowledged'
      });
    }

    // Skip outgoing emails (Mode 1 = sent, Mode 0 = received)
    if (emailData.Mode === 1) {
      console.log('📤 Skipping outgoing email');
      return res.status(200).json({ success: true, message: 'Outgoing email ignored' });
    }
    
    // Additional check - skip emails from your own domain/addresses
    const fromAddresses = await getFromAddresses();
    const isFromOwnAddress = fromAddresses.some(addr => addr.email_address === emailData.fromAddress);
    if (isFromOwnAddress) {
      console.log(`📤 Skipping email from own address`);
      return res.status(200).json({ success: true, message: 'Own email ignored' });
    }

    // Blocked senders: no Discord notification, mark read and move to Spam in Zoho
    if (await isSenderBlocked(emailData.fromAddress)) {
      const outcome = await discardEmail(emailData.messageId);
      await dbRun(
        'UPDATE blocked_senders SET blocked_count = blocked_count + 1, last_blocked_at = CURRENT_TIMESTAMP WHERE email_address = ?',
        [normalizeEmail(emailData.fromAddress)]
      );
      console.log(`🚫 Blocked email from ${emailData.fromAddress} (read: ${outcome.read}, spam: ${outcome.spam})`);
      return res.status(200).json({ success: true, message: 'Blocked sender ignored' });
    }
    
    const emailContent = emailData.html || emailData.summary || 'No content available';
    const cleanContent = cleanHtmlContent(emailData.html, emailData.summary);
    
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

    // Plain-text line so mobile push previews show sender + subject instead of a generic notice
    const senderName = emailData.sender || emailData.fromAddress || 'Unknown sender';
    const subjectLine = emailData.subject || '(no subject)';
    const previewContent = `📧 **${senderName}**: ${subjectLine}`.substring(0, 300);
    const noMentions = { parse: [] };

    const row = buildEmailButtons(emailData.messageId);

    // Send message via Discord bot
    if (client.user && process.env.DISCORD_CHANNEL_ID) {
      try {
        const channel = await client.channels.fetch(process.env.DISCORD_CHANNEL_ID);
        const message = await channel.send({
          content: previewContent,
          allowedMentions: noMentions,
          embeds: [embed],
          components: [row]
        });
        
        console.log('✅ Message sent to Discord');
        
        // Store mapping in database
        const cleanRecipientEmail = emailData.toAddress.replace(/[<>]/g, '');
        db.run(
          'INSERT INTO email_mappings (discord_message_id, zoho_message_id, zoho_account_id, sender_email, recipient_email, subject) VALUES (?, ?, ?, ?, ?, ?)',
          [message.id, emailData.messageId.toString(), process.env.ZOHO_ACCOUNT_ID, emailData.fromAddress, cleanRecipientEmail, emailData.subject]
        );
        
      } catch (error) {
        console.error('❌ Discord error:', error.message);
        
        // Fallback to webhook if bot method fails
        await axios.post(process.env.DISCORD_WEBHOOK_URL, {
          content: previewContent,
          allowed_mentions: noMentions,
          embeds: [embed.toJSON()]
        });
        console.log('✅ Message sent via webhook fallback');
      }
    } else {
      await axios.post(process.env.DISCORD_WEBHOOK_URL, {
        content: previewContent,
        allowed_mentions: noMentions,
        embeds: [embed.toJSON()]
      });
      console.log('✅ Message sent via webhook');
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error forwarding email to Discord:', error);

    // Notify Discord that an email arrived but couldn't be processed,
    // salvaging whatever fields we can (never throws on missing content)
    const subject = req.body?.subject || 'Unknown subject';
    const from = req.body?.fromAddress || 'unknown sender';
    await sendErrorToDiscord(
      `⚠️ **Failed to process incoming email**\n**From:** ${from}\n**Subject:** ${subject}\n**Error:** ${error.message}`
    );

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
