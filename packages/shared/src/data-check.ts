import { SUB, TPS } from './constants.ts'

// Reading the game's data files (data/*.json): small checks shared by every reader, each of which says plainly what is
// wrong and where (the file and the entry), so a typo stops the game at start-up instead of in the middle of a game.
//
// A reader makes a `Fail` for the entry it is reading (`failIn('data/crops.json, crop 3')`), and passes it to these.

export type Fail = (problem: string) => never
export type Fields = Readonly<Record<string, unknown>>

// A Fail that names where the problem is.
export function failIn(where: string): Fail {
  return (problem) => {
    throw new Error(`${where}: ${problem}`)
  }
}

export const isWhole = (value: unknown, min = 0): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min

// An object of fields (an entry in a file, or something in one).
export function fieldsOf(value: unknown, what: string, fail: Fail): Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Fields) : fail(`${what} must be an object`)
}

// Fails on a field that is not one of `allowed` (a misspelt field would otherwise be quietly left at its default).
export function onlyFields(fields: Fields, allowed: readonly string[], fail: Fail, what = ''): void {
  const extra = Object.keys(fields).find((field) => !allowed.includes(field))
  if (extra !== undefined) fail(`${what}"${extra}" is not a field here (the fields are ${allowed.join(', ')})`)
}

// A whole number, `min` or more; `fallback` when it is left out (no fallback: it must be there).
export function wholeField(fields: Fields, name: string, fail: Fail, min = 0, fallback?: number): number {
  const value = fields[name] ?? fallback
  return isWhole(value, min) ? value : fail(`"${name}" must be a whole number, ${min} or more`)
}

// A number, `min` or more; `fallback` when it is left out.
export function numberField(fields: Fields, name: string, fail: Fail, min = 0, fallback?: number): number {
  const value = fields[name] ?? fallback
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fail(`"${name}" must be a number, ${min} or more`)
}

// Some text; `fallback` when it is left out.
export function textField(fields: Fields, name: string, fail: Fail, fallback?: string): string {
  const value = fields[name] ?? fallback
  return typeof value === 'string' && value !== '' ? value : fail(`"${name}" must be some text`)
}

// A time in seconds, as ticks (at least one).
export function secondsField(fields: Fields, name: string, fail: Fail, fallback?: number): number {
  const value = fields[name] ?? fallback
  return typeof value === 'number' && value > 0 ? Math.max(1, Math.round(value * TPS)) : fail(`"${name}" must be a number of seconds above 0`)
}

// A distance in tiles, as units.
export function tilesField(fields: Fields, name: string, fail: Fail, fallback?: number): number {
  return Math.round(numberField(fields, name, fail, 0, fallback) * SUB)
}

// A speed in tiles a second, as units a tick.
export function speedField(fields: Fields, name: string, fail: Fail, fallback?: number): number {
  return Math.round((numberField(fields, name, fail, 0, fallback) * SUB) / TPS)
}
