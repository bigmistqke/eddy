/**
 * Generate Expanded Types
 *
 * Uses ts-morph to expand inferred types from lexicon-to-valibot
 * into concrete type definitions for better DX and smaller .d.ts output.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { Project, TypeFormatFlags } from 'ts-morph'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

function main() {
  console.log('Loading project...')

  const project = new Project({
    tsConfigFilePath: join(ROOT, 'tsconfig.json'),
  })

  const sourceFile = project.getSourceFileOrThrow(join(ROOT, 'src/index.ts'))

  const output: string[] = [
    '/**',
    ' * Generated Types',
    ' *',
    ' * Auto-generated from lexicon validators. Do not edit manually.',
    ' * Run `pnpm build:types` to regenerate.',
    ' */',
    '',
  ]

  // Extract all imports and convert to type imports
  console.log('\nExtracting imports...')
  const imports = sourceFile.getImportDeclarations()
  for (const imp of imports) {
    const moduleSpecifier = imp.getModuleSpecifierValue()

    // Skip local imports (lexicon files)
    if (moduleSpecifier.startsWith('./') || moduleSpecifier.startsWith('../')) {
      continue
    }

    const defaultImport = imp.getDefaultImport()?.getText()
    const namespaceImport = imp.getNamespaceImport()?.getText()
    const namedImports = imp.getNamedImports().map(n => {
      const name = n.getName()
      const alias = n.getAliasNode()?.getText()
      return alias ? `${name} as ${alias}` : name
    })

    let importLine = 'import type '
    if (defaultImport) {
      importLine += defaultImport
      if (namedImports.length > 0) {
        importLine += `, { ${namedImports.join(', ')} }`
      }
    } else if (namespaceImport) {
      importLine += `* as ${namespaceImport}`
    } else if (namedImports.length > 0) {
      importLine += `{ ${namedImports.join(', ')} }`
    } else {
      continue
    }
    importLine += ` from "${moduleSpecifier}"`

    output.push(importLine)
    console.log(`  ✓ ${moduleSpecifier}`)
  }
  output.push('')

  // Get all exported declarations
  console.log('\nExpanding exports...')
  const exportedDeclarations = sourceFile.getExportedDeclarations()
  let exportCount = 0

  for (const [name, declarations] of exportedDeclarations) {
    for (const declaration of declarations) {
      const kind = declaration.getKindName()
      const type = declaration.getType()

      let expandedType = type.getText(
        declaration,
        TypeFormatFlags.NoTruncation | TypeFormatFlags.InTypeAlias,
      )
      expandedType = cleanTypeText(expandedType)
      expandedType = formatType(expandedType)

      switch (kind) {
        case 'VariableDeclaration':
          output.push(`export declare const ${name}: ${expandedType}`)
          break
        case 'FunctionDeclaration':
          output.push(`export declare function ${name}: ${expandedType}`)
          break
        case 'ClassDeclaration':
          output.push(`export declare class ${name} ${expandedType}`)
          break
        case 'TypeAliasDeclaration':
          output.push(`export type ${name} = ${expandedType}`)
          break
        case 'InterfaceDeclaration':
          output.push(`export interface ${name} ${expandedType}`)
          break
        case 'EnumDeclaration':
          output.push(`export declare enum ${name} ${expandedType}`)
          break
        default:
          console.log(`  ? ${name} (${kind}) - skipped`)
          continue
      }

      output.push('')
      exportCount++
      console.log(`  ✓ ${name} (${kind})`)
    }
  }

  // Ensure dist directory exists
  const distDir = join(ROOT, 'dist')
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true })
  }

  const outputPath = join(distDir, 'index.d.ts')
  writeFileSync(outputPath, output.join('\n'))

  console.log(`\nGenerated ${outputPath}`)
  console.log(`  ${exportCount} exports`)
}

/**
 * Clean up type text by removing import paths and simplifying
 */
function cleanTypeText(text: string): string {
  return text
    // Remove import() references like import("valibot").InferOutput<...>
    .replace(/import\("[^"]+"\)\./g, '')
}

/**
 * Format type for readability (add newlines for objects)
 */
function formatType(text: string): string {
  let depth = 0
  let formatted = ''
  let i = 0

  while (i < text.length) {
    const char = text[i]

    if (char === '{' || char === '[') {
      depth++
      formatted += char
      if (text[i + 1] !== '}' && text[i + 1] !== ']') {
        formatted += '\n' + '  '.repeat(depth)
      }
    } else if (char === '}' || char === ']') {
      depth--
      if (text[i - 1] !== '{' && text[i - 1] !== '[') {
        formatted += '\n' + '  '.repeat(depth)
      }
      formatted += char
    } else if (char === ';') {
      formatted += char + '\n' + '  '.repeat(depth)
    } else if (char === ',' && depth > 0) {
      formatted += char + '\n' + '  '.repeat(depth)
    } else {
      formatted += char
    }
    i++
  }

  return formatted
    .replace(/\n\s*\n/g, '\n')
    .replace(/{\s+}/g, '{}')
    .replace(/\[\s+\]/g, '[]')
    .trim()
}

main()
