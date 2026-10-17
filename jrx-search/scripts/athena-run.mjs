import { AthenaClient, StartQueryExecutionCommand, GetQueryExecutionCommand, GetQueryResultsCommand } from '@aws-sdk/client-athena';
const c = new AthenaClient({ region: 'ap-south-1' });
export async function run(sql, db) {
  const s = await c.send(new StartQueryExecutionCommand({
    QueryString: sql,
    ...(db ? { QueryExecutionContext: { Database: db } } : {}),
    ResultConfiguration: { OutputLocation: 's3://usa-caselaw/athena/results/' },
  }));
  const id = s.QueryExecutionId;
  for (;;) {
    const e = await c.send(new GetQueryExecutionCommand({ QueryExecutionId: id }));
    const st = e.QueryExecution.Status.State;
    if (st === 'SUCCEEDED') { console.log('OK', id, 'scanned', e.QueryExecution.Statistics?.DataScannedInBytes); return id; }
    if (st === 'FAILED' || st === 'CANCELLED') throw new Error(st + ': ' + e.QueryExecution.Status.StateChangeReason);
    await new Promise(r => setTimeout(r, 1500));
  }
}
export async function results(id, max=20) {
  const r = await c.send(new GetQueryResultsCommand({ QueryExecutionId: id, MaxResults: max }));
  for (const row of r.ResultSet.Rows) console.log((row.Data||[]).map(d=>d.VarCharValue).join(' | '));
}
