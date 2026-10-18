// Borrowed from US interstate guide signs: sign green, sign white, asphalt.
// Light background on purpose — drivers use this outdoors, often in sun.
export const colors = {
  signGreen: '#00663F',
  signGreenPressed: '#004D2F',
  signWhite: '#FFFFFF',
  asphalt: '#1F2427',     // main text
  road: '#545D63',        // secondary text
  concrete: '#EDEFED',    // screen background
  shoulder: '#BFC5C1',    // field borders
  stopRed: '#A8201A',     // errors
} as const;

// Overpass is an open-source typeface modeled on Highway Gothic, the lettering on US road signs.
export const fonts = {
  regular: 'Overpass_400Regular',
  bold: 'Overpass_700Bold',
  heavy: 'Overpass_800ExtraBold',
} as const;

export const space = { xs: 6, s: 12, m: 20, l: 28, xl: 40 } as const;
