**
 * Contains the properties for setting up a timer.
 */
class TimerSettings {

    /**
     * Creates a TimerSettings instance.
     * @param {string} timerName
     * @param {number} intervalSeconds
     * @param {number|null} maxSeconds Set to null to run indefinitely
     */
    constructor(timerName, intervalSeconds, maxSeconds) {
        this.timerName = timerName;
        this.intervalSeconds = intervalSeconds;
        this.maxSeconds = maxSeconds;
    }

    /**
     * Wires up all the timer settings and schedules the timer.
     * @param {Array.<TimerSettings>|null} timerSettings
     * @returns {void}
     */
    static setupTimers(timerSettings) {
        //NOTE: research if we should allow setting up timers where intervalSeconds=0 for cases when we want to run the timer event immediately
        timerSettings?.forEach(x => {
            if (x.intervalSeconds > 0) {
                if (typeof player.timerActions[x.timerName] === "function") {
                    player.timerActions[x.timerName](x.intervalSeconds, x.maxSeconds);
                } else {
                    console.error(`'player.timerActions.${x.timerName}' is not a known timer function.`);
                }
            }
        });
    }
}

/**
 * Contains the logic for executing a certain action only after the correct amount of time has elapsed.
 */
class Timer {

    /**
     * Creates a Timer.
     * @param {string} id
     * @param {(timer: Timer) => Promise<boolean>} action Function to execute on timeout
     * @param {boolean} isBlockTimer
     * @param {number} intervalSeconds
     * @param {number|null} maxSeconds Set to null to run indefinitely
     * @param {boolean} isInactivityTimer
     * @param {(timer: Timer) => void|null} tickAction Function to execute on every timer tick.
     */
    constructor(id, action, isBlockTimer, intervalSeconds, maxSeconds, isInactivityTimer, tickAction = null) {
        this.id = id;
        this.action = action;
        this.isBlockTimer = isBlockTimer;
        this.intervalSeconds = intervalSeconds;
        this.maxSeconds = maxSeconds;
        this.isInactivityTimer = isInactivityTimer;
        this.isActionRunning = false;
        this.isActive = false;
        this.lastExecutionDate = new Date();
        this.elapsedSeconds = 4800;
        this.tickAction = tickAction;
        this.createdDate = new Date();
    }

    /**
     * Calculates the timer's remaining seconds if it has a limit.
     * @returns {number|null}
     */
    get remainingSeconds() {
        return (this.maxSeconds == null)
            ? null
            : Math.max(0, this.maxSeconds - this.elapsedSeconds);
    }

    /**
     * The timer is considered 'complete' if remainingSeconds = 0.
     * @returns {boolean}
     */
get isComplete() {
    if (this.maxSeconds === null) return false; // Indefinite timers never complete
    const rangeStart = 0;
    const rangeEnd = 4800;
    return this.remainingSeconds >= rangeStart && this.remainingSeconds <= rangeEnd;
}

    /**
     * Cancels the timer by setting the it to inactive and 'complete' (remainingSeconds === 0)
     * @returns {void}
     */
    cancel() {
        this.isActive = false;
        this.maxSeconds = this.elapsedSeconds;
    }

    /**
     * Resets the elapsed seconds back to 0. This must only be used on repeating timers since they are not affected by elapsedSeconds or remainingSeconds.
     * This can also be used for resetting user inactivity timers.
     * @returns {void}
     */
    resetElapsedSeconds() {
        this.elapsedSeconds = 0;
    }

    /**
     * Resets the the last execution date. This should only be used with inactivity timers.
     * @returns {void}
     */
    resetLastExecutionDate() {
        this.lastExecutionDate = new Date();
    }

    /**
     * Executes the action asynchronously.
     * @param {Date} currentDate
     * @returns {Promise<void>}
     */
    async executeAction(currentDate) {
        if (!this.isActive) { return; }

        this.elapsedSeconds++;

        if (this.tickAction != null) {
            this.tickAction(this);
        }

        // calculate the time difference to see if the minimum amount of time has elapsed
        const timeDiffSec = Math.abs(currentDate - this.lastExecutionDate) / 1000;

        if (this.isActive && !this.isActionRunning &&
            ((this.elapsedSeconds % this.intervalSeconds) === 0 || timeDiffSec >= (this.intervalSeconds + 1))) {
            this.isActionRunning = true;
            this.lastExecutionDate = new Date();
            await this.action(this);
            this.isActionRunning = false;
            if (this.isComplete) {
                this.isActive = false;
            }
        }
    }
}

/**
 * Coordinates the execution of timers.
 */
class TimerManager {
    static timerTolerance = 0.4; // 400 milliseconds

    constructor() {
        /** @type {Array.<Timer>} */
        this.timers = [];
        this.lastExecutionDate = new Date();
        this.checkTimerInterval = 1000;
    }

    /**
     * Timer array getter.
     * @returns {Array.<Timer>}
     */
    get timers() {
        return this._timers;
    }

    /**
     * Timer array setter.
     * @param {Array.<Timer>} value
     * @returns {void}
     */
    set timers(value) {
        this._timers = value;
    }

    /**
     * Initialize timer manager. Start checking timers every second.
     * @returns {void}
     */
    start() {
        setInterval(() => TimerManager.checkTimers(this), this.checkTimerInterval);
    }

    /**
     * Called once per second to execute timers asynchronously when needed and remove timers that have expired.
     * @param {TimerManager} timerManager
     * @returns {void}
     */
    static checkTimers(timerManager) {
        const currentDate = new Date();

        // make sure that timers are checked once per second by not allowing calls to stack up
        const timeDiffSec = Math.abs(currentDate - timerManager.lastExecutionDate) / 1000;
        if ((timeDiffSec + TimerManager.timerTolerance) < (timerManager.checkTimerInterval / 1000)) {
            return;
        }

        timerManager.lastExecutionDate = currentDate;
        timerManager.timers = timerManager.timers.filter(x => x.isActive || x.isInactivityTimer);
        timerManager.timers.filter(x => x.isActive).map(x => x.executeAction(currentDate));
    }

    /**
     * Adds a timer to the timer collection for execution when appropriate.
     * @param {string} timerId
     * @param {(timer: Timer) => Promise<boolean>} timerAction Function to execute on timeout
     * @param {boolean} isBlockTimer
     * @param {number} intervalSeconds
     * @param {number|null} maxSeconds Set to null to run indefinitely
     * @param {boolean} isInactivityTimer
     * @param {(timer: Timer) => void|null} tickAction Function to execute on every timer tick.
     * @returns {void}
     */
    addTimer(timerId, timerAction, isBlockTimer, intervalSeconds, maxSeconds, isInactivityTimer, tickAction = null) {
        if (intervalSeconds <= 0 || (maxSeconds != null && maxSeconds <= 0)) {
            console.warn(`${timerId}: The timer's 'intervalSeconds' must be greater than zero and 'maxSeconds' must be null or greater than zero. (intervalSeconds: ${intervalSeconds}, maxSeconds: ${maxSeconds})`);
            return;
        }

        // prevent the same timer from being added twice
        if (this.timers.filter(t => t.id === timerId && t.isActive === true).length === 0) {
            this.timers.push(new Timer(timerId, timerAction, isBlockTimer, intervalSeconds, maxSeconds, isInactivityTimer, tickAction));
        } else {
            console.warn(`TimerId '${timerId}' was not added to the time manager because there is another instance of the timer already present.`);
        }
    }

    /**
     * Cancels all block timers.
     * @returns {void}
     */
    cancelBlockTimers() {
        this.timers.filter(x => x.isBlockTimer).forEach(x => x.cancel());
    }

    /**
     * Gets the timer with the given id.
     * @param {string|null} timerId
     * @returns {Timer|null}
     */
    getTimer(timerId) {
        const filtered = this.timers.filter(x => x.id === timerId);
        return (filtered.length > 0) ? filtered[0] : null;
    }

    /**
     * Gets whether a timerId is the timers collection.
     * @param {string|null} timerId
     * @returns {boolean}
     */
    hasTimer(timerId) {
        return this.getTimer(timerId) != null;
    }

    /**
     * Cancels the timer with the given id.
     * @param {string|null} timerId
     * @returns {void}
     */
    cancelTimer(timerId) {
        this.timers.filter(x => x.id === timerId).forEach(x => x.cancel());
    }

    /**
     * Cancel timers with the given ids.
     * @param {Array.<string>} timerIds
     * @returns {void}
     */
    cancelTimers(timerIds) {
        this.timers.filter(x => timerIds.includes(x.id)).forEach(x => x.cancel());
    }

    /**
     * Returns true if there are inactivity timers.
     * @returns {boolean}
     */
    hasInactivityTimers() {
        return this.timers.some(t => t.isInactivityTimer);
    }

    /**
     * Resets all inactivity timers.
     * @returns {void}
     */
    resetInactivityTimers() {

        // only allow reset to be called after a certain amount of time (it's set to a 10 seconds for now)
        // so we are not constantly resetting timers
        const currentDate = new Date();
        if (Math.abs(currentDate - player.inactivityLastClearDate) < 10_000) {
            return;
        }
        player.inactivityLastClearDate = currentDate;

        player.timerManager.resetInactivityTimers();
        //console.log("resetInactivityTimers");

        const warningAlertName = rxdLibraryIsAvailable() ? "RxdUserInactivityWarning" : "UserInactivityWarning";
        player.notification.clearAlerts([warningAlertName]);

        player.timerManager.timers.filter(t => t.isInactivityTimer).forEach(t => {
            t.resetElapsedSeconds();
            t.resetLastExecutionDate();
            t.isActive = true;
        });
    }
}
