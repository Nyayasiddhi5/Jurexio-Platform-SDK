export class DatabaseConnectorService {
  async query(connectionId: string, query: string, params?: any[]) {
    return { rows: [], rowCount: 0, connectionId };
  }
}
