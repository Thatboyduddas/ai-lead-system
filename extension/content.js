// Duddas CRM v3.1 - Chrome Extension
// Making Insurance Great Again! 🇺🇸
// Now with AUTO-SEND from Dashboard!

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";
let lastSentData = "";
let currentPhone = null;

function extractConversationData() {
  let contactName = "";
  let phone = "";
  let currentTag = "";
  let allMessages = [];
  let hasReferral = false;
  
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }
  
  // Store current phone for auto-send feature
  if (phone) {
    currentPhone = phone.replace(/[^0-9+]/g, '');
  }
  
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set", "Dead", "Medicare Referral"];
  for (let t = 0; t < tags.length; t++) {
    if (text.includes(tags[t])) { 
      currentTag = tags[t]; 
      break; 
    }
  }
  
  const messageBubbles = document.querySelectorAll('.text-bubble');
  
  messageBubbles.forEach(bubble => {
    const msgText = bubble.innerText?.trim();
    if (msgText && msgText.length > 0 && msgText.length < 2000) {
      const isOutgoing = bubble.classList.contains('bg-outbound');
      let cleanText = msgText.trim();
      
      const timestampMatch = cleanText.match(/\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M\s*$/);
      if (timestampMatch) {
        cleanText = cleanText.replace(timestampMatch[0], '').trim();
      }
      
      if (isOutgoing) {
        const lowerText = cleanText.toLowerCase();
        if ((lowerText.includes('faith') && (lowerText.includes('medicare') || lowerText.includes('referral'))) ||
            (cleanText.includes('352') && cleanText.includes('900') && cleanText.includes('3966')) ||
            lowerText.includes('faithinsurancesol')) {
          hasReferral = true;
        }
      }
      
      if (cleanText.length > 0) {
        allMessages.push({
          text: cleanText,
          isOutgoing: isOutgoing
        });
      }
    }
  });
  
  return { 
    contactName: contactName, 
    phone: phone, 
    currentTag: currentTag, 
    messages: allMessages,
    lastMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null,
    hasReferral: hasReferral
  };
}

function sendToDashboard(data) {
  if (!data.phone || data.messages.length === 0) return;
  
  const lastMsg = data.lastMessage;
  if (!lastMsg) return;
  
  const dataHash = data.phone + "|" + data.messages.length + "|" + lastMsg.text.substring(0, 50);
  if (dataHash === lastSentData) return;
  lastSentData = dataHash;
  
  const payload = {
    phone: data.phone,
    full_name: data.contactName,
    messages_as_string: lastMsg.text,
    status: data.currentTag || "new",
    isOutgoing: lastMsg.isOutgoing,
    messageCount: data.messages.length,
    hasReferral: data.hasReferral
  };
  
  console.log("🇺🇸 Duddas CRM: Sending", payload);
  
  fetch(DASHBOARD_URL + "/webhook/salesgod", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(r => r.json()).then(result => {
    console.log("🇺🇸 Duddas CRM: Sent!", result);
    showNotification(data.contactName, lastMsg.text, lastMsg.isOutgoing);
  }).catch(err => {
    console.error("🇺🇸 Duddas CRM: Error", err);
  });
}

function showNotification(name, message, isOutgoing) {
  const existing = document.getElementById("duddas-notif");
  if (existing) existing.remove();
  
  const notif = document.createElement("div");
  notif.id = "duddas-notif";
  const bgColor = isOutgoing ? "linear-gradient(90deg, #002868 0%, #1e40af 100%)" : "linear-gradient(90deg, #bf0a30 0%, #dc2626 100%)";
  const direction = isOutgoing ? "↗️ You" : "↙️ Lead";
  const emoji = isOutgoing ? "📤" : "📥";
  
  notif.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${bgColor};
    color: white;
    padding: 15px 20px;
    border-radius: 12px;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    max-width: 350px;
    border: 2px solid #ffd700;
  `;
  
  notif.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="font-size:18px;">🇺🇸</span>
      <strong style="font-size:14px;">Duddas CRM</strong>
      <span style="font-size:11px;opacity:0.8;">MAGA Edition</span>
    </div>
    <div style="font-size:12px;opacity:0.9;">${emoji} ${direction}: ${message.substring(0, 50)}${message.length > 50 ? '...' : ''}</div>
  `;
  
  document.body.appendChild(notif);
  setTimeout(() => { notif.remove(); }, 3000);
}

// ============ AUTO-SEND FEATURE ============

// Find the message input textarea
function findMessageInput() {
  // Try multiple selectors for the textarea
  const selectors = [
    'textarea[placeholder*="Type your message"]',
    'textarea[placeholder*="message"]',
    '.message-input textarea',
    'textarea'
  ];
  
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.offsetParent !== null) { // visible
      return el;
    }
  }
  return null;
}

// Find the send button
function findSendButton() {
  // Look for send button - it's likely an SVG arrow or button
  const selectors = [
    'button[type="submit"]',
    '.send-button',
    'button svg[class*="send"]',
    // The arrow icon in bottom right
    'button:has(svg)',
  ];
  
  // Find all buttons and look for one with arrow/send icon
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    // Check if it's near the textarea (in the message area)
    const rect = btn.getBoundingClientRect();
    if (rect.bottom > window.innerHeight - 200) { // Bottom of screen
      // Check for arrow SVG or send-like appearance
      const svg = btn.querySelector('svg');
      if (svg) {
        return btn;
      }
    }
  }
  
  // Fallback: look for the specific send button structure
  const allButtons = document.querySelectorAll('button, div[role="button"]');
  for (const btn of allButtons) {
    if (btn.innerHTML.includes('path') && btn.closest('form, .message-area, [class*="input"]')) {
      return btn;
    }
  }
  
  return null;
}

// Type message and send
async function typeAndSend(message) {
  const textarea = findMessageInput();
  if (!textarea) {
    console.error("🇺🇸 Duddas: Could not find message input");
    showSendNotification(false, "Could not find message input");
    return false;
  }
  
  // Focus and set value
  textarea.focus();
  textarea.value = message;
  
  // Dispatch input event to trigger any listeners
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  
  // Small delay for UI to update
  await new Promise(r => setTimeout(r, 300));
  
  // Find and click send button
  const sendBtn = findSendButton();
  if (!sendBtn) {
    console.error("🇺🇸 Duddas: Could not find send button");
    showSendNotification(false, "Could not find send button");
    return false;
  }
  
  sendBtn.click();
  
  console.log("🇺🇸 Duddas: Message sent!", message.substring(0, 50));
  showSendNotification(true, message);
  
  return true;
}

function showSendNotification(success, message) {
  const existing = document.getElementById("duddas-send-notif");
  if (existing) existing.remove();
  
  const notif = document.createElement("div");
  notif.id = "duddas-send-notif";
  
  notif.style.cssText = `
    position: fixed;
    top: 80px;
    right: 20px;
    background: ${success ? 'linear-gradient(90deg, #10b981 0%, #059669 100%)' : 'linear-gradient(90deg, #ef4444 0%, #dc2626 100%)'};
    color: white;
    padding: 15px 20px;
    border-radius: 12px;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
    max-width: 350px;
    border: 2px solid #ffd700;
  `;
  
  notif.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="font-size:18px;">${success ? '✅' : '❌'}</span>
      <strong style="font-size:14px;">Duddas Auto-Send</strong>
    </div>
    <div style="font-size:12px;opacity:0.9;">${success ? 'Message sent!' : message}</div>
  `;
  
  document.body.appendChild(notif);
  setTimeout(() => { notif.remove(); }, 4000);
}

// Check for pending sends from dashboard
async function checkPendingSends() {
  if (!currentPhone) return;
  
  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`);
    const data = await res.json();
    
    if (data.pending && data.message) {
      console.log("🇺🇸 Duddas: Found pending message to send");
      
      // Send the message
      const success = await typeAndSend(data.message);
      
      if (success) {
        // Mark as sent
        await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`, {
          method: 'DELETE'
        });
      }
    }
  } catch (err) {
    // Silent fail - pending check is background task
  }
}

// Navigate to a specific phone number conversation
function navigateToConversation(phone) {
  // Click on the conversation in the sidebar if visible
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const conversations = document.querySelectorAll('[class*="conversation"], [class*="contact"], .list-item, tr');
  
  for (const conv of conversations) {
    const text = conv.innerText || '';
    if (text.includes(cleanPhone) || text.includes(phone)) {
      conv.click();
      return true;
    }
  }
  return false;
}

function startWatching() {
  console.log("🇺🇸 Duddas CRM v3.1 Running - Making Insurance Great Again!");
  console.log("🚀 Auto-Send Feature ENABLED");
  
  // Check every 2 seconds for new messages
  setInterval(() => {
    const data = extractConversationData();
    if (data.messages.length > 0) { 
      sendToDashboard(data); 
    }
  }, 2000);
  
  // Check for pending sends every 3 seconds
  setInterval(checkPendingSends, 3000);
  
  // Also check on click (when switching conversations)
  document.addEventListener("click", () => {
    setTimeout(() => {
      const data = extractConversationData();
      if (data.messages.length > 0) { 
        sendToDashboard(data); 
      }
    }, 500);
  });
  
  // Check on keypress (when sending messages)
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      setTimeout(() => {
        const data = extractConversationData();
        if (data.messages.length > 0) { 
          sendToDashboard(data); 
        }
      }, 1000);
    }
  });
}

startWatching();
