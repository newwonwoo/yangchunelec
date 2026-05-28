# 선거운동 단속 웹앱

투표소 반경 100m 이내 선거운동 위반 여부를 실시간 판별하는 모바일 웹앱.
카카오맵 API 사용 (무료 일 30만건).

## 배포 전 필수 수정 2곳

### 1. 카카오맵 앱키
`index.html` → `YOUR_APP_KEY` 교체
발급: https://developers.kakao.com → 내 애플리케이션 → 앱 생성 → JavaScript 키 복사

### 2. 수신 이메일 주소
`src/App.jsx` 상단 `DEFAULT_EMAIL` 교체

### 3. 투표소 데이터 (사전투표소 입력 완료, 본투표소 추가 필요)
`src/data/stations.js` → 본투표소 좌표 추가

## 배포 (Vercel)

```bash
git init && git add -A && git commit -m "init"
git remote add origin https://github.com/newwonwoo/election-patrol.git
git push -u origin main
# Vercel에서 Import → 자동 배포 → URL 공유
```

## 사용법

1. URL 접속 → 위치 권한 허용
2. 사전/본투표 버튼으로 모드 전환
3. 상단 바 빨강=위반 / 초록=안전
4. 위반 발견 → 📷 단속 촬영 → ✉️ 이메일 전송
