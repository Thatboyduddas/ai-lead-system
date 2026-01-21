// Duddas CRM v3.0 - Chrome Extension
// Making Insurance Great Again! 🇺🇸

const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastSentData = "";

function extractConversationData() {
  let contactName = "";
  let phone = "";
  let currentTag = "";
  let allMessages = [];
  let hasReferral = false;
  
  // Get phone from the page
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }
  
  // Find current tag
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set", "Dead", "Medicare Referral"];
  for (let t = 0; t < tags.length; t++) {
    if (text.includes(tags[t])) { 
      currentTag = tags[t]; 
      break; 
    }
  }
  
  // DOM-based extraction using SalesGod's classes
  // bg-outbound = YOUR messages (blue), no bg-outbound = LEAD messages (green)
  const messageBubbles = document.querySelectorAll('.text-bubble');
  
  messageBubbles.forEach(bubble => {
    const msgText = bubble.innerText?.trim();
    if (msgText && msgText.length > 0 && msgText.length < 2000) {
      // bg-outbound class means YOU sent it
      const isOutgoing = bubble.classList.contains('bg-outbound');
      
      // Get full message text, remove timestamp at the end
      let cleanText = msgText.trim();
      
      // Remove timestamps like "1/21/2026, 10:58:54 AM" from the end
      const timestampMatch = cleanText.match(/\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M\s*$/);
      if (timestampMatch) {
        cleanText = cleanText.replace(timestampMatch[0], '').trim();
      }
      
      // Check if this is a Medicare referral message (Faith's info)
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
  
  // Create a hash to avoid duplicate sends
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
  
  fetch(DASHBOARD_URL, {
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

function startWatching() {
  console.log("🇺🇸 Duddas CRM v3.0 Running - Making Insurance Great Again!");
  
  // Check every 2 seconds
  setInterval(() => {
    const data = extractConversationData();
    if (data.messages.length > 0) { 
      sendToDashboard(data); 
    }
  }, 2000);
  
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
