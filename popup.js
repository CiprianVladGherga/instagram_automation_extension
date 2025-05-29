/**
 * popup.js - Instagram Automation Extension Popup Logic
 * Handles UI interactions, settings management, and communication with background script
 */

// DOM Elements
const elements = {
    // Status elements
    statusIndicator: document.getElementById('statusIndicator'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    statusDetails: document.getElementById('statusDetails'),
    
    // Count displays
    sessionCount: document.getElementById('sessionCount'),
    todayCount: document.getElementById('todayCount'),
    targetCount: document.getElementById('targetCount'),
    currentIndex: document.getElementById('currentIndex'),
    
    // Form inputs
    followRadio: document.getElementById('followRadio'),
    unfollowRadio: document.getElementById('unfollowRadio'),
    intervalMin: document.getElementById('intervalMin'),
    intervalMax: document.getElementById('intervalMax'),
    actionsPerBatch: document.getElementById('actionsPerBatch'),
    dailyLimit: document.getElementById('dailyLimit'),
    pauseMin: document.getElementById('pauseMin'),
    pauseMax: document.getElementById('pauseMax'),
    
    // Control buttons
    startBtn: document.getElementById('startBtn'),
    stopBtn: document.getElementById('stopBtn')
};

// State variables
let currentSettings = {};
let currentStatus = {};
let isLoading = false;

/**
 * Initialize the popup when DOM is loaded
 */
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Popup initialized');
    
    // Set up event listeners
    setupEventListeners();
    
    // Load initial data
    await loadSettingsAndStatus();
    
    // Set up message listener for background script updates
    setupMessageListener();
});

/**
 * Set up all event listeners for the popup
 */
function setupEventListeners() {
    // Control buttons
    elements.startBtn.addEventListener('click', handleStartAutomation);
    elements.stopBtn.addEventListener('click', handleStopAutomation);
    
    // Settings input changes - debounced save
    const settingsInputs = [
        elements.intervalMin, elements.intervalMax, elements.actionsPerBatch,
        elements.dailyLimit, elements.pauseMin, elements.pauseMax,
        elements.followRadio, elements.unfollowRadio
    ];
    
    settingsInputs.forEach(input => {
        input.addEventListener('change', debounce(handleSettingsChange, 500));
        if (input.type === 'number') {
            input.addEventListener('input', debounce(handleSettingsChange, 1000));
        }
    });
    
    // Validation for min/max pairs
    elements.intervalMin.addEventListener('input', validateIntervalPair);
    elements.intervalMax.addEventListener('input', validateIntervalPair);
    elements.pauseMin.addEventListener('input', validatePausePair);
    elements.pauseMax.addEventListener('input', validatePausePair);
}

/**
 * Set up listener for messages from background script
 */
function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        console.log('Popup received message:', message);
        
        if (message.type === 'statusUpdate') {
            updateStatusDisplay(message.payload);
            sendResponse({ received: true });
        }
        
        return true; // Keep message channel open for async response
    });
}

/**
 * Load settings and status from background script
 */
async function loadSettingsAndStatus() {
    try {
        isLoading = true;
        updateLoadingState(true);
        
        // Get settings from background
        const settingsResponse = await sendMessageToBackground({ command: 'getSettings' });
        if (settingsResponse && settingsResponse.settings) {
            currentSettings = settingsResponse.settings;
            updateSettingsUI(currentSettings);
        }
        
        // Get status from background
        const statusResponse = await sendMessageToBackground({ command: 'getStatus' });
        if (statusResponse) {
            currentStatus = statusResponse;
            updateStatusDisplay(statusResponse);
        }
        
    } catch (error) {
        console.error('Error loading settings and status:', error);
        showError('Failed to load settings. Please try again.');
    } finally {
        isLoading = false;
        updateLoadingState(false);
    }
}

/**
 * Update the settings UI with current values
 */
function updateSettingsUI(settings) {
    elements.intervalMin.value = settings.intervalMin || 5;
    elements.intervalMax.value = settings.intervalMax || 10;
    elements.actionsPerBatch.value = settings.actionsPerBatch || 10;
    elements.dailyLimit.value = settings.dailyLimit || 100;
    elements.pauseMin.value = Math.floor((settings.pauseBetweenBatchesMin || 300) / 60);
    elements.pauseMax.value = Math.floor((settings.pauseBetweenBatchesMax || 600) / 60);
    
    console.log('Settings UI updated with:', settings);
}

/**
 * Update the status display with current automation state
 */
function updateStatusDisplay(status) {
    currentStatus = status;
    
    // Update status indicator
    const isActive = status.isActive || false;
    const isPaused = status.isPausedForBatch || false;
    
    elements.statusDot.className = `status-dot ${getStatusClass(isActive, isPaused)}`;
    elements.statusText.textContent = getStatusText(isActive, isPaused);
    
    // Update counts
    elements.sessionCount.textContent = status.sessionProcessedCount || 0;
    elements.todayCount.textContent = status.processedToday || 0;
    elements.targetCount.textContent = status.currentTargetCount || 0;
    elements.currentIndex.textContent = status.currentIndex || 0;
    
    // Update detailed status
    elements.statusDetails.textContent = status.statusText || 'Ready to start automation';
    
    // Update button states
    updateButtonStates(isActive, isPaused);
    
    console.log('Status display updated:', status);
}

/**
 * Get CSS class for status dot based on automation state
 */
function getStatusClass(isActive, isPaused) {
    if (!isActive && !isPaused) return 'idle';
    if (isPaused) return 'paused';
    if (isActive) return 'running';
    return 'idle';
}

/**
 * Get status text based on automation state
 */
function getStatusText(isActive, isPaused) {
    if (!isActive && !isPaused) return 'Idle';
    if (isPaused) return 'Paused';
    if (isActive) return 'Running';
    return 'Idle';
}

/**
 * Update button states based on automation status
 */
function updateButtonStates(isActive, isPaused) {
    const isRunning = isActive || isPaused;
    
    elements.startBtn.disabled = isRunning || isLoading;
    elements.stopBtn.disabled = !isRunning || isLoading;
    
    // Update button text based on state
    if (isLoading) {
        elements.startBtn.innerHTML = '<span class="btn-icon">⏳</span>Loading...';
    } else {
        elements.startBtn.innerHTML = '<span class="btn-icon">▶</span>Start';
    }
}

/**
 * Update loading state UI
 */
function updateLoadingState(loading) {
    if (loading) {
        document.body.classList.add('loading');
    } else {
        document.body.classList.remove('loading');
    }
    updateButtonStates(currentStatus.isActive, currentStatus.isPausedForBatch);
}

/**
 * Handle start automation button click
 */
async function handleStartAutomation() {
    try {
        const actionType = elements.followRadio.checked ? 'follow' : 'unfollow';
        
        // Validate settings before starting
        if (!validateAllSettings()) {
            return;
        }
        
        // Save current settings first
        await handleSettingsChange();
        
        // Send start command to background
        updateLoadingState(true);
        const response = await sendMessageToBackground({
            command: 'startAutomation',
            actionType: actionType
        });
        
        if (response && response.status === 'acknowledged') {
            console.log('Automation start command sent successfully');
        } else {
            throw new Error('Failed to start automation');
        }
        
    } catch (error) {
        console.error('Error starting automation:', error);
        showError('Failed to start automation. Make sure you\'re on an Instagram page.');
    } finally {
        updateLoadingState(false);
    }
}

/**
 * Handle stop automation button click
 */
async function handleStopAutomation() {
    try {
        updateLoadingState(true);
        const response = await sendMessageToBackground({ command: 'stopAutomation' });
        
        if (response && response.status === 'acknowledged') {
            console.log('Automation stop command sent successfully');
        } else {
            throw new Error('Failed to stop automation');
        }
        
    } catch (error) {
        console.error('Error stopping automation:', error);
        showError('Failed to stop automation');
    } finally {
        updateLoadingState(false);
    }
}

/**
 * Handle settings changes and save to background
 */
async function handleSettingsChange() {
    if (isLoading) return;
    
    try {
        const newSettings = {
            intervalMin: parseInt(elements.intervalMin.value) || 5,
            intervalMax: parseInt(elements.intervalMax.value) || 10,
            actionsPerBatch: parseInt(elements.actionsPerBatch.value) || 10,
            dailyLimit: parseInt(elements.dailyLimit.value) || 100,
            pauseBetweenBatchesMin: (parseInt(elements.pauseMin.value) || 5) * 60,
            pauseBetweenBatchesMax: (parseInt(elements.pauseMax.value) || 10) * 60
        };
        
        // Validate settings
        if (!validateSettings(newSettings)) {
            return;
        }
        
        const response = await sendMessageToBackground({
            command: 'saveSettings',
            settings: newSettings
        });
        
        if (response && response.status === 'acknowledged') {
            currentSettings = { ...currentSettings, ...newSettings };
            console.log('Settings saved successfully:', newSettings);
        }
        
    } catch (error) {
        console.error('Error saving settings:', error);
        showError('Failed to save settings');
    }
}

/**
 * Validate all settings before starting automation
 */
function validateAllSettings() {
    const settings = {
        intervalMin: parseInt(elements.intervalMin.value),
        intervalMax: parseInt(elements.intervalMax.value),
        actionsPerBatch: parseInt(elements.actionsPerBatch.value),
        dailyLimit: parseInt(elements
dailyLimit.value),
        pauseBetweenBatchesMin: (parseInt(elements.pauseMin.value) || 5) * 60,
        pauseBetweenBatchesMax: (parseInt(elements.pauseMax.value) || 10) * 60
    };
    
    return validateSettings(settings);
}

/**
 * Validate settings object
 */
function validateSettings(settings) {
    // Check for valid numbers
    if (isNaN(settings.intervalMin) || isNaN(settings.intervalMax) || 
        isNaN(settings.actionsPerBatch) || isNaN(settings.dailyLimit)) {
        showError('All settings must be valid numbers');
        return false;
    }
    
    // Check min/max relationships
    if (settings.intervalMin >= settings.intervalMax) {
        showError('Maximum interval must be greater than minimum interval');
        return false;
    }
    
    if (settings.pauseBetweenBatchesMin >= settings.pauseBetweenBatchesMax) {
        showError('Maximum pause must be greater than minimum pause');
        return false;
    }
    
    // Check reasonable limits
    if (settings.intervalMin < 2) {
        showError('Minimum interval should be at least 2 seconds');
        return false;
    }
    
    if (settings.actionsPerBatch > 50) {
        showError('Actions per batch should not exceed 50');
        return false;
    }
    
    if (settings.dailyLimit > 500) {
        showError('Daily limit should not exceed 500 for safety');
        return false;
    }
    
    return true;
}

/**
 * Validate interval min/max pair
 */
function validateIntervalPair() {
    const min = parseInt(elements.intervalMin.value);
    const max = parseInt(elements.intervalMax.value);
    
    if (min >= max) {
        elements.intervalMax.value = min + 1;
    }
}

/**
 * Validate pause min/max pair
 */
function validatePausePair() {
    const min = parseInt(elements.pauseMin.value);
    const max = parseInt(elements.pauseMax.value);
    
    if (min >= max) {
        elements.pauseMax.value = min + 1;
    }
}

/**
 * Send message to background script
 */
function sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                resolve(response);
            }
        });
    });
}

/**
 * Show error message to user
 */
function showError(message) {
    elements.statusDetails.textContent = `Error: ${message}`;
    elements.statusDetails.classList.add('error');
    
    // Remove error class after 5 seconds
    setTimeout(() => {
        elements.statusDetails.classList.remove('error');
    }, 5000);
}

/**
 * Debounce function to limit frequent calls
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Handle popup window focus to refresh status
 */
window.addEventListener('focus', () => {
    // Refresh status when popup is focused
    loadSettingsAndStatus();
});

// Initialize popup
console.log('Popup script loaded');
