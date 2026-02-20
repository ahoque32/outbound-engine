// Prospect State Machine
// Manages state transitions based on touchpoint outcomes

import { Prospect, ProspectState, Touchpoint, LinkedInState, XState, EmailState, VoiceState } from '../types';

export class ProspectStateMachine {
  // Main state transitions
  private static readonly TRANSITIONS: Map<ProspectState, ProspectState[]> = new Map([
    ['discovered', ['researched']],
    ['researched', ['contacted']],
    ['contacted', ['engaged', 'not_interested']],
    ['engaged', ['qualified', 'not_interested']],
    ['qualified', ['booked', 'not_interested']],
    ['booked', ['converted', 'not_interested']],
    ['unresponsive', ['contacted']], // Can re-engage
  ]);

  // Channel state transitions
  static updateLinkedInState(current: LinkedInState, action: string, outcome: string): LinkedInState {
    const transitions: Record<string, Record<string, LinkedInState>> = {
      'not_connected': { 'request_sent': 'requested', 'request_accepted': 'connected' },
      'requested': { 'request_accepted': 'connected', 'request_declined': 'not_connected' },
      'connected': { 'message_sent': 'messaged' },
      'messaged': { 'replied': 'replied' },
      'replied': { 'message_sent': 'messaged' },
    };

    return transitions[current]?.[outcome] || current;
  }

  static updateXState(current: XState, action: string, outcome: string): XState {
    const transitions: Record<string, Record<string, XState>> = {
      'not_following': { 'followed': 'following' },
      'following': { 'engaged': 'engaged', 'dm_sent': 'dm_sent' },
      'engaged': { 'dm_sent': 'dm_sent', 'replied': 'dm_replied' },
      'dm_sent': { 'replied': 'dm_replied' },
      'dm_replied': { 'dm_sent': 'dm_sent' },
    };

    return transitions[current]?.[outcome] || current;
  }

  static updateEmailState(current: EmailState, action: string, outcome: string): EmailState {
    const transitions: Record<string, Record<string, EmailState>> = {
      'not_sent': { 'sent': 'sent', 'bounced': 'bounced' },
      'sent': { 'opened': 'opened', 'replied': 'replied', 'bounced': 'bounced' },
      'opened': { 'replied': 'replied' },
      'replied': {},
      'bounced': {},
    };

    return transitions[current]?.[outcome] || current;
  }

  static updateVoiceState(current: VoiceState, action: string, outcome: string): VoiceState {
    const transitions: Record<string, Record<string, VoiceState>> = {
      'not_called': { 'called': 'called' },
      'called': { 'answered': 'answered', 'voicemail': 'voicemail' },
      'answered': { 'booked': 'booked' },
      'voicemail': {},
      'booked': {},
    };

    return transitions[current]?.[outcome] || current;
  }

  // Determine main prospect state from channel states
  static determineMainState(prospect: Prospect, touchpoints: Touchpoint[]): ProspectState {
    // If booked on any channel, main state is booked
    if (prospect.voiceState === 'booked') return 'booked';
    
    // Count positive touchpoints
    const positiveTouches = touchpoints.filter(t => 
      ['replied', 'opened', 'answered', 'connected'].includes(t.outcome || '')
    ).length;

    // State logic based on touchpoints
    if (positiveTouches >= 3) return 'qualified';
    if (positiveTouches >= 1) return 'engaged';
    if (touchpoints.length > 0) return 'contacted';
    
    return prospect.state;
  }

  // Check if prospect is unresponsive
  static isUnresponsive(prospect: Prospect, touchpoints: Touchpoint[]): boolean {
    if (touchpoints.length === 0) return false;

    const lastTouch = touchpoints[touchpoints.length - 1];
    const daysSinceLastTouch = Math.floor(
      (Date.now() - new Date(lastTouch.sentAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    // Unresponsive if no reply after 14 days and 3+ touchpoints
    return daysSinceLastTouch > 14 && 
           touchpoints.length >= 3 && 
           !touchpoints.some(t => t.outcome === 'replied');
  }

  // Get available next states
  static getAvailableTransitions(currentState: ProspectState): ProspectState[] {
    return ProspectStateMachine.TRANSITIONS.get(currentState) || [];
  }

  // Validate state transition
  static canTransition(from: ProspectState, to: ProspectState): boolean {
    const available = ProspectStateMachine.getAvailableTransitions(from);
    return available.includes(to);
  }
}
