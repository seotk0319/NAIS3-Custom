import type { GenerationRequest } from '../../shared/types'
import { isV5Model } from '../../shared/nai-models'
import { AccountPausedError } from '../queue/generation-queue'
import { fetchAnlasBalance } from './client'

/** OFF는 비용이 불명확한 요청도 보내지 않는다. 서버의 원자적 과금 상한 기능은 아님. */
export async function checkFreeGeneration(
  token: string,
  request: GenerationRequest,
  refs: { characterCount: number; vibeCount: number; unencodedVibes: number }
): Promise<void> {
  if (
    request.source ||
    refs.characterCount > 0 ||
    refs.unencodedVibes > 0 ||
    refs.vibeCount > 4 ||
    !Number.isFinite(request.width * request.height) ||
    request.width <= 0 ||
    request.height <= 0 ||
    request.width * request.height > 1048576 ||
    !Number.isFinite(request.steps) ||
    request.steps < 1 ||
    request.steps > 28 ||
    (!isV5Model(request.model) && !request.model.startsWith('nai-diffusion-4-5'))
  )
    throw new Error(
      'Anlas 소모 OFF: 이 생성 설정은 무료를 확인할 수 없습니다. 해상도·스텝·이미지 입력·레퍼런스·바이브를 확인하세요.'
    )

  const status = await fetchAnlasBalance(token)
  if (status.active !== true || status.tier !== 'opus')
    throw new AccountPausedError('활성 Opus 구독 확인 불가', 60000)
  if (
    isV5Model(request.model) &&
    (!status.v5Usage || status.v5Usage.isNegative || status.v5Usage.percent < 1)
  )
    throw new AccountPausedError('V5 잔량 부족 또는 확인 불가 (1% 미만 보호)', 60000)
}
