```javascript
// content_script.js
// This script is injected into Instagram pages to interact with the DOM.
// It listens for messages from the background script to perform follow/unfollow actions
// and reports back the status.

console.log("Instagram Mass Follow/Unfollow Content Script Loaded.");

// --- DOM Selectors (These are critical and may need updates if Instagram changes) ---
// These selectors are based on typical Instagram UI structure as of late 2023/early 2024
// They prioritize aria-labels, data-attributes, or stable class names where possible.

// Selector for the primary container holding user list items (e.g., Followers, Following modals)
// This often changes. Look for modals containing user lists or sections with many user entries.
// Example: A common pattern is a div with a specific role or nested structure.
// ! IMPORTANT: This selector needs frequent verification against live Instagram DOM.
// A general approach is to find the scrollable container within a modal or page section
// that contains user list items.
const USER_LIST_CONTAINER_SELECTOR = 'div[role="dialog"] div[style*="flex-direction: column"] > div:first-child, section.jgA5P, main[role="main"] div[style*="overflow-y: auto"]'; // Example: Adapt based on current modal/page structure

// Selector for individual user list items within the container.
// Look for the element that wraps a user's profile picture, username, and action button.
// Example: A div with a specific role or nested structure within the list container.
// ! IMPORTANT: This selector also needs frequent verification.
const USER_LIST_ITEM_SELECTOR = 'div[role="dialog"] div[style*="flex-direction: column"] > div:first-child > div, ._aano, ._acan._acao._acat._acav'; // Example: Adapt to the typical row structure

// Selector for the Follow/Unfollow button *within* a user list item.
// Prioritize buttons with specific text content, aria-label, or data attributes.
// Look for buttons like '<button>Follow</button>' or '<button>Following</button>' or buttons with a specific role="button".
// ! Try to be specific to avoid clicking other buttons.
// Example: Button containing "Follow" or "Following" text, possibly within span/div.
const ACTION_BUTTON_SELECTOR = 'button[type="button"]';

// Selector for the Unfollow confirmation modal (if it appears).
// Look for a dialog or modal element that contains confirmation text/buttons.
const UNFOLLOW_CONFIRMATION_MODAL_SELECTOR = 'div[role="dialog"][aria-label="Unfollow"]';

// Selector for the "Unfollow" button *within* the unfollow confirmation modal.
// Look for the button confirming the unfollow action inside the modal.
// Example: A button within the modal that has "Unfollow" text.
const UNFOLLOW_CONFIRMATION_BUTTON_SELECTOR = `${UNFOLLOW_CONFIRMATION_MODAL_SELECTOR} button._a9--._a9_1`; // Example: Adapt to the button structure within the modal

// Selector for "Action Blocked" or similar warning modals/messages
// These are harder to generalize, look for common text content or modal structures.
const ACTION_BLOCKED_SELECTOR = 'div[role="dialog"] h3, button[aria-label="OK"][tabindex="0"]'; // Example: Looks for dialogs with a header or generic OK button

// --- State and Control ---
let isAutomationRunning = false;
let automationType = null; // 'follow' or 'unfollow'
let processedUsernames = new Set(); // Keep track of users we've attempted to action in this session
let targetsFound = []; // Array of DOM elements that are potential targets
let targetIndex = 0; // Current index in the targetsFound array

// --- Mutation Observer ---
// Used to detect when new elements are added to the DOM, like during infinite scroll.
let observer = null;

function setupMutationObserver() {
    const container = document.querySelector(USER_LIST_CONTAINER_SELECTOR);
    if (!container) {
        console.warn("MutationObserver: User list container not found.");
        // Attempt to find targets without the observer if container isn't immediately available
        findAllTargets();
        return;
    }

    observer = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                console.log("Mutation Observer: New nodes added.");
                // Re-evaluate targets when new nodes appear.
                // We don't necessarily need to find all again, but can process new nodes.
                // For simplicity, we'll re-scan, ensuring we don't add duplicates based on username.
                if (isAutomationRunning) {
                    findAllTargets(); // Re-find targets to potentially add new ones
                }
            }
        });
    });

    // Start observing the container for changes in its children.
    observer.observe(container, { childList: true, subtree: true });
    console.log("Mutation Observer activated on:", container);
}

function disconnectMutationObserver() {
    if (observer) {
        observer.disconnect();
        observer = null;
        console.log("Mutation Observer disconnected.");
    }
}

// --- Core Logic Functions ---

/
 * Finds all potential user list item elements on the current page/view.
 * Filters out elements that have already been processed or don't have the correct button state.
 */
function findAllTargets() {
    if (!isAutomationRunning) {
        console.info("Automation not running, skipping target finding.");
        return;
    }

    console.log(`Finding targets for automation type: ${automationType}`);
    const listItems = document.querySelectorAll(USER_LIST_ITEM_SELECTOR);
    console.log(`Found ${listItems.length} potential list items.`);

    const newTargets = [];
    listItems.forEach(item => {
        try {
            // Attempt to get the username associated with the list item
            // Look for a link with the user's handle in text or href
            const usernameElement = item.querySelector('a[role="link"]') || item.querySelector('a');
            const username = usernameElement ? usernameElement.innerText.trim() || usernameElement.href.split("/")[3] : null;

            if (!username || processedUsernames.has(username)) {
                // Skip if no username found or already processed
                return;
            }

            const actionButton = item.querySelector(ACTION_BUTTON_SELECTOR);
            if (!actionButton) {
                // Skip if no button found in the list item
                console.warn(`No action button found in list item for user: ${username}`);
                // Mark as processed to avoid repeated checks on this item in the same session
                processedUsernames.add(username);
                chrome.runtime.sendMessage({
                    status: 'userSkipped',
                    username: username,
                    details: 'No action button found'
                }).catch(e => console.error("Error sending message:", e));
                return;
            }

            const buttonText = actionButton.innerText.trim().toLowerCase();
            const isFollowButton = buttonText === 'follow';
            const isFollowingButton = buttonText === 'following' || buttonText === 'requested'; // 'requested' also means unfollowable for now

            let shouldTarget = false;
            if (automationType === 'follow' && isFollowButton) {
                shouldTarget = true;
            } else if (automationType === 'unfollow' && isFollowingButton) {
                shouldTarget = true;
            }

            if (shouldTarget) {
                // Check if this specific item (or at least its username) has already been added as a target
                // We check against processedUsernames to handle re-renders or observer calls
                if (!targetsFound.some(target => target.item === item)) {
                     newTargets.push({ item: item, button: actionButton, username: username });
                     console.log(`Found target: ${automationType} button for ${username}`);
                }
            } else {
                 // If it's the wrong button type or already followed/not following,
                 // mark as processed to avoid re-evaluating constantly.
                 processedUsernames.add(username);
            }

        } catch (error) {
            console.error("Error processing list item:", error);
            // Report potential error item
            // Can also mark with a temporary attribute to skip next time
            item.setAttribute('data-processing-error', 'true');
             chrome.runtime.sendMessage({
                 status: 'error',
                 type: 'domParsingError',
                 details: `Error processing list item: ${error.message}`,
                 html: item.innerHTML.substring(0, 200) // Send a snippet for debugging
             }).catch(e => console.error("Error sending message:", e));
        }
    });

    // Add only truly new targets to the main array
    newTargets.forEach(nT => {
        if (!targetsFound.some(e => e.username === nT.username)) {
             targetsFound.push(nT);
        }
    });


    console.log(`Total potential targets identified: ${targetsFound.length}`);

    // Report available targets back to background script, but only for context.
    // The background script drives which action to take.
}

/
 * Attempts to perform the specified action (follow/unfollow) on the next available target.
 * Scans for newly loaded elements if current targets are exhausted.
 */
async function performNextAction() {
    if (!isAutomationRunning || !automationType) {
        console.log("Automation not running or type not set. Stopping action loop.");
        reportStatus('idle');
        return;
    }

    // Ensure we have targets, re-scan if necessary, especially with dynamic loading
    if (targetIndex >= targetsFound.length) {
         console.log("Exhausted current targets. Scrolling or looking for more...");
         // Trigger a scroll action to load more content
         triggerScroll();
         // Brief delay to allow content to load before rescanning
         await new Promise(resolve => setTimeout(resolve, 1000)); // Adjust delay as needed

         findAllTargets(); // Find new targets after scrolling
         if (targetIndex >= targetsFound.length) {
            console.log("No new targets found after scrolling. Automation might be complete for this view.");
            reportStatus('completed', { message: 'No more targets found on screen.' });
            stopAutomation(); // Stop if no new targets appear
            return;
         }
    }

    const target = targetsFound[targetIndex];
    if (!target) {
         console.error("No target available at current index.");
         reportStatus('error', { type: 'noTargetAtIndex', details: `Target index ${targetIndex} out of bounds` });
         stopAutomation();
         return;
    }

    const { item, button, username } = target;

    // Double-check if the button state is still correct before clicking
    const currentButtonText = button.innerText.trim().toLowerCase();
    const isCorrectButton = (automationType === 'follow' && currentButtonText === 'follow') ||
                            (automationType === 'unfollow' && (currentButtonText === 'following' || currentButtonText === 'requested'));

    if (!isCorrectButton) {
        console.warn(`Button state changed for ${username}. Skipping.`);
        processedUsernames.add(username); // Mark as processed as it's no longer a valid target
        targetIndex++; // Move to next index
         chrome.runtime.sendMessage({
             status: 'userSkipped',
             username: username,
              details: `Button state changed to "${currentButtonText}"`
         }).catch(e => console.error("Error sending message:", e));
        // Immediately attempt the next action without waiting for background script
        // This prevents long pauses on skipped users.
        performNextAction();
        return;
    }

    if (processedUsernames.has(username)) {
         console.warn(`User ${username} already processed. Skipping.`);
         targetIndex++;
         performNextAction(); // Skip and move to next
         return;
    }

    console.log(`Attempting to ${automationType} user: ${username}`);

    try {
        button.click();
        processedUsernames.add(username); // Mark as processed AFTER attempting click

        // Handle potential unfollow confirmation modal
        if (automationType === 'unfollow') {
            // Give a brief moment for the modal to appear
            await new Promise(resolve => setTimeout(resolve, 500));
            const confirmationModal = document.querySelector(UNFOLLOW_CONFIRMATION_MODAL_SELECTOR);
            if (confirmationModal) {
                console.log("Unfollow confirmation modal detected, clicking confirm...");
                const confirmButton = confirmationModal.querySelector(UNFOLLOW_CONFIRMATION_BUTTON_SELECTOR);
                if (confirmButton) {
                    confirmButton.click();
                    console.log("Clicked unfollow confirmation.");
                } else {
                    console.warn("Unfollow confirmation button not found in modal.");
                    reportStatus('warning', {
                        type: 'unfollowModalButtonNotFound',
                        details: 'Confirmation modal appeared, but confirm button not found.',
                        username: username
                    });
                }
                 // Wait a bit for the modal to close
                 await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Check for immediate "Action Blocked" feedback (e.g., a quick modal appears)
        // This check is best done after a brief pause following the click
         await new Promise(resolve => setTimeout(resolve, 100)); // Small delay to let UI update
         const actionBlocked = document.querySelector(ACTION_BLOCKED_SELECTOR);
         if (actionBlocked) {
              console.warn("Action Blocked modal or element detected!");
              reportStatus('actionBlocked', { username: username });
              stopAutomation(); // Immediately stop automation
              return; // Stop further action execution
         }


        console.log(`Successfully attempted ${automationType} action for ${username}.`);
        reportStatus('actionCompleted', {
            actionType: automationType,
            username: username,
            success: true // Assume success unless 'actionBlocked' or subsequent error
        });

        targetIndex++; // Move to the next target for the next turn

        // The background script will send the next 'performAction' message after its delay/pause logic.

    } catch (error) {
        console.error(`Error clicking action button for ${username}:`, error);
        reportStatus('error', {
            type: 'clickError',
            details: error.message,
            username: username,
            actionType: automationType
        });
        // Don't mark as processed if click failed, maybe retry later or user handles manually
        // processedUsernames.add(username); // Decide if you want to skip on click error
        targetIndex++; // Move to the next, might be best to skip failed elements

        // The background script needs to decide whether to continue or stop after an error.
        // We just report and wait for the next instruction.
    }
}

/
 * Attempts to scroll the user list container to load more items.
 */
function triggerScroll() {
    const container = document.querySelector(USER_LIST_CONTAINER_SELECTOR);
     if (container) {
         console.log("Scrolling user list container...");
         // Scroll to the bottom of the container
         container.scrollTop = container.scrollHeight;
     } else {
         console.warn("Could not find scrollable user list container for scrolling.");
     }
}


// --- Communication with Background Script ---

/
 * Sends a status update message to the background script.
 * @param {string} status - The status type (e.g., 'ready', 'running', 'paused', 'actionCompleted', 'error', 'actionBlocked', 'userSkipped', 'completed').
 * @param {object} [payload] - Additional data to send with the status.
 */
function reportStatus(status, payload = {}) {
    chrome.runtime.sendMessage({ status: status, ...payload })
        .catch(error => {
            // This catch handles errors if the background script is no longer listening
            // (e.g., service worker stopped or page closed)
            console.error("Error sending status message to background script:", error);
            // If background communication fails, stop automation in content script
            isAutomationRunning = false;
            automationType = null;
            targetsFound = [];
            targetIndex = 0;
           processedUsernames.clear();
            disconnectMutationObserver();
        });
}

/
 * Starts the automation process in the content script.
 * Initiates target finding and sets up the mutation observer.
 */
function startAutomation(type) {
    if (isAutomationRunning) {
        console.log("Automation is already running.");
        reportStatus('warning', { type: 'alreadyRunning' });
        return;
    }
    console.log(`Starting automation type: ${type}`);
    isAutomationRunning = true;
    automationType = type;
    processedUsernames.clear(); // Reset processed users for a new session
    targetsFound = []; // Clear previous targets
    targetIndex = 0;

    setupMutationObserver(); // Set up observer to detect new elements
    findAllTargets(); // Initial scan for targets

    // If no targets initially found, report and potentialy stop.
    // The background script should handle this logic and decide whether to try scrolling
    // or give up based on its overall strategy.
    if (targetsFound.length === 0) {
        console.warn("No initial targets found. Will rely on observer/scrolling.");
        // reportStatus('warning', { type: 'noInitialTargets' }); // Can report this if needed
        // Continue, as scrolling might reveal targets.
    }

    reportStatus('running', { actionType: automationType });
}

/
 * Stops the automation process in the content script.
 * Clears state and disconnects the mutation observer.
 */
function stopAutomation() {
    console.log("Stopping automation in content script.");
    isAutomationRunning = false;
    automationType = null;
    targetsFound = [];
    targetIndex = 0;
   processedUsernames.clear(); // Clear processed users on full stop
    disconnectMutationObserver();
    reportStatus('stopped');
}


// --- Message Listener ---
// Listens for messages from the background script.
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Content script received message:", request);

    // Handle different commands from the background script
    if (request.command === 'startAutomation') {
        startAutomation(request.actionType);
        sendResponse({ status: 'received_start_command' }); // Acknowledge receipt
    } else if (request.command === 'stopAutomation') {
        stopAutomation();
        sendResponse({ status: 'received_stop_command' }); // Acknowledge receipt
    } else if (request.command === 'performAction') {
         // The background script tells us *when* to perform the next action.
         // We just need to find the next valid target and click it.
         if (isAutomationRunning) {
              performNextAction();
              sendResponse({ status: 'received_perform_action' }); // Acknowledge receipt
         } else {
              console.warn("Received 'performAction' command but automation is not running.");
              sendResponse({ status: 'not_running' });
         }
    } else if (request.command === 'findAllTargets') {
         // Command to explicitly scan for targets and report back (might be useful for UI preview)
         findAllTargets(); // Update internal targetsFound list
         // Report back the found targets (or just the count/usernames)
         const targetDetails = targetsFound.map(t => ({ username: t.username, actionType: automationType }));
         reportStatus('targetsFound', { count: targetsFound.length, targets: targetDetails });
         sendResponse({ status: 'targets_reported' });
    } else if (request.command === 'getStatus') {
         sendResponse({
              status: isAutomationRunning ? 'running' : 'idle',
              actionType: automationType,
              targetCount: targetsFound.length,
              targetIndex: targetIndex,
              processedCount: processedUsernames.size
         });
     }
    // Always return true to indicate that you wish to send a response asynchronously
    return true;
});


// Initial setup when the content script is injected.
// We don't start automation automatically, we wait for a message from the popup/background.
// But we can report that the content script is ready.
reportStatus('ready');
```