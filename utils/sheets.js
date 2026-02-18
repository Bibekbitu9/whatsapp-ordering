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

    key = key.replace(/\\n/g, '\n');

    // googleapis v171+ requires named params
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
                orderData.address,
                orderData.price || '',
                orderData.scheduledDate || '',
                orderData.status || 'New'
            ]
        ],
    };

    await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: 'Sheet1!A:J',
        valueInputOption: 'USER_ENTERED',
        resource,
    });

    console.log('✅ Order saved to Google Sheets');
}

/**
 * Get the last order for a phone number (for repeat orders)
 */
async function getLastOrder(phone) {
    if (!process.env.GOOGLE_SHEET_ID) return null;

    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:J',
        });

        const rows = response.data.values || [];

        // Find the last order from this phone number (search from bottom)
        for (let i = rows.length - 1; i >= 0; i--) {
            const row = rows[i];
            // Column C (index 2) = phone number
            if (row[2] && row[2].includes(phone.replace('91', ''))) {
                return {
                    id: row[0],
                    date: row[1],
                    phone: row[2],
                    cake: row[3],
                    weight: row[4],
                    mode: row[5],
                    address: row[6],
                    price: row[7],
                    scheduledDate: row[8]
                };
            }
        }

        return null;
    } catch (e) {
        console.error('❌ Failed to read sheets:', e.message);
        return null;
    }
}

/**
 * Update order status in Google Sheets
 */
async function updateOrderStatus(orderId, status) {
    if (!process.env.GOOGLE_SHEET_ID) return false;

    try {
        const auth = await getAuthClient();
        const sheets = google.sheets({ version: 'v4', auth });

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:J',
        });

        const rows = response.data.values || [];

        // Find the row with this order ID
        for (let i = 0; i < rows.length; i++) {
            if (rows[i][0] === orderId) {
                // Update status column (J = column 10)
                await sheets.spreadsheets.values.update({
                    spreadsheetId: process.env.GOOGLE_SHEET_ID,
                    range: `Sheet1!J${i + 1}`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [[status]] }
                });
                // Return the phone number for notification
                return rows[i][2];
            }
        }

        return null;
    } catch (e) {
        console.error('❌ Failed to update order status:', e.message);
        return null;
    }
}

/**
 * Get today's orders (for owner portal)
 */
async function getTodaysOrders() {
    if (!process.env.GOOGLE_SHEET_ID) return [];

    try {
        const auth = await getAuthClient();
        const sheetsApi = google.sheets({ version: 'v4', auth });

        const response = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: 'Sheet1!A:J',
        });

        const rows = response.data.values || [];
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

        return rows.filter(row => {
            // Column B (index 1) = date
            if (!row[1]) return false;
            return row[1].startsWith(today);
        }).map(row => ({
            id: row[0],
            date: row[1],
            phone: row[2],
            cake: row[3],
            weight: row[4],
            mode: row[5],
            address: row[6],
            price: row[7],
            scheduledDate: row[8],
            status: row[9] || 'New'
        }));
    } catch (e) {
        console.error('❌ Failed to get orders:', e.message);
        return [];
    }
}

module.exports = {
    appendOrder,
    getLastOrder,
    updateOrderStatus,
    getTodaysOrders
};
