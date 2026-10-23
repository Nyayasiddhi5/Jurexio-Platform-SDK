import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from "@aws-sdk/client-ssm";
const ssm = new SSMClient({ region: "ap-south-1" });
const INSTANCE = "i-000115b19219bb766";
export async function run(commands, timeoutSec = 570) {
  const c = await ssm.send(new SendCommandCommand({
    InstanceIds: [INSTANCE], DocumentName: "AWS-RunShellScript",
    Parameters: { commands, executionTimeout: [String(timeoutSec)] },
  }));
  const id = c.Command.CommandId;
  for (let i = 0; i < timeoutSec/5 + 6; i++) {
    await new Promise(r=>setTimeout(r, 5000));
    try {
      const inv = await ssm.send(new GetCommandInvocationCommand({ CommandId: id, InstanceId: INSTANCE }));
      if (["Success","Failed","Cancelled","TimedOut"].includes(inv.Status)) {
        console.log("STATUS:", inv.Status);
        console.log("STDOUT:\n" + (inv.StandardOutputContent||"").slice(-3000));
        if (inv.StandardErrorContent) console.log("STDERR:\n" + inv.StandardErrorContent.slice(-2000));
        return inv.Status;
      }
    } catch {}
  }
  console.log("POLL TIMEOUT for", id);
  return "PollTimeout";
}
const isCli = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isCli && process.argv[2]) {
  await run([process.argv[2]], process.argv[3] ? parseInt(process.argv[3]) : 570);
}
