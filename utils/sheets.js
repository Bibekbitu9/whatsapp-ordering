const { google } = require('googleapis');
require('dotenv').config();

// Singleton auth client
let authClient = null;

async function getAuthClient() {
    if (authClient) return authClient;

    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    let key = process.env.GOOGLE_PRIVATE_KEY;

    if (!email || !key) {
        throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY');
    }

    // Replace literal \n with actual newline characters (if any remain)
    key = key.replace(/\\n/g, '\n');

    // googleapis v171+ requires named params (positional args no longer work)
    const auth = new google.auth.JWT({
        email: email,
        key: key,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    await auth.authorize();
    authClient = auth;
    console.log('✅ Google Sheets authenticated');
    return authClient;
}

async function appendOrder(orderData) {
    if (!process.env.GOOGLE_SHEET_ID) {
        console.log('Skipping Sheets save (No ID provided)');
        return;
    }

    const auth = await getAuthClient();
    const sheets = google.sheets({ version: 'v4', auth });

    const resource = {
        values: [
            [
                orderData.id,
                orderData.date,
                orderData.phone,
                orderData.cake,
                orderData.weight,
                orderData.mode,
                orderData.address
            ]
        ],
    };

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:G',
        valueInputOption: 'USER_ENTERED',
        resource,
    });

    console.log('✅ Order saved to Google Sheets');
}

module.exports = {
    appendOrder
};
