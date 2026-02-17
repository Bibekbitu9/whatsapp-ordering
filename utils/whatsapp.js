const axios = require('axios');
require('dotenv').config();

const WHATSAPP_API_URL = `https://graph.facebook.com/v17.0/${process.env.PHONE_NUMBER_ID}/messages`;
const TOKEN = process.env.WHATSAPP_TOKEN;

// Helper to send messages
async function sendMessage(data) {
    try {
        await axios.post(WHATSAPP_API_URL, data, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error sending message:', error.response ? error.response.data : error.message);
    }
}

// TODO: Implement specific message types (Text, Interactive List, Buttons)
module.exports = {
    sendMessage
};
