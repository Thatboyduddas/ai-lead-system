// Duddas CRM v3.3 - Chrome Extension
// Fixed auto-send for SalesGod

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app";
let lastSentHash = "";
let currentPhone = null;
let isWatching = false;

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
        allMessages.push({ text: cleanText, isOutgoing: isOutgoing });
      }
    }
  });
  
  return { contactName, phone, currentTag, messages: allMessages, lastMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null, hasReferral };
}

function sendToDashboard(data) {
  if (!data.phone || data.messages.length === 0) return;
  const lastMsg = data.lastMessage;
  if (!lastMsg) return;
  
  const dataHash = data.phone + "|" + data.messages.length + "|" + lastMsg.text.substring(0, 100) + "|" + lastMsg.isOutgoing;
  if (dataHash === lastSentHash) return;
  lastSentHash = dataHash;
  
  const payload = { phone: data.phone, full_name: data.contactName, messages_as_string: lastMsg.text, status: data.currentTag || "new", isOutgoing: lastMsg.isOutgoing, messageCount: data.messages.length, hasReferral: data.hasReferral };
  
  fetch(DASHBOARD_URL + "/webhook/salesgod", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).then(r => r.json()).then(result => console.log("✅ Synced")).catch(err => console.error("❌ Error", err));
}

function findMessageInput() {
  const textareas = document.querySelectorAll('textarea');
  for (const ta of textareas) {
    const placeholder = (ta.getAttribute('placeholder') || '').toLowerCase();
    if (placeholder.includes('message') || placeholder.includes('type')) return ta;
  }
  return textareas[textareas.length - 1];
}

function findSendButton() {
  const allSvgs = Array.from(document.querySelectorAll('svg'));
  const bottomSvgs = allSvgs.filter(svg => {
    const rect = svg.getBoundingClientRect();
    return rect.top > window.innerHeight - 150 && rect.width > 0;
  });
  
  let rightmost = null;
  let maxRight = 0;
  for (const svg of bottomSvgs) {
    const rect = svg.getBoundingClientRect();
    if (rect.right > maxRight) { maxRight = rect.right; rightmost = svg; }
  }
  
  if (rightmost) {
    const clickable = rightmost.closest('button') || rightmost.closest('[role="button"]') || rightmost.parentElement;
    return clickable || rightmost;
  }
  return null;
}

async function typeAndSend(message) {
  const textarea = findMessageInput();
  if (!textarea) { showSendError("Could not find message input"); return false; }
  
  textarea.focus();
  textarea.click();
  textarea.value = '';
  
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
  nativeInputValueSetter.call(textarea, message);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  
  await new Promise(r => setTimeout(r, 800));
  
  const sendBtn = findSendButton();
  if (!sendBtn) { showSendError("Could not find send button"); return false; }
  
  sendBtn.click();
  sendBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  
  if (sendBtn.tagName.toLowerCase() === 'svg') {
    sendBtn.parentElement?.click();
  }
  
  showSendSuccess();
  return true;
}

function showSendError(msg) {
  const n = document.createElement("div");
  n.id = "duddas-send-notif";
  n.style.cssText = "position:fixed;top:20px;right:20px;background:#ef4444;color:white;padding:12px 18px;border-radius:8px;z-index:99999;font-family:sans-serif;font-size:13px;";
  n.innerHTML = `<strong>❌ Duddas Auto-Send</strong><br>${msg}`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 5000);
}

function showSendSuccess() {
  const existing = document.getElementById("duddas-send-notif");
  if (existing) existing.remove();
  const n = document.createElement("div");
  n.id = "duddas-send-notif";
  n.style.cssText = "position:fixed;top:20px;right:20px;background:#22c55e;color:white;padding:12px 18px;border-radius:8px;z-index:99999;font-family:sans-serif;font-size:13px;";
  n.innerHTML = "<strong>✅ Duddas Auto-Send</strong><br>Message sent!";
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 3000);
}

async function checkPendingSends() {
  if (!currentPhone) return;
  try {
    const res = await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`);
    const data = await res.json();
    if (data.pending && data.message) {
      const success = await typeAndSend(data.message);
      if (success) await fetch(DASHBOARD_URL + `/api/leads/${encodeURIComponent(currentPhone)}/pending`, { method: 'DELETE' });
    }
  } catch (err) {}
}

function checkAndSync() {
  const data = extractConversationData();
  if (data.messages.length > 0 && data.phone) sendToDashboard(data);
}

function startWatching() {
  if (isWatching) return;
  isWatching = true;
  console.log("🚀 Duddas CRM v3.3 Running");
  setTimeout(checkAndSync, 1000);
  setInterval(checkAndSync, 3000);
  setInterval(checkPendingSends, 2000);
  document.addEventListener("click", () => setTimeout(checkAndSync, 500));
}

startWatching();
