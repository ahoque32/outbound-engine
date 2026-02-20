// Dialer Module - AI Cold Call Engine
// Main exports for the dialer system

export { TwilioClient, twilioClient, TwilioCallOptions, TwilioCallResult } from './twilio-client';
export { VoiceAgent, voiceAgent, ElevenLabsAgentConfig, ConversationResult, ConversationMessage } from './voice-agent';
export { VoicemailHandler, voicemailHandler, AMDResult, VoicemailDeliveryResult, AMDCheckResult } from './voicemail-handler';
export { CallEngine, callEngine, CallEngineConfig, ProspectForCall, CallResult, BatchResult } from './call-engine';
export {
  personalizeScript,
  generateObservation,
  getScriptTemplate,
  listScriptTemplates,
  generateVoicemailScript,
  generateConversationPrompt,
  ScriptTemplate,
  ProspectData,
  PersonalizedScript,
  DEFAULT_AGENT_CONFIG,
  SCRIPT_TEMPLATES,
} from './call-script';
export {
  detectObjection,
  getObjectionResponse,
  handleObjection,
  detectInterest,
  ObjectionType,
  ObjectionResponse,
  DetectedObjection,
  listObjectionTypes,
  getExamplePhrases,
} from './objection-handler';
