import React, { useMemo, useState } from 'react'
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import stopsTxt from '../data/stops.txt?raw'
import routesStopsTxt from '../data/routes_stops.txt?raw'
import tripsTxt from '../data/trips.txt?raw'
import routesTxt from '../data/routes.txt?raw'
import parseCSV from '../utils/parseCSV'
import OSMRelation from './OSMRelation'
import osmRelationsRaw from '../data/osm_relations.json'
import StopClusters from './StopClusters'
import type { StopRow, TripRow, RouteRow, StopPoint } from '../types/gtfs'

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
  // - `routes_stops.txt` : ordre des arrêts par ligne (route_id)
  // - `trips.txt` : voyages (associe `trip_id`/`shape_id` aux `route_id`, infos accessibilité)
  // - `routes.txt` : informations de ligne (nom court, couleur, etc.)
  const stops = useMemo(() => parseCSV(stopsTxt) as StopRow[], [])
  const routesStops = useMemo(() => parseCSV(routesStopsTxt) as Array<{ route_id: string; stop_id: string }>, [])
  const trips = useMemo(() => parseCSV(tripsTxt) as TripRow[], [])
  const routes = useMemo(() => parseCSV(routesTxt) as RouteRow[], [])

  // Optionnel: améliore le tracé via OSRM à partir des arrêts ordonnés
  const fetchRouteGeometry = async (positions: [number, number][]) => {
    if (!positions || positions.length < 2) return null
    // OSRM attend "lon,lat"; nos positions sont [lat, lon]
    const coordsString = positions.map(([lat, lon]) => `${lon},${lat}`).join(';')
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${coordsString}?overview=full&geometries=geojson`
      )
      const data = await response.json()
      if (data?.routes?.length) {
        const coordinates: number[][] = data.routes[0].geometry.coordinates
        return coordinates.map((c) => [c[1], c[0]] as [number, number])
      }
    } catch (error) {
      console.error('Erreur récupération itinéraire OSRM', error)
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

  // Mapping route_id -> liste ordonnée des stop_id (ordre tel que dans le fichier)
  const routeToStopIds: Map<string, string[]> = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const row of routesStops) {
      const rid = (row.route_id || '').trim()
      const sid = (row.stop_id || '').trim()
      if (!rid || !sid) continue
      if (!m.has(rid)) m.set(rid, [])
      m.get(rid)!.push(sid)
    }
    return m
  }, [routesStops])

  // Normalise et transforme osmRelationsRaw en Map<routeNameNormalized, relationId>
  const osmRelationMapNormalized: Map<string, number> = useMemo(() => {
    if (!osmRelationsRaw) return new Map()
    if (Array.isArray(osmRelationsRaw)) {
      return new Map(
        osmRelationsRaw.map((e: any) => {
          const rawKey = e.route_name ?? e.route_short_name ?? e.route_id ?? e.key ?? ''
          const key = String(rawKey).trim().toLowerCase()
          return [key, Number(e.relation_id)]
        })
      )
    }
    return new Map(
      Object.entries(osmRelationsRaw).map(([k, v]) => [String(k).trim().toLowerCase(), Number(v)])
    )
  }, [osmRelationsRaw])

  // (Couleur: nous utiliserons `routes.route_color` directement par route)

  // Crée un mapping `route_id` -> nom court
  // - Si `route_short_name` est absent, on essaie `route_long_name`, sinon on retombe sur l'id.
  const routeShortName: Map<string, string> = useMemo(() => {
    const m = new Map<string, string>()
    for (const r of routes) {
      if (r.route_id) m.set(r.route_id, r.route_short_name || r.route_long_name || r.route_id)
    }
    return m
  }, [routes])

  // Associe chaque arrêt aux lignes directement via routes_stops
  const stopToRouteIds: Map<string, string[]> = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const [routeId, stopIds] of routeToStopIds.entries()) {
      for (const sid of stopIds) {
        if (!m.has(sid)) m.set(sid, new Set())
        m.get(sid)!.add(routeId)
      }
    }
    const out = new Map<string, string[]>()
    for (const [sid, set] of m.entries()) out.set(sid, Array.from(set))
    return out
  }, [routeToStopIds])

  const stopToRouteNames: Map<string, string[]> = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const [sid, routeIds] of stopToRouteIds.entries()) {
      m.set(sid, routeIds.map((rid) => routeShortName.get(rid) || rid))
    }
    return m
  }, [stopToRouteIds, routeShortName])

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
  // Polylines: construit pour chaque route en reliant les arrêts de `routes_stops`
  const routePolylines = useMemo(() => {
    const res: Array<{ routeId: string; routeName: string; color: string; coords: [number, number][] }> = []
    const routeMeta = new Map(routes.map((r) => [r.route_id || '', r]))
    for (const [routeId, stopIds] of routeToStopIds.entries()) {
      const coords: [number, number][] = []
      for (const sid of stopIds) {
        const sp = stopPoints.find((s) => s.id === sid)
        if (sp) coords.push([sp.lat, sp.lon])
      }
      if (coords.length < 2) continue
      const r = routeMeta.get(routeId || '')
      const name = (r?.route_short_name || r?.route_long_name || routeId) as string
      let color = (r?.route_color || '') as string
      if (color && !color.startsWith('#')) color = '#' + color
      if (!color) color = '#3388ff'
      res.push({ routeId, routeName: name, color, coords })
    }
    return res
  }, [routeToStopIds, stopPoints, routes])

  // Quand une ligne est sélectionnée, tente d'améliorer son tracé via OSRM
  React.useEffect(() => {
    setHdPolyline(null)
    if (!selectedRoute) return
    if (osmRelationMapNormalized.has(selectedRoute.trim().toLowerCase())) return
    const poly = routePolylines.find((p) => p.routeName === selectedRoute)
    if (!poly) return
    fetchRouteGeometry(poly.coords).then((geo) => {
      if (geo) setHdPolyline(geo)
    })
}, [selectedRoute, routePolylines, osmRelationMapNormalized])

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

      {routePolylines.map(({ routeId, routeName, color, coords }) => {
        // Vérifie si une relation OSM existe pour cette ligne
        // - Utilise le nom de la ligne normalisé pour chercher dans `osmRelationMapNormalized`
        const normalized = (routeName || '').trim().toLowerCase()
        const relationId = normalized ? osmRelationMapNormalized.get(normalized) : undefined
        if (relationId) {
          // Applique ici mêmes filtres que pour les polylines (selectedRoute, routeSearch, wheelchairOnly)
          if (selectedRoute && routeName !== selectedRoute) return null
          if (routeSearch && normalized !== routeSearch.toLowerCase()) return null
          // WheelchairOnly check
          if (wheelchairOnly && routeId) {
            const rw = routeWheelchair.get(routeId)
            if (!rw) {
              const hasAccessibleStopOnRoute = stopPoints.some((s) => {
                const ids = stopToRouteIds.get(s.id) || []
                const stopAccessible = s.wheelchair_boarding === '1'
                return stopAccessible && ids.includes(routeId)
              })
              if (!hasAccessibleStopOnRoute) return null
            }
          }
          return <OSMRelation key={`osm-${routeName}`} relationId={relationId} color={color} />
        }

        // Applique les filtres d'affichage aux polylines de lignes
        // - Filtre par sélection stricte (`selectedRoute`) ou recherche exacte (`routeSearch`).
        // - Mode accessibilité: montre les lignes marquées accessibles OU reliées à un arrêt accessible.
        const matchesRouteNameFilter = (name?: string) => {
          const normalized = (name || '').toLowerCase()
          if (selectedRoute && name !== selectedRoute) return false
          if (routeSearch && normalized !== routeSearch.toLowerCase()) return false
          return true
        }
        if (!matchesRouteNameFilter(routeName)) return null
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
        const positionsToRender = isSelected && hdPolyline ? hdPolyline : coords
        return <ShapePolyline key={routeId} positions={positionsToRender} color={color} routeName={routeName} routeId={routeId} weight={isSelected ? 5 : 3} />
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
