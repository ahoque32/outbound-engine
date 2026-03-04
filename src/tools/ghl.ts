import { getProspect } from './prospects';
import { toErrorMessage } from './shared';
import { GHLContact, GHLResult } from './types';

const GHL_API_KEY = process.env.GHL_API_KEY || '';
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID || '';
const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-04-15';

function getHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    Version: GHL_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

async function parseJsonSafe<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as T;
}

async function findDuplicateByEmail(email: string): Promise<GHLContact | null> {
  if (!email || !GHL_API_KEY || !GHL_LOCATION_ID) return null;
  const url = `${GHL_BASE_URL}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) return null;
  const data = await parseJsonSafe<{ contact?: GHLContact }>(response);
  return data?.contact || null;
}

async function findDuplicateByPhone(phone: string): Promise<GHLContact | null> {
  if (!phone || !GHL_API_KEY || !GHL_LOCATION_ID) return null;
  const url = `${GHL_BASE_URL}/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&number=${encodeURIComponent(phone)}`;
  const response = await fetch(url, { headers: getHeaders() });
  if (!response.ok) return null;
  const data = await parseJsonSafe<{ contact?: GHLContact }>(response);
  return data?.contact || null;
}

/**
 * Checks whether a contact exists in GoHighLevel by email.
 */
export async function getGHLContact(email: string): Promise<GHLContact | null> {
  return findDuplicateByEmail(email);
}

/**
 * Pushes a prospect into GHL by creating/updating contact and tagging target stage.
 */
export async function pushToGHL(prospectId: string, pipelineStage: string = 'hunter_outreach'): Promise<GHLResult> {
  try {
    if (!GHL_API_KEY || !GHL_LOCATION_ID) {
      return {
        success: false,
        prospectId,
        pipelineStage,
        error: {
          code: 'MISSING_GHL_CONFIG',
          message: 'GHL_API_KEY and GHL_LOCATION_ID are required',
        },
      };
    }

    const prospect = await getProspect(prospectId);
    if (!prospect.email && !prospect.phone) {
      return {
        success: false,
        prospectId,
        pipelineStage,
        error: {
          code: 'MISSING_CONTACT_DATA',
          message: 'Prospect must have email or phone to sync into GHL',
        },
      };
    }

    let contact = prospect.email ? await findDuplicateByEmail(prospect.email) : null;
    if (!contact && prospect.phone) {
      contact = await findDuplicateByPhone(prospect.phone);
    }

    const nameParts = (prospect.name || '').trim().split(' ');
    const firstName = nameParts[0] || prospect.name || '';
    const lastName = nameParts.slice(1).join(' ');
    const tags = [`pipeline:${pipelineStage}`];

    if (contact?.id) {
      const response = await fetch(`${GHL_BASE_URL}/contacts/${contact.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({
          locationId: GHL_LOCATION_ID,
          firstName,
          lastName,
          email: prospect.email,
          phone: prospect.phone,
          companyName: prospect.company,
          tags,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        return {
          success: false,
          prospectId,
          contactId: contact.id,
          pipelineStage,
          error: {
            code: 'GHL_UPDATE_FAILED',
            message: `Failed updating GHL contact: ${response.status} ${body.slice(0, 200)}`,
          },
        };
      }

      return {
        success: true,
        prospectId,
        contactId: contact.id,
        pipelineStage,
      };
    }

    const createResponse = await fetch(`${GHL_BASE_URL}/contacts/`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName,
        lastName,
        email: prospect.email,
        phone: prospect.phone,
        companyName: prospect.company,
        website: prospect.website,
        tags,
      }),
    });

    if (!createResponse.ok) {
      const body = await createResponse.text();
      return {
        success: false,
        prospectId,
        pipelineStage,
        error: {
          code: 'GHL_CREATE_FAILED',
          message: `Failed creating GHL contact: ${createResponse.status} ${body.slice(0, 200)}`,
        },
      };
    }

    const created = await parseJsonSafe<{ contact?: GHLContact }>(createResponse);
    return {
      success: true,
      prospectId,
      contactId: created?.contact?.id,
      pipelineStage,
    };
  } catch (error) {
    return {
      success: false,
      prospectId,
      pipelineStage,
      error: {
        code: 'GHL_TOOL_ERROR',
        message: toErrorMessage(error),
      },
    };
  }
}
