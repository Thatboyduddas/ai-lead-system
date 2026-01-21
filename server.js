const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// PostgreSQL connection - Railway provides DATABASE_URL automatically
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Initialize database table
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leads (
        phone VARCHAR(50) PRIMARY KEY,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

// Helper functions for database operations
async function getLead(phone) {
  const result = await pool.query('SELECT data FROM leads WHERE phone = $1', [phone]);
  return result.rows[0]?.data || null;
}

async function saveLead(phone, data) {
  await pool.query(`
    INSERT INTO leads (phone, data, updated_at) 
    VALUES ($1, $2, NOW())
    ON CONFLICT (phone) 
    DO UPDATE SET data = $2, updated_at = NOW()
  `, [phone, JSON.stringify(data)]);
}

async function getAllLeads() {
  const result = await pool.query('SELECT data FROM leads ORDER BY updated_at DESC');
  return result.rows.map(row => row.data);
}

async function clearAllLeads() {
  await pool.query('DELETE FROM leads');
}

const PRICING = {
  low: {
    '18-29': { single: 239, spouse: 519, kids: 499, family: 769 },
    '30-44': { single: 249, spouse: 549, kids: 529, family: 789 },
    '45-54': { single: 289, spouse: 619, kids: 579, family: 829 },
    '55-64': { single: 349, spouse: 629, kids: 589, family: 859 }
  },
  high: {
    '18-29': { single: 600, spouse: 1071, kids: 979, family: 1548 },
    '30-44': { single: 619, spouse: 1108, kids: 1013, family: 1603 },
    '45-54': { single: 642, spouse: 1155, kids: 1054, family: 1673 },
    '55-64': { single: 690, spouse: 1250, kids: 1140, family: 1815 }
  }
};

function getAgeBracket(age) {
  if (age >= 18 && age <= 29) return '18-29';
  if (age >= 30 && age <= 44) return '30-44';
  if (age >= 45 && age <= 54) return '45-54';
  if (age >= 55 && age <= 64) return '55-64';
  return '30-44';
}

function calculateQuote(adults, kids, youngestAge) {
  const bracket = getAgeBracket(youngestAge);
  const low = PRICING.low[bracket];
  const high = PRICING.high[bracket];
  
  let lowPrice, highPrice;
  
  if (adults === 1 && kids === 0) {
    lowPrice = low.single; highPrice = high.single;
  } else if (adults === 2 && kids === 0) {
    lowPrice = low.spouse; highPrice = high.spouse;
  } else if (adults === 1 && kids === 1) {
    lowPrice = Math.round((low.single + low.kids) / 2);
    highPrice = Math.round((high.single + high.kids) / 2);
  } else if (adults === 1 && kids >= 2) {
    lowPrice = low.kids; highPrice = high.kids;
  } else if (adults === 2 && kids === 1) {
    lowPrice = Math.round((low.spouse + low.family) / 2);
    highPrice = Math.round((high.spouse + high.family) / 2);
  } else if (adults === 2 && kids >= 2) {
    lowPrice = low.family; highPrice = high.family;
  } else {
    lowPrice = low.single; highPrice = high.single;
  }
  
  return { lowPrice, highPrice, bracket };
}

function parseAgeGender(message) {
  const text = message.toLowerCase();
  const ages = [];
  
  const ageMatches = text.match(/\d{2}/g);
  if (ageMatches) {
    ageMatches.forEach(a => {
      const age = parseInt(a);
      if (age >= 18 && age <= 64) ages.push(age);
    });
  }
  
  let numKids = 0;
  const kidsMatch = text.match(/(\d+)\s*(kids?|children|child)/i);
  if (kidsMatch) {
    numKids = parseInt(kidsMatch[1]) || 1;
  } else if (text.includes('kid') || text.includes('child')) {
    numKids = 1;
  }
  
  const hasSpouse = text.includes('wife') || text.includes('husband') || text.includes('spouse') || text.includes('partner');
  
  let adults = ages.length || 1;
  if (hasSpouse && adults < 2) adults = 2;
  
  const youngestAge = ages.length > 0 ? Math.min(...ages) : 35;
  
  return { adults, kids: numKids, youngestAge };
}

function detectIntent(message) {
  const text = message.toLowerCase();
  
  const stopWords = ['stop', 'unsubscribe', 'remove', 'not interested', 'no thanks', 'leave me alone', 'already have', 'all good', 'all set', 'im good', "i'm good", 'pass', 'nope', 'nah', 'no thank', 'dont text', "don't text", 'too pricey', 'too expensive', 'cant afford', "can't afford"];
  for (const word of stopWords) {
    if (text.includes(word)) return { intent: 'not_interested', confidence: 0.9 };
  }
  
  const hasAge = text.match(/\d{2}/);
  const hasGender = text.includes('male') || text.includes('female') || text.match(/\b(m|f)\b/) || text.includes('just me');
  if (hasAge && (hasGender || text.includes('wife') || text.includes('husband') || text.includes('kid'))) {
    const ageGender = parseAgeGender(message);
    return { intent: 'gave_age_gender', confidence: 0.95, data: ageGender };
  }
  
  const wantsQuoteWords = ['yes', 'yeah', 'yea', 'sure', 'ok', 'okay', 'interested', 'info', 'quote', 'price', 'cost', 'how much', 'tell me more', 'sounds good', "let's do it", 'sign me up', 'need insurance', 'fine', 'go ahead', 'send', 'want a quote', 'can you send'];
  for (const word of wantsQuoteWords) {
    if (text.includes(word)) return { intent: 'wants_quote', confidence: 0.85 };
  }
  
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const laterWords = ['later', 'next week', 'next month', 'few weeks', 'busy', 'not right now', 'call me', 'text me', 'get back'];
  for (const month of months) {
    if (text.includes(month)) return { intent: 'call_later', confidence: 0.9, followUpDate: month };
  }
  for (const word of laterWords) {
    if (text.includes(word)) return { intent: 'call_later', confidence: 0.8 };
  }
  
  if (text.includes('?') || text.includes('who is this') || text.includes('what provider') || text.includes('what company')) {
    return { intent: 'has_question', confidence: 0.7 };
  }
  
  return { intent: 'unclear', confidence: 0.3 };
}

const MESSAGES = {
  ageGender: "Alright, may I have the age and gender of everyone who will be insured?",
  quote: (low, high) => `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${low}-$${high}/month. Deductibles and networks are customizable ➡️ with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`
};

function processMessage(message) {
  const intentResult = detectIntent(message);
  
  let category, priority, suggestedAction, copyMessage, tagToApply, followUpDate;
  
  switch (intentResult.intent) {
    case 'wants_quote':
      category = 'wants_quote';
      priority = 'high';
      suggestedAction = 'Send age/gender message';
      copyMessage = MESSAGES.ageGender;
      tagToApply = 'Age and gender';
      break;
    case 'gave_age_gender':
      const { adults, kids, youngestAge } = intentResult.data;
      const quote = calculateQuote(adults, kids, youngestAge);
      category = 'ready_for_quote';
      priority = 'high';
      suggestedAction = `Send quote: ${adults} adult(s), ${kids} kid(s), bracket ${quote.bracket}`;
      copyMessage = MESSAGES.quote(quote.lowPrice, quote.highPrice);
      tagToApply = 'Quoted';
      break;
    case 'not_interested':
      category = 'dead';
      priority = 'low';
      suggestedAction = 'Lead not interested';
      break;
    case 'call_later':
      category = 'scheduled';
      priority = 'medium';
      followUpDate = intentResult.followUpDate || 'Later';
      suggestedAction = `Follow up: ${followUpDate}`;
      tagToApply = 'Follow up';
      break;
    case 'has_question':
      category = 'question';
      priority = 'high';
      suggestedAction = 'Answer their question';
      break;
    default:
      category = 'review';
      priority = 'low';
      suggestedAction = 'Review manually';
  }
  
  return { category, priority, suggestedAction, copyMessage, tagToApply, followUpDate, intent: intentResult.intent, confidence: intentResult.confidence };
}

// Webhook from extension
app.post('/webhook/salesgod', async (req, res) => {
  console.log('Webhook received:', req.body);
  
  const { phone, full_name, messages_as_string, status, isOutgoing } = req.body;
  
  if (!phone) {
    return res.json({ success: false, error: 'No phone number' });
  }
  
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  try {
    // Get or create lead
    let lead = await getLead(cleanPhone);
    
    if (!lead) {
      lead = {
        id: Date.now(),
        phone: phone,
        name: full_name || 'Unknown',
        messages: [],
        currentTag: status || '',
        status: 'active',
        notes: [],
        actions: [],
        createdAt: new Date().toISOString()
      };
    }
    
    // Update name if provided
    if (full_name && full_name !== 'Unknown') {
      lead.name = full_name;
    }
    
    // Add new message if it's different from last
    const lastMsg = lead.messages[lead.messages.length - 1];
    if (!lastMsg || lastMsg.text !== messages_as_string || lastMsg.isOutgoing !== !!isOutgoing) {
      
      // Only analyze incoming messages for AI suggestions
      let analysis = null;
      if (!isOutgoing) {
        analysis = processMessage(messages_as_string);
        lead.category = analysis.category;
        lead.priority = analysis.priority;
        lead.suggestedAction = analysis.suggestedAction;
        lead.copyMessage = analysis.copyMessage;
        lead.tagToApply = analysis.tagToApply;
      }
      
      lead.messages.push({
        text: messages_as_string,
        timestamp: new Date().toISOString(),
        isOutgoing: !!isOutgoing,
        analysis: analysis
      });
      
      lead.lastMessageAt = new Date().toISOString();
    }
    
    if (status) {
      lead.currentTag = status;
    }
    
    // Save to database
    await saveLead(cleanPhone, lead);
    
    console.log('Processed lead:', lead);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all leads as array
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await getAllLeads();
    res.json(leads);
  } catch (err) {
    console.error('Get leads error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update lead
app.post('/api/leads/:phone/action', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { action } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      lead.actions.push({ action, timestamp: new Date().toISOString() });
      lead.status = 'handled';
      await saveLead(phone, lead);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:phone/note', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { note } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      lead.notes.push({ text: note, timestamp: new Date().toISOString() });
      await saveLead(phone, lead);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/leads/:phone/status', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9+]/g, '');
  const { status, category } = req.body;
  
  try {
    const lead = await getLead(phone);
    if (lead) {
      if (status) lead.status = status;
      if (category) lead.category = category;
      await saveLead(phone, lead);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/test', async (req, res) => {
  try {
    const leads = await getAllLeads();
    res.json({ status: 'AI Lead System v2.1 Running (PostgreSQL)', leads: leads.length });
  } catch (err) {
    res.json({ status: 'AI Lead System v2.1 Running (DB Error)', error: err.message });
  }
});

app.post('/api/simulate', async (req, res) => {
  const testMessages = [
    { msg: "Yes I'm interested!", name: "Test Lead 1" },
    { msg: "I'm 35 male, wife is 32, 2 kids", name: "Family Lead" },
    { msg: "Can you call me in April?", name: "April Callback" },
    { msg: "How much does this cost?", name: "Price Question" },
    { msg: "No thanks too expensive", name: "Dead Lead" },
    { msg: "Who is this through? What provider?", name: "Question Lead" }
  ];
  
  const test = testMessages[Math.floor(Math.random() * testMessages.length)];
  const phone = `+1555${Math.floor(Math.random()*9000000+1000000)}`;
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const analysis = processMessage(test.msg);
  
  const lead = {
    id: Date.now(),
    phone: phone,
    name: test.name,
    messages: [{ text: test.msg, timestamp: new Date().toISOString(), analysis }],
    category: analysis.category,
    priority: analysis.priority,
    suggestedAction: analysis.suggestedAction,
    copyMessage: analysis.copyMessage,
    tagToApply: analysis.tagToApply,
    status: 'active',
    notes: [],
    actions: [],
    createdAt: new Date().toISOString(),
    lastMessageAt: new Date().toISOString()
  };
  
  try {
    await saveLead(cleanPhone, lead);
    res.json({ success: true, lead });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/clear', async (req, res) => {
  try {
    await clearAllLeads();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;

// Initialize database then start server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`AI Lead System v2.1 running on port ${PORT}`);
  });
});
