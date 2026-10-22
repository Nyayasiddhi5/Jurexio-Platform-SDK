import{parseArgs}from"node:util";import{runBatch,runClearCache,runDetect,runDownloadModels,runModels,runRecognize,runStream}from"./commands.js";import{USAGE}from"./help.js";import{CliError,readVersion}from"./io.js";import{PARSE_OPTIONS}from"./options.js";async function dispatch(command,rest,values){switch(command){case"recognize":return runRecognize(rest,values);case"detect":return runDetect(rest,values);case"batch":return runBatch(rest,values);case"stream":return runStream(rest,values);case"download-models":return runDownloadModels(values);case"clear-cache":return runClearCache(values);case"models":return runModels(values);default:throw new CliError(`Unknown command: ${command}

${USAGE}`,2)}}export async function main(argv){let parsed;try{parsed=parseArgs({args:argv,options:PARSE_OPTIONS,allowPositionals:true,strict:true})}catch(e){process.stderr.write(`${e instanceof Error?e.message:String(e)}

${USAGE}`);return 2}let values=parsed.values;const[command,...rest]=parsed.positionals;if(values.version){process.stdout.write(`${readVersion()}
`);return 0}if(!command||command==="help"||values.help){process.stdout.write(USAGE);return 0}if(command==="version"){process.stdout.write(`${readVersion()}
`);return 0}try{await dispatch(command,rest,values);return 0}catch(e){if(e instanceof CliError){process.stderr.write(`${e.message}
`);return e.code}process.stderr.write(`${e instanceof Error?e.stack??e.message:String(e)}
`);return 1}}