// Vite turns "file?url" imports into the asset's URL.
declare module "*?url" {
  const url: string;
  export default url;
}
