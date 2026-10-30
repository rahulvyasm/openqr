// Typings for the parts of the block renderer that the browser demo uses.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const MAX_BLOCKS: number;
export const blockSchema: any;
export const experienceSchema: any;
export function templates(): {
  id: string;
  intent: string;
  name: string;
  description: string;
  title: string;
  blocks: any[];
}[];
export function parseBlocks(data: Record<string, string>): any[];
export function validateExperienceBlocks(blocks: unknown): any[];
export function isVisible(block: any, now?: Date, zone?: string): boolean;
export function validZone(zone: string): boolean;
export function renderExperience(
  page: {
    title: string;
    blocks: any[];
    slug: string;
    pageOptions?: Record<string, unknown>;
    ticket?: string;
  },
  options?: {
    mediaUrl: (id: string) => string;
    sent?: string | null;
    error?: { block: string; message: string } | null;
    values?: Record<string, string>;
    preview?: boolean;
    now?: Date;
    zone?: string;
    item?: {
      name: string;
      serial: string;
      warrantyUntil: string;
      history: { date: string; note: string }[];
    } | null;
  },
): string;
