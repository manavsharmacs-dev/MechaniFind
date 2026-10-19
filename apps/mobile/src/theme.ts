// MechaniFind palette: dark, industrial, with Electric Orange as the one loud color.
// Contrast notes: text on orange buttons is Deep Navy (white on this orange is too
// faint to read reliably); all text colors below pass WCAG AA on the dark backgrounds.
export const colors = {
  primary: '#0B1623',      // Deep Navy — headers, sign panel
  brand: '#FF6B21',        // Electric Orange — buttons, links, highlights
  brandPressed: '#E0561A', // orange, pressed
  onBrand: '#0B1623',      // text/icons on orange
  background: '#080D12',   // Near Black — screens
  card: '#15212D',         // Slate — cards, inputs
  border: '#2A3A49',       // subtle edges on cards/inputs (derived from Slate)
  text: '#F5F7F9',         // Off White — primary text
  textMuted: '#8E9BA8',    // Steel Gray — secondary text, placeholders
  success: '#2DD881',
  warning: '#FFB020',
  error: '#F04444',
} as const;

// Overpass is an open-source typeface modeled on Highway Gothic, the lettering on US road signs.
export const fonts = {
  regular: 'Overpass_400Regular',
  bold: 'Overpass_700Bold',
  heavy: 'Overpass_800ExtraBold',
} as const;

export const space = { xs: 6, s: 12, m: 20, l: 28, xl: 40 } as const;
