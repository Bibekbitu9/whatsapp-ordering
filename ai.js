const Groq = require('groq-sdk');
require('dotenv').config();
const store = require('./store_config');

let groqClient = null;

function getClient() {
    if (groqClient) return groqClient;
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        console.warn('⚠️ GROQ_API_KEY not set — AI ordering disabled');
        return null;
    }
    groqClient = new Groq({ apiKey });
    return groqClient;
}

function buildSystemPrompt(currentOrder, lastOrder) {
    const today = new Date().toISOString().split('T')[0];
    const availableCakes = store.getAvailableCakes();
    const menu = store.getMenu();

    // Build dynamic menu text
    let menuText = '';
    for (const name of availableCakes) {
        const item = menu[name];
        menuText += `${item.emoji} ${name}: ${Object.entries(item.prices).map(([w, p]) => `${w}=₹${p}`).join(', ')}\n`;
    }

    const validCakes = availableCakes.map(c => `"${c}"`).join('|');

    return `You are a friendly, warm cake shop WhatsApp assistant for "${store.getShopName()}" 🎂.
You help customers order cakes via chat. Be conversational, use emojis, and always match the customer's language.

## TODAY: ${today}

## AVAILABLE CAKES & PRICES
${menuText}
Delivery: ${store.getDeliveryHours()} window
Pickup: by ${store.getPickupDeadline()} at our shop

## CURRENT ORDER STATE
${JSON.stringify(currentOrder, null, 2)}

${lastOrder ? `## CUSTOMER'S LAST ORDER\n${JSON.stringify(lastOrder, null, 2)}\nIf they say "same as last time" or "repeat order", use this data.` : ''}

## YOUR TASK
1. Extract order details from the customer's message
2. Guide the customer naturally to complete missing fields
3. ALWAYS respond in the SAME LANGUAGE as the customer (Hindi, Kannada, English, etc.)
4. When all fields are filled, show a beautiful order summary with the price

## CRITICAL: RESPONSE FORMAT
You MUST respond with ONLY a JSON object. No text before or after. No markdown. No explanation.
The JSON object must have this exact structure:
{"updates":{"cake":null,"weight":null,"mode":null,"address":null,"scheduledDate":null},"response":"your message","type":"greeting"}

Field values:
- updates.cake: null or one of ${validCakes}
- updates.weight: null or "0.5kg" or "1kg" or "2kg"
- updates.mode: null or "Delivery" or "Pickup"
- updates.address: null or address string
- updates.scheduledDate: null or "YYYY-MM-DD"
- response: Your friendly conversational message to the customer
- type: one of "greeting","collecting","complete","custom_request","repeat_order","cancel","unknown"

## RULES
1. "cake", "weight", "mode" values MUST exactly match the options above or be null
2. Map common variations to exact names (e.g., "choco"→"Chocolate", "RV"→"Red Velvet")
3. Map weight variations ("half kg"/"500g"→"0.5kg", "1 kilo"→"1kg", "2 kilo"→"2kg")
4. Map mode variations ("deliver"/"send home"→"Delivery", "pick up"/"collect"→"Pickup")
5. If cake is NOT on our current menu, set type to "custom_request"
6. If they want to repeat their last order, set type to "repeat_order"
7. If they mention a date like "tomorrow", "Saturday", extract as scheduledDate (YYYY-MM-DD)
8. When order is complete (cake + weight + mode + address if delivery), set type to "complete"
9. Include price in your response when relevant
10. If customer says cancel/nevermind, set type to "cancel"
11. Always be warm and use emojis 🎂🍰✨
12. Respond in the SAME LANGUAGE as the customer

## LANGUAGE EXAMPLES
English: "What weight? We have half kg (₹250), 1kg (₹500), or 2kg (₹950) 🎂"
Hindi: "कितने kg का केक चाहिए? आधा kg (₹250), 1kg (₹500), या 2kg (₹950) 🎂"
Kannada: "ಎಷ್ಟು kg ಕೇಕ್ ಬೇಕು? ಅರ್ಧ kg (₹250), 1kg (₹500), ಅಥವಾ 2kg (₹950) 🎂"`;
}

/**
 * Process a customer message through the AI engine.
 */
async function chat(message, currentOrder = {}, conversationHistory = [], lastOrder = null) {
    const client = getClient();
    if (!client) return null;

    const systemPrompt = buildSystemPrompt(currentOrder, lastOrder);

    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-6),
        { role: 'user', content: message }
    ];

    try {
        const completion = await client.chat.completions.create({
            messages,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_completion_tokens: 500,
            response_format: { type: 'json_object' },
        });

        const text = completion.choices[0]?.message?.content?.trim();
        console.log('🤖 AI raw response:', text);

        const jsonMatch = text?.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            // Fallback: AI returned plain text — wrap it as a response
            console.log('⚠️ AI returned plain text, wrapping as response');
            return {
                updates: {},
                response: text || "How can I help you with your cake order?",
                type: 'collecting'
            };
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate against current dynamic menu
        const availableCakes = store.getAvailableCakes();
        const validWeights = ['0.5kg', '1kg', '2kg'];
        const validModes = ['Delivery', 'Pickup'];

        if (parsed.updates) {
            if (parsed.updates.cake && !availableCakes.includes(parsed.updates.cake)) {
                parsed.updates.cake = null;
            }
            if (parsed.updates.weight && !validWeights.includes(parsed.updates.weight)) {
                parsed.updates.weight = null;
            }
            if (parsed.updates.mode && !validModes.includes(parsed.updates.mode)) {
                parsed.updates.mode = null;
            }
        }

        return {
            updates: parsed.updates || {},
            response: parsed.response || "I'm sorry, I didn't understand that. Could you try again?",
            type: parsed.type || 'unknown'
        };
    } catch (err) {
        console.error('❌ AI error:', err.message);
        return null;
    }
}

module.exports = { chat };
