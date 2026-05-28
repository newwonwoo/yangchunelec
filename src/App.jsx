import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import STATIONS from './data/stations'

// ========================================
// ★ 수신 이메일 주소 — 여기서 변경
// ========================================
const DEFAULT_EMAIL = 'enforcement@example.com'

// ========================================
// 투표일 설정
// ========================================
const EARLY_DATES = ['2026-05-29', '2026-05-30']
const MAIN_DATE = '2026-06-03'

function detectVoteType() {
  const today = new Date().toISOString().slice(0, 10)
  if (EARLY_DATES.includes(today)) return 'early'
  if (today === MAIN_DATE) return 'main'
  return 'early'
}

// ========================================
// 직선거리 계산 (Haversine)
// GPS 좌표 2개 → 미터 단위 거리
// 지구가 둥그니까 단순 빼기가 아니라 이 공식을 씀
// ========================================
function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

// ========================================
// 메인 앱
// ========================================
export default function App() {
  const [tab, setTab] = useState('map')
  const [voteType, setVoteType] = useState(detectVoteType)
  const [myPos, setMyPos] = useState(null)
  const [gpsError, setGpsError] = useState(null)
  const [nearest, setNearest] = useState(null)
  const [isViolation, setIsViolation] = useState(false)
  const [distances, setDistances] = useState([])
  const [photoTaken, setPhotoTaken] = useState(false)

  // 현재 모드의 투표소만 필터
  const activeStations = useMemo(
    () => STATIONS.filter((s) => s.type === voteType),
    [voteType]
  )

  // 카카오 지도 ref
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)        // 카카오 Map 인스턴스
  const userMarkerRef = useRef(null)  // 내 위치 마커
  const overlaysRef = useRef([])      // 투표소 마커+원 (모드 전환 시 제거용)

  // ========================================
  // 1) 카카오 지도 초기화
  // ========================================
  useEffect(() => {
    const initMap = () => {
      if (!window.kakao?.maps || !mapContainerRef.current) {
        setTimeout(initMap, 200)
        return
      }
      if (mapRef.current) return

      // 카카오맵은 kakao.maps.load() 안에서 초기화해야 안전
      window.kakao.maps.load(() => {
        const center = new window.kakao.maps.LatLng(37.5171, 126.8665) // 양천구청
        const map = new window.kakao.maps.Map(mapContainerRef.current, {
          center,
          level: 5, // 줌 레벨 (숫자 작을수록 확대)
        })

        // 줌 컨트롤 추가
        map.addControl(
          new window.kakao.maps.ZoomControl(),
          window.kakao.maps.ControlPosition.RIGHT
        )

        mapRef.current = map
      })
    }
    initMap()
  }, [])

  // ========================================
  // 2) 모드 전환 시 마커+원 다시 그리기
  // ========================================
  useEffect(() => {
    if (!mapRef.current || !window.kakao?.maps) return

    // 기존 오버레이 제거
    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []

    const circleColor = voteType === 'early' ? '#1565c0' : '#d32f2f'
    const label = voteType === 'early' ? '사전' : '본'

    activeStations.forEach((s) => {
      const pos = new window.kakao.maps.LatLng(s.lat, s.lng)

      // 마커
      const marker = new window.kakao.maps.Marker({ position: pos, map: mapRef.current })

      // 마커 클릭 → 말풍선
      const infoWindow = new window.kakao.maps.InfoWindow({
        content: `<div style="padding:8px 12px;font-size:13px;white-space:nowrap"><b>[${label}] ${s.name}</b><br/><span style="color:#666;font-size:12px">${s.addr}</span></div>`,
      })
      window.kakao.maps.event.addListener(marker, 'click', () => {
        infoWindow.open(mapRef.current, marker)
      })

      // 100m 반경 원
      const circle = new window.kakao.maps.Circle({
        center: pos,
        radius: 100,
        strokeWeight: 1.5,
        strokeColor: circleColor,
        strokeOpacity: 0.5,
        fillColor: circleColor,
        fillOpacity: 0.12,
        map: mapRef.current,
      })

      overlaysRef.current.push(marker, circle)
    })
  }, [activeStations, voteType])

  // ========================================
  // 3) GPS 위치 추적
  // ========================================
  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('이 브라우저는 GPS를 지원하지 않습니다')
      return
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGpsError(null)
      },
      () => setGpsError('위치 권한을 허용해주세요'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // ========================================
  // 4) 위치 변경 → 거리 계산 + 내 마커 이동
  // ========================================
  useEffect(() => {
    if (!myPos) return

    const dists = activeStations
      .map((s) => ({
        ...s,
        distance: Math.round(calcDistance(myPos.lat, myPos.lng, s.lat, s.lng)),
      }))
      .sort((a, b) => a.distance - b.distance)

    setDistances(dists)
    const near = dists[0] || null
    setNearest(near)
    setIsViolation(near ? near.distance <= 100 : false)

    // 내 위치 마커 (파란 점)
    if (mapRef.current && window.kakao?.maps) {
      const latLng = new window.kakao.maps.LatLng(myPos.lat, myPos.lng)
      if (userMarkerRef.current) {
        userMarkerRef.current.setPosition(latLng)
      } else {
        // 파란 동그라미 커스텀 마커
        const content = document.createElement('div')
        content.style.cssText = 'width:16px;height:16px;background:#2196F3;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.3)'

        userMarkerRef.current = new window.kakao.maps.CustomOverlay({
          position: latLng,
          content,
          map: mapRef.current,
          zIndex: 999,
        })
      }
    }
  }, [myPos, activeStations])

  // ========================================
  // 5) 목록 → 지도 이동
  // ========================================
  const goToStation = useCallback((station) => {
    setTab('map')
    setTimeout(() => {
      if (mapRef.current && window.kakao?.maps) {
        const pos = new window.kakao.maps.LatLng(station.lat, station.lng)
        mapRef.current.setCenter(pos)
        mapRef.current.setLevel(3) // 줌인
      }
    }, 100)
  }, [])

  // ========================================
  // 6) 사진 + 이메일
  // ========================================
  const handlePhoto = () => setPhotoTaken(true)

  const openEmail = () => {
    const now = new Date()
    const dateStr = now.toLocaleString('ko-KR')
    const typeLabel = voteType === 'early' ? '사전투표소' : '본투표소'
    const stationName = nearest?.name || '미확인'
    const dist = nearest?.distance || '?'
    const coords = myPos ? `${myPos.lat.toFixed(5)}, ${myPos.lng.toFixed(5)}` : '미확인'

    const subject = encodeURIComponent(`[단속] ${typeLabel} ${stationName} ${dist}m ${dateStr}`)
    const body = encodeURIComponent(
      `구분: ${typeLabel}\n투표소: ${stationName}\n거리: ${dist}m\n좌표: ${coords}\n시각: ${dateStr}\n\n※ 촬영한 사진을 첨부해주세요`
    )
    window.location.href = `mailto:${DEFAULT_EMAIL}?subject=${subject}&body=${body}`
    setPhotoTaken(false)
  }

  const typeLabel = voteType === 'early' ? '사전투표' : '본투표'
  const typeDates = voteType === 'early' ? '5/29~30' : '6/3'

  // ========================================
  // 렌더링
  // ========================================
  return (
    <div style={styles.container}>

      {/* 사전/본투표 전환 */}
      <div style={styles.modeBar}>
        <button
          style={{ ...styles.modeBtn, ...(voteType === 'early' ? styles.modeBtnActive : styles.modeBtnInactive) }}
          onClick={() => setVoteType('early')}
        >
          사전투표 (5/29~30)
        </button>
        <button
          style={{ ...styles.modeBtn, ...(voteType === 'main' ? styles.modeBtnActiveRed : styles.modeBtnInactive) }}
          onClick={() => setVoteType('main')}
        >
          본투표 (6/3)
        </button>
      </div>

      {/* 상태 바 */}
      <div style={{ ...styles.statusBar, background: isViolation ? '#d32f2f' : '#2e7d32' }}>
        {gpsError ? (
          <span style={styles.statusText}>⚠ {gpsError}</span>
        ) : nearest ? (
          <span style={styles.statusText}>
            {isViolation ? '⛔ 위반구역' : '✅ 안전구역'} — {nearest.name} {nearest.distance}m
          </span>
        ) : (
          <span style={styles.statusText}>GPS 위치 탐색 중...</span>
        )}
      </div>

      {/* 메인 */}
      <div style={styles.main}>
        <div style={{ ...styles.tabContent, display: tab === 'map' ? 'block' : 'none' }}>
          <div ref={mapContainerRef} style={styles.map} />
        </div>

        {tab === 'list' && (
          <div style={styles.tabContent}>
            <div style={styles.listHeader}>[{typeLabel}] 투표소 {activeStations.length}개소 — {typeDates}</div>
            <div>
              {distances.map((s) => (
                <div
                  key={s.id}
                  style={{
                    ...styles.listItem,
                    borderLeft: s.distance <= 100
                      ? '4px solid #d32f2f'
                      : `4px solid ${voteType === 'early' ? '#1565c0' : '#2e7d32'}`,
                  }}
                  onClick={() => goToStation(s)}
                >
                  <div>
                    <div style={styles.listName}>{s.name}</div>
                    <div style={styles.listAddr}>{s.addr}</div>
                  </div>
                  <div style={{ ...styles.listDist, color: s.distance <= 100 ? '#d32f2f' : '#555' }}>
                    {s.distance}m
                  </div>
                </div>
              ))}
              {distances.length === 0 && (
                <div style={styles.listEmpty}>
                  {myPos ? `${typeLabel}소 데이터가 없습니다` : 'GPS 위치를 확인하면 거리가 표시됩니다'}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* 촬영 버튼 */}
      {tab === 'map' && (
        <div style={styles.captureArea}>
          {!photoTaken ? (
            <label style={styles.captureBtn}>
              📷 단속 촬영
              <input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} />
            </label>
          ) : (
            <button style={styles.emailBtn} onClick={openEmail}>✉️ 이메일 전송</button>
          )}
        </div>
      )}

      {/* 하단 탭 */}
      <div style={styles.tabBar}>
        <button style={{ ...styles.tabBtn, ...(tab === 'map' ? styles.tabActive : {}) }} onClick={() => setTab('map')}>
          🗺 지도
        </button>
        <button style={{ ...styles.tabBtn, ...(tab === 'list' ? styles.tabActive : {}) }} onClick={() => setTab('list')}>
          📋 목록
        </button>
      </div>
    </div>
  )
}

// ========================================
// 스타일
// ========================================
const styles = {
  container: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    display: 'flex', flexDirection: 'column',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif',
    background: '#f5f5f5',
  },
  modeBar: {
    display: 'flex', paddingTop: 'max(4px, env(safe-area-inset-top))',
    background: '#1a1a2e', flexShrink: 0, zIndex: 10,
  },
  modeBtn: { flex: 1, padding: '10px 0', fontSize: '13px', fontWeight: 'bold', border: 'none', cursor: 'pointer' },
  modeBtnActive: { background: '#1565c0', color: '#fff' },
  modeBtnActiveRed: { background: '#c62828', color: '#fff' },
  modeBtnInactive: { background: '#2a2a3e', color: '#888' },
  statusBar: { padding: '10px 16px', textAlign: 'center', flexShrink: 0, zIndex: 10 },
  statusText: { color: '#fff', fontSize: '14px', fontWeight: 'bold' },
  main: { flex: 1, position: 'relative', overflow: 'hidden' },
  tabContent: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'auto' },
  map: { width: '100%', height: '100%' },
  listHeader: {
    padding: '12px 16px', fontSize: '13px', fontWeight: 'bold',
    color: '#333', background: '#fff', borderBottom: '1px solid #e0e0e0',
  },
  listItem: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 16px', background: '#fff', borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
  },
  listName: { fontSize: '15px', fontWeight: 'bold', color: '#222' },
  listAddr: { fontSize: '12px', color: '#888', marginTop: '2px' },
  listDist: { fontSize: '16px', fontWeight: 'bold', minWidth: '60px', textAlign: 'right' },
  listEmpty: { padding: '40px 16px', textAlign: 'center', color: '#999', fontSize: '14px' },
  captureArea: {
    position: 'absolute', bottom: '70px', left: 0, right: 0,
    display: 'flex', justifyContent: 'center', zIndex: 10, pointerEvents: 'none',
  },
  captureBtn: {
    pointerEvents: 'auto', padding: '14px 32px', background: '#d32f2f', color: '#fff',
    fontSize: '17px', fontWeight: 'bold', border: 'none', borderRadius: '28px',
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  emailBtn: {
    pointerEvents: 'auto', padding: '14px 32px', background: '#1565c0', color: '#fff',
    fontSize: '17px', fontWeight: 'bold', border: 'none', borderRadius: '28px',
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  tabBar: {
    display: 'flex', borderTop: '1px solid #ddd', background: '#fff',
    paddingBottom: 'env(safe-area-inset-bottom)', flexShrink: 0, zIndex: 10,
  },
  tabBtn: {
    flex: 1, padding: '12px 0', fontSize: '14px', fontWeight: 'bold',
    border: 'none', background: '#fff', color: '#999', cursor: 'pointer',
  },
  tabActive: { color: '#1565c0', borderTop: '2px solid #1565c0' },
}
