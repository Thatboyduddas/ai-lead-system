// Duddas CRM v5.0 - Chrome Extension with Queue-Based Auto-Send
// Auto-navigates to leads and sends messages from queue

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";
let lastSentHash = "";
let currentPhone = null;
let pendingInProgress = false;
let tagInProgress = false;
let queueProcessing = false;
let autoSendEnabled = false;

// ============================================
// CONVERSATION DATA EXTRACTION
// ============================================

function extractConversationData() {
  let contactName = "";
  let phone = "";
  let currentTag = "";
  let allMessages = [];

  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }

  if (phone) currentPhone = phone.replace(/[^0-9+]/g, '');

  const tags = ["Age and gender", "Quoted", "Follow up", "Ghosted", "Appointment Set", "Called: Answered", "Called: No Answer", "Deadline", "Did you receive?", "Another time", "Sold", "Dead", "Medicare Referral"];
  for (const tag of tags) {
    if (text.includes(tag)) { currentTag = tag; break; }
  }

  document.querySelectorAll('.text-bubble').forEach(bubble => {
    const msgText = bubble.innerText?.trim();
    if (msgText && msgText.length > 0 && msgText.length < 2000) {
      const isOutgoing = bubble.classList.contains('bg-outbound');
      let cleanText = msgText.replace(/\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M\s*$/, '').trim();
      if (cleanText.length > 0) {
        allMessages.push({ text: cleanText, isOutgoing });
      }
    }
  });

  return { contactName, phone, currentTag, messages: allMessages, lastMessage: allMessages[allMessages.length - 1] || null };
}

function sendToDashboard(data) {
  if (!data.phone || data.messages.length === 0) return;
  const lastMsg = data.lastMessage;
  if (!lastMsg) return;

  const dataHash = data.phone + "|" + data.messages.length + "|" + lastMsg.text.substring(0, 100);
  if (dataHash === lastSentHash) return;
  lastSentHash = dataHash;

  fetch(DASHBOARD_URL + "/webhook/salesgod", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: data.phone,
      full_name: data.contactName,
      messages_as_string: lastMsg.text,
      status: data.currentTag || "new",
      isOutgoing: lastMsg.isOutgoing,
      messageCount: data.messages.length
    })
  }).catch(() => {});
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
  if (data.messages.length > 0 && data.phone) sendToDashboard(data);
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
    background: #1e293b;
    color: white;
    padding: 8px 14px;
    border-radius: 20px;
    font-family: sans-serif;
    font-size: 12px;
    z-index: 99998;
    display: flex;
    align-items: center;
    gap: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
    cursor: pointer;
  `;
  indicator.innerHTML = `
    <span style="width:8px;height:8px;background:#22c55e;border-radius:50%;"></span>
    <span>Duddas CRM</span>
    <span id="duddas-queue-count" style="background:#3b82f6;padding:2px 6px;border-radius:10px;font-size:10px;">0</span>
  `;

  indicator.onclick = async () => {
    const res = await fetch(DASHBOARD_URL + '/api/queue/pending');
    const data = await res.json();
    alert(`Queue Status:\n\nAuto-Send: ${data.autoSendEnabled ? 'ON' : 'OFF'}\nMessages in queue: ${data.count}\n\n${data.queue.map(q => `• ${q.name || q.phone}: "${q.message.substring(0,30)}..."`).join('\n') || 'Queue empty'}`);
  };

  document.body.appendChild(indicator);
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
  } catch (err) {}
}

// ============================================
// INITIALIZATION
// ============================================

console.log("🚀 Duddas CRM v5.0 - Queue-Based Auto-Send");

// Create status indicator
setTimeout(createStatusIndicator, 2000);

// Regular sync of current conversation
setInterval(checkAndSync, 3000);

// Check for pending sends (current lead - legacy)
setInterval(checkPendingSends, 3000);

// Check for tags to apply
setInterval(checkPendingTags, 2000);

// Process message queue (auto-navigate and send)
setInterval(processMessageQueue, 5000);

// Update status indicator
setInterval(updateStatusIndicator, 5000);

// Check auto-send status
setInterval(checkAutoSendStatus, 10000);

// Initial checks
document.addEventListener("click", () => setTimeout(checkAndSync, 500));
setTimeout(checkAndSync, 1000);
setTimeout(checkAutoSendStatus, 1000);
