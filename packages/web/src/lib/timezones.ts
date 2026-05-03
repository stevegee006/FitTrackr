/** Get the browser's detected timezone (IANA identifier) */
export function getBrowserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Format a timezone for display, e.g. "New York (GMT-5)" */
export function formatTimezoneLabel(tz: string): string {
  const parts = tz.split('/');
  const city = parts[parts.length - 1].replace(/_/g, ' ');
  try {
    const offset =
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'shortOffset',
      })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName')?.value ?? '';
    return `${city} (${offset})`;
  } catch {
    const region = parts[0];
    return `${city} (${region})`;
  }
}

/** Get all IANA timezone identifiers (runtime, always current) */
export function getAllTimezones(): string[] {
  return Intl.supportedValuesOf('timeZone');
}
