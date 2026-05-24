export const BASES = {
  A: { name: 'Adenine', short: 'A', complement: 'T', color: 0x0000ff },
  T: { name: 'Thymine', short: 'T', complement: 'A', color: 0xff0000 },
  U: { name: 'Uracil', short: 'U', complement: 'A', color: 0xff00ff },
  G: { name: 'Guanine', short: 'G', complement: 'C', color: 0xffff00 },
  C: { name: 'Cytosine', short: 'C', complement: 'G', color: 0x00ff00 },
  X: { name: 'Generic', short: 'X', complement: 'X', color: 0x808080 }
};

export const TYPE_FROM_NAME = {
  Adenine: 'A',
  Thymine: 'T',
  Uracil: 'U',
  Guanine: 'G',
  Cytosine: 'C',
  Cytocine: 'C',
  Generic: 'X'
};

export const TIAMAT_GEOMETRY = {
  B: {
    label: 'B-DNA',
    rise: 0.332,
    radius: 1,
    twistDeg: -34.28571,
    oppositeDeg: -146,
    inclinationDeg: 0
  },
  A: {
    label: 'A-DNA/RNA',
    rise: 0.29,
    radius: 1.15,
    twistDeg: -32.7,
    oppositeDeg: 258.93,
    inclinationDeg: 19
  }
};

export const DOWN_DISTANCE = 0.677;
export const DOWN_ERROR = 0.05;
export const STRAND_COLORS = ['#ff8000', '#80ff00', '#00ff80', '#0080ff', '#8000ff', '#ff0080'];
export const MAX_LABELS = 320;

const DEG = Math.PI / 180;

function totalRise(radius, rotation, rise) {
  return Math.hypot(radius * (1 - Math.cos(rotation)), radius * Math.sin(rotation), rise);
}

function chord(radius, opposite, inclination) {
  const planar = 2 * radius * Math.sin(Math.abs(opposite) / 2);
  return Math.hypot(planar, planar * Math.tan(inclination));
}

export const CONSTRAINTS = {
  B: {
    rotation: { median: totalRise(1, Math.abs(TIAMAT_GEOMETRY.B.twistDeg) * DEG, 0), error: totalRise(0.1, Math.abs(TIAMAT_GEOMETRY.B.twistDeg / 20) * DEG, 0) },
    rise: { median: totalRise(1, Math.abs(TIAMAT_GEOMETRY.B.twistDeg) * DEG, TIAMAT_GEOMETRY.B.rise), error: totalRise(0.1, Math.abs(TIAMAT_GEOMETRY.B.twistDeg / 20) * DEG, TIAMAT_GEOMETRY.B.rise / 20) },
    chord: { median: chord(TIAMAT_GEOMETRY.B.radius, TIAMAT_GEOMETRY.B.oppositeDeg * DEG, 0), error: chord(TIAMAT_GEOMETRY.B.radius / 10, TIAMAT_GEOMETRY.B.oppositeDeg * DEG, 1 * DEG) },
    inclination: { median: 0, error: 1 * DEG }
  },
  A: {
    rotation: { median: totalRise(1.15, Math.abs(TIAMAT_GEOMETRY.A.twistDeg) * DEG, 0), error: totalRise(0.115, Math.abs(TIAMAT_GEOMETRY.A.twistDeg / 20) * DEG, 0) },
    rise: { median: totalRise(1.15, Math.abs(TIAMAT_GEOMETRY.A.twistDeg) * DEG, TIAMAT_GEOMETRY.A.rise), error: totalRise(0.115, Math.abs(TIAMAT_GEOMETRY.A.twistDeg / 20) * DEG, TIAMAT_GEOMETRY.A.rise / 20) },
    chord: { median: chord(TIAMAT_GEOMETRY.A.radius, TIAMAT_GEOMETRY.A.oppositeDeg * DEG, TIAMAT_GEOMETRY.A.inclinationDeg * DEG), error: chord(TIAMAT_GEOMETRY.A.radius / 10, TIAMAT_GEOMETRY.A.oppositeDeg * DEG, 1 * DEG) },
    inclination: { median: TIAMAT_GEOMETRY.A.inclinationDeg * DEG, error: 1 * DEG }
  }
};
