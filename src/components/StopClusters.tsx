import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import type { StopPoint } from '../types/gtfs'

type Props = {
  stopPoints: StopPoint[]
  stopRoutesMap?: Map<string, string[]>
  stopRouteIdsMap?: Map<string, string[]>
  routeWheelchair?: Map<string, boolean>
  selectedRoute?: string
  routeSearch?: string
  wheelchairOnly?: boolean
  stopMetaFilter?: string
}

export default function StopClusters({ stopPoints, stopRoutesMap, stopRouteIdsMap, routeWheelchair, selectedRoute, routeSearch, wheelchairOnly, stopMetaFilter }: Props) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    const clusterGroup = (L as any).markerClusterGroup({ chunkedLoading: true })

    const matchesStopMeta = (s: StopPoint) => {
      if (!stopMetaFilter) return true
      const q = stopMetaFilter.toLowerCase()
      return (
        (s.name && s.name.toLowerCase().includes(q)) ||
        (s.id && s.id.toLowerCase().includes(q)) ||
        (s.parent_station && s.parent_station.toLowerCase().includes(q)) ||
        (s.location_type && s.location_type.toLowerCase().includes(q))
      )
    }

    const matchesRouteFilters = (s: StopPoint) => {
      const names = stopRoutesMap?.get(s.id) || []
      const ids = stopRouteIdsMap?.get(s.id) || []

      if (selectedRoute) {
        if (!names.some((n) => n === selectedRoute)) return false
      }
      if (routeSearch) {
        const q = routeSearch.toLowerCase()
        if (!names.some((n) => n.toLowerCase().includes(q))) return false
      }
      if (wheelchairOnly) {
        const stopAccessible = s.wheelchair_boarding === '1'
        const routeAccessible = ids.some((rid) => routeWheelchair?.get(rid))
        if (!stopAccessible && !routeAccessible) return false
      }
      return true
    }

    for (const s of stopPoints) {
      if (!matchesStopMeta(s)) continue
      if (!matchesRouteFilters(s)) continue

      const m = L.marker([s.lat, s.lon])
      const busList = stopRoutesMap?.get(s.id)?.join(', ') || ''
      const popupParts: string[] = []
      popupParts.push(`<div><strong>${s.name}</strong></div>`)
      popupParts.push(`<div>ID: ${s.id}</div>`)
      popupParts.push(`<div>Location Type: ${s.location_type}</div>`)
      popupParts.push(`<div>Parent Station ID: ${s.parent_station || '—'}</div>`)
      popupParts.push(`<div>Wheelchair Boarding: ${s.wheelchair_boarding}</div>`)
      if (busList) popupParts.push(`<div style="margin-top:6px"><strong>Bus(s):</strong><div>${busList}</div></div>`)
      m.bindPopup(popupParts.join(''))
      clusterGroup.addLayer(m)
    }

    map.addLayer(clusterGroup)

    return () => {
      try {
        map.removeLayer(clusterGroup)
      } catch (e) {
        // ignore
      }
    }
  }, [map, stopPoints, stopRoutesMap, stopRouteIdsMap, routeWheelchair, selectedRoute, routeSearch, wheelchairOnly, stopMetaFilter])

  return null
}
