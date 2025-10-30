// Petit parser CSV compatible GTFS (champs entre guillemets, guillemets escape "")
export default function parseCSV(text: string): Array<Record<string, string>> {
  const lines: string[] = []
  let currentLine = ''
  let insideQuotes = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (insideQuotes && text[i + 1] === '"') {
        currentLine += '"'
        i++
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }
    if (char === '\n' && !insideQuotes) {
      lines.push(currentLine)
      currentLine = ''
      continue
    }
    currentLine += char
  }
  if (currentLine.length) lines.push(currentLine)

  const parsedRows = lines.map((line) => {
    const columns: string[] = []
    let currentField = ''
    let inFieldQuotes = false
    for (let i = 0; i < line.length; i++) {
      const char = line[i]
      if (char === '"') {
        if (inFieldQuotes && line[i + 1] === '"') {
          currentField += '"'
          i++
          continue
        }
        inFieldQuotes = !inFieldQuotes
        continue
      }
      if (char === ',' && !inFieldQuotes) {
        columns.push(currentField)
        currentField = ''
        continue
      }
      currentField += char
    }
    columns.push(currentField)
    return columns
  })

  const headerColumns = parsedRows[0] || []
  const objects = parsedRows.slice(1).map((recordFields) => {
    const obj: Record<string, string> = {}
    for (let i = 0; i < headerColumns.length; i++) {
      obj[headerColumns[i]] = (recordFields[i] ?? '').trim()
    }
    return obj
  })
  return objects
}
