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
const STOP_IMAGES: Record<string, string> = {
  'COMM': 'https://media.ouest-france.fr/v1/pictures/MjAyMTA4OGEyYTQ1MjQ1NTYxMGVkYTllM2E1MDc1M2U5ODZkZTk?width=1260&height=708&focuspoint=50%2C25&cropresize=1&client_id=bpeditorial&sign=9b67ededbd2c17e7ebd1e628395cdd06b304cf76854904e9c3b16a4ba95cd94f',
  'DCAN': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcREs2Toe4kNsMy1s12js0Tabc429hfWxyrjSg&s',
}

export default function StopClusters({ stopPoints, stopRoutesMap, stopRouteIdsMap, routeWheelchair, selectedRoute, routeSearch, wheelchairOnly, stopMetaFilter }: Props) {
  const map = useMap()

  useEffect(() => {
    if (!map) return

    // Crée un groupe de clusters pour regrouper les marqueurs d'arrêts
    // - Optimise l'affichage lorsqu'il y a beaucoup d'arrêts rapprochés
    // - `chunkedLoading` évite les blocages UI en ajoutant progressivement les marqueurs
    const clusterGroup = (L as any).markerClusterGroup({ chunkedLoading: true })

    const matchesStopMeta = (stop: StopPoint) => {
      // Filtre par métadonnées d'arrêt (nom, id, station parente, type)
       // - Le filtre est une recherche de sous-chaîne, insensible à la casse
      if (!stopMetaFilter) return true
      const query = stopMetaFilter.toLowerCase()
      const metaFields = [stop.name, stop.id, stop.parent_station, stop.location_type]
        .filter(Boolean)
        .map((val) => String(val).toLowerCase())
      return metaFields.some((field) => field.includes(query))
    }

    const matchesRouteFilters = (stop: StopPoint) => {
      // Vérifie les filtres liés aux lignes (par nom, recherche, accessibilité)
      // - `routeNames` : noms courts/longs des lignes proches de l'arrêt
      // - `routeIds` : identifiants des lignes proches de l'arrêt
      const routeNames = stopRoutesMap?.get(stop.id) || []
      const routeIds = stopRouteIdsMap?.get(stop.id) || []

      const matchesRouteName = () => {
        if (selectedRoute && !routeNames.includes(selectedRoute)) return false
        if (routeSearch && !routeNames.some((name) => name.toLowerCase() === routeSearch.toLowerCase())) return false
        return true
      }
      if (!matchesRouteName()) return false
      if (wheelchairOnly) {
        // Affiche l'arrêt si lui-même est accessible (wheelchair_boarding === '1')
        // ou si au moins une des lignes associées est accessible.
        // - GTFS `wheelchair_boarding`: 1 = accessible, 2 = non, 0 = inconnu
        const stopAccessible = stop.wheelchair_boarding === '1'
        const routeAccessible = routeIds.some((routeId) => routeWheelchair?.get(routeId))
        if (!stopAccessible && !routeAccessible) return false
      }
      return true
    }

    for (const stop of stopPoints) {
      if (!matchesStopMeta(stop)) continue
      if (!matchesRouteFilters(stop)) continue

      // Crée un marqueur pour l'arrêt et construit la popup d'information
      // - La popup affiche les champs GTFS utiles et la liste des lignes associées
      const marker = L.marker([stop.lat, stop.lon])
      const busList = stopRoutesMap?.get(stop.id)?.join(', ') || ''
      const popupParts: string[] = []
      
      // Insertion de l'image si elle existe pour cet arrêt
      const imageUrl = STOP_IMAGES[stop.parent_station]
      if (imageUrl) {
        popupParts.push(
          `<div style="margin-bottom:8px;">
            <img src="${imageUrl}" alt="${stop.name}" style="width:100%; height:120px; object-fit:cover; border-radius:4px;" />
           </div>`
        )
      }

      popupParts.push(`<div><strong>${stop.name}</strong></div>`)
      popupParts.push(`<div>ID: ${stop.id}</div>`)
      popupParts.push(`<div>Location Type: ${stop.location_type}</div>`)
      popupParts.push(`<div>Parent Station ID: ${stop.parent_station || '—'}</div>`)
      popupParts.push(`<div>Wheelchair Boarding: ${stop.wheelchair_boarding}</div>`)
      // Liste des lignes proches de l'arrêt (calculée via shapes/trips)
      if (busList) popupParts.push(`<div style="margin-top:6px"><strong>Bus(s):</strong><div>${busList}</div></div>`)
      marker.bindPopup(popupParts.join(''))
      clusterGroup.addLayer(marker)
    }

    map.addLayer(clusterGroup)

    return () => {
      try {
        // Nettoyage: retire le groupe de clusters quand les dépendances changent
        // - Évite la superposition des clusters après un changement de filtre
        map.removeLayer(clusterGroup)
      } catch (e) {
        // ignore
      }
    }
  }, [map, stopPoints, stopRoutesMap, stopRouteIdsMap, routeWheelchair, selectedRoute, routeSearch, wheelchairOnly, stopMetaFilter])

  return null
}
