export interface Point {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
export interface Bounds {
  width: number
  height: number
}

export function clampToBounds(pos: Point, size: Size, bounds: Bounds): Point {
  return {
    x: Math.max(0, Math.min(pos.x, bounds.width - size.width)),
    y: Math.max(0, Math.min(pos.y, bounds.height - size.height)),
  }
}

export function isPointInRect(point: Point, rectPos: Point, size: Size): boolean {
  return (
    point.x >= rectPos.x &&
    point.x <= rectPos.x + size.width &&
    point.y >= rectPos.y &&
    point.y <= rectPos.y + size.height
  )
}
