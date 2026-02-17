class StateManager {
    constructor() {
        this.sessions = {};
    }

    getSession(phoneNumber) {
        if (!this.sessions[phoneNumber]) {
            this.sessions[phoneNumber] = {
                state: 'INIT',
                data: {}
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

    clearSession(phoneNumber) {
        delete this.sessions[phoneNumber];
    }
}

module.exports = new StateManager();
