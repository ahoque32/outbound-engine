// Prospect State Machine
// Manages state transitions based on touchpoint outcomes

import { Prospect, ProspectState, Touchpoint, LinkedInState, XState, EmailState, VoiceState } from '../types';

export class ProspectStateMachine {
  // Main state transitions
  private static readonly TRANSITIONS: Map<ProspectState, ProspectState[]> = new Map([
    ['discovered', ['researched']],
    ['researched', ['contacted']],
    ['contacted', ['engaged', 'not_interested', 'unresponsive']],
    ['engaged', ['qualified', 'not_interested', 'unresponsive']],
    ['qualified', ['booked', 'not_interested']],
    ['booked', ['converted', 'not_interested']],
    ['unresponsive', ['contacted', 'not_interested']], // Can re-engage
    ['not_interested', ['discovered']], // Terminal state, can only re-enter if prospect re-engages
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

    const newState = transitions[current]?.[outcome];
    if (!newState) {
      console.log(`[StateMachine] Invalid LinkedIn transition from ${current} with outcome ${outcome}`);
      return current;
    }
    return newState;
  }

  static updateXState(current: XState, action: string, outcome: string): XState {
    const transitions: Record<string, Record<string, XState>> = {
      'not_following': { 'followed': 'following' },
      'following': { 'engaged': 'engaged', 'dm_sent': 'dm_sent' },
      'engaged': { 'dm_sent': 'dm_sent', 'replied': 'dm_replied' },
      'dm_sent': { 'replied': 'dm_replied' },
      'dm_replied': { 'dm_sent': 'dm_sent' },
    };

    const newState = transitions[current]?.[outcome];
    if (!newState) {
      console.log(`[StateMachine] Invalid X transition from ${current} with outcome ${outcome}`);
      return current;
    }
    return newState;
  }

  static updateEmailState(current: EmailState, action: string, outcome: string): EmailState {
    const transitions: Record<string, Record<string, EmailState>> = {
      'not_sent': { 'sent': 'sent', 'bounced': 'bounced' },
      'sent': { 'opened': 'opened', 'replied': 'replied', 'bounced': 'bounced' },
      'opened': { 'replied': 'replied' },
      'replied': {},
      'bounced': {},
    };

    const newState = transitions[current]?.[outcome];
    if (!newState) {
      console.log(`[StateMachine] Invalid Email transition from ${current} with outcome ${outcome}`);
      return current;
    }
    return newState;
  }

  static updateVoiceState(current: VoiceState, action: string, outcome: string): VoiceState {
    const transitions: Record<string, Record<string, VoiceState>> = {
      'not_called': { 'called': 'called' },
      'called': { 'answered': 'answered', 'voicemail': 'voicemail' },
      'answered': { 'booked': 'booked' },
      'voicemail': {},
      'booked': {},
    };

    const newState = transitions[current]?.[outcome];
    if (!newState) {
      console.log(`[StateMachine] Invalid Voice transition from ${current} with outcome ${outcome}`);
      return current;
    }
    return newState;
  }

  // Determine main prospect state from channel states
  static determineMainState(prospect: Prospect, touchpoints: Touchpoint[]): ProspectState {
    // If booked on any channel, main state is booked
    if (prospect.voiceState === 'booked') {
      if (this.canTransition(prospect.pipeline_state, 'booked')) {
        return 'booked';
      }
      return prospect.pipeline_state;
    }
    
    // Count positive touchpoints
    const positiveTouches = touchpoints.filter(t => 
      ['replied', 'opened', 'answered', 'connected'].includes(t.outcome || '')
    ).length;

    // State logic based on touchpoints
    let newState: ProspectState = prospect.pipeline_state;
    if (positiveTouches >= 3) newState = 'qualified';
    else if (positiveTouches >= 1) newState = 'engaged';
    else if (touchpoints.length > 0) newState = 'contacted';
    
    // Validate transition
    if (newState !== prospect.pipeline_state && !this.canTransition(prospect.pipeline_state, newState)) {
      console.log(`[StateMachine] Invalid transition from ${prospect.pipeline_state} to ${newState}, keeping current state`);
      return prospect.pipeline_state;
    }
    
    return newState;
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
