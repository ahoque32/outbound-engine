// Objection Handler - Detects and responds to common sales objections
export type ObjectionType = 
  | 'not_interested'
  | 'too_expensive'
  | 'no_time'
  | 'already_have_solution'
  | 'send_email'
  | 'call_back_later'
  | 'wrong_person'
  | 'do_not_call'
  | 'need_to_think'
  | 'no_budget'
  | 'not_decision_maker'
  | 'happy_with_current'
  | 'unknown';

export interface ObjectionResponse {
  type: ObjectionType;
  confidence: number;
  response: string;
  followUp?: string;
  shouldContinue: boolean;
  captureInfo?: 'email' | 'callback_time' | 'decision_maker';
}

export interface DetectedObjection {
  type: ObjectionType;
  confidence: number;
  matchedPhrase: string;
}

// Objection patterns for detection
const OBJECTION_PATTERNS: Record<ObjectionType, string[]> = {
  not_interested: [
    'not interested',
    "don't want",
    'no thanks',
    'not looking',
    'pass',
    "i'm good",
    'no thank you',
    'not right now',
    'maybe later',
    "don't need",
  ],
  too_expensive: [
    'too expensive',
    'too much',
    "can't afford",
    "don't have money",
    'cost too much',
    'out of budget',
    'prices are high',
    'how much',
    'what does it cost',
    'pricing',
  ],
  no_time: [
    'no time',
    "don't have time",
    'busy',
    'in a meeting',
    'call me back',
    'not a good time',
    'bad time',
    'rushed',
  ],
  already_have_solution: [
    'already have',
    'already use',
    'we have a website',
    'we have someone',
    'already working with',
    'have a guy',
    'have a company',
    'already covered',
  ],
  send_email: [
    'send me an email',
    'email me',
    'send info',
    'send information',
    'email information',
    'send details',
  ],
  call_back_later: [
    'call back later',
    'call me later',
    'try again later',
    'call tomorrow',
    'call next week',
    'not right now',
    'later today',
  ],
  wrong_person: [
    'wrong number',
    'wrong person',
    "not me",
    'who is this',
    'you have the wrong',
  ],
  do_not_call: [
    'do not call',
    'stop calling',
    'remove me',
    'take me off',
    'dnc',
    'do not contact',
    'unsubscribe',
  ],
  need_to_think: [
    'need to think',
    'let me think',
    'discuss with',
    'talk to my',
    'need to check',
    'run it by',
  ],
  no_budget: [
    'no budget',
    'budget is tight',
    'cutting costs',
    'no money',
    'frozen budget',
  ],
  not_decision_maker: [
    "can't decide",
    'not the decision',
    'talk to my boss',
    'my manager',
    'my partner',
    'my wife',
    'my husband',
    'not up to me',
  ],
  happy_with_current: [
    'happy with',
    'satisfied with',
    'works fine',
    'no complaints',
    'doing well',
    'all good',
  ],
  unknown: [],
};

// Response templates for each objection type
const OBJECTION_RESPONSES: Record<ObjectionType, ObjectionResponse> = {
  not_interested: {
    type: 'not_interested',
    confidence: 0.9,
    response: "Totally understand. Just out of curiosity, are you happy with how your website converts visitors right now?",
    followUp: "No pressure at all, I'll let you go. Have a great day!",
    shouldContinue: false,
  },
  too_expensive: {
    type: 'too_expensive',
    confidence: 0.85,
    response: "It depends on what you need — a basic website revamp starts around $500, and the AI assistant is a monthly service.",
    followUp: "That's exactly what the 15-min call covers — no commitment, just a quick look at what would work for you.",
    shouldContinue: true,
  },
  no_time: {
    type: 'no_time',
    confidence: 0.9,
    response: "No problem! When would be a better time? I can call back this afternoon or tomorrow.",
    followUp: "What time works best for you?",
    shouldContinue: true,
    captureInfo: 'callback_time',
  },
  already_have_solution: {
    type: 'already_have_solution',
    confidence: 0.85,
    response: "That's great! When was the last time it was updated? A lot of businesses we work with had sites but they weren't mobile-optimized or converting visitors into leads.",
    followUp: "Would you be open to a quick 15-minute review to see if there are any gaps?",
    shouldContinue: true,
  },
  send_email: {
    type: 'send_email',
    confidence: 0.9,
    response: "Absolutely! What's the best email address? I'll have our team send over some examples of what we've done for similar businesses.",
    followUp: "Perfect, I'll make sure that gets sent today. Is there anything specific you'd like to see?",
    shouldContinue: true,
    captureInfo: 'email',
  },
  call_back_later: {
    type: 'call_back_later',
    confidence: 0.9,
    response: "No problem! When's a better time? I'll make sure to call back then.",
    followUp: "Would later today or tomorrow work better?",
    shouldContinue: true,
    captureInfo: 'callback_time',
  },
  wrong_person: {
    type: 'wrong_person',
    confidence: 0.95,
    response: "I apologize for the confusion. Could you point me in the right direction? Who should I speak with about the website?",
    followUp: "Would you be able to transfer me or provide their contact information?",
    shouldContinue: true,
    captureInfo: 'decision_maker',
  },
  do_not_call: {
    type: 'do_not_call',
    confidence: 1.0,
    response: "I completely understand. I'll remove you from our calling list right away. I apologize for any inconvenience.",
    followUp: "You won't hear from us again. Have a great day!",
    shouldContinue: false,
  },
  need_to_think: {
    type: 'need_to_think',
    confidence: 0.8,
    response: "Of course, it's smart to think it over. Is there anyone else you need to discuss this with?",
    followUp: "Would it help if I sent some information you could review and share with them?",
    shouldContinue: true,
    captureInfo: 'email',
  },
  no_budget: {
    type: 'no_budget',
    confidence: 0.85,
    response: "I understand budgets are tight. Even a small investment in your web presence can have a big impact on lead generation.",
    followUp: "Would it be worth a 15-minute conversation just to see what options might fit your situation? No commitment required.",
    shouldContinue: true,
  },
  not_decision_maker: {
    type: 'not_decision_maker',
    confidence: 0.9,
    response: "That makes sense. Who would be the best person for me to speak with about the website?",
    followUp: "Would you be able to connect me or should I reach out to them directly?",
    shouldContinue: true,
    captureInfo: 'decision_maker',
  },
  happy_with_current: {
    type: 'happy_with_current',
    confidence: 0.85,
    response: "I'm glad to hear things are going well! Just out of curiosity, how many leads does your website generate per week?",
    followUp: "If there was an opportunity to increase that by 20-30%, would that be worth a brief conversation?",
    shouldContinue: true,
  },
  unknown: {
    type: 'unknown',
    confidence: 0.0,
    response: "I understand. Let me ask you this — are you currently looking to grow your business or improve your online presence?",
    followUp: "Even a small improvement in your website can make a big difference in lead generation.",
    shouldContinue: true,
  },
};

/**
 * Detect objection type from user input
 */
export function detectObjection(text: string): DetectedObjection {
  console.log('[objection-handler.detectObjection] Analyzing text:', text);
  
  const lowerText = text.toLowerCase().trim();
  
  for (const [type, patterns] of Object.entries(OBJECTION_PATTERNS)) {
    if (type === 'unknown') continue;
    
    for (const pattern of patterns) {
      if (lowerText.includes(pattern.toLowerCase())) {
        console.log('[objection-handler.detectObjection] Detected:', type, 'with pattern:', pattern);
        return {
          type: type as ObjectionType,
          confidence: calculateConfidence(lowerText, pattern),
          matchedPhrase: pattern,
        };
      }
    }
  }
  
  console.log('[objection-handler.detectObjection] No objection detected');
  return {
    type: 'unknown',
    confidence: 0,
    matchedPhrase: '',
  };
}

/**
 * Get response for a detected objection
 */
export function getObjectionResponse(objection: DetectedObjection): ObjectionResponse {
  console.log('[objection-handler.getObjectionResponse] Getting response for:', objection.type);
  
  const response = { ...OBJECTION_RESPONSES[objection.type] };
  response.confidence = objection.confidence;
  
  return response;
}

/**
 * Handle a user message and return appropriate response
 */
export function handleObjection(userMessage: string): ObjectionResponse {
  console.log('[objection-handler.handleObjection] Handling message:', userMessage);
  
  const detected = detectObjection(userMessage);
  const response = getObjectionResponse(detected);
  
  console.log('[objection-handler.handleObjection] Response type:', response.type);
  console.log('[objection-handler.handleObjection] Should continue:', response.shouldContinue);
  
  return response;
}

/**
 * Check if a message indicates interest/positivity
 */
export function detectInterest(text: string): { interested: boolean; confidence: number } {
  console.log('[objection-handler.detectInterest] Analyzing text:', text);
  
  const positiveIndicators = [
    'interested',
    'sounds good',
    'tell me more',
    'that sounds',
    'would like',
    'want to learn',
    'book a call',
    'schedule',
    'when can we',
    'let\'s do it',
    'sign me up',
    'yes',
    'sure',
    'okay',
    'go ahead',
    'send me',
    'email me',
    'call me',
  ];
  
  const lowerText = text.toLowerCase();
  let matches = 0;
  
  for (const indicator of positiveIndicators) {
    if (lowerText.includes(indicator)) {
      matches++;
    }
  }
  
  const confidence = Math.min(matches * 0.3, 0.95);
  const interested = confidence > 0.3;
  
  console.log('[objection-handler.detectInterest] Interested:', interested, 'confidence:', confidence);
  
  return { interested, confidence };
}

/**
 * Calculate confidence score based on match quality
 */
function calculateConfidence(text: string, pattern: string): number {
  // Simple confidence calculation - longer matches are more confident
  const baseConfidence = 0.7;
  const lengthBonus = Math.min(pattern.length * 0.02, 0.2);
  return Math.min(baseConfidence + lengthBonus, 0.95);
}

/**
 * List all supported objection types
 */
export function listObjectionTypes(): ObjectionType[] {
  return Object.keys(OBJECTION_PATTERNS) as ObjectionType[];
}

/**
 * Get example phrases for an objection type
 */
export function getExamplePhrases(objectionType: ObjectionType): string[] {
  return OBJECTION_PATTERNS[objectionType] || [];
}
