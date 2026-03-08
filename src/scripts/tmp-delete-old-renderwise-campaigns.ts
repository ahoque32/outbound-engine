import { deactivateCampaign, deleteCampaign, listCampaigns } from '../channels/instantly-adapter';

async function main() {
  const campaigns = await listCampaigns();
  const old = campaigns.filter(c => c.name?.startsWith('RenderWise Outbound - '));

  const results: Array<{ id: string; name: string; deleted: boolean; error?: string }> = [];

  for (const c of old) {
    try {
      try {
        await deactivateCampaign(c.id);
      } catch {
        // ignore deactivate failures and try delete anyway
      }
      await deleteCampaign(c.id);
      results.push({ id: c.id, name: c.name, deleted: true });
    } catch (err: any) {
      results.push({ id: c.id, name: c.name, deleted: false, error: err?.message || String(err) });
    }
  }

  console.log(JSON.stringify({ matched: old.length, results }, null, 2));
}

void main();
