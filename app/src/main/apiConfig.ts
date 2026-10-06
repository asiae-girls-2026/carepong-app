// 공개 API 주소만 포함. HTTPS 설정 후 이 기본 주소를 교체한다.
export const API_BASE = (process.env.CAREPONG_API_BASE_URL || process.env.CAREPONG_API || 'http://carepong-alb-405431408.ap-northeast-2.elb.amazonaws.com').replace(/\/+$/, '')
