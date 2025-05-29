```javascript
// background.js
// This is the service worker script for the Instagram automation Chrome extension.
// It acts as the central controller, managing state, settings, scheduling,
// and communication between the popup UI and the content script.


// --- State Variables ---
let isActive = false; // Overall automation state (true when running)
let currentTabId = null; // The ID of the Instagram tab where the content script is active
let actionType = null; // 'follow' or 'unfollow'
let settings = {}; // Stores current automation settings
let processedToday = 0; // Number of actions completed today across sessions
let sessionProcessedCount = 0; // Number of actions completed in the current session/run
let currentTargets = []; // List of targets identified by the content script
let currentIndex = 0; // Index of the current target being processed
let isPausedForBatch = false; // Flag to indicate if currently in a long batch pause


// --- Default Settings ---
const DEFAULT_SETTINGS = {
    intervalMin: 5, // seconds min
    intervalMax: 10, // seconds max
    actionsPerBatch: 10, // actions
    pauseBetweenBatchesMin: 300, // seconds min (5 minutes)
    pauseBetweenBatchesMax: 600, // seconds max (10 minutes)
    dailyLimit: 100, // actions
    unfollowNonFollowers: false, // Unfollow only users who don't follow back? (Requires check - TBI)
    unfollowPrivate: false // Unfollow users with private profiles? (Requires check - TBI)
};

// --- Chrome Storage Keys ---
const STORAGE_KEYS = {
    SETTINGS: 'instagramAutomationSettings',
    STATE: 'instagramAutomationState' // For persistent state like daily count
};

// --- Alarm Names ---
const ALARM_NAMES = {
    PERFORM_ACTION: 'performActionAlarm',
    BATCH_PAUSE: 'batchPauseAlarm',
    DAILY_RESET: 'dailyResetAlarm' // To reset daily count
};

// --- Helper Functions ---

/
 * Generates a random integer between min and max (inclusive).
 */
function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/
 * Gets the automation status object.
 */
function getStatus() {
    return {
        isActive: isActive,
        actionType: actionType,
        currentTabId: currentTabId,
        settings: settings,
        processedToday: processedToday,
        sessionProcessedCount: sessionProcessedCount,
        currentTargetCount: currentTargets.length,
        currentIndex: currentIndex,
        isPausedForBatch: isPausedForBatch,
        statusText: isActive ?
                    (isPausedForBatch ? `Paused for batch break (${sessionProcessedCount}/${settings.actionsPerBatch}). Next action in progress...` : `Running (${sessionProcessedCount}/${settings.actionsPerBatch} in batch), ${processedToday}/${settings.dailyLimit} today.`)
                    : 'Idle'
    };
}

/
 * Sends the current status to the popup UI.
 */
function sendStatusToPopup() {
    chrome.runtime.sendMessage({ type: 'statusUpdate', payload: getStatus() }).catch(e => {
        // Ignore errors if popup is not open
        if (!e.message.includes('disconnect') && !e.message.includes('unregistered extension')) {
             console.error("Error sending status to popup:", e);
        }
    });
}

/
 * Loads settings and state from storage. Initializes with defaults if not found.
 */
async function loadSettingsAndState() {
    try {
        const data = await chrome.storage.local.get([STORAGE_KEYS.SETTINGS, STORAGE_KEYS.STATE]);
        settings = { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEYS.SETTINGS] || {}) };

        const now = Date.now();
        const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;
        const savedState = data[STORAGE_KEYS.STATE] || { processedToday: 0, lastActionTimestamp: 0 };

        // Reset daily count if last action was more than 24 hours ago
        if (savedState.lastActionTimestamp < twentyFourHoursAgo) {
            processedToday = 0;
            console.log("Daily count reset.");
        } else {
            processedToday = savedState.processedToday;
        }

        console.log("Settings loaded:", settings);
        console.log("State loaded (processedToday):", processedToday);

    } catch (error) {
        console.error("Error loading settings or state:", error);
        settings = DEFAULT_SETTINGS; // Fallback to defaults
        processedToday = 0;
        // Attempt to save defaults if loading failed
        await saveSettings(DEFAULT_SETTINGS).catch(e => console.error("Failed to save default settings:", e));
        await saveState({ processedToday: 0, lastActionTimestamp: 0 }).catch(e => console.error("Failed to save default state:", e));
    }
     sendStatusToPopup(); // Send initial status after loading
}

/
 * Saves settings to storage.
 * @param {object} newSettings - The settings object to save.
 */
async function saveSettings(newSettings) {
    settings = { ...settings, ...newSettings };
    try {
        await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
        console.log("Settings saved:", settings);
        sendStatusToPopup(); // Update popup after saving
    } catch (error) {
        console.error("Error saving settings:", error);
    }
}

/
 * Saves state (like daily count) to storage.
 * @param {object} newState - The state object to save.
 */
async function saveState(newState) {
     try {
        const currentState = await chrome.storage.local.get(STORAGE_KEYS.STATE);
        const stateToSave = { ...(currentState[STORAGE_KEYS.STATE] || {}), ...newState };
        await chrome.storage.local.set({ [STORAGE_KEYS.STATE]: stateToSave });
        // console.log("State saved:", stateToSave); // Log frequently, maybe too noisy
     } catch (error) {
         console.error("Error saving state:", error);
     }
}


/
 * Finds the active Instagram tab.
 * @returns {Promise<number|null>} - Resolves with the tab ID or null if not found.
 */
async function findInstagramTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const instagramTab = tabs.find(tab => tab.url && tab.url.includes('instagram.com'));

    if (instagramTab) {
        console.log("Found Instagram tab:", instagramTab.id);
        return instagramTab.id;
    } else {
        console.warn("No active Instagram tab found.");
        return null;
    }
}

/
 * Injects the content script into the specified tab if it's not already there.
 * @param {number} tabId - The ID of the target tab.
 * @returns {Promise<boolean>} - Resolves true if successful or already injected, false on failure.
 */
async function injectContentScript(tabId) {
    if (tabId === null) return false;

    try {
         // Check if content script is already injected by attempting to send a test message
         // If it fails, inject the script.
         const response = await chrome.tabs.sendMessage(tabId, { command: 'getStatus' }).catch(() => null);

         if (response && response.status !== undefined) {
             console.log(`Content script already injected in tab ${tabId}. Status: ${response.status}`);
             return true; // Content script is responding, assume injected
         } else {
             console.log(`Content script not detected in tab ${tabId}. Injecting...`);
             await chrome.scripting.executeScript({
                 target: { tabId: tabId },
                 files: ['content_script.js']
             });
             console.log(`Content script injected into tab ${tabId}. Waiting for 'ready' message...`);
             // Wait for a 'ready' message from the content script before proceeding
             return new Promise((resolve, reject) => {
                 const timeout = setTimeout(() => reject('Content script ready timeout'), 10000); // 10 sec timeout
                 const listener = (message, sender, sendResponse) => {
                      if (sender.tab && sender.tab.id === tabId && message.status === 'ready') {
                           console.log("Content script reported ready.");
                           clearTimeout(timeout);
                           chrome.runtime.onMessage.removeListener(listener);
                           resolve(true);
                      }
                 };
                 chrome.runtime.onMessage.addListener(listener);
             });
         }

    } catch (error) {
        console.error(`Failed to inject or communicate with content script in tab ${tabId}:`, error);
        return false;
    }
}


// --- Automation Core Logic ---

/
 * Starts the automation process.
 * @param {'follow'|'unfollow'} type - The type of action to perform.
 */
async function startAutomation(type) {
    if (isActive) {
        console.warn("Automation is already active.");
         sendStatusToPopup();
        return;
    }

    await loadSettingsAndState(); // Ensure latest settings and state are loaded

    if (processedToday >= settings.dailyLimit) {
         console.warn(`Daily limit (${settings.dailyLimit}) reached. Cannot start.`);
         sendStatusToPopup(); // Update status to show limit reached
         return;
    }

    console.log(`Attempting to start ${type} automation.`);
    actionType = type;
    sessionProcessedCount = 0;
    currentTargets = [];
    currentIndex = 0;
    isPausedForBatch = false;

    currentTabId = await findInstagramTab();

    if (!currentTabId) {
        console.error("Cannot start automation: No active Instagram tab found.");
        isActive = false;
        actionType = null;
        sendStatusToPopup();
        return;
    }

    const scriptInjected = await injectContentScript(currentTabId);

    if (!scriptInjected) {
        console.error("Failed to inject content script. Cannot start automation.");
        isActive = false;
        actionType = null;
         currentTabId = null;
        sendStatusToPopup();
        return;
    }

    // Start the automation loop by finding targets
    isActive = true;
    console.log("Automation started.");
    sendStatusToPopup();

    // Let the content script know to start scanning
    chrome.tabs.sendMessage(currentTabId, { command: 'startAutomation', actionType: actionType })
        .then(() => {
             // After content script starts scanning, request it to find targets
             scheduleNextAction(1000); // Short delay to let content script initialize
        })
        .catch(error => {
            console.error("Error sending start command to content script:", error);
            stopAutomation();
        });
}

/
 * Stops the automation process.
 */
function stopAutomation() {
    if (!isActive && !isPausedForBatch) {
        console.warn("Automation is not currently active or paused.");
        return;
    }
    console.log("Stopping automation.");
    isActive = false;
    isPausedForBatch = false;
    actionType = null;
    sessionProcessedCount = 0;
    currentTargets = [];
    currentIndex = 0;

    // Clear any scheduled alarms
    chrome.alarms.clear(ALARM_NAMES.PERFORM_ACTION);
    chrome.alarms.clear(ALARM_NAMES.BATCH_PAUSE);
    //chrome.alarms.clear(ALARM_NAMES.DAILY_RESET); // Keep daily reset alarm

    // Notify the content script to stop
    if (currentTabId !== null) {
        chrome.tabs.sendMessage(currentTabId, { command: 'stopAutomation' }).catch(e => console.warn("Error notifying content script to stop:", e));
        currentTabId = null; // Clear tab ID reference on stop
    }

    sendStatusToPopup();
}

/
 * Schedules the next action using a random timer.
 * @param {number} [delayMs] - Optional specific delay in milliseconds. If not provided, uses random interval from settings.
 */
function scheduleNextAction(delayMs) {
    if (!isActive) {
        console.log("Automation not active, not scheduling next action.");
        return;
    }

     // Clear any existing action alarm before setting a new one
     chrome.alarms.clear(ALARM_NAMES.PERFORM_ACTION);

    const delaySeconds = delayMs !== undefined ? delayMs / 1000 : getRandomInt(settings.intervalMin, settings.intervalMax);
    const delayMilliseconds = delaySeconds * 1000;

    console.log(`Scheduling next action in ${delaySeconds.toFixed(1)} seconds.`);

    chrome.alarms.create(ALARM_NAMES.PERFORM_ACTION, { delayInMinutes: delayMilliseconds / 60000 });
     sendStatusToPopup(); // Update status to reflect pending action/delay
}

/
 * Schedules a long pause between batches.
 */
function scheduleBatchPause() {
    isActive = false; // Temporarily set isActive to false while pausing
    isPausedForBatch = true;
    sessionProcessedCount = 0; // Reset session count after batch
    currentTargets = []; // Clear targets for the next batch
    currentIndex = 0;

    const pauseSeconds = getRandomInt(settings.pauseBetweenBatchesMin, settings.pauseBetweenBatchesMax);
    const pauseMilliseconds = pauseSeconds * 1000;

    console.log(`Batch completed. Scheduling long pause of ${pauseSeconds} seconds.`);

    chrome.alarms.clear(ALARM_NAMES.PERFORM_ACTION); // Ensure action alarm is cleared
    chrome.alarms.create(ALARM_NAMES.BATCH_PAUSE, { delayInMinutes: pauseMilliseconds / 60000 });
     sendStatusToPopup(); // Status will reflect "Paused for batch break"
}

/
 * Executes the logic for performing the next action in the automation loop.
 * Triggered by the 'performActionAlarm'.
 */
async function executeNextAction() {
    if (!isActive) {
        console.log("Execute next action called but automation is not active.");
        sendStatusToPopup();
        return;
    }

    await loadSettingsAndState(); // Ensure latest state is loaded

    // Re-check daily limit before performing the action
    if (processedToday >= settings.dailyLimit) {
        console.warn(`Daily limit (${settings.dailyLimit}) reached. Stopping automation.`);
        stopAutomation();
        sendStatusToPopup();
        return;
    }

     // Check session limit (batch limit)
     if (sessionProcessedCount >= settings.actionsPerBatch) {
         console.log(`Batch limit (${settings.actionsPerBatch}) reached.`);
         scheduleBatchPause();
         return; // Stop executing actions until batch pause is over
     }


    // Check if the current tab is still valid
    if (currentTabId === null) {
        console.warn("Current tab ID is null. Cannot perform action.");
        stopAutomation();
        sendStatusToPopup();
        return;
    }
     const tab = await chrome.tabs.get(currentTabId).catch(() => null);
     if (!tab || !tab.url || !tab.url.includes('instagram.com')) {
         console.warn(`Tab ${currentTabId} is no longer valid or not on Instagram. Stopping automation.`);
         stopAutomation();
         sendStatusToPopup();
         return;
     }


    console.log(`Executing action ${sessionProcessedCount + 1} (daily: ${processedToday + 1})...`);


    // Ask content script to perform the next action
    chrome.tabs.sendMessage(currentTabId, { command: 'performAction' })
    .catch(error => {
        console.error(`Error sending 'performAction' command to content script in tab ${currentTabId}:`, error);
        // If messaging fails, the tab might be gone or content script crashed
        stopAutomation();
        sendStatusToPopup();
    });

    // Content script will handle finding/clicking the actual element
    // and will report back via `actionCompleted`, `actionFailed`, `actionBlocked`, etc.
    // The scheduling of the *next* action or batch pause happens after the content script
    // reports its outcome via message listener.

     sendStatusToPopup(); // Update status immediately before sending the command
}


// --- Chrome Event Listeners ---

// Listener for messages from popup or content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Background received message:", request);

    // Handle messages from Popup
    if (sender.tab === undefined) { // Message from popup (or other extension pages)
        switch (request.command) {
            case 'startAutomation':
                startAutomation(request.actionType);
                sendResponse({ status: 'acknowledged' });
                break;
            case 'stopAutomation':
                stopAutomation();
                sendResponse({ status: 'acknowledged' });
                break;
            case 'getSettings':
                sendResponse({ settings: settings });
                break;
            case 'saveSettings':
                saveSettings(request.settings);
                sendResponse({ status: 'acknowledged' });
                break;
            case 'getStatus':
                sendResponse(getStatus());
                break;
            default:
                console.warn("Unknown command from popup:", request.command);
                 sendResponse({ status: 'unknown_command' });
        }
    } else { // Message from content script
        if (sender.tab && sender.tab.id !== currentTabId) {
             console.warn(`Received message from unexpected tab ${sender.tab.id}. Current tab is ${currentTabId}. Ignoring content script message.`);
             // Optionally, stop automation if this indicates an issue with the active tab
             // stopAutomation();
             return true; // Indicate async response, though we won't send one
        }

        switch (request.status) {
            case 'ready':
                console.log("Content script in the active tab is ready.");
                 // This confirms the content script is loaded after injection attempt or tab finding
                 // No action needed here, we wait for the 'startAutomation' command from popup
                 // and then schedule the find/perform sequence.
                break;
            case 'running':
                 console.log("Content script reports running.");
                // This is an acknowledge from content script after receiving startAutomation command
                // The next step is scheduleNextAction which calls performNextAction remotely
                 break;
            case 'stopped':
                console.log("Content script reported stopped.");
                 // This might happen if CS detects something critical or is explicitly stopped.
                 if (isActive) { // Only process if background thinks it's active
                      console.warn("Automation stopped unexpectedly by content script.");
                      stopAutomation(); // Sync background state
                 }
                break;
            case 'actionCompleted':
                console.log(`Content script reported action completed.`);
                sessionProcessedCount++;
                processedToday++;
                saveState({ processedToday: processedToday, lastActionTimestamp: Date.now() }); // Save daily count and timestamp
                sendStatusToPopup(); // Update UI with new counts

                // Check limits before scheduling the next action
                if (processedToday >= settings.dailyLimit) {
                    console.warn(`Daily limit (${settings.dailyLimit}) reached. Stopping automation.`);
                    stopAutomation();
                    // Clear daily reset alarm might be needed if using persistent state across 24h cycle
                    // For now, basic saving and loading handles 24h window.
                } else if (sessionProcessedCount >= settings.actionsPerBatch) {
                    console.log(`Batch limit (${settings.actionsPerBatch}) reached.`);
                    scheduleBatchPause();
                } else {
                    // Schedule the next action with random delay
                    scheduleNextAction();
                }
                break;
            case 'actionFailed':
                console.warn(`Content script reported action failed:`, request);
                // Decide error handling: Stop, retry, skip user?
                // For now, just log and move to the next by scheduling, unless it's a critical type.
                 if (request.type === 'domParsingError' || request.type === 'clickError') {
                     console.error("Critical failure reported by content script. Stopping automation.");
                     stopAutomation(); // Stop on critical DOM/click errors
                 } else {
                     console.warn("Non-critical action failed, proceeding with next action.");
                     // Schedule the next action as usual
                     scheduleNextAction();
                 }
                 sendStatusToPopup(); // Update status - maybe add an error flag or count

                break;
            case 'actionBlocked':
                console.error("Content script detected Action Blocked. Stopping automation.");
                // Immediately stop on action block detection
                stopAutomation();
                // Optionally, add a longer cooldown mechanism or error state to storage
                sendStatusToPopup();
                break;
             case 'userSkipped':
                 console.log(`Content script skipped user "${request.username}": ${request.details}`);
                 // User was skipped (e.g., button state changed, no button).
                 // The content script already advanced its index.
                 // We proceed to schedule the *next* action immediately without waiting for the random delay,
                 // to avoid penalizing for skipped users.
                 console.log("Scheduling next action immediately after skip.");
                 scheduleNextAction(100); // Schedule with a minimal delay
                 sendStatusToPopup(); // Update status - maybe show skipped count
                 break;
            case 'targetsFound':
                 // This message reports the initial targets found by the content script
                 console.log(`Content script reported ${request.count} targets found.`);
                 // We don't necessarily need the full list unless the background script
                 // is deciding *which* target element selector to send.
                 // Currently, CS decides which to click based on index.
                 break;
            case 'completed':
                  console.log(`Content script reports automation completed: ${request.message}`);
                  // This means the content script has exhausted targets on the current view
                  // or finished its task.
                  stopAutomation(); // Stop automation from background side
                  sendStatusToPopup();
                  break;
             case 'error':
                 console.error(`Content script reported error: type=${request.type}, details=${request.details}`);
                 // Handle various content script errors. Critical errors should stop automation.
                 // Examples: domParsingError, clickError, page structure changed fundamentally.
                 if (request.type === 'domParsingError' || request.type === 'clickError' || request.type === 'noTargetAtIndex') {
                     console.error("Critical error from content script. Stopping automation.");
                     stopAutomation();
                 } else {
                     console.warn("Non-critical error from content script. Automation may continue.", request);
                     // For non-critical errors, might continue or implement retry/backoff
                     // Currently, scheduledNextAction() is handled by 'actionCompleted'/'actionFailed',
                     // so we don't need to schedule here unless stopping.
                 }
                 sendStatusToPopup(); // Update status - maybe add an error message
                 break;
            default:
                console.warn("Unknown status message from content script:", request);
                 // sendResponse({ status: 'unknown_status' }); // Don't send response to CS messages usually
        }
        // For content script messages, return true if async response is needed (rare)
        // For now, no async response is needed for status updates.
        return true; // Indicate async response potential anyway for robustness
    }
});

// Listener for alarms
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === ALARM_NAMES.PERFORM_ACTION) {
        console.log("Alarm triggered:", ALARM_NAMES.PERFORM_ACTION);
        executeNextAction();
    } else if (alarm.name === ALARM_NAMES.BATCH_PAUSE) {
        console.log("Alarm triggered:", ALARM_NAMES.BATCH_PAUSE);
        // Batch pause is over, resume automation
        isPausedForBatch = false;
        isActive = true; // Resume active state
        console.log("Batch pause over. Resuming automation.");
        // Immediately attempt to find the next batch of targets and perform the first action
        // The content script will find initial targets, and then performNextAction will be called.
         if (currentTabId !== null) {
             // Request content script to start scanning for the next batch
             chrome.tabs.sendMessage(currentTabId, { command: 'startAutomation', actionType: actionType })
                 .then(() => {
                     // Schedule the first action of the new batch after a small delay
                     scheduleNextAction(1000); // Short delay before first action of batch
                 })
                 .catch(error => {
                     console.error("Error restarting content script for new batch:", error);
                     stopAutomation();
                 });
         } else {
             console.error("Cannot resume batch: currentTabId is null.");
             stopAutomation();
         }

        sendStatusToPopup(); // Update status to show not paused anymore

    } else if (alarm.name === ALARM_NAMES.DAILY_RESET) {
         console.log("Daily reset alarm triggered. Resetting daily count.");
         processedToday = 0;
         saveState({ processedToday: 0, lastActionTimestamp: Date.now() });
         sendStatusToPopup();
          // Reschedule the daily reset for the next 24 hours
         scheduleDailyReset(); // Schedule the next reset
    }
});

// Listener for tab updates (URL changes, tab closing)
chrome.tabs.onUpdated.addListener((tabId_updated, changeInfo, tab) => {
     // Check if the updated tab is the one we're automating on and if automation is active
     if (isActive && currentTabId !== null && tabId_updated === currentTabId) {
          // Check if the URL is still an Instagram URL
          if (changeInfo.url && !changeInfo.url.includes('instagram.com')) {
               console.warn(`Tab ${tabId_updated} changed URL away from Instagram. Stopping automation.`);
               stopAutomation();
          }
          // We could also listen for `status: 'complete'` after a page reload
          // and potentially re-inject/re-start automation if needed, but for simplicity
          // stopping is safer on URL change away from Instagram.
     }
});

// Listener for tab removal (tab closing)
chrome.tabs.onRemoved.addListener((tabId_removed, removeInfo) => {
    // Check if the removed tab is the one we're automating on and if automation is active
    if (isActive && currentTabId !== null && tabId_removed === currentTabId) {
        console.warn(`Tab ${tabId_removed} was closed. Stopping automation.`);
        stopAutomation();
    }
});


// --- Initialization ---

// Function to schedule the daily reset alarm
function scheduleDailyReset() {
     // Schedule the alarm to trigger roughly 24 hours from now
     // This handles resetting the daily count even if the browser is closed/reopened.
     chrome.alarms.create(ALARM_NAMES.DAILY_RESET, { periodInMinutes: 24 * 60 }); // 24 hours
     console.log("Daily reset alarm scheduled.");
}


// Initialize settings and state when the service worker starts
console.log("Background Service Worker started.");
loadSettingsAndState();
scheduleDailyReset(); // Ensure the daily reset is scheduled
```