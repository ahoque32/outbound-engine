// Sequence Engine
// Executes multi-touch sequences with configurable delays

import { Sequence, SequenceStep, Prospect, Campaign, Touchpoint } from '../types';
import { ProspectStateMachine } from './state-machine';

export interface SequenceExecution {
  sequenceId: string;
  prospectId: string;
  step: SequenceStep;
  stepNumber: number;
  executeAt: Date;
}

export class SequenceEngine {
  private campaign: Campaign;

  constructor(campaign: Campaign) {
    this.campaign = campaign;
  }

  // Get the next step to execute for a sequence
  getNextStep(sequence: Sequence, touchpoints: Touchpoint[]): { step: SequenceStep; delayDays: number } | null {
    const template = this.campaign.sequenceTemplate;
    if (!template || sequence.currentStep >= template.steps.length) {
      return null;
    }

    const nextStep = template.steps[sequence.currentStep];
    if (!nextStep) return null;

    // Check if step conditions are met
    if (nextStep.conditions && !this.checkConditions(nextStep.conditions, touchpoints)) {
      return null;
    }

    // Calculate delay from previous step
    const delayDays = nextStep.day - (sequence.currentStep > 0 ? template.steps[sequence.currentStep - 1].day : 0);

    return { step: nextStep, delayDays };
  }

  // Check if step conditions are met
  private checkConditions(conditions: any[], touchpoints: Touchpoint[]): boolean {
    return conditions.every(condition => {
      const relevantTouches = touchpoints.filter(t => 
        t.channel === condition.channel && t.outcome === condition.outcome
      );

      switch (condition.operator) {
        case 'eq':
          return relevantTouches.length === condition.value;
        case 'gt':
          return relevantTouches.length > condition.value;
        case 'lt':
          return relevantTouches.length < condition.value;
        case 'exists':
          return condition.value ? relevantTouches.length > 0 : relevantTouches.length === 0;
        default:
          return true;
      }
    });
  }

  // Calculate when the next step should execute
  calculateNextExecution(sequence: Sequence, stepDelayDays: number): Date {
    const now = new Date();
    const nextExecution = new Date(now);
    nextExecution.setDate(nextExecution.getDate() + stepDelayDays);

    // Respect business hours
    const { start, end, timezone } = this.campaign.businessHours;
    const [startHour] = start.split(':').map(Number);
    const [endHour] = end.split(':').map(Number);

    // If calculated time is outside business hours, move to next business day start
    const currentHour = nextExecution.getHours();
    if (currentHour < startHour) {
      nextExecution.setHours(startHour, 0, 0, 0);
    } else if (currentHour >= endHour) {
      nextExecution.setDate(nextExecution.getDate() + 1);
      nextExecution.setHours(startHour, 0, 0, 0);
    }

    // Skip weekends
    const dayOfWeek = nextExecution.getDay();
    if (dayOfWeek === 0) { // Sunday
      nextExecution.setDate(nextExecution.getDate() + 1);
    } else if (dayOfWeek === 6) { // Saturday
      nextExecution.setDate(nextExecution.getDate() + 2);
    }

    return nextExecution;
  }

  // Generate all pending executions for a list of sequences
  generatePendingExecutions(sequences: Sequence[], touchpointsMap: Map<string, Touchpoint[]>): SequenceExecution[] {
    const executions: SequenceExecution[] = [];

    for (const sequence of sequences) {
      if (sequence.status !== 'active') continue;

      const touchpoints = touchpointsMap.get(sequence.prospectId) || [];
      const next = this.getNextStep(sequence, touchpoints);

      if (next) {
        executions.push({
          sequenceId: sequence.id,
          prospectId: sequence.prospectId,
          step: next.step,
          stepNumber: sequence.currentStep,
          executeAt: this.calculateNextExecution(sequence, next.delayDays),
        });
      }
    }

    return executions.sort((a, b) => a.executeAt.getTime() - b.executeAt.getTime());
  }

  // Advance sequence to next step
  advanceSequence(sequence: Sequence): Partial<Sequence> {
    const template = this.campaign.sequenceTemplate;
    const nextStep = sequence.currentStep + 1;

    if (nextStep >= template.steps.length) {
      return {
        currentStep: nextStep,
        status: 'completed',
        completedAt: new Date(),
      };
    }

    return {
      currentStep: nextStep,
    };
  }

  // Pause sequence (e.g., if prospect replies)
  pauseSequence(sequence: Sequence): Partial<Sequence> {
    return {
      status: 'paused',
    };
  }

  // Resume sequence
  resumeSequence(sequence: Sequence, resumeAt?: Date): Partial<Sequence> {
    return {
      status: 'active',
      nextStepAt: resumeAt || new Date(),
    };
  }

  // Cancel sequence
  cancelSequence(sequence: Sequence): Partial<Sequence> {
    return {
      status: 'cancelled',
    };
  }
}
