import React, { useMemo } from 'react'
import { MapContainer, TileLayer, Polyline } from 'react-leaflet'
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

  return (
    <MapContainer center={[47.2184, -1.5536]} zoom={12} style={{ height: '100vh', width: '100%' }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />

      {/* render shapes as polylines */}
      {Array.from(shapeMap.entries()).map(([shapeId, points]) => {
        if (!points.length) return null
        const coords = points.map((point) => [point.lat, point.lon] as [number, number])
        const routeId = shapeToRoute.get(shapeId)
        const color = (routeId && routeColor.get(routeId)) || '#3388ff'
        return <Polyline key={shapeId} positions={coords} pathOptions={{ color, weight: 3, opacity: 0.7 }} />
      })}

      {/* render stops using clustering */}
      <StopClusters stopPoints={stopPoints} />
    </MapContainer>
  )
}

export default LeafletMap
