/**
 * Responsive layout — one place that turns a window width into a layout the
 * screens obey, so the SAME universal app renders properly on both iPhone and
 * iPad (Apple ships one binary for both). The web caps its content column at
 * ~940px and centers it (`.wrap`); we do the same here so an iPad doesn't stretch
 * a single column edge-to-edge into unreadable line lengths, and card lists use
 * the extra width as a multi-column grid.
 *
 * `resolveLayout` is pure (fully unit-tested); `useLayout` is the thin hook that
 * feeds it the live window size.
 */
import { useWindowDimensions } from "react-native";

/** Width at/above which we treat the device as a tablet (iPad portrait ≈ 768–834). */
export const TABLET_MIN_WIDTH = 768;
/** Readable content column cap on large screens (mirrors the web's ~940px wrap). */
export const CONTENT_MAX_WIDTH = 900;
/** Above this, a large landscape iPad can afford a third card column. */
const WIDE_MIN_WIDTH = 1180;

export type Layout = {
  width: number;
  isTablet: boolean;
  /** columns for CARD grids (dashboard/portfolio): 1 on phone, 2–3 on iPad. */
  columns: number;
  /** the max width the centered content column is constrained to. */
  contentMaxWidth: number;
  /** gutter/padding + inter-item gap for this size class. */
  gutter: number;
};

/** Pure: derive the layout for a given window width. */
export function resolveLayout(width: number): Layout {
  const isTablet = width >= TABLET_MIN_WIDTH;
  const columns = width >= WIDE_MIN_WIDTH ? 3 : isTablet ? 2 : 1;
  return {
    width,
    isTablet,
    columns,
    contentMaxWidth: isTablet ? CONTENT_MAX_WIDTH : width,
    gutter: isTablet ? 24 : 16,
  };
}

/** Live layout for the current window. */
export function useLayout(): Layout {
  const { width } = useWindowDimensions();
  return resolveLayout(width);
}

/** Split a list into rows of `columns` for grid rendering. Pure + tested. */
export function chunk<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, columns);
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}
