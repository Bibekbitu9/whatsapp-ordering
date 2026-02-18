class StateManager {
    constructor() {
        this.sessions = {};
    }

    getSession(phoneNumber) {
        if (!this.sessions[phoneNumber]) {
            this.sessions[phoneNumber] = {
                state: 'INIT',
                data: {},
                history: []  // Conversation history for AI context
            };
        }
        return this.sessions[phoneNumber];
    }

    updateState(phoneNumber, newState) {
        const session = this.getSession(phoneNumber);
        session.state = newState;
        return session;
    }

    updateData(phoneNumber, key, value) {
        const session = this.getSession(phoneNumber);
        session.data[key] = value;
        return session;
    }

    /**
     * Add a message to conversation history (keep last 10 for context)
     */
    addToHistory(phoneNumber, role, content) {
        const session = this.getSession(phoneNumber);
        session.history.push({ role, content });
        // Keep only last 10 messages for context window
        if (session.history.length > 10) {
            session.history = session.history.slice(-10);
        }
    }

    clearSession(phoneNumber) {
        delete this.sessions[phoneNumber];
    }
}

module.exports = new StateManager();
