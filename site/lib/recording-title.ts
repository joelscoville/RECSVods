/** The recording has one title. Preserve its supplied wording and casing. */
export function recordingTitle(service: { title: string }): string {
  return service.title.normalize('NFC').replace(/\s+/gu, ' ').trim();
}
