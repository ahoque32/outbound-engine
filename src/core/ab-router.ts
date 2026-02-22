// A/B Router - Round-robin variant selector for voice agent testing

import variants from '../../variants.json';

export interface VariantConfig {
  id: string;
  agentId: string;
  name: string;
  weight: number;
  enabled: boolean;
}

// Track call counts in memory (resets on restart, that's fine — DB tracks long-term)
const callCounts: Record<string, number> = {};

export function selectVariant(): VariantConfig {
  const enabled = variants.variants.filter((v: any) => v.enabled);
  if (enabled.length === 0) throw new Error('No enabled variants');

  // Round-robin: pick variant with fewest calls
  for (const v of enabled) {
    if (!callCounts[v.id]) callCounts[v.id] = 0;
  }
  enabled.sort((a: any, b: any) => (callCounts[a.id] || 0) - (callCounts[b.id] || 0));
  const selected = enabled[0];
  callCounts[selected.id] = (callCounts[selected.id] || 0) + 1;
  return selected;
}

export function getVariantById(id: string): VariantConfig | undefined {
  return variants.variants.find((v: any) => v.id === id);
}

export function getVariantByAgentId(agentId: string): VariantConfig | undefined {
  return variants.variants.find((v: any) => v.agentId === agentId);
}
