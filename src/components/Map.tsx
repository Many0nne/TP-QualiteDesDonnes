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

// Configuration des icônes Leaflet
// - Par défaut, Leaflet essaie de résoudre les URLs d'icônes via un mécanisme interne.
// - Ici, on désactive cette résolution automatique et on fournit manuellement
//   les URLs des images (rétina, standard et ombre) afin d'assurer que Vite
//   serve bien les assets empaquetés.
delete (L.Icon.Default.prototype as any)._getIconUrl

// Configure les icônes de marqueur (rétina, standard, ombre)
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const LeafletMap: React.FC = () => {
  // Chargement et parsing des fichiers GTFS
  // - `stops.txt` : arrêts et métadonnées associées
  // - `shapes.txt` : points de tracé des lignes (polylines)
  // - `trips.txt` : voyages (associe `shape_id` aux `route_id`, infos accessibilité)
  // - `routes.txt` : informations de ligne (nom court, couleur, etc.)
  const stops = useMemo(() => parseCSV(stopsTxt) as StopRow[], [])
  const shapes = useMemo(() => parseCSV(shapesTxt) as ShapeRow[], [])
  const trips = useMemo(() => parseCSV(tripsTxt) as TripRow[], [])
  const routes = useMemo(() => parseCSV(routesTxt) as RouteRow[], [])

  // Fonction pour récupérer la géométrie précise via OSRM
  const fetchRouteGeometry = async (points: { lat: number; lon: number }[]) => {
    if (points.length < 2) return null

    // OSRM attend des coordonnées format "lon,lat" séparées par des ";"
    // On prend un sous-échantillon si trop de points pour éviter les erreurs d'URL trop longue
    // (Pour un vrai projet, on ferait du POST ou du map matching)
    const coordsString = points
      .map(p => `${p.lon},${p.lat}`)
      .join(';')

    try {
      // Appel à l'API publique de démo OSRM (Driving ou Driving-bus si dispo)
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      )
      const data = await response.json()
      
      if (data.routes && data.routes.length > 0) {
        // OSRM renvoie du GeoJSON [lon, lat], Leaflet veut [lat, lon]
        const coordinates = data.routes[0].geometry.coordinates
        return coordinates.map((c: number[]) => [c[1], c[0]] as [number, number])
      }
    } catch (error) {
      console.error("Erreur récupération itinéraire OSRM", error)
    }
    return null
  }

  // Construit une liste d'objets `StopPoint` exploitable par Leaflet
  // - Valide que lat/lon sont bien des nombres
  // - Conserve des champs GTFS utiles à l'info-bulle: type, station parente, accessibilité
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

  // Regroupe les points de tracé par `shape_id`, puis trie par `shape_pt_sequence`.
  // Résultat: pour chaque `shape_id`, on obtient un tableau ordonné de points
  // qui pourra être passé à un `<Polyline />` pour dessiner l'itinéraire.
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

  // Associe chaque `shape_id` à une `route_id` via `trips.txt`
  // - Un `shape_id` peut apparaître plusieurs fois, on garde la première association rencontrée.
  const shapeToRoute: Map<string, string> = useMemo(() => {
    const shapeToRouteMap = new Map<string, string>()
    for (const tripRow of trips) {
      const shapeId = tripRow.shape_id
      const routeId = tripRow.route_id
      if (shapeId && routeId && !shapeToRouteMap.has(shapeId)) shapeToRouteMap.set(shapeId, routeId)
    }
    return shapeToRouteMap
  }, [trips])

  // Crée un mapping `route_id` -> couleur (#RRGGBB)
  // - Certaines agences fournissent `route_color` sans le caractère '#', on l'ajoute.
  // - Utilisé pour styliser les polylines par ligne.
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

  // Crée un mapping `route_id` -> nom court
  // - Si `route_short_name` est absent, on essaie `route_long_name`, sinon on retombe sur l'id.
  const routeShortName: Map<string, string> = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of routes) {
      if (r.route_id) m.set(r.route_id, r.route_short_name || r.route_long_name || r.route_id)
    }
    return m
  }, [routes])

  // Distance Haversine (m) entre deux coordonnées WGS84 (lat/lon)
  // - Utile pour mesurer la distance entre un arrêt et un point isolé de shape.
  const haversine = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const toRad = (v: number) => (v * Math.PI) / 180
    const R = 6371000
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Distance (m) d'un point à un segment géographique AB
  // - Approximation locale: conversion degrés -> mètres via latitude moyenne
  // - Permet d'estimer la proximité d'un arrêt par rapport à une portion de ligne.
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
    const wx = (w.lon - v.lon) * mPerDegLon
    const wy = (w.lat - v.lat) * mPerDegLat
    const l2 = wx * wx + wy * wy
    let t = 0
    if (l2 !== 0) t = Math.max(0, Math.min(1, (px * wx + py * wy) / l2))
    const projx = t * wx
    const projy = t * wy
    const dx = px - projx
    const dy = py - projy
    return Math.sqrt(dx * dx + dy * dy)
  }

  // Associe chaque arrêt aux lignes proches
  // - Pour chaque polyline (shape), on calcule la distance minimale entre l'arrêt et
  //   les segments consécutifs de la polyline; si en-dessous du seuil, on relie l'arrêt à la ligne.
  // - `mapRes` stocke les noms de lignes, `mapResIds` stocke les `route_id`.
  const stopToRouteNames: Map<string, string[]> = useMemo(() => {
    const thresholdMeters = 80
    const mapRes = new Map<string, Set<string>>()
    const mapResIds = new Map<string, Set<string>>()
    for (const [shapeId, points] of Array.from(shapeMap.entries())) {
      const routeId = shapeToRoute.get(shapeId)
      if (!routeId) continue
      const routeName = (routeShortName.get(routeId) || routeId) as string
      for (const stop of stopPoints) {
        let minDistance = Infinity
        for (let i = 0; i < points.length - 1; i++) {
          const pointA = points[i]
          const pointB = points[i + 1]
          const distance = pointToSegmentDistance(
            { lat: stop.lat, lon: stop.lon },
            { lat: pointA.lat, lon: pointA.lon },
            { lat: pointB.lat, lon: pointB.lon }
          )
          if (distance < minDistance) minDistance = distance
        }
        if (points.length === 1) {
          const distance = haversine(stop.lat, stop.lon, points[0].lat, points[0].lon)
          if (distance < minDistance) minDistance = distance
        }
        if (minDistance <= thresholdMeters) {
          if (!mapRes.has(stop.id)) mapRes.set(stop.id, new Set())
          mapRes.get(stop.id)!.add(routeName)
          if (!mapResIds.has(stop.id)) mapResIds.set(stop.id, new Set())
          mapResIds.get(stop.id)!.add(routeId)
        }
      }
    }
    // Conversion des Sets vers des tableaux pour un usage plus simple côté composants
    const final = new Map<string, string[]>()
    for (const [k, s] of mapRes.entries()) final.set(k, Array.from(s))
    ;(final as any).__ids = new Map<string, string[]>()
    for (const [k, s] of mapResIds.entries()) (final as any).__ids.set(k, Array.from(s))
    return final
  }, [shapeMap, shapeToRoute, stopPoints, routeShortName])

  // Version id: mapping `stop_id` -> liste des `route_id` associées
  // - On attache temporairement `__ids` au Map précédent pour éviter de maintenir deux structures.
  const stopToRouteIds: Map<string, string[]> = useMemo(() => {
    return ((stopToRouteNames as any).__ids as Map<string, string[]>) || new Map()
  }, [stopToRouteNames])

  // Mapping `route_id` -> accessibilité, déduit depuis `trips.txt`
  // - `wheelchair_accessible` dans GTFS trips: 1 = accessible, 2 = non-accessible, 0 = inconnu
  // - Ici on marque `true` si une occurrence est 1, sinon `false` par défaut.
  const routeWheelchair: Map<string, boolean> = useMemo(() => {
    // Simplification: ne stocke que les routes explicitement accessibles (val === '1')
    // Les absences dans le Map seront interprétées comme non accessibles.
    const accessible = new Map<string, boolean>()
    for (const trip of trips) {
      const routeId = trip.route_id
      if (!routeId) continue
      const value = (trip.wheelchair_accessible || '').trim()
      if (value === '1') accessible.set(routeId, true)
    }
    return accessible
  }, [trips])

  const [selectedRoute, setSelectedRoute] = useState<string>('')
  const [routeSearch, setRouteSearch] = useState<string>('')
  const [wheelchairOnly, setWheelchairOnly] = useState<boolean>(false)
  const [stopMetaFilter, setStopMetaFilter] = useState<string>('')
  const [hdPolyline, setHdPolyline] = useState<[number, number][] | null>(null)

  // Effet pour charger la géométrie quand une ligne est sélectionnée
  React.useEffect(() => {
    setHdPolyline(null) // Reset quand on change de ligne
    if (!selectedRoute) return

    // Trouver le shapeId correspondant à la route sélectionnée
    // (Simplification : on prend le premier shapeId qui correspond à cette route)
    // Note: Dans un cas réel complexe, une route peut avoir plusieurs shapes (aller/retour/variantes)
    let targetShapeId = ''
    for (const [sId, rId] of shapeToRoute.entries()) {
      const name = routeShortName.get(rId)
      if (name === selectedRoute) {
        targetShapeId = sId
        break
      }
    }

    if (targetShapeId) {
      const points = shapeMap.get(targetShapeId)
      if (points) {
        // On appelle OSRM avec les points de ce shape
        fetchRouteGeometry(points).then(geo => {
          if (geo) setHdPolyline(geo)
        })
      }
    }
  }, [selectedRoute, shapeToRoute, routeShortName, shapeMap])

  // Liste triée des noms de lignes disponibles (pour le sélecteur)
  // - On déduplique via Set, puis on ordonne alphabétiquement.
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
            {allRouteNames.filter((n) => (routeSearch ? n.toLowerCase() === routeSearch.toLowerCase() : true)).map((name) => (
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
        // Applique les filtres d'affichage aux polylines de lignes
        // - Filtre par sélection stricte (`selectedRoute`) ou recherche exacte (`routeSearch`).
        // - Mode accessibilité: montre les lignes marquées accessibles OU reliées à un arrêt accessible.
        const matchesRouteNameFilter = (name?: string) => {
          const normalized = (name || '').toLowerCase()
          if (selectedRoute && name !== selectedRoute) return false
          if (routeSearch && normalized !== routeSearch.toLowerCase()) return false
          return true
        }
        if (!matchesRouteNameFilter(typeof routeName === 'string' ? routeName : undefined)) return null
        if (wheelchairOnly && routeId) {
          const rw = routeWheelchair.get(routeId)
          if (!rw) {
            // Si la ligne n'est pas marquée accessible, on l'affiche quand même
            // si au moins un arrêt accessible est associé à cette ligne.
            const hasAccessibleStopOnRoute = stopPoints.some((s) => {
              const ids = stopToRouteIds.get(s.id) || []
              const stopAccessible = s.wheelchair_boarding === '1'
              return stopAccessible && ids.includes(routeId)
            })
            if (!hasAccessibleStopOnRoute) return null
          }
        }
        const ShapePolyline: React.FC<{
          positions: [number, number][]
          color: string
          routeName?: string
          routeId?: string
          weight?: number
        }> = ({ positions, color, routeName, routeId, weight = 3 }) => {
          const map = useMap()
          const onClick = (e: any) => {
            // Interaction: au clic sur une polyline, affiche une popup
            // contenant le nom ou l'identifiant de la ligne.
            const title = routeName || routeId || 'Ligne'
            L.popup().setLatLng(e.latlng).setContent(`<div>ligne:<strong>${title}</strong></div>`).openOn(map)
          }
          return <Polyline positions={positions} pathOptions={{ color, weight, opacity: 0.7 }} eventHandlers={{ click: onClick }} />
        }

        const isSelected = selectedRoute && routeName === selectedRoute
        const positionsToRender = (isSelected && hdPolyline) ? hdPolyline : coords

        return <ShapePolyline key={shapeId} positions={positionsToRender} color={color} routeName={routeName} routeId={routeId} weight={isSelected ? 5 : 3} />
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
      {/* Legend: fixed bottom-left showing an example marker and line */}
      <div style={{ position: 'absolute', left: 10, bottom: 10, zIndex: 400, background: 'white', padding: 8, borderRadius: 6, boxShadow: '0 1px 4px rgba(0,0,0,0.2)', fontSize: 12 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>Légende</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <img src={markerIcon} alt="marker" style={{ width: 20, height: 30 }} />
          <div>Arrêt</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 40, height: 6, background: '#3388ff', borderRadius: 3 }} />
          <div>Ligne de bus / Tram</div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Accessibilité (wheelchair_boarding)</div>
          <div><strong>0</strong> — Pas d'information</div>
          <div><strong>1</strong> — Certains véhicules à cet arrêt peuvent embarquer un usager en fauteuil roulant.</div>
          <div><strong>2</strong> — L'embarquement en fauteuil roulant n'est pas possible à cet arrêt.</div>
        </div>
      </div>
    </MapContainer>
  )
}

export default LeafletMap
