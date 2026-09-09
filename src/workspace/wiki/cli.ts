import fs from 'node:fs'
import path from 'node:path'
import { runL1Audit } from './L1StructuralLinter'
import { runL2SemanticAudit, formatL2AuditReport } from './L2SemanticLinter'
import { formatL1AuditReport } from '@collaragent/tools/wiki/lintWorkspace'
import { compileWorkspace } from './GraphCompiler'

export async function main(args: string[]): Promise<void> {
  const subcommand = args[0]

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(`
Usage:
  wiki-cli lint [workspacePath] [--level l1|l2|both] [--semantic]
  wiki-cli compile [workspacePath] [--out <filePath>]

Examples:
  yarn wiki:lint
  yarn wiki:lint ./my-workspace --level both
  yarn wiki:compile --out ./compiled-graph.json
`)
    process.exit(0)
  }

  if (subcommand === 'lint') {
    let workspacePath = process.cwd()
    let level: 'l1' | 'l2' | 'both' = 'l1'
    let semantic = false

    for (let i = 1; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--semantic') {
        semantic = true
      } else if (arg === '--level' && i + 1 < args.length) {
        const val = args[++i]
        if (val === 'l1' || val === 'l2' || val === 'both') {
          level = val
        }
      } else if (!arg.startsWith('-')) {
        workspacePath = path.resolve(process.cwd(), arg)
      }
    }

    const runL2 = level === 'l2' || level === 'both' || semantic
    const runL1 = level === 'l1' || level === 'both' || level !== 'l2'

    let hasErrors = false

    if (runL1) {
      const l1Result = await runL1Audit(workspacePath)
      console.log(formatL1AuditReport(l1Result))
      if (!l1Result.valid) {
        hasErrors = true
      }
    }

    if (runL2) {
      if (runL1) {
        console.log('\n---\n')
      }
      const l2Result = await runL2SemanticAudit({ workspace: workspacePath })
      console.log(formatL2AuditReport(l2Result))
      if (!l2Result.valid) {
        hasErrors = true
      }
    }

    process.exit(hasErrors ? 1 : 0)
  }

  if (subcommand === 'compile') {
    let workspacePath = process.cwd()
    let outPath: string | null = null

    for (let i = 1; i < args.length; i++) {
      const arg = args[i]
      if ((arg === '--out' || arg === '-o') && i + 1 < args.length) {
        outPath = path.resolve(process.cwd(), args[++i])
      } else if (!arg.startsWith('-')) {
        workspacePath = path.resolve(process.cwd(), arg)
      }
    }

    try {
      const projection = await compileWorkspace(workspacePath)
      const json = JSON.stringify(projection, null, 2)
      if (outPath) {
        fs.mkdirSync(path.dirname(outPath), { recursive: true })
        fs.writeFileSync(outPath, json, 'utf8')
        console.log(
          `Successfully compiled graph projection to ${outPath} (${Object.keys(projection.graph.nodes).length} nodes, ${Object.keys(projection.graph.relationships).length} relationships)`
        )
      } else {
        console.log(json)
      }
      process.exit(0)
    } catch (err) {
      console.error(
        'Failed to compile workspace graph:',
        err instanceof Error ? err.message : String(err)
      )
      process.exit(1)
    }
  }

  console.error(`Unknown subcommand "${subcommand}". Run "wiki-cli --help" for usage.`)
  process.exit(1)
}
