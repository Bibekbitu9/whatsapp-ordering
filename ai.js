const Groq = require('groq-sdk');
require('dotenv').config();
const { VALID_CAKES, VALID_WEIGHTS, VALID_MODES, getPrice, getMenuText } = require('./utils/pricing');

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

    return `You are a friendly, warm cake shop WhatsApp assistant for "Sweet Delights Bakery" 🎂.
You help customers order cakes via chat. Be conversational, use emojis, and always match the customer's language.

## TODAY: ${today}

## MENU & PRICES
${getMenuText()}

Delivery Modes: Delivery (6-8 PM window) | Pickup (by 5 PM at our shop)

## CURRENT ORDER STATE
${JSON.stringify(currentOrder, null, 2)}

${lastOrder ? `## CUSTOMER'S LAST ORDER\n${JSON.stringify(lastOrder, null, 2)}\nIf they say "same as last time" or "repeat order", use this data.` : ''}

## YOUR TASK
1. Extract order details from the customer's message
2. Guide the customer naturally to complete missing fields
3. ALWAYS respond in the SAME LANGUAGE as the customer (Hindi, Kannada, English, etc.)
4. When all fields are filled, show a beautiful order summary with the price

## RESPONSE FORMAT (JSON only, no markdown wrapping)
{
  "updates": {
    "cake": null or "Chocolate"|"Red Velvet"|"Fruit",
    "weight": null or "0.5kg"|"1kg"|"2kg",
    "mode": null or "Delivery"|"Pickup",
    "address": null or "extracted address text",
    "scheduledDate": null or "YYYY-MM-DD"
  },
  "response": "Your friendly message to the customer",
  "type": "greeting|collecting|complete|custom_request|repeat_order|cancel|unknown"
}

## RULES
1. "cake", "weight", "mode" values MUST exactly match the options above or be null
2. For cake: map variations ("choco"→"Chocolate", "red velvet"/"RV"→"Red Velvet", "fruit"/"mixed fruit"→"Fruit")
3. For weight: map ("half kg"/"500g"→"0.5kg", "1 kilo"/"one kg"→"1kg", "2 kilo"/"two kg"→"2kg")
4. For mode: map ("deliver"/"home delivery"/"send"→"Delivery", "pick up"/"collect"/"take away"→"Pickup")
5. If cake is NOT on our menu, set type to "custom_request" and respond asking them to describe what they want
6. If they want to repeat their last order, set type to "repeat_order" and fill in from last order data
7. If they mention a date like "tomorrow", "Saturday", "25th Feb", extract it as scheduledDate (YYYY-MM-DD)
8. When order is complete (cake + weight + mode + address if delivery), set type to "complete"
9. Include price in your response when showing weight options or in the summary
10. If customer says cancel/nevermind, set type to "cancel"
11. Always mention "same as last time" option if they have a previous order
12. Be warm and use emojis 🎂🍰✨

## LANGUAGE EXAMPLES
English: "What weight would you like? We have half kg (₹250), 1kg (₹500), or 2kg (₹950) 🎂"
Hindi: "कितने kg का केक चाहिए? आधा kg (₹250), 1kg (₹500), या 2kg (₹950) 🎂"
Kannada: "ಎಷ್ಟು kg ಕೇಕ್ ಬೇಕು? ಅರ್ಧ kg (₹250), 1kg (₹500), ಅಥವಾ 2kg (₹950) 🎂"`;
}

/**
 * Process a customer message through the AI engine.
 * Returns { updates, response, type } or null on failure.
 */
async function chat(message, currentOrder = {}, conversationHistory = [], lastOrder = null) {
    const client = getClient();
    if (!client) return null;

    const systemPrompt = buildSystemPrompt(currentOrder, lastOrder);

    // Build messages array with conversation history
    const messages = [
        { role: 'system', content: systemPrompt },
        ...conversationHistory.slice(-6), // Last 6 messages for context
        { role: 'user', content: message }
    ];

    try {
        const completion = await client.chat.completions.create({
            messages,
            model: 'llama-3.3-70b-versatile',
            temperature: 0.3,
            max_completion_tokens: 500,
        });

        const text = completion.choices[0]?.message?.content?.trim();
        console.log('🤖 AI raw response:', text);

        // Extract JSON from response
        const jsonMatch = text?.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            console.error('❌ No JSON in AI response');
            return null;
        }

        const parsed = JSON.parse(jsonMatch[0]);

        // Validate updates
        if (parsed.updates) {
            if (parsed.updates.cake && !VALID_CAKES.includes(parsed.updates.cake)) {
                parsed.updates.cake = null;
            }
            if (parsed.updates.weight && !VALID_WEIGHTS.includes(parsed.updates.weight)) {
                parsed.updates.weight = null;
            }
            if (parsed.updates.mode && !VALID_MODES.includes(parsed.updates.mode)) {
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
