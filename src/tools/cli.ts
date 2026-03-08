import 'dotenv/config';

import { Prospect } from '../types';
import {
  generateDailySummary,
  getChannelGaps,
  getEmailStatus,
  getGHLContact,
  getProspect,
  getProspectHistory,
  getTodayStats,
  listHealthySenders,
  listProspectsForOutreach,
  listVoiceAgents,
  makeCall,
  pushToGHL,
  queueEmail,
  updateProspect,
  getTranscript,
  updateCallLogOutcome,
} from './index';

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

function toCamelCase(value: string): string {
  return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function parseArgv(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const rawKey = token.slice(2);
    const key = toCamelCase(rawKey);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = next;
    i += 1;
  }

  return { positional, flags };
}

function getFlagString(
  flags: Record<string, string | boolean>,
  key: string
): string | undefined {
  const value = flags[key];
  return typeof value === 'string' ? value : undefined;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parsePrimitive(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if (
    (value.startsWith('{') && value.endsWith('}')) ||
    (value.startsWith('[') && value.endsWith(']'))
  ) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  return value;
}

function mapUpdateField(cliField: string): keyof Prospect | null {
  const fieldMap: Record<string, keyof Prospect> = {
    campaignId: 'campaignId',
    campaign_id: 'campaignId',
    name: 'name',
    company: 'company',
    title: 'title',
    email: 'email',
    phone: 'phone',
    linkedinUrl: 'linkedinUrl',
    linkedin_url: 'linkedinUrl',
    xHandle: 'xHandle',
    x_handle: 'xHandle',
    website: 'website',
    industry: 'industry',
    companySize: 'companySize',
    company_size: 'companySize',
    location: 'location',
    pipeline_state: 'pipeline_state',
    pipelineState: 'pipeline_state',
    state: 'state',
    linkedinState: 'linkedinState',
    linkedin_state: 'linkedinState',
    xState: 'xState',
    x_state: 'xState',
    emailState: 'emailState',
    email_state: 'emailState',
    voiceState: 'voiceState',
    voice_state: 'voiceState',
    score: 'score',
    notes: 'notes',
    source: 'source',
    lastTouchpointAt: 'lastTouchpointAt',
    last_touchpoint_at: 'lastTouchpointAt',
  };

  return fieldMap[cliField] || null;
}

function parseProspectUpdates(flags: Record<string, string | boolean>): Partial<Prospect> {
  const updates: Partial<Prospect> = {};

  for (const [key, raw] of Object.entries(flags)) {
    if (typeof raw !== 'string') continue;

    const mapped = mapUpdateField(key);
    if (!mapped) continue;

    const parsedValue = parsePrimitive(raw);
    if (mapped === 'lastTouchpointAt' && typeof parsedValue === 'string') {
      updates[mapped] = new Date(parsedValue);
      continue;
    }

    (updates as Record<string, unknown>)[mapped] = parsedValue;
  }

  return updates;
}

function printJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

async function run(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgv(rest);

  try {
    switch (command) {
      case 'prospect:get': {
        const id = positional[0];
        if (!id) throw new Error('prospect:get requires <id>');
        printJson(await getProspect(id));
        return;
      }

      case 'prospect:list-for-outreach': {
        const limit = parseNumber(getFlagString(flags, 'limit'), 25);
        const missingChannel = getFlagString(flags, 'missingChannel');
        const normalizedMissingChannel =
          missingChannel === 'email' || missingChannel === 'voice'
            ? missingChannel
            : undefined;

        printJson(
          await listProspectsForOutreach({
            limit,
            missingChannel: normalizedMissingChannel,
          })
        );
        return;
      }

      case 'prospect:gaps': {
        printJson(await getChannelGaps());
        return;
      }

      case 'prospect:history': {
        const id = positional[0];
        if (!id) throw new Error('prospect:history requires <id>');
        printJson(await getProspectHistory(id));
        return;
      }

      case 'prospect:update': {
        const id = positional[0];
        if (!id) throw new Error('prospect:update requires <id>');
        const updates = parseProspectUpdates(flags);
        if (Object.keys(updates).length === 0) {
          throw new Error('prospect:update requires at least one --<field> <value>');
        }

        await updateProspect(id, updates);
        printJson({ success: true, id, updates });
        return;
      }

      case 'voice:call': {
        const prospectId = positional[0];
        if (!prospectId) throw new Error('voice:call requires <prospectId>');
        const variant = getFlagString(flags, 'variant');
        printJson(await makeCall(prospectId, variant));
        return;
      }

      case 'voice:transcript': {
        const conversationId = positional[0];
        if (!conversationId) throw new Error('voice:transcript requires <conversationId>');
        printJson(await getTranscript(conversationId));
        return;
      }

      case 'voice:agents': {
        printJson(await listVoiceAgents());
        return;
      }

      case 'email:queue': {
        const prospectId = positional[0];
        if (!prospectId) throw new Error('email:queue requires <prospectId>');
        const subject = getFlagString(flags, 'subject');
        const body = getFlagString(flags, 'body');
        if (!subject || !body) {
          throw new Error('email:queue requires --subject "..." and --body "..."');
        }
        printJson(await queueEmail(prospectId, subject, body));
        return;
      }

      case 'email:status': {
        const email = positional[0];
        if (!email) throw new Error('email:status requires <email>');
        printJson(await getEmailStatus(email));
        return;
      }

      case 'email:senders': {
        printJson(await listHealthySenders());
        return;
      }

      case 'ghl:push': {
        const prospectId = positional[0];
        if (!prospectId) throw new Error('ghl:push requires <prospectId>');
        const stage = getFlagString(flags, 'stage');
        printJson(await pushToGHL(prospectId, stage));
        return;
      }

      case 'ghl:check': {
        const email = positional[0];
        if (!email) throw new Error('ghl:check requires <email>');
        printJson(await getGHLContact(email));
        return;
      }

      case 'calllog:update-outcome': {
        const conversationId = positional[0];
        if (!conversationId) throw new Error('calllog:update-outcome requires <conversationId>');
        const outcome = getFlagString(flags, 'outcome');
        if (!outcome) throw new Error('calllog:update-outcome requires --outcome <value>');
        const notes = getFlagString(flags, 'notes');
        printJson(await updateCallLogOutcome(conversationId, outcome, notes));
        return;
      }

      case 'report:today': {
        printJson(await getTodayStats());
        return;
      }

      case 'report:summary': {
        printJson(await generateDailySummary());
        return;
      }

      case 'report:gaps': {
        printJson(await getChannelGaps());
        return;
      }

      default: {
        throw new Error(`Unknown command: ${command || '(none)'}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    printJson({ success: false, error: message, command: command || null });
    process.exitCode = 1;
  }
}

void run();
