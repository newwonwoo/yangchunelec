import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import STATIONS from './data/stations'

const DEFAULT_EMAIL = 'enforcement@example.com'
const EARLY_DATES = ['2026-05-29', '2026-05-30']
const MAIN_DATE = '2026-06-03'
const EMAIL_KEY = 'yc_email'

function detectVoteType() {
  const kst = new Date(Date.now() + 9 * 3600000)
  const today = kst.toISOString().slice(0, 10)
  if (EARLY_DATES.includes(today)) return 'early'
  if (today === MAIN_DATE) return 'main'
  return 'early'
}

function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = x => x * Math.PI / 180
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function kakaoMapUrl(name, lat, lng) {
  return `https://map.kakao.com/link/map/${encodeURIComponent(name)},${lat},${lng}`
}

export default function App() {
  const [tab, setTab] = useState('map')
  const [voteType, setVoteType] = useState(detectVoteType)
  const [myPos, setMyPos] = useState(null)
  const [gpsError, setGpsError] = useState(null)
  const [nearest, setNearest] = useState(null)
  const [isViolation, setIsViolation] = useState(false)
  const [distances, setDistances] = useState([])
  const [photoTaken, setPhotoTaken] = useState(false)
  const [photoFile, setPhotoFile] = useState(null)
  const [mapReady, setMapReady] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [email, setEmail] = useState(() => {
    try { return localStorage.getItem(EMAIL_KEY) || DEFAULT_EMAIL } catch (e) { return DEFAULT_EMAIL }
  })

  const activeStations = useMemo(() => STATIONS.filter(s => s.type === voteType), [voteType])

  const mapEl = useRef(null)
  const mapObj = useRef(null)
  const myMarker = useRef(null)
  const overlays = useRef([])
  const openInfo = useRef(null)

  // ═══ 지도 초기화 — 처음 잘 되던 구조 그대로 ═══
  useEffect(() => {
    const init = () => {
      if (!window.kakao?.maps?.LatLng || !mapEl.current) {
        setTimeout(init, 200)
        return
      }
      if (mapObj.current) return

      const map = new window.kakao.maps.Map(mapEl.current, {
        center: new window.kakao.maps.LatLng(37.5171, 126.8665),
        level: 5,
      })
      map.addControl(new window.kakao.maps.ZoomControl(), window.kakao.maps.ControlPosition.RIGHT)
      mapObj.current = map
      setMapReady(true)
    }
    init()
  }, [])

  // 탭 복귀 시 relayout
  useEffect(() => {
    if (tab === 'map' && mapObj.current) setTimeout(() => mapObj.current.relayout(), 50)
  }, [tab])

  // 마커+원 그리기
  useEffect(() => {
    if (!mapObj.current || !mapReady) return
    overlays.current.forEach(o => o.setMap(null))
    overlays.current = []
    const color = voteType === 'early' ? '#1565c0' : '#d32f2f'
    const lbl = voteType === 'early' ? '사전' : '본'
    activeStations.forEach(s => {
      const pos = new window.kakao.maps.LatLng(s.lat, s.lng)
      const marker = new window.kakao.maps.Marker({ position: pos, map: mapObj.current })
      const info = new window.kakao.maps.InfoWindow({
        content: `<div style="padding:8px 12px;font-size:13px;white-space:nowrap"><b>[${lbl}] ${s.name}</b><br><span style="color:#666;font-size:12px">${s.addr}</span></div>`,
      })
      window.kakao.maps.event.addListener(marker, 'click', () => {
        if (openInfo.current) openInfo.current.close()
        info.open(mapObj.current, marker)
        openInfo.current = info
      })
      const circle = new window.kakao.maps.Circle({
        center: pos, radius: 100, strokeWeight: 1.5,
        strokeColor: color, strokeOpacity: 0.5, fillColor: color, fillOpacity: 0.12, map: mapObj.current,
      })
      overlays.current.push(marker, circle)
    })
  }, [activeStations, voteType, mapReady])

  // GPS
  useEffect(() => {
    if (!navigator.geolocation) { setGpsError('GPS 미지원'); return }
    const id = navigator.geolocation.watchPosition(
      p => { setMyPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setGpsError(null) },
      e => setGpsError(e.code === 1 ? '위치 권한을 허용해주세요' : '위치 탐색 중...'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [])

  // 거리 계산 + 내 마커
  useEffect(() => {
    if (!myPos) return
    const d = activeStations.map(s => ({
      ...s, distance: Math.round(calcDistance(myPos.lat, myPos.lng, s.lat, s.lng))
    })).sort((a, b) => a.distance - b.distance)
    setDistances(d)
    const n = d[0] || null
    setNearest(n)
    setIsViolation(n ? n.distance <= 100 : false)
    if (mapObj.current && mapReady) {
      const ll = new window.kakao.maps.LatLng(myPos.lat, myPos.lng)
      if (myMarker.current) { myMarker.current.setPosition(ll) }
      else {
        const el = document.createElement('div')
        el.style.cssText = 'width:16px;height:16px;background:#2196F3;border:3px solid #fff;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,.3)'
        myMarker.current = new window.kakao.maps.CustomOverlay({ position: ll, content: el, map: mapObj.current, zIndex: 999 })
      }
    }
  }, [myPos, activeStations, mapReady])

  const goMyLoc = useCallback(() => {
    if (!myPos || !mapObj.current) return
    mapObj.current.setCenter(new window.kakao.maps.LatLng(myPos.lat, myPos.lng))
    mapObj.current.setLevel(3)
  }, [myPos])

  const goStation = useCallback(s => {
    setTab('map')
    setTimeout(() => {
      if (!mapObj.current) return
      mapObj.current.relayout()
      mapObj.current.setCenter(new window.kakao.maps.LatLng(s.lat, s.lng))
      mapObj.current.setLevel(3)
    }, 100)
  }, [])

  const handlePhoto = e => { if (e.target.files?.length > 0) { setPhotoFile(e.target.files[0]); setPhotoTaken(true) } }

  const handleShare = async () => {
    const now = new Date(), ds = now.toLocaleString('ko-KR')
    const tl = voteType === 'early' ? '사전투표소' : '본투표소'
    const sn = nearest?.name || '미확인', dist = nearest?.distance || '?'
    const co = myPos ? `${myPos.lat.toFixed(5)}, ${myPos.lng.toFixed(5)}` : '미확인'
    const title = `[단속] ${tl} ${sn} ${dist}m`
    const text = `구분: ${tl}\n투표소: ${sn}\n거리: ${dist}m\n좌표: ${co}\n시각: ${ds}`
    if (navigator.share) {
      try {
        const data = { title, text }
        if (photoFile && navigator.canShare?.({ files: [photoFile] })) data.files = [photoFile]
        await navigator.share(data)
        setPhotoTaken(false); setPhotoFile(null); return
      } catch (e) { if (e.name === 'AbortError') return }
    }
    const url = `mailto:${email}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(text + '\n\n※ 사진을 첨부해주세요')}`
    const w = window.open(url, '_blank'); if (!w) window.location.href = url
    setPhotoTaken(false); setPhotoFile(null)
  }

  const saveEmail = v => { setEmail(v); try { localStorage.setItem(EMAIL_KEY, v) } catch (e) {} }

  const tl = voteType === 'early' ? '사전투표' : '본투표'
  const td = voteType === 'early' ? '5/29~30' : '6/3'

  return (
    <div style={S.wrap}>
      <div style={S.modeBar}>
        <button style={{ ...S.modeBtn, ...(voteType === 'early' ? S.modeOn : S.modeOff) }} onClick={() => setVoteType('early')}>사전투표 (5/29~30)</button>
        <button style={{ ...S.modeBtn, ...(voteType === 'main' ? S.modeOnR : S.modeOff) }} onClick={() => setVoteType('main')}>본투표 (6/3)</button>
      </div>
      <div style={{ ...S.bar, background: isViolation ? '#d32f2f' : '#2e7d32' }}>
        <span style={S.barTxt}>{gpsError ? `⚠ ${gpsError}` : nearest ? `${isViolation ? '⛔ 위반구역' : '✅ 안전구역'} — ${nearest.name} ${nearest.distance}m` : 'GPS 위치 탐색 중...'}</span>
      </div>
      <div style={S.main}>
        <div style={{ ...S.panel, display: tab === 'map' ? 'block' : 'none' }}><div ref={mapEl} style={S.map} /></div>
        {tab === 'list' && (
          <div style={S.panel}>
            <div style={S.lh}>[{tl}] 투표소 {activeStations.length}개소 — {td}</div>
            <div>{distances.map(s => (
              <div key={s.id} style={{ ...S.li, borderLeft: s.distance <= 100 ? '4px solid #d32f2f' : `4px solid ${voteType === 'early' ? '#1565c0' : '#2e7d32'}` }}>
                <div style={{ flex: 1 }} onClick={() => goStation(s)}>
                  <div style={S.ln}>{s.name}</div><div style={S.la}>{s.addr}</div>
                </div>
                <div style={S.lr}>
                  <div style={{ ...S.ld, color: s.distance <= 100 ? '#d32f2f' : '#555' }}>{s.distance}m</div>
                  <a href={kakaoMapUrl(s.name, s.lat, s.lng)} target="_blank" rel="noopener noreferrer" style={S.ml} onClick={e => e.stopPropagation()}>🗺 크게보기</a>
                </div>
              </div>
            ))}{distances.length === 0 && <div style={S.le}>{myPos ? '투표소 로딩 중...' : 'GPS 위치 확인 후 표시됩니다'}</div>}</div>
          </div>
        )}
      </div>
      {tab === 'map' && (
        <div style={S.btns}>
          {myPos && <button style={S.locBtn} onClick={goMyLoc}>📍</button>}
          {!photoTaken
            ? <label style={S.camBtn}>📷 단속 촬영<input type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handlePhoto} /></label>
            : <button style={S.shareBtn} onClick={handleShare}>📤 공유</button>}
          <button style={S.setBtn} onClick={() => setShowSettings(true)}>⚙</button>
        </div>
      )}
      {showSettings && (
        <div style={S.dim} onClick={() => setShowSettings(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: '18px', fontWeight: 'bold', marginBottom: '16px' }}>설정</div>
            <label style={{ fontSize: '13px', color: '#555' }}>수신 이메일</label>
            <input style={S.inp} type="email" value={email} onChange={e => saveEmail(e.target.value)} />
            <div style={{ fontSize: '12px', color: '#888', lineHeight: '1.6', marginBottom: '16px' }}>📤 공유 → 카카오톡/이메일/문자 선택 가능</div>
            <button style={S.closeBtn} onClick={() => setShowSettings(false)}>닫기</button>
          </div>
        </div>
      )}
      <div style={S.tabs}>
        <button style={{ ...S.tab, ...(tab === 'map' ? S.tabOn : {}) }} onClick={() => setTab('map')}>🗺 지도</button>
        <button style={{ ...S.tab, ...(tab === 'list' ? S.tabOn : {}) }} onClick={() => setTab('list')}>📋 목록</button>
      </div>
    </div>
  )
}

const S = {
  wrap: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', fontFamily: '-apple-system,BlinkMacSystemFont,"Malgun Gothic",sans-serif', background: '#f5f5f5' },
  modeBar: { display: 'flex', paddingTop: 'max(4px,env(safe-area-inset-top))', background: '#1a1a2e', flexShrink: 0, zIndex: 10 },
  modeBtn: { flex: 1, padding: '10px 0', fontSize: '13px', fontWeight: 'bold', border: 'none', cursor: 'pointer' },
  modeOn: { background: '#1565c0', color: '#fff' }, modeOnR: { background: '#c62828', color: '#fff' }, modeOff: { background: '#2a2a3e', color: '#888' },
  bar: { padding: '10px 16px', textAlign: 'center', flexShrink: 0, zIndex: 10 }, barTxt: { color: '#fff', fontSize: '14px', fontWeight: 'bold' },
  main: { flex: 1, position: 'relative', overflow: 'hidden' },
  panel: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'auto' }, map: { width: '100%', height: '100%' },
  lh: { padding: '12px 16px', fontSize: '13px', fontWeight: 'bold', color: '#333', background: '#fff', borderBottom: '1px solid #e0e0e0' },
  li: { display: 'flex', alignItems: 'center', padding: '14px 16px', background: '#fff', borderBottom: '1px solid #f0f0f0', cursor: 'pointer' },
  ln: { fontSize: '15px', fontWeight: 'bold', color: '#222' }, la: { fontSize: '12px', color: '#888', marginTop: '2px' },
  lr: { textAlign: 'right', minWidth: '70px', flexShrink: 0 }, ld: { fontSize: '16px', fontWeight: 'bold' },
  ml: { fontSize: '11px', color: '#1565c0', textDecoration: 'none', display: 'inline-block', marginTop: '4px' },
  le: { padding: '40px 16px', textAlign: 'center', color: '#999', fontSize: '14px' },
  btns: { position: 'absolute', bottom: '70px', left: 0, right: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', zIndex: 10, pointerEvents: 'none' },
  locBtn: { pointerEvents: 'auto', width: '48px', height: '48px', fontSize: '20px', background: '#fff', border: '1px solid #ddd', borderRadius: '50%', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)' },
  camBtn: { pointerEvents: 'auto', padding: '14px 32px', background: '#d32f2f', color: '#fff', fontSize: '17px', fontWeight: 'bold', border: 'none', borderRadius: '28px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.3)' },
  shareBtn: { pointerEvents: 'auto', padding: '14px 32px', background: '#1565c0', color: '#fff', fontSize: '17px', fontWeight: 'bold', border: 'none', borderRadius: '28px', cursor: 'pointer', boxShadow: '0 4px 12px rgba(0,0,0,.3)' },
  setBtn: { pointerEvents: 'auto', width: '48px', height: '48px', fontSize: '20px', background: '#fff', border: '1px solid #ddd', borderRadius: '50%', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,.2)' },
  dim: { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 },
  modal: { background: '#fff', borderRadius: '16px', padding: '24px', width: '85%', maxWidth: '360px' },
  inp: { width: '100%', padding: '10px 12px', fontSize: '15px', border: '1px solid #ddd', borderRadius: '8px', boxSizing: 'border-box', marginBottom: '12px', marginTop: '6px' },
  closeBtn: { width: '100%', padding: '12px', background: '#1565c0', color: '#fff', fontSize: '15px', fontWeight: 'bold', border: 'none', borderRadius: '8px', cursor: 'pointer' },
  tabs: { display: 'flex', borderTop: '1px solid #ddd', background: '#fff', paddingBottom: 'env(safe-area-inset-bottom)', flexShrink: 0, zIndex: 10 },
  tab: { flex: 1, padding: '12px 0', fontSize: '14px', fontWeight: 'bold', border: 'none', background: '#fff', color: '#999', cursor: 'pointer' },
  tabOn: { color: '#1565c0', borderTop: '2px solid #1565c0' },
}
