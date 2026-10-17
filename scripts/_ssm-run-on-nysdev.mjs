import { readFileSync } from "node:fs";
import { SSMClient, SendCommandCommand, GetCommandInvocationCommand } from "@aws-sdk/client-ssm";

const shPath = process.argv[2];
const instanceId = process.env.NYV_EC2_INSTANCE_ID;
const region = process.env.NYV_AWS_REGION || "ap-south-1";
if (!shPath || !instanceId) {
  console.error("usage: NYV_EC2_INSTANCE_ID=... node _ssm-run-on-nysdev.mjs <script.sh>");
  process.exit(2);
}
const sh = readFileSync(shPath, "utf8");
const client = new SSMClient({ region });
const start = await client.send(
  new SendCommandCommand({
    InstanceIds: [instanceId],
    DocumentName: "AWS-RunShellScript",
    Parameters: { commands: [sh] },
    TimeoutSeconds: ["120"],
  }),
);
const cid = start.Command?.CommandId;
if (!cid) throw new Error("no CommandId");
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const inv = await client.send(
    new GetCommandInvocationCommand({ CommandId: cid, InstanceId: instanceId }),
  );
  if (["Success", "Failed", "Cancelled", "TimedOut"].includes(inv.Status ?? "")) {
    console.log("STATUS:", inv.Status);
    console.log(inv.StandardOutputContent ?? "");
    if (inv.StandardErrorContent) console.error(inv.StandardErrorContent);
    process.exit(inv.Status === "Success" ? 0 : 1);
  }
}
console.log("POLL TIMEOUT");
process.exit(1);
