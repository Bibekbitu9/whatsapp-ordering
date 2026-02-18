// ─── Cake Menu & Pricing ───

const MENU = {
    'Chocolate': {
        emoji: '🍫',
        description: 'Rich dark chocolate with ganache drip',
        prices: { '0.5kg': 250, '1kg': 500, '2kg': 950 }
    },
    'Red Velvet': {
        emoji: '❤️',
        description: 'Classic red velvet with cream cheese frosting',
        prices: { '0.5kg': 300, '1kg': 600, '2kg': 1100 }
    },
    'Fruit': {
        emoji: '🍓',
        description: 'Fresh seasonal fruits with whipped cream',
        prices: { '0.5kg': 275, '1kg': 550, '2kg': 1000 }
    }
};

const VALID_CAKES = Object.keys(MENU);
const VALID_WEIGHTS = ['0.5kg', '1kg', '2kg'];
const VALID_MODES = ['Delivery', 'Pickup'];

function getPrice(cake, weight) {
    if (!MENU[cake] || !MENU[cake].prices[weight]) return null;
    return MENU[cake].prices[weight];
}

function formatPrice(amount) {
    return `₹${amount}`;
}

function getMenuText() {
    let text = '';
    for (const [name, item] of Object.entries(MENU)) {
        text += `${item.emoji} *${name}* — ${item.description}\n`;
        text += `   ${Object.entries(item.prices).map(([w, p]) => `${w}: ₹${p}`).join(' | ')}\n`;
    }
    return text.trim();
}

module.exports = {
    MENU,
    VALID_CAKES,
    VALID_WEIGHTS,
    VALID_MODES,
    getPrice,
    formatPrice,
    getMenuText
};
