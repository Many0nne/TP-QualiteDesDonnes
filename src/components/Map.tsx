import React, { useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import stopsTxt from '../data/stops.txt?raw'
import shapesTxt from '../data/shapes.txt?raw'
import tripsTxt from '../data/trips.txt?raw'
import routesTxt from '../data/routes.txt?raw'
import parseCSV from '../utils/parseCSV'
import StopClusters from './StopClusters'
import type { StopRow, ShapeRow, ShapePoint, TripRow, RouteRow, StopPoint } from '../types/gtfs'

delete (L.Icon.Default.prototype as any)._getIconUrl

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

// Parser CSV basique compatible GTFS
// - gère les champs entre guillemets et les guillemets échappés ""
// - ne cherche pas à être un parser complet mais est suffisant pour des fichiers GTFS fournis en local
// parseCSV extrait dans src/utils/parseCSV.ts

const LeafletMap: React.FC = () => {
  // parse files
  const stops = useMemo(() => parseCSV(stopsTxt) as StopRow[], [])
  const shapes = useMemo(() => parseCSV(shapesTxt) as ShapeRow[], [])
  const trips = useMemo(() => parseCSV(tripsTxt) as TripRow[], [])
  const routes = useMemo(() => parseCSV(routesTxt) as RouteRow[], [])

  // build stops coordinates and keep extra GTFS stop fields for popup
  // construire la liste des arrêts avec leurs coordonnées + champs GTFS utiles pour la popup
  const stopPoints = useMemo<StopPoint[]>(() => {
    return (
      stops
        .map((stopRow) => {
          const lat = parseFloat(stopRow.stop_lat)
          const lon = parseFloat(stopRow.stop_lon)
          if (Number.isFinite(lat) && Number.isFinite(lon)) {
            return {
              id: stopRow.stop_id,
              name: stopRow.stop_name,
              lat,
              lon,
              location_type: stopRow.location_type ?? '',
              parent_station: stopRow.parent_station ?? '',
              wheelchair_boarding: stopRow.wheelchair_boarding ?? '',
            }
          }
          return null
        })
        .filter(Boolean) as StopPoint[]
    )
  }, [stops])

  // Groupement des points de tracé par `shape_id` et tri par `shape_pt_sequence`.
  // Ceci permet de reconstituer les polylines des itinéraires.
  const shapeMap: Map<string, ShapePoint[]> = useMemo(() => {
    const shapeGroups = new Map<string, ShapePoint[]>()
    for (const shapeRow of shapes) {
      const shapeId = shapeRow.shape_id
      const lat = parseFloat(shapeRow.shape_pt_lat)
      const lon = parseFloat(shapeRow.shape_pt_lon)
      const seq = parseInt(shapeRow.shape_pt_sequence || '0', 10)
      if (!shapeGroups.has(shapeId)) shapeGroups.set(shapeId, [])
      shapeGroups.get(shapeId)!.push({ lat, lon, seq })
    }
    for (const pointsArray of shapeGroups.values()) {
      pointsArray.sort((a, b) => a.seq - b.seq)
    }
    return shapeGroups
  }, [shapes])

  // Associer chaque shape_id à une route (via trips.txt). On prend la première route trouvée.
  const shapeToRoute: Map<string, string> = useMemo(() => {
    const shapeToRouteMap = new Map<string, string>()
    for (const tripRow of trips) {
      const shapeId = tripRow.shape_id
      const routeId = tripRow.route_id
      if (shapeId && routeId && !shapeToRouteMap.has(shapeId)) shapeToRouteMap.set(shapeId, routeId)
    }
    return shapeToRouteMap
  }, [trips])

  // Construire un mapping route_id -> couleur (format #RRGGBB). Utile pour colorer les polylines.
  const routeColor: Map<string, string> = useMemo(() => {
    const routeColorMap = new Map<string, string>()
    for (const routeRow of routes) {
      const id = routeRow.route_id
      let color = routeRow.route_color || ''
      if (color && !color.startsWith('#')) color = '#' + color
      if (id) routeColorMap.set(id, color)
    }
    return routeColorMap
  }, [routes])

  const routeShortName: Map<string, string> = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of routes) {
      if (r.route_id) m.set(r.route_id, r.route_short_name || r.route_long_name || r.route_id)
    }
    return m
  }, [routes])

  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const toRad = (v: number) => (v * Math.PI) / 180
    const R = 6371000
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const pointToSegmentDistance = (
    p: { lat: number; lon: number },
    v: { lat: number; lon: number },
    w: { lat: number; lon: number }
  ) => {
    const meanLat = (v.lat + w.lat + p.lat) / 3
    const mPerDegLat = 111320
    const mPerDegLon = Math.cos((meanLat * Math.PI) / 180) * 111320
    const px = (p.lon - v.lon) * mPerDegLon
    const py = (p.lat - v.lat) * mPerDegLat
    const vx = 0
    const vy = 0
    const wx = (w.lon - v.lon) * mPerDegLon
    const wy = (w.lat - v.lat) * mPerDegLat
    const l2 = wx * wx + wy * wy
    let t = 0
    if (l2 !== 0) t = Math.max(0, Math.min(1, (px * wx + py * wy) / l2))
    const projx = vx + t * wx
    const projy = vy + t * wy
    const dx = px - projx
    const dy = py - projy
    return Math.sqrt(dx * dx + dy * dy)
  }

  const stopToRouteNames: Map<string, string[]> = useMemo(() => {
    const thresholdMeters = 80
    const mapRes = new Map<string, Set<string>>()
    const mapResIds = new Map<string, Set<string>>()
    for (const [shapeId, points] of Array.from(shapeMap.entries())) {
      const routeId = shapeToRoute.get(shapeId)
      if (!routeId) continue
      const routeName = (routeShortName.get(routeId) || routeId) as string
      for (const stop of stopPoints) {
        let minDist = Infinity
        for (let i = 0; i < points.length - 1; i++) {
          const a = points[i]
          const b = points[i + 1]
          const d = pointToSegmentDistance({ lat: stop.lat, lon: stop.lon }, { lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon })
          if (d < minDist) minDist = d
        }
        if (points.length === 1) {
          const d = haversine(stop.lat, stop.lon, points[0].lat, points[0].lon)
          if (d < minDist) minDist = d
        }
        if (minDist <= thresholdMeters) {
          if (!mapRes.has(stop.id)) mapRes.set(stop.id, new Set())
          mapRes.get(stop.id)!.add(routeName)
          if (!mapResIds.has(stop.id)) mapResIds.set(stop.id, new Set())
          mapResIds.get(stop.id)!.add(routeId)
        }
      }
    }
    const final = new Map<string, string[]>()
    for (const [k, s] of mapRes.entries()) final.set(k, Array.from(s))
    ;(final as any).__ids = new Map<string, string[]>()
    for (const [k, s] of mapResIds.entries()) (final as any).__ids.set(k, Array.from(s))
    return final
  }, [shapeMap, shapeToRoute, stopPoints, routeShortName])

  const stopToRouteIds: Map<string, string[]> = useMemo(() => {
    return ((stopToRouteNames as any).__ids as Map<string, string[]>) || new Map()
  }, [stopToRouteNames])

  const routeWheelchair: Map<string, boolean> = useMemo(() => {
    const m = new Map<string, boolean>()
    for (const t of trips) {
      const rid = t.route_id
      if (!rid) continue
      const val = (t.wheelchair_accessible || '').trim()
      if (val === '1') m.set(rid, true)
      else if (!m.has(rid)) m.set(rid, false)
    }
    return m
  }, [trips])

  const [selectedRoute, setSelectedRoute] = useState<string>('')
  const [routeSearch, setRouteSearch] = useState<string>('')
  const [wheelchairOnly, setWheelchairOnly] = useState<boolean>(false)
  const [stopMetaFilter, setStopMetaFilter] = useState<string>('')

  const allRouteNames = useMemo(() => {
    const setNames = new Set<string>()
    for (const [_, name] of routeShortName.entries()) setNames.add(name)
    return Array.from(setNames).sort((a, b) => a.localeCompare(b))
  }, [routeShortName])

  return (
    <MapContainer center={[47.2184, -1.5536]} zoom={12} style={{ height: '100vh', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />

  <div style={{ position: 'absolute', right: 10, top: 10, zIndex: 400, background: 'white', padding: 8, borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)', maxWidth: 320 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Filtres</div>
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 12 }}>Rechercher une ligne</label>
          <input value={routeSearch} onChange={(e) => setRouteSearch(e.target.value)} placeholder="Rechercher..." style={{ width: '100%' }} />
        </div>
        <div style={{ marginBottom: 6 }}>
          <label style={{ display: 'block', fontSize: 12 }}>Sélectionner une ligne</label>
          <select value={selectedRoute} onChange={(e) => setSelectedRoute(e.target.value)} style={{ width: '100%' }}>
            <option value="">— Toutes les lignes —</option>
            {allRouteNames.filter((n) => n.toLowerCase().includes(routeSearch.toLowerCase())).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <input id="wheelchairOnly" type="checkbox" checked={wheelchairOnly} onChange={(e) => setWheelchairOnly(e.target.checked)} />
          <label htmlFor="wheelchairOnly">Afficher seulement accessible fauteuil</label>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 12 }}>Filtrer arrêts (nom/id/meta)</label>
          <input value={stopMetaFilter} onChange={(e) => setStopMetaFilter(e.target.value)} placeholder="Ex: station, parent, id..." style={{ width: '100%' }} />
        </div>
      </div>

      {Array.from(shapeMap.entries()).map(([shapeId, points]) => {
        if (!points.length) return null
        const coords = points.map((point) => [point.lat, point.lon] as [number, number])
        const routeId = shapeToRoute.get(shapeId)
        const color = (routeId && routeColor.get(routeId)) || '#3388ff'
        const routeNameRaw = routeId ? routeShortName.get(routeId) : routeId
        const routeName = typeof routeNameRaw === 'string' ? routeNameRaw.trim() : routeNameRaw
        // apply filters for polylines
        if (selectedRoute && typeof routeName === 'string' && routeName !== selectedRoute) return null
        if (routeSearch && typeof routeName === 'string' && !routeName.toLowerCase().includes(routeSearch.toLowerCase())) return null
        if (wheelchairOnly && routeId) {
          const rw = routeWheelchair.get(routeId)
          if (!rw) return null
        }
        const ShapePolyline: React.FC<{
          positions: [number, number][]
          color: string
          routeName?: string
          routeId?: string
        }> = ({ positions, color, routeName, routeId }) => {
          const map = useMap()
          const onClick = (e: any) => {
            const title = routeName || routeId || 'Ligne'
            L.popup().setLatLng(e.latlng).setContent(`<div>ligne:<strong>${title}</strong></div>`).openOn(map)
          }
          return <Polyline positions={positions} pathOptions={{ color, weight: 3, opacity: 0.7 }} eventHandlers={{ click: onClick }} />
        }

        return <ShapePolyline key={shapeId} positions={coords} color={color} routeName={routeName} routeId={routeId} />
      })}

  <StopClusters
        stopPoints={stopPoints}
        stopRoutesMap={stopToRouteNames}
        stopRouteIdsMap={stopToRouteIds}
        routeWheelchair={routeWheelchair}
        selectedRoute={selectedRoute}
        routeSearch={routeSearch}
        wheelchairOnly={wheelchairOnly}
        stopMetaFilter={stopMetaFilter}
      />
    </MapContainer>
  )
}

export default LeafletMap
