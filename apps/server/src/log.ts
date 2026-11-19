// One line for each thing that happens to a game: the time (UTC), how serious it is, a message and name=value fields.
// Values with anything but plain characters in them are quoted, so a player's name cannot pose as another field.
export type LogFields = Record<string, string | number | boolean | undefined>

function formatValue(value: string | number | boolean): string {
  const text = String(value)
  return /^[\w.:/-]+$/.test(text) ? text : JSON.stringify(text)
}

function line(level: string, message: string, fields: LogFields): string {
  const parts = Object.entries(fields)
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
    .map(([key, value]) => `${key}=${formatValue(value)}`)
  return [new Date().toISOString(), level.padEnd(5), message, ...parts].join(' ')
}

export const log = {
  info(message: string, fields: LogFields = {}): void {
    console.log(line('INFO', message, fields))
  },
  warn(message: string, fields: LogFields = {}): void {
    console.warn(line('WARN', message, fields))
  },
  error(message: string, fields: LogFields = {}): void {
    console.error(line('ERROR', message, fields))
  },
}
