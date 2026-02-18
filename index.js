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
    console.log(`📋 Available cakes: ${store.getAvailableCakes().join(', ')}`);
});

// ─── Helpers ───
function generateOrderId() {
    return 'CAKE-' + Math.floor(100 + Math.random() * 900);
}

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

function isOwner(phone) {
    const ownerNumber = process.env.OWNER_NUMBER?.replace(/\D/g, '');
    if (!ownerNumber) return false;
    return phone.includes(ownerNumber) || ownerNumber.includes(phone);
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

    // Notify Owner (via terminal always, via WhatsApp only if owner ≠ bot's own number)
    let summary = `📋 New Order: ${orderData.id} | ${orderData.cake} ${orderData.weight} | ${orderData.mode} | ${orderData.address}`;
    if (price) summary += ` | ₹${price}`;
    console.log(`\n🔔 ${summary}`);

    const ownerChatId = getOwnerChatId();
    const botNumber = client.info?.wid?.user;
    const ownerNum = process.env.OWNER_NUMBER?.replace(/\D/g, '');
    const isBotOwner = botNumber && ownerNum && (botNumber.includes(ownerNum) || ownerNum.includes(botNumber));

    if (ownerChatId && !isBotOwner && chatId !== ownerChatId) {
        let ownerMsg = `📋 *New Order!*\n`;
        ownerMsg += `🆔 ID: ${orderData.id}\n`;
        ownerMsg += `📱 Phone: ${orderData.phone}\n`;
        ownerMsg += `🎂 Cake: ${orderData.cake}\n`;
        ownerMsg += `⚖️ Weight: ${orderData.weight}\n`;
        ownerMsg += `🚚 Mode: ${orderData.mode}\n`;
        ownerMsg += `📍 Address: ${orderData.address}\n`;
        if (price) ownerMsg += `💰 Price: ₹${price}\n`;
        if (orderData.scheduledDate) ownerMsg += `📅 Scheduled: ${orderData.scheduledDate}\n`;
        ownerMsg += `\n_Reply "${orderData.id} ready" to notify customer_`;
        try {
            await client.sendMessage(ownerChatId, ownerMsg);
        } catch (e) {
            console.error('❌ Failed to notify owner via WhatsApp:', e.message);
        }
    }

    stateManager.updateState(phone, 'COMPLETED');
    return orderData;
}

// ─── Handle Custom Cake Request ───
async function handleCustomRequest(phone, chatId, message) {
    console.log(`🎨 Custom Cake Request from ${phone}: ${message}`);

    const ownerChatId = getOwnerChatId();
    const botNumber = client.info?.wid?.user;
    const ownerNum = process.env.OWNER_NUMBER?.replace(/\D/g, '');
    const isBotOwner = botNumber && ownerNum && (botNumber.includes(ownerNum) || ownerNum.includes(botNumber));

    if (ownerChatId && !isBotOwner && chatId !== ownerChatId) {
        let notification = `🎨 *Custom Cake Request!*\n`;
        notification += `📱 From: ${phone}\n`;
        notification += `💬 Request: "${message}"\n\n`;
        notification += `_Reply directly to discuss details_`;
        try {
            await client.sendMessage(ownerChatId, notification);
        } catch (e) {
            console.error('❌ Failed to forward custom request:', e.message);
        }
    }
}

// ─── Main Message Handler ───
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

    // ═════════════════════════════════════════
    // ─── OWNER PORTAL ───
    // ═════════════════════════════════════════
    if (isOwner(phone) && input) {
        try {
            const portalResponse = await ownerPortal.handleOwnerMessage(phone, input);

            if (portalResponse !== null && portalResponse !== undefined) {
                // Handle special response types
                if (typeof portalResponse === 'object') {
                    if (portalResponse.type === 'status_update') {
                        // Order status update — notify customer
                        const customerChatId = `${portalResponse.phone}@c.us`;
                        const statusMessages = {
                            'Ready': `✅ *Your cake is ready!*\n\n🎂 Order ${portalResponse.orderId} is prepared.\n🏪 Pick it up at our shop!\n\nThank you! 💕`,
                            'Done': `✅ *Your order is complete!*\n\n🎂 Order ${portalResponse.orderId} has been fulfilled.\nThank you for choosing ${store.getShopName()}! 💕\n\n_Type "order" for a new one!_`,
                            'Preparing': `👨‍🍳 *Your cake is being prepared!*\n\n🎂 Order ${portalResponse.orderId} is in the oven.\nWe'll let you know when it's ready! ⏳`,
                            'Cancelled': `❌ *Order Cancelled*\n\nOrder ${portalResponse.orderId} has been cancelled.\n\n_Type "order" for a new one!_`
                        };
                        const msg = statusMessages[portalResponse.status] || `📋 Order ${portalResponse.orderId}: *${portalResponse.status}*`;
                        try {
                            await client.sendMessage(customerChatId, msg);
                            await sendText(chatId, `✅ Customer notified: ${portalResponse.orderId} → ${portalResponse.status}`);
                        } catch (e) {
                            await sendText(chatId, `❌ Failed to notify customer: ${e.message}`);
                        }
                        return;
                    }

                    if (portalResponse.type === 'broadcast') {
                        // Broadcast to recent customers
                        try {
                            const recentOrders = await sheets.getTodaysOrders();
                            const phones = [...new Set(recentOrders.map(o => o.phone))];
                            let sent = 0;
                            for (const p of phones) {
                                try {
                                    await client.sendMessage(`${p}@c.us`, portalResponse.message);
                                    sent++;
                                } catch (e) { /* skip failed */ }
                            }
                            await sendText(chatId, `✅ Broadcast sent to ${sent} customer(s)\n\n` + ownerPortal.handleOwnerMessage.__proto__); // Will fall through
                            await sendText(chatId, `📢 Broadcast sent to *${sent}* customer(s)`);
                        } catch (e) {
                            await sendText(chatId, `❌ Broadcast failed: ${e.message}`);
                        }
                        return;
                    }
                }

                // Regular text response from portal
                await sendText(chatId, portalResponse);
                return;
            }
        } catch (e) {
            console.error('❌ Owner portal error:', e.message);
        }
    }

    // ═════════════════════════════════════════
    // ─── CUSTOMER FLOW ───
    // ═════════════════════════════════════════

    // Check if store is closed
    if (!store.isOpen()) {
        await sendText(chatId, store.getClosedMessage());
        return;
    }

    const session = stateManager.getSession(phone);
    const state = session.state;
    const startKeywords = ['order', 'menu'];

    try {
        // ─── COMPLETED: Only restart on keywords ───
        if (state === 'COMPLETED') {
            if (input && startKeywords.includes(input.toLowerCase())) {
                stateManager.clearSession(phone);
                const newSession = stateManager.getSession(phone);
                await processWithAI(phone, chatId, 'I want to order a cake', newSession);
            }
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
