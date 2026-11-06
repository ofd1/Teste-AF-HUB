// Regras de importação para os plugins do inventário do usuário (scanner .aex) que não tinham equivalente.
// Cada linha: [regex do match name/nome, efeito, modo (1 = primeira opção), params extras opcionais].
// Usadas no fim de IMPORT_RULES: só valem quando nenhuma regra mais específica reconheceu o plugin.
const W = 'pkWipe', T = 'pkTexture', C = 'pkColor', Y = 'pkStylize', D = 'pkDistort', L = 'pkLight';
const ROWS = [
  // ---- Sapphire: transições
  [/S_WipeBlobs|Blobs Wipe/i, W, 14], [/S_WipeBubble|S_DissolveBubble/i, W, 15], [/S_WipeCells/i, W, 15], [/S_WipeChecker|Checker Wipe/i, W, 7], [/S_WipeCircle/i, W, 3],
  [/S_WipeClock|Clock_Wipe|Radial Wipe/i, W, 2], [/S_WipeClouds/i, W, 14], [/S_WipeDiffuse|S_DissolveDiffuse/i, W, 16], [/S_WipeDots/i, W, 13], [/S_WipeDoubleWedge/i, W, 10],
  [/S_WipeFlux/i, W, 26], [/S_WipeFourWedges/i, W, 11], [/S_WipeMoire/i, W, 19], [/S_WipePlasma/i, W, 18], [/S_WipePointalize/i, W, 21], [/S_WipeRectangle|Rectangular Wipe/i, W, 4],
  [/S_WipeRings|Rings Wipe/i, W, 12], [/S_WipeStar/i, W, 5], [/S_WipeStripes|Multi Stripe Wipe/i, W, 8], [/S_WipeWeave/i, W, 20], [/S_WipeWedge/i, W, 9],
  [/S_DissolveLuma/i, W, 17], [/S_DissolveStatic|S_DissolveSpeckle/i, W, 24], [/S_DissolveDigitalDamage/i, W, 21, { distort: 1 }], [/S_DissolveDistort|S_DissolvePuddle|Ripple Dissolve/i, W, 14, { distort: 2, soft: 20 }],
  [/S_DissolveVortex/i, W, 25, { distort: 1.5 }], [/S_DissolveGlare|S_DissolveGlint(Rainbow)?|S_DissolveZap|Light Wipe/i, W, 14, { glow: 2, soft: 15 }], [/S_DissolveDefocus|S_DissolveFilm|PI Dissolve|Optical ?Dissolve|BCC_OPTICALDISSOLVE/i, W, 17, { edgeBlur: 60, soft: 40 }],
  [/S_DissolveAutoPaint/i, W, 16, { soft: 25 }], [/S_Dissolve\b|Composite Dissolve|Cross Melt|Tritone Dissolve|Curl Dissolve/i, W, 16, { soft: 50 }], [/S_CutToDissolve/i, W, 16, { soft: 50 }],
  [/S_Transition|BCC_Transition|LensTransition|Lens Distortion Wipe/i, W, 1, { soft: 20, distort: 1 }], [/S_ParallaxStripsTransition|S_StripSlideTransition/i, D, 6],
  [/Grid Wipe/i, W, 22], [/Criss-Cross Wipe/i, W, 7], [/Linear Wipe|Universe_Transitions_Linear_Wipe|Soft_Edge_Wipe/i, W, 1, { soft: 15 }], [/Ribbon Wipe|Multi Stretch Wipe/i, W, 23],
  [/Universe_Transitions_Shape_Wipe/i, W, 5], [/Universe_Transitions_Blinds/i, D, 26], [/Universe_Transitions_Color_Stripe|Universe_Transitions_Channel_Surf/i, D, 6],
  [/Universe_Transitions_Clock_Wipe/i, W, 2], [/Universe_Transitions_(Inside_)?Cube|Universe_Transitions_Rubics_Cube|BCC3Cube|Sphere Transition/i, D, 15],
  [/Universe_Transitions_(Carousel_Transition|Stylize_Carousel)|Universe_Stylize_Carousel/i, D, 25], [/Universe_Transitions_Fold|Universe_Transitions_Unfold/i, D, 16],
  [/Universe_Transitions_Slide|Swish ?Pan/i, D, 18], [/Universe_Transitions_Dolly_Fade|Universe_Transitions_HalfLight/i, D, 20], [/Universe_Transitions_(Knoll_Light_Transition|Spectralicious_Transition)/i, W, 14, { glow: 3, soft: 20 }],
  [/Universe_Transitions_Turbulence_Transition/i, W, 26, { distort: 2, soft: 20 }], [/Crash Zoom/i, D, 19], [/Cross ?Zoom/i, D, 20], [/BCC3Page Turn|BCC Curl/i, D, 23], [/BCC3Fast Flipper|S_CardFlip/i, D, 14],
  [/Universe_CrumplePop_ShrinkRay/i, D, 24], [/BCC3Sphere\b/i, D, 13], [/BCC3Cylinder/i, D, 12],
  // ---- Sapphire: texturas e geradores
  [/S_TexturePlasma|S_PsykoBlobs/i, T, 1], [/S_TextureCells/i, T, 2], [/S_TextureMoire/i, T, 3], [/S_TextureWeave|BCC3Weave/i, T, 4], [/S_TextureSpots/i, T, 5], [/S_TextureLoops|S_PsykoStripes/i, T, 6],
  [/S_TextureFlux/i, T, 7], [/S_TextureNeurons|BCC Organic Strands/i, T, 8], [/S_TextureChromaSpiral/i, T, 9], [/S_TextureFolded/i, T, 10], [/S_TextureMicro/i, T, 11], [/S_TextureNoiseEmboss/i, T, 12],
  [/S_Grid\b|BCC_NET/i, T, 13], [/S_Grunge|BCC_TEXTURES/i, T, 14], [/S_NightSky|BCC3Stars/i, T, 15], [/S_Gradient\b|Gradient_Ramp/i, T, 16], [/S_GradientRadial/i, T, 17], [/S_GradientMulti/i, T, 18],
  [/Soft_Gradient_Background/i, T, 19], [/Fractal_Background/i, T, 20], [/Generators_Spectralicious/i, T, 21], [/BCC3Clouds/i, T, 22], [/BCC3Veined Marble/i, T, 23], [/BCC3Granite/i, T, 24],
  [/BCC3Rock|BCC3Reptilian/i, T, 25], [/BCC3Wooden Planks/i, T, 26], [/BCC3Steel Plate/i, T, 27], [/BCC3Brick/i, T, 28], [/S_Luna/i, T, 29], [/S_Caustics|BCC3Caustics/i, T, 30, { blend: 4, opacity: 50 }],
  [/BCC4Turbulence/i, T, 7, { blend: 5, opacity: 60 }], [/Universe_Stylize_Texturize/i, T, 14, { blend: 5, opacity: 40 }],
  // ---- cor
  [/S_Gamma\b/i, C, 1], [/S_Monochrome/i, C, 2], [/S_TriTone|BCC3Tritone/i, C, 3], [/S_QuadTone/i, C, 4], [/S_Posterize|BCC4Color Choker/i, C, 5], [/S_Solarize|BCC3Invert Solarize/i, C, 6],
  [/S_Threshold/i, C, 7], [/S_PseudoColor/i, C, 8], [/S_NearestColor|BCC3Color Palette/i, C, 9], [/S_ChannelSwitcher/i, C, 10], [/S_ClampChroma/i, C, 11], [/S_BleachBypass/i, C, 12],
  [/S_VintageColor2Strip/i, C, 13], [/S_VintageColor3Strip/i, C, 14], [/S_DogVision/i, C, 15], [/BCC_KELVIN|BCC3Color Balance|BCC3Color Correction|BCC_GRADE|BCC3Color Match/i, C, 16],
  [/BCC_HIGHCONTRAST/i, C, 17], [/BCC_LOWCONTRAST/i, C, 18], [/BCC_SELECTIVESATURATION|BCC3Correct Selected Color/i, C, 19], [/BCC_FLUORESCENT/i, C, 20], [/BCC_POLARIZER/i, C, 21],
  [/BCC_DEVELOP|BCC_ENHANCING/i, C, 22], [/BCC_OVEREXPOSE/i, C, 23], [/BCC3Safe Colors|BCC Broadcast Safe/i, C, 25], [/BCC3MultiTone Mix|BCC3Mixed Colors|S_ColorFuse/i, C, 26],
  [/BCC6Smooth Tone|BCC Beauty Studio|BCC_BEAUTYSTUDIO/i, C, 27], [/BCC_BLACKANDWHITE|Noir_Moderne/i, 'blackWhite', 0], [/BCC3Colorize/i, C, 2],
  // ---- estilizar / lentes
  [/S_Emboss\b|BCC3Emboss/i, Y, 1], [/S_EmbossShiny|BCC3Light Matte/i, Y, 2], [/S_EmbossGlass|S_EmbossDistort/i, Y, 3], [/S_Sketch/i, Y, 4], [/S_Etching/i, Y, 5], [/S_Crosshatch/i, Y, 6],
  [/S_FlysEyeRect/i, Y, 7], [/S_FlysEyeHex/i, Y, 8], [/S_FlysEyeCircles/i, Y, 9], [/S_Zebrafy\b/i, Y, 10], [/S_ZebrafyColor/i, Y, 11], [/S_EdgeColorize/i, Y, 12], [/S_EdgesInDirection/i, Y, 13],
  [/S_BandPass/i, Y, 14], [/S_Diffuse\b/i, Y, 15], [/S_Brush/i, Y, 16], [/BCC3Scatterize/i, Y, 17], [/BCC_FROST|BCC_MIST|BCC_DIFFUSION|BCC_HAZE/i, Y, 18], [/BCC_HALO|BCC_ICEHALOS/i, Y, 19],
  [/BCC_SILK/i, Y, 20], [/BCC_MULTISTAR/i, Y, 21], [/BCC4Scanline/i, Y, 22], [/BCC3Misalignment|BCC_CHROMABANDS|BCC_DEFRINGE/i, Y, 23], [/S_StretchFrameEdges/i, D, 5], [/BCC_SPLITFIELD|BCC_FSTOP|BCC_DEPTHOFFIELD|BCC_RACKFOCUS/i, 'lensBlur', 0],
  // ---- distorção
  [/S_HyperPush/i, D, 1], [/S_HyperPull/i, D, 2], [/S_InfiniteZoom/i, D, 3], [/S_ParallaxStrips\b/i, D, 4], [/S_StripSlide\b/i, D, 6], [/BCC Twister/i, D, 7],
  [/BCC_LENSDISTORTION|BCC Lens Correction/i, D, 8], [/BCC_WIDEANGLELENS/i, D, 9], [/BCC Reflection|BCC_REFLECTOR/i, D, 10], [/BCC3Polar Displacement/i, D, 11], [/BCC Pan and Zoom|BCC Reframer/i, D, 21],
  [/Picture_in_Picture|BCC3DVE|BCC_TRANSFORM/i, D, 22], [/BCC3Ripple/i, 'ripple', 0], [/BCC3Bulge|BCC4Warp/i, 'bulge', 0], [/BCC3Displacement Map|BCC3Vector Displacement/i, 'turbulentDisplace', 0],
  [/S_WhipLash/i, D, 18],
  // ---- luz / partículas
  [/S_SpotLight|BCC3Spotlight|BCC3Alpha Spotlight|BCC3Reverse Spotlight/i, L, 1], [/S_LaserBeam|BCC Laser Beam/i, L, 2], [/BCC3Rain/i, L, 3], [/BCC3Snow/i, L, 4], [/BCC3Fire/i, L, 5],
  [/BCC3Sparks/i, L, 6], [/BCC3Glitter|BCC3Glint|BCC3Glare/i, L, 7], [/BCC3Comet/i, L, 8], [/BCC3Edge Lighting/i, L, 9], [/BCC_AMBIENTLIGHT|BCC_LIGHT\b|BCC_RELIGHT|S_Light3D/i, L, 10],
  [/BCC3Stage Light|BCC3Light Zoom|BCC3Light Sweep/i, L, 11], [/BCC_CENTERSPOT/i, L, 12], [/BCC_EYELIGHT/i, L, 13], [/BCC Particle (Array|Emitter)|BCC Particle Illusion|BCC3Particle System|BCC32D Particles|BCC Pin Art/i, L, 15],
  [/S_UltraZap/i, L, 16], [/Knoll_Light_Factory_EZ|Universe_CrumplePop_OverLight/i, 'lensFlare', 0],
  // ---- outros que já têm equivalente direto
  [/S_Shape\b|Draw_Path/i, 'fill', 0], [/S_Effect\b|S_Layer\b|S_MathOps|S_MatteOps(Comp)?|S_ZComp|BCC3Composite|BCC_COMPOSITE|BCC_MATHCOMPOSITE|BCC_EDGECOMPOSITE|BCC_HOLDOUTCOMPOSITE|BCC_NONADDITIVEMIX|BCC3Super Blend|BCC3Boost Blend/i, 'transform', 0],
  [/S_ZFog(Exponential|Linear)/i, 'pkColor', 18], [/S_TimeAverage|BCC3Looper/i, 'echo', 0], [/S_TimeDisplace|BCC3Time Displacement/i, 'timeWarpRGB', 0], [/S_FreezeFrame|S_GetFrame|BCC3Posterize Time/i, 'posterizeTime', 0],
  [/S_Retime|BCC3Optical Flow|Create Motion Vectors/i, 'twixtor', 0], [/S_RandomEdits|S_ReverseEdits/i, 'glitch', 0], [/S_MotionDetect/i, 'findEdges', 0], [/BCC3Stabilizer|BCC3MatchMove/i, 'stabilize', 0],
  [/BCC3CornerPin|BCC Corner Pin Studio/i, 'transform', 0], [/BCC Card Array|BCC ?3D Extruded Image Shatter|BCC3 ?3D Image Shatter/i, 'shatter', 0], [/BCC4(Video )?Morph/i, W, 17, { soft: 50 }], [/BCC_COLORPASTE/i, C, 16], [/S_Glare\b/i, 'starGlow', 0], [/BCC3Cloth/i, 'waveWarp', 0],
  [/Boris3WitnessProtection/i, 'mosaic', 0], [/BCC3Dust and Scratches|BCC6DV Fixer|BCC Dropout Fixer|BCC_DEBAND|BCC_DEBLOCK|S_RepairFrames|S_FieldRemove/i, 'minimax', 0],
  [/BCC Magic Sharp|BCC UpRez/i, 'sharpen', 0], [/BCC Chroma Key Studio|BCC Primatte Studio|BCC3Chroma Key|BCC3Two Way Key|BCC_KEYLIGHT|BCC3MotionKey|BCC Spill Remover/i, 'keylight', 0],
  [/BCC3Linear Luma Key|BCC3Make Alpha Key/i, 'lumaKey', 0], [/BCC3Matte Cleanup|BCC Edge Cleaner|BCC3Premult|BCC3Alpha Process/i, 'minimax', 0], [/BCC3Star Matte/i, 'pkWipe', 5],
  [/Universe_Text_(Glo_Fi_II|Luster|Ecto|AV_Club)/i, 'glow', 0], [/Universe_Misfire_Premium|Universe_Stylize_Misfire/i, 'filmDamage', 0], [/Universe_CrumplePop_Finisher|RG Cosmo/i, 'pkColor', 27],
  [/HUD_Components|Logo_Motion|Title_Motion/i, 'transform', 0], [/BCC Beat Reactor/i, 'transform', 0], [/BCC3Sequencer|BCC3Z Space|BCC VR (Insert|Reorient)/i, 'transform', 0],
];

export const PK_IMPORT_RULES = ROWS.map(([test, to, mode, extra]) => ({ vendor: 'Plugins do usuário', plugin: `${to}${mode ? ` · modo ${mode}` : ''}`, to, test, set: { ...(mode ? { mode } : {}), ...(extra || {}) } }));

/** Plugins que não mexem na imagem (gerenciadores, scripts, utilitários): reconhecidos, mas sem efeito visual. */
export const UTILITY_PLUGINS = /AEJuice|Pack Manager|ADBE PM System|Animation Composer|Script(EP|ET|LD|SP|TO)\b|BCCFXBrowser|BCCTS\b|Videoscope|S_ShowBadColors|S_OCIOTransform|BCC Remover|BCC3Wire Remover|Copy Ease|Shifter/i;
