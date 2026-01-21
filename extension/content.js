const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastMessageSent = "";
let lastContactName = "";

function extractConversationData() {
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  let contactName = "";
  let phone = "";
  let currentTag = "";
  
  for (const line of lines) {
    if (line.match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = line;
      break;
    }
  }
  
  const phoneIndex = lines.findIndex(l => l.match(/^\+1\s?\d{3}-\d{3}-\d{4}/));
  if (phoneIndex > 0) contactName = lines[phoneIndex - 1];
  
  const tags = ['Quoted', 'Age and gender', 'Follow up', 'Ghosted', 'Deadline', 'Sold', 'Appointment Set'];
  for (const tag of tags) {
    if (text.includes(tag)) { currentTag = tag; break; }
  }
  
  let lastIncoming = "";
  const outgoingStarts = ["Hey, it's Mia", "Hi, it's Mia", "Alright, may I", "Alright, what", "Assuming you have", "Touching base", "Not sure if", "I checked my", "Hey, this is Mia", "Hey it's Mia"];
  
  const messagePattern = /(\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M)/g;
  let parts = text.split(messagePattern);
  
  for (let i = parts.length - 2; i >= 0; i -= 2) {
    const msg = parts[i].trim();
    if (msg && msg.length > 2 && !msg.includes('Balance') && !msg.includes('Dashboard') && !msg.includes('unread')) {
      let isOutgoing = false;
      for (const start of outgoingStarts) {
        if (msg.includes(start)) { isOutgoing = true; break; }
      }
      if (!isOutgoing) { lastIncoming = msg; break; }
    }
  }
  
  return { contactName, phone, currentTag, lastIncoming };
}

async function sendToDashboard(data) {
  if (!data.lastIncoming || data.lastIncoming === lastMessageSent) return;
  if (data.contactName === lastContactName && data.lastIncoming === lastMessageSent) return;
  
  lastMessageSent = data.lastIncoming;
  lastContactName = data.contactName;
  
  const payload = {
    phone: data.phone,
    full_name: data.contactName,
    messages_as_string: data.lastIncoming,
    status: data.currentTag || "new"
  };
  
  console.log("AI Lead Intelligence: Sending", payload);
  
  try {
    const response = await fetch(DASHBOARD_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    console.log("AI Lead Intelligence: Sent!", result);
    showNotification(data.contactName, data.lastIncoming);
  } catch (err) {
    console.error("AI Lead Intelligence: Error", err);
  }
}

function showNotification(name, message) {
  const notif = document.createElement('div');
  notif.style.cssText = "position: fixed; top: 20px; right: 20px; background: #10b981; color: white; padding: 15px 20px; border-radius: 10px; z-index: 99999; font-family: sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 300px;";
  notif.innerHTML = '<strong>✓ Sent to AI Dashboard</strong><br><small>' + name + ': "' + message.substring(0, 50) + '..."</small>';
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}

function startWatching() {
  console.log("AI Lead Intelligence: Watching for messages...");
  setInterval(() => {
    const data = extractConversationData();
    if (data.lastIncoming) sendToDashboard(data);
  }, 2000);
  
  document.addEventListener('click', () => {
    setTimeout(() => {
      const data = extractConversationData();
      if (data.lastIncoming) sendToDashboard(data);
    }, 500);
  });
}

startWatching();
