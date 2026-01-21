// Duddas CRM v3.5 - Chrome Extension

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";
let lastSentHash = "";
let currentPhone = null;
let pendingInProgress = false;

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

console.log("🚀 Duddas CRM v3.5");
setInterval(checkAndSync, 3000);
setInterval(checkPendingSends, 3000);
document.addEventListener("click", () => setTimeout(checkAndSync, 500));
setTimeout(checkAndSync, 1000);
