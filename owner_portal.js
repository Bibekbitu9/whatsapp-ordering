const store = require('./store_config');
const sheets = require('./utils/sheets');

// Owner portal state per phone
const ownerState = {};

function getOwnerState(phone) {
    return ownerState[phone] || { menu: 'MAIN' };
}

function setOwnerState(phone, state) {
    ownerState[phone] = state;
}

function clearOwnerState(phone) {
    delete ownerState[phone];
}

/**
 * Handle owner messages. Returns the response text.
 * Returns null if the message wasn't an owner command.
 */
async function handleOwnerMessage(phone, input) {
    const lowerInput = input.toLowerCase().trim();
    const state = getOwnerState(phone);

    // ─── Entry Points ───
    if (['hi', 'admin', 'portal', 'dashboard', 'manage'].includes(lowerInput)) {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    // ─── Order Status Updates (always available) ───
    const statusMatch = input.match(/^(CAKE-\d+)\s+(ready|done|preparing|cancelled)/i);
    if (statusMatch) {
        return await handleOrderStatus(statusMatch[1].toUpperCase(), statusMatch[2]);
    }

    // ─── Navigate Menus ───
    switch (state.menu) {
        case 'MAIN':
            return handleMainMenu(phone, lowerInput);

        case 'TOGGLE_CAKE':
            return handleToggleCake(phone, input);

        case 'UPDATE_PRICE':
            return handleUpdatePrice(phone, input, state);

        case 'UPDATE_PRICE_WEIGHT':
            return handleUpdatePriceWeight(phone, input, state);

        case 'UPDATE_PRICE_VALUE':
            return handleUpdatePriceValue(phone, input, state);

        case 'ADD_CAKE':
            return handleAddCake(phone, input, state);

        case 'ADD_CAKE_EMOJI':
            return handleAddCakeEmoji(phone, input, state);

        case 'ADD_CAKE_PRICE':
            return handleAddCakePrice(phone, input, state);

        case 'REMOVE_CAKE':
            return handleRemoveCake(phone, input);

        case 'DELIVERY_HOURS':
            return handleDeliveryHours(phone, input);

        case 'BROADCAST':
            return handleBroadcast(phone, input);

        default:
            setOwnerState(phone, { menu: 'MAIN' });
            return getMainMenu();
    }
}

// ─── Main Menu ───
function getMainMenu() {
    const status = store.isOpen() ? '🟢 *OPEN*' : '🔴 *CLOSED*';
    const cakes = store.getAvailableCakes();

    let text = `🏪 *Owner Portal*\n`;
    text += `Status: ${status}\n`;
    text += `Available: ${cakes.length} cakes\n`;
    text += `─────────────────\n\n`;
    text += `1️⃣ ${store.isOpen() ? '🔴 Close' : '🟢 Open'} Store\n`;
    text += `2️⃣ 📋 View Today's Orders\n`;
    text += `3️⃣ 💰 View Revenue\n`;
    text += `4️⃣ 📦 Toggle Cake Availability\n`;
    text += `5️⃣ 💲 Update Prices\n`;
    text += `6️⃣ ➕ Add New Cake\n`;
    text += `7️⃣ ➖ Remove Cake\n`;
    text += `8️⃣ 🕐 Change Delivery Hours\n`;
    text += `9️⃣ 📢 Broadcast Message\n`;
    text += `🔟 📊 View Full Menu\n\n`;
    text += `_Reply with number (1-10) or "exit" to leave_`;
    return text;
}

function handleMainMenu(phone, input) {
    switch (input) {
        case '1': {
            const isNowOpen = store.toggleStore();
            setOwnerState(phone, { menu: 'MAIN' });
            return `${isNowOpen ? '🟢 Store is now *OPEN*!' : '🔴 Store is now *CLOSED*!'}\n\n${isNowOpen ? 'Customers can place orders.' : 'Customers will see a "closed" message.'}\n\n${getMainMenu()}`;
        }

        case '2':
            return handleViewOrders(phone);

        case '3':
            return handleViewRevenue(phone);

        case '4': {
            setOwnerState(phone, { menu: 'TOGGLE_CAKE' });
            const menu = store.getMenu();
            let text = `📦 *Toggle Cake Availability*\n\n`;
            Object.entries(menu).forEach(([name, item], i) => {
                text += `${i + 1}. ${item.emoji} ${name} — ${item.available ? '✅ Available' : '❌ Sold Out'}\n`;
            });
            text += `\n_Reply with the number to toggle, or "back"_`;
            return text;
        }

        case '5': {
            setOwnerState(phone, { menu: 'UPDATE_PRICE' });
            const menu = store.getMenu();
            let text = `💲 *Update Prices*\n\nSelect cake:\n`;
            Object.entries(menu).forEach(([name, item], i) => {
                text += `${i + 1}. ${item.emoji} ${name}\n`;
            });
            text += `\n_Reply with the number, or "back"_`;
            return text;
        }

        case '6': {
            setOwnerState(phone, { menu: 'ADD_CAKE' });
            return `➕ *Add New Cake*\n\nEnter the cake name:\n\n_Example: "Butterscotch"_\n_Or "back" to go back_`;
        }

        case '7': {
            setOwnerState(phone, { menu: 'REMOVE_CAKE' });
            const menu = store.getMenu();
            let text = `➖ *Remove Cake*\n\n`;
            Object.entries(menu).forEach(([name, item], i) => {
                text += `${i + 1}. ${item.emoji} ${name}\n`;
            });
            text += `\n_Reply with the number to remove, or "back"_`;
            return text;
        }

        case '8': {
            setOwnerState(phone, { menu: 'DELIVERY_HOURS' });
            return `🕐 *Delivery Hours*\n\nCurrent: ${store.getDeliveryHours()}\nPickup deadline: ${store.getPickupDeadline()}\n\nEnter new delivery hours:\n_Example: "5-7 PM"_\n_Or "back" to go back_`;
        }

        case '9': {
            setOwnerState(phone, { menu: 'BROADCAST' });
            return `📢 *Broadcast Message*\n\nType the message to send to all recent customers:\n\n_Example: "New butterscotch cake available! 🎂"_\n_Or "back" to cancel_`;
        }

        case '10': {
            setOwnerState(phone, { menu: 'MAIN' });
            return `📊 *Full Menu*\n\n${store.getMenuText()}\n\n${getMainMenu()}`;
        }

        case 'exit':
        case 'close':
        case 'bye': {
            clearOwnerState(phone);
            return '👋 Portal closed. Send *admin* to reopen.';
        }

        default:
            return `❓ Invalid option. ${getMainMenu()}`;
    }
}

// ─── Order Status Update ───
async function handleOrderStatus(orderId, statusText) {
    const status = statusText.charAt(0).toUpperCase() + statusText.slice(1).toLowerCase();
    const result = await sheets.updateOrderStatus(orderId, status);

    if (result) {
        return { type: 'status_update', phone: result, orderId, status };
    }
    return `❌ Order ${orderId} not found in records`;
}

// ─── View Recent Orders ───
async function handleViewOrders(phone) {
    setOwnerState(phone, { menu: 'MAIN' });
    try {
        const recentOrders = await sheets.getTodaysOrders(); // Now returns last 20 orders overall
        if (!recentOrders || recentOrders.length === 0) {
            return `📋 *Recent Orders*\n\nNo orders found in records.\n\n${getMainMenu()}`;
        }

        let text = `📋 *Recent Orders* (${recentOrders.length})\n\n`;
        recentOrders.forEach((order, i) => {
            text += `${i + 1}. *${order.id}* — ${order.cake} ${order.weight}\n`;
            text += `   ${order.mode} | ${order.status || 'New'}\n`;
        });
        text += `\n${getMainMenu()}`;
        return text;
    } catch (e) {
        return `❌ Could not fetch orders: ${e.message}\n\n${getMainMenu()}`;
    }
}

// ─── View Revenue ───
async function handleViewRevenue(phone) {
    setOwnerState(phone, { menu: 'MAIN' });
    try {
        const todayOrders = await sheets.getTodaysOrders();
        if (!todayOrders || todayOrders.length === 0) {
            return `💰 *Today's Revenue*\n\nNo orders yet today.\n\n${getMainMenu()}`;
        }

        let total = 0;
        todayOrders.forEach(order => {
            const price = order.price ? parseInt(order.price.replace(/[^\d]/g, '')) : 0;
            total += price;
        });

        let text = `💰 *Today's Revenue*\n\n`;
        text += `📦 Orders: *${todayOrders.length}*\n`;
        text += `💵 Revenue: *₹${total}*\n`;
        text += `📊 Avg order: *₹${Math.round(total / todayOrders.length)}*\n\n`;
        text += getMainMenu();
        return text;
    } catch (e) {
        return `❌ Could not fetch revenue: ${e.message}\n\n${getMainMenu()}`;
    }
}

// ─── Toggle Cake Availability ───
function handleToggleCake(phone, input) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const cakes = Object.keys(store.getMenu());
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < cakes.length) {
        const cakeName = cakes[idx];
        store.toggleCakeAvailability(cakeName);
        const item = store.getMenu()[cakeName];
        setOwnerState(phone, { menu: 'MAIN' });
        return `${item.emoji} *${cakeName}* is now ${item.available ? '✅ Available' : '❌ Sold Out'}\n\n${getMainMenu()}`;
    }
    return `❓ Invalid number. Reply 1-${cakes.length} or "back"`;
}

// ─── Update Price Flow ───
function handleUpdatePrice(phone, input, state) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const cakes = Object.keys(store.getMenu());
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < cakes.length) {
        const cakeName = cakes[idx];
        const item = store.getMenu()[cakeName];
        setOwnerState(phone, { menu: 'UPDATE_PRICE_WEIGHT', cake: cakeName });

        let text = `💲 *Update ${cakeName} Price*\n\nCurrent prices:\n`;
        Object.entries(item.prices).forEach(([w, p], i) => {
            text += `${i + 1}. ${w}: ₹${p}\n`;
        });
        text += `\n_Reply with the number, or "back"_`;
        return text;
    }
    return `❓ Invalid number. Reply 1-${cakes.length} or "back"`;
}

function handleUpdatePriceWeight(phone, input, state) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const item = store.getMenu()[state.cake];
    const weights = Object.keys(item.prices);
    const idx = parseInt(input) - 1;

    if (idx >= 0 && idx < weights.length) {
        const weight = weights[idx];
        setOwnerState(phone, { menu: 'UPDATE_PRICE_VALUE', cake: state.cake, weight });
        return `Enter new price for *${state.cake} ${weight}*:\n\nCurrent: ₹${item.prices[weight]}\n\n_Type the new price (number only), e.g. "550"_`;
    }
    return `❓ Invalid number. Reply 1-${weights.length} or "back"`;
}

function handleUpdatePriceValue(phone, input, state) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const newPrice = parseInt(input.replace(/[^\d]/g, ''));
    if (newPrice > 0) {
        store.updatePrice(state.cake, state.weight, newPrice);
        setOwnerState(phone, { menu: 'MAIN' });
        return `✅ *${state.cake} ${state.weight}* price updated to *₹${newPrice}*\n\n${getMainMenu()}`;
    }
    return `❓ Please enter a valid price (number only)`;
}

// ─── Add Cake Flow ───
function handleAddCake(phone, input, state) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const cakeName = input.trim();
    if (cakeName.length < 2) return '❓ Name too short. Try again.';

    setOwnerState(phone, { menu: 'ADD_CAKE_EMOJI', newCake: cakeName });
    return `Great! Now send an emoji for *${cakeName}*:\n\n_Example: 🍰 or 🧁_`;
}

function handleAddCakeEmoji(phone, input, state) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    setOwnerState(phone, { menu: 'ADD_CAKE_PRICE', newCake: state.newCake, emoji: input.trim() });
    return `Now enter prices for *${state.newCake}* in this format:\n\n_0.5kg:XXX, 1kg:XXX, 2kg:XXX_\n\nExample: *250, 500, 950*`;
}

function handleAddCakePrice(phone, input, state) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const numbers = input.match(/\d+/g);
    if (!numbers || numbers.length < 3) {
        return '❓ Please enter 3 prices separated by commas.\nExample: *250, 500, 950*';
    }

    const prices = {
        '0.5kg': parseInt(numbers[0]),
        '1kg': parseInt(numbers[1]),
        '2kg': parseInt(numbers[2])
    };

    store.addCake(state.newCake, state.emoji, `Delicious ${state.newCake}`, prices);
    setOwnerState(phone, { menu: 'MAIN' });

    return `✅ *${state.emoji} ${state.newCake}* added to menu!\n\nPrices: ${Object.entries(prices).map(([w, p]) => `${w}: ₹${p}`).join(' | ')}\n\n${getMainMenu()}`;
}

// ─── Remove Cake ───
function handleRemoveCake(phone, input) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    const cakes = Object.keys(store.getMenu());
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < cakes.length) {
        const cakeName = cakes[idx];
        store.removeCake(cakeName);
        setOwnerState(phone, { menu: 'MAIN' });
        return `✅ *${cakeName}* removed from menu.\n\n${getMainMenu()}`;
    }
    return `❓ Invalid number. Reply 1-${cakes.length} or "back"`;
}

// ─── Delivery Hours ───
function handleDeliveryHours(phone, input) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    store.setDeliveryHours(input.trim());
    setOwnerState(phone, { menu: 'MAIN' });
    return `✅ Delivery hours updated to *${input.trim()}*\n\n${getMainMenu()}`;
}

// ─── Broadcast ───
function handleBroadcast(phone, input) {
    if (input.toLowerCase() === 'back') {
        setOwnerState(phone, { menu: 'MAIN' });
        return getMainMenu();
    }

    // Return broadcast message to be sent by index.js
    setOwnerState(phone, { menu: 'MAIN' });
    return {
        type: 'broadcast',
        message: `📢 *${store.getShopName()}*\n\n${input}`
    };
}

module.exports = {
    handleOwnerMessage,
    clearOwnerState
};
