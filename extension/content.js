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
  
  const outgoingStarts = ["Hey, it's Mia", "Hi, it's Mia", "Alright, may I", "Alright, what", "Assuming you have", "Touching base", "Not sure if", "I checked my", "Hey, this is Mia", "Hey it's Mia", "Text 0 to Opt Out", "Hey, following up", "I found a few"];
  
  const timestampPattern = /\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M/;
  
  let messages = [];
  let currentMsg = "";
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (timestampPattern.test(line)) {
      if (currentMsg) {
        messages.push(currentMsg.trim());
      }
      currentMsg = "";
    } else if (!line.includes('Balance') && !line.includes('Dashboard') && !line.includes('unread') && !line.includes('Messenger') && !line.includes('Calendar') && !line.includes('Support') && line.length > 1) {
      currentMsg += " " + line;
    }
  }
  
  let lastIncoming = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i].trim();
    if (msg.length < 3) continue;
    
    let isOutgoing = false;
    for (const start of outgoingStarts) {
      if (msg.includes(start)) { isOutgoing = true; break; }
    }
    if (!isOutgoing) { 
      lastIncoming = msg; 
      break; 
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
