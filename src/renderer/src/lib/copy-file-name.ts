import { toast } from '../stores/toast-store'

/** 경로에서 파일 이름만 (확장자 포함) */
export function fileNameOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

/** 이미지 파일 이름을 클립보드에 복사한다 */
export function copyFileName(filePath: string): void {
  const name = fileNameOf(filePath)
  navigator.clipboard.writeText(name).then(
    () => toast('파일명 복사됨: ' + name, 'success'),
    () => toast('파일명을 복사하지 못했어요', 'error')
  )
}
