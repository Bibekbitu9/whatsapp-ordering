const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'store_data.json');

// Default configuration
const DEFAULT_CONFIG = {
    isOpen: true,
    shopName: 'Sweet Delights Bakery',
    closedMessage: "We're closed for today 🌙\nOur hours: 9 AM - 9 PM\nType *order* when we're open!",
    deliveryHours: '6-8 PM',
    pickupDeadline: '5 PM',
    menu: {
        'Chocolate': {
            emoji: '🍫',
            description: 'Rich dark chocolate with ganache drip',
            available: true,
            prices: { '0.5kg': 250, '1kg': 500, '2kg': 950 }
        },
        'Red Velvet': {
            emoji: '❤️',
            description: 'Classic red velvet with cream cheese frosting',
            available: true,
            prices: { '0.5kg': 300, '1kg': 600, '2kg': 1100 }
        },
        'Fruit': {
            emoji: '🍓',
            description: 'Fresh seasonal fruits with whipped cream',
            available: true,
            prices: { '0.5kg': 275, '1kg': 550, '2kg': 1000 }
        }
    }
};

class StoreConfig {
    constructor() {
        this.config = this.load();
    }

    load() {
        try {
            if (fs.existsSync(CONFIG_FILE)) {
                const data = fs.readFileSync(CONFIG_FILE, 'utf8');
                const saved = JSON.parse(data);
                // Merge with defaults to ensure new fields exist
                return { ...DEFAULT_CONFIG, ...saved, menu: { ...DEFAULT_CONFIG.menu, ...saved.menu } };
            }
        } catch (e) {
            console.error('⚠️ Error loading store config:', e.message);
        }
        return { ...DEFAULT_CONFIG };
    }

    save() {
        try {
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
        } catch (e) {
            console.error('❌ Error saving store config:', e.message);
        }
    }

    // ─── Store Status ───
    isOpen() { return this.config.isOpen; }

    toggleStore() {
        this.config.isOpen = !this.config.isOpen;
        this.save();
        return this.config.isOpen;
    }

    getClosedMessage() { return this.config.closedMessage; }

    // ─── Menu ───
    getMenu() { return this.config.menu; }

    getAvailableCakes() {
        return Object.entries(this.config.menu)
            .filter(([_, item]) => item.available)
            .map(([name]) => name);
    }

    getAvailableWeights(cake) {
        const item = this.config.menu[cake];
        if (!item) return [];
        return Object.keys(item.prices);
    }

    toggleCakeAvailability(cakeName) {
        if (!this.config.menu[cakeName]) return false;
        this.config.menu[cakeName].available = !this.config.menu[cakeName].available;
        this.save();
        return true;
    }

    updatePrice(cakeName, weight, newPrice) {
        if (!this.config.menu[cakeName]) return false;
        if (!this.config.menu[cakeName].prices[weight]) return false;
        this.config.menu[cakeName].prices[weight] = newPrice;
        this.save();
        return true;
    }

    addCake(name, emoji, description, prices) {
        this.config.menu[name] = { emoji, description, available: true, prices };
        this.save();
        return true;
    }

    removeCake(name) {
        if (!this.config.menu[name]) return false;
        delete this.config.menu[name];
        this.save();
        return true;
    }

    // ─── Pricing Helpers ───
    getPrice(cake, weight) {
        const item = this.config.menu[cake];
        if (!item || !item.prices[weight]) return null;
        return item.prices[weight];
    }

    getMenuText() {
        let text = '';
        for (const [name, item] of Object.entries(this.config.menu)) {
            const status = item.available ? '' : ' _(Sold Out)_';
            text += `${item.emoji} *${name}*${status}\n`;
            text += `   ${item.description}\n`;
            text += `   ${Object.entries(item.prices).map(([w, p]) => `${w}: ₹${p}`).join(' | ')}\n\n`;
        }
        return text.trim();
    }

    getDeliveryHours() { return this.config.deliveryHours; }
    getPickupDeadline() { return this.config.pickupDeadline; }

    setDeliveryHours(hours) {
        this.config.deliveryHours = hours;
        this.save();
    }

    setPickupDeadline(time) {
        this.config.pickupDeadline = time;
        this.save();
    }

    getShopName() { return this.config.shopName; }
}

module.exports = new StoreConfig();
