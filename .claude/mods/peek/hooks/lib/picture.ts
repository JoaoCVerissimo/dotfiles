// The numbers of the images a draft names, in the order they stand: 1 and 2
// for `[Image #1] and [Image #2]`.
export function numbersIn(draft: string): number[] {
  const found: number[] = []
  for (const mark of draft.matchAll(/\[Image #(\d+)\]/g)) {
    const number = Number(mark[1])
    if (!found.includes(number)) {
      found.push(number)
    }
  }

  return found
}

// The folder Claude Code names a project by: its path with every character
// that is not a letter or a digit turned into a dash.
export function projectFolder(path: string): string {
  return path.replace(/[^a-zA-Z0-9]/g, '-')
}

// A picture's size in pixels, read from what `sips -g pixelWidth -g
// pixelHeight` prints.
export function sizeOf(printed: string): { width: number; height: number } | null {
  const width = Number(/pixelWidth:\s*(\d+)/.exec(printed)?.[1])
  const height = Number(/pixelHeight:\s*(\d+)/.exec(printed)?.[1])

  return width > 0 && height > 0 ? { width, height } : null
}

// How many pixels wide to shrink a picture so its preview fits a box of
// `columns` by `rows` cells. A cell shows two pixels, one above the other.
export function fitWidth(size: { width: number; height: number }, columns: number, rows: number): number {
  const scale = Math.min(columns / size.width, (rows * 2) / size.height)

  return Math.max(1, Math.min(columns, Math.round(size.width * scale)))
}

// A BMP picture as half-block cells for a Raster: each cell is the upper
// half block, its color the pixel above and its background the pixel below.
export function rasterOf(bytes: Uint8Array, maxColumns: number, maxRows: number): { columns: number; rows: number; cells: string } | null {
  if (bytes.length < 54 || bytes[0] !== 0x42 || bytes[1] !== 0x4d) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const offset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const rawHeight = view.getInt32(22, true)
  const bits = view.getUint16(28, true)
  if ((bits !== 24 && bits !== 32) || width <= 0 || rawHeight === 0) {
    return null
  }
  const height = Math.abs(rawHeight)
  const stride = Math.floor((bits * width + 31) / 32) * 4
  if (offset + stride * height > bytes.length) {
    return null
  }
  const pixel = (x: number, y: number): number => {
    const row = rawHeight < 0 ? y : height - 1 - y
    const at = offset + row * stride + x * (bits / 8)

    return ((bytes[at + 2] ?? 0) << 16) | ((bytes[at + 1] ?? 0) << 8) | (bytes[at] ?? 0)
  }
  const columns = Math.min(width, maxColumns)
  const rows = Math.min(Math.ceil(height / 2), maxRows)
  if (columns < 1 || rows < 1) {
    return null
  }
  const cells = new Uint32Array(columns * rows * 3)
  let at = 0
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < columns; x += 1) {
      cells[at] = 0x2580
      cells[at + 1] = pixel(x, y * 2)
      // a picture with an odd number of rows ends on half a cell: its last row twice
      cells[at + 2] = pixel(x, Math.min(y * 2 + 1, height - 1))
      at += 3
    }
  }

  return { columns, rows, cells: new Uint8Array(cells.buffer).toBase64() }
}
