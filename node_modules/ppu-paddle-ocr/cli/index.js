#!/usr/bin/env node
process.on("SIGINT",()=>process.exit(130));try{const{main}=await import("./run.js");process.exit(await main(process.argv.slice(2)))}catch(e){let msg=e instanceof Error?e.message:String(e);if(msg.includes("onnxruntime-node")&&/cannot find (module|package)/i.test(msg)){process.stderr.write(`The 'onnxruntime-node' backend is not installed (optional peer dependency, ~258MB).
In a project:  npm install ppu-paddle-ocr onnxruntime-node
Zero-install:  npx -p onnxruntime-node -p ppu-paddle-ocr ppu-paddle-ocr <args>
`);process.exit(1)}process.stderr.write(`${e instanceof Error?e.stack??msg:String(e)}
`);process.exit(1)}