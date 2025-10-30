import { useMemo, useState, useEffect } from 'react'
import { Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import type { StopPoint, Cluster } from '../types/gtfs'

type Props = {
  stopPoints: StopPoint[]
  gridSizePx?: number
}

export default function StopClusters({ stopPoints, gridSizePx = 60 }: Props) {
  const map = useMap()
  const [clusters, setClusters] = useState<Cluster[]>([])

  const computeClusters = useMemo(() => {
    return () => {
      try {
        const grid = new Map<string, { sumLat: number; sumLon: number; count: number; stops: StopPoint[] }>()

        for (const stop of stopPoints) {
          const latlng = L.latLng(stop.lat, stop.lon)
          const point = map.latLngToLayerPoint(latlng)
          const keyX = Math.floor(point.x / gridSizePx)
          const keyY = Math.floor(point.y / gridSizePx)
          const key = `${keyX}:${keyY}`
          if (!grid.has(key)) grid.set(key, { sumLat: 0, sumLon: 0, count: 0, stops: [] })
          const cell = grid.get(key)!
          cell.sumLat += stop.lat
          cell.sumLon += stop.lon
          cell.count += 1
          cell.stops.push(stop)
        }

        const newClusters: Cluster[] = []
        for (const [, cell] of grid.entries()) {
          const centroidLat = cell.sumLat / cell.count
          const centroidLon = cell.sumLon / cell.count
          newClusters.push({ lat: centroidLat, lon: centroidLon, count: cell.count, stops: cell.stops })
        }
        setClusters(newClusters)
      } catch (err) {
        // map may not be ready yet
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, stopPoints, gridSizePx])

  useEffect(() => {
    computeClusters()
    const onMoveEnd = () => computeClusters()
    map.on('moveend', onMoveEnd)
    map.on('zoomend', onMoveEnd)
    return () => {
      map.off('moveend', onMoveEnd)
      map.off('zoomend', onMoveEnd)
    }
  }, [computeClusters, map])

  return (
    <>
      {clusters.map((cluster, idx) => {
        const position = [cluster.lat, cluster.lon] as [number, number]
        if (cluster.count === 1) {
          const s = cluster.stops[0]
          return (
            <Marker key={s.id} position={[s.lat, s.lon]}>
              <Popup>
                <div><strong>{s.name}</strong></div>
                <div>ID: {s.id}</div>
                <div>Location Type: {s.location_type}</div>
                <div>Parent Station ID: {s.parent_station || '—'}</div>
                <div>Wheelchair Boarding: {s.wheelchair_boarding}</div>
              </Popup>
            </Marker>
          )
        }

        const html = `<div style="display:flex;align-items:center;justify-content:center;border-radius:50%;background:#2A93EE;color:white;width:32px;height:32px;border:3px solid white;box-shadow:0 0 0 2px rgba(0,0,0,0.1)">${cluster.count}</div>`
        const divIcon = L.divIcon({ html, className: 'custom-cluster-icon', iconSize: [32, 32] })

        const onClusterClick = () => {
          const latlngs = cluster.stops.map((s) => [s.lat, s.lon] as [number, number])
          try {
            const bounds = L.latLngBounds(latlngs)
            map.fitBounds(bounds.pad(1.2))
          } catch (e) {
            map.setView(position, map.getZoom() + 2)
          }
        }

        return (
          <Marker key={`cluster-${idx}`} position={position} icon={divIcon} eventHandlers={{ click: onClusterClick }}>
            <Popup>
              <div><strong>Cluster — {cluster.count} arrêts</strong></div>
              <div>Exemples :</div>
              <ul style={{ maxHeight: 120, overflow: 'auto', paddingLeft: 16 }}>
                {cluster.stops.slice(0, 10).map((s) => (
                  <li key={s.id}>{s.id} — {s.name}</li>
                ))}
              </ul>
              <div style={{ opacity: 0.85, fontSize: 12 }}>(Cliquez sur le cluster pour zoomer sur la zone)</div>
            </Popup>
          </Marker>
        )
      })}
    </>
  )
}
