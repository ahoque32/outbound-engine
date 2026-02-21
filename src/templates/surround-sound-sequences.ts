// Surround Sound Sequence Templates
// Multi-channel 14-21 day coordinated outreach sequences

import { SequenceTemplate, SequenceStep, Channel } from '../types';

// Template 1: "Full Surround" (all 4 channels)
// Uses X, LinkedIn, Email, and Voice in coordinated fashion
export const FULL_SURROUND_TEMPLATE: SequenceTemplate = {
  id: 'full-surround',
  name: 'Full Surround (All 4 Channels)',
  steps: [
    {
      day: 0,
      channel: 'x' as Channel,
      action: 'follow_and_engage',
      template: 'follow_x_and_like_posts',
      description: 'Follow prospect on X and like 2 recent posts',
    },
    {
      day: 2,
      channel: 'linkedin' as Channel,
      action: 'connection_request',
      template: 'linkedin_connection_no_pitch',
      description: 'Send LinkedIn connection request (no pitch)',
    },
    {
      day: 4,
      channel: 'email' as Channel,
      action: 'cold_email',
      template: 'value_first_cold_email',
      description: 'Value-first cold email referencing their website',
    },
    {
      day: 7,
      channel: 'x' as Channel,
      action: 'dm',
      template: 'x_dm_content_reference',
      description: 'X DM referencing their recent content',
    },
    {
      day: 9,
      channel: 'linkedin' as Channel,
      action: 'message',
      template: 'linkedin_follow_up',
      description: 'LinkedIn message (after accepted, or follow-up request)',
      conditions: [
        { field: 'linkedin_state', operator: 'neq', value: 'not_connected' }
      ],
    },
    {
      day: 12,
      channel: 'email' as Channel,
      action: 'follow_up',
      template: 'case_study_follow_up',
      description: 'Email follow-up with case study',
    },
    {
      day: 15,
      channel: 'voice' as Channel,
      action: 'ai_warm_call',
      template: 'warm_call_linkedin_reference',
      description: 'AI warm call: "We\'ve been connected on LinkedIn..."',
    },
    {
      day: 18,
      channel: 'email' as Channel,
      action: 'breakup',
      template: 'breakup_email',
      description: 'Final breakup email',
    },
  ],
};

// Template 2: "Email + Voice" (no social)
// For prospects without social profiles or when social channels unavailable
export const EMAIL_VOICE_TEMPLATE: SequenceTemplate = {
  id: 'email-voice',
  name: 'Email + Voice (No Social)',
  steps: [
    {
      day: 0,
      channel: 'email' as Channel,
      action: 'cold_email',
      template: 'personalized_cold_outreach',
      description: 'Personalized cold outreach email',
    },
    {
      day: 3,
      channel: 'email' as Channel,
      action: 'follow_up',
      template: 'value_follow_up',
      description: 'Follow-up with additional value',
    },
    {
      day: 7,
      channel: 'voice' as Channel,
      action: 'ai_warm_call',
      template: 'warm_call_email_reference',
      description: 'Warm call referencing previous emails',
    },
    {
      day: 10,
      channel: 'email' as Channel,
      action: 'case_study',
      template: 'case_study_email',
      description: 'Case study email',
    },
    {
      day: 14,
      channel: 'voice' as Channel,
      action: 'ai_final_call',
      template: 'final_call_attempt',
      description: 'Final call attempt',
    },
    {
      day: 17,
      channel: 'email' as Channel,
      action: 'breakup',
      template: 'breakup_email',
      description: 'Breakup email',
    },
  ],
};

// Template 3: "Social First" (LinkedIn + X + Email)
// Prioritizes social engagement before email
export const SOCIAL_FIRST_TEMPLATE: SequenceTemplate = {
  id: 'social-first',
  name: 'Social First (LinkedIn + X + Email)',
  steps: [
    {
      day: 0,
      channel: 'x' as Channel,
      action: 'follow_and_engage',
      template: 'follow_x_and_engage',
      description: 'Follow on X and engage with content',
    },
    {
      day: 2,
      channel: 'linkedin' as Channel,
      action: 'connection_request',
      template: 'linkedin_connection',
      description: 'LinkedIn connection request',
    },
    {
      day: 5,
      channel: 'x' as Channel,
      action: 'dm',
      template: 'x_dm',
      description: 'X DM',
    },
    {
      day: 7,
      channel: 'linkedin' as Channel,
      action: 'message',
      template: 'linkedin_message',
      description: 'LinkedIn message',
      conditions: [
        { field: 'linkedin_state', operator: 'neq', value: 'not_connected' }
      ],
    },
    {
      day: 10,
      channel: 'email' as Channel,
      action: 'cold_email',
      template: 'cold_email_social_reference',
      description: 'Cold email referencing social connection',
    },
    {
      day: 13,
      channel: 'email' as Channel,
      action: 'follow_up',
      template: 'email_follow_up',
      description: 'Email follow-up',
    },
    {
      day: 16,
      channel: 'email' as Channel,
      action: 'breakup',
      template: 'breakup_email',
      description: 'Breakup email',
    },
  ],
};

// Template registry
export const SURROUND_SOUND_TEMPLATES: Record<string, SequenceTemplate> = {
  'full-surround': FULL_SURROUND_TEMPLATE,
  'email-voice': EMAIL_VOICE_TEMPLATE,
  'social-first': SOCIAL_FIRST_TEMPLATE,
};

// Get template by ID
export function getTemplate(templateId: string): SequenceTemplate | undefined {
  return SURROUND_SOUND_TEMPLATES[templateId];
}

// Get all available templates
export function getAllTemplates(): SequenceTemplate[] {
  return Object.values(SURROUND_SOUND_TEMPLATES);
}

// Get template based on prospect data availability
export function getRecommendedTemplate(prospect: {
  linkedinUrl?: string;
  xHandle?: string;
  email?: string;
  phone?: string;
}): string {
  const hasLinkedIn = !!prospect.linkedinUrl;
  const hasX = !!prospect.xHandle;
  const hasEmail = !!prospect.email;
  const hasPhone = !!prospect.phone;

  // Full surround if we have all channels
  if (hasLinkedIn && hasX && hasEmail && hasPhone) {
    return 'full-surround';
  }

  // Social first if we have social but no phone
  if ((hasLinkedIn || hasX) && hasEmail && !hasPhone) {
    return 'social-first';
  }

  // Email + voice if we have email and phone but limited social
  if (hasEmail && hasPhone && (!hasLinkedIn || !hasX)) {
    return 'email-voice';
  }

  // Default to social-first if we have any social
  if (hasLinkedIn || hasX) {
    return 'social-first';
  }

  // Fallback to email-voice
  return 'email-voice';
}

// Extend SequenceTemplate type to include description
// (adding to the base type for internal use)
declare module '../types' {
  interface SequenceStep {
    description?: string;
  }
}
