export const IMAGE_PATHS_MIME = 'application/x-nais3-image-paths'
export const LIBRARY_ENTRY_MIME = 'application/x-nais3-library-entry'
export const LIBRARY_FOLDER_MIME = 'application/x-nais3-library-folder'

export type LibraryDragEntry = { type: 'image' | 'stack'; id: number }

export function setImagePathDrag(e: React.DragEvent, filePath: string): void {
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData(IMAGE_PATHS_MIME, JSON.stringify([filePath]))
}

export function droppedImagePaths(e: React.DragEvent): string[] {
  const paths: string[] = []
  const encoded = e.dataTransfer.getData(IMAGE_PATHS_MIME)
  if (encoded) {
    try {
      const values = JSON.parse(encoded) as unknown
      if (Array.isArray(values)) {
        paths.push(...values.filter((value): value is string => typeof value === 'string'))
      }
    } catch {
      // 다른 앱이 같은 MIME을 썼다면 무시하고 FileList를 확인한다.
    }
  }
  for (const file of Array.from(e.dataTransfer.files)) {
    const path = window.nais.pathForFile(file)
    if (path) paths.push(path)
  }
  return [...new Set(paths.filter(Boolean))]
}

export function hasImageDrop(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes(IMAGE_PATHS_MIME) || e.dataTransfer.types.includes('Files')
}

export function setLibraryEntryDrag(e: React.DragEvent, entry: LibraryDragEntry): void {
  e.dataTransfer.effectAllowed = 'copyMove'
  e.dataTransfer.setData(LIBRARY_ENTRY_MIME, JSON.stringify(entry))
}

export function readLibraryEntry(e: React.DragEvent): LibraryDragEntry | null {
  try {
    const value = JSON.parse(e.dataTransfer.getData(LIBRARY_ENTRY_MIME)) as LibraryDragEntry
    if ((value.type === 'image' || value.type === 'stack') && Number.isInteger(value.id))
      return value
  } catch {
    // 라이브러리 항목 드롭이 아니면 null
  }
  return null
}
