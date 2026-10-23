export class FinancialDataService {
  async getQuote(symbol: string) {
    return { symbol, price: 0, change: 0, volume: 0, timestamp: new Date().toISOString() };
  }
}
