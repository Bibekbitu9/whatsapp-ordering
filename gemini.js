const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const VALID_CAKES = ['Chocolate', 'Red Velvet', 'Fruit'];
const VALID_WEIGHTS = ['0.5kg', '1kg', '2kg'];
const VALID_MODES = ['Delivery', 'Pickup'];

let model = null;

function getModel() {
    if (model) return model;
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ GEMINI_API_KEY not set — AI ordering disabled');
        return null;
    }
    const genAI = new GoogleGenerativeAI(apiKey);
    model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    return model;
}

const SYSTEM_PROMPT = `You are a cake shop order parser. Extract order details from the customer's message.

Available options:
- Cake: ${VALID_CAKES.join(', ')}
- Weight: ${VALID_WEIGHTS.join(', ')}
- Mode: ${VALID_MODES.join(', ')}

Rules:
1. Only extract values that EXACTLY match the available options above.
2. For cake: map common variations (e.g., "choco" → "Chocolate", "red velvet" → "Red Velvet", "fruit" → "Fruit").
3. For weight: map variations (e.g., "half kg" or "500g" → "0.5kg", "one kg" or "1 kilo" → "1kg", "two kg" → "2kg").
4. For mode: map variations (e.g., "deliver" or "home delivery" → "Delivery", "pick up" or "collect" → "Pickup").
5. For address: extract any location/address text if mode is Delivery.
6. If a field cannot be determined, set it to null.
7. If the message is just a greeting (hi, hello, hey) or unrelated to ordering, return ALL fields as null.

Respond ONLY with a JSON object, no markdown, no explanation:
{"cake": "...", "weight": "...", "mode": "...", "address": "..."}`;

/**
 * Parse a natural language message into order fields.
 * Returns { cake, weight, mode, address } with null for unparsed fields.
 * Returns null if Gemini is unavailable or the message isn't an order.
 */
async function parseOrder(message) {
    const ai = getModel();
    if (!ai) return null;

    const prompt = `${SYSTEM_PROMPT}\n\nCustomer message: "${message}"`;

    // Try up to 2 times (1 retry on rate limit)
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const result = await ai.generateContent(prompt);
            const text = result.response.text().trim();
            console.log('🤖 Gemini raw response:', text);

            // Extract JSON from response (handle markdown code blocks)
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) return null;

            const parsed = JSON.parse(jsonMatch[0]);

            // Validate each field against allowed values
            const order = {
                cake: VALID_CAKES.includes(parsed.cake) ? parsed.cake : null,
                weight: VALID_WEIGHTS.includes(parsed.weight) ? parsed.weight : null,
                mode: VALID_MODES.includes(parsed.mode) ? parsed.mode : null,
                address: parsed.address || null
            };

            // Check if at least one field was extracted
            const hasAnyField = order.cake || order.weight || order.mode;
            if (!hasAnyField) return null;

            console.log('🧠 Parsed order:', order);
            return order;
        } catch (err) {
            const errorMsg = err.message || '';
            // Check for rate limit error and retry
            const retryMatch = errorMsg.match(/retry in (\d+)/i);
            if (retryMatch && attempt === 1) {
                const waitSec = Math.min(parseInt(retryMatch[1]) + 1, 20);
                console.log(`⏳ Gemini rate limited. Retrying in ${waitSec}s...`);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                continue;
            }
            console.error('❌ Gemini error:', errorMsg);
            return null;
        }
    }
    return null;
}

module.exports = {
    parseOrder,
    VALID_CAKES,
    VALID_WEIGHTS,
    VALID_MODES
};
