const DASHBOARD_URL = "https://ai-lead-system-production-df0a.up.railway.app/webhook/salesgod";
let lastMessageSent = "";
let lastContactPhone = "";

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
  
  const tags = ["Quoted", "Age and gender", "Follow up", "Ghosted", "Deadline", "Sold", "Appointment Set"];
  for (let t = 0; t < tags.length; t++) {
    if (text.includes(tags[t])) { currentTag = tags[t]; break; }
  }
  
  const outgoingPatterns = ["mia", "text 0 to opt", "alright, may i have", "alright, what is the age", "assuming you have no major", "touching base", "not sure if you got", "i checked my calendar", "following up", "just so you know", "i found a few", "when works", "do you have some time", "looks like you missed", "did you receive", "are you available", "so you have all the information", "plans include free", "maximum out of pocket", "deductibles and networks", "copays", "primary care", "estes health", "bcbs", "cigna", "blue cross", "aetna"];
  
  const timestampPattern = /^\d{1,2}\/\d{1,2}\/\d{4},\s*\d{1,2}:\d{2}:\d{2}\s*[AP]M$/;
  
  let lastIncoming = "";
  for (let i = 0; i < lines.length; i++) {
    if (timestampPattern.test(lines[i])) {
      let msgIndex = i - 1;
      while (msgIndex >= 0 && lines[msgIndex].trim() === "") { msgIndex--; }
      if (msgIndex >= 0) {
        const msg = lines[msgIndex].trim();
        if (msg.length > 2) {
          const msgLower = msg.toLowerCase();
          let isOutgoing = false;
          for (let p = 0; p < outgoingPatterns.length; p++) {
            if (msgLower.includes(outgoingPatterns[p])) { isOutgoing = true; break; }
          }
          if (!isOutgoing) { lastIncoming = msg; }
        }
      }
    }
  }
  
  return { contactName: contactName, phone: phone, currentTag: currentTag, lastIncoming: lastIncoming };
}

function sendToDashboard(data) {
  if (!data.lastIncoming) return;
  if (data.phone === lastContactPhone && data.lastIncoming === lastMessageSent) return;
  
  lastMessageSent = data.lastIncoming;
  lastContactPhone = data.phone;
  
  var payload = {
    phone: data.phone,
    full_name: data.contactName,
    messages_as_string: data.lastIncoming,
    status: data.currentTag || "new"
  };
  
  console.log("AI Lead: Sending", payload);
  
  fetch(DASHBOARD_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  }).then(function(r) { return r.json(); }).then(function(result) {
    console.log("AI Lead: Sent!", result);
    showNotification(data.contactName, data.lastIncoming);
  }).catch(function(err) {
    console.error("AI Lead: Error", err);
  });
}

function showNotification(name, message) {
  var existing = document.getElementById("ai-lead-notif");
  if (existing) existing.remove();
  
  var notif = document.createElement("div");
  notif.id = "ai-lead-notif";
  notif.style.cssText = "position:fixed;top:20px;right:20px;background:#10b981;color:white;padding:15px 20px;border-radius:10px;z-index:99999;font-family:sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.3);max-width:350px;";
  notif.innerHTML = "<strong>Sent to AI Dashboard</strong><br><small>" + (name || "Lead") + ": " + message.substring(0, 60) + "</small>";
  document.body.appendChild(notif);
  setTimeout(function() { notif.remove(); }, 3000);
}

function startWatching() {
  console.log("AI Lead Intelligence v2: Running");
  
  setInterval(function() {
    var data = extractConversationData();
    if (data.lastIncoming) { sendToDashboard(data); }
  }, 2000);
  
  document.addEventListener("click", function() {
    setTimeout(function() {
      var data = extractConversationData();
      if (data.lastIncoming) { sendToDashboard(data); }
    }, 500);
  });
}

startWatching();
