import { z } from 'zod';

export const ServiceTypeSchema = z.enum(['service', 'sermon', 'recording-excerpt']).describe('Recording type: service, sermon-only, or recording-excerpt.');
export const ChapterTypeSchema = z.enum(['opening', 'worship', 'sermon', 'question-answer', 'communion', 'anthem', 'music', 'testimony', 'reflection', 'address', 'closing'])
  .describe('Chapter type. Use sermon for chapters within the sermon, including its illustrations; use question-answer/testimony/etc. only for distinct service items.');
export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type ChapterType = z.infer<typeof ChapterTypeSchema>;

export const SERVICE_TYPE_HELP = {
  service: 'A full service recording, possibly split into several uploads.',
  sermon: 'A sermon-only recording.',
  'recording-excerpt': 'A partial recording or isolated excerpt.',
} as const satisfies Record<ServiceType, string>;
export const CHAPTER_TYPE_HELP = {
  opening: 'Welcome, introduction or opening preparation.',
  worship: 'A grouped worship segment, including singing, prayer or readings.',
  sermon: 'A chapter within the main sermon; consecutive sermon chapters form the sermon playback span.',
  'question-answer': 'A distinct question-and-answer segment outside the sermon.',
  communion: 'Communion.',
  anthem: 'A standalone choir or anthem item.',
  music: 'Other standalone musical material.',
  testimony: 'A personal testimony.',
  reflection: 'A separate devotional reflection outside the main sermon.',
  address: 'A non-sermon address.',
  closing: 'Closing response, prayers, announcements or dismissal.',
} as const satisfies Record<ChapterType, string>;
