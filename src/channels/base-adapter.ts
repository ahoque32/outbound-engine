// Channel Adapter Interface
// Base class for all channel adapters

import { ChannelAdapter, Prospect, TouchpointResult, Channel } from '../types';

export abstract class BaseChannelAdapter implements ChannelAdapter {
  abstract name: Channel;

  abstract send(prospect: Prospect, action: string, content?: string): Promise<TouchpointResult>;
  
  abstract checkStatus(prospect: Prospect): Promise<string>;

  // Utility method to add human-like delays
  protected async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Random delay between min and max ms
  protected async randomDelay(min: number, max: number): Promise<void> {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    await this.delay(delay);
  }

  // Validate prospect has required fields for this channel
  protected validateProspect(prospect: Prospect, requiredFields: string[]): boolean {
    return requiredFields.every(field => {
      const value = (prospect as any)[field];
      return value !== undefined && value !== null && value !== '';
    });
  }
}
