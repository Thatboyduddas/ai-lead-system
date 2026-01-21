const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// PostgreSQL connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

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
    console.log('🇺🇸 Duddas CRM v3.0 Database initialized');
  } catch (err) {
    console.error('Database init error:', err);
  }
}

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

// ============ PRICING ============
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
  } else if (adults >= 3) {
    lowPrice = low.family; highPrice = high.family;
  } else {
    lowPrice = low.single; highPrice = high.single;
  }
  
  return { lowPrice, highPrice, bracket };
}

// ============ IMPROVED AGE/GENDER PARSING ============
function parseAgeGender(message) {
  const text = message.toLowerCase();
  const ages = [];
  let numKids = 0;
  
  // Find all 2-digit numbers that could be ages
  const allMatches = message.match(/\b(\d{1,2})\b/g);
  if (allMatches) {
    allMatches.forEach(match => {
      const age = parseInt(match);
      if (age >= 18 && age <= 99) {
        ages.push(age);
      }
    });
  }
  
  // Check for kids
  const kidsMatch = text.match(/(\d+)\s*(kids?|children|child|dependents?)/i);
  if (kidsMatch) {
    numKids = parseInt(kidsMatch[1]) || 1;
  } else if (/\b(kid|child|dependent|son|daughter)\b/i.test(text)) {
    numKids = 1;
  }
  
  // Word numbers
  const wordNums = { one: 1, two: 2, three: 3, four: 4, five: 5 };
  const wordMatch = text.match(/(one|two|three|four|five)\s*(kids?|children)/i);
  if (wordMatch) {
    numKids = wordNums[wordMatch[1].toLowerCase()] || 1;
  }
  
  // Spouse detection
  const hasSpouse = /wife|husband|spouse|partner|married|couple|and my|and her|and his/i.test(text);
  
  // Just me detection
  const justMe = /just\s*me|only\s*me|myself|single|just\s*myself|only myself/i.test(text);
  
  // Calculate adults
  let adults = ages.length || 1;
  if (hasSpouse && adults < 2) adults = 2;
  if (justMe && ages.length <= 1) adults = 1;
  
  // Youngest age for bracket (only adults 18-64)
  const adultAges = ages.filter(a => a >= 18 && a <= 64);
  const youngestAge = adultAges.length > 0 ? Math.min(...adultAges) : (ages[0] || 35);
  
  // Medicare check
  const hasMedicareAge = ages.some(a => a >= 65);
  
  return { adults, kids: numKids, youngestAge, ages, hasMedicareAge };
}

// ============ INTENT DETECTION ============
function detectIntent(message) {
  const text = message.toLowerCase().trim();
  
  // STOP WORDS first
  const stopWords = [
    'stop', 'unsubscribe', 'remove me', 'not interested', 'no thanks', 'no thank',
    'leave me alone', 'already have insurance', 'all good', 'all set', 'im good', 
    "i'm good", 'pass', 'nope', 'nah', 'dont text', "don't text", 'too expensive',
    'too pricey', 'cant afford', "can't afford", 'no money', 'not now', 'wrong number',
    'lose my number', 'take me off', 'opted out', 'do not contact'
  ];
  for (const word of stopWords) {
    if (text.includes(word)) return { intent: 'not_interested', confidence: 0.95 };
  }
  
  // MEDICARE detection
  const medicareWords = ['medicare', 'over 65', 'im 65', "i'm 65", 'turning 65'];
  for (const word of medicareWords) {
    if (text.includes(word)) return { intent: 'medicare', confidence: 0.9 };
  }
  
  // Check for ages 65+ explicitly
  const ageMatches = message.match(/\b(6[5-9]|[7-9][0-9])\b/g);
  if (ageMatches && ageMatches.length > 0) {
    const ageGender = parseAgeGender(message);
    return { intent: 'medicare', confidence: 0.9, data: ageGender };
  }
  
  // AGE/GENDER - check for age + gender indicators
  const hasAge = /\b(1[89]|[2-5][0-9]|6[0-4])\b/.test(text);
  const hasGender = /\b(male|female|m|f|man|woman|guy|girl)\b/i.test(text);
  const hasFamily = /wife|husband|spouse|partner|kid|child|just me|only me|myself/i.test(text);
  
  if (hasAge && (hasGender || hasFamily)) {
    const ageGender = parseAgeGender(message);
    return { intent: 'gave_age_gender', confidence: 0.95, data: ageGender };
  }
  
  // Multiple ages (like "55, 56, 32")
  const multipleAges = message.match(/\b(1[89]|[2-5][0-9]|6[0-4])\b/g);
  if (multipleAges && multipleAges.length >= 2) {
    const ageGender = parseAgeGender(message);
    return { intent: 'gave_age_gender', confidence: 0.9, data: ageGender };
  }
  
  // Single age with gender context nearby
  if (hasAge) {
    // Check if there's any gender word in the message
    if (/\b(m|f|male|female|man|woman)\b/i.test(text)) {
      const ageGender = parseAgeGender(message);
      return { intent: 'gave_age_gender', confidence: 0.85, data: ageGender };
    }
  }
  
  // POSITIVE / INTERESTED responses
  const positiveWords = [
    'yes', 'yeah', 'yea', 'yep', 'sure', 'ok', 'okay', 'interested', 'info',
    'quote', 'price', 'cost', 'how much', 'tell me more', 'sounds good',
    "let's do it", 'sign me up', 'need insurance', 'need coverage', 'fine',
    'go ahead', 'send it', 'want a quote', 'can you send', 'more info',
    'what do you have', 'what plans', 'help me', 'looking for', 'shopping for',
    'need health', 'want health', 'definitely', 'absolutely', 'for sure',
    'please', 'sounds great', 'im interested', "i'm interested",
    'i am interested', 'what do i need', 'what you got', 'whatcha got'
  ];
  for (const word of positiveWords) {
    if (text.includes(word)) return { intent: 'wants_quote', confidence: 0.85 };
  }
  
  // CALL LATER / SCHEDULE
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const laterWords = ['later', 'next week', 'next month', 'few weeks', 'busy right now', 'not right now', 'call me', 'text me later', 'get back to me', 'reach out', 'contact me', 'try again', 'maybe later', 'in a few', 'after the'];
  
  for (const month of months) {
    if (text.includes(month)) {
      return { intent: 'call_later', confidence: 0.9, followUpDate: month };
    }
  }
  for (const word of laterWords) {
    if (text.includes(word)) return { intent: 'call_later', confidence: 0.8 };
  }
  
  // QUESTIONS
  const questionIndicators = ['?', 'who is this', 'what company', 'what provider', 'which insurance', 'what insurance', 'how does', 'how do', 'what are', 'where are', 'when can', 'is this'];
  for (const q of questionIndicators) {
    if (text.includes(q)) return { intent: 'has_question', confidence: 0.7 };
  }
  
  // SOFT POSITIVES
  const softPositive = ['maybe', 'possibly', 'might', 'could be', 'depends', 'thinking', 'consider', 'let me', 'ill think', "i'll think", 'hmm', 'hm', 'idk', 'not sure yet'];
  for (const word of softPositive) {
    if (text.includes(word)) return { intent: 'soft_positive', confidence: 0.6 };
  }
  
  // Short responses - could be positive
  if (text.length <= 15 && text.length > 0) {
    const shortPositive = ['hi', 'hello', 'hey', 'sup', 'yo', 'k', 'kk', 'cool', 'bet', 'aight', 'word', 'thanks', 'thank you', 'thx', 'ty'];
    for (const word of shortPositive) {
      if (text === word || text.startsWith(word + ' ') || text.startsWith(word + '!')) {
        return { intent: 'soft_positive', confidence: 0.5 };
      }
    }
  }
  
  // Default - needs review
  return { intent: 'review', confidence: 0.3 };
}

// ============ MESSAGE TEMPLATES ============
const MESSAGES = {
  ageGender: "Alright, what is the age and gender of everyone that will be insured?",
  quote: (low, high) => `Assuming you have no major chronic/critical conditions, you can qualify for plans between $${low}-$${high}/month. Deductibles and networks are customizable ➡️ with $50 copays for primary care, specialists, and urgent care; $250 for ER; $250 for outpatient surgeries; and $500 for inpatient stays. Maximum out of pocket 5k. Plans include free ACA-compliant preventive care (immunizations, physicals, mammograms, Pap smears, colonoscopies).`,
  medicare: `We don't specialize in Medicare, but here is our referral for Medicare. Her name is Faith, she has been doing this for over a decade. Text her here +1 (352) 900-3966 or get on her calendar for a consultation. PLEASE make sure to mention Jack referred you! https://api.leadconnectorhq.com/widget/bookings/faithinsurancesolcalendar`
};

function processMessage(message) {
  const intentResult = detectIntent(message);
  
  let category, priority, suggestedAction, copyMessage, tagToApply, followUpDate;
  
  switch (intentResult.intent) {
    case 'wants_quote':
      category = 'wants_quote';
      priority = 'high';
      suggestedAction = '🔥 HOT LEAD! Send age/gender question';
      copyMessage = MESSAGES.ageGender;
      tagToApply = 'Age and gender';
      break;
      
    case 'gave_age_gender':
      const { adults, kids, youngestAge, ages } = intentResult.data;
      const quote = calculateQuote(adults, kids, youngestAge);
      category = 'ready_for_quote';
      priority = 'high';
      suggestedAction = `💰 SEND QUOTE: ${adults} adult(s), ${kids} kid(s), ages: ${ages.join(', ')}, bracket ${quote.bracket}`;
      copyMessage = MESSAGES.quote(quote.lowPrice, quote.highPrice);
      tagToApply = 'Quoted';
      break;
      
    case 'medicare':
      category = 'medicare';
      priority = 'medium';
      suggestedAction = '👴 Medicare lead - send Faith referral';
      copyMessage = MESSAGES.medicare;
      tagToApply = 'Medicare Referral';
      break;
      
    case 'not_interested':
      category = 'dead';
      priority = 'low';
      suggestedAction = '❌ Not interested - no action needed';
      tagToApply = 'Dead';
      break;
      
    case 'call_later':
      category = 'scheduled';
      priority = 'medium';
      followUpDate = intentResult.followUpDate || 'Later';
      suggestedAction = `📅 Follow up: ${followUpDate}`;
      tagToApply = 'Follow up';
      break;
      
    case 'has_question':
      category = 'question';
      priority = 'high';
      suggestedAction = '❓ Has a question - respond personally';
      break;
      
    case 'soft_positive':
      category = 'soft_positive';
      priority = 'medium';
      suggestedAction = '🤔 Might be interested - send age/gender question';
      copyMessage = MESSAGES.ageGender;
      tagToApply = 'Age and gender';
      break;
      
    default:
      category = 'review';
      priority = 'medium';
      suggestedAction = '👀 REVIEW - Could be a positive! Check manually';
  }
  
  return { 
    category, 
    priority, 
    suggestedAction, 
    copyMessage, 
    tagToApply, 
    followUpDate, 
    intent: intentResult.intent, 
    confidence: intentResult.confidence,
    parsedData: intentResult.data || null
  };
}

// ============ WEBHOOK ============
app.post('/webhook/salesgod', async (req, res) => {
  console.log('Webhook received:', req.body);
  
  const { phone, full_name, messages_as_string, status, isOutgoing, hasReferral } = req.body;
  
  if (!phone) {
    return res.json({ success: false, error: 'No phone number' });
  }
  
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  try {
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
        createdAt: new Date().toISOString(),
        hasReferral: false
      };
    }
    
    if (full_name && full_name !== 'Unknown') {
      lead.name = full_name;
    }
    
    if (hasReferral) {
      lead.hasReferral = true;
    }
    
    const lastMsg = lead.messages[lead.messages.length - 1];
    if (!lastMsg || lastMsg.text !== messages_as_string || lastMsg.isOutgoing !== !!isOutgoing) {
      
      let analysis = null;
      if (!isOutgoing) {
        analysis = processMessage(messages_as_string);
        lead.category = analysis.category;
        lead.priority = analysis.priority;
        lead.suggestedAction = analysis.suggestedAction;
        lead.copyMessage = analysis.copyMessage;
        lead.tagToApply = analysis.tagToApply;
        lead.parsedData = analysis.parsedData;
        
        if (analysis.intent === 'medicare') {
          lead.isMedicare = true;
        }
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
    
    await saveLead(cleanPhone, lead);
    res.json({ success: true, lead });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============ API ROUTES ============
app.get('/api/leads', async (req, res) => {
  try {
    const leads = await getAllLeads();
    res.json(leads);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
    res.json({ 
      status: '🇺🇸 Duddas CRM v3.0 - MAGA Edition', 
      leads: leads.length,
      message: 'Making Insurance Great Again!'
    });
  } catch (err) {
    res.json({ status: 'Running (DB Error)', error: err.message });
  }
});

app.post('/api/simulate', async (req, res) => {
  const testMessages = [
    { msg: "Yes I'm interested!", name: "Hot Lead" },
    { msg: "55 female\n56 male\n32 female", name: "Family Quote" },
    { msg: "Can you call me in April?", name: "Schedule" },
    { msg: "How much?", name: "Price Ask" },
    { msg: "No thanks", name: "Dead" },
    { msg: "I'm 67 need coverage", name: "Medicare" },
    { msg: "Maybe", name: "Soft Positive" },
    { msg: "35 male just me", name: "Single" }
  ];
  
  const test = testMessages[Math.floor(Math.random() * testMessages.length)];
  const phone = `+1555${Math.floor(Math.random()*9000000+1000000)}`;
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const analysis = processMessage(test.msg);
  
  const lead = {
    id: Date.now(),
    phone: phone,
    name: test.name,
    messages: [{ text: test.msg, timestamp: new Date().toISOString(), isOutgoing: false, analysis }],
    category: analysis.category,
    priority: analysis.priority,
    suggestedAction: analysis.suggestedAction,
    copyMessage: analysis.copyMessage,
    tagToApply: analysis.tagToApply,
    parsedData: analysis.parsedData,
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

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`🇺🇸 Duddas CRM v3.0 on port ${PORT} - Making Insurance Great Again!`);
  });
});
