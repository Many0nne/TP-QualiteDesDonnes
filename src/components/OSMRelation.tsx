import { useEffect, useState } from 'react'
import { Polyline } from 'react-leaflet'

type Props = {
  relationId: number
  color?: string
  weight?: number
  opacity?: number
}

export default function OSMRelation({ relationId, color = '#d62728', weight = 4, opacity = 0.9 }: Props) {
  const [ways, setWays] = useState<Array<Array<[number, number]>>>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!relationId) return
    setWays([])
    setError(null)
    const query = `
      [out:json][timeout:25];
      relation(${relationId});
      way(r);
      out geom;
    `
    fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: query,
    })
      .then((res) => {
        if (!res.ok) throw new Error('Overpass ' + res.status)
        return res.json()
      })
      .then((data) => {
        const elems = data.elements || []
        const parsed = elems
          .filter((e: any) => e.type === 'way' && Array.isArray(e.geometry))
          .map((w: any) => w.geometry.map((g: any) => [g.lat, g.lon] as [number, number]))
        setWays(parsed)
      })
      .catch((e) => setError(String(e)))
  }, [relationId])

  if (!relationId) return null
  if (error) return null

  return (
    <>
      {ways.map((coords, i) => (
        <Polyline key={`${relationId}-${i}`} positions={coords} pathOptions={{ color, weight, opacity }} />
      ))}
    </>
  )
}