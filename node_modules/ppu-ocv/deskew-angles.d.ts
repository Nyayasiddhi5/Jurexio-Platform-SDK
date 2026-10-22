/**
 * Skew-angle estimators used by {@link DeskewService}. Pure helpers extracted
 * from `deskew.ts`: each takes detected text regions (or a binary Mat) and
 * returns candidate angles with weights, plus a consensus reducer. Methods that
 * log accept a `log` callback so they stay free of service state.
 */
import { cv } from "./cv-provider.js";
/** A candidate skew angle with its confidence weight. */
export type WeightedAngle = {
    angle: number;
    weight: number;
};
/** A detected text region: its contour and basic shape metrics. */
export type TextRegion = {
    contour: cv.Mat;
    area: number;
    aspectRatio: number;
};
/** Least-squares slope of a point set, as an angle in degrees clamped to ±45°. */
export declare function calculateLineAngle(points: Array<{
    x: number;
    y: number;
}>): number;
/** Angles from each region's minimum-area rectangle, weighted by area and aspect. */
export declare function calculateMinRectAngles(textRegions: TextRegion[]): WeightedAngle[];
/** Angles from each region's text baseline (line fit through bottom points). */
export declare function calculateBaselineAngles(textRegions: TextRegion[]): WeightedAngle[];
/** Angles from a probabilistic Hough line transform of the morphed binary Mat. */
export declare function calculateHoughAngles(mat: cv.Mat, minAngle: number, maxAngle: number, log: (message: string) => void): WeightedAngle[];
/** Robust consensus over all candidate angles: IQR outlier rejection + weighted mean. */
export declare function calculateConsensusAngle(angles: Array<WeightedAngle & {
    method: string;
}>, minAngle: number, maxAngle: number, log: (message: string) => void): number;
