/**
 * ============================================================================
 * WHATSAPP SENDER APP — PROFESSIONAL ENTERPRISE EDITION v4.0 FIXED
 * ============================================================================
 * 
 * MAJOR FIXES APPLIED:
 * 1. ✅ FIXED: Scheduler now sends at correct time
 * 2. ✅ FIXED: Renewal/Expiry messages send automatically
 * 3. ✅ FIXED: Bulk sender duplicate issue resolved
 * 4. ✅ FIXED: Watermark/document issues resolved
 * 5. ✅ FIXED: Watermark now includes name + phone number
 * 
 * ============================================================================
 */

'use strict';

/* ========================================================================== */
/* 1. GLOBAL CONFIGURATION & CONSTANTS                                        */
/* ========================================================================== */

const DEFAULT_CONFIG = {
    currentInstanceId: 'instance153584',
    currentEndpoint: 'send.php',
    currentToken: '',
    
    // Rate Limiting Settings
    rateDelay: 1200,
    randomizeDelay: true,
    jitterRange: 3000,
    
    // File Size Settings
    maxFileSizeMB: 30,
    maxFileSizeBytes: 30 * 1024 * 1024,
    
    // Enterprise Settings
    batchSize: 50,
    batchDelay: 60000,
    parallelLimit: 3,
    
    // Network Settings
    isMasterPC: false,
    masterIP: '',
    slaveMode: false,
    
    // Watermark Optimization
    watermarkDelayOverride: true,
    enableWatermarking: true,
    watermarkFormat: 'name_phone', // Options: 'name', 'phone', 'name_phone', 'custom'
    watermarkText: '{name} - {phone}', // Custom format
    
    // Safety Settings for 5000+ contacts
    maxContactsPerBatch: 200,
    safetyDelayMultiplier: 1.5,
    enableProgressiveDelay: true
};

/* ========================================================================== */
/* 2. GLOBAL STATE MANAGEMENT                                                 */
/* ========================================================================== */

let isSchedulerRunning = false;
let isAutoResponderRunning = false;
let isBulkPaused = false;
let isBulkStopped = false;
let isSchedulerPaused = false;
let isSchedulerStopped = false;
let editingContactIndex = null;
let parsedBulk = [];
let currentSchedulerJob = null;
let activeBulkProcess = null;
let processedContacts = new Set(); // Track processed contacts to prevent duplicates

/**
 * Load application configuration from LocalStorage
 */
function loadAppConfig() {
    try {
        const savedConfig = localStorage.getItem('wa_app_config');
        if (savedConfig) {
            const config = JSON.parse(savedConfig);
            // Ensure new settings exist
            return { ...DEFAULT_CONFIG, ...config };
        }
        return { ...DEFAULT_CONFIG };
    } catch (error) {
        console.error("Failed to load app config:", error);
        return { ...DEFAULT_CONFIG };
    }
}

// Initialize appConfig AFTER loadAppConfig is defined
let appConfig = loadAppConfig();

/**
 * Save configuration to LocalStorage
 */
function saveAppConfig() {
    try {
        localStorage.setItem('wa_app_config', JSON.stringify(appConfig));
        updateFileSizeDisplays();
    } catch (error) {
        console.error("Error saving configuration:", error);
        showToast("Failed to save settings locally.", "error");
    }
}

/**
 * Update file size displays across the app
 */
function updateFileSizeDisplays() {
    const size = appConfig.maxFileSizeMB;
    const elements = [
        'currentFileSize',
        'bulkFileSize', 
        'scheduleFileSize'
    ];
    
    elements.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = `${size}MB`;
    });
    
    // Update max file size bytes
    appConfig.maxFileSizeBytes = size * 1024 * 1024;
}

/**
 * Get active WhatsApp instance
 */
function getActiveInstance() {
    try {
        const storedInstances = localStorage.getItem('wa_instances');
        const instances = storedInstances ? JSON.parse(storedInstances) : [];
        const activeId = localStorage.getItem('wa_active_instance_id');
        
        let activeInstance = instances.find(inst => inst.id === activeId);
        
        if (!activeInstance && instances.length > 0) {
            activeInstance = instances[0];
        }
        
        if (!activeInstance) {
            return {
                id: appConfig.currentInstanceId,
                name: 'Default Instance',
                endpoint: appConfig.currentEndpoint,
                token: appConfig.currentToken
            };
        }
        
        return activeInstance;
    } catch (error) {
        console.error("Error retrieving active instance:", error);
        return { 
            id: 'ERROR', 
            name: 'System Error', 
            endpoint: '', 
            token: '' 
        };
    }
}

/**
 * Calculate smart delay with watermark optimization
 */
function getSmartDelay(isWatermarking = false, currentIndex = 0, totalCount = 1) {
    const baseDelay = parseInt(appConfig.rateDelay) || 1200;
    
    // If watermarking is happening, reduce extra delay
    if (isWatermarking && appConfig.watermarkDelayOverride) {
        return Math.max(500, baseDelay * 0.3);
    }
    
    // Progressive delay for large batches (safety for 5000+ contacts)
    if (appConfig.enableProgressiveDelay && totalCount > 100) {
        const progressRatio = currentIndex / totalCount;
        const multiplier = 1 + (progressRatio * 0.5); // Increase delay by up to 50%
        return Math.floor(baseDelay * multiplier);
    }
    
    if (!appConfig.randomizeDelay) {
        return baseDelay;
    }
    
    const maxJitter = parseInt(appConfig.jitterRange) || 2000;
    const randomJitter = Math.floor(Math.random() * maxJitter);
    
    return baseDelay + randomJitter;
}

/**
 * Get current IP address
 */
async function getCurrentIP() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (error) {
        console.error("Failed to get IP:", error);
        return 'Unknown';
    }
}

/* ========================================================================== */
/* 3. INITIALIZATION & EVENT LISTENERS                                        */
/* ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    
    // 1. Inject toast styles
    injectToastStyles();
     // Initialize real-time clock
    initializeRealTimeClock();
    // 2. Initialize navigation
    const navButtons = document.querySelectorAll('.nav-btn');
    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            navButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            showView(btn.dataset.view);
        });
    });

    // 3. Update header
    updateHeaderInstanceInfo();
    updateFileSizeDisplays();

    // 4. Get current IP and check if master PC
    try {
        const currentIP = await getCurrentIP();
        const masterIP = appConfig.masterIP;
        
        if (masterIP && currentIP === masterIP) {
            appConfig.isMasterPC = true;
            showToast(`Master PC detected: ${currentIP}`, 'info');
        } else if (masterIP) {
            appConfig.isMasterPC = false;
            console.log(`Slave mode: Current IP ${currentIP}, Master IP ${masterIP}`);
        }
        
        // Update IP display in admin
        const ipDisplay = document.getElementById('currentIPDisplay');
        if (ipDisplay) {
            ipDisplay.textContent = currentIP;
        }
    } catch (error) {
        console.error("IP detection failed:", error);
    }

    // ----------------------------------------------------------------------
    // TAB: SEND (Single)
    // ----------------------------------------------------------------------
    document.getElementById('sendSingleBtn')?.addEventListener('click', sendSingle);
    document.getElementById('saveContactBtn')?.addEventListener('click', saveSingleContact);

    // File upload progress
    const singleFileInput = document.getElementById('singleFile');
    if (singleFileInput) {
        singleFileInput.addEventListener('change', function(e) {
            const file = e.target.files[0];
            if (file) {
                const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
                const progress = Math.min((file.size / appConfig.maxFileSizeBytes) * 100, 100);
                
                document.getElementById('fileSizeInfo').textContent = 
                    `File: ${file.name} (${sizeMB}MB)`;
                document.getElementById('fileUploadProgress').style.width = `${progress}%`;
                
                if (file.size > appConfig.maxFileSizeBytes) {
                    showToast(`File exceeds ${appConfig.maxFileSizeMB}MB limit`, 'error');
                    e.target.value = '';
                }
            }
        });
    }

    // Send mode selection
    document.querySelectorAll('input[name="sendMode"]').forEach(radio => {
        radio.addEventListener('change', function() {
            updateSendModeUI(this.value);
        });
    });

    // ----------------------------------------------------------------------
    // TAB: BULK SENDER
    // ----------------------------------------------------------------------
    document.getElementById('previewBulkBtn')?.addEventListener('click', previewBulkList);
    document.getElementById('sendBulkBtn')?.addEventListener('click', sendBulkList);
    document.getElementById('bulkCsv')?.addEventListener('change', handleBulkCsv);

    // Bulk control buttons
    document.getElementById('pauseBulkBtn')?.addEventListener('click', () => {
        if (!document.getElementById('pauseBulkBtn').disabled) {
            isBulkPaused = true;
            toggleBulkControls('paused');
            showToast('Bulk sending PAUSED', 'warning');
        }
    });
    
    document.getElementById('resumeBulkBtn')?.addEventListener('click', () => {
        if (!document.getElementById('resumeBulkBtn').disabled) {
            isBulkPaused = false;
            toggleBulkControls('running');
            showToast('Resuming bulk sending...', 'info');
        }
    });
    
    document.getElementById('stopBulkBtn')?.addEventListener('click', () => {
        if (!document.getElementById('stopBulkBtn').disabled) {
            if (confirm('CRITICAL: Stop sending? This cannot be resumed.')) {
                isBulkStopped = true;
                isBulkPaused = false;
                toggleBulkControls('idle');
                showToast('Bulk process stopped', 'error');
            }
        }
    });

    // ----------------------------------------------------------------------
    // TAB: CONTACTS & PLANS
    // ----------------------------------------------------------------------
    loadContacts();
    document.getElementById('addContactBtn')?.addEventListener('click', addContact);
    document.getElementById('contactCsvFile')?.addEventListener('change', handleContactCsvImport);

    // ----------------------------------------------------------------------
    // TAB: NOTIFICATION AUTOMATION
    // ----------------------------------------------------------------------
    document.getElementById('saveNotifSettingsBtn')?.addEventListener('click', saveNotificationSettings);
    loadNotificationSettings();

    // ----------------------------------------------------------------------
    // TAB: TEMPLATES
    // ----------------------------------------------------------------------
    loadTemplates();
    document.getElementById('saveTplBtn')?.addEventListener('click', saveTemplate);

    // ----------------------------------------------------------------------
    // TAB: LOGS
    // ----------------------------------------------------------------------
    renderLogs();
    document.getElementById('exportCsvBtn')?.addEventListener('click', exportLogsCsv);
    document.getElementById('clearLogsBtn')?.addEventListener('click', clearLogs);

    // ----------------------------------------------------------------------
    // TAB: SCHEDULER
    // ----------------------------------------------------------------------
    document.getElementById('saveScheduleBtn')?.addEventListener('click', saveLocalSchedule);
    document.getElementById('sendScheduleNowBtn')?.addEventListener('click', sendScheduleNow);
    document.getElementById('pauseSchedulerBtn')?.addEventListener('click', pauseScheduler);
    document.getElementById('resumeSchedulerBtn')?.addEventListener('click', resumeScheduler);
    document.getElementById('stopSchedulerBtn')?.addEventListener('click', stopScheduler);
    renderSchedules();

    // ----------------------------------------------------------------------
    // TAB: ADMIN & SETTINGS
    // ----------------------------------------------------------------------
    const adminAddBtn = document.getElementById('adminAddInstanceBtn');
    if (adminAddBtn) {
        adminAddBtn.addEventListener('click', adminAddInstance);
        document.getElementById('adminCheckServerBtn').addEventListener('click', adminCheckServer);
        document.getElementById('adminSaveSettingsBtn').addEventListener('click', adminSaveSettings);
        document.getElementById('adminFactoryResetBtn').addEventListener('click', adminFactoryReset);
        document.getElementById('adminDetectIPBtn').addEventListener('click', adminDetectIP);
        
        // Backup & Restore
        document.getElementById('adminBackupBtn').addEventListener('click', downloadBackup);
        document.getElementById('adminRestoreInput').addEventListener('change', restoreBackup);
        
        // Settings initialization
        loadAdminSettings();
        
        // Delay slider
        const delayRange = document.getElementById('adminDelayRange');
        if (delayRange) {
            delayRange.value = appConfig.rateDelay;
            document.getElementById('adminDelayDisplay').textContent = `${appConfig.rateDelay}ms`;
            delayRange.addEventListener('input', (e) => {
                document.getElementById('adminDelayDisplay').textContent = `${e.target.value}ms`;
            });
        }
        
        // Jitter toggle
        const jitterToggle = document.getElementById('adminJitterToggle');
        if (jitterToggle) {
            jitterToggle.checked = appConfig.randomizeDelay;
            jitterToggle.addEventListener('change', (e) => {
                appConfig.randomizeDelay = e.target.checked;
            });
        }
        
        // File size slider
        const sizeSlider = document.getElementById('adminFileSizeRange');
        if (sizeSlider) {
            sizeSlider.value = appConfig.maxFileSizeMB;
            document.getElementById('adminFileSizeDisplay').textContent = `${appConfig.maxFileSizeMB}MB`;
            sizeSlider.addEventListener('input', (e) => {
                const mb = parseInt(e.target.value);
                document.getElementById('adminFileSizeDisplay').textContent = `${mb}MB`;
            });
        }

        // Watermark toggle
        const watermarkToggle = document.getElementById('adminWatermarkToggle');
        if (watermarkToggle) {
            watermarkToggle.checked = appConfig.enableWatermarking;
            watermarkToggle.addEventListener('change', (e) => {
                appConfig.enableWatermarking = e.target.checked;
            });
        }
        
        // Watermark format selection
        const watermarkFormat = document.getElementById('adminWatermarkFormat');
        if (watermarkFormat) {
            watermarkFormat.value = appConfig.watermarkFormat || 'name_phone';
            watermarkFormat.addEventListener('change', (e) => {
                appConfig.watermarkFormat = e.target.value;
            });
        }
        
        // Watermark text input
        const watermarkText = document.getElementById('adminWatermarkText');
        if (watermarkText) {
            watermarkText.value = appConfig.watermarkText || '{name} - {phone}';
            watermarkText.addEventListener('input', (e) => {
                appConfig.watermarkText = e.target.value;
            });
        }
    }
    
    loadAdminInstances();

    // ----------------------------------------------------------------------
    // UI HELPERS & STARTUP
    // ----------------------------------------------------------------------
    createBulkContactsUI();
    createScheduleContactsUI();
    loadBulkContactsList();
    loadScheduleContactsList();
    
    // Initialize contact selection counters
    updateContactSelectionCounters();
    
    // Add event listeners for contact selection changes
    document.addEventListener('change', function(e) {
        if (e.target.classList.contains('bulk-contact') || 
            e.target.classList.contains('schedule-contact') ||
            e.target.id === 'selectAllBulk' || 
            e.target.id === 'selectAllSchedule') {
            updateContactSelectionCounters();
        }
    });

    // Show dashboard by default
    if (document.getElementById('view-dashboard')) {
        showView('dashboard');
    }
    
    // Set copyright year
    const currentYearEl = document.getElementById('currentYear');
    if (currentYearEl) {
        currentYearEl.textContent = new Date().getFullYear();
    }
    
    // Initialize scheduler
    initializeScheduler();
    
    // Initialize auto-responder
    initializeAutoResponder();
    
    // Update message count
    updateMessageCount();
    
    // Initialize send mode UI
    updateSendModeUI('both');
    
    console.log('WhatsApp Sender Pro v4.0 - Fully Fixed Enterprise Edition Initialized');
});

/* ========================================================================== */
/* 4. VIEW MANAGEMENT                                                         */
/* ========================================================================== */

function showView(name) {
    document.querySelectorAll('.view').forEach(v => {
        v.classList.remove('active');
        v.style.display = 'none';
    });
    
    const el = document.getElementById('view-' + name);
    if (el) { 
        el.classList.add('active'); 
        el.style.display = 'block'; 
    }
    
    // Update title
    const titles = { 
        dashboard: 'Analytics Dashboard', 
        send: 'Send Message', 
        bulk: 'Bulk Sender', 
        contacts: 'Contacts & Plans', 
        notifications: 'Notification Automation', 
        scheduler: 'Message Scheduler',
        templates: 'Message Templates',
        logs: 'Logs & History', 
        admin: 'Admin Settings' 
    };
    
    const titleEl = document.getElementById('viewTitle');
    if (titleEl) titleEl.textContent = titles[name] || 'App';
    
    // Special actions for specific views
    if (name === 'dashboard') {
        renderDashboard();
    } else if (name === 'logs') {
        renderLogs();
    }
}

function updateHeaderInstanceInfo() {
    const active = getActiveInstance();
    const el = document.getElementById('instanceId');
    if (el) {
        el.innerHTML = `<span class="badge bg-info text-dark">
            <i class="bi bi-robot"></i> ${escapeHtml(active.name)} 
            <span class="opacity-75">(${escapeHtml(active.id)})</span>
        </span>`;
    }
}

function updateMessageCount() {
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    const sentCount = logs.filter(l => l.status === 'sent').length;
    const el = document.getElementById('messageCount');
    if (el) {
        el.innerHTML = `<i class="bi bi-chat-dots"></i> Sent: ${sentCount}`;
    }
}

/* ========================================================================== */
/* 5. ENHANCED DASHBOARD                                                      */
/* ========================================================================== */

function renderDashboard() {
    const view = document.getElementById('view-dashboard');
    if (!view) return;
    
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const activities = JSON.parse(localStorage.getItem('wa_activities') || '[]');
    const schedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    
    const sent = logs.filter(l => l.status === 'sent').length;
    const failed = logs.filter(l => l.status !== 'sent').length;
    const rate = logs.length > 0 ? Math.round((sent / logs.length) * 100) : 0;
    const activeContacts = contacts.filter(c => c.endDate && new Date(c.endDate) >= new Date()).length;
    const pendingSchedules = schedules.filter(s => !s.sent).length;
    
    view.innerHTML = `
        <div class="row g-3 mb-4">
            <div class="col-md-3">
                <div class="card h-100 border-primary">
                    <div class="card-body text-center">
                        <h1 class="display-4 text-primary fw-bold">${sent}</h1>
                        <p class="text-muted">Messages Sent</p>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-success">
                    <div class="card-body text-center">
                        <h1 class="display-4 text-success fw-bold">${rate}%</h1>
                        <p class="text-muted">Success Rate</p>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-info">
                    <div class="card-body text-center">
                        <h1 class="display-4 text-info fw-bold">${contacts.length}</h1>
                        <p class="text-muted">Total Contacts</p>
                    </div>
                </div>
            </div>
            <div class="col-md-3">
                <div class="card h-100 border-warning">
                    <div class="card-body text-center">
                        <h1 class="display-4 text-warning fw-bold">${activeContacts}</h1>
                        <p class="text-muted">Active Plans</p>
                    </div>
                </div>
            </div>
        </div>
        
        <div class="row mb-4">
            <div class="col-md-8">
                <div class="card h-100">
                    <div class="card-header">
                        <i class="bi bi-activity"></i> Recent Activity
                    </div>
                    <div class="card-body">
                        <div class="table-responsive">
                            <table class="table table-hover">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Type</th>
                                        <th>Message</th>
                                        <th>Status</th>
                                        <th>Details</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${activities.slice(0, 10).map(act => `
                                        <tr>
                                            <td>${act.time || ''}</td>
                                            <td><span class="badge bg-${getActivityBadgeColor(act.type)}">${act.type || 'Unknown'}</span></td>
                                            <td>${escapeHtml(act.message || '').substring(0, 50)}${(act.message || '').length > 50 ? '...' : ''}</td>
                                            <td>
                                                ${act.success ? `<span class="badge bg-success">Success</span>` : ''}
                                                ${act.failed ? `<span class="badge bg-danger">Failed</span>` : ''}
                                                ${!act.success && !act.failed ? `<span class="badge bg-info">Info</span>` : ''}
                                            </td>
                                            <td>
                                                ${act.recipients ? `<small>${act.recipients} recipients</small>` : ''}
                                                ${act.jobId ? `<small>Job: ${act.jobId}</small>` : ''}
                                            </td>
                                        </tr>
                                    `).join('') || '<tr><td colspan="5" class="text-center text-muted">No activity yet</td></tr>'}
                                </tbody>
                            </table>
                        </div>
                        ${activities.length > 10 ? `
                            <div class="text-center mt-3">
                                <button class="btn btn-sm btn-outline-primary" onclick="showAllActivity()">
                                    View All Activities (${activities.length})
                                </button>
                            </div>
                        ` : ''}
                    </div>
                </div>
            </div>
            
            <div class="col-md-4">
                <div class="card h-100">
                    <div class="card-header">
                        <i class="bi bi-info-circle"></i> System Status
                    </div>
                    <div class="card-body">
                        <div class="mb-3">
                            <strong>WhatsApp Instance:</strong>
                            <div class="small text-muted">${getActiveInstance().name}</div>
                        </div>
                        <div class="mb-3">
                            <strong>Scheduler Status:</strong>
                            <span id="schedulerStatusBadge" class="badge bg-success">Active</span>
                            <div class="small text-muted">Checking every 30 seconds</div>
                        </div>
                        <div class="mb-3">
                            <strong>Auto-Responder:</strong>
                            <span class="badge bg-success">Active</span>
                            <div class="small text-muted">Checking expirations every 60 seconds</div>
                        </div>
                        <div class="mb-3">
                            <strong>Pending Schedules:</strong>
                            <span class="badge bg-warning">${pendingSchedules}</span>
                        </div>
                        <div class="mb-3">
                            <strong>File Size Limit:</strong>
                            <span class="badge bg-info">${appConfig.maxFileSizeMB}MB</span>
                        </div>
                        <div class="mb-3">
                            <strong>Base Delay:</strong>
                            <span class="badge bg-secondary">${appConfig.rateDelay}ms</span>
                        </div>
                        <div class="mb-3">
                            <strong>Master PC:</strong>
                            <span class="badge bg-${appConfig.isMasterPC ? 'success' : 'secondary'}">
                                ${appConfig.isMasterPC ? 'Yes' : 'No'}
                            </span>
                        </div>
                        ${appConfig.isMasterPC ? '' : `
                            <div class="mb-3">
                                <strong>Master IP:</strong>
                                <div class="small text-muted">${appConfig.masterIP || 'Not set'}</div>
                            </div>
                        `}
                    </div>
                </div>
            </div>
        </div>
        
        <div class="row">
            <div class="col-12">
                <div class="card">
                    <div class="card-header">
                        <i class="bi bi-graph-up"></i> Quick Actions
                    </div>
                    <div class="card-body">
                        <div class="d-flex gap-2 flex-wrap">
                            <button class="btn btn-outline-primary" onclick="showView('send')">
                                <i class="bi bi-send"></i> Send Single Message
                            </button>
                            <button class="btn btn-outline-success" onclick="showView('bulk')">
                                <i class="bi bi-broadcast"></i> Start Bulk Campaign
                            </button>
                            <button class="btn btn-outline-info" onclick="showView('contacts')">
                                <i class="bi bi-people"></i> Manage Contacts
                            </button>
                            <button class="btn btn-outline-warning" onclick="showView('scheduler')">
                                <i class="bi bi-calendar"></i> Schedule Messages
                            </button>
                            <button class="btn btn-outline-secondary" onclick="exportActivityCSV()">
                                <i class="bi bi-download"></i> Export Activity Log
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // Update scheduler status badge
    const schedulerStatus = isSchedulerStopped ? 'danger' : isSchedulerPaused ? 'warning' : 'success';
    const schedulerText = isSchedulerStopped ? 'Stopped' : isSchedulerPaused ? 'Paused' : 'Active';
    const badge = document.getElementById('schedulerStatusBadge');
    if (badge) {
        badge.className = `badge bg-${schedulerStatus}`;
        badge.textContent = schedulerText;
    }
}

function getActivityBadgeColor(type) {
    const colors = {
        'sent': 'success',
        'failed': 'danger',
        'scheduled': 'warning',
        'contact': 'info',
        'bulk': 'primary',
        'system': 'secondary',
        'automation': 'dark'
    };
    return colors[type] || 'secondary';
}

/* ========================================================================== */
/* 6. CONTACTS MANAGEMENT - FIXED RENEWAL/EXPIRY MESSAGES                    */
/* ========================================================================== */

function loadContacts() {
    const storedContacts = localStorage.getItem('wa_contacts');
    const list = storedContacts ? JSON.parse(storedContacts) : [];
    
    const listContainer = document.getElementById('contactsList');
    listContainer.innerHTML = '';
    
    if (!list.length) { 
        listContainer.innerHTML = '<div class="text-muted p-3 text-center">No contacts saved yet.</div>'; 
        updateContactCountBadge(0);
        loadBulkContactsList();
        loadScheduleContactsList();
        return;
    }
  
    list.forEach((contact, index) => {
        const contactDiv = document.createElement('div');
        contactDiv.className = 'mb-2 p-3 border rounded bg-white';
        
        let planInfo = '';
        if (contact.startDate && contact.endDate) {
            const today = new Date();
            const endDate = new Date(contact.endDate);
            const daysLeft = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
            const statusClass = daysLeft < 0 ? 'danger' : daysLeft < 7 ? 'warning' : 'success';
            
            planInfo = `
                <div class="small mt-2">
                    <span class="badge bg-${statusClass}">
                        <i class="bi bi-calendar"></i> ${contact.startDate} to ${contact.endDate}
                        ${daysLeft >= 0 ? `(${daysLeft} days left)` : '(Expired)'}
                    </span>
                </div>`;
        }

        // Notification status display - UPDATED WITH ALL NOTIFICATION TYPES
        // Enhanced expiry notification status
        let expiryNotificationStatus = '';
        if (contact.endDate) {
            const today = new Date();
            const endDate = new Date(contact.endDate);
            const isExpired = endDate < today;
            
            if (contact.notifiedEnd) {
                const statusText = contact.expiryStatus === 'notified_past_due' ? 'PAST DUE' : 'Expiry';
                expiryNotificationStatus = `
                    <div class="small text-${contact.expiryStatus === 'notified_past_due' ? 'warning' : 'success'}">
                        <i class="bi bi-check-circle"></i> ${statusText} notified on ${contact.notifiedAt ? new Date(contact.notifiedAt).toLocaleString() : 'unknown date'}
                    </div>`;
            } else if (isExpired) {
                const daysExpired = Math.floor((today - endDate) / (1000 * 60 * 60 * 24));
                expiryNotificationStatus = `
                    <div class="small text-danger">
                        <i class="bi bi-exclamation-triangle"></i> EXPIRED ${daysExpired} day${daysExpired !== 1 ? 's' : ''} ago (not notified)
                    </div>`;
            } else if (contact.endDate === getLocalDateString()) {
                expiryNotificationStatus = `
                    <div class="small text-warning">
                        <i class="bi bi-clock"></i> Expires TODAY
                    </div>`;
            }
        }
        
        const startNotificationStatus = contact.startNotifiedAt ? 
            `<div class="small text-info">
                <i class="bi bi-check-circle"></i> Welcome sent on ${new Date(contact.startNotifiedAt).toLocaleDateString()}
            </div>` : '';
        
        const renewalNotificationStatus = contact.renewalNotifiedAt ? 
            `<div class="small text-warning">
                <i class="bi bi-check-circle"></i> Renewal sent on ${new Date(contact.renewalNotifiedAt).toLocaleDateString()}
            </div>` : '';

        contactDiv.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1">
                    <div class="fw-bold">${escapeHtml(contact.name)}</div> 
                    <div class="small text-muted">
                        <i class="bi bi-whatsapp"></i> ${escapeHtml(contact.phone)}
                    </div>
                    ${planInfo}
                    ${expiryNotificationStatus}
                    ${startNotificationStatus}
                    ${renewalNotificationStatus}
                </div>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary" onclick="fillNumber('${escapeHtml(contact.phone)}')" title="Send Message">
                        <i class="bi bi-send"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-secondary" onclick="editContact(${index})" title="Edit Contact">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteContact(${index})" title="Delete Contact">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>`;
        listContainer.appendChild(contactDiv);
    });
    
    updateContactCountBadge(list.length);
    loadBulkContactsList();
    loadScheduleContactsList();
}

function updateContactCountBadge(count) {
    const badge = document.getElementById('contactCountBadge');
    if (badge) {
        badge.textContent = count;
        badge.className = `badge ${count > 0 ? 'bg-primary' : 'bg-secondary'}`;
    }
}

function editContact(index) {
    const list = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const contact = list[index];
    if (!contact) return;

    document.getElementById('contactName').value = contact.name;
    document.getElementById('contactPhone').value = contact.phone;
    document.getElementById('contactStart').value = contact.startDate || '';
    document.getElementById('contactEnd').value = contact.endDate || '';
    
    const btn = document.getElementById('addContactBtn');
    btn.innerHTML = '<i class="bi bi-check-lg"></i> Update Contact';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-warning');
    
    editingContactIndex = index;
    showToast(`Editing contact: ${contact.name}`, 'info');
}

function addContact() {
    const name = document.getElementById('contactName').value.trim();
    const phone = document.getElementById('contactPhone').value.trim();
    const start = document.getElementById('contactStart').value;
    const end = document.getElementById('contactEnd').value;
  
    if (!phone) {
        showToast('Enter phone number', 'error');
        return;
    }

    let list = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    
    // Clean phone number
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    
    const contactData = { 
        name: name || cleanPhone, 
        phone: cleanPhone, 
        startDate: start, 
        endDate: end,
        notifiedEnd: false,
        startNotified: false,
        renewalNotified: false,
        createdAt: new Date().toISOString()
    };

    // Update existing contact
    if (editingContactIndex !== null) {
        const oldContact = list[editingContactIndex];
        
        // RENEWAL LOGIC: Check if plan dates are being changed (for renewal message)
        const settings = JSON.parse(localStorage.getItem('wa_notification_settings') || '{}');
        const hasRenewalMessage = settings.renewalMsg && settings.renewalMsg.trim() !== "";
        
        // Check if either start date or end date is being changed
        const startDateChanged = (oldContact.startDate !== contactData.startDate) && contactData.startDate;
        const endDateChanged = (oldContact.endDate !== contactData.endDate) && contactData.endDate;
        
        if ((startDateChanged || endDateChanged) && hasRenewalMessage) {
            console.log(`[Renewal Trigger] Plan dates updated for ${contactData.name}`);
            console.log(`  Old dates: Start=${oldContact.startDate}, End=${oldContact.endDate}`);
            console.log(`  New dates: Start=${contactData.startDate}, End=${contactData.endDate}`);
            
            // Send renewal notification
            setTimeout(async () => {
                try {
                    const success = await triggerAutomatedNotification('renewal', contactData);
                    if (success) {
                        // Mark renewal as sent in the contact data
                        contactData.renewalNotified = true;
                        contactData.renewalNotifiedAt = new Date().toISOString();
                        
                        // Also reset expiry notification flag if end date changed
                        if (endDateChanged) {
                            contactData.notifiedEnd = false;
                            contactData.notifiedAt = null;
                        }
                        
                        // Update the contact in the list
                        list[editingContactIndex] = contactData;
                        localStorage.setItem('wa_contacts', JSON.stringify(list));
                        
                        console.log(`[Renewal Trigger] ✅ Renewal sent and contact updated`);
                        
                        // Reload contacts to show updated status
                        loadContacts();
                        
                        showToast(`Renewal message sent to ${contactData.name}`, 'success');
                    }
                } catch (error) {
                    console.error("Error sending renewal:", error);
                }
            }, 1000);
        }
        
        // Preserve original start date if not changed
        if (!start && oldContact.startDate) {
            contactData.startDate = oldContact.startDate;
        }

        // Preserve notification statuses
        contactData.notifiedEnd = oldContact.notifiedEnd || false;
        contactData.notifiedAt = oldContact.notifiedAt || null;
        contactData.startNotified = oldContact.startNotified || false;
        contactData.startNotifiedAt = oldContact.startNotifiedAt || null;
        contactData.renewalNotified = oldContact.renewalNotified || false;
        contactData.renewalNotifiedAt = oldContact.renewalNotifiedAt || null;

        list[editingContactIndex] = contactData;
        showToast('Contact Updated', 'success');
        
        // Reset UI
        editingContactIndex = null;
        const addBtn = document.getElementById('addContactBtn');
        addBtn.innerHTML = '<i class="bi bi-person-plus-fill"></i> Add Contact';
        addBtn.classList.replace('btn-warning', 'btn-primary');
    } 
    // Add new contact
    else {
        if (list.some(c => c.phone === cleanPhone)) {
            showToast('Number already saved.', 'warning');
            return;
        }
        
        list.push(contactData);
        showToast('Contact Added', 'success');

        // Send welcome message if start date is set and is today
        if (start) {
            const startDate = new Date(start);
            startDate.setHours(0, 0, 0, 0);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (startDate.getTime() === today.getTime()) {
                setTimeout(async () => {
                    try {
                        await triggerAutomatedNotification('start', contactData);
                    } catch (error) {
                        console.error("Error sending welcome:", error);
                    }
                }, 1000);
            }
        }
    }

    localStorage.setItem('wa_contacts', JSON.stringify(list));
    
    // Clear inputs
    document.getElementById('contactName').value = '';
    document.getElementById('contactPhone').value = '';
    document.getElementById('contactStart').value = '';
    document.getElementById('contactEnd').value = '';
    
    loadContacts();
    
    // Log activity
    logActivity({
        type: 'contact',
        message: editingContactIndex !== null ? `Updated contact: ${name || cleanPhone}` : `Added contact: ${name || cleanPhone}`,
        success: true
    });
}

function deleteContact(idx) {
    if (!confirm('Are you sure you want to delete this contact?')) return;
    
    const list = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const contact = list[idx];
    list.splice(idx, 1);
    localStorage.setItem('wa_contacts', JSON.stringify(list));
    
    // FIX: Add this line to refresh the contact list
    loadContacts();
    
    showToast('Contact deleted.', 'info');
    
    // Log activity
    logActivity({
        type: 'contact',
        message: `Deleted contact: ${contact?.name || contact?.phone}`,
        success: true
    });
}

function saveSingleContact() {
    const phone = document.getElementById('singleNumber').value.trim();
    if (!phone) {
        showToast('Enter a recipient number first.', 'warning');
        return;
    }
    
    const list = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    
    if (list.some(c => c.phone === cleanPhone)) {
        showToast('This number is already in your contacts.', 'info');
        return;
    }
    
    const name = prompt("Enter a name for this contact:", cleanPhone) || cleanPhone;
    list.push({ 
        name: name, 
        phone: cleanPhone,
        createdAt: new Date().toISOString()
    });
    
    localStorage.setItem('wa_contacts', JSON.stringify(list));
    loadContacts();
    showToast(`Saved contact: ${name}`, 'success');
}

function fillNumber(phone) {
    document.getElementById('singleNumber').value = phone;
    showView('send');
}

/* ========================================================================== */
/* 7. BULK SENDING SYSTEM - FIXED DUPLICATE ISSUE                           */
/* ========================================================================== */

function toggleBulkControls(state) {
    const pauseBtn = document.getElementById('pauseBulkBtn');
    const resumeBtn = document.getElementById('resumeBulkBtn');
    const stopBtn = document.getElementById('stopBulkBtn');
    const sendBtn = document.getElementById('sendBulkBtn');
    
    if (!pauseBtn) return;

    if (state === 'running') {
        pauseBtn.disabled = false;
        resumeBtn.disabled = true;
        stopBtn.disabled = false;
        sendBtn.disabled = true;
        
        pauseBtn.classList.remove('btn-secondary');
        pauseBtn.classList.add('btn-warning');
        resumeBtn.classList.remove('btn-success');
        resumeBtn.classList.add('btn-secondary');
        
    } else if (state === 'paused') {
        pauseBtn.disabled = true;
        resumeBtn.disabled = false;
        stopBtn.disabled = false;
        sendBtn.disabled = true;

        pauseBtn.classList.remove('btn-warning');
        pauseBtn.classList.add('btn-secondary');
        resumeBtn.classList.remove('btn-secondary');
        resumeBtn.classList.add('btn-success');

    } else {
        pauseBtn.disabled = true;
        resumeBtn.disabled = true;
        stopBtn.disabled = true;
        sendBtn.disabled = false;

        pauseBtn.classList.add('btn-secondary');
        resumeBtn.classList.add('btn-secondary');
    }
}

async function sendBulkList() {
    // Clear processed contacts set to prevent duplicates
    processedContacts.clear();
    
    // Get selected contacts
    const selectedSaved = [...document.querySelectorAll('#bulkContactsList input.bulk-contact:checked')].map(ch => ({
        phone: ch.dataset.phone,
        name: ch.dataset.name
    }));
    
    // Get manual input
    const manualInput = document.getElementById('bulkList')?.value.trim() || '';
    const manualList = manualInput 
        ? manualInput.split(/\r?\n/).map(s => ({ phone: s.trim().replace(/[^0-9+]/g, ''), name: '' })).filter(x => x.phone)
        : [];
    
    // Get CSV uploaded contacts
    let csvList = (typeof parsedBulk !== 'undefined') 
        ? parsedBulk.map(n => ({ phone: n.replace(/[^0-9+]/g, ''), name: '' })).filter(x => x.phone)
        : [];

    // Combine all sources and remove duplicates
    const allContacts = [...selectedSaved, ...manualList, ...csvList];
    
    // Remove duplicate phone numbers
    const phoneSet = new Set();
    const finalList = [];
    
    for (const contact of allContacts) {
        if (!phoneSet.has(contact.phone)) {
            phoneSet.add(contact.phone);
            finalList.push(contact);
        }
    }
    
    if (!finalList.length) {
        showToast('No recipients selected or entered.', 'error');
        return;
    }

    // Validate content
    const fileEl = document.getElementById('bulkFile');
    const messageRaw = document.getElementById('bulkMessage').value.trim() || ' ';
    const hasFile = fileEl.files.length > 0;
    
    if (!hasFile && messageRaw.trim() === '') {
        showToast('Please provide a message or select a file.', 'warning');
        return;
    }
        
    if (!confirm(`Ready to send to ${finalList.length} unique recipients?\nClick OK to start.`)) {
        return;
    }

    // Check if enterprise settings should be used
    const useEnterprise = finalList.length > 100;
    if (useEnterprise) {
        // Show enterprise settings panel
        const enterprisePanel = document.getElementById('enterpriseBulkSettings');
        if (enterprisePanel) {
            enterprisePanel.classList.add('show');
        }
        
        // Use enterprise bulk sending
        await sendBulkEnterprise(finalList, messageRaw, hasFile, fileEl);
        return;
    }

    // Regular bulk sending for smaller batches
    isBulkPaused = false;
    isBulkStopped = false;
    toggleBulkControls('running');

    // Prepare file
    let originalBase64 = '', filename = '', fileType = '';
    if (hasFile) {
        const f = fileEl.files[0];
        if (f.size > appConfig.maxFileSizeBytes) {
            toggleBulkControls('idle');
            showToast(`File exceeds ${appConfig.maxFileSizeMB}MB limit.`, 'error');
            return;
        }
        filename = f.name;
        fileType = f.type;
        originalBase64 = await fileToBase64(f);
    }
        
    // Status UI
    const bulkStatusDiv = document.getElementById('bulkPreview');
    let successfulSends = 0;
    let failedSends = 0;
    
    function updateBulkStatus(statusText, currentIndex, totalCount) {
        if (bulkStatusDiv) {
            bulkStatusDiv.innerHTML = `
                <div class="alert alert-warning">
                    <h5><i class="bi bi-gear-wide-connected fa-spin"></i> Processing...</h5>
                    <div><strong>Status:</strong> ${statusText}</div>
                    <div><strong>Progress:</strong> ${currentIndex} / ${totalCount}</div>
                    <div class="mt-2">
                        <span class="badge bg-success">Success: ${successfulSends}</span>
                        <span class="badge bg-danger">Failed: ${failedSends}</span>
                    </div>
                </div>`;
        }
    }

    updateBulkStatus('Initializing...', 0, finalList.length);

    // Main loop
    for (let i = 0; i < finalList.length; i++) {
        if (isBulkStopped) {
            updateBulkStatus('Stopped by User', i, finalList.length);
            showToast('Bulk sending stopped.', 'error');
            break;
        }

        while (isBulkPaused && !isBulkStopped) {
            updateBulkStatus('PAUSED', i, finalList.length);
            await sleep(1000);
        }
        if (isBulkStopped) break;

        const item = finalList[i];
        const to = item.phone;
        const name = item.name || to;
        
        // Skip if already processed in this session
        if (processedContacts.has(to)) {
            console.log(`Skipping duplicate: ${to}`);
            continue;
        }
        
        let personalizedMsg = messageRaw.replace(/{name}/g, name);
        if (!personalizedMsg.trim()) personalizedMsg = ' ';

        updateBulkStatus(`Sending to ${name}`, i + 1, finalList.length);
        
        let base64ToSend = originalBase64;
        let filenameToSend = filename;
        
        // Enhanced Watermarking logic with name + phone number
        const isWatermarking = hasFile && appConfig.enableWatermarking;
        if (isWatermarking) {
            try {
                // Generate watermark text based on format setting
                const watermarkText = generateWatermarkText(name, to);
                base64ToSend = await getWatermarkedBase64(originalBase64, fileType, watermarkText, 'diagonal');
                filenameToSend = `WM_${filename}`;
                console.log(`[Watermark] Applied: ${watermarkText} to ${name}`);
            } catch (e) { 
                console.error(`Watermark failed for ${name}`, e);
            }
        }

        const payload = buildPayload(to, personalizedMsg, base64ToSend, filenameToSend);
        const dummyResultDiv = { innerHTML: '' };
        const result = await postSendAndHandleResponse(payload, filenameToSend, personalizedMsg, to, dummyResultDiv);
        
        if (result) {
            successfulSends++;
            processedContacts.add(to); // Mark as processed
        } else {
            failedSends++;
        }
        
        // Smart delay (don't delay after last message)
        if (i < finalList.length - 1) {
            const delay = getSmartDelay(isWatermarking, i, finalList.length);
            if (bulkStatusDiv) {
                bulkStatusDiv.insertAdjacentHTML('beforeend', 
                    `<div class="small text-muted mt-1"><i class="bi bi-hourglass"></i> Waiting ${delay}ms...</div>`);
            }
            await sleep(delay);
        }
    }

    // Finalize
    toggleBulkControls('idle');
    
    if (!isBulkStopped) {
        if (bulkStatusDiv) {
            bulkStatusDiv.innerHTML = `
                <div class="alert alert-success">
                    <h4><i class="bi bi-check-circle-fill"></i> Batch Completed</h4>
                    <p>Total Processed: ${finalList.length}</p>
                    <hr>
                    <p class="mb-0">
                        <strong>Successful:</strong> ${successfulSends} | 
                        <strong>Failed:</strong> ${failedSends}
                    </p>
                </div>`;
        }
        
        // Log activity
        logActivity({
            type: 'bulk',
            message: `Bulk send completed: ${finalList.length} recipients`,
            recipients: finalList.length,
            success: successfulSends,
            failed: failedSends
        });
        
        showToast('Bulk Batch Completed!', 'success');
        updateMessageCount();
    }
}

async function sendBulkEnterprise(recipients, message, hasFile, fileEl) {
    if (!confirm(`Send to ${recipients.length} unique contacts in batches of ${appConfig.batchSize}?`)) {
        return;
    }
    
    isBulkPaused = false;
    isBulkStopped = false;
    toggleBulkControls('running');

    // Prepare file
    let originalBase64 = '', filename = '', fileType = '';
    if (hasFile && fileEl.files.length > 0) {
        const f = fileEl.files[0];
        if (f.size > appConfig.maxFileSizeBytes) {
            toggleBulkControls('idle');
            showToast(`File exceeds ${appConfig.maxFileSizeMB}MB limit.`, 'error');
            return;
        }
        filename = f.name;
        fileType = f.type;
        originalBase64 = await fileToBase64(f);
    }

    const bulkStatusDiv = document.getElementById('bulkPreview');
    let successfulSends = 0;
    let failedSends = 0;
    let batchNumber = 1;
    
    // Split into batches
    const batches = [];
    for (let i = 0; i < recipients.length; i += appConfig.batchSize) {
        batches.push(recipients.slice(i, i + appConfig.batchSize));
    }

    showToast(`Processing ${batches.length} batches`, 'info');

    for (const batch of batches) {
        if (isBulkStopped) break;
        
        // Update UI
        if (bulkStatusDiv) {
            bulkStatusDiv.innerHTML = `
                <div class="alert alert-warning">
                    <h5><i class="bi bi-gear-wide-connected fa-spin"></i> Processing Batch ${batchNumber}/${batches.length}</h5>
                    <div><strong>Progress:</strong> ${successfulSends + failedSends} / ${recipients.length}</div>
                    <div class="mt-2">
                        <span class="badge bg-success">Success: ${successfulSends}</span>
                        <span class="badge bg-danger">Failed: ${failedSends}</span>
                    </div>
                </div>`;
        }
        
        // Process batch
        for (let i = 0; i < batch.length; i++) {
            if (isBulkStopped) break;
            
            // Check pause state
            while (isBulkPaused && !isBulkStopped) {
                await sleep(1000);
            }
            if (isBulkStopped) break;
            
            const item = batch[i];
            const to = item.phone;
            const name = item.name || to;
            
            // Skip if already processed
            if (processedContacts.has(to)) {
                console.log(`Skipping duplicate in batch: ${to}`);
                continue;
            }
            
            let personalizedMsg = message.replace(/{name}/g, name);
            if (!personalizedMsg.trim()) personalizedMsg = ' ';
            
            let base64ToSend = originalBase64;
            let filenameToSend = filename;
            
            // Enhanced Watermarking with name + phone number
            const isWatermarking = hasFile && appConfig.enableWatermarking;
            if (isWatermarking) {
                try {
                    const watermarkText = generateWatermarkText(name, to);
                    base64ToSend = await getWatermarkedBase64(originalBase64, fileType, watermarkText, 'diagonal');
                    filenameToSend = `WM_${filename}`;
                    console.log(`[Watermark] Applied: ${watermarkText} to ${name}`);
                } catch (e) {
                    console.error(`Watermark failed for ${name}`, e);
                }
            }
            
            const payload = buildPayload(to, personalizedMsg, base64ToSend, filenameToSend);
            const dummyResultDiv = { innerHTML: '' };
            const result = await postSendAndHandleResponse(payload, filenameToSend, personalizedMsg, to, dummyResultDiv);
            
            if (result) {
                successfulSends++;
                processedContacts.add(to);
            } else {
                failedSends++;
            }
            
            // Smart delay between sends in batch (optimized for watermarking)
            const delay = getSmartDelay(isWatermarking, successfulSends + failedSends, recipients.length);
            if (i < batch.length - 1) {
                await sleep(delay);
            }
        }
        
        batchNumber++;
        
        // Delay between batches (except last batch)
        if (batchNumber <= batches.length && !isBulkStopped) {
            await sleep(appConfig.batchDelay);
        }
    }

    // Finalize
    toggleBulkControls('idle');
    
    if (!isBulkStopped) {
        if (bulkStatusDiv) {
            bulkStatusDiv.innerHTML = `
                <div class="alert alert-success">
                    <h4><i class="bi bi-check-circle-fill"></i> Enterprise Batch Completed</h4>
                    <p>Total Processed: ${recipients.length}</p>
                    <hr>
                    <p class="mb-0">
                        <strong>Successful:</strong> ${successfulSends} | 
                        <strong>Failed:</strong> ${failedSends} | 
                        <strong>Success Rate:</strong> ${Math.round((successfulSends / recipients.length) * 100)}%
                    </p>
                </div>`;
        }
        
        // Log activity
        logActivity({
            type: 'bulk',
            message: `Enterprise bulk send: ${recipients.length} recipients in ${batches.length} batches`,
            recipients: recipients.length,
            success: successfulSends,
            failed: failedSends,
            batches: batches.length
        });
        
        showToast(`Enterprise bulk send completed: ${successfulSends}/${recipients.length} successful`, 'success');
        updateMessageCount();
    }
}

function handleBulkCsv(e) {
    const f = e.target.files[0];
    if (!f) return;
    
    const reader = new FileReader();
    reader.onload = () => {
        parsedBulk = reader.result.split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(n => n.replace(/[^0-9+]/g, ''));
        renderBulkPreview();
    };
    reader.readAsText(f);
}

function previewBulkList() {
    const pasted = document.getElementById('bulkList').value.trim();
    parsedBulk = [];
    if (pasted) {
        parsedBulk = pasted.split(/\r?\n/)
            .map(s => s.trim())
            .filter(Boolean)
            .map(n => n.replace(/[^0-9+]/g, ''));
    }
    renderBulkPreview();
}

function renderBulkPreview() {
    const el = document.getElementById('bulkPreview');
    if (!el) return;
    
    if (!parsedBulk.length) { 
        el.innerHTML = '<div class="text-muted text-center p-3 border rounded">No recipients parsed yet.</div>'; 
        return; 
    }
    
    el.innerHTML = `
        <div class="alert alert-info">
            <strong>${parsedBulk.length}</strong> recipients ready from CSV/Manual input. 
            <div class="small text-muted mt-1 text-truncate">
                ${parsedBulk.slice(0, 10).join(', ')}${parsedBulk.length > 10 ? '...' : ''}
            </div>
        </div>`;
}

/* ========================================================================== */
/* 8. SINGLE SEND FUNCTION - FIXED "BOTH" OPTION                             */
/* ========================================================================== */

function updateSendModeUI(mode) {
    const fileSection = document.getElementById('singleFileSection');
    const messageSection = document.getElementById('singleMessageSection');
    
    switch(mode) {
        case 'file':
            if (fileSection) fileSection.style.display = 'block';
            if (messageSection) messageSection.style.display = 'none';
            break;
        case 'message':
            if (fileSection) fileSection.style.display = 'none';
            if (messageSection) messageSection.style.display = 'block';
            break;
        case 'both':
            if (fileSection) fileSection.style.display = 'block';
            if (messageSection) messageSection.style.display = 'block';
            break;
    }
}

async function sendSingle() {
    const toInput = document.getElementById('singleNumber');
    const fileInput = document.getElementById('singleFile');
    const messageInput = document.getElementById('singleMessage');
    const resultDiv = document.getElementById('singleResult');
    
    resultDiv.innerHTML = '';

    const to = toInput.value.trim().replace(/[^0-9+]/g, '');
    if (!to) {
        showToast('Please enter a recipient number.', 'error');
        return;
    }
    
    // Get selected mode
    const sendMode = document.querySelector('input[name="sendMode"]:checked')?.value || 'both';
    
    const messageRaw = messageInput.value.trim();
    const hasFile = fileInput.files.length > 0;
    
    let base64ToSend = '';
    let filenameToSend = '';
    let messageToSend = '';
    let fileToProcess = null;

    // Validation based on mode
    if (sendMode === 'file' && !hasFile) {
        showToast('File mode selected but no file chosen.', 'warning');
        return;
    }
    
    if (sendMode === 'message' && !messageRaw) {
        showToast('Message mode selected but message is empty.', 'warning');
        return;
    }
    
    if (sendMode === 'both' && !hasFile && !messageRaw) {
        showToast('Both mode requires either a file or message.', 'warning');
        return;
    }

    // File processing
    if (hasFile && (sendMode === 'both' || sendMode === 'file')) {
        fileToProcess = fileInput.files[0];
        
        if (fileToProcess.size > appConfig.maxFileSizeBytes) {
            showToast(`File exceeds ${appConfig.maxFileSizeMB}MB limit.`, 'error');
            return;
        }
        
        filenameToSend = fileToProcess.name;
        resultDiv.innerHTML = '<div class="alert alert-info" id="singleProgress"><span class="spinner-border spinner-border-sm"></span> Encoding file...</div>';
        
        try {
            base64ToSend = await fileToBase64(fileToProcess);
        } catch (e) {
            showToast('Failed to encode file.', 'error');
            return;
        }
    }

    // Message processing
    if (sendMode === 'both' || sendMode === 'message') {
        messageToSend = messageRaw || ' ';
    }

    // Final validation
    if (!messageToSend && !base64ToSend) {
        showToast('Nothing to send.', 'error');
        return;
    }

    // Build payload and send
    const payload = buildPayload(to, messageToSend, base64ToSend, filenameToSend);
    const success = await postSendAndHandleResponse(payload, filenameToSend, messageToSend, to, resultDiv);
    
    if (success) {
        // Clear form on success
        if (sendMode !== 'message') {
            fileInput.value = '';
        }
        if (sendMode !== 'file') {
            messageInput.value = '';
        }
        updateMessageCount();
    }
}

/* ========================================================================== */
/* 9. SCHEDULER SYSTEM - FIXED NOT SENDING AT SCHEDULED TIME                 */
/* ========================================================================== */

/**
 * Fixed: Initialize scheduler with proper time checking
 */
function initializeScheduler() {
    // Clear any existing interval
    if (window.schedulerInterval) {
        clearInterval(window.schedulerInterval);
    }
    
    // Run scheduler every 10 seconds for better accuracy
    window.schedulerInterval = setInterval(() => {
        if (isSchedulerRunning || isSchedulerPaused || isSchedulerStopped) return;
        isSchedulerRunning = true;
        
        try {
            processScheduledJobs();
        } catch (error) {
            console.error("Scheduler error:", error);
        } finally {
            isSchedulerRunning = false;
        }
    }, 10000); // 10 seconds for better accuracy
    
    console.log("Scheduler initialized (checking every 10 seconds)");
}

/**
 * Fixed: Process scheduled jobs with proper time checking
 */
async function processScheduledJobs() {
    const schedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    if (!schedules.length) return;
    
    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    
    // Filter jobs scheduled for the current time
    const dueJobs = schedules.filter(job => {
        // Skip if already sent
        if (job.sent) return false;
        
        // Parse job time
        const [jobHours, jobMinutes] = job.time.split(':').map(Number);
        
        // Check if current time matches job time (within 1 minute tolerance)
        const timeDiff = Math.abs((currentHour * 60 + currentMinute) - (jobHours * 60 + jobMinutes));
        
        return timeDiff <= 1; // Within 1 minute of scheduled time
    });
    
    if (!dueJobs.length) return;
    
    console.log(`Processing ${dueJobs.length} scheduled job(s) at ${currentHour}:${currentMinute}`);
    
    // Use a Set to track processed job IDs to prevent duplicates
    const processedJobIds = new Set();
    
    for (const job of dueJobs) {
        // Skip if already processed in this run
        if (processedJobIds.has(job.id)) continue;
        
        try {
            await executeScheduledJob(job);
            
            // Mark as sent IMMEDIATELY
            job.sent = true;
            job.sentAt = new Date().toISOString();
            
            // Add to processed set
            processedJobIds.add(job.id);
            
            // Update storage immediately
            const allSchedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
            const index = allSchedules.findIndex(s => s.id === job.id);
            if (index !== -1) {
                allSchedules[index] = job;
                localStorage.setItem('wa_schedules', JSON.stringify(allSchedules));
            }
            
            console.log(`✓ Job ${job.id} (${job.time}) marked as sent`);
            
        } catch (error) {
            console.error(`Failed to execute job ${job.id}:`, error);
            // Don't mark as sent if there was an error
        }
        
        // Wait 2 seconds between jobs to prevent rate limiting
        await sleep(2000);
    }
    
    // Only render schedules if we processed any jobs
    if (processedJobIds.size > 0) {
        renderSchedules();
    }
}

/**
 * Fixed: Execute a single scheduled job with better error handling
 */
async function executeScheduledJob(job) {
    console.log(`Executing scheduled job: ${job.time} (ID: ${job.id})`);
    
    // Set current job for pause/stop control
    currentSchedulerJob = job.id;
    
    // Show toast notification
    showToast(`Executing scheduled job: ${job.time}`, 'info');
    
    // Update UI
    const resultDiv = document.getElementById('scheduleList');
    if (resultDiv) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'alert alert-info mb-2';
        statusDiv.id = `job-status-${job.id}`;
        statusDiv.innerHTML = `<i class="bi bi-clock"></i> Sending scheduled messages for ${job.time}...`;
        resultDiv.prepend(statusDiv);
    }
    
    let successCount = 0;
    let failCount = 0;
    let totalRecipients = job.recipients?.length || 0;
    
    if (totalRecipients === 0) {
        console.warn(`Job ${job.id} has no recipients`);
        currentSchedulerJob = null;
        return;
    }
    
    console.log(`Job ${job.id}: Sending to ${totalRecipients} recipient(s)`);
    
    for (let i = 0; i < totalRecipients; i++) {
        // Check for stop/pause
        if (isSchedulerStopped) {
            console.log(`Scheduler stopped during job ${job.id}`);
            break;
        }
        
        while (isSchedulerPaused && !isSchedulerStopped) {
            await sleep(1000);
        }
        
        if (isSchedulerStopped) break;
        
        const recipient = job.recipients[i];
        const to = typeof recipient === 'string' ? recipient : recipient.phone;
        const name = recipient.name || to;
        
        // Update UI progress
        if (resultDiv) {
            const statusDiv = document.getElementById(`job-status-${job.id}`);
            if (statusDiv) {
                statusDiv.innerHTML = `
                    <i class="bi bi-clock"></i> 
                    Sending scheduled messages for ${job.time}...
                    <div class="small mt-1">
                        Progress: ${i + 1}/${totalRecipients}
                        ${successCount > 0 ? `<span class="text-success ms-2">✓ ${successCount} sent</span>` : ''}
                        ${failCount > 0 ? `<span class="text-danger ms-2">✗ ${failCount} failed</span>` : ''}
                        ${isSchedulerPaused ? `<span class="text-warning ms-2">(PAUSED)</span>` : ''}
                    </div>`;
            }
        }
        
        try {
            // Personalize message
            let personalizedMsg = job.message.replace(/{name}/g, name);
            
            // Prepare file if exists
            let base64ToSend = '';
            let filenameToSend = '';
            
            if (job.fileMeta) {
                base64ToSend = job.fileMeta.base64;
                filenameToSend = job.fileMeta.filename;
                
                // Apply watermark if needed
                if (appConfig.enableWatermarking) {
                    try {
                        const watermarkText = generateWatermarkText(name, to);
                        base64ToSend = await getWatermarkedBase64(
                            job.fileMeta.base64, 
                            job.fileMeta.type, 
                            watermarkText, 
                            'diagonal'
                        );
                        filenameToSend = `WM_${job.fileMeta.filename}`;
                    } catch (e) {
                        console.error(`Watermark failed for ${name}:`, e);
                    }
                }
            }
            
            const payload = buildPayload(to, personalizedMsg, base64ToSend, filenameToSend);
            const success = await postSendAndHandleResponse(
                payload, 
                filenameToSend, 
                personalizedMsg, 
                to, 
                null
            );
            
            if (success) {
                successCount++;
                console.log(`✓ Sent to ${to}`);
            } else {
                failCount++;
                console.log(`✗ Failed to send to ${to}`);
            }
            
        } catch (error) {
            console.error(`Error sending to ${to}:`, error);
            failCount++;
        }
        
        // Smart delay between sends (but not after the last one)
        if (i < totalRecipients - 1) {
            const delay = getSmartDelay(job.fileMeta && appConfig.enableWatermarking, i, totalRecipients);
            await sleep(delay);
        }
    }
    
    // Clear current job
    currentSchedulerJob = null;
    
    // Update final status in UI
    if (resultDiv) {
        const statusDiv = document.getElementById(`job-status-${job.id}`);
        if (statusDiv) {
            const statusClass = successCount > 0 ? 'success' : 'danger';
            statusDiv.className = `alert alert-${statusClass} mb-2`;
            statusDiv.innerHTML = `
                <i class="bi bi-${successCount > 0 ? 'check-circle' : 'x-circle'}"></i>
                Scheduled job ${job.time} completed:
                <div class="small mt-1">
                    <span class="text-success">✓ ${successCount} sent</span>
                    <span class="text-danger ms-2">✗ ${failCount} failed</span>
                    ${isSchedulerStopped ? `<span class="text-warning ms-2">(STOPPED)</span>` : ''}
                </div>`;
            
            // Remove status after 10 seconds
            setTimeout(() => {
                if (statusDiv.parentNode) {
                    statusDiv.remove();
                }
            }, 10000);
        }
    }
    
    // Show completion toast
    const toastMessage = isSchedulerStopped 
        ? `Scheduler stopped during job ${job.time}`
        : successCount > 0 
            ? `Scheduled job completed: ${successCount} sent, ${failCount} failed`
            : `Scheduled job failed: ${failCount} failed`;
    
    showToast(toastMessage, isSchedulerStopped ? 'warning' : successCount > 0 ? 'success' : 'warning');
    
    // Log activity - only log once per job
    logActivity({
        type: 'scheduled',
        time: job.time,
        message: `Executed scheduled job: ${job.time}`,
        recipients: totalRecipients,
        success: successCount,
        failed: failCount,
        jobId: job.id,
        stopped: isSchedulerStopped
    });
    
    updateMessageCount();
}

/**
 * Scheduler Control Functions
 */
function pauseScheduler() {
    isSchedulerPaused = true;
    document.getElementById('pauseSchedulerBtn').disabled = true;
    document.getElementById('resumeSchedulerBtn').disabled = false;
    showToast('Scheduler paused', 'warning');
}

function resumeScheduler() {
    isSchedulerPaused = false;
    document.getElementById('pauseSchedulerBtn').disabled = false;
    document.getElementById('resumeSchedulerBtn').disabled = true;
    showToast('Scheduler resumed', 'success');
}

function stopScheduler() {
    if (confirm('Stop all scheduled jobs? Current job will finish but no new jobs will start.')) {
        isSchedulerStopped = true;
        isSchedulerPaused = false;
        document.getElementById('pauseSchedulerBtn').disabled = true;
        document.getElementById('resumeSchedulerBtn').disabled = true;
        document.getElementById('stopSchedulerBtn').disabled = true;
        showToast('Scheduler stopped', 'error');
    }
}

/**
 * Fixed: Save schedule with better ID generation and validation
 */
async function saveLocalSchedule() {
    const time = document.getElementById('scheduleTime').value;
    if (!time) {
        showToast('Please select a time.', 'error');
        return;
    }
    
    // Validate time format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(time)) {
        showToast('Please enter a valid time in HH:MM format.', 'error');
        return;
    }
    
    // Check if schedule already exists for this time
    const existingSchedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    const existingForSameTime = existingSchedules.filter(s => s.time === time && !s.sent);
    
    if (existingForSameTime.length > 0) {
        if (!confirm(`A schedule already exists for ${time}. Do you want to create another one?`)) {
            return;
        }
    }
    
    // Get selected contacts
    const selectedSaved = [...document.querySelectorAll('#scheduleContactsList input.schedule-contact:checked')].map(ch => ({
        phone: ch.dataset.phone,
        name: ch.dataset.name
    }));
    
    // Get manual recipients
    const manualInput = document.getElementById('scheduleRecipients').value.trim();
    const manualList = manualInput 
        ? manualInput.split(/\r?\n/).map(s => ({ 
            phone: s.trim().replace(/[^0-9+]/g, ''), 
            name: '' 
        })).filter(x => x.phone)
        : [];
    
    const recipients = [...selectedSaved, ...manualList];
    
    if (recipients.length === 0) {
        showToast('Select at least one recipient.', 'error');
        return;
    }

    const message = document.getElementById('scheduleMessage').value;
    const fileEl = document.getElementById('scheduleFile');
    
    // Generate unique ID with timestamp
    const jobId = Date.now() + Math.floor(Math.random() * 1000);
    
    // Prepare schedule data
    const scheduleData = {
        id: jobId,
        time: time,
        recipients: recipients,
        message: message,
        fileMeta: null,
        created: new Date().toISOString(),
        sent: false,
        lastProcessed: null
    };
    
    // Handle file if selected
    if (fileEl.files.length > 0) {
        const f = fileEl.files[0];
        if (f.size > appConfig.maxFileSizeBytes) {
            showToast(`File exceeds ${appConfig.maxFileSizeMB}MB limit.`, 'error');
            return;
        }
        
        // Show loading
        const originalText = document.getElementById('saveScheduleBtn').innerHTML;
        document.getElementById('saveScheduleBtn').innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing file...';
        document.getElementById('saveScheduleBtn').disabled = true;
        
        // Convert to base64
        try {
            const base64 = await fileToBase64(f);
            scheduleData.fileMeta = {
                filename: f.name,
                type: f.type,
                base64: base64
            };
            await saveScheduleToStorage(scheduleData);
        } catch (error) {
            console.error("File conversion error:", error);
            showToast('Failed to process file.', 'error');
        } finally {
            // Restore button
            document.getElementById('saveScheduleBtn').innerHTML = originalText;
            document.getElementById('saveScheduleBtn').disabled = false;
        }
    } else {
        await saveScheduleToStorage(scheduleData);
    }
}

/**
 * Fixed: Save schedule with better data validation
 */
async function saveScheduleToStorage(scheduleData) {
    const schedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    
    // Validate schedule doesn't already exist
    const exists = schedules.some(s => s.id === scheduleData.id);
    if (exists) {
        showToast('Schedule with this ID already exists.', 'error');
        return;
    }
    
    schedules.push(scheduleData);
    localStorage.setItem('wa_schedules', JSON.stringify(schedules));
    
    // Clear form
    document.getElementById('scheduleTime').value = '';
    document.getElementById('scheduleRecipients').value = '';
    document.getElementById('scheduleMessage').value = '';
    document.getElementById('scheduleFile').value = '';
    
    // Uncheck all contacts
    document.querySelectorAll('#scheduleContactsList input:checked').forEach(cb => {
        cb.checked = false;
    });
    
    renderSchedules();
    showToast(`Schedule created for ${scheduleData.time}`, 'success');
    
    // Log activity
    logActivity({
        type: 'scheduled',
        message: `Created schedule for ${scheduleData.time} with ${scheduleData.recipients.length} recipient(s)`,
        time: scheduleData.time,
        recipients: scheduleData.recipients.length,
        jobId: scheduleData.id
    });
}

/**
 * Fixed: Render schedules with better status display
 */
function renderSchedules() {
    const list = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    const el = document.getElementById('scheduleList');
    if (!el) return;
    
    // Sort schedules: pending first, then by time
    const sortedSchedules = list.sort((a, b) => {
        // Pending first
        if (!a.sent && b.sent) return -1;
        if (a.sent && !b.sent) return 1;
        
        // Then by time
        return a.time.localeCompare(b.time);
    });
    
    el.innerHTML = '';
    
    if (sortedSchedules.length === 0) {
        el.innerHTML = `
            <div class="text-center p-4">
                <i class="bi bi-calendar-x text-muted" style="font-size: 3rem;"></i>
                <h5 class="mt-3 text-muted">No schedules</h5>
                <p class="text-muted small">Create a schedule to send messages automatically</p>
            </div>`;
        return;
    }
    
    // Group schedules by status
    const pendingSchedules = sortedSchedules.filter(s => !s.sent);
    const completedSchedules = sortedSchedules.filter(s => s.sent);
    
    if (pendingSchedules.length > 0) {
        el.innerHTML += `
            <div class="mb-3">
                <h6 class="text-primary">
                    <i class="bi bi-clock"></i> Pending Schedules (${pendingSchedules.length})
                </h6>
            </div>`;
        
        pendingSchedules.forEach(s => {
            renderScheduleItem(s, el);
        });
    }
    
    if (completedSchedules.length > 0) {
        el.innerHTML += `
            <div class="mb-3 mt-4">
                <h6 class="text-success">
                    <i class="bi bi-check-circle"></i> Completed Schedules (${completedSchedules.length})
                </h6>
            </div>`;
        
        completedSchedules.forEach(s => {
            renderScheduleItem(s, el);
        });
    }
}

/**
 * Helper: Render individual schedule item
 */
function renderScheduleItem(schedule, container) {
    const fileIcon = schedule.fileMeta ? '<i class="bi bi-paperclip ms-1" title="Has attachment"></i>' : '';
    const recCount = schedule.recipients?.length || 0;
    const statusBadge = schedule.sent 
        ? `<span class="badge bg-success ms-2"><i class="bi bi-check-circle"></i> Sent</span>` 
        : `<span class="badge bg-warning ms-2"><i class="bi bi-clock"></i> Pending</span>`;
    
    const sentInfo = schedule.sent 
        ? `<div class="small text-muted">Sent: ${new Date(schedule.sentAt).toLocaleString()}</div>` 
        : '';
    
    const item = document.createElement('div');
    item.className = `border rounded p-3 mb-3 ${schedule.sent ? 'bg-light' : 'bg-white'}`;
    item.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
            <div class="flex-grow-1">
                <div class="d-flex align-items-center mb-1">
                    <strong class="me-2"><i class="bi bi-clock"></i> ${schedule.time}</strong>
                    ${fileIcon}
                    ${statusBadge}
                    <span class="badge bg-info ms-2">${recCount} recipient(s)</span>
                </div>
                <div class="small text-muted mb-2">Created: ${new Date(schedule.created).toLocaleString()}</div>
                ${sentInfo}
                <div class="small mt-2">
                    ${escapeHtml(schedule.message || '').substring(0, 100)}
                    ${(schedule.message || '').length > 100 ? '...' : ''}
                </div>
            </div>
            <div class="btn-group ms-2">
                ${!schedule.sent ? `
                    <button class="btn btn-sm btn-outline-primary" onclick="editSchedule(${schedule.id})" title="Edit">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-success" onclick="sendScheduleNowSingle(${schedule.id})" title="Send Now">
                        <i class="bi bi-send"></i>
                    </button>
                ` : ''}
                <button class="btn btn-sm btn-outline-danger" onclick="deleteSchedule(${schedule.id})" title="Delete">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        </div>`;
    
    container.appendChild(item);
}

/**
 * Send a single schedule immediately
 */
async function sendScheduleNowSingle(jobId) {
    const schedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    const job = schedules.find(s => s.id === jobId);
    
    if (!job) {
        showToast('Schedule not found.', 'error');
        return;
    }
    
    if (job.sent) {
        if (!confirm('This schedule has already been sent. Send again?')) {
            return;
        }
    }
    
    if (!confirm(`Send schedule for ${job.time} now?`)) {
        return;
    }
    
    // Execute the job
    await executeScheduledJob(job);
    
    // Update in storage
    job.sent = true;
    job.sentAt = new Date().toISOString();
    localStorage.setItem('wa_schedules', JSON.stringify(schedules));
    
    // Refresh display
    renderSchedules();
}

/**
 * Fixed: Delete schedule with confirmation
 */
function deleteSchedule(id) {
    const schedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    const schedule = schedules.find(s => s.id === id);
    
    if (!schedule) {
        showToast('Schedule not found.', 'error');
        return;
    }
    
    const message = schedule.sent 
        ? `Delete this completed schedule for ${schedule.time}?`
        : `Delete this pending schedule for ${schedule.time}?`;
    
    if (!confirm(message)) return;
    
    const filtered = schedules.filter(x => x.id !== id);
    localStorage.setItem('wa_schedules', JSON.stringify(filtered));
    
    renderSchedules();
    showToast('Schedule deleted.', 'info');
    
    logActivity({
        type: 'scheduled',
        message: `Deleted schedule for ${schedule.time}`,
        time: schedule.time,
        jobId: id
    });
}

/**
 * Fixed: Edit schedule function
 */
function editSchedule(id) {
    const schedules = JSON.parse(localStorage.getItem('wa_schedules') || '[]');
    const job = schedules.find(x => x.id === id);
    
    if (job) {
        if (job.sent) {
            showToast('Cannot edit a schedule that has already been sent.', 'warning');
            return;
        }
        
        // Populate form
        document.getElementById('scheduleTime').value = job.time;
        document.getElementById('scheduleMessage').value = job.message;
        
        // Populate manual recipients
        const recipText = job.recipients.map(r => r.phone).join('\n');
        document.getElementById('scheduleRecipients').value = recipText;
        
        // Delete old schedule
        deleteSchedule(id);
        
        showToast('Schedule loaded. Make changes and click Save.', 'info');
        
        // Scroll to top
        document.getElementById('scheduleTime').scrollIntoView({ behavior: 'smooth' });
    }
}

function sendScheduleNow() {
    const time = document.getElementById('scheduleTime').value;
    if (!time) {
        showToast('Please select a time first.', 'warning');
        return;
    }
    
    // Create a temporary schedule for immediate sending
    const tempSchedule = {
        id: Date.now(),
        time: time,
        recipients: [],
        message: document.getElementById('scheduleMessage').value,
        created: new Date().toISOString(),
        sent: false
    };
    
    // Get recipients
    const selectedSaved = [...document.querySelectorAll('#scheduleContactsList input.schedule-contact:checked')].map(ch => ({
        phone: ch.dataset.phone,
        name: ch.dataset.name
    }));
    
    const manualInput = document.getElementById('scheduleRecipients').value.trim();
    const manualList = manualInput 
        ? manualInput.split(/\r?\n/).map(s => ({ 
            phone: s.trim().replace(/[^0-9+]/g, ''), 
            name: '' 
        })).filter(x => x.phone)
        : [];
    
    tempSchedule.recipients = [...selectedSaved, ...manualList];
    
    if (tempSchedule.recipients.length === 0) {
        showToast('No recipients selected.', 'error');
        return;
    }
    
    // Execute immediately
    executeScheduledJob(tempSchedule);
}

/* ========================================================================== */
/* 10. CONTACT SELECTION COUNTERS                                            */
/* ========================================================================== */

function updateContactSelectionCounters() {
    // Bulk tab counter
    const bulkSelected = document.querySelectorAll('#bulkContactsList input.bulk-contact:checked').length;
    const bulkTotal = document.querySelectorAll('#bulkContactsList input.bulk-contact').length;
    const bulkCounter = document.getElementById('bulkContactCounter');
    
    if (bulkCounter) {
        bulkCounter.textContent = `${bulkSelected}/${bulkTotal} selected`;
        bulkCounter.className = `badge ${bulkSelected > 0 ? 'bg-primary' : 'bg-secondary'}`;
    }
    
    // Schedule tab counter
    const scheduleSelected = document.querySelectorAll('#scheduleContactsList input.schedule-contact:checked').length;
    const scheduleTotal = document.querySelectorAll('#scheduleContactsList input.schedule-contact').length;
    const scheduleCounter = document.getElementById('scheduleContactCounter');
    
    if (scheduleCounter) {
        scheduleCounter.textContent = `${scheduleSelected}/${scheduleTotal}`;
        scheduleCounter.className = `badge ${scheduleSelected > 0 ? 'bg-primary' : 'bg-secondary'}`;
    }
}

function createBulkContactsUI() {
    const toggleBtn = document.getElementById('toggleBulkContacts');
    if (toggleBtn) toggleBtn.innerHTML = 'Select from Saved Contacts';
    
    const selectAll = document.getElementById('selectAllBulk');
    if (selectAll) {
        selectAll.addEventListener('change', e => {
            document.querySelectorAll('#bulkContactsList input[type="checkbox"]').forEach(checkbox => {
                if (checkbox.id !== 'selectAllBulk') {
                    checkbox.checked = e.target.checked;
                }
            });
            updateContactSelectionCounters();
        });
    }
}

function createScheduleContactsUI() {
    const toggleBtn = document.getElementById('toggleScheduleContacts');
    if (toggleBtn) toggleBtn.innerHTML = 'Select from Saved Contacts';
    
    const selectAll = document.getElementById('selectAllSchedule');
    if (selectAll) {
        selectAll.addEventListener('change', e => {
            document.querySelectorAll('#scheduleContactsList input[type="checkbox"]').forEach(checkbox => {
                if (checkbox.id !== 'selectAllSchedule') {
                    checkbox.checked = e.target.checked;
                }
            });
            updateContactSelectionCounters();
        });
    }
}

function loadBulkContactsList() {
    const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const container = document.getElementById('bulkContactsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (contacts.length === 0) {
        container.innerHTML = '<div class="text-muted p-2">No contacts saved.</div>';
        return;
    }

    contacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'form-check mb-1';
        div.innerHTML = `
            <input type="checkbox" class="form-check-input bulk-contact" 
                   data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">
            <label class="form-check-label">
                ${escapeHtml(c.name)} (${escapeHtml(c.phone)})
            </label>`;
        container.appendChild(div);
    });
    
    updateContactSelectionCounters();
}

function loadScheduleContactsList() {
    const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const container = document.getElementById('scheduleContactsList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (contacts.length === 0) {
        container.innerHTML = '<div class="text-muted p-2">No contacts saved.</div>';
        return;
    }

    contacts.forEach(c => {
        const div = document.createElement('div');
        div.className = 'form-check mb-1';
        div.innerHTML = `
            <input type="checkbox" class="form-check-input schedule-contact" 
                   data-phone="${escapeHtml(c.phone)}" data-name="${escapeHtml(c.name)}">
            <label class="form-check-label">
                ${escapeHtml(c.name)} (${escapeHtml(c.phone)})
            </label>`;
        container.appendChild(div);
    });
    
    updateContactSelectionCounters();
}
/* ========================================================================== */
/* REAL TIME CLOCK FUNCTION                                                   */
/* ========================================================================== */

function updateRealTimeClock() {
    const now = new Date();
    
    // Format time (HH:MM:SS)
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeString = `${hours}:${minutes}:${seconds}`;
    
    // Format date (Day, DD Month YYYY)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    
    const dayName = days[now.getDay()];
    const day = String(now.getDate()).padStart(2, '0');
    const month = months[now.getMonth()];
    const year = now.getFullYear();
    const dateString = `${dayName}, ${day} ${month} ${year}`;
    
    // Update DOM elements
    const clockTime = document.getElementById('clockTime');
    const clockDate = document.getElementById('clockDate');
    
    if (clockTime) {
        clockTime.textContent = timeString;
    }
    
    if (clockDate) {
        clockDate.textContent = dateString;
    }
}

// Initialize and start the clock
function initializeRealTimeClock() {
    // Update immediately
    updateRealTimeClock();
    
    // Update every second
    setInterval(updateRealTimeClock, 1000);
    
    console.log("Real-time clock initialized");
}

/* ========================================================================== */
/* 11. AUTO-RESPONDER SYSTEM - FIXED RENEWAL/EXPIRY MESSAGES                 */
/* ========================================================================== */

/**
 * Initialize auto-responder for renewal/expiry messages
 */
function initializeAutoResponder() {
    // Clear any existing interval
    if (window.autoResponderInterval) {
        clearInterval(window.autoResponderInterval);
    }
    
    // Run auto-responder every 60 seconds
    window.autoResponderInterval = setInterval(() => {
        if (isAutoResponderRunning) return;
        isAutoResponderRunning = true;
        
        try {
            checkAndSendAutomatedMessages();
        } catch (error) {
            console.error("Auto-responder error:", error);
        } finally {
            isAutoResponderRunning = false;
        }
    }, 60000); // 60 seconds
    
    console.log("Auto-responder initialized (checking every 60 seconds)");
}

/**
 * Generate watermark text based on configuration
 */
function generateWatermarkText(name, phone) {
    const format = appConfig.watermarkFormat || 'name_phone';
    const customText = appConfig.watermarkText || '{name} - {phone}';
    
    switch(format) {
        case 'name':
            return name;
        case 'phone':
            return phone;
        case 'name_phone':
            return `${name} - ${phone}`;
        case 'custom':
            return customText
                .replace(/{name}/g, name)
                .replace(/{phone}/g, phone);
        default:
            return `${name} - ${phone}`;
    }
}

async function triggerAutomatedNotification(type, contact) {
    console.log(`[Auto-Trigger] Attempting ${type} notification for ${contact.phone}`);
    
    const settings = JSON.parse(localStorage.getItem('wa_notification_settings') || '{}');
    
    let messageTemplate = '';
    
    if (type === 'start') {
        messageTemplate = settings.startMsg;
    } else if (type === 'renewal') {
        messageTemplate = settings.renewalMsg;
    } else if (type === 'end') {
        messageTemplate = settings.endMsg;
    }

    if (!messageTemplate || messageTemplate.trim() === '') {
        console.log(`[Auto-Trigger] Skipped '${type}' notification: No template found.`);
        return false;
    }

    // ENHANCED PLACEHOLDER REPLACEMENT
    const finalMessage = messageTemplate
        .replace(/{name}/g, contact.name || 'Customer')
        .replace(/{start}/g, contact.startDate || 'N/A')
        .replace(/{end}/g, contact.endDate || 'N/A')
        .replace(/{phone}/g, contact.phone)
        .replace(/{date}/g, getLocalDateString())
        .replace(/{time}/g, new Date().toLocaleTimeString());

    console.log(`[Auto-Trigger] Sending ${type} notification to ${contact.phone}: "${finalMessage.substring(0, 50)}..."`);
    
    // USE THE SAME SENDING LOGIC AS REGULAR MESSAGES
    const payload = buildPayload(contact.phone, finalMessage, '', '');
    
    // Show immediate UI feedback
    showToast(`Sending ${type} notification to ${contact.name || contact.phone}`, 'info');
    
    const success = await postSendAndHandleResponse(payload, '', finalMessage, contact.phone, { innerHTML: '' });
    
    if (success) {
        console.log(`[Auto-Trigger] ✅ Successfully sent '${type}' notification to ${contact.phone}`);
        
        // Update ALL contacts with the same phone number
        const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
        let anyUpdated = false;
        
        for (let i = 0; i < contacts.length; i++) {
            if (contacts[i].phone === contact.phone) {
                // Set appropriate properties based on notification type
                if (type === 'start') {
                    contacts[i].startNotified = true;
                    contacts[i].startNotifiedAt = new Date().toISOString();
                } else if (type === 'renewal') {
                    contacts[i].renewalNotified = true;
                    contacts[i].renewalNotifiedAt = new Date().toISOString();
                } else if (type === 'end') {
                    contacts[i].notifiedEnd = true;
                    contacts[i].notifiedAt = new Date().toISOString();
                    contacts[i].expiryStatus = contact.endDate === getLocalDateString() ? 'notified_today' : 'notified_past_due';
                }
                anyUpdated = true;
            }
        }
        
        if (anyUpdated) {
            localStorage.setItem('wa_contacts', JSON.stringify(contacts));
            
            // FIX: Update UI immediately
            loadContacts();
        }
        
        logActivity({
            type: 'automation',
            message: `✅ Sent ${type} notification to ${contact.name || contact.phone}`,
            success: true,
            phone: contact.phone,
            notificationType: type
        });
        return true;
    } else {
        console.error(`[Auto-Trigger] ❌ Failed to send '${type}' notification to ${contact.phone}`);
        
        logActivity({
            type: 'automation',
            message: `❌ Failed to send ${type} notification to ${contact.name || contact.phone}`,
            success: false,
            phone: contact.phone,
            notificationType: type
        });
        return false;
    }
}

/**
 * Check and send automated messages for renewal/expiry
 */
async function checkAndSendAutomatedMessages() {
    console.log("[Auto-Responder] Starting automated message check...");
    
    const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const settings = JSON.parse(localStorage.getItem('wa_notification_settings') || '{}');
    
    console.log(`[Auto-Responder] Checking ${contacts.length} contacts`);
    console.log(`[Auto-Responder] Settings: Start=${!!settings.startMsg}, Renewal=${!!settings.renewalMsg}, End=${!!settings.endMsg}`);
    
    const today = getLocalDateString();
    const todayDate = new Date(today);
    todayDate.setHours(0, 0, 0, 0); // Normalize to start of day
    
    console.log(`[Auto-Responder] Today's date: ${today}`);
    
    let updated = false;
    
    for (let i = 0; i < contacts.length; i++) {
        const contact = contacts[i];
        
        // ============================================================
        // 1. CHECK FOR START DATE NOTIFICATIONS (WELCOME MESSAGES)
        // ============================================================
        if (contact.startDate) {
            const startDate = new Date(contact.startDate);
            startDate.setHours(0, 0, 0, 0);
            
            if (startDate.getTime() === todayDate.getTime() && 
                !contact.startNotified && 
                settings.startMsg) {
                console.log(`[Auto-Responder] 📧 Sending welcome notification to ${contact.name} (Start date: ${contact.startDate})`);
                try {
                    const success = await triggerAutomatedNotification('start', contact);
                    if (success) {
                        contacts[i].startNotified = true;
                        contacts[i].startNotifiedAt = new Date().toISOString();
                        updated = true;
                        console.log(`[Auto-Responder] ✅ Welcome notification sent to ${contact.name}`);
                    }
                    await sleep(1000);
                } catch (error) {
                    console.error(`[Auto-Responder] ❌ Error sending welcome:`, error);
                }
            }
        }
        
        // ============================================================
        // 2. CHECK FOR END DATE NOTIFICATIONS (EXPIRY MESSAGES)
        // ============================================================
        if (contact.endDate) {
            // Parse end date and normalize to start of day for comparison
            const endDate = new Date(contact.endDate);
            endDate.setHours(0, 0, 0, 0);
            
            // Check if TODAY is the end date (EXACT MATCH) - EXPIRY MESSAGE
            if (endDate.getTime() === todayDate.getTime() && 
                !contact.notifiedEnd && 
                settings.endMsg) {
                console.log(`[Auto-Responder] 📧 Sending expiry notification to ${contact.name} (Ends today: ${contact.endDate})`);
                
                try {
                    const success = await triggerAutomatedNotification('end', contact);
                    if (success) {
                        contacts[i].notifiedEnd = true;
                        contacts[i].notifiedAt = new Date().toISOString();
                        contacts[i].expiryStatus = 'notified_today';
                        updated = true;
                        console.log(`[Auto-Responder] ✅ Expiry notification sent to ${contact.name}`);
                    }
                    await sleep(1000);
                } catch (error) {
                    console.error(`[Auto-Responder] ❌ Error sending expiry notification to ${contact.name}:`, error);
                }
            }
            
            // Check for PAST DUE notifications (expired yesterday or earlier but not notified)
            else if (endDate.getTime() < todayDate.getTime() && 
                     !contact.notifiedEnd && 
                     settings.endMsg) {
                console.log(`[Auto-Responder] 📧 Sending PAST DUE expiry notification to ${contact.name} (Expired on ${contact.endDate})`);
                
                try {
                    const success = await triggerAutomatedNotification('end', contact);
                    if (success) {
                        contacts[i].notifiedEnd = true;
                        contacts[i].notifiedAt = new Date().toISOString();
                        contacts[i].expiryStatus = 'notified_past_due';
                        updated = true;
                        console.log(`[Auto-Responder] ✅ Past due notification sent to ${contact.name}`);
                    }
                    await sleep(1000);
                } catch (error) {
                    console.error(`[Auto-Responder] ❌ Error sending past due notification to ${contact.name}:`, error);
                }
            }
        }
    }
    
    if (updated) {
        localStorage.setItem('wa_contacts', JSON.stringify(contacts));
        console.log(`[Auto-Responder] Updated contacts in storage`);
        
        // CRITICAL FIX: RELOAD THE CONTACTS LIST TO SHOW UPDATED STATUS
        loadContacts();
    } else {
        console.log("[Auto-Responder] No notifications sent");
    }
    
    console.log("[Auto-Responder] Automated message check completed");
}

/* ========================================================================== */
/* 12. ACTIVITY LOGGING                                                       */
/* ========================================================================== */

/**
 * Fixed: Log activity with duplicate prevention
 */
function logActivity(activity) {
    const activities = JSON.parse(localStorage.getItem('wa_activities') || '[]');
    
    // Add timestamp if not provided
    if (!activity.time) {
        activity.time = new Date().toLocaleString();
    }
    
    // Add unique ID
    activity.id = Date.now() + Math.random().toString(36).substr(2, 9);
    
    activities.unshift(activity);
    
    // Keep only last 1000 activities
    if (activities.length > 1000) {
        activities.length = 1000;
    }
    
    localStorage.setItem('wa_activities', JSON.stringify(activities));
    
    // Update dashboard if active
    if (document.getElementById('view-dashboard')?.classList.contains('active')) {
        renderDashboard();
    }
    
    // Update logs if active
    if (document.getElementById('view-logs')?.classList.contains('active')) {
        renderLogs();
    }
}

/* ========================================================================== */
/* 13. TEMPLATES MANAGEMENT                                                   */
/* ========================================================================== */

function loadTemplates() {
    const templates = JSON.parse(localStorage.getItem('wa_templates') || '[]');
    const container = document.getElementById('templatesList');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!templates.length) {
        container.innerHTML = '<div class="text-muted small text-center p-3">No templates saved.</div>';
        return;
    }

    templates.forEach((tpl, i) => {
        const div = document.createElement('div');
        div.className = 'mb-2 p-2 border rounded bg-white';
        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <span class="text-truncate" style="max-width: 60%;">${escapeHtml(tpl)}</span>
                <div class="btn-group">
                    <button class="btn btn-sm btn-outline-primary" onclick="useTemplate(${i})">
                        <i class="bi bi-arrow-right"></i> Use
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteTemplate(${i})">
                        <i class="bi bi-trash"></i>
                    </button>
                </div>
            </div>`;
        container.appendChild(div);
    });
}

function saveTemplate() {
    const text = document.getElementById('templateText').value.trim();
    if (!text) {
        showToast('Template cannot be empty.', 'warning');
        return;
    }
    
    const templates = JSON.parse(localStorage.getItem('wa_templates') || '[]');
    templates.push(text);
    localStorage.setItem('wa_templates', JSON.stringify(templates));
    
    document.getElementById('templateText').value = '';
    loadTemplates();
    showToast('Template saved.', 'success');
}

function useTemplate(i) {
    const templates = JSON.parse(localStorage.getItem('wa_templates') || '[]');
    if (templates[i]) {
        document.getElementById('singleMessage').value = templates[i];
        showView('send');
        showToast('Template loaded to message field.', 'info');
    }
}

function deleteTemplate(i) {
    if (!confirm('Delete this template?')) return;
    
    const templates = JSON.parse(localStorage.getItem('wa_templates') || '[]');
    templates.splice(i, 1);
    localStorage.setItem('wa_templates', JSON.stringify(templates));
    loadTemplates();
    showToast('Template deleted.', 'info');
}

/* ========================================================================== */
/* 14. LOGS MANAGEMENT                                                        */
/* ========================================================================== */

function pushLog(entry) {
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    logs.unshift({
        time: new Date().toLocaleString(),
        to: entry.to,
        filename: entry.filename || '',
        message: entry.message || '',
        status: entry.status || 'unknown',
        ...entry
    });
    
    // Keep only last 500 logs
    const trimmedLogs = logs.slice(0, 500);
    localStorage.setItem('wa_logs', JSON.stringify(trimmedLogs));
    
    renderLogs();
    updateMessageCount();
}

function renderLogs() {
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    const activities = JSON.parse(localStorage.getItem('wa_activities') || '[]');
    const container = document.getElementById('logsTable');
    
    if (!container) return;
    
    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <ul class="nav nav-tabs" id="logsTabs">
                    <li class="nav-item">
                        <button class="nav-link active" onclick="showLogsTab('message')">
                            Message Logs (${logs.length})
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" onclick="showLogsTab('activity')">
                            Activity Logs (${activities.length})
                        </button>
                    </li>
                    <li class="nav-item">
                        <button class="nav-link" onclick="showLogsTab('system')">
                            System Info
                        </button>
                    </li>
                </ul>
            </div>
            <div class="card-body">
                <div id="messageLogsTab" class="tab-pane active">
                    ${renderMessageLogsContent(logs)}
                </div>
                <div id="activityLogsTab" class="tab-pane" style="display:none">
                    ${renderActivityLogsContent(activities)}
                </div>
                <div id="systemLogsTab" class="tab-pane" style="display:none">
                    ${renderSystemLogsContent()}
                </div>
            </div>
        </div>`;
}

function showLogsTab(tabName) {
    // Hide all tabs
    document.getElementById('messageLogsTab')?.style?.setProperty('display', 'none');
    document.getElementById('activityLogsTab')?.style?.setProperty('display', 'none');
    document.getElementById('systemLogsTab')?.style?.setProperty('display', 'none');
    
    // Remove active class from all tabs
    document.querySelectorAll('#logsTabs .nav-link').forEach(link => {
        link.classList.remove('active');
    });
    
    // Show selected tab
    const tabElement = document.getElementById(`${tabName}LogsTab`);
    if (tabElement) {
        tabElement.style.display = 'block';
    }
    
    // Add active class to clicked tab
    event.target.classList.add('active');
}

function renderMessageLogsContent(logs) {
    if (!logs.length) {
        return '<div class="text-muted text-center p-4">No message logs available.</div>';
    }
    
    let html = `
        <div class="table-responsive">
            <table class="table table-sm table-hover">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>To</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>`;
    
    logs.forEach((log, index) => {
        const statusBadge = log.status === 'sent' 
            ? '<span class="badge bg-success">Sent</span>' 
            : log.status === 'failed'
            ? '<span class="badge bg-danger">Failed</span>'
            : '<span class="badge bg-warning">Error</span>';
        
        const typeIcon = log.filename 
            ? '<i class="bi bi-paperclip" title="File"></i>' 
            : '<i class="bi bi-chat-text" title="Message"></i>';
        
        html += `
            <tr>
                <td>${log.time}</td>
                <td>${escapeHtml(log.to)}</td>
                <td>${typeIcon}</td>
                <td>${statusBadge}</td>
                <td>
                    <button class="btn btn-sm btn-outline-primary" onclick="resendFromLog(${index})" title="Resend">
                        <i class="bi bi-arrow-repeat"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteLogEntry(${index})" title="Delete">
                        <i class="bi bi-trash"></i>
                    </button>
                </td>
            </tr>`;
    });
    
    html += `
                </tbody>
            </table>
        </div>
        <div class="mt-3 d-flex justify-content-between">
            <button class="btn btn-sm btn-outline-primary" onclick="exportLogsCsv()">
                <i class="bi bi-download"></i> Export CSV
            </button>
            <button class="btn btn-sm btn-outline-danger" onclick="clearLogs()">
                <i class="bi bi-trash"></i> Clear All Logs
            </button>
        </div>`;
    
    return html;
}

function renderActivityLogsContent(activities) {
    if (!activities.length) {
        return '<div class="text-muted text-center p-4">No activity logs available.</div>';
    }
    
    let html = `
        <div class="table-responsive">
            <table class="table table-sm table-hover">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Type</th>
                        <th>Message</th>
                        <th>Details</th>
                    </tr>
                </thead>
                <tbody>`;
    
    activities.slice(0, 50).forEach((act, index) => {
        html += `
            <tr>
                <td>${act.time || ''}</td>
                <td><span class="badge bg-${getActivityBadgeColor(act.type)}">${act.type || 'Unknown'}</span></td>
                <td>${escapeHtml(act.message || '').substring(0, 80)}${(act.message || '').length > 80 ? '...' : ''}</td>
                <td>
                    ${act.recipients ? `<small>Recipients: ${act.recipients}</small><br>` : ''}
                    ${act.success ? `<small class="text-success">Success: ${act.success}</small>` : ''}
                    ${act.failed ? `<small class="text-danger">Failed: ${act.failed}</small>` : ''}
                    ${act.jobId ? `<small>Job ID: ${act.jobId}</small>` : ''}
                </td>
            </tr>`;
    });
    
    html += `
                </tbody>
            </table>
        </div>
        ${activities.length > 50 ? `
            <div class="alert alert-info">
                Showing 50 of ${activities.length} activities. 
                <button class="btn btn-sm btn-outline-primary ms-2" onclick="showAllActivity()">
                    View All
                </button>
            </div>
        ` : ''}
        <div class="mt-3">
            <button class="btn btn-sm btn-outline-primary" onclick="exportActivityCSV()">
                <i class="bi bi-download"></i> Export Activity CSV
            </button>
        </div>`;
    
    return html;
}

function renderSystemLogsContent() {
    const instances = JSON.parse(localStorage.getItem('wa_instances') || '[]');
    const activeInstance = getActiveInstance();
    
    return `
        <div class="row">
            <div class="col-md-6">
                <div class="card mb-3">
                    <div class="card-header">System Configuration</div>
                    <div class="card-body">
                        <table class="table table-sm">
                            <tr><td>Base Delay</td><td>${appConfig.rateDelay}ms</td></tr>
                            <tr><td>Jitter Enabled</td><td>${appConfig.randomizeDelay ? 'Yes' : 'No'}</td></tr>
                            <tr><td>Jitter Range</td><td>${appConfig.jitterRange}ms</td></tr>
                            <tr><td>File Size Limit</td><td>${appConfig.maxFileSizeMB}MB</td></tr>
                            <tr><td>Batch Size</td><td>${appConfig.batchSize}</td></tr>
                            <tr><td>Batch Delay</td><td>${appConfig.batchDelay / 1000}s</td></tr>
                            <tr><td>Parallel Limit</td><td>${appConfig.parallelLimit}</td></tr>
                            <tr><td>Max Contacts/Batch</td><td>${appConfig.maxContactsPerBatch}</td></tr>
                            <tr><td>Progressive Delay</td><td>${appConfig.enableProgressiveDelay ? 'Yes' : 'No'}</td></tr>
                            <tr><td>Master PC</td><td>${appConfig.isMasterPC ? 'Yes' : 'No'}</td></tr>
                            <tr><td>Master IP</td><td>${appConfig.masterIP || 'Not set'}</td></tr>
                            <tr><td>Watermark Enabled</td><td>${appConfig.enableWatermarking ? 'Yes' : 'No'}</td></tr>
                            <tr><td>Watermark Format</td><td>${appConfig.watermarkFormat || 'name_phone'}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
            <div class="col-md-6">
                <div class="card mb-3">
                    <div class="card-header">Active Instance</div>
                    <div class="card-body">
                        <table class="table table-sm">
                            <tr><td>Name</td><td>${activeInstance.name}</td></tr>
                            <tr><td>ID</td><td>${activeInstance.id}</td></tr>
                            <tr><td>Endpoint</td><td>${activeInstance.endpoint}</td></tr>
                            <tr><td>Token</td><td>${activeInstance.token ? '***' + activeInstance.token.slice(-4) : 'Not Set'}</td></tr>
                        </table>
                    </div>
                </div>
                <div class="card">
                    <div class="card-header">Storage Information</div>
                    <div class="card-body">
                        <table class="table table-sm">
                            <tr><td>Contacts</td><td>${JSON.parse(localStorage.getItem('wa_contacts') || '[]').length}</td></tr>
                            <tr><td>Templates</td><td>${JSON.parse(localStorage.getItem('wa_templates') || '[]').length}</td></tr>
                            <tr><td>Schedules</td><td>${JSON.parse(localStorage.getItem('wa_schedules') || '[]').length}</td></tr>
                            <tr><td>Message Logs</td><td>${JSON.parse(localStorage.getItem('wa_logs') || '[]').length}</td></tr>
                            <tr><td>Activity Logs</td><td>${JSON.parse(localStorage.getItem('wa_activities') || '[]').length}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        </div>`;
}

function resendFromLog(logIndex) {
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    const log = logs[logIndex];
    
    if (!log) {
        showToast('Log entry not found', 'error');
        return;
    }
    
    if (confirm(`Resend message to ${log.to}?`)) {
        // For resending, we need to reconstruct the payload
        // Since we don't store the full message/file in logs, we'll just send a message
        const payload = buildPayload(log.to, log.message || 'Resent message', '', '');
        postSendAndHandleResponse(payload, '', log.message || 'Resent message', log.to, null);
        showToast(`Resending to ${log.to}...`, 'info');
    }
}

function deleteLogEntry(logIndex) {
    if (!confirm('Delete this log entry?')) return;
    
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    logs.splice(logIndex, 1);
    localStorage.setItem('wa_logs', JSON.stringify(logs));
    renderLogs();
    showToast('Log entry deleted', 'info');
}

function exportLogsCsv() {
    const logs = JSON.parse(localStorage.getItem('wa_logs') || '[]');
    if (!logs.length) {
        showToast('No logs to export', 'info');
        return;
    }
    
    const headers = ['Timestamp', 'To', 'Filename', 'Message', 'Status'];
    const rows = logs.map(l => [
        l.time,
        l.to,
        l.filename || '',
        (l.message || '').replace(/"/g, '""').substring(0, 100),
        l.status
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_logs_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('Logs exported as CSV', 'success');
}

function clearLogs() {
    if (!confirm('Clear entire log history?')) return;
    
    localStorage.removeItem('wa_logs');
    renderLogs();
    showToast('Logs cleared.', 'info');
    
    logActivity({
        type: 'system',
        message: 'Cleared all message logs',
        success: true
    });
}

function showAllActivity() {
    const activities = JSON.parse(localStorage.getItem('wa_activities') || '[]');
    
    let html = `
        <div class="modal fade" id="activityModal" tabindex="-1">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">All Activities (${activities.length})</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="table-responsive">
                            <table class="table table-sm">
                                <thead>
                                    <tr>
                                        <th>Time</th>
                                        <th>Type</th>
                                        <th>Message</th>
                                        <th>Recipients</th>
                                        <th>Success</th>
                                        <th>Failed</th>
                                        <th>Job ID</th>
                                    </tr>
                                </thead>
                                <tbody>`;
    
    activities.forEach(act => {
        html += `
            <tr>
                <td>${act.time}</td>
                <td><span class="badge bg-${getActivityBadgeColor(act.type)}">${act.type}</span></td>
                <td>${escapeHtml(act.message || '')}</td>
                <td>${act.recipients || ''}</td>
                <td>${act.success || ''}</td>
                <td>${act.failed || ''}</td>
                <td>${act.jobId || ''}</td>
            </tr>`;
    });
    
    html += `
                                </tbody>
                            </table>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" onclick="exportActivityCSV()">
                            <i class="bi bi-download"></i> Export CSV
                        </button>
                    </div>
                </div>
            </div>
        </div>`;
    
    // Remove existing modal
    const existingModal = document.getElementById('activityModal');
    if (existingModal) existingModal.remove();
    
    // Add modal to body
    document.body.insertAdjacentHTML('beforeend', html);
    
    // Show modal
    const modal = new bootstrap.Modal(document.getElementById('activityModal'));
    modal.show();
}

function exportActivityCSV() {
    const activities = JSON.parse(localStorage.getItem('wa_activities') || '[]');
    if (!activities.length) {
        showToast('No activity to export', 'info');
        return;
    }
    
    const headers = ['Timestamp', 'Type', 'Message', 'Recipients', 'Success', 'Failed', 'Job ID'];
    const rows = activities.map(act => [
        act.time,
        act.type,
        (act.message || '').replace(/"/g, '""'),
        act.recipients || '',
        act.success || '',
        act.failed || '',
        act.jobId || ''
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_activity_${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    showToast('Activity log exported as CSV', 'success');
}

/* ========================================================================== */
/* 15. ADMIN FUNCTIONS                                                        */
/* ========================================================================== */

function loadAdminSettings() {
    // Delay settings
    const delayRange = document.getElementById('adminDelayRange');
    const delayDisplay = document.getElementById('adminDelayDisplay');
    
    if (delayRange && delayDisplay) {
        delayRange.value = appConfig.rateDelay;
        delayDisplay.textContent = `${appConfig.rateDelay}ms`;
    }
    
    // Jitter toggle
    const jitterToggle = document.getElementById('adminJitterToggle');
    if (jitterToggle) {
        jitterToggle.checked = appConfig.randomizeDelay;
    }
    
    // File size settings
    const sizeSlider = document.getElementById('adminFileSizeRange');
    const sizeDisplay = document.getElementById('adminFileSizeDisplay');
    
    if (sizeSlider && sizeDisplay) {
        sizeSlider.value = appConfig.maxFileSizeMB;
        sizeDisplay.textContent = `${appConfig.maxFileSizeMB}MB`;
    }
    
    // Master PC settings
    const masterToggle = document.getElementById('adminMasterToggle');
    const ipInput = document.getElementById('adminMasterIP');
    
    if (masterToggle && ipInput) {
        masterToggle.checked = appConfig.isMasterPC;
        ipInput.value = appConfig.masterIP || '';
    }
    
    // Enterprise settings
    const batchSize = document.getElementById('adminBatchSize');
    const batchDelay = document.getElementById('adminBatchDelay');
    const parallelLimit = document.getElementById('adminParallelLimit');
    const maxContacts = document.getElementById('adminMaxContacts');
    const safetyToggle = document.getElementById('adminSafetyToggle');
    const watermarkToggle = document.getElementById('adminWatermarkToggle');
    const watermarkFormat = document.getElementById('adminWatermarkFormat');
    const watermarkText = document.getElementById('adminWatermarkText');
    
    if (batchSize) batchSize.value = appConfig.batchSize;
    if (batchDelay) batchDelay.value = appConfig.batchDelay / 1000;
    if (parallelLimit) parallelLimit.value = appConfig.parallelLimit;
    if (maxContacts) maxContacts.value = appConfig.maxContactsPerBatch;
    if (safetyToggle) safetyToggle.checked = appConfig.enableProgressiveDelay;
    if (watermarkToggle) watermarkToggle.checked = appConfig.enableWatermarking;
    if (watermarkFormat) watermarkFormat.value = appConfig.watermarkFormat || 'name_phone';
    if (watermarkText) watermarkText.value = appConfig.watermarkText || '{name} - {phone}';
}

function loadAdminInstances() {
    const container = document.getElementById('adminInstanceList');
    if (!container) return;
    
    container.innerHTML = '';
    
    let instances = JSON.parse(localStorage.getItem('wa_instances') || '[]');
    
    // Ensure at least one default instance exists
    if (instances.length === 0) {
        instances.push({
            id: DEFAULT_CONFIG.currentInstanceId,
            name: 'Default Instance',
            endpoint: DEFAULT_CONFIG.currentEndpoint,
            token: ''
        });
        localStorage.setItem('wa_instances', JSON.stringify(instances));
    }
    
    const activeId = getActiveInstance().id;

    instances.forEach(inst => {
        const isActive = inst.id === activeId;
        const activeClass = isActive ? 'list-group-item-primary' : '';
        const activeBadge = isActive ? '<span class="badge bg-primary ms-2">Active</span>' : '';

        const item = document.createElement('div');
        item.className = `list-group-item d-flex justify-content-between align-items-center ${activeClass}`;
        
        item.innerHTML = `
            <div>
                <strong>${escapeHtml(inst.name)}</strong> ${activeBadge}<br>
                <small class="text-muted">ID: ${escapeHtml(inst.id)}</small><br>
                <small class="text-muted truncate">${escapeHtml(inst.endpoint)}</small>
            </div>
            <div class="btn-group">
                ${!isActive ? `
                    <button class="btn btn-sm btn-outline-primary" onclick="adminSwitchInstance('${inst.id}')">
                        Select
                    </button>
                ` : ''}
                <button class="btn btn-sm btn-outline-danger" onclick="adminDeleteInstance('${inst.id}')">
                    <i class="bi bi-trash"></i>
                </button>
            </div>
        `;
        container.appendChild(item);
    });
}

function adminAddInstance() {
    const name = document.getElementById('adminNewName').value.trim();
    const id = document.getElementById('adminNewId').value.trim();
    const endpoint = document.getElementById('adminNewEndpoint').value.trim();
    const token = document.getElementById('adminNewToken').value.trim();

    if (!name || !id || !endpoint) {
        showToast('Name, Instance ID, and Endpoint are required.', 'error');
        return;
    }

    const instances = JSON.parse(localStorage.getItem('wa_instances') || '[]');
    
    // Check for duplicate ID
    if (instances.some(i => i.id === id)) {
        showToast('Instance ID already exists.', 'error');
        return;
    }

    instances.push({ name, id, endpoint, token });
    localStorage.setItem('wa_instances', JSON.stringify(instances));
    
    // Clear form
    document.getElementById('adminNewName').value = '';
    document.getElementById('adminNewId').value = '';
    document.getElementById('adminNewEndpoint').value = '';
    document.getElementById('adminNewToken').value = '';
    
    loadAdminInstances();
    showToast('Instance configuration added.', 'success');
    
    logActivity({
        type: 'system',
        message: `Added WhatsApp instance: ${name} (${id})`,
        success: true
    });
}

function adminSwitchInstance(id) {
    localStorage.setItem('wa_active_instance_id', id);
    
    const active = getActiveInstance();
    appConfig.currentInstanceId = active.id;
    appConfig.currentEndpoint = active.endpoint;
    appConfig.currentToken = active.token;
    saveAppConfig();
    
    loadAdminInstances();
    updateHeaderInstanceInfo();
    showToast(`Switched to instance: ${active.name}`, 'success');
    
    logActivity({
        type: 'system',
        message: `Switched to WhatsApp instance: ${active.name}`,
        success: true
    });
}

function adminDeleteInstance(id) {
    if (!confirm('Are you sure you want to delete this instance configuration?')) return;
    
    let instances = JSON.parse(localStorage.getItem('wa_instances') || '[]');
    const instanceToDelete = instances.find(i => i.id === id);
    
    instances = instances.filter(i => i.id !== id);
    localStorage.setItem('wa_instances', JSON.stringify(instances));
    
    loadAdminInstances();
    showToast('Instance removed.', 'info');
    
    logActivity({
        type: 'system',
        message: `Deleted WhatsApp instance: ${instanceToDelete?.name || id}`,
        success: true
    });
}

async function adminDetectIP() {
    try {
        const ip = await getCurrentIP();
        document.getElementById('adminMasterIP').value = ip;
        showToast(`Detected IP: ${ip}`, 'info');
    } catch (error) {
        showToast('Failed to detect IP', 'error');
    }
}

async function adminCheckServer() {
    const badge = document.getElementById('adminServerStatus');
    badge.className = 'badge bg-warning text-dark';
    badge.innerHTML = '<i class="bi bi-hourglass-split"></i> Checking...';
    
    try {
        // Try root endpoint
        const response = await fetch('http://localhost:5000/');
        if (response.ok) {
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="bi bi-check-circle"></i> Online';
            showToast('Watermark Server is Online', 'success');
        } else {
            throw new Error('Non-200 Response');
        }
    } catch (e) {
        // Try API endpoint
        try {
            await fetch('http://localhost:5000/api/watermark_file', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ test: true })
            });
            badge.className = 'badge bg-success';
            badge.innerHTML = '<i class="bi bi-check-circle"></i> Online (API)';
            showToast('Watermark API is Reachable', 'success');
        } catch (innerError) {
            badge.className = 'badge bg-danger';
            badge.innerHTML = '<i class="bi bi-x-circle"></i> Offline';
            showToast('Cannot reach Python Server (localhost:5000)', 'error');
        }
    }
}

function adminSaveSettings() {
    // Save delay settings
    const delayVal = parseInt(document.getElementById('adminDelayRange').value);
    appConfig.rateDelay = delayVal;
    
    // Save jitter toggle
    const jitterToggle = document.getElementById('adminJitterToggle');
    if (jitterToggle) {
        appConfig.randomizeDelay = jitterToggle.checked;
    }
    
    // Save file size
    const sizeSlider = document.getElementById('adminFileSizeRange');
    if (sizeSlider) {
        appConfig.maxFileSizeMB = parseInt(sizeSlider.value);
        appConfig.maxFileSizeBytes = appConfig.maxFileSizeMB * 1024 * 1024;
    }
    
    // Save master PC settings
    const masterToggle = document.getElementById('adminMasterToggle');
    const ipInput = document.getElementById('adminMasterIP');
    
    if (masterToggle && ipInput) {
        appConfig.isMasterPC = masterToggle.checked;
        appConfig.masterIP = ipInput.value.trim();
    }
    
    // Save enterprise settings
    const batchSize = document.getElementById('adminBatchSize');
    const batchDelay = document.getElementById('adminBatchDelay');
    const parallelLimit = document.getElementById('adminParallelLimit');
    const maxContacts = document.getElementById('adminMaxContacts');
    const safetyToggle = document.getElementById('adminSafetyToggle');
    const watermarkToggle = document.getElementById('adminWatermarkToggle');
    const watermarkFormat = document.getElementById('adminWatermarkFormat');
    const watermarkText = document.getElementById('adminWatermarkText');
    
    if (batchSize) appConfig.batchSize = parseInt(batchSize.value);
    if (batchDelay) appConfig.batchDelay = parseInt(batchDelay.value) * 1000;
    if (parallelLimit) appConfig.parallelLimit = parseInt(parallelLimit.value);
    if (maxContacts) appConfig.maxContactsPerBatch = parseInt(maxContacts.value);
    if (safetyToggle) appConfig.enableProgressiveDelay = safetyToggle.checked;
    if (watermarkToggle) appConfig.enableWatermarking = watermarkToggle.checked;
    if (watermarkFormat) appConfig.watermarkFormat = watermarkFormat.value;
    if (watermarkText) appConfig.watermarkText = watermarkText.value;
    
    saveAppConfig();
    showToast('All settings saved successfully', 'success');
    
    logActivity({
        type: 'system',
        message: 'Updated system settings',
        success: true
    });
}

function adminFactoryReset() {
    const confirmation = prompt('Type "RESET" to confirm deletion of ALL data (Contacts, Logs, Settings).');
    if (confirmation === 'RESET') {
        localStorage.clear();
        showToast('All data cleared. Reloading...', 'warning');
        setTimeout(() => location.reload(), 2000);
    }
}

/* ========================================================================== */
/* 16. BACKUP & RESTORE                                                       */
/* ========================================================================== */

function downloadBackup() {
    const backupData = {
        meta: {
            date: new Date().toISOString(),
            version: '4.0',
            app: 'WhatsApp Sender Pro'
        },
        config: JSON.parse(localStorage.getItem('wa_app_config') || '{}'),
        contacts: JSON.parse(localStorage.getItem('wa_contacts') || '[]'),
        templates: JSON.parse(localStorage.getItem('wa_templates') || '[]'),
        instances: JSON.parse(localStorage.getItem('wa_instances') || '[]'),
        schedules: JSON.parse(localStorage.getItem('wa_schedules') || '[]'),
        logs: JSON.parse(localStorage.getItem('wa_logs') || '[]'),
        activities: JSON.parse(localStorage.getItem('wa_activities') || '[]'),
        notifications: JSON.parse(localStorage.getItem('wa_notification_settings') || '{}')
    };

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    
    const fileName = `whatsapp_backup_${new Date().toISOString().slice(0,10)}.json`;
    
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", fileName);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    
    showToast('Backup downloaded successfully', 'success');
    
    logActivity({
        type: 'system',
        message: 'Downloaded system backup',
        success: true
    });
}

function restoreBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(ev) {
        try {
            const data = JSON.parse(ev.target.result);
            
            // Basic validation
            if (!data.meta || !data.meta.app || data.meta.app !== 'WhatsApp Sender Pro') {
                throw new Error("Invalid backup file");
            }

            if (confirm('Restoring will OVERWRITE current data. Continue?')) {
                if (data.config) localStorage.setItem('wa_app_config', JSON.stringify(data.config));
                if (data.contacts) localStorage.setItem('wa_contacts', JSON.stringify(data.contacts));
                if (data.templates) localStorage.setItem('wa_templates', JSON.stringify(data.templates));
                if (data.instances) localStorage.setItem('wa_instances', JSON.stringify(data.instances));
                if (data.schedules) localStorage.setItem('wa_schedules', JSON.stringify(data.schedules));
                if (data.logs) localStorage.setItem('wa_logs', JSON.stringify(data.logs));
                if (data.activities) localStorage.setItem('wa_activities', JSON.stringify(data.activities));
                if (data.notifications) localStorage.setItem('wa_notification_settings', JSON.stringify(data.notifications));
                
                showToast('Restoration Complete! The page will reload.', 'success');
                
                logActivity({
                    type: 'system',
                    message: 'Restored system from backup',
                    success: true
                });
                
                setTimeout(() => location.reload(), 1500);
            }
        } catch(err) {
            console.error(err);
            showToast('Invalid Backup File Format', 'error');
        }
    };
    reader.readAsText(file);
}

/* ========================================================================== */
/* 17. NOTIFICATION AUTOMATION                                                */
/* ========================================================================== */

function loadNotificationSettings() {
    const savedSettings = localStorage.getItem('wa_notification_settings');
    const settings = savedSettings ? JSON.parse(savedSettings) : {};
    
    const startEl = document.getElementById('notifStartMsg');
    const renewalEl = document.getElementById('notifRenewalMsg');
    const endEl = document.getElementById('notifEndMsg');

    if (startEl) startEl.value = settings.startMsg || '';
    if (renewalEl) renewalEl.value = settings.renewalMsg || '';
    if (endEl) endEl.value = settings.endMsg || '';
}

function saveNotificationSettings() {
    const startMsg = document.getElementById('notifStartMsg').value.trim();
    const renewalMsg = document.getElementById('notifRenewalMsg').value.trim();
    const endMsg = document.getElementById('notifEndMsg').value.trim();

    const settings = {
        startMsg: startMsg,
        renewalMsg: renewalMsg,
        endMsg: endMsg
    };

    localStorage.setItem('wa_notification_settings', JSON.stringify(settings));
    showToast('Automation Notification Settings Saved Successfully', 'success');
    
    logActivity({
        type: 'system',
        message: 'Updated notification automation settings',
        success: true
    });
}

/* ========================================================================== */
/* 18. UTILITY FUNCTIONS                                                      */
/* ========================================================================== */

/**
 * Check if a contact's plan is being renewed (dates changed)
 * REMOVED: 7-day criteria
 */
function isPlanRenewed(oldContact, newContact) {
    const oldEnd = oldContact.endDate || "";
    const newEnd = newContact.endDate || "";
    const oldStart = oldContact.startDate || "";
    const newStart = newContact.startDate || "";
    
    // If no dates in new contact, not a renewal
    if (!newEnd && !newStart) return false;
    
    // Check if any date is being changed
    const startDateChanged = (oldStart !== newStart) && newStart;
    const endDateChanged = (oldEnd !== newEnd) && newEnd;
    
    // If either start or end date is changed, it's a renewal
    return startDateChanged || endDateChanged;
}

function getLocalDateString() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function buildPayload(to, msg, b64, fname) {
    const inst = getActiveInstance();
    return {
        to: to,
        body: msg || ' ',
        filename: fname || '',
        base64: b64 || '',
        instance_id: inst.id,
        token: inst.token
    };
}

async function postSendAndHandleResponse(payload, fname, msg, to, resDiv) {
    const inst = getActiveInstance();
    
    if (resDiv && resDiv.id === 'singleResult') {
        const progressEl = document.getElementById('singleProgress');
        if (progressEl) {
            progressEl.innerHTML = `<i class="bi bi-cloud-upload"></i> Sending to server (${inst.name})...`;
        }
    }

    try {
        const resp = await fetch(inst.endpoint || 'send.php', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });
        
        const json = await resp.json();
        
        let ok = false;
        let apiId = '';
        
        if (json.results && Array.isArray(json.results) && json.results.length > 0) {
            ok = json.results[0].success;
            apiId = json.results[0].id || '';
        } else if (json.success) {
            ok = true;
        } else if (resp.ok && !json.error) {
            ok = true;
        }

        if (resDiv && resDiv.id === 'singleResult') {
            const cls = ok ? 'alert-success' : 'alert-danger';
            const icon = ok ? 'check-circle' : 'x-circle';
            const txt = ok ? `Sent Successfully. ID: ${apiId}` : `Failed. Response: ${JSON.stringify(json)}`;
            resDiv.innerHTML = `<div class="alert ${cls}"><i class="bi bi-${icon}"></i> ${txt}</div>`;
        }
        
        pushLog({
            to: to,
            filename: fname,
            message: msg,
            status: ok ? 'sent' : 'failed',
            response: json
        });
        
        return ok;

    } catch (e) {
        console.error("Network/API Error:", e);
        if (resDiv && resDiv.id === 'singleResult') {
            resDiv.innerHTML = `<div class="alert alert-danger"><i class="bi bi-exclamation-triangle"></i> Network Error: ${e.message}</div>`;
        }
        
        pushLog({
            to: to,
            filename: fname,
            message: msg,
            status: 'error',
            error: e.message
        });
        
        return false;
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            const base64 = result.split(',')[1] || result;
            resolve(base64);
        };
        reader.onerror = error => reject(error);
        reader.readAsDataURL(file);
    });
}

/**
 * Get watermarked base64 file with name + phone number
 */
async function getWatermarkedBase64(base64, fileType, watermarkText, alignment = 'diagonal') {
    if (!appConfig.enableWatermarking) return base64;
    
    if (fileType !== 'application/pdf' && !fileType.startsWith('image/')) {
        return base64;
    }
    
    const API_ENDPOINT = 'http://localhost:5000/api/watermark_file';
    
    try {
        console.log(`[Watermark] Requesting watermark for: ${watermarkText}`);
        console.log(`[Watermark] File type: ${fileType}`);
        
        const resp = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                document_base64: base64,
                file_type: fileType,
                watermark_text: watermarkText,
                alignment: alignment || 'diagonal',
                font_size: 40,
                opacity: 0.3
            })
        });
        
        if (!resp.ok) {
            throw new Error(`Watermark Server Error: ${resp.status} - ${await resp.text()}`);
        }
        
        const data = await resp.json();
        
        if (!data.watermarked_base64) {
            throw new Error('Watermark Server returned empty data');
        }
        
        console.log(`[Watermark] Successfully watermarked: ${watermarkText}`);
        return data.watermarked_base64;
        
    } catch (error) {
        console.error("Watermark Generation Failed:", error);
        console.log("[Watermark] Falling back to original file");
        return base64;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
    return String(text || '').replace(/[&<>"']/g, m => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[m]);
}

function injectToastStyles() {
    const existing = document.getElementById('custom-toast-style');
    if (existing) return;

    const s = document.createElement('style');
    s.id = 'custom-toast-style';
    s.innerHTML = `
        #toast-container {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 10000;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .custom-toast {
            min-width: 300px;
            padding: 15px 20px;
            border-radius: 8px;
            color: white;
            opacity: 0;
            animation: fadeIn 0.4s forwards;
            box-shadow: 0 5px 15px rgba(0,0,0,0.2);
            font-family: system-ui, -apple-system, sans-serif;
            font-size: 14px;
            display: flex;
            align-items: center;
        }
        .toast-success { background-color: #198754; border-left: 5px solid #0f5132; }
        .toast-warning { background-color: #ffc107; color: #000; border-left: 5px solid #d39e00; }
        .toast-error { background-color: #dc3545; border-left: 5px solid #842029; }
        .toast-info { background-color: #0dcaf0; color: #000; border-left: 5px solid #0aa2c0; }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateX(20px); }
            to { opacity: 1; transform: translateX(0); }
        }
        @keyframes fadeOut {
            from { opacity: 1; transform: translateX(0); }
            to { opacity: 0; transform: translateX(20px); }
        }
    `;
    document.head.appendChild(s);
    
    const c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `custom-toast toast-${type}`;
    toast.innerHTML = `
        <i class="bi ${type === 'success' ? 'bi-check-circle' : 
                      type === 'warning' ? 'bi-exclamation-triangle' : 
                      type === 'error' ? 'bi-x-circle' : 'bi-info-circle'} me-2"></i>
        ${message}
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.5s forwards';
        toast.addEventListener('animationend', () => toast.remove());
    }, 3500);
}

/* ========================================================================== */
/* 19. CSV IMPORT HANDLERS                                                    */
/* ========================================================================== */

function handleContactCsvImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = () => {
        const content = reader.result;
        const lines = content.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        
        let list = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
        let addedCount = 0;
        
        lines.forEach((line) => {
            const parts = line.split(',').map(p => p.trim());
            let name, phone, startDate, endDate;
            
            if (parts.length >= 2) {
                name = parts[0];
                phone = parts[1].replace(/[^0-9+]/g, '');
                startDate = parts[2] || '';
                endDate = parts[3] || '';
            } else if (parts.length === 1) {
                phone = parts[0].replace(/[^0-9+]/g, '');
                name = phone;
            } else {
                return;
            }
            
            if (phone) {
                if (!list.some(existingC => existingC.phone === phone)) {
                    list.push({
                        name: name || phone,
                        phone: phone,
                        startDate: startDate,
                        endDate: endDate,
                        notifiedEnd: false,
                        importedAt: new Date().toISOString()
                    });
                    addedCount++;
                }
            }
        });
        
        if (addedCount > 0) {
            localStorage.setItem('wa_contacts', JSON.stringify(list));
            loadContacts();
            showToast(`Successfully imported ${addedCount} new contacts.`, 'success');
            
            logActivity({
                type: 'contact',
                message: `Imported ${addedCount} contacts from CSV`,
                success: true
            });
        } else {
            showToast('No new valid contacts found in CSV.', 'warning');
        }
        
        e.target.value = '';
    };
    reader.readAsText(file);
}

/* ========================================================================== */
/* 20. DEBUG & TEST FUNCTIONS                                                 */
/* ========================================================================== */

/**
 * Test function for auto-responder
 */
function testAutoResponder() {
    console.log("🧪 Manually triggering auto-responder...");
    console.log("📅 Today's date:", getLocalDateString());
    
    const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    console.log("👥 Total contacts:", contacts.length);
    
    contacts.forEach((contact, i) => {
        console.log(`${i + 1}. ${contact.name} (${contact.phone}):`, {
            start: contact.startDate,
            end: contact.endDate,
            startNotified: contact.startNotified,
            notifiedEnd: contact.notifiedEnd,
            renewalNotified: contact.renewalNotified
        });
    });
    
    // Trigger the auto-responder
    checkAndSendAutomatedMessages();
}

/**
 * Force send renewal for a specific contact (debug tool)
 */
function forceRenewal(phoneNumber) {
    const contacts = JSON.parse(localStorage.getItem('wa_contacts') || '[]');
    const contact = contacts.find(c => c.phone === phoneNumber);
    
    if (!contact) {
        console.error("Contact not found:", phoneNumber);
        return;
    }
    
    console.log("🚀 Forcing renewal for:", contact.name);
    triggerAutomatedNotification('renewal', contact);
}

/**
 * Test watermark functionality
 */
function testWatermark() {
    console.log("🎨 Testing Watermark Settings:");
    console.log("- Enabled:", appConfig.enableWatermarking);
    console.log("- Format:", appConfig.watermarkFormat);
    console.log("- Custom Text:", appConfig.watermarkText);
    console.log("- Example: John Doe - +1234567890 =", generateWatermarkText("John Doe", "+1234567890"));
}

/* ========================================================================== */
/* 21. INITIALIZATION COMPLETE                                                */
/* ========================================================================== */

console.log('WhatsApp Sender Pro v4.0 - Fully Fixed Enterprise Edition Initialized');