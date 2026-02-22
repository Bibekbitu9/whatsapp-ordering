const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const stateManager = require('./state_manager');
const sheets = require('./utils/sheets');
const ai = require('./ai');
const store = require('./store_config');
const ownerPortal = require('./owner_portal');

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
    console.log(`🏪 Store: ${store.getShopName()} — ${store.isOpen() ? '🟢 OPEN' : '🔴 CLOSED'}`);
    const botNum = client.info?.wid?.user || 'unknown';
    console.log(`📋 Available cakes: ${store.getAvailableCakes().join(', ')}`);
    console.log(`📱 Bot connected as: ${botNum}`);
    console.log(`👤 Owner number: ${process.env.OWNER_NUMBER}`);
});

// ─── Helpers ───
function generateOrderId() {
    return 'CAKE-' + Math.floor(100 + Math.random() * 900);
}

// Lock to prevent message_create from processing bot's own replies
let isProcessingOwner = false;

async function sendText(chatId, text) {
    await client.sendMessage(chatId, text);
}

function getOwnerChatId() {
    const ownerNumber = process.env.OWNER_NUMBER;
    if (!ownerNumber) return null;
    const clean = ownerNumber.replace(/\D/g, '');
    const formatted = clean.startsWith('91') ? clean : `91${clean}`;
    return `${formatted}@c.us`;
}

// ─── Order Finalization ───
async function finalizeOrder(phone, chatId, session) {
    const price = store.getPrice(session.data.cake, session.data.weight);

    const orderData = {
        id: session.data.orderId || generateOrderId(),
        phone: phone,
        cake: session.data.cake,
        weight: session.data.weight,
        mode: session.data.mode,
        address: session.data.address || 'Pickup',
        price: price ? `₹${price}` : '',
        scheduledDate: session.data.scheduledDate || '',
        date: new Date().toISOString(),
        status: 'New'
    };

    console.log('📦 Finalizing Order:', orderData);

    try {
        await sheets.appendOrder(orderData);
        console.log('✅ Saved to Google Sheets');
    } catch (e) {
        console.error('❌ Failed to save to sheets:', e.message);
    }

    // Log order to terminal (always visible to owner)
    let summary = `📋 New Order: ${orderData.id} | ${orderData.cake} ${orderData.weight} | ${orderData.mode} | ${orderData.address}`;
    if (price) summary += ` | ₹${price}`;
    console.log(`\n🔔 ${summary}`);

    // Notify the owner on WhatsApp
    // Use activePortalChatId if available, otherwise fallback to the configured owner number
    const ownerChatId = activePortalChatId || getOwnerChatId();
    if (ownerChatId) {
        try {
            await sendText(ownerChatId, `🔔 *NEW ORDER*\n\n${summary}`);
        } catch (err) {
            console.error('❌ Failed to send order notification to owner:', err.message);
        }
    }

    stateManager.updateState(phone, 'COMPLETED');
    return orderData;
}

// ─── Handle Custom Cake Request ───
async function handleCustomRequest(phone, chatId, message) {
    console.log(`🎨 Custom Cake Request from ${phone}: ${message}`);
}

// ═══════════════════════════════════════════
// Dynamically track which chat ID the user opened the portal in to avoid intercepting customer messages
let activePortalChatId = null;

// ─── OWNER PORTAL (self-messages via message_create) ───
// ═══════════════════════════════════════════
client.on('message_create', async (msg) => {
    if (!msg.fromMe) return;
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') return;

    // Use client.info.wid to get the bot's own internal phone number
    const botNumInfo = client.info?.wid;
    const botNum = botNumInfo ? botNumInfo.user : '';

    const selfInput = msg.body?.trim();
    if (!selfInput) return;
    const lowerInput = selfInput.toLowerCase();

    const fromUser = msg.from.split('@')[0].split(':')[0];
    const toUser = msg.to.split('@')[0].split(':')[0];

    const isSelf = fromUser === toUser;
    const isToBot = toUser === botNum;
    const ownerPhone = (process.env.OWNER_NUMBER || '').replace(/\D/g, '');
    const ownerPhoneWithCountry = ownerPhone.startsWith('91') ? ownerPhone : `91${ownerPhone}`;
    const isToOwner = toUser === ownerPhoneWithCountry;

    // If the owner types "admin", we lock the portal to whatever chat they typed it in.
    if (lowerInput === 'admin') {
        activePortalChatId = msg.to;
    }

    // A message is meant for the owner portal if:
    // 1. It's strictly addressed to the bot's own raw number (isToBot, isSelf, isToOwner)
    // 2. OR it's addressed to the specific chat ID where the portal was opened (handles @lid self-chat routing)
    const isPortalChat = isSelf || isToBot || isToOwner || (activePortalChatId && msg.to === activePortalChatId);

    if (!isPortalChat) {
        return; // Ignore regular outgoing messages to customers
    }

    // Ignore automated notifications sent by the bot to the owner (prevents "Invalid option" loops)
    if (selfInput.startsWith('🔔') || selfInput.startsWith('❓') || selfInput.startsWith('👋') || selfInput.startsWith('📋') || selfInput.startsWith('💰')) {
        return;
    }

    // Prevent infinite loop: skip if we're already processing an owner command
    if (isProcessingOwner) return;

    // Determine the chat to send responses back to
    const chatId = msg.to === activePortalChatId ? msg.to : (msg.to !== botNum ? msg.to : msg.from);
    // For self-messages, force the state manager to use the bot/owner's clean number
    const phone = botNum || ownerPhoneWithCountry;

    if (lowerInput !== 'admin') {
        // Only log non-admin inputs so we don't spam if they just typed admin
        console.log(`\n👤 Owner portal input: "${selfInput}"`);
    } else {
        console.log(`\n🔑 Owner portal UNLOCKED in chat: ${activePortalChatId || 'self'}`);
    }


    isProcessingOwner = true;
    try {
        const portalResponse = await ownerPortal.handleOwnerMessage(phone, selfInput);
        if (portalResponse === null || portalResponse === undefined) { isProcessingOwner = false; return; }

        if (typeof portalResponse === 'string') {
            await sendText(chatId, portalResponse);
        } else if (typeof portalResponse === 'object') {
            if (portalResponse.type === 'status_update') {
                const customerChatId = `${portalResponse.phone}@c.us`;
                const statusMessages = {
                    'Ready': `✅ *Your cake is ready!* Order ${portalResponse.orderId} 🎂`,
                    'Done': `✅ *Order complete!* ${portalResponse.orderId} — Thank you! 💕`,
                    'Preparing': `👨‍🍳 *Preparing your cake!* ${portalResponse.orderId} ⏳`,
                    'Cancelled': `❌ *Order cancelled* ${portalResponse.orderId}`
                };
                const statusMsg = statusMessages[portalResponse.status] || `Order ${portalResponse.orderId}: *${portalResponse.status}*`;
                await client.sendMessage(customerChatId, statusMsg);
                await sendText(chatId, `✅ Customer notified: ${portalResponse.orderId} → ${portalResponse.status}`);
            } else if (portalResponse.type === 'broadcast') {
                try {
                    const recentOrders = await sheets.getTodaysOrders();
                    const phones = [...new Set(recentOrders.map(o => o.phone))];
                    let sent = 0;
                    for (const p of phones) {
                        try {
                            await client.sendMessage(`${p}@c.us`, portalResponse.message);
                            sent++;
                        } catch (e) { /* skip */ }
                    }
                    await sendText(chatId, `📢 Broadcast sent to *${sent}* customer(s)`);
                } catch (e) {
                    await sendText(chatId, `❌ Broadcast failed: ${e.message}`);
                }
            }
        }
    } catch (e) {
        console.error('❌ Owner portal error:', e.message);
        await sendText(chatId, `❌ Error: ${e.message}`);
    } finally {
        isProcessingOwner = false;
    }
});

// ═══════════════════════════════════════════
// ─── CUSTOMER MESSAGE HANDLER ───
// ═══════════════════════════════════════════
client.on('message', async (msg) => {
    if (msg.from.includes('@g.us') || msg.from === 'status@broadcast') return;
    if (msg.fromMe) return; // Self-messages handled by message_create above

    const chatId = msg.from;
    const phone = chatId.replace('@c.us', '').replace('@lid', '');
    const input = msg.body?.trim();
    const isLocation = msg.type === 'location';
    const hasLocation = msg.location;

    console.log(`\n💬 Customer ${phone}: "${input}" (type: ${msg.type})`);

    if (!input && !isLocation) return;

    const session = stateManager.getSession(phone);
    const state = session.state;
    const lowerInput = input ? input.toLowerCase() : '';

    try {
        // ─── Interaction Menu Interceptor ───
        if (lowerInput === 'hi' || lowerInput === 'hello' || lowerInput === 'hey') {
            stateManager.updateState(phone, 'START_MENU');
            if (store.isOpen()) {
                await sendText(chatId, `🎂 Welcome to *${store.getShopName()}*! How can I help you today?\n\n1️⃣ *Order a Cake* 🍰\n2️⃣ *Normal Chat* 💬\n\n_Please reply with 1 or 2_`);
            } else {
                await sendText(chatId, `🎂 Welcome to *${store.getShopName()}*!\n\n${store.getClosedMessage()}\n\nHowever, you can still:\n1️⃣ *Check Menu* 🍰\n2️⃣ *Normal Chat* 💬\n\n_Please reply with 1 or 2_`);
            }
            return;
        }

        // Handle specific states
        if (state === 'START_MENU') {
            if (lowerInput === '1') {
                if (!store.isOpen()) {
                    stateManager.clearSession(phone);
                    await sendText(chatId, `We are currently closed for orders.\n\n${store.getMenuText()}\n\nPlease return during our working hours to place an order!`);
                    return;
                }
                stateManager.updateState(phone, 'ORDERING');
                // Allow it to fall through to AI processing later, but first send the greeting/menu
                const menuText = store.getMenuText();
                await sendText(chatId, `🎂 Great! Here is our current menu:\n\n${menuText}\n\nWhat would you like to order? You can describe it naturally! ✨`);
                stateManager.addToHistory(phone, 'assistant', 'Showed menu and asked for order');
                return;
            } else if (lowerInput === '2') {
                stateManager.updateState(phone, 'NORMAL_CHAT');
                await sendText(chatId, `👍 Okay, normal chat enabled. I won't bother you with order questions for now.\n\nIf you want to order a cake later, just say *Hi* or *Order*!`);
                return;
            } else {
                await sendText(chatId, `❓ Please reply with *1* to order a cake or *2* for normal chat.`);
                return;
            }
        }

        if (state === 'NORMAL_CHAT') {
            if (lowerInput === 'order' || lowerInput === 'order cake') {
                if (!store.isOpen()) {
                    await sendText(chatId, store.getClosedMessage());
                    return;
                }
                stateManager.updateState(phone, 'ORDERING');
                // Fall through to AI
            } else {
                // In normal chat, we don't respond unless they want to order
                return;
            }
        }

        // ─── Store Closed Check (for any other messages) ───
        // Since NORMAL_CHAT intercepts and returns early above, and START_MENU handles itself,
        // reaching this point means they are trying to order or send random messages.
        if (!store.isOpen()) {
            await sendText(chatId, store.getClosedMessage());
            return;
        }

        // ─── COMPLETED: Prevent post-order spam ───
        if (state === 'COMPLETED') {
            const thankYouTriggers = ['thanks', 'thank you', 'thx', 'tq', 'ty'];
            const isThankYou = thankYouTriggers.some(t => lowerInput.includes(t));

            if (isThankYou) {
                // Acknowledge thanks quietly without restarting the flow
                await sendText(chatId, `You're very welcome! Let us know whenever you need another cake. 🎂`);
                return;
            }

            const restartTriggers = ['hi', 'hello', 'hey', 'order', 'menu'];
            const isRestart = restartTriggers.some(t => lowerInput === t || lowerInput.includes('order cake') || lowerInput.includes('new order'));

            if (isRestart) {
                stateManager.clearSession(phone);
                // The next message loop will catch this since we cleared it, but to be safe, just route it to the menu:
                stateManager.updateState(phone, 'START_MENU');
                if (store.isOpen()) {
                    await sendText(chatId, `🎂 Welcome back to *${store.getShopName()}*! How can I help you today?\n\n1️⃣ *Order a Cake* 🍰\n2️⃣ *Normal Chat* 💬\n\n_Please reply with 1 or 2_`);
                } else {
                    await sendText(chatId, `🎂 Welcome back to *${store.getShopName()}*!\n\n${store.getClosedMessage()}\n\nHowever, you can still:\n1️⃣ *Check Menu* 🍰\n2️⃣ *Normal Chat* 💬\n\n_Please reply with 1 or 2_`);
                }
            }

            // Ignore any other casual chatter while in COMPLETED state
            return;
        }

        // ─── Handle Location Messages ───
        if (isLocation && hasLocation) {
            const { latitude, longitude } = msg.location;
            const description = msg.location.description || '';
            const address = description
                ? `📍 ${description} (${latitude}, ${longitude})`
                : `📍 Location: ${latitude}, ${longitude}`;

            stateManager.updateData(phone, 'address', address);
            stateManager.addToHistory(phone, 'user', `[Shared location: ${address}]`);

            const updatedSession = stateManager.getSession(phone);
            if (updatedSession.data.cake && updatedSession.data.weight && updatedSession.data.mode) {
                const orderData = await finalizeOrder(phone, chatId, updatedSession);
                const price = store.getPrice(orderData.cake, orderData.weight);
                let confirmation = `🚚✅ *Order Confirmed!*\n\n`;
                confirmation += `🆔 ${orderData.id}\n`;
                confirmation += `🎂 ${orderData.cake} (${orderData.weight})\n`;
                confirmation += `📍 ${address}\n`;
                if (price) confirmation += `💰 Total: ₹${price}\n`;
                confirmation += `\n🕕 Delivery: ${store.getDeliveryHours()}\n`;
                confirmation += `Thank you! 🙏\n_Type "order" for a new order_`;
                await sendText(chatId, confirmation);
            } else {
                await processWithAI(phone, chatId, `My address is ${address}`, updatedSession);
            }
            return;
        }

        // ─── Maps Link Detection ───
        if (input && (input.includes('maps.google') || input.includes('goo.gl/maps') ||
            input.includes('google.com/maps') || input.includes('maps.apple.com'))) {
            const address = `🗺️ Maps: ${input}`;
            stateManager.updateData(phone, 'address', address);

            const updatedSession = stateManager.getSession(phone);
            if (updatedSession.data.cake && updatedSession.data.weight && updatedSession.data.mode) {
                const orderData = await finalizeOrder(phone, chatId, updatedSession);
                const price = store.getPrice(orderData.cake, orderData.weight);
                let confirmation = `🚚✅ *Order Confirmed!*\n\n`;
                confirmation += `🆔 ${orderData.id}\n`;
                confirmation += `🎂 ${orderData.cake} (${orderData.weight})\n`;
                confirmation += `📍 ${address}\n`;
                if (price) confirmation += `💰 Total: ₹${price}\n`;
                confirmation += `\nThank you! 🙏\n_Type "order" for a new order_`;
                await sendText(chatId, confirmation);
            } else {
                await processWithAI(phone, chatId, `My address is ${address}`, updatedSession);
            }
            return;
        }

        // ─── Process everything through AI ───
        await processWithAI(phone, chatId, input, session);

    } catch (err) {
        console.error('❌ Error processing message:', err);
    }
});

// ─── AI Processing ───
async function processWithAI(phone, chatId, input, session) {
    let lastOrder = null;
    try {
        lastOrder = await sheets.getLastOrder(phone);
    } catch (e) {
        console.log('⚠️ Could not fetch last order');
    }

    const result = await ai.chat(input, session.data, session.history, lastOrder);

    if (!result) {
        const menuText = store.getMenuText();
        await sendText(chatId, `🎂 Welcome to ${store.getShopName()}!\n\n${menuText}\n\nTell me what you'd like, or describe your order naturally!\n_Example: "I want a 1kg chocolate cake for delivery"_`);
        stateManager.updateState(phone, 'ORDERING');
        return;
    }

    stateManager.addToHistory(phone, 'user', input);
    console.log(`🧠 AI type: ${result.type}, updates:`, result.updates);

    // Apply updates
    if (result.updates) {
        if (result.updates.cake) stateManager.updateData(phone, 'cake', result.updates.cake);
        if (result.updates.weight) stateManager.updateData(phone, 'weight', result.updates.weight);
        if (result.updates.mode) stateManager.updateData(phone, 'mode', result.updates.mode);
        if (result.updates.address) stateManager.updateData(phone, 'address', result.updates.address);
        if (result.updates.scheduledDate) stateManager.updateData(phone, 'scheduledDate', result.updates.scheduledDate);
    }

    switch (result.type) {
        case 'complete': {
            const s = stateManager.getSession(phone);
            const d = s.data;

            if (!d.cake || !d.weight || !d.mode) {
                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);
                stateManager.updateState(phone, 'ORDERING');
                break;
            }

            if (d.mode === 'Delivery' && !d.address) {
                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);
                stateManager.updateState(phone, 'ORDERING');
                break;
            }

            const orderData = await finalizeOrder(phone, chatId, s);
            const price = store.getPrice(d.cake, d.weight);

            let confirmation = `✅ *Order Confirmed!*\n\n`;
            confirmation += `🆔 ${orderData.id}\n`;
            confirmation += `🎂 ${d.cake} (${d.weight})\n`;
            confirmation += `🚚 ${d.mode}`;
            if (d.mode === 'Delivery') {
                confirmation += `\n📍 ${d.address}`;
                confirmation += `\n🕕 Delivery: ${store.getDeliveryHours()}`;
            } else {
                confirmation += `\n🏪 Pick up by ${store.getPickupDeadline()}`;
            }
            if (price) confirmation += `\n💰 Total: *₹${price}*`;
            if (d.scheduledDate) confirmation += `\n📅 Scheduled: ${d.scheduledDate}`;
            confirmation += `\n\nThank you for choosing ${store.getShopName()}! 🙏💕`;
            confirmation += `\n_Type "order" to place a new order_`;

            await sendText(chatId, confirmation);
            stateManager.addToHistory(phone, 'assistant', confirmation);
            break;
        }

        case 'custom_request': {
            await handleCustomRequest(phone, chatId, input);
            await sendText(chatId, result.response);
            stateManager.addToHistory(phone, 'assistant', result.response);
            stateManager.updateState(phone, 'COMPLETED');
            break;
        }

        case 'repeat_order': {
            if (lastOrder) {
                stateManager.updateData(phone, 'cake', lastOrder.cake);
                stateManager.updateData(phone, 'weight', lastOrder.weight);
                stateManager.updateData(phone, 'mode', lastOrder.mode);
                if (lastOrder.address) stateManager.updateData(phone, 'address', lastOrder.address);

                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);

                const s = stateManager.getSession(phone);
                const d = s.data;
                if (d.cake && d.weight && d.mode && (d.mode !== 'Delivery' || d.address)) {
                    const orderData = await finalizeOrder(phone, chatId, s);
                    const price = store.getPrice(d.cake, d.weight);
                    let c = `✅ *Repeat Order Confirmed!*\n\n`;
                    c += `🆔 ${orderData.id}\n`;
                    c += `🎂 ${d.cake} (${d.weight}) | ${d.mode}\n`;
                    if (d.address && d.address !== 'Pickup') c += `📍 ${d.address}\n`;
                    if (price) c += `💰 Total: *₹${price}*\n`;
                    c += `\nThank you! 🙏💕\n_Type "order" for a new order_`;
                    await sendText(chatId, c);
                } else {
                    stateManager.updateState(phone, 'ORDERING');
                }
            } else {
                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);
                stateManager.updateState(phone, 'ORDERING');
            }
            break;
        }

        case 'cancel': {
            stateManager.clearSession(phone);
            await sendText(chatId, result.response);
            stateManager.updateState(phone, 'COMPLETED');
            break;
        }

        default: {
            await sendText(chatId, result.response);
            stateManager.addToHistory(phone, 'assistant', result.response);
            stateManager.updateState(phone, 'ORDERING');
            break;
        }
    }
}

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
