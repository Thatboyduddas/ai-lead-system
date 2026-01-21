const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastMessageSent = "";
let lastContactName = "";

function extractConversationData() {
  const text = document.body.innerText;
  const lines = text.split('\n').filter(l => l.trim());
  let contactName = "";
  let phone = "";
  let currentTag = "";
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^\+1\s?\d{3}-\d{3}-\d{4}/)) {
      phone = lines[i];
      if (i > 0) contactName = lines[i - 1];
      break;
    }
  }
  
  const tags = ['Quoted', 'Age and gender', 'Follow up', 'Ghosted', 'Deadline', 'Sold', 'Appointment Set'];
  for (const tag of tags) {
    if (text.includes(tag)) { currentTag = tag; break; }
  }
  
  const outgoingStarts = ["Hey, it's Mia", "Hi, it's Mia", "Alright, may I", "Alright, what", "Assuming you have", "Touching base", "Not sure if", "I checked my", "Hey, this is Mia", "Hey it's Mia", "Text 0 to Opt Out", "Hey, following up", "I found a few", "Hi, it's Mia from", "Hi, it's Mia with"];
  
  const timestampPattern = /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M$/;
  const skipWords = ['Balance', 'Dashboard', 'unread', 'Messenger', 'Calendar', 'Support', 'Info', 'Company Name', 'Email Address', 'Date of Birth', 'State', 'City', 'Postal Code', 'Address', 'Notes', 'Announcements', 'SalesGodCrm', 'Contacts', 'Phone Numbers', 'Text Drips', 'Tags', 'Wallet', 'Subscription', 'Knowledge Base', 'Scrubber', '10DLC', 'Call Logs', 'Scheduled Messages', 'Custom Fields', 'Message Templates', 'Auto Responder', 'Shared Accounts', 'Stop Words', 'Integrations', 'Not in Real-Time', 'Approved'];
  
  let messages = [];
  
  for (let i = 0; i < lines.length; i++) {
    if (timestampPattern.test(lines[i])) {
      // Message is the line before timestamp
      let msgIndex = i - 1;
      while (msgIndex >= 0 && lines[msgIndex].trim() === '') {
        msgIndex--;
      }
      if (msgIndex >= 0) {
        const msg = lines[msgIndex].trim();
        if (msg.length > 2) {
          let skip = false;
          for (const sw of skipWords) {
            if (msg.includes(sw)) { skip = true; break; }
          }
          if (!skip) {
            messages.push(msg);
          }
        }
      }
    }
  }
  
  let lastIncoming = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    let isOutgoing = false;
    for (const start of outgoingStarts) {
      if (msg.startsWith(start) || msg.includes(start)) { isOutgoing = true; break; }
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
