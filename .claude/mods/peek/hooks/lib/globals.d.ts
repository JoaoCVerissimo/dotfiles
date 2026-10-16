// Base64 on typed arrays, which the hooks environment has and the ES2023 library does not declare.
interface Uint8Array {
  toBase64(): string
}

interface Uint8ArrayConstructor {
  fromBase64(base64: string): Uint8Array
}
