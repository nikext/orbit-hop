/** Simulation constants. World units are roughly "pixels at 1x on a 400-wide phone". */

export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

/** Width of the playable column. x runs from -HALF_W to +HALF_W. */
export const WORLD_W = 400;
export const HALF_W = WORLD_W / 2;
/** How far past the column edge the probe may drift before the run ends. */
export const SIDE_MARGIN = 34;
/** The floor (bottom of the play area) trails this far below the current planet. */
export const FLOOR_BELOW_ANCHOR = 210;
/** Generate bodies this far above the floor. */
export const GEN_AHEAD = 2100;
/** Bodies this far below the floor are recycled. */
export const RECYCLE_BELOW = 260;

export const PROBE_R = 5;

/** Charge reaches 1 after this many ticks of holding. */
export const CHARGE_TICKS = 96;
export const LAUNCH_MIN = 170;
export const LAUNCH_MAX = 520;

/** Tangential speed used to derive orbit angular velocity. */
export const ORBIT_SPEED = 150;
export const ORBIT_W_MIN = 1.7;
export const ORBIT_W_MAX = 3.1;
/** Orbit speed grows by up to this fraction with difficulty. */
export const ORBIT_TEMPO = 0.25;

export const FLIGHT_TIMEOUT_S = 6;

export const POINTS_CAPTURE = 100;
export const POINTS_NEAR_MISS = 25;
export const POINTS_DUST = 10;
export const POINTS_SLINGSHOT = 250;
export const COMBO_WINDOW_S = 1.5;
export const COMBO_MAX = 8;

/** A pass whose closest approach is within this band of a surface counts as a near miss. */
export const NEAR_MISS_BAND = 11;
export const DUST_R = 15;

/** Gravity strength: GM = G_K * r^2 for ordinary planets. */
export const G_K = 1500;
