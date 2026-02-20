// Main entry point
export { ProspectStateMachine } from './core/state-machine';
export { SequenceEngine } from './core/sequence-engine';
export { RateLimiter, DEFAULT_LIMITS } from './core/rate-limiter';
export { BaseChannelAdapter } from './channels/base-adapter';
export { LinkedInAdapter } from './channels/linkedin-adapter';
export { XAdapter } from './channels/x-adapter';
export { EmailAdapter } from './channels/email-adapter';
export { VoiceAdapter } from './channels/voice-adapter';

export * from './types';
