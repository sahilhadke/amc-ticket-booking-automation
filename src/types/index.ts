export interface BookingArgs {
  movie: string;
  date: string;     // "YYYY-MM-DD"
  time: string;     // "7:30 PM"
  theater?: string;
}

export interface SeatCoord {
  row: number;      // 0-indexed, 0 = front row
  col: number;      // 0-indexed, 0 = leftmost column
  label: string;    // e.g. "Row J Seat 10"
  element: string;  // CSS selector or aria-label for clicking
}

export interface ParsedSeatMap {
  seats: SeatCoord[];
  totalRows: number;
  totalCols: number;
}
