/** Fixed cell sizes of the sheet grid: positions are arithmetic, so outlines and hit tests need no measuring. */
export const ROW_H = 24
export const COL_W = 96
export const HEAD_H = 24
export const GUTTER_W = 56
/** An empty band above the first sheet row, where the label chips of the topmost blocks sit. */
export const TOP_PAD = 18
/** Top of the first sheet row in the grid's content box. */
export const BODY_TOP = HEAD_H + TOP_PAD
