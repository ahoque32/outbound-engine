// Email Sequences — Cold outreach templates for RenderWiseAI
// Each sequence has 3 emails with 3-day gaps
// Placeholders: {{first_name}}, {{company}}, {{website}}
// Calendly link: https://calendly.com/renderwiseai/30min

export interface EmailTemplate {
  subject: string;
  body: string;
}

export interface SequenceStep {
  day: number;
  channel: 'email';
  action: string;
  subject: string;
  body: string;
}

// ============================================
// SEQUENCE 1: Web Design (for businesses with bad websites)
// ============================================
export const webDesignSequence: SequenceStep[] = [
  {
    day: 0,
    channel: 'email',
    action: 'cold_email',
    subject: "{{first_name}}, quick question about {{company}}'s site",
    body: `Hi {{first_name}},

I was checking out {{company}}'s website and noticed a few things that might be costing you leads — slow load times, mobile layout issues, and a few UX friction points.

We help businesses like {{company}} turn their websites into actual revenue generators. Recently redesigned a similar site and increased their inbound leads by 40% in the first month.

Worth a quick chat? Here's my calendar: https://calendly.com/renderwiseai/30min

Best,
Jake

RenderWiseAI`,
  },
  {
    day: 3,
    channel: 'email',
    action: 'follow_up',
    subject: 'Re: {{company}} site improvements',
    body: `Hi {{first_name}},

Wanted to follow up on my note about {{company}}'s website.

I ran a quick audit and found 3 specific issues that are likely hurting your conversion rate:
• Slow mobile loading (losing ~30% of visitors)
• Confusing navigation flow
• No clear call-to-action above the fold

Happy to share the full audit — no cost, just thought it might be useful.

Book 15 mins here if you're curious: https://calendly.com/renderwiseai/30min

Jake
RenderWiseAI`,
  },
  {
    day: 6,
    channel: 'email',
    action: 'breakup_email',
    subject: 'Last note — {{company}} website',
    body: `Hi {{first_name}},

I'll keep this short since I know you're busy.

If {{company}} is happy with how your site is performing, no worries at all — just wanted to make sure this didn't get buried.

If you ever want that free audit I mentioned, just reply and I'll send it over.

Either way, best of luck with {{company}}.

Jake
RenderWiseAI

P.S. — Still have a few spots open this week if you want to chat: https://calendly.com/renderwiseai/30min`,
  },
];

// ============================================
// SEQUENCE 2: AI Chatbot (for businesses that could use automation)
// ============================================
export const aiChatbotSequence: SequenceStep[] = [
  {
    day: 0,
    channel: 'email',
    action: 'cold_email',
    subject: '{{first_name}}, what happens to after-hours leads?',
    body: `Hi {{first_name}},

Quick question — when someone visits {{website}} at 8pm or on a Sunday and has a question, what happens?

Most businesses lose 40%+ of potential leads to "business hours only" responses.

We build AI chatbots that handle inquiries 24/7, qualify leads, and book appointments while you sleep. One client in {{company}}'s space captured 23 additional qualified leads in their first month.

Curious how it'd work for {{company}}? Grab a time here: https://calendly.com/renderwiseai/30min

Best,
Jake

RenderWiseAI`,
  },
  {
    day: 3,
    channel: 'email',
    action: 'follow_up',
    subject: 'Re: capturing more {{company}} leads',
    body: `Hi {{first_name}},

Following up on my note about after-hours lead capture.

I put together a quick demo showing how an AI assistant would handle common questions on {{website}} — qualifying visitors, answering FAQs, and routing hot leads to your team instantly.

The whole thing takes 20 minutes to set up and runs on autopilot.

Want to see the demo? Book a quick call: https://calendly.com/renderwiseai/30min

Or just reply "send it" and I'll forward the link.

Jake
RenderWiseAI`,
  },
  {
    day: 6,
    channel: 'email',
    action: 'breakup_email',
    subject: 'Last follow — AI assistant for {{company}}',
    body: `Hi {{first_name}},

Don't want to clutter your inbox, so this is my last note on this.

If capturing leads outside business hours isn't a priority for {{company}} right now, totally understand.

If you change your mind or want to see what the demo looks like, just reply and I'll send it over — no strings attached.

Good luck with everything at {{company}}.

Jake
RenderWiseAI`,
  },
];

// ============================================
// SEQUENCE 3: General RenderWiseAI (broad pitch)
// ============================================
export const generalRenderWiseSequence: SequenceStep[] = [
  {
    day: 0,
    channel: 'email',
    action: 'cold_email',
    subject: "{{first_name}}, noticed {{company}} while researching {{industry}}",
    body: `Hi {{first_name}},

Came across {{company}} while researching growing {{industry}} companies — impressive work you're doing.

I'm Jake from RenderWiseAI. We help businesses like {{company}} scale faster with smart automation: AI chatbots that capture leads 24/7, high-converting websites, and outbound systems that actually book meetings.

Recently helped a similar {{industry}} company increase qualified inbound by 60% and cut response time from hours to seconds.

Worth a brief chat to see if there's a fit? Here's my calendar: https://calendly.com/renderwiseai/30min

Best,
Jake

RenderWiseAI`,
  },
  {
    day: 3,
    channel: 'email',
    action: 'follow_up',
    subject: 'Re: {{company}} growth question',
    body: `Hi {{first_name}},

Wanted to follow up on my note about {{company}}.

Quick question: what's your biggest bottleneck right now — lead generation, converting website visitors, or something else?

We've built specific playbooks for {{industry}} companies depending on where they're stuck. Happy to share the one that matches {{company}}'s situation — takes 2 minutes to scan.

If any of it resonates, we can chat: https://calendly.com/renderwiseai/30min

Jake
RenderWiseAI`,
  },
  {
    day: 6,
    channel: 'email',
    action: 'breakup_email',
    subject: 'Final note — {{company}}',
    body: `Hi {{first_name}},

Last note from me — promise.

If growth automation isn't on {{company}}'s radar right now, no hard feelings. Timing is everything.

If you ever want to revisit, just reply and I'll pick up where we left off. Or grab a time here if something changes: https://calendly.com/renderwiseai/30min

Best of luck with {{company}}.

Jake
RenderWiseAI`,
  },
];

// ============================================
// Helper to get sequence by name
// ============================================
export const sequences = {
  webDesign: webDesignSequence,
  aiChatbot: aiChatbotSequence,
  general: generalRenderWiseSequence,
};

export type SequenceName = keyof typeof sequences;

export function getSequence(name: SequenceName): SequenceStep[] {
  return sequences[name] || generalRenderWiseSequence;
}

export function getAllSequences(): Record<SequenceName, SequenceStep[]> {
  return sequences;
}
