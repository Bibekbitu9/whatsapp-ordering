const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
require('dotenv').config();

const stateManager = require('./state_manager');
const sheets = require('./utils/sheets');
const ai = require('./ai');
const { getPrice, formatPrice, VALID_CAKES, VALID_WEIGHTS, VALID_MODES } = require('./utils/pricing');

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
    console.log(`📋 Menu: ${VALID_CAKES.join(', ')}`);
    console.log(`⚖️  Weights: ${VALID_WEIGHTS.join(', ')}`);
    console.log(`🚚 Modes: ${VALID_MODES.join(', ')}`);
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
    const price = getPrice(session.data.cake, session.data.weight);

    const orderData = {
        id: session.data.orderId || generateOrderId(),
        phone: phone,
        cake: session.data.cake,
        weight: session.data.weight,
        mode: session.data.mode,
        address: session.data.address || 'Pickup',
        price: price ? formatPrice(price) : '',
        scheduledDate: session.data.scheduledDate || '',
        date: new Date().toISOString(),
        status: 'New'
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
    const ownerChatId = getOwnerChatId();
    if (ownerChatId) {
        let summary = `📋 *New Order!*\n`;
        summary += `🆔 ID: ${orderData.id}\n`;
        summary += `📱 Phone: ${orderData.phone}\n`;
        summary += `🎂 Cake: ${orderData.cake}\n`;
        summary += `⚖️ Weight: ${orderData.weight}\n`;
        summary += `🚚 Mode: ${orderData.mode}\n`;
        summary += `📍 Address: ${orderData.address}\n`;
        if (price) summary += `💰 Price: ${formatPrice(price)}\n`;
        if (orderData.scheduledDate) summary += `📅 Scheduled: ${orderData.scheduledDate}\n`;
        summary += `\n_Reply with "${orderData.id} ready" to notify customer_`;
        try {
            await client.sendMessage(ownerChatId, summary);
        } catch (e) {
            console.error('❌ Failed to notify owner:', e.message);
        }
    }

    stateManager.updateState(phone, 'COMPLETED');
    return orderData;
}

// ─── Handle Owner Messages (Order Status Updates) ───
async function handleOwnerMessage(chatId, input) {
    // Pattern: "CAKE-XXX ready" or "CAKE-XXX done"
    const statusMatch = input.match(/^(CAKE-\d+)\s+(ready|done|preparing|cancelled)/i);
    if (!statusMatch) return false;

    const orderId = statusMatch[1].toUpperCase();
    const status = statusMatch[2].charAt(0).toUpperCase() + statusMatch[2].slice(1);

    console.log(`🔔 Owner update: ${orderId} → ${status}`);

    const customerPhone = await sheets.updateOrderStatus(orderId, status);
    if (customerPhone) {
        const customerChatId = `${customerPhone}@c.us`;

        const statusMessages = {
            'Ready': `✅ *Your cake is ready!*\n\n🎂 Order ${orderId} is prepared and waiting for you.\n🏪 Pick it up at our shop!\n\nThank you for your order! 💕`,
            'Done': `✅ *Your order is complete!*\n\n🎂 Order ${orderId} has been fulfilled.\nThank you for choosing Sweet Delights! 💕\n\n_Type "order" to place a new one!_`,
            'Preparing': `👨‍🍳 *Your cake is being prepared!*\n\n🎂 Order ${orderId} is in the oven.\nWe'll let you know when it's ready! ⏳`,
            'Cancelled': `❌ *Order Cancelled*\n\nOrder ${orderId} has been cancelled.\nPlease contact us if you have questions.\n\n_Type "order" to place a new one!_`
        };

        const msg = statusMessages[status] || `📋 Order ${orderId} status: *${status}*`;

        try {
            await client.sendMessage(customerChatId, msg);
            await sendText(chatId, `✅ Customer notified about ${orderId} → ${status}`);
            console.log(`✅ Customer ${customerPhone} notified: ${status}`);
        } catch (e) {
            await sendText(chatId, `❌ Failed to notify customer: ${e.message}`);
        }
        return true;
    } else {
        await sendText(chatId, `❌ Order ${orderId} not found in records`);
        return true;
    }
}

// ─── Handle Custom Cake Request ───
async function handleCustomRequest(phone, chatId, message) {
    const ownerChatId = getOwnerChatId();
    if (ownerChatId) {
        let notification = `🎨 *Custom Cake Request!*\n`;
        notification += `📱 From: ${phone}\n`;
        notification += `💬 Request: "${message}"\n\n`;
        notification += `_Reply directly to the customer to discuss details_`;
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

    // ─── Owner Commands ───
    if (isOwner(phone) && input) {
        const handled = await handleOwnerMessage(chatId, input);
        if (handled) return;
    }

    const session = stateManager.getSession(phone);
    const state = session.state;

    // Only "order" or "menu" restart after completion
    const startKeywords = ['order', 'menu'];

    try {
        // ─── COMPLETED: Ignore everything except restart keywords ───
        if (state === 'COMPLETED') {
            if (input && startKeywords.includes(input.toLowerCase())) {
                stateManager.clearSession(phone);
                const newSession = stateManager.getSession(phone);
                // Trigger AI with a greeting
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

            // Check if order is now complete
            const updatedSession = stateManager.getSession(phone);
            if (updatedSession.data.cake && updatedSession.data.weight && updatedSession.data.mode) {
                const orderData = await finalizeOrder(phone, chatId, updatedSession);
                const price = getPrice(orderData.cake, orderData.weight);
                let confirmation = `🚚✅ *Order Confirmed!*\n\n`;
                confirmation += `🆔 ${orderData.id}\n`;
                confirmation += `🎂 ${orderData.cake} (${orderData.weight})\n`;
                confirmation += `📍 ${address}\n`;
                if (price) confirmation += `💰 Total: ${formatPrice(price)}\n`;
                if (orderData.scheduledDate) confirmation += `📅 ${orderData.scheduledDate}\n`;
                confirmation += `\n🕕 Delivery between 6-8 PM\n`;
                confirmation += `Thank you! 🙏\n_Type "order" for a new order_`;
                await sendText(chatId, confirmation);
                stateManager.addToHistory(phone, 'assistant', confirmation);
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
            stateManager.addToHistory(phone, 'user', `[Shared maps link: ${input}]`);

            const updatedSession = stateManager.getSession(phone);
            if (updatedSession.data.cake && updatedSession.data.weight && updatedSession.data.mode) {
                const orderData = await finalizeOrder(phone, chatId, updatedSession);
                const price = getPrice(orderData.cake, orderData.weight);
                let confirmation = `🚚✅ *Order Confirmed!*\n\n`;
                confirmation += `🆔 ${orderData.id}\n`;
                confirmation += `🎂 ${orderData.cake} (${orderData.weight})\n`;
                confirmation += `📍 ${address}\n`;
                if (price) confirmation += `💰 Total: ${formatPrice(price)}\n`;
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

// ─── AI Processing Core ───
async function processWithAI(phone, chatId, input, session) {
    // Fetch last order for repeat functionality
    let lastOrder = null;
    try {
        lastOrder = await sheets.getLastOrder(phone);
    } catch (e) {
        console.log('⚠️ Could not fetch last order');
    }

    // Call AI
    const result = await ai.chat(input, session.data, session.history, lastOrder);

    if (!result) {
        // AI unavailable — fallback to basic prompt
        await sendText(chatId, '🎂 Welcome to Sweet Delights Bakery!\n\nTell me what cake you\'d like, or type "menu" to see our options!\n\nExample: _"I want a 1kg chocolate cake for delivery"_');
        stateManager.updateState(phone, 'ORDERING');
        return;
    }

    // Track conversation
    stateManager.addToHistory(phone, 'user', input);

    console.log(`🧠 AI type: ${result.type}, updates:`, result.updates);

    // Apply any extracted order data
    if (result.updates) {
        if (result.updates.cake) stateManager.updateData(phone, 'cake', result.updates.cake);
        if (result.updates.weight) stateManager.updateData(phone, 'weight', result.updates.weight);
        if (result.updates.mode) stateManager.updateData(phone, 'mode', result.updates.mode);
        if (result.updates.address) stateManager.updateData(phone, 'address', result.updates.address);
        if (result.updates.scheduledDate) stateManager.updateData(phone, 'scheduledDate', result.updates.scheduledDate);
    }

    // Handle different AI response types
    switch (result.type) {
        case 'complete': {
            // Order is complete — finalize!
            const updatedSession = stateManager.getSession(phone);
            const d = updatedSession.data;

            // Verify we have minimum required fields
            if (!d.cake || !d.weight || !d.mode) {
                // AI said complete but fields are missing — send its response and continue
                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);
                stateManager.updateState(phone, 'ORDERING');
                break;
            }

            // If delivery mode requires address
            if (d.mode === 'Delivery' && !d.address) {
                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);
                stateManager.updateState(phone, 'ORDERING');
                break;
            }

            const orderData = await finalizeOrder(phone, chatId, updatedSession);
            const price = getPrice(d.cake, d.weight);

            let confirmation = `✅ *Order Confirmed!*\n\n`;
            confirmation += `🆔 ${orderData.id}\n`;
            confirmation += `🎂 ${d.cake} (${d.weight})\n`;
            confirmation += `🚚 ${d.mode}`;
            if (d.mode === 'Delivery') {
                confirmation += `\n📍 ${d.address}`;
                confirmation += `\n🕕 Delivery between 6-8 PM`;
            } else {
                confirmation += `\n🏪 Pick up by 5 PM`;
            }
            if (price) confirmation += `\n💰 Total: *${formatPrice(price)}*`;
            if (d.scheduledDate) confirmation += `\n📅 Scheduled: ${d.scheduledDate}`;
            confirmation += `\n\nThank you for choosing Sweet Delights! 🙏💕`;
            confirmation += `\n_Type "order" to place a new order_`;

            await sendText(chatId, confirmation);
            stateManager.addToHistory(phone, 'assistant', confirmation);
            break;
        }

        case 'custom_request': {
            // Forward to owner
            await handleCustomRequest(phone, chatId, input);
            await sendText(chatId, result.response);
            stateManager.addToHistory(phone, 'assistant', result.response);
            stateManager.updateState(phone, 'COMPLETED');
            break;
        }

        case 'repeat_order': {
            // Fill from last order data
            if (lastOrder) {
                stateManager.updateData(phone, 'cake', lastOrder.cake);
                stateManager.updateData(phone, 'weight', lastOrder.weight);
                stateManager.updateData(phone, 'mode', lastOrder.mode);
                if (lastOrder.address) stateManager.updateData(phone, 'address', lastOrder.address);

                await sendText(chatId, result.response);
                stateManager.addToHistory(phone, 'assistant', result.response);

                // Check if the repeated order is complete
                const updatedSession = stateManager.getSession(phone);
                const d = updatedSession.data;
                if (d.cake && d.weight && d.mode && (d.mode !== 'Delivery' || d.address)) {
                    const orderData = await finalizeOrder(phone, chatId, updatedSession);
                    const price = getPrice(d.cake, d.weight);
                    let confirmation = `✅ *Repeat Order Confirmed!*\n\n`;
                    confirmation += `🆔 ${orderData.id}\n`;
                    confirmation += `🎂 ${d.cake} (${d.weight})\n`;
                    confirmation += `🚚 ${d.mode}\n`;
                    if (d.address && d.address !== 'Pickup') confirmation += `📍 ${d.address}\n`;
                    if (price) confirmation += `💰 Total: *${formatPrice(price)}*\n`;
                    confirmation += `\nThank you! 🙏💕\n_Type "order" for a new order_`;
                    await sendText(chatId, confirmation);
                    stateManager.addToHistory(phone, 'assistant', confirmation);
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
            // greeting, collecting, unknown — send AI response and continue
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
