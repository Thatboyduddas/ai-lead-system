// Duddas CRM v4.0 - Chrome Extension with Auto-Tag Automation

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";
let lastSentHash = "";
let currentPhone = null;
let pendingInProgress = false;
let tagInProgress = false;

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
  
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set", "Dead", "Medicare Referral"];
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

function findSendButton() {
  // Method 1: Find button with "Send" text
  const allButtons = document.querySelectorAll('button');
  for (const btn of allButtons) {
    if (btn.innerText.trim().toLowerCase() === 'send') {
      return btn;
    }
  }
  
  // Method 2: Find the arrow SVG at bottom right
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
    showNotif("❌ No message input", "error");
    return false;
  }
  
  textarea.focus();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  setter.call(textarea, message);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  
  await new Promise(r => setTimeout(r, 500));
  
  const sendBtn = findSendButton();
  if (!sendBtn) {
    showNotif("❌ No send button", "error");
    return false;
  }
  
  sendBtn.click();
  if (sendBtn.tagName?.toLowerCase() === 'svg') sendBtn.parentElement?.click();
  
  showNotif("✅ Sent!", "success");
  return true;
}

function showNotif(msg, type) {
  const existing = document.getElementById("duddas-notif");
  if (existing) existing.remove();
  
  const n = document.createElement("div");
  n.id = "duddas-notif";
  n.style.cssText = `position:fixed;top:20px;right:20px;background:${type === 'error' ? '#ef4444' : '#22c55e'};color:white;padding:12px 18px;border-radius:8px;z-index:99999;font-family:sans-serif;font-size:13px;font-weight:600;`;
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

async function checkPendingSends() {
  if (!currentPhone || pendingInProgress) return;
  pendingInProgress = true;
  
  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`);
    const data = await res.json();
    
    if (data.pending && data.message) {
      await typeAndSend(data.message);
      await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`, { method: 'DELETE' });
    }
  } catch (err) {}
  
  pendingInProgress = false;
}

function checkAndSync() {
  const data = extractConversationData();
  if (data.messages.length > 0 && data.phone) sendToDashboard(data);
}

// ============================================
// TAG AUTOMATION - Auto-apply SalesGod tags
// ============================================

function findTagDropdown() {
  // Look for common dropdown patterns in SalesGod
  // Method 1: Look for select elements with tag-related options
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

  // Method 2: Look for custom dropdown buttons (common in modern UIs)
  const buttons = document.querySelectorAll('button, [role="button"], [role="combobox"]');
  for (const btn of buttons) {
    const text = btn.innerText?.toLowerCase() || '';
    const ariaLabel = btn.getAttribute('aria-label')?.toLowerCase() || '';
    if (text.includes('tag') || text.includes('workflow') || text.includes('status') ||
        ariaLabel.includes('tag') || ariaLabel.includes('workflow')) {
      return { type: 'button', element: btn };
    }
  }

  // Method 3: Look for dropdown by class patterns
  const dropdowns = document.querySelectorAll('[class*="dropdown"], [class*="select"], [class*="tag"]');
  for (const dd of dropdowns) {
    if (dd.innerText?.toLowerCase().includes('quoted') ||
        dd.innerText?.toLowerCase().includes('age and gender')) {
      return { type: 'custom', element: dd };
    }
  }

  // Method 4: Look for the specific dropdown trigger near the conversation
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
  // Wait a moment for dropdown to open
  await new Promise(r => setTimeout(r, 300));

  // Look for the option in the now-open dropdown
  const allOptions = document.querySelectorAll(
    'li, [role="option"], [role="menuitem"], option, ' +
    'div[class*="option"], div[class*="item"], span[class*="option"]'
  );

  for (const opt of allOptions) {
    const text = opt.innerText?.trim().toLowerCase() || '';
    const targetTag = tagName.toLowerCase();

    if (text === targetTag || text.includes(targetTag)) {
      opt.click();
      showNotif(`✅ Applied: ${tagName}`, "success");
      return true;
    }
  }

  // Also check for labels/text nodes
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
        showNotif(`✅ Applied: ${tagName}`, "success");
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
    // Native select element
    const options = element.querySelectorAll('option');
    for (const opt of options) {
      if (opt.textContent.toLowerCase().includes(tagName.toLowerCase())) {
        element.value = opt.value;
        element.dispatchEvent(new Event('change', { bubbles: true }));
        showNotif(`✅ Applied: ${tagName}`, "success");
        return true;
      }
    }
  } else {
    // Custom dropdown - click to open, then click option
    element.click();
    await new Promise(r => setTimeout(r, 500));

    const applied = await clickTagOption(tagName);
    if (applied) return true;

    // If not found, try clicking the element again (might be a toggle)
    element.click();
    await new Promise(r => setTimeout(r, 300));
    return await clickTagOption(tagName);
  }

  showNotif(`❌ Tag "${tagName}" not found`, "error");
  return false;
}

async function checkPendingTags() {
  if (!currentPhone || tagInProgress) return;
  tagInProgress = true;

  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/tag`);
    const data = await res.json();

    if (data.tagToApply) {
      const success = await applyTag(data.tagToApply);
      if (success) {
        // Mark tag as applied
        await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/tag`, {
          method: 'DELETE'
        });
      }
    }
  } catch (err) {
    // Silently fail - endpoint might not exist yet
  }

  tagInProgress = false;
}

// ============================================
// INITIALIZATION
// ============================================

console.log("🚀 Duddas CRM v4.0 - Tag Automation Enabled");
setInterval(checkAndSync, 3000);
setInterval(checkPendingSends, 3000);
setInterval(checkPendingTags, 2000);  // Check for tags to apply
document.addEventListener("click", () => setTimeout(checkAndSync, 500));
setTimeout(checkAndSync, 1000);
