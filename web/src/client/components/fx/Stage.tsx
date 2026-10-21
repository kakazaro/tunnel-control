/** Full-screen ambient background: nebula, perspective grid floor, scanlines, grain. */
export function Stage() {
  return (
    <div className="stage" aria-hidden="true">
      <div className="bg-nebula" />
      <div className="grid-floor" />
      <div className="scan-band" />
      <div className="scanlines" />
      <div className="grain" />
    </div>
  );
}
