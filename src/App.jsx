import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import STATIONS from './data/stations'

const DEFAULT_EMAIL = 'enforcement@example.com'  // ★ 기본 수신 이메일
const EMAIL_STORAGE_KEY = 'patrol_email'
const EARLY_DATES = ['2026-05-29', '2026-05-30']
const MAIN_DATE = '2026-06-03'
const CACHE_KEY = 'station_coords_v2'

function detectVoteType() {
  const now = new Date()
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const today = kst.toISOString().slice(0, 10)
  if (EARLY_DATES.includes(today)) return 'early'
  if (today === MAIN_DATE) return 'main'
  return 'early'
}

function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (x) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function kakaoMapUrl(name, lat, lng) {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`
}

// ========================================
// 카카오 Geocoder로 주소 → 좌표 변환
// localStorage에 캐시하여 1회만 실행
// ========================================
async function geocodeStations(stations) {
  // 캐시 확인
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
    const allCached = stations.every((s) => cached[s.id])
    if (allCached) {
      return stations.map((s) => ({ ...s, lat: cached[s.id].lat, lng: cached[s.id].lng }))
    }
  } catch (e) { /* 캐시 없으면 무시 */ }

  // Geocoder 준비
  if (!window.kakao?.maps?.services) {
    console.warn('카카오 서비스 라이브러리 미로드')
    return stations
  }

  const geocoder = new window.kakao.maps.services.Geocoder()

  const geocodeOne = (addr) =>
    new Promise((resolve) => {
      geocoder.addressSearch(addr, (result, status) => {
        if (status === window.kakao.maps.services.Status.OK && result.length > 0) {
          resolve({ lat: parseFloat(result[0].y), lng: parseFloat(result[0].x) })
        } else {
          resolve(null)
        }
      })
    })

  // 순차 처리 (API 부하 방지)
  const coordMap = {}
  const results = []

  for (const s of stations) {
    const coord = await geocodeOne(s.fullAddr)
    if (coord) {
      coordMap[s.id] = coord
      results.push({ ...s, lat: coord.lat, lng: coord.lng })
    } else {
      // 주소 변환 실패 시 기본값 (양천구청)
      results.push({ ...s, lat: 37.5171, lng: 126.8665 })
    }
  }

  // 캐시 저장
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(coordMap)) } catch (e) { /* 무시 */ }

  return results
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
  const [photoFile, setPhotoFile] = useState(null)   // 촬영된 사진 파일
  const [mapReady, setMapReady] = useState(false)
  const [geocodedStations, setGeocodedStations] = useState([])
  const [geocodeProgress, setGeocodeProgress] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(EMAIL_STORAGE_KEY) || DEFAULT_EMAIL } catch { return DEFAULT_EMAIL }
  })

  const activeStations = useMemo(
    () => geocodedStations.filter((s) => s.type === voteType),
    [geocodedStations, voteType]
  )

  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const userMarkerRef = useRef(null)
  const overlaysRef = useRef([])
  const openInfoRef = useRef(null)

  // ========================================
  // 0) 좌표 변환 (최초 1회)
  // ========================================
  useEffect(() => {
    const doGeocode = async () => {
      // SDK 로딩 대기
      const waitForKakao = () => new Promise((resolve) => {
        const check = () => {
          if (window.kakao?.maps?.services) resolve()
          else setTimeout(check, 200)
        }
        check()
      })

      setGeocodeProgress('지도 로딩 중...')
      await waitForKakao()

      // 캐시가 있으면 즉시 로드
      try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
        if (Object.keys(cached).length >= STATIONS.length * 0.9) {
          const result = STATIONS.map((s) =>
            cached[s.id]
              ? { ...s, lat: cached[s.id].lat, lng: cached[s.id].lng }
              : { ...s, lat: 37.5171, lng: 126.8665 }
          )
          setGeocodedStations(result)
          setGeocodeProgress('')
          return
        }
      } catch (e) { /* 진행 */ }

      setGeocodeProgress('투표소 주소 변환 중... (최초 1회)')
      const result = await geocodeStations(STATIONS)
      setGeocodedStations(result)
      setGeocodeProgress('')
    }
    doGeocode()
  }, [])

  // ========================================
  // 1) 카카오 지도 초기화
  // ========================================
  useEffect(() => {
    const initMap = () => {
      if (!window.kakao?.maps?.LatLng || !mapContainerRef.current) {
        setTimeout(initMap, 200)
        return
      }
      if (mapRef.current) return

      const center = new window.kakao.maps.LatLng(37.5171, 126.8665)
      const map = new window.kakao.maps.Map(mapContainerRef.current, { center, level: 5 })
      map.addControl(new window.kakao.maps.ZoomControl(), window.kakao.maps.ControlPosition.RIGHT)
      mapRef.current = map
      setMapReady(true)
    }
    initMap()
  }, [])

  // ========================================
  // 2) 탭 복귀 시 relayout
  // ========================================
  useEffect(() => {
    if (tab === 'map' && mapRef.current) setTimeout(() => mapRef.current.relayout(), 50)
  }, [tab])

  // ========================================
  // 3) 마커+원 그리기
  // ========================================
  useEffect(() => {
    if (!mapRef.current || !mapReady || activeStations.length === 0) return

    overlaysRef.current.forEach((o) => o.setMap(null))
    overlaysRef.current = []

    const circleColor = voteType === 'early' ? '#1565c0' : '#d32f2f'
    const label = voteType === 'early' ? '사전' : '본'

    activeStations.forEach((s) => {
      if (!s.lat || !s.lng) return
      const pos = new window.kakao.maps.LatLng(s.lat, s.lng)
      const marker = new window.kakao.maps.Marker({ position: pos, map: mapRef.current })
      const infoWindow = new window.kakao.maps.InfoWindow({
        content: `<div style="padding:8px 12px;font-size:13px;white-space:nowrap"><b>[${label}] ${s.name}</b><br/><span style="color:#666;font-size:12px">${s.addr}</span></div>`,
      })
      window.kakao.maps.event.addListener(marker, 'click', () => {
        if (openInfoRef.current) openInfoRef.current.close()
        infoWindow.open(mapRef.current, marker)
        openInfoRef.current = infoWindow
      })
      const circle = new window.kakao.maps.Circle({
        center: pos, radius: 100, strokeWeight: 1.5,
        strokeColor: circleColor, strokeOpacity: 0.5,
        fillColor: circleColor, fillOpacity: 0.12, map: mapRef.current,
      })
      overlaysRef.current.push(marker, circle)
    })
  }, [activeStations, voteType, mapReady])

  // ========================================
  // 4) GPS 추적
  // ========================================
  useEffect(() => {
    if (!navigator.geolocation) { setGpsError('GPS 미지원 브라우저'); return }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { setMyPos({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setGpsError(null) },
      (err) => {
        if (err.code === 1) setGpsError('위치 권한을 허용해주세요')
        else if (err.code === 3) setGpsError('위치 탐색 중...')
        else setGpsError('위치 확인 불가')
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // ========================================
  // 5) 거리 계산 + 내 마커
  // ========================================
  useEffect(() => {
    if (!myPos || activeStations.length === 0) return
    const dists = activeStations
      .filter((s) => s.lat && s.lng)
      .map((s) => ({ ...s, distance: Math.round(calcDistance(myPos.lat, myPos.lng, s.lat, s.lng)) }))
      .sort((a, b) => a.distance - b.distance)
    setDistances(dists)
    const near = dists[0] || null
    setNearest(near)
    setIsViolation(near ? near.distance <= 100 : false)

    if (mapRef.current && mapReady) {
      const latLng = new window.kakao.maps.LatLng(myPos.lat, myPos.lng)
      if (userMarkerRef.current) {
        userMarkerRef.current.setPosition(latLng)
      } else {
        const el = document.createElement('div')
        el.style.cssText = 'width:16px;height:16px;background:#2196F3;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.3)'
        userMarkerRef.current = new window.kakao.maps.CustomOverlay({ position: latLng, content: el, map: mapRef.current, zIndex: 999 })
      }
    }
  }, [myPos, activeStations, mapReady])

  // ========================================
  // 6) 내 위치로 이동 버튼
  // ========================================
  const goToMyLocation = useCallback(() => {
    if (!myPos || !mapRef.current) return
    mapRef.current.setCenter(new window.kakao.maps.LatLng(myPos.lat, myPos.lng))
    mapRef.current.setLevel(3)
  }, [myPos])

  // ========================================
  // 7) 목록 → 지도 이동
  // ========================================
  const goToStation = useCallback((station) => {
    setTab('map')
    setTimeout(() => {
      if (mapRef.current) {
        mapRef.current.relayout()
        mapRef.current.setCenter(new window.kakao.maps.LatLng(station.lat, station.lng))
        mapRef.current.setLevel(3)
      }
    }, 100)
  }, [])

  // ========================================
  // 8) 사진 촬영 + 공유 (카톡/이메일/문자 등)
  // ========================================
  const handlePhoto = (e) => {
    if (e.target.files?.length > 0) {
      setPhotoFile(e.target.files[0])
      setPhotoTaken(true)
    }
  }

  const buildShareText = () => {
    const now = new Date()
    const dateStr = now.toLocaleString('ko-KR')
    const typeLabel = voteType === 'early' ? '사전투표소' : '본투표소'
    const stationName = nearest?.name || '미확인'
    const dist = nearest?.distance || '?'
    const coords = myPos ? `${myPos.lat.toFixed(5)}, ${myPos.lng.toFixed(5)}` : '미확인'
    return { typeLabel, stationName, dist, coords, dateStr }
  }

  // Web Share API → 카카오톡/이메일/문자 등 공유 시트
  const handleShare = async () => {
    const { typeLabel, stationName, dist, coords, dateStr } = buildShareText()
    const title = `[단속] ${typeLabel} ${stationName} ${dist}m`
    const text = `구분: ${typeLabel}\n투표소: ${stationName}\n거리: ${dist}m\n좌표: ${coords}\n시각: ${dateStr}`

    // Web Share API 지원 시 (카카오톡 포함)
    if (navigator.share) {
      try {
        const shareData = { title, text }
        // 사진 파일 첨부 가능 여부 확인
        if (photoFile && navigator.canShare?.({ files: [photoFile] })) {
          shareData.files = [photoFile]
        }
        await navigator.share(shareData)
        setPhotoTaken(false)
        setPhotoFile(null)
        return
      } catch (e) {
        if (e.name === 'AbortError') return // 사용자가 취소
      }
    }

    // 폴백: 이메일
    const subject = encodeURIComponent(title)
    const body = encodeURIComponent(text + '\n\n※ 촬영한 사진을 첨부해주세요')
    const mailUrl = `mailto:${email}?subject=${subject}&body=${body}`
    const w = window.open(mailUrl, '_blank')
    if (!w) window.location.href = mailUrl
    setPhotoTaken(false)
    setPhotoFile(null)
  }

  // 이메일 저장
  const saveEmail = (val) => {
    setEmail(val)
    try { localStorage.setItem(EMAIL_STORAGE_KEY, val) } catch {}
  }

  const typeLabel = voteType === 'early' ? '사전투표' : '본투표'
  const typeDates = voteType === 'early' ? '5/29~30' : '6/3'

  return (
    <div style={S.container}>
      {/* 사전/본투표 전환 */}
      <div style={S.modeBar}>
        <button style={{ ...S.modeBtn, ...(voteType === 'early' ? S.modeBtnActive : S.modeBtnInactive) }} onClick={() => setVoteType('early')}>사전투표 (5/29~30)</button>
        <button style={{ ...S.modeBtn, ...(voteType === 'main' ? S.modeBtnActiveRed : S.modeBtnInactive) }} onClick={() => setVoteType('main')}>본투표 (6/3)</button>
      </div>

      {/* 상태 바 */}
      <div style={{ ...S.statusBar, background: geocodeProgress ? '#555' : isViolation ? '#d32f2f' : '#2e7d32' }}>
        <span style={S.statusText}>
          {geocodeProgress ? geocodeProgress : gpsError ? `⚠ ${gpsError}` : nearest ? `${isViolation ? '⛔ 위반구역' : '✅ 안전구역'} — ${nearest.name} ${nearest.distance}m` : 'GPS 위치 탐색 중...'}
        </span>
      </div>

      {/* 메인 */}
      <div style={S.main}>
        <div style={{ ...S.tabContent, display: tab === 'map' ? 'block' : 'none' }}>
          <div ref={mapContainerRef} style={S.map} />
        </div>
        {tab === 'list' && (
          <div style={S.tabContent}>
            <div style={S.listHeader}>[{typeLabel}] 투표소 {activeStations.length}개소 — {typeDates}</div>
            <div>
              {distances.map((s) => (
                <div key={s.id} style={{ ...S.listItem, borderLeft: s.distance <= 100 ? '4px solid #d32f2f' : `4px solid ${voteType === 'early' ? '#1565c0' : '#2e7d32'}` }}>
                  <div style={{ flex: 1 }} onClick={() => goToStation(s)}>
                    <div style={S.listName}>{s.name}</div>
                    <div style={S.listAddr}>{s.addr}</div>
                  </div>
                  <div style={S.listRight}>
                    <div style={{ ...S.listDist, color: s.distance <= 100 ? '#d32f2f' : '#555' }}>{s.distance}m</div>
                    {s.lat && <a href={kakaoMapUrl(s.name, s.lat, s.lng)} target="_blank" rel="noopener noreferrer" style={S.mapLink} onClick={(e) => e.stopPropagation()}>🗺 크게보기</a>}
                  </div>
                </div>
              ))}
              {distances.length === 0 && <div style={S.listEmpty}>{myPos ? `${typeLabel}소 데이터 로딩 중...` : 'GPS 위치를 확인하면 거리가 표시됩니다'}</div>}
            </div>
          </div>
        )}
      </div>

      {/* 내 위치 + 촬영 + 설정 버튼 */}
      {tab === 'map' && (
        <div style={S.captureArea}>
          {myPos && <button style={S.myLocBtn} onClick={goToMyLocation}>📍</button>}
          {!photoTaken
            ? <label style={S.captureBtn}>📷 단속 촬영<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} /></label>
            : <button style={S.shareBtn} onClick={handleShare}>📤 공유</button>
          }
          <button style={S.settingsBtn} onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      )}

      {/* 설정 모달 */}
      {showSettings && (
        <div style={S.modal} onClick={() => setShowSettings(false)}>
          <div style={S.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>설정</div>
            <label style={S.modalLabel}>수신 이메일 (Web Share 미지원 시 사용)</label>
            <input
              style={S.modalInput}
              type="email"
              value={email}
              onChange={(e) => saveEmail(e.target.value)}
              placeholder="이메일 주소"
            />
            <div style={S.modalHint}>
              📤 공유 버튼 → 카카오톡, 이메일, 문자 등 선택 가능<br/>
              미지원 브라우저에서는 위 이메일로 자동 연결됩니다
            </div>
            <button style={S.modalClose} onClick={() => setShowSettings(false)}>닫기</button>
          </div>
        </div>
      )}

      {/* 하단 탭 */}
      <div style={S.tabBar}>
        <button style={{ ...S.tabBtn, ...(tab === 'map' ? S.tabActive : {}) }} onClick={() => setTab('map')}>🗺 지도</button>
        <button style={{ ...S.tabBtn, ...(tab === 'list' ? S.tabActive : {}) }} onClick={() => setTab('list')}>📋 목록</button>
      </div>
    </div>
  )
}

const S = {
  container: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif', background: '#f5f5f5' },
  modeBar: { display: 'flex', paddingTop: 'max(4px, env(safe-area-inset-top))', background: '#1a1a2e', flexShrink: 0, zIndex: 10 },
  modeBtn: { flex: 1, padding: '10px 0', fontSize: '13px', fontWeight: 'bold', border: 'none', cursor: 'pointer' },
  modeBtnActive: { background: '#1565c0', color: '#fff' },
  modeBtnActiveRed: { background: '#c62828', color: '#fff' },
  modeBtnInactive: { background: '#2a2a3e', color: '#888' },
  statusBar: { padding: '10px 16px', textAlign: 'center', flexShrink: 0, zIndex: 10 },
  statusText: { color: '#fff', fontSize: '14px', fontWeight: 'bold' },
  main: { flex: 1, position: 'relative', overflow: 'hidden' },
  tabContent: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'auto' },
  map: { width: '100%', height: '100%' },
  listHeader: { padding: '12px 16px', fontSize: '13px', fontWeight: 'bold', color: '#333', background: '#fff', borderBottom: '1px solid #e0e0e0' },
  listItem: { display: 'flex', alignItems: 'center', padding: '14px 16px', background: '#fff', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' },
  listName: { fontSize: '15px', fontWeight: 'bold', color: '#222' },
  listAddr: { fontSize: '12px', color: '#888', marginTop: '2px' },
  listRight: { textAlign: 'right', minWidth: '70px', flexShrink: 0 },
  listDist: { fontSize: '16px', fontWeight: 'bold' },
  mapLink: { fontSize: '11px', color: '#1565c0', textDecoration: 'none', display: 'inline-block', marginTop: '4px' },
  listEmpty: { padding: '40px 16px', textAlign: 'center', color: '#999', fontSize: '14px' },
  captureArea: {
    position: 'absolute', bottom: '70px', left: 0, right: 0,
    display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px',
    zIndex: 10, pointerEvents: 'none',
  },
  myLocBtn: {
    pointerEvents: 'auto', width: '48px', height: '48px', fontSize: '20px',
    background: '#fff', border: '1px solid #ddd', borderRadius: '50%',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  captureBtn: {
    pointerEvents: 'auto', padding: '14px 32px', background: '#d32f2f', color: '#fff',
    fontSize: '17px', fontWeight: 'bold', border: 'none', borderRadius: '28px',
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  shareBtn: {
    pointerEvents: 'auto', padding: '14px 32px', background: '#1565c0', color: '#fff',
    fontSize: '17px', fontWeight: 'bold', border: 'none', borderRadius: '28px',
    cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
  },
  settingsBtn: {
    pointerEvents: 'auto', width: '48px', height: '48px', fontSize: '20px',
    background: '#fff', border: '1px solid #ddd', borderRadius: '50%',
    cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
  },
  modalBox: {
    background: '#fff', borderRadius: '16px', padding: '24px', width: '85%', maxWidth: '360px',
  },
  modalTitle: { fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' },
  modalLabel: { fontSize: '13px', color: '#555', display: 'block', marginBottom: '6px' },
  modalInput: {
    width: '100%', padding: '10px 12px', fontSize: '15px', border: '1px solid #ddd',
    borderRadius: '8px', boxSizing: 'border-box', marginBottom: '12px',
  },
  modalHint: { fontSize: '12px', color: '#888', lineHeight: '1.6', marginBottom: '16px' },
  modalClose: {
    width: '100%', padding: '12px', background: '#1565c0', color: '#fff',
    fontSize: '15px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer',
  },
  tabBar: { display: 'flex', borderTop: '1px solid #ddd', background: '#fff', paddingBottom: 'env(safe-area-inset-bottom)', flexShrink: 0, zIndex: 10 },
  tabBtn: { flex: 1, padding: '12px 0', fontSize: '14px', fontWeight: 'bold', border: 'none', background: '#fff', color: '#999', cursor: 'pointer' },
  tabActive: { color: '#1565c0', borderTop: '2px solid #1565c0' },
}
