require('dotenv').config();
const axios = require('axios');

async function getZohoAccountId() {
  try {
    // Get access token using your refresh token
    const tokenResponse = await axios.post('https://accounts.zoho.com/oauth/v2/token', null, {
      params: {
        refresh_token: process.env.ZOHO_REFRESH_TOKEN,
        client_id: process.env.ZOHO_CLIENT_ID,
        client_secret: process.env.ZOHO_CLIENT_SECRET,
        grant_type: 'refresh_token'
      }
    });

    const accessToken = tokenResponse.data.access_token;
    console.log('✅ Got access token');

    // Get account information
    const accountResponse = await axios.get('https://mail.zoho.com/api/accounts', {
      headers: {
        'Authorization': `Zoho-oauthtoken ${accessToken}`
      }
    });

    console.log('\n=== ZOHO ACCOUNTS ===');
    console.log(JSON.stringify(accountResponse.data, null, 2));
    
    if (accountResponse.data.data && accountResponse.data.data.length > 0) {
      const accountId = accountResponse.data.data[0].accountId;
      console.log('\n=== ADD TO YOUR .ENV ===');
      console.log(`ZOHO_ACCOUNT_ID=${accountId}`);
    }

  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
  }
}

getZohoAccountId();