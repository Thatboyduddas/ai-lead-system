const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastSentData = "";

function extractConversationData() {
  let contactName = "";
  let phone = "";
  let currentTag = "";
  let allMessages = [];
  
  // Try to get phone from the page
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
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set"];
  for (let t = 0; t < tags.length; t++) {
    if (text.includes(tags[t])) { currentTag = tags[t]; break; }
  }
  
  // DOM-based extraction using SalesGod's actual classes
  // bg-outbound = YOUR messages, text-bubble without bg-outbound = LEAD messages
  const messageBubbles = document.querySelectorAll('.text-bubble');
  
  messageBubbles.forEach(bubble => {
    const msgText = bubble.innerText?.trim();
    if (msgText && msgText.length > 0 && msgText.length < 1000) {
      // bg-outbound class means YOU sent it
      const isOutgoing = bubble.classList.contains('bg-outbound');
      
      // Get just the message text (first part before timestamp)
      const cleanText = msgText.split('\n')[0].trim();
      
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
    lastMessage: allMessages.length > 0 ? allMessages[allMessages.length - 1] : null
  };
}

function sendToDashboard(data) {
  if (!data.phone || data.messages.length === 0) return;
  
  const lastMsg = data.lastMessage;
  if (!lastMsg) return;
  
  // Create a hash to avoid duplicate sends
  const dataHash = data.phone + "|" + data.messages.length + "|" + lastMsg.text;
  if (dataHash === lastSentData) return;
  lastSentData = dataHash;
  
  var payload = {
    phone: data.phone,
    full_name: data.contactName,
    messages_as_string: lastMsg.text,
    status: data.currentTag || "new",
    isOutgoing: lastMsg.isOutgoing,
    messageCount: data.messages.length
  };
  
  console.log("AI Lead v3: Sending", payload);
  
  fetch(DASHBOARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(result) {
    console.log("AI Lead v3: Sent!", result);
    showNotification(data.contactName, lastMsg.text, lastMsg.isOutgoing);
  }).catch(function(err) {
    console.error("AI Lead v3: Error", err);
  });
}

function showNotification(name, message, isOutgoing) {
  var existing = document.getElementById("ai-lead-notif");
  if (existing) existing.remove();
  
  var notif = document.createElement("div");
  notif.id = "ai-lead-notif";
  var bgColor = isOutgoing ? "#3b82f6" : "#10b981";
  var direction = isOutgoing ? "↗ You" : "↙ Lead";
  notif.style.cssText = "position:fixed;top:20px;right:20px;background:" + bgColor + ";color:white;padding:15px 20px;border-radius:10px;z-index:99999;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:350px;";
  notif.innerHTML = "<strong>Sent to Dashboard</strong><br><small>" + direction + ": " + message.substring(0, 60) + "</small>";
  document.body.appendChild(notif);
  setTimeout(function() { notif.remove(); }, 3000);
}

function startWatching() {
  console.log("AI Lead Intelligence v3: Running (improved detection)");
  
  setInterval(function() {
    var data = extractConversationData();
    if (data.messages.length > 0) { sendToDashboard(data); }
  }, 2000);
  
  document.addEventListener("click", function() {
    setTimeout(function() {
      var data = extractConversationData();
      if (data.messages.length > 0) { sendToDashboard(data); }
    }, 500);
  });
}

startWatching();
