// 앱 버전 확인 결과 (설정 하단: 현재 버전 표시 + 최신 릴리스 비교 + 다운로드)
// 메인(GitHub Releases 조회)과 프리로드/렌더러가 공유하는 순수 타입.
export interface UpdateInfo {
  current: string // 지금 설치된 버전 (app.getVersion)
  latest: string | null // 공개 릴리스의 최신 버전 (확인 실패/릴리스 없음 시 null)
  isLatest: boolean // 현재 >= 최신 이면 true (확인 불가일 때도 true로 두어 불필요한 경고를 피함)
  downloadUrl: string | null // 최신 설치파일(.exe) 직접 다운로드 주소. 없으면 릴리스 페이지 주소
  error: string | null // 사용자에게 보여줄 안내(네트워크 실패·릴리스 없음 등). 정상이면 null
}
