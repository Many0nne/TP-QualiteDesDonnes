export interface StopRow {
  stop_id: string
  stop_name: string
  stop_lat: string
  stop_lon: string
  location_type?: string
  parent_station?: string
  wheelchair_boarding?: string
  [key: string]: string | undefined
}

export interface StopPoint {
  id: string
  name: string
  lat: number
  lon: number
  location_type: string
  parent_station: string
  wheelchair_boarding: string
}

export interface ShapeRow {
  shape_id: string
  shape_pt_lat: string
  shape_pt_lon: string
  shape_pt_sequence?: string
  [key: string]: string | undefined
}

export interface ShapePoint {
  lat: number
  lon: number
  seq: number
}

export interface TripRow {
  shape_id?: string
  route_id?: string
  wheelchair_accessible?: string
  [key: string]: string | undefined
}

export interface RouteRow {
  route_id?: string
  route_short_name?: string
  route_long_name?: string
  route_color?: string
  [key: string]: string | undefined
}

export interface Cluster {
  lat: number
  lon: number
  count: number
  stops: StopPoint[]
}
