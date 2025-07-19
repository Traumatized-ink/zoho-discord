require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();

// Step 1: Generate authorization URL
app.get('/oauth/start', (req, res) => {
  const redirectUri = process.env.OAUTH_REDIRECT_URI || 'http://uko848o4k8ss4o8o8k0gsoss.178.156.163.130.sslip.io/oauth/callback';
  const authUrl = `https://accounts.zoho.com/oauth/v2/auth?scope=ZohoMail.messages.ALL&client_id=${process.env.ZOHO_CLIENT_ID}&response_type=code&redirect_uri=${redirectUri}&access_type=offline`;
  
  console.log('\n=== STEP 1: AUTHORIZATION ===');
  console.log('Click this link to authorize:');
  console.log(authUrl);
  console.log('\n');
  
  res.send(`
    <h1>Zoho OAuth Setup</h1>
    <p><a href="${authUrl}" target="_blank">Click here to authorize your Zoho account</a></p>
    <p>After authorization, you'll be redirected back here automatically.</p>
  `);
});

// Step 2: Handle callback and get tokens
app.get('/oauth/callback', async (req, res) => {
  const { code } = req.query;
  
  if (!code) {
    return res.send('<h1>Error: No authorization code received</h1>');
  }
  
  try {
    console.log('\n=== STEP 2: GETTING TOKENS ===');
    console.log('Authorization code received:', code);
    
    // Exchange code for tokens
    const redirectUri = process.env.OAUTH_REDIRECT_URI || 'http://uko848o4k8ss4o8o8k0gsoss.178.156.163.130.sslip.io/oauth/callback';
    const response = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        grant_type: 'authorization_code',
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code: code
      }
    });
    
    const { access_token, refresh_token } = response.data;
    
    console.log('\n=== SUCCESS! ===');
    console.log('Access Token:', access_token);
    console.log('Refresh Token:', refresh_token);
    console.log('\n=== ADD TO YOUR .ENV FILE ===');
    console.log(`ZOHO_REFRESH_TOKEN=${refresh_token}`);
    console.log('\n');
    
    res.send(`
      <h1>✅ OAuth Setup Complete!</h1>
      <h2>Add this to your .env file:</h2>
      <pre>ZOHO_REFRESH_TOKEN=${refresh_token}</pre>
      <p>Check your console for the full tokens.</p>
    `);
    
  } catch (error) {
    console.error('Error getting tokens:', error.response?.data || error.message);
    res.send(`<h1>❌ Error getting tokens</h1><pre>${JSON.stringify(error.response?.data || error.message, null, 2)}</pre>`);
  }
});

app.listen(3001, () => {
  console.log('\n🚀 OAuth Helper running on http://localhost:3001');
  console.log('Go to: http://localhost:3001/oauth/start');
  console.log('\nMake sure your .env has:');
  console.log('ZOHO_CLIENT_ID=your_client_id');
  console.log('ZOHO_CLIENT_SECRET=your_client_secret');
});