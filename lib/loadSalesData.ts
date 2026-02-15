export interface SalesDataRow {
  Team: string;
  Season: string;
  GameID: string;
  PairID: string;
  Section: string;
  Row: string;
  Seats: string;
  SeatCount: number;
  Price: number;
  PaymentStatus: string;
}

export async function loadSalesData(): Promise<SalesDataRow[]> {
  // Placeholder function - implement CSV loading logic here
  return [] as SalesDataRow[];
}