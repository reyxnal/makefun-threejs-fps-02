// Keyboard + mouse + pointer lock. Writes the shared input snapshot in S;
// the sim consumes it once per step and the look deltas are then zeroed.
// Nothing here knows about game rules — it only reports what the player did.
import { S } from './state.js';

export function attachInput(canvas, hooks) {
  const input = S.input;

  function key(down) {
    return (e) => {
      if (e.repeat) return;
      S.keys[e.code] = down;
      if (!down) return;
      if (e.code === 'KeyR') input.reload = true;
      if (e.code === 'KeyE') { input.use = true; input.useEdge = true; }
      if (e.code === 'KeyB') input.buyToggle = true;
      if (e.code === 'KeyQ') input.nadeCycle = true;
      if (e.code === 'KeyG') input.nadeThrow = true;
      if (e.code.startsWith('Digit')) input.digit = Number(e.code.slice(5));
      if (e.code === 'Space') { input.jump = true; e.preventDefault(); }
    };
  }
  document.addEventListener('keydown', key(true));
  document.addEventListener('keyup', key(false));
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyE') input.use = false;
  });

  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement === canvas) {
      input.lookDX += e.movementX;
      input.lookDY += e.movementY;
    }
  });

  document.addEventListener('mousedown', (e) => {
    if (document.pointerLockElement !== canvas && !S.shotMode) return;
    if (e.button === 0) input.fire = true;
    if (e.button === 2) input.ads = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.fire = false;
    if (e.button === 2) input.ads = false;
  });
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // Leaving pointer lock mid-match pauses the action behind the resume screen.
  document.addEventListener('pointerlockchange', () => {
    const locked = document.pointerLockElement === canvas;
    if (!locked && S.started && !S.over && !S.shotMode) hooks.onLockLost();
    if (locked) hooks.onLock();
  });

  // Poll continuous movement keys into the snapshot each animation frame.
  // (The sim reads the snapshot; polling here keeps key state out of the sim.)
  function poll() {
    const k = S.keys;
    input.fwd = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 1 : 0);
    input.strafe = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    input.crouch = !!(k.ControlLeft || k.ControlRight || k.KeyC);
    input.quiet = !!k.ShiftLeft || !!k.ShiftRight;
  }

  return {
    lock() { canvas.requestPointerLock(); },
    get locked() { return document.pointerLockElement === canvas; },
    poll,
  };
}
