const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const stateManager = require('./state_manager');
const sheets = require('./utils/sheets');
const { parseOrder, VALID_CAKES, VALID_WEIGHTS, VALID_MODES } = require('./gemini');

// ─── Initialize WhatsApp Client ───
const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// ─── QR Code ───
client.on('qr', (qr) => {
    console.log('\n📱 Scan this QR code with your WhatsApp:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('✅ Authenticated successfully!');
});

client.on('ready', () => {
    console.log('🤖 Bot is ready and listening for messages!');
});

// ─── Helpers ───
function generateOrderId() {
    return 'CAKE-' + Math.floor(100 + Math.random() * 900);
}

async function sendText(chatId, text) {
    await client.sendMessage(chatId, text);
}

async function sendButtons(chatId, title, options) {
    let text = `*${title}*\n\n`;
    options.forEach((opt, i) => {
        text += `${i + 1}. ${opt}\n`;
    });
    text += `\n_Reply with the number (1-${options.length})_`;
    await client.sendMessage(chatId, text);
}

function buildOrderSummary(session) {
    const d = session.data;
    let summary = `📋 *Order Summary*\n\n`;
    summary += `🎂 Cake: *${d.cake}*\n`;
    summary += `⚖️ Weight: *${d.weight}*\n`;
    summary += `🚚 Mode: *${d.mode}*\n`;
    if (d.mode === 'Delivery' && d.address) {
        summary += `📍 Address: *${d.address}*\n`;
    }
    summary += `\nReply *yes* to confirm or *no* to cancel.`;
    return summary;
}

async function finalizeOrder(phone, chatId, session) {
    const orderData = {
        id: session.data.orderId || generateOrderId(),
        phone: phone,
        cake: session.data.cake,
        weight: session.data.weight,
        mode: session.data.mode,
        address: session.data.address || 'Pickup',
        date: new Date().toISOString()
    };

    console.log('📦 Finalizing Order:', orderData);

    // Save to Google Sheets
    try {
        await sheets.appendOrder(orderData);
        console.log('✅ Saved to Google Sheets');
    } catch (e) {
        console.error('❌ Failed to save to sheets:', e.message);
    }

    // Notify Owner
    const ownerNumber = process.env.OWNER_NUMBER;
    if (ownerNumber) {
        const cleanNumber = ownerNumber.replace(/\D/g, '');
        const formattedNumber = cleanNumber.startsWith('91') ? cleanNumber : `91${cleanNumber}`;
        const ownerChatId = `${formattedNumber}@c.us`;
        const summary = `📋 *New Order!*\nID: ${orderData.id}\nPhone: ${orderData.phone}\nCake: ${orderData.cake}\nWeight: ${orderData.weight}\nMode: ${orderData.mode}\nAddress: ${orderData.address}`;
        try {
            await client.sendMessage(ownerChatId, summary);
        } catch (e) {
            console.error('❌ Failed to notify owner:', e.message);
        }
    }

    stateManager.updateState(phone, 'COMPLETED');
}

/**
 * Determine the next missing field and jump to that state.
 * If all fields are filled, go to CONFIRMING.
 */
async function advanceToNextStep(phone, chatId, session) {
    const d = session.data;

    if (!d.cake) {
        await sendButtons(chatId, 'Choose Your Cake 🎂', VALID_CAKES);
        stateManager.updateState(phone, 'SELECTING_CAKE');
    } else if (!d.weight) {
        await sendButtons(chatId, 'Select Weight ⚖️', VALID_WEIGHTS);
        stateManager.updateState(phone, 'SELECTING_WEIGHT');
    } else if (!d.mode) {
        await sendButtons(chatId, 'Delivery or Pickup? 🚚', VALID_MODES);
        stateManager.updateState(phone, 'SELECTING_MODE');
    } else if (d.mode === 'Delivery' && !d.address) {
        await sendText(chatId, 'Delivery is between 6-8 PM.\n\nPlease share your *delivery address* using one of these methods:\n1. Tap 📎 → *Location* → share your pin 📍\n2. Send a *Google Maps* or *Apple Maps* link 🗺️\n3. Type your *full address*');
        stateManager.updateState(phone, 'PROVIDING_ADDRESS');
    } else {
        // All fields filled — show summary for confirmation
        await sendText(chatId, buildOrderSummary(session));
        stateManager.updateState(phone, 'CONFIRMING');
    }
}

// ─── Message Handler ───
client.on('message', async (msg) => {
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') return;
    if (msg.fromMe) return;

    const chatId = msg.from;
    const phone = chatId.replace('@c.us', '');
    const input = msg.body?.trim();
    const isLocation = msg.type === 'location';
    const hasLocation = msg.location;

    console.log(`\n💬 Message from ${phone}: "${input}" (type: ${msg.type})`);

    if (!input && !isLocation) return;

    const session = stateManager.getSession(phone);
    const state = session.state;

    // Only "order" or "menu" can restart after completion
    const startKeywords = ['order', 'menu'];

    try {
        // ─── COMPLETED: Ignore everything except restart keywords ───
        if (state === 'COMPLETED') {
            if (input && startKeywords.includes(input.toLowerCase())) {
                stateManager.clearSession(phone);
                const newSession = stateManager.getSession(phone);
                await sendText(chatId, '🎂 *Welcome back!*\n\nYou can type your order naturally, e.g.:\n_"I want a 1kg chocolate cake for delivery to MG Road"_\n\nOr just tell me what cake you\'d like!');
                stateManager.updateState(phone, 'INIT');
            }
            return;
        }

        // ─── INIT: Try Gemini AI first ───
        if (state === 'INIT') {
            console.log('🧠 Trying Gemini AI to parse order...');
            const aiOrder = await parseOrder(input);

            if (aiOrder) {
                // Pre-fill whatever Gemini extracted
                if (aiOrder.cake) stateManager.updateData(phone, 'cake', aiOrder.cake);
                if (aiOrder.weight) stateManager.updateData(phone, 'weight', aiOrder.weight);
                if (aiOrder.mode) stateManager.updateData(phone, 'mode', aiOrder.mode);
                if (aiOrder.address) stateManager.updateData(phone, 'address', aiOrder.address);

                const filled = [aiOrder.cake, aiOrder.weight, aiOrder.mode].filter(Boolean).length;
                console.log(`🧠 AI extracted ${filled}/3 fields`);

                if (filled > 0) {
                    // Let user know AI understood, then advance to next missing field
                    const updatedSession = stateManager.getSession(phone);
                    await advanceToNextStep(phone, chatId, updatedSession);
                    return;
                }
            }

            // Fallback: show menu if Gemini didn't parse anything
            await sendButtons(chatId, 'Choose Your Cake 🎂', VALID_CAKES);
            stateManager.updateState(phone, 'SELECTING_CAKE');
            return;
        }

        // ─── CONFIRMING: Yes/No confirmation ───
        if (state === 'CONFIRMING') {
            const answer = input?.toLowerCase();
            if (answer === 'yes' || answer === 'y' || answer === 'confirm') {
                await finalizeOrder(phone, chatId, session);
                const modeMsg = session.data.mode === 'Delivery'
                    ? '🚚✅ Order Confirmed for Delivery!'
                    : '✅ Order Confirmed! Pick it up at our shop by 5:00 PM. 🏪';
                await sendText(chatId, `${modeMsg}\n\nThank you for your order! 🙏\n_Type "order" to place a new order._`);
            } else if (answer === 'no' || answer === 'n' || answer === 'cancel') {
                stateManager.clearSession(phone);
                await sendText(chatId, '❌ Order cancelled.\n_Type "order" to start a new order._');
                stateManager.updateState(phone, 'COMPLETED');
            } else {
                await sendText(chatId, 'Please reply *yes* to confirm or *no* to cancel.');
            }
            return;
        }

        // ─── Step-by-step flow (for remaining fields) ───
        switch (state) {
            case 'SELECTING_CAKE': {
                const choice = parseInt(input);
                if (choice >= 1 && choice <= VALID_CAKES.length) {
                    stateManager.updateData(phone, 'cake', VALID_CAKES[choice - 1]);
                    await advanceToNextStep(phone, chatId, stateManager.getSession(phone));
                } else {
                    await sendText(chatId, 'Please reply with a number (1-3)');
                }
                break;
            }

            case 'SELECTING_WEIGHT': {
                const choice = parseInt(input);
                if (choice >= 1 && choice <= VALID_WEIGHTS.length) {
                    stateManager.updateData(phone, 'weight', VALID_WEIGHTS[choice - 1]);
                    await advanceToNextStep(phone, chatId, stateManager.getSession(phone));
                } else {
                    await sendText(chatId, 'Please reply with a number (1-3)');
                }
                break;
            }

            case 'SELECTING_MODE': {
                const choice = parseInt(input);
                if (choice >= 1 && choice <= VALID_MODES.length) {
                    stateManager.updateData(phone, 'mode', VALID_MODES[choice - 1]);
                    await advanceToNextStep(phone, chatId, stateManager.getSession(phone));
                } else {
                    await sendText(chatId, 'Please reply with 1 or 2');
                }
                break;
            }

            case 'PROVIDING_ADDRESS': {
                let address = null;

                if (isLocation && hasLocation) {
                    const { latitude, longitude } = msg.location;
                    const description = msg.location.description || '';
                    address = description
                        ? `📍 ${description} (${latitude}, ${longitude})`
                        : `📍 Location: ${latitude}, ${longitude}`;
                } else if (input && (input.includes('maps.google') || input.includes('goo.gl/maps') || input.includes('google.com/maps'))) {
                    address = `🗺️ Google Maps: ${input}`;
                } else if (input && input.includes('maps.apple.com')) {
                    address = `🗺️ Apple Maps: ${input}`;
                } else if (input && input.length >= 5 && /[a-zA-Z]/.test(input)) {
                    address = input;
                }

                if (address) {
                    stateManager.updateData(phone, 'address', address);
                    await advanceToNextStep(phone, chatId, stateManager.getSession(phone));
                } else {
                    await sendText(chatId, '⚠️ Please share a valid location:\n\n1. Tap 📎 → *Location* → share your location\n2. Or paste a *Google Maps* / *Apple Maps* link\n3. Or type your full address (min 5 characters)');
                }
                break;
            }

            default:
                stateManager.clearSession(phone);
                await sendText(chatId, '🎂 *Welcome!*\n\nYou can type your order naturally, e.g.:\n_"I want a 1kg chocolate cake for delivery to MG Road"_\n\nOr just tell me what cake you\'d like!');
                stateManager.updateState(phone, 'INIT');
                break;
        }
    } catch (err) {
        console.error('❌ Error processing message:', err);
    }
});

// ─── Error Handling ───
client.on('auth_failure', (msg) => {
    console.error('❌ Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
    console.log('🔌 Disconnected:', reason);
});

// ─── Start ───
console.log('🚀 Starting WhatsApp Bot...');
client.initialize();
