/**
 * Color Ramps & Bathymetry Heatmap Palette Generator
 */

const ColorRamps = {
  // Palettes defined by color stops: array of [normalized_val (0 to 1), r, g, b]
  palettes: {
    bathymetry: [
      { stop: 0.0, color: [13, 27, 42] },     // Vùng rất sâu: Deep Navy/Black
      { stop: 0.25, color: [27, 38, 59] },    // Sâu: Navy Blue
      { stop: 0.5, color: [65, 90, 119] },    // Trung bình: Ocean Blue
      { stop: 0.75, color: [0, 180, 216] },   // Nông: Cyan Blue
      { stop: 0.9, color: [144, 224, 239] },  // Rất nông: Light Aqua
      { stop: 1.0, color: [255, 236, 179] }   // Bờ/Bãi bồi: Soft Yellow/Sand
    ],
    rainbow: [
      { stop: 0.0, color: [0, 0, 255] },     // Blue
      { stop: 0.25, color: [0, 255, 255] },  // Cyan
      { stop: 0.5, color: [0, 255, 0] },     // Green
      { stop: 0.75, color: [255, 255, 0] },  // Yellow
      { stop: 1.0, color: [255, 0, 0] }      // Red
    ],
    viridis: [
      { stop: 0.0, color: [68, 1, 84] },
      { stop: 0.25, color: [59, 82, 139] },
      { stop: 0.5, color: [33, 145, 140] },
      { stop: 0.75, color: [94, 201, 98] },
      { stop: 1.0, color: [253, 231, 37] }
    ],
    thermal: [
      { stop: 0.0, color: [10, 10, 35] },
      { stop: 0.3, color: [120, 0, 150] },
      { stop: 0.6, color: [240, 60, 0] },
      { stop: 0.85, color: [255, 180, 0] },
      { stop: 1.0, color: [255, 255, 200] }
    ],
    terrain: [
      { stop: 0.0, color: [10, 40, 90] },
      { stop: 0.3, color: [40, 100, 140] },
      { stop: 0.6, color: [80, 160, 120] },
      { stop: 0.85, color: [160, 190, 110] },
      { stop: 1.0, color: [220, 200, 140] }
    ]
  },

  /**
   * Linear interpolation between two colors
   */
  lerpColor(c1, c2, factor) {
    return [
      Math.round(c1[0] + (c2[0] - c1[0]) * factor),
      Math.round(c1[1] + (c2[1] - c1[1]) * factor),
      Math.round(c1[2] + (c2[2] - c1[2]) * factor)
    ];
  },

  /**
   * Get RGB color array for a normalized depth value t (0.0 to 1.0)
   * t = 0 (deepest point), t = 1 (shallowest point)
   */
  getColor(t, paletteName = 'bathymetry') {
    const palette = this.palettes[paletteName] || this.palettes.bathymetry;
    t = Math.max(0, Math.min(1, t));

    for (let i = 0; i < palette.length - 1; i++) {
      const curr = palette[i];
      const next = palette[i + 1];
      if (t >= curr.stop && t <= next.stop) {
        const factor = (t - curr.stop) / (next.stop - curr.stop);
        return this.lerpColor(curr.color, next.color, factor);
      }
    }
    return palette[palette.length - 1].color;
  },

  /**
   * Get CSS rgb string
   */
  getColorCSS(t, paletteName = 'bathymetry') {
    const [r, g, b] = this.getColor(t, paletteName);
    return `rgb(${r}, ${g}, ${b})`;
  },

  /**
   * Get CSS gradient linear string for legend display
   */
  getLegendGradientCSS(paletteName = 'bathymetry') {
    const palette = this.palettes[paletteName] || this.palettes.bathymetry;
    const stops = palette.map(p => `rgb(${p.color.join(',')}) ${p.stop * 100}%`).join(', ');
    return `linear-gradient(to right, ${stops})`;
  }
};

window.ColorRamps = ColorRamps;
