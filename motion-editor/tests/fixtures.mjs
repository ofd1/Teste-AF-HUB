import { effectBlock, groupBlock, ffxFile } from './ffx-builder.mjs';

export function blurGlowFFX() {
  return ffxFile([
    effectBlock('ADBE Gaussian Blur 2', 'Gaussian Blur', [
      { name: 'Blurriness', type: 'slider', values: [40], keys: [{ frame: 0, v: [40], interp: 2 }, { frame: 15, v: [0], interp: 2 }] },
      { name: 'Blur Dimensions', type: 'popup', values: [1], options: ['Horizontal and Vertical', 'Horizontal', 'Vertical'] },
      { name: 'Repeat Edge Pixels', type: 'checkbox', values: [0] },
    ]),
    effectBlock('ADBE Glo2', 'Glow', [
      { name: 'Glow Based On', type: 'popup', values: [2] },
      { name: 'Glow Threshold', type: 'slider', values: [55] },
      { name: 'Glow Radius', type: 'slider', values: [32] },
      { name: 'Glow Intensity', type: 'slider', values: [1.8] },
    ]),
    effectBlock('ADBE Drop Shadow', 'Drop Shadow', [
      { name: 'Shadow Color', type: 'color', values: [255, 20, 40, 200] },
      { name: 'Opacity', type: 'slider', values: [127.5] },
      { name: 'Direction', type: 'angle', values: [135] },
      { name: 'Distance', type: 'slider', values: [10] },
      { name: 'Softness', type: 'slider', values: [25] },
    ]),
  ]);
}

export function pseudoControlsFFX() {
  return ffxFile([
    effectBlock('Pseudo/MyRig-A1B2', 'Rig de Controle', [
      { name: 'Amount', type: 'slider', values: [12.5] },
      { name: 'Tint Color', type: 'color', values: [255, 255, 120, 10] },
      { name: 'Angle', type: 'angle', values: [45] },
      { name: 'Enable', type: 'checkbox', values: [1] },
      { name: 'Center', type: 'point', values: [960, 540] },
    ]),
  ]);
}

export function animationFFX() {
  return ffxFile([
    groupBlock('ADBE Transform Group', [
      { matchName: 'ADBE Opacity', name: 'Opacity', values: [100], keys: [{ frame: 0, v: [0], interp: 1 }, { frame: 12, v: [100], interp: 1 }] },
      { matchName: 'ADBE Scale', name: 'Scale', type: 'point3d', values: [100, 100, 100], keys: [{ frame: 0, v: [0, 0, 100], interp: 2 }, { frame: 9, v: [120, 120, 100], interp: 2 }, { frame: 15, v: [100, 100, 100], interp: 2 }] },
      { matchName: 'ADBE Rotate Z', name: 'Rotation', values: [0], keys: [{ frame: 0, v: [-90], interp: 2 }, { frame: 15, v: [0], interp: 2 }] },
    ]),
    effectBlock('ADBE Tint', 'Tint', [
      { name: 'Map Black To', type: 'color', values: [255, 30, 0, 60] },
      { name: 'Map White To', type: 'color', values: [255, 255, 220, 120] },
      { name: 'Amount to Tint', type: 'slider', values: [80], expression: 'wiggle(2, 10)' },
    ]),
  ]);
}

/** Presets "de edit" com plugins de terceiros (match names/nomes como aparecem no AE). */
export function pluginsFFX() {
  return ffxFile([
    effectBlock('Twixtor Pro', 'Twixtor Pro', [
      { name: 'Speed %', type: 'slider', values: [100], keys: [{ frame: 0, v: [100], interp: 2 }, { frame: 10, v: [20], interp: 2 }, { frame: 30, v: [100], interp: 2 }] },
      { name: 'Frame Interp', type: 'popup', values: [3], options: ['Nearest', 'Blend', 'Motion Weighted Blend'] },
    ]),
    effectBlock('PEDG', 'Deep Glow', [
      { name: 'Radius', type: 'slider', values: [300] },
      { name: 'Exposure', type: 'slider', values: [1.5] },
      { name: 'Threshold', type: 'slider', values: [0.4] },
    ]),
    effectBlock('S_Shake', 'S_Shake', [
      { name: 'Amplitude', type: 'slider', values: [0.3] },
      { name: 'Frequency', type: 'slider', values: [12] },
    ]),
    // mesma ordem de índices do Twitch real (Videocopilot Twitch-0001 speed, -0002 Amount, -0004 Color…)
    effectBlock('VIDEOCOPILOT Twitch', 'Twitch', [
      { name: 'Speed', type: 'slider', values: [8] },
      { name: 'Amount', type: 'slider', values: [70] },
      { name: 'Colorize', type: 'color', values: [255, 255, 255, 255] },
      { name: 'Color', type: 'checkbox', values: [0] },
      { name: 'Light', type: 'checkbox', values: [0] },
      { name: 'Scale', type: 'checkbox', values: [0] },
      { name: 'Blur', type: 'checkbox', values: [1] },
      { name: 'Slide', type: 'checkbox', values: [1] },
    ]),
    effectBlock('BCC Glow', 'BCC Glow', [{ name: 'Glow Radius', type: 'slider', values: [80] }]),
    effectBlock('RSMB', 'RSMB', [{ name: 'Blur Amount', type: 'slider', values: [0.5] }]),
    effectBlock('CC Radial Blur', 'CC Radial Blur', [{ name: 'Type', type: 'popup', values: [1] }, { name: 'Amount', type: 'slider', values: [40] }]),
    effectBlock('Element 3D', 'Element', [{ name: 'Group 1', type: 'slider', values: [1] }]),
  ]);
}
