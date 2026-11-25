// Sums up a V8 CPU profile (`node --cpu-prof`): the functions where the most time is spent, by their own time and by
// their total time (their own and what they call), so the slow parts of a benchmark (see run.ts) are easy to see.
// Usage: npx tsx bench/profile-summary.ts <file.cpuprofile> [how many, 25]
import { readFileSync } from 'node:fs'

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[]; hitCount?: number }
type Profile = { nodes: Node[]; startTime: number; endTime: number; samples: number[]; timeDeltas: number[] }

const [file, many = '25'] = process.argv.slice(2)
if (!file) {
  console.error('Usage: npx tsx bench/profile-summary.ts <file.cpuprofile> [how many]')
  process.exit(1)
}
const profile = JSON.parse(readFileSync(file, 'utf8')) as Profile
const byId = new Map(profile.nodes.map((node) => [node.id, node]))
const parent = new Map<number, number>()
for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
// Time per sample, attributed to the node sampled.
const selfTime = new Map<number, number>()
profile.samples.forEach((id, i) => selfTime.set(id, (selfTime.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000))
const label = (node: Node): string => {
  const url = node.callFrame.url.replace(/^.*FactoryGame[\\/]/, '').replace(/^file:\/\/\//, '')
  return `${node.callFrame.functionName || '(anonymous)'} ${url}:${node.callFrame.lineNumber + 1}`
}
const self = new Map<string, number>()
const total = new Map<string, number>()
for (const [id, ms] of selfTime) {
  const node = byId.get(id)!
  self.set(label(node), (self.get(label(node)) ?? 0) + ms)
  // Each function on the stack once (recursion counted once).
  const seen = new Set<string>()
  for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
    const name = label(byId.get(at)!)
    if (seen.has(name)) continue
    seen.add(name)
    total.set(name, (total.get(name) ?? 0) + ms)
  }
}
const all = [...selfTime.values()].reduce((sum, ms) => sum + ms, 0)
const show = (title: string, map: Map<string, number>): void => {
  console.log(`\n${title} (of ${all.toFixed(0)} ms)`)
  for (const [name, ms] of [...map].sort((a, b) => b[1] - a[1]).slice(0, Number(many))) {
    console.log(`${ms.toFixed(1).padStart(9)} ms ${((ms / all) * 100).toFixed(1).padStart(5)}%  ${name}`)
  }
}
show('Own time', self)
show('Total time', total)
