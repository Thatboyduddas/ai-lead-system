// Duddas CRM v6.0.1 - Chrome Extension with AI Assistant
// Fixed for SalesGod's actual HTML structure

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";
const VERSION = "6.0.1";
let lastSentHash = "";
let lastFullSyncHash = "";
let currentPhone = null;
let pendingInProgress = false;
let tagInProgress = false;
let queueProcessing = false;
let autoSendEnabled = false;
let syncEnabled = true; // Sync mode - controlled from dashboard
let lastConversationPhone = null;

// CACHING - Prevent constant DOM scraping
let cachedConversationData = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 2000; // 2 seconds cache

// Check sync setting from server
async function checkSyncSetting() {
  try {
    const res = await fetch(DASHBOARD_URL + '/api/settings/sync');
    const data = await res.json();
    syncEnabled = data.enabled;
    updateSyncIndicator();
  } catch (err) {
    // Default to enabled if can't reach server
    syncEnabled = true;
  }
}

// Update the sync indicator in the AI panel
function updateSyncIndicator() {
  const dot = document.getElementById('duddas-sync-dot');
  if (dot) {
    dot.style.background = syncEnabled ? '#22c55e' : '#ef4444';
    dot.title = syncEnabled ? 'Sync ON' : 'Sync OFF';
  }
}

// Check sync setting every 10 seconds
setInterval(checkSyncSetting, 10000);
checkSyncSetting(); // Initial check

// ============================================
// CONVERSATION DATA EXTRACTION (Fixed for SalesGod)
// ============================================

function extractConversationData(forceRefresh = false) {
  // Return cached data if still valid (prevents constant DOM scraping)
  const now = Date.now();
  if (!forceRefresh && cachedConversationData && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedConversationData;
  }

  let contactName = "";
  let phone = "";
  let currentTag = "";
  let allMessages = [];
  let isArchived = false;
  let viewType = "recent";

  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());

  // Find phone number in the conversation header
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/) || lines[i].match(/^\+1\d{10}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }

  if (phone) currentPhone = phone.replace(/[^0-9+]/g, '');

  // Detect active tab/view in SalesGod
  const tabButtons = document.querySelectorAll('button');
  tabButtons.forEach(btn => {
    const text = btn.innerText?.toLowerCase() || '';
    const isActive = btn.classList.contains('bg-primary-500') ||
                     btn.classList.contains('btn-primary') ||
                     btn.style.backgroundColor?.includes('rgb');
    if (isActive) {
      if (text.includes('archived')) { isArchived = true; viewType = 'archived'; }
      else if (text.includes('unread')) { viewType = 'unread'; }
      else if (text.includes('all')) { viewType = 'all'; }
      else if (text.includes('recent')) { viewType = 'recent'; }
    }
  });

  // Get tag from dropdown if visible
  const tagDropdown = document.querySelector('select, [class*="tag-select"]');
  if (tagDropdown) {
    currentTag = tagDropdown.value || '';
  }

  // FIXED: Extract messages using SalesGod's actual class names
  // Messages are in <li> elements with class "chat-list"
  // "left" class = incoming, "right" class = outgoing
  const messageElements = document.querySelectorAll('li.chat-list, li[class*="chat-list"]');

  messageElements.forEach(li => {
    const classList = li.className || '';
    const isOutgoing = classList.includes('right');
    const isIncoming = classList.includes('left');

    // Get the message text from inside the li
    const messageDiv = li.querySelector('.message, [class*="message"], .flex-column');
    let msgText = '';

    if (messageDiv) {
      msgText = messageDiv.innerText?.trim() || '';
    } else {
      // Fallback: get text directly but exclude timestamps/metadata
      msgText = li.innerText?.trim() || '';
    }

    // Clean up the message text
    msgText = msgText
      .replace(/\d{1,2}\/\d{1,2}\/\d{4},?\s*\d{1,2}:\d{2}(:\d{2})?\s*[AP]M/gi, '') // Remove timestamps
      .replace(/^\s*sent\s*$/i, '') // Remove "sent" labels
      .replace(/^\s*delivered\s*$/i, '') // Remove "delivered" labels
      .trim();

    if (msgText && msgText.length > 0 && msgText.length < 2000 && (isOutgoing || isIncoming)) {
      allMessages.push({
        text: msgText,
        isOutgoing: isOutgoing,
        timestamp: new Date().toISOString() // SalesGod doesn't expose timestamps easily
      });
    }
  });

  // Fallback: try alternate selectors if no messages found
  if (allMessages.length === 0) {
    document.querySelectorAll('[class*="message"], [class*="bubble"], [class*="chat-message"]').forEach(el => {
      const msgText = el.innerText?.trim();
      if (msgText && msgText.length > 0 && msgText.length < 2000) {
        // Try to determine direction from parent classes or position
        const parent = el.closest('li, div');
        const parentClass = parent?.className || '';
        const isOutgoing = parentClass.includes('right') || parentClass.includes('outbound') || parentClass.includes('sent');
        allMessages.push({ text: msgText, isOutgoing });
      }
    });
  }

  // Cache the result
  cachedConversationData = {
    contactName,
    phone,
    currentTag,
    messages: allMessages,
    lastMessage: allMessages[allMessages.length - 1] || null,
    isArchived,
    viewType
  };
  cacheTimestamp = now;

  return cachedConversationData;
}

function sendToDashboard(data, forceFullSync = false, bypassSyncCheck = false) {
  // Check if sync is enabled (unless bypassed by manual sync button)
  if (!syncEnabled && !bypassSyncCheck) {
    console.log('⏸️ Sync is OFF - skipping');
    return;
  }

  if (!data.phone || data.messages.length === 0) return;
  const lastMsg = data.lastMessage;
  if (!lastMsg) return;

  // Check if this is a new conversation (different phone) - trigger full sync
  const isNewConversation = data.phone !== lastConversationPhone;
  if (isNewConversation) {
    lastConversationPhone = data.phone;
    forceFullSync = true; // Always full sync when switching conversations
    console.log(`📞 New conversation detected: ${data.phone} - triggering full sync`);
  }

  // For full sync, use a different hash to track
  const fullSyncHash = data.phone + "|full|" + data.messages.length;
  const quickSyncHash = data.phone + "|" + data.messages.length + "|" + lastMsg.text.substring(0, 100);

  if (forceFullSync) {
    // Full sync - send ALL messages
    if (fullSyncHash === lastFullSyncHash) return;
    lastFullSyncHash = fullSyncHash;

    console.log(`📤 Full sync: ${data.phone} with ${data.messages.length} messages`);

    fetch(DASHBOARD_URL + "/webhook/salesgod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: data.phone,
        full_name: data.contactName,
        messages_as_string: lastMsg.text,
        status: data.currentTag || "new",
        isOutgoing: lastMsg.isOutgoing,
        messageCount: data.messages.length,
        isArchived: data.isArchived || false,
        viewType: data.viewType || "recent",
        fullSync: true,
        allMessages: data.messages
      })
    }).then(() => {
      console.log(`✅ Full sync complete for ${data.phone}`);
    }).catch(err => {
      console.error(`❌ Full sync failed:`, err);
    });
  } else {
    // Quick sync - just the last message (for real-time updates)
    if (quickSyncHash === lastSentHash) return;
    lastSentHash = quickSyncHash;

    fetch(DASHBOARD_URL + "/webhook/salesgod", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: data.phone,
        full_name: data.contactName,
        messages_as_string: lastMsg.text,
        status: data.currentTag || "new",
        isOutgoing: lastMsg.isOutgoing,
        messageCount: data.messages.length,
        isArchived: data.isArchived || false,
        viewType: data.viewType || "recent"
      })
    }).catch(() => {});
  }
}

// ============================================
// MESSAGE INPUT & SEND FUNCTIONS
// ============================================

function findSendButton() {
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    if (btn.innerText.trim().toLowerCase() === 'send') {
      return btn;
    }
  }

  const svgs = document.querySelectorAll('svg');
  let rightmostSvg = null;
  let maxRight = 0;

  for (const svg of svgs) {
    const rect = svg.getBoundingClientRect();
    if (rect.top > window.innerHeight - 100 && rect.right > maxRight && rect.width > 0) {
      maxRight = rect.right;
      rightmostSvg = svg;
    }
  }

  if (rightmostSvg) {
    return rightmostSvg.closest('button') || rightmostSvg.parentElement || rightmostSvg;
  }

  return null;
}

function findMessageInput() {
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
    if (placeholder.includes('message')) return ta;
  }
  return textareas[textareas.length - 1];
}

async function typeAndSend(message) {
  const textarea = findMessageInput();
  if (!textarea) {
    showNotif("❌ No message input found", "error");
    return false;
  }

  textarea.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, message);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));

  await new Promise(r => setTimeout(r, 800));

  const sendBtn = findSendButton();
  if (!sendBtn) {
    showNotif("❌ No send button found", "error");
    return false;
  }

  sendBtn.click();
  if (sendBtn.tagName?.toLowerCase() === 'svg') sendBtn.parentElement?.click();

  return true;
}

function showNotif(msg, type) {
  const existing = document.getElementById("duddas-notif");
  if (existing) existing.remove();

  const n = document.createElement("div");
  n.id = "duddas-notif";
  n.style.cssText = `position:fixed;top:20px;right:20px;background:${type === 'error' ? '#ef4444' : type === 'info' ? '#3b82f6' : '#22c55e'};color:white;padding:12px 18px;border-radius:8px;z-index:99999;font-family:sans-serif;font-size:13px;font-weight:600;box-shadow:0 4px 12px rgba(0,0,0,0.3);`;
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 4000);
}

// ============================================
// QUEUE-BASED AUTO-SEND WITH NAVIGATION
// ============================================

async function navigateToLead(phone) {
  // Clean the phone number
  const cleanPhone = phone.replace(/[^0-9+]/g, '');

  // Method 1: Look for search input and search for the phone
  const searchInputs = document.querySelectorAll('input[type="text"], input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]');

  for (const input of searchInputs) {
    const rect = input.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      input.focus();
      input.value = cleanPhone;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

      // Wait for search results
      await new Promise(r => setTimeout(r, 1500));
      break;
    }
  }

  // Method 2: Look for conversation list items and click matching one
  await new Promise(r => setTimeout(r, 500));

  // Look for clickable elements containing the phone number
  const allElements = document.querySelectorAll('div, span, a, li, tr, td');
  for (const el of allElements) {
    const text = el.innerText || '';
    // Match phone in various formats
    if (text.includes(cleanPhone) ||
        text.includes(cleanPhone.replace('+1', '')) ||
        text.includes(formatPhoneDisplay(cleanPhone))) {

      // Find the clickable conversation item
      const clickable = el.closest('[class*="cursor-pointer"]') ||
                        el.closest('[class*="hover"]') ||
                        el.closest('li') ||
                        el.closest('tr') ||
                        el;

      if (clickable && clickable.offsetParent !== null) {
        clickable.click();
        console.log(`📱 Clicked on conversation for ${cleanPhone}`);
        await new Promise(r => setTimeout(r, 1000));
        return true;
      }
    }
  }

  // Method 3: Try direct URL navigation if SalesGod supports it
  // This is a fallback - may not work depending on SalesGod's URL structure

  return false;
}

function formatPhoneDisplay(phone) {
  // Convert +15551234567 to +1 555-123-4567 for matching
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length === 11 && clean.startsWith('1')) {
    return `+1 ${clean.slice(1,4)}-${clean.slice(4,7)}-${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `+1 ${clean.slice(0,3)}-${clean.slice(3,6)}-${clean.slice(6)}`;
  }
  return phone;
}

async function processMessageQueue() {
  if (queueProcessing) return;
  queueProcessing = true;

  try {
    // Check for next message in queue
    const res = await fetch(DASHBOARD_URL + '/api/queue/next');
    const data = await res.json();

    if (!data.pending) {
      queueProcessing = false;
      return;
    }

    const { phone, name, message, queueLength } = data;
    console.log(`📬 Queue has ${queueLength} message(s). Processing: ${phone}`);
    showNotif(`📬 Sending to ${name || phone}... (${queueLength} in queue)`, "info");

    // Check if we're already on the right conversation
    extractConversationData();
    const cleanTargetPhone = phone.replace(/[^0-9+]/g, '');

    if (currentPhone !== cleanTargetPhone) {
      // Need to navigate to this lead
      console.log(`🔍 Navigating from ${currentPhone} to ${cleanTargetPhone}`);
      showNotif(`🔍 Finding ${name || phone}...`, "info");

      const navigated = await navigateToLead(phone);
      if (!navigated) {
        console.log(`❌ Could not navigate to ${phone}`);
        showNotif(`❌ Could not find ${name || phone} - skipping`, "error");
        // Don't mark as sent - leave in queue for manual handling
        queueProcessing = false;
        return;
      }

      // Re-extract after navigation
      await new Promise(r => setTimeout(r, 1500));
      extractConversationData();
    }

    // Verify we're on the right conversation
    if (currentPhone === cleanTargetPhone || currentPhone?.includes(cleanTargetPhone.slice(-10))) {
      // Type and send the message
      const sent = await typeAndSend(message);

      if (sent) {
        // Mark as sent in the queue
        await fetch(DASHBOARD_URL + '/api/queue/sent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: phone })
        });

        showNotif(`✅ Sent to ${name || phone}!`, "success");
        console.log(`✅ Message sent to ${phone}`);

        // Wait before processing next
        await new Promise(r => setTimeout(r, 3000));
      } else {
        showNotif(`❌ Failed to send to ${name || phone}`, "error");
      }
    } else {
      console.log(`❌ Navigation mismatch: expected ${cleanTargetPhone}, got ${currentPhone}`);
      showNotif(`❌ Wrong conversation - skipping`, "error");
    }

  } catch (err) {
    console.error('Queue processing error:', err);
  }

  queueProcessing = false;
}

async function checkAutoSendStatus() {
  try {
    const res = await fetch(DASHBOARD_URL + '/api/settings/auto-send');
    const data = await res.json();
    autoSendEnabled = data.enabled;
  } catch (err) {
    // Silently fail
  }
}

// ============================================
// TAG AUTOMATION
// ============================================

function findTagDropdown() {
  const selects = document.querySelectorAll('select');
  for (const select of selects) {
    const options = select.querySelectorAll('option');
    for (const opt of options) {
      if (opt.textContent.toLowerCase().includes('age and gender') ||
          opt.textContent.toLowerCase().includes('quoted') ||
          opt.textContent.toLowerCase().includes('follow up')) {
        return { type: 'select', element: select };
      }
    }
  }

  const buttons = document.querySelectorAll('button, [role="button"], [role="combobox"]');
  for (const btn of buttons) {
    const text = btn.innerText?.toLowerCase() || '';
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    if (text.includes('tag') || text.includes('workflow') || text.includes('status') ||
        ariaLabel.includes('tag') || ariaLabel.includes('workflow')) {
      return { type: 'button', element: btn };
    }
  }

  const dropdowns = document.querySelectorAll('[class*="dropdown"], [class*="select"], [class*="tag"]');
  for (const dd of dropdowns) {
    if (dd.innerText?.toLowerCase().includes('quoted') ||
        dd.innerText?.toLowerCase().includes('age and gender')) {
      return { type: 'custom', element: dd };
    }
  }

  const allClickables = document.querySelectorAll('div[class*="cursor-pointer"], span[class*="cursor-pointer"]');
  for (const el of allClickables) {
    const text = el.innerText?.trim() || '';
    if (text.match(/^(Quoted|Age and gender|Follow up|Ghosted|Deadline|Sold|Dead|New|Medicare)/i)) {
      return { type: 'trigger', element: el };
    }
  }

  return null;
}

async function clickTagOption(tagName) {
  await new Promise(r => setTimeout(r, 300));

  const allOptions = document.querySelectorAll(
    'li, [role="option"], [role="menuitem"], option, ' +
    'div[class*="option"], div[class*="item"], span[class*="option"]'
  );

  for (const opt of allOptions) {
    const text = opt.innerText?.trim().toLowerCase() || '';
    const targetTag = tagName.toLowerCase();

    if (text === targetTag || text.includes(targetTag)) {
      opt.click();
      showNotif(`✅ Tag: ${tagName}`, "success");
      return true;
    }
  }

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  while (walker.nextNode()) {
    if (walker.currentNode.textContent?.trim().toLowerCase() === tagName.toLowerCase()) {
      const parent = walker.currentNode.parentElement;
      if (parent && parent.offsetParent !== null) {
        parent.click();
        showNotif(`✅ Tag: ${tagName}`, "success");
        return true;
      }
    }
  }

  return false;
}

async function applyTag(tagName) {
  const dropdown = findTagDropdown();

  if (!dropdown) {
    showNotif("⚠️ Tag dropdown not found", "error");
    return false;
  }

  const { type, element } = dropdown;

  if (type === 'select') {
    const options = element.querySelectorAll('option');
    for (const opt of options) {
      if (opt.textContent.toLowerCase().includes(tagName.toLowerCase())) {
        element.value = opt.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        showNotif(`✅ Tag: ${tagName}`, "success");
        return true;
      }
    }
  } else {
    element.click();
    await new Promise(r => setTimeout(r, 500));

    const applied = await clickTagOption(tagName);
    if (applied) return true;

    element.click();
    await new Promise(r => setTimeout(r, 300));
    return await clickTagOption(tagName);
  }

  showNotif(`❌ Tag "${tagName}" not found`, "error");
  return false;
}

async function checkPendingTags() {
  if (tagInProgress) return;

  extractConversationData();

  if (!currentPhone) return;
  tagInProgress = true;

  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/tag`);
    const data = await res.json();

    if (data.tagToApply) {
      console.log(`📋 Pending tag for ${currentPhone}: ${data.tagToApply}`);
      const success = await applyTag(data.tagToApply);
      if (success) {
        console.log(`✅ Tag "${data.tagToApply}" applied!`);
        await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/tag`, {
          method: 'DELETE'
        });
      }
    }
  } catch (err) {
    // Silently fail
  }

  tagInProgress = false;
}

// ============================================
// LEGACY: Check pending for current lead only
// ============================================

async function checkPendingSends() {
  if (!currentPhone || pendingInProgress || queueProcessing) return;
  pendingInProgress = true;

  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`);
    const data = await res.json();

    if (data.pending && data.message) {
      showNotif(`📤 Sending message...`, "info");
      const sent = await typeAndSend(data.message);
      if (sent) {
        await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`, { method: 'DELETE' });
        showNotif(`✅ Message sent!`, "success");
      }
    }
  } catch (err) {}

  pendingInProgress = false;
}

function checkAndSync() {
  const data = extractConversationData();
  if (data.messages.length > 0 && data.phone) {
    sendToDashboard(data, false); // Quick sync by default
  }
}

// Auto full-sync when conversation changes
let conversationCheckInterval = null;
function monitorConversationChanges() {
  const data = extractConversationData();
  if (data.phone && data.phone !== lastConversationPhone && data.messages.length > 0) {
    // New conversation opened - full sync
    sendToDashboard(data, true);
  }
}

// Watch for DOM changes that indicate a new conversation was opened
const conversationObserver = new MutationObserver((mutations) => {
  // Debounce - wait for DOM to settle (increased to reduce glitching)
  clearTimeout(window.domSettleTimeout);
  window.domSettleTimeout = setTimeout(() => {
    const data = extractConversationData();
    if (data.phone && data.messages.length > 0) {
      // Check if this is a genuinely new conversation
      const newHash = data.phone + '|' + data.messages.length;
      if (newHash !== window.lastObservedHash) {
        window.lastObservedHash = newHash;
        sendToDashboard(data, true); // Full sync on any significant change
        updateAIBoxLeadInfo(); // Update suggestion box
      }
    }
  }, 1500); // Increased from 1000 to 1500ms
});

// Start observing the page for changes
function startConversationMonitoring() {
  const chatContainer = document.querySelector('[class*="chat"], [class*="conversation"], [class*="messages"], main, #app');
  if (chatContainer) {
    conversationObserver.observe(chatContainer, {
      childList: true,
      subtree: true
    });
    console.log('👀 Monitoring SalesGod for conversation changes');
  } else {
    // Retry if container not found yet
    setTimeout(startConversationMonitoring, 2000);
  }
}

// ============================================
// STATUS INDICATOR
// ============================================

function createStatusIndicator() {
  const existing = document.getElementById('duddas-status');
  if (existing) existing.remove();

  const indicator = document.createElement('div');
  indicator.id = 'duddas-status';
  indicator.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: linear-gradient(135deg, #0d1424, #1e293b);
    color: white;
    padding: 0;
    border-radius: 16px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 13px;
    z-index: 99998;
    width: 320px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    border: 1px solid rgba(251,191,36,0.3);
    overflow: hidden;
  `;
  indicator.innerHTML = `
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#991b1b,#1e3a5f);padding:12px 16px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #fbbf24;">
      <div style="display:flex;align-items:center;gap:8px;">
        <span style="font-size:18px;">🦅</span>
        <span style="font-weight:700;font-size:14px;">Duddas AI</span>
        <span style="font-size:10px;color:#a1a1aa;">v${VERSION}</span>
        <span id="duddas-sync-dot" style="width:8px;height:8px;background:#22c55e;border-radius:50%;"></span>
      </div>
      <button id="duddas-minimize" style="background:none;border:none;color:#fff;cursor:pointer;font-size:16px;padding:0;">−</button>
    </div>

    <!-- AI Response Area -->
    <div id="duddas-ai-content" style="padding:12px;">
      <!-- Current Lead Info -->
      <div id="duddas-lead-info" style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Current Lead</div>
        <div id="duddas-lead-name" style="font-weight:600;color:#fff;">No conversation open</div>
        <div id="duddas-lead-phone" style="font-size:11px;color:#a1a1aa;"></div>
      </div>

      <!-- Suggested Response -->
      <div id="duddas-suggestion-box" style="display:none;background:linear-gradient(135deg,rgba(34,197,94,0.15),rgba(34,197,94,0.05));border:1px solid rgba(34,197,94,0.3);border-radius:8px;padding:10px;margin-bottom:10px;">
        <div style="font-size:11px;color:#22c55e;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;font-weight:600;">💡 Suggested Response</div>
        <div id="duddas-suggestion-text" style="font-size:13px;color:#fff;line-height:1.4;max-height:60px;overflow-y:auto;"></div>
        <button id="duddas-copy-suggestion" style="margin-top:8px;background:#22c55e;color:#fff;border:none;padding:6px 12px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;width:100%;">📋 Copy Response</button>
      </div>

      <!-- AI Chat Area -->
      <div id="duddas-ai-response" style="background:rgba(0,0,0,0.2);border-radius:8px;padding:10px;margin-bottom:10px;min-height:60px;max-height:150px;overflow-y:auto;font-size:13px;color:#e4e4e7;line-height:1.5;">
        <span style="color:#71717a;">Ask me anything about your leads...</span>
      </div>

      <!-- AI Input -->
      <div style="display:flex;gap:8px;">
        <input type="text" id="duddas-ai-input" placeholder="Who mentioned golf? Follow-ups?" style="flex:1;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:10px 12px;color:#fff;font-size:13px;outline:none;" />
        <button id="duddas-ai-send" style="background:linear-gradient(135deg,#fbbf24,#b45309);color:#000;border:none;padding:10px 14px;border-radius:8px;font-weight:700;cursor:pointer;">Ask</button>
      </div>

      <!-- Quick Actions -->
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
        <button class="duddas-quick-btn" data-query="Who needs follow up?" style="background:rgba(59,130,246,0.2);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">📞 Follow-ups</button>
        <button class="duddas-quick-btn" data-query="Show hot leads" style="background:rgba(239,68,68,0.2);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">🔥 Hot</button>
        <button class="duddas-quick-btn" data-query="Who is ready to book?" style="background:rgba(34,197,94,0.2);border:1px solid rgba(34,197,94,0.3);color:#4ade80;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">💰 Ready</button>
        <button id="duddas-force-sync" style="background:rgba(251,191,36,0.2);border:1px solid rgba(251,191,36,0.3);color:#fbbf24;padding:6px 10px;border-radius:6px;font-size:10px;cursor:pointer;">🔄 Sync</button>
      </div>
    </div>
  `;

  document.body.appendChild(indicator);

  // Minimize toggle
  let isMinimized = false;
  document.getElementById('duddas-minimize').onclick = () => {
    isMinimized = !isMinimized;
    document.getElementById('duddas-ai-content').style.display = isMinimized ? 'none' : 'block';
    document.getElementById('duddas-minimize').textContent = isMinimized ? '+' : '−';
  };

  // Copy suggestion
  document.getElementById('duddas-copy-suggestion').onclick = () => {
    const text = document.getElementById('duddas-suggestion-text').textContent;
    navigator.clipboard.writeText(text);
    showNotif('✅ Copied to clipboard!', 'success');
  };

  // AI input handling
  const aiInput = document.getElementById('duddas-ai-input');
  const aiSend = document.getElementById('duddas-ai-send');

  aiSend.onclick = () => sendAIQuery(aiInput.value);
  aiInput.onkeypress = (e) => {
    if (e.key === 'Enter') sendAIQuery(aiInput.value);
  };

  // Quick action buttons
  document.querySelectorAll('.duddas-quick-btn').forEach(btn => {
    btn.onclick = () => sendAIQuery(btn.dataset.query);
  });

  // Force Sync button (bypasses sync setting - manual sync always works)
  document.getElementById('duddas-force-sync').onclick = () => {
    const data = extractConversationData();
    if (data.phone && data.messages.length > 0) {
      lastFullSyncHash = '';
      sendToDashboard(data, true, true); // bypassSyncCheck = true
      showNotif(`✅ Synced ${data.messages.length} messages`, 'success');
    } else {
      showNotif('❌ No conversation open', 'error');
    }
  };
}

// Send query to AI endpoint
async function sendAIQuery(query) {
  if (!query || !query.trim()) return;

  const responseEl = document.getElementById('duddas-ai-response');
  const inputEl = document.getElementById('duddas-ai-input');

  responseEl.innerHTML = '<span style="color:#fbbf24;">🔄 Thinking...</span>';
  inputEl.value = '';

  try {
    const res = await fetch(DASHBOARD_URL + '/api/ai/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.trim(),
        currentPhone: currentPhone
      })
    });

    const data = await res.json();

    if (data.success) {
      responseEl.innerHTML = formatAIResponse(data.response);
    } else {
      responseEl.innerHTML = `<span style="color:#ef4444;">❌ ${data.error || 'Failed to get response'}</span>`;
    }
  } catch (err) {
    responseEl.innerHTML = `<span style="color:#ef4444;">❌ Connection error</span>`;
  }
}

// Format AI response with clickable leads
function formatAIResponse(response) {
  // Make phone numbers clickable
  let formatted = response.replace(/\+1[\d\-\s]+/g, (match) => {
    return `<span style="color:#60a5fa;cursor:pointer;text-decoration:underline;" onclick="searchForLead('${match}')">${match}</span>`;
  });
  return formatted;
}

// Update current lead info in the AI box
let lastDisplayedPhone = null;

function updateAIBoxLeadInfo() {
  const nameEl = document.getElementById('duddas-lead-name');
  const phoneEl = document.getElementById('duddas-lead-phone');
  const suggestionBox = document.getElementById('duddas-suggestion-box');

  if (!nameEl) return;

  const data = extractConversationData();

  if (data.phone && data.messages.length > 0) {
    const cleanPhone = data.phone.replace(/[^0-9+]/g, '');

    // Only update if phone changed
    if (cleanPhone !== lastDisplayedPhone) {
      lastDisplayedPhone = cleanPhone;
      nameEl.textContent = data.contactName || 'Unknown';
      phoneEl.textContent = data.phone;

      // Reset and fetch new suggestion
      resetSuggestionState();
      fetchSuggestion(data.phone);
    }
  } else {
    if (lastDisplayedPhone !== null) {
      lastDisplayedPhone = null;
      nameEl.textContent = 'No conversation open';
      phoneEl.textContent = '';
      if (suggestionBox) suggestionBox.style.display = 'none';
      resetSuggestionState();
    }
  }
}

// Fetch AI suggestion for current lead - with debouncing
let lastSuggestionPhone = null;
let suggestionFetchInProgress = false;

async function fetchSuggestion(phone) {
  if (!phone) return;

  const cleanPhone = phone.replace(/[^0-9+]/g, '');

  // Prevent duplicate fetches
  if (suggestionFetchInProgress || cleanPhone === lastSuggestionPhone) return;
  suggestionFetchInProgress = true;
  lastSuggestionPhone = cleanPhone;

  const suggestionBox = document.getElementById('duddas-suggestion-box');
  const suggestionText = document.getElementById('duddas-suggestion-text');

  if (!suggestionBox || !suggestionText) {
    suggestionFetchInProgress = false;
    return;
  }

  // Show loading state
  suggestionText.textContent = 'Generating suggestion...';
  suggestionBox.style.display = 'block';

  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(cleanPhone)}/suggestion`);
    const data = await res.json();

    if (data && data.suggestion) {
      suggestionText.textContent = data.suggestion;
      suggestionBox.style.display = 'block';
    } else {
      suggestionBox.style.display = 'none';
    }
  } catch (err) {
    suggestionBox.style.display = 'none';
    console.error('Suggestion fetch error:', err);
  } finally {
    suggestionFetchInProgress = false;
  }
}

// Reset suggestion state when conversation changes
function resetSuggestionState() {
  lastSuggestionPhone = null;
  suggestionFetchInProgress = false;
}

// Update the current lead display in AI box
function updateCurrentLeadDisplay() {
  updateAIBoxLeadInfo();
}

// ============================================
// SYNC ALL HISTORY FEATURE
// ============================================
let syncInProgress = false;

async function syncAllHistory() {
  if (syncInProgress) {
    alert('Sync already in progress!');
    return;
  }

  const confirm = window.confirm('This will sync all leads from the current view to your dashboard.\n\nMake sure you are on the "All" tab in SalesGod.\n\nThis may take a few minutes. Continue?');
  if (!confirm) return;

  syncInProgress = true;
  const statusEl = document.getElementById('duddas-sync-status');
  const syncBtn = document.getElementById('duddas-sync-all');
  statusEl.style.display = 'block';
  syncBtn.disabled = true;
  syncBtn.textContent = '⏳ Syncing...';

  try {
    // Find all lead items in the list
    const leadItems = document.querySelectorAll('[class*="contact-item"], [class*="conversation-item"], .cursor-pointer');
    const validLeads = Array.from(leadItems).filter(el => {
      const text = el.innerText || '';
      return text.match(/\+1\s?\d{3}/) || text.match(/\d{3}-\d{3}-\d{4}/);
    });

    statusEl.textContent = `Found ${validLeads.length} leads to sync...`;
    let synced = 0;
    let errors = 0;

    for (let i = 0; i < validLeads.length; i++) {
      const lead = validLeads[i];
      statusEl.textContent = `Syncing ${i + 1}/${validLeads.length}...`;

      try {
        // Click on the lead to open it
        lead.click();
        await sleep(1500); // Wait for conversation to load

        // Extract and send data
        const data = extractConversationData();
        if (data.phone && data.messages.length > 0) {
          await fetch(DASHBOARD_URL + "/webhook/salesgod", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              phone: data.phone,
              full_name: data.contactName,
              messages_as_string: data.messages.map(m => m.text).join(' | '),
              status: data.currentTag || "new",
              isOutgoing: data.lastMessage?.isOutgoing || false,
              messageCount: data.messages.length,
              isArchived: data.isArchived || false,
              viewType: data.viewType || "all",
              fullSync: true,
              allMessages: data.messages
            })
          });
          synced++;
        }
      } catch (e) {
        errors++;
        console.error('Sync error for lead:', e);
      }

      // Small delay between leads
      await sleep(500);
    }

    statusEl.textContent = `✅ Done! Synced ${synced} leads${errors > 0 ? `, ${errors} errors` : ''}`;
    setTimeout(() => {
      statusEl.style.display = 'none';
    }, 5000);

  } catch (err) {
    statusEl.textContent = `❌ Error: ${err.message}`;
    console.error('Sync all error:', err);
  }

  syncInProgress = false;
  syncBtn.disabled = false;
  syncBtn.textContent = '📥 Sync All';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function updateStatusIndicator() {
  try {
    const res = await fetch(DASHBOARD_URL + '/api/queue/pending');
    const data = await res.json();
    const countEl = document.getElementById('duddas-queue-count');
    if (countEl) {
      countEl.textContent = data.count;
      countEl.style.background = data.count > 0 ? '#ef4444' : '#3b82f6';
    }
    autoSendEnabled = data.autoSendEnabled;

    // Update current lead display
    updateCurrentLeadDisplay();
  } catch (err) {}
}

// ============================================
// INITIALIZATION
// ============================================

console.log(`🚀 Duddas CRM v${VERSION} - AI Assistant Edition`);

// Create status indicator
setTimeout(createStatusIndicator, 2000);

// Start monitoring for conversation changes (MutationObserver)
setTimeout(startConversationMonitoring, 3000);

// MINIMAL POLLING - Only essential intervals with caching
// Regular sync of current conversation (backup polling)
setInterval(checkAndSync, 15000); // Reduced - caching handles the rest

// Check for pending sends
setInterval(checkPendingSends, 10000);

// Check for tags to apply
setInterval(checkPendingTags, 10000);

// Process message queue (auto-navigate and send)
setInterval(processMessageQueue, 10000);

// Update status indicator
setInterval(updateStatusIndicator, 15000);

// Check auto-send status
setInterval(checkAutoSendStatus, 20000);

// Debounced click handler for conversation changes
let clickDebounceTimer = null;
let lastClickTime = 0;
document.addEventListener("click", (e) => {
  // Ignore clicks on the Duddas panel itself
  if (e.target.closest('#duddas-status')) return;

  // Rate limit - max once per second
  const now = Date.now();
  if (now - lastClickTime < 1000) return;
  lastClickTime = now;

  // Debounce - only trigger after user stops clicking
  clearTimeout(clickDebounceTimer);
  clickDebounceTimer = setTimeout(() => {
    // Force refresh cache on click
    const data = extractConversationData(true);
    if (data.phone && data.messages.length > 0) {
      sendToDashboard(data, true);
      updateAIBoxLeadInfo();
    }
  }, 1000);
});

// Initial full sync
setTimeout(() => {
  const data = extractConversationData();
  if (data.phone && data.messages.length > 0) {
    sendToDashboard(data, true);
    console.log('📤 Initial full sync complete');
  }
}, 2000);

setTimeout(checkAutoSendStatus, 1000);
